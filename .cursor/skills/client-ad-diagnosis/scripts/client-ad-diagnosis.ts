/**
 * One client's ads, judged on what their leads became downstream.
 *
 * Leads are grouped by the date they came in and followed forward
 * (leads.conversation_at / proposal_at / submission_at / funded_at), so a
 * close months later still lands on the ad that produced the lead. Each
 * stage only reads leads old enough to have reached it:
 *
 *   front end (CTR, opt-in, CPL, CPQL) .... every lead in the window
 *   conversation stage .................... leads at least CONV_DAYS old
 *   proposal / submission / funded ........ leads at least --mature-days old
 *
 * Spend for a stage is cut at the same date as its leads.
 *
 *   npx tsx .cursor/skills/client-ad-diagnosis/scripts/client-ad-diagnosis.ts --client "Brian Thomas"
 *   ... --client <uuid> --start 2026-01-01 --end 2026-10-23
 *   ... --qualify-switch 2026-06-01 --qualify-before no
 *   ... --self-test
 */
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AdLibraryResolver,
  normalizeAdName,
  type AdLibraryAliasRow,
  type AdLibraryMeta,
} from '../../../../src/lib/ad-performance.ts';
import { tagsByLibraryId } from '../../../../src/lib/ad-tags-db.ts';
import { dialPoolForClient } from '../../../../src/lib/dial-pool.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../../..');
const PAGE = 1000;
const DAY_MS = 86_400_000;

const CONV_DAYS = 14;
const MATURE_DAYS = 60;
const MATURE_DAYS_PROVISIONAL = 30;
const TENURE_DAYS = 90;

/** Under this total spend an ad gets no verdict. */
const THIN_SPEND = 500;
const CONV_MIN = 2;
const BACKEND_SPEND = 1500;
const BACKEND_PROPOSALS = 3;
const BACKEND_SPEND_PROVISIONAL = 1000;
const BACKEND_PROPOSALS_PROVISIONAL = 2;
const STAGE_COUNT_MIN = 2;
/**
 * Pseudo-spend at the client's own rate added to every ad before ranking.
 * An ad with $300 behind it is mostly the client average; an ad with $5,000
 * is mostly itself.
 */
const PRIOR_SPEND = 1000;
const HOT_WEIGHT = 2;
const QUAL_WEIGHT = 1;
const RATE_MIN_DENOM = 10;
const SUMMARY_MAX = 600;

const LEAD_SELECT =
  'id, client_id, lead_created_at, first_seen_at, utm_content, ad_name, campaign_name, adset_name, conversation_at, proposal_at, submission_at, funded_at, merged_into_id';
const EVENT_SELECT = 'lead_id, event_type, is_qualified, is_hot';
const EVENT_TYPES = ['lead', 'appointment_booked', 'claimed', 'live_transfer'];
const META_SELECT = 'ad_name, campaign_name, insight_date, spend, impressions, clicks';
const LIBRARY_SELECT =
  'id, ad_name, status, platform, ad_format, product, summary, visual_notes, drive_url, thumbnail_url';

// ── Small math ────────────────────────────────────────────────────────────────

function round(n: number | null, dp = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function div(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function pct(a: number, b: number): number | null {
  return round(div(a, b) != null ? (a / b) * 100 : null, 1);
}

/** Wilson 95% interval for a rate, in percent. */
export function wilson(x: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = x / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    round(((centre - spread) / denom) * 100, 1) ?? 0,
    round(((centre + spread) / denom) * 100, 1) ?? 0,
  ];
}

/** 95% range for a Poisson count (Wilson–Hilferty). */
export function poissonRange(k: number): [number, number] {
  const z = 1.96;
  const lower = k === 0 ? 0 : k * (1 - 1 / (9 * k) - z / (3 * Math.sqrt(k))) ** 3;
  const k1 = k + 1;
  const upper = k1 * (1 - 1 / (9 * k1) + z / (3 * Math.sqrt(k1))) ** 3;
  return [lower, upper];
}

/** Cost per outcome with a 95% range driven by how few outcomes there are. */
function costWithRange(spend: number, count: number) {
  const [lo, hi] = poissonRange(count);
  return {
    cost: round(div(spend, count)),
    cost_range: [round(div(spend, hi)), lo > 0 ? round(spend / lo) : null] as [number | null, number | null],
  };
}

/** Cost after blending in PRIOR_SPEND at the client's own outcome rate. */
export function shrunkCost(spend: number, count: number, clientPerDollar: number | null): number | null {
  if (clientPerDollar == null || clientPerDollar <= 0) return round(div(spend, count));
  return round((spend + PRIOR_SPEND) / (count + PRIOR_SPEND * clientPerDollar));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));
}

function trimText(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s;
}

// ── IO ────────────────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  return readFileSync(resolve(REPO, '.env.local'), 'utf-8')
    .split('\n')
    .filter((line) => line && !line.trim().startsWith('#'))
    .reduce((acc: Record<string, string>, line) => {
      const i = line.indexOf('=');
      if (i < 0) return acc;
      acc[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      return acc;
    }, {});
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await run();
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : err}`);
  } finally {
    if (process.argv.includes('--verbose')) console.error(`${label} ${Date.now() - t0}ms`);
  }
}

async function inChunks<T>(ids: string[], size: number, run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  const out: T[] = [];
  for (let i = 0; i < chunks.length; i += 6) {
    const batch = await Promise.all(chunks.slice(i, i + 6).map(run));
    for (const rows of batch) out.push(...rows);
  }
  return out;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientRow = {
  id: string;
  name: string;
  launch_date: string | null;
  reporting_type: string | null;
  qualifies_leads: boolean | null;
  is_live: boolean | null;
  lifecycle_status: string | null;
};

type LeadDbRow = {
  id: string;
  client_id: string;
  lead_created_at: string | null;
  first_seen_at: string;
  utm_content: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  conversation_at: string | null;
  proposal_at: string | null;
  submission_at: string | null;
  funded_at: string | null;
  merged_into_id: string | null;
};

type MetaRow = {
  ad_name: string | null;
  campaign_name: string | null;
  insight_date: string;
  spend: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
};

type Lead = {
  id: string;
  date: string;
  ad: string | null;
  campaign: string | null;
  qualified: boolean;
  hot: boolean;
  /** Counted in the hand-raise / conversation rate denominator. */
  in_pool: boolean;
  booked: boolean;
  hand_raise: boolean;
  conversation: boolean;
  proposal: boolean;
  submission: boolean;
  funded: boolean;
  funded_files: number;
  loan_volume: number;
};

type SpendCut = { spend: number; impressions: number; clicks: number };

type Group = {
  key: string;
  name: string;
  library: (AdLibraryMeta & { tags?: { slug: string; label: string; category: string }[] }) | null;
  variants: Set<string>;
  campaigns: Map<string, number>;
  spend_all: SpendCut;
  spend_conv: number;
  spend_mature: number;
  leads: Lead[];
  months: Map<string, { spend: number }>;
};

type Cutoffs = { end: string; conv: string; mature: string };

// ── Stage math per group of leads ────────────────────────────────────────────

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function weightOf(l: Lead): number {
  if (l.hot) return HOT_WEIGHT;
  if (l.qualified) return QUAL_WEIGHT;
  return 0;
}

export type StageStats = ReturnType<typeof stageStats>;

export function stageStats(leads: Lead[], spend: SpendCut, spendConv: number, spendMature: number, cut: Cutoffs) {
  const front = leads;
  const conv = leads.filter((l) => l.date <= cut.conv);
  const mature = leads.filter((l) => l.date <= cut.mature);
  const count = (rows: Lead[], f: (l: Lead) => boolean) => rows.filter(f).length;

  const qualified = count(front, (l) => l.qualified);
  const hot = count(front, (l) => l.hot);

  const convPool = conv.filter((l) => l.in_pool);
  const conversations = count(conv, (l) => l.conversation);
  const qualifiedConversations = count(conv, (l) => l.conversation && (l.qualified || l.hot));
  const hotConversations = count(conv, (l) => l.conversation && l.hot);
  const weighted = conv.filter((l) => l.conversation).reduce((s, l) => s + weightOf(l), 0);
  const booked = count(conv, (l) => l.booked);
  const bookedSpoke = count(conv, (l) => l.booked && l.conversation);
  const handRaises = count(convPool, (l) => l.hand_raise);
  const poolConversations = count(convPool, (l) => l.conversation);

  const mConversations = count(mature, (l) => l.conversation);
  const proposals = count(mature, (l) => l.proposal);
  const submissions = count(mature, (l) => l.submission);
  const funded = count(mature, (l) => l.funded);
  const fundedFiles = mature.reduce((s, l) => s + l.funded_files, 0);
  const volume = mature.reduce((s, l) => s + l.loan_volume, 0);

  return {
    front: {
      spend: round(spend.spend),
      impressions: spend.impressions,
      clicks: spend.clicks,
      ctr: pct(spend.clicks, spend.impressions),
      optin_rate: pct(front.length, spend.clicks),
      leads: front.length,
      qualified,
      hot,
      qualified_rate: pct(qualified, front.length),
      qualified_rate_ci: wilson(qualified, front.length),
      hot_rate: pct(hot, front.length),
      cpl: round(div(spend.spend, front.length)),
      cpql: round(div(spend.spend, qualified)),
      cph: round(div(spend.spend, hot)),
    },
    conversation: {
      spend: round(spendConv),
      leads: conv.length,
      pool_leads: convPool.length,
      hand_raises: handRaises,
      hand_raise_rate: pct(handRaises, convPool.length),
      hand_raise_rate_ci: wilson(handRaises, convPool.length),
      conversations,
      qualified_conversations: qualifiedConversations,
      hot_conversations: hotConversations,
      weighted_conversations: weighted,
      hot_share_of_conversations: pct(hotConversations, conversations),
      conversation_rate: pct(poolConversations, convPool.length),
      booked,
      show_rate_graded: pct(bookedSpoke, booked),
      cpconv_raw: round(div(spendConv, conversations)),
      cost_per_weighted_conversation: round(div(spendConv, weighted)),
    },
    backend: {
      spend: round(spendMature),
      leads: mature.length,
      conversations: mConversations,
      proposals,
      submissions,
      funded,
      funded_files: fundedFiles,
      loan_volume: round(volume, 0),
      conversation_to_proposal: pct(proposals, mConversations),
      conversation_to_proposal_ci: wilson(proposals, mConversations),
      proposal_to_submission: pct(submissions, proposals),
      submission_to_funded: pct(funded, submissions),
      lead_to_funded: pct(funded, mature.length),
      proposal: costWithRange(spendMature, proposals),
      submission: costWithRange(spendMature, submissions),
      funded_cost: costWithRange(spendMature, funded),
      volume_per_dollar: round(div(volume, spendMature)),
    },
  };
}

type RankStage = 'funded' | 'submission' | 'proposal' | 'conversation';

type Evidence = {
  tier: 'thin' | 'conversation' | 'backend';
  deepest_stage: RankStage | null;
  early_signal: boolean;
  why: string;
};

export function evidenceFor(s: StageStats, provisional: boolean): Evidence {
  const spend = s.front.spend ?? 0;
  const backendSpendBar = provisional ? BACKEND_SPEND_PROVISIONAL : BACKEND_SPEND;
  const backendPropBar = provisional ? BACKEND_PROPOSALS_PROVISIONAL : BACKEND_PROPOSALS;
  if (spend < THIN_SPEND) {
    return { tier: 'thin', deepest_stage: null, early_signal: false, why: `$${spend.toFixed(0)} spent, under $${THIN_SPEND}` };
  }
  if (s.conversation.conversations < CONV_MIN) {
    return {
      tier: 'thin',
      deepest_stage: null,
      early_signal: false,
      why: `${s.conversation.conversations} conversations on leads ${CONV_DAYS}+ days old`,
    };
  }
  const b = s.backend;
  if ((b.spend ?? 0) >= backendSpendBar && b.proposals >= backendPropBar) {
    const deepest: RankStage =
      b.funded >= STAGE_COUNT_MIN ? 'funded' : b.submissions >= STAGE_COUNT_MIN ? 'submission' : 'proposal';
    return {
      tier: 'backend',
      deepest_stage: deepest,
      early_signal: false,
      why: `$${(b.spend ?? 0).toFixed(0)} on matured leads, ${b.proposals} proposals, ${b.submissions} submissions, ${b.funded} funded`,
    };
  }
  return {
    tier: 'conversation',
    deepest_stage: 'conversation',
    early_signal: b.proposals > 0,
    why: `back end below the bar ($${(b.spend ?? 0).toFixed(0)} matured spend, ${b.proposals} proposals; needs $${backendSpendBar} and ${backendPropBar})`,
  };
}

function stageCount(s: StageStats, stage: RankStage): { spend: number; count: number } {
  if (stage === 'conversation') {
    return { spend: s.conversation.spend ?? 0, count: s.conversation.weighted_conversations };
  }
  const spend = s.backend.spend ?? 0;
  if (stage === 'proposal') return { spend, count: s.backend.proposals };
  if (stage === 'submission') return { spend, count: s.backend.submissions };
  return { spend, count: s.backend.funded };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`self-test failed: ${msg}`);
  };
  const [lo, hi] = poissonRange(3);
  assert(lo > 0.5 && lo < 0.7 && hi > 8.5 && hi < 9.0, `poisson(3) ${lo}..${hi}`);
  const w = wilson(7, 10);
  assert(w != null && w[0] > 39 && w[0] < 40 && w[1] > 89 && w[1] < 90, `wilson ${w}`);
  // A $300 ad with one proposal must rank behind a $5,000 ad at a slightly higher raw cost.
  const clientRate = 10 / 10000;
  const small = shrunkCost(300, 1, clientRate)!;
  const big = shrunkCost(5000, 12, clientRate)!;
  assert(big < small, `shrinkage small=${small} big=${big}`);

  const cut: Cutoffs = { end: '2026-10-23', conv: '2026-10-09', mature: '2026-08-24' };
  const lead = (over: Partial<Lead>): Lead => ({
    id: Math.random().toString(36),
    date: '2026-06-01',
    ad: 'a',
    campaign: null,
    qualified: false,
    hot: false,
    in_pool: true,
    booked: false,
    hand_raise: false,
    conversation: false,
    proposal: false,
    submission: false,
    funded: false,
    funded_files: 0,
    loan_volume: 0,
    ...over,
  });
  const leads = [
    lead({ qualified: true, hot: true, conversation: true, proposal: true }),
    lead({ qualified: true, conversation: true }),
    lead({ conversation: true }),
    lead({ date: '2026-10-20', qualified: true, conversation: true }),
  ];
  const s = stageStats(leads, { spend: 900, impressions: 40000, clicks: 800 }, 800, 600, cut);
  assert(s.front.leads === 4, 'front leads');
  assert(s.conversation.conversations === 3, 'recent lead excluded from conversation stage');
  assert(s.conversation.weighted_conversations === 3, 'hot 2 + qualified 1 + unqualified 0');
  assert(s.backend.proposals === 1, 'proposals');
  const ev = evidenceFor(s, false);
  assert(ev.tier === 'conversation' && ev.early_signal, `evidence ${JSON.stringify(ev)}`);
  console.log('self-test ok');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function findClient(service: SupabaseClient, q: string): Promise<ClientRow> {
  const cols = 'id, name, launch_date, reporting_type, qualifies_leads, is_live, lifecycle_status';
  const isUuid = /^[0-9a-f-]{36}$/i.test(q);
  const { data, error } = isUuid
    ? await service.from('clients').select(cols).eq('id', q)
    : await service.from('clients').select(cols).ilike('name', `%${q}%`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClientRow[];
  if (rows.length === 0) throw new Error(`No client matches "${q}"`);
  if (rows.length > 1) {
    const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
    if (exact.length === 1) return exact[0];
    throw new Error(`"${q}" matches ${rows.length} clients. Pass the id:\n${rows.map((r) => `  ${r.id}  ${r.name}`).join('\n')}`);
  }
  return rows[0];
}

function funnelStage(name: string, tags: { category: string; label: string }[]): string | null {
  const tagged = tags.find((t) => t.category.toLowerCase() === 'stage')?.label;
  if (tagged) return tagged.toUpperCase();
  const m = name.toUpperCase().match(/(?:^|[^A-Z])(TOF|MOFU|BOF)(?:[^A-Z]|$)/);
  return m ? m[1] : null;
}

function leadDate(l: LeadDbRow): string {
  return (l.lead_created_at ?? l.first_seen_at).slice(0, 10);
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const clientArg = arg('client');
  if (!clientArg) throw new Error('Pass --client "<name or id>"');

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  const service = createClient(url, key, { auth: { persistSession: false } });

  const client = await findClient(service, clientArg);
  const today = isoDate(new Date());
  const end = arg('end') ?? today;
  const start = arg('start') ?? client.launch_date ?? addDays(end, -365);
  const tenureDays = client.launch_date
    ? Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${client.launch_date}T00:00:00Z`)) / DAY_MS)
    : null;
  const provisional = tenureDays != null && tenureDays < TENURE_DAYS;
  const matureDays = Number(arg('mature-days') ?? (provisional ? MATURE_DAYS_PROVISIONAL : MATURE_DAYS));
  const cut: Cutoffs = { end, conv: addDays(end, -CONV_DAYS), mature: addDays(end, -matureDays) };

  const currentPool = dialPoolForClient(client.reporting_type, client.qualifies_leads);
  const switchDate = arg('qualify-switch');
  const before = arg('qualify-before');
  const poolBefore =
    before === 'yes' ? 'qualified' : before === 'no' ? 'all' : currentPool;
  const poolOn = (date: string) => (switchDate && date < switchDate ? poolBefore : currentPool);

  // Leads (all, so merged ids can be mapped onto their survivor).
  const leadRows = await step('leads', () =>
    fetchAll<LeadDbRow>((from, to) =>
      service.from('leads').select(LEAD_SELECT).eq('client_id', client.id).order('id').range(from, to),
    ),
  );
  const mergedInto = new Map<string, string>();
  for (const l of leadRows) if (l.merged_into_id) mergedInto.set(l.id, l.merged_into_id);
  const survivor = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 5 && mergedInto.has(cur); i++) cur = mergedInto.get(cur)!;
    return cur;
  };
  const live = leadRows.filter((l) => !l.merged_into_id && leadDate(l) >= start && leadDate(l) <= end);

  // By lead id, not client id: a call-center client's events are mostly dials,
  // and a client-wide scan times out.
  const wantedIds = new Set(live.map((l) => l.id));
  const eventLeadIds = leadRows.filter((l) => wantedIds.has(survivor(l.id))).map((l) => l.id);
  // No event_type filter in SQL: with it the planner leaves the lead_id index.
  const events = (
    await step('events', () =>
      inChunks(eventLeadIds, 150, (chunk) =>
        fetchAll<{ lead_id: string; event_type: string; is_qualified: boolean | null; is_hot: boolean | null }>(
          (from, to) => service.from('events').select(EVENT_SELECT).in('lead_id', chunk).range(from, to),
        ),
      ),
    )
  ).filter((e) => EVENT_TYPES.includes(e.event_type));
  const tags = new Map<string, { qualified: boolean; hot: boolean; booked: boolean; hand_raise: boolean; has_lead_event: boolean }>();
  for (const e of events) {
    const id = survivor(e.lead_id);
    const t = tags.get(id) ?? { qualified: false, hot: false, booked: false, hand_raise: false, has_lead_event: false };
    if (e.event_type === 'lead') {
      t.has_lead_event = true;
      if (e.is_qualified) t.qualified = true;
      if (e.is_hot) t.hot = true;
    } else {
      t.hand_raise = true;
      if (e.event_type === 'appointment_booked') t.booked = true;
    }
    tags.set(id, t);
  }

  const deals = await step('loan_deals', () =>
    fetchAll<{ lead_id: string | null; stage: string; loan_size: number | string | null }>((from, to) =>
      service.from('loan_deals').select('lead_id, stage, loan_size').eq('client_id', client.id).eq('stage', 'funded').range(from, to),
    ),
  );
  const dealsByLead = new Map<string, { files: number; volume: number }>();
  let dealsWithoutLead = 0;
  for (const d of deals) {
    if (!d.lead_id) {
      dealsWithoutLead += 1;
      continue;
    }
    const id = survivor(d.lead_id);
    const acc = dealsByLead.get(id) ?? { files: 0, volume: 0 };
    acc.files += 1;
    acc.volume += num(d.loan_size);
    dealsByLead.set(id, acc);
  }

  const leads: Lead[] = live.map((l) => {
    const t = tags.get(l.id);
    const d = dealsByLead.get(l.id);
    const date = leadDate(l);
    const qualified = Boolean(t?.qualified || t?.hot);
    const pool = poolOn(date);
    return {
      id: l.id,
      date,
      ad: normalizeAdName(l.utm_content) ?? normalizeAdName(l.ad_name),
      campaign: l.campaign_name,
      qualified,
      hot: Boolean(t?.hot),
      in_pool: pool === 'qualified' ? qualified : true,
      booked: Boolean(t?.booked),
      hand_raise: Boolean(t?.hand_raise),
      conversation: Boolean(l.conversation_at),
      proposal: Boolean(l.proposal_at || l.submission_at || l.funded_at),
      submission: Boolean(l.submission_at || l.funded_at),
      funded: Boolean(l.funded_at),
      funded_files: d?.files ?? (l.funded_at ? 1 : 0),
      loan_volume: d?.volume ?? 0,
    };
  });

  const meta = await step('meta_ad_insights', () =>
    fetchAll<MetaRow>((from, to) =>
      service
        .from('meta_ad_insights')
        .select(META_SELECT)
        .eq('client_id', client.id)
        .gte('insight_date', start)
        .lte('insight_date', end)
        .order('insight_date')
        .order('ad_name')
        .range(from, to),
    ),
  );

  const [library, aliases] = await step('library', () =>
    Promise.all([
      fetchAll<AdLibraryMeta>((from, to) => service.from('ad_library').select(LIBRARY_SELECT).range(from, to)),
      fetchAll<AdLibraryAliasRow>((from, to) =>
        service.from('ad_library_aliases').select('id, library_id, alias_name').range(from, to),
      ),
    ]),
  );
  const tagLookup = await tagsByLibraryId(
    service as unknown as Parameters<typeof tagsByLibraryId>[0],
    library.map((r) => r.id),
  );
  const resolver = new AdLibraryResolver(
    library.map((r) => ({ ...r, tags: tagLookup.data.get(r.id) ?? [] })),
    aliases,
  );

  // ── Group by library creative (aliases fold together) ─────────────────────
  const groups = new Map<string, Group>();
  const groupFor = (adName: string): Group => {
    const lib = resolver.resolve(adName);
    const key = lib ? `lib:${lib.id}` : `name:${adName.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: lib?.ad_name ?? adName,
        library: lib as Group['library'],
        variants: new Set(),
        campaigns: new Map(),
        spend_all: { spend: 0, impressions: 0, clicks: 0 },
        spend_conv: 0,
        spend_mature: 0,
        leads: [],
        months: new Map(),
      };
      groups.set(key, g);
    }
    g.variants.add(adName);
    return g;
  };

  const campaigns = new Map<string, { spend: number; impressions: number; clicks: number; ads: Set<string> }>();
  for (const m of meta) {
    const name = normalizeAdName(m.ad_name);
    const spend = num(m.spend);
    const camp = m.campaign_name?.trim() || '(no campaign name)';
    const c = campaigns.get(camp) ?? { spend: 0, impressions: 0, clicks: 0, ads: new Set<string>() };
    c.spend += spend;
    c.impressions += num(m.impressions);
    c.clicks += num(m.clicks);
    if (name) c.ads.add(name);
    campaigns.set(camp, c);
    if (!name) continue;
    const g = groupFor(name);
    g.spend_all.spend += spend;
    g.spend_all.impressions += num(m.impressions);
    g.spend_all.clicks += num(m.clicks);
    if (m.insight_date <= cut.conv) g.spend_conv += spend;
    if (m.insight_date <= cut.mature) g.spend_mature += spend;
    g.campaigns.set(camp, (g.campaigns.get(camp) ?? 0) + spend);
    const month = m.insight_date.slice(0, 7);
    const mo = g.months.get(month) ?? { spend: 0 };
    mo.spend += spend;
    g.months.set(month, mo);
  }

  const unattributed: Lead[] = [];
  for (const l of leads) {
    if (!l.ad) {
      unattributed.push(l);
      continue;
    }
    groupFor(l.ad).leads.push(l);
  }

  // ── Client totals and per-dollar rates for shrinkage ──────────────────────
  const allSpend = [...groups.values()].reduce(
    (acc, g) => ({
      spend: acc.spend + g.spend_all.spend,
      impressions: acc.impressions + g.spend_all.impressions,
      clicks: acc.clicks + g.spend_all.clicks,
    }),
    { spend: 0, impressions: 0, clicks: 0 },
  );
  const allConv = [...groups.values()].reduce((s, g) => s + g.spend_conv, 0);
  const allMature = [...groups.values()].reduce((s, g) => s + g.spend_mature, 0);
  const paidLeads = leads.filter((l) => l.ad);
  const clientStats = stageStats(paidLeads, allSpend, allConv, allMature, cut);
  const clientAllLeads = stageStats(leads, allSpend, allConv, allMature, cut);

  const perDollar: Record<RankStage, number | null> = {
    conversation: div(clientStats.conversation.weighted_conversations, allConv),
    proposal: div(clientStats.backend.proposals, allMature),
    submission: div(clientStats.backend.submissions, allMature),
    funded: div(clientStats.backend.funded, allMature),
  };

  type AdOut = {
    key: string;
    ad_name: string;
    supabase_ref: string | null;
    sourced: boolean;
    product: string | null;
    ad_format: string | null;
    library_status: string | null;
    /** TOF / MOFU / BOF. Retargeting reaches warmer people; rank within a stage. */
    funnel_stage: string | null;
    tags: { category: string; label: string }[];
    summary: string | null;
    visual_notes: string | null;
    variants: string[];
    campaigns: { campaign: string; spend: number | null }[];
    spend_share: number | null;
    evidence: Evidence;
    stats: StageStats;
    shrunk: Record<RankStage, number | null>;
    by_month: { month: string; spend: number | null; leads: number; weighted_conversations: number; proposals: number; funded: number }[];
  };

  const ads: AdOut[] = [...groups.values()]
    .filter((g) => g.spend_all.spend > 0 || g.leads.length > 0)
    .map((g) => {
      const stats = stageStats(g.leads, g.spend_all, g.spend_conv, g.spend_mature, cut);
      const shrunk = {} as Record<RankStage, number | null>;
      for (const stage of ['conversation', 'proposal', 'submission', 'funded'] as RankStage[]) {
        const { spend, count } = stageCount(stats, stage);
        shrunk[stage] = spend > 0 ? shrunkCost(spend, count, perDollar[stage]) : null;
      }
      const leadMonths = new Map<string, Lead[]>();
      for (const l of g.leads) {
        const k = l.date.slice(0, 7);
        leadMonths.set(k, [...(leadMonths.get(k) ?? []), l]);
      }
      const months = [...new Set([...g.months.keys(), ...leadMonths.keys()])].sort();
      return {
        key: g.key,
        ad_name: g.name,
        supabase_ref: g.library ? `supabase:ad:${g.library.id}` : null,
        sourced: g.library != null,
        product: g.library?.product ?? null,
        ad_format: g.library?.ad_format ?? null,
        library_status: g.library?.status ?? null,
        funnel_stage: funnelStage(g.name, g.library?.tags ?? []),
        tags: (g.library?.tags ?? []).map((t) => ({ category: t.category, label: t.label })),
        summary: trimText(g.library?.summary),
        visual_notes: trimText(g.library?.visual_notes),
        variants: [...g.variants].sort(),
        campaigns: [...g.campaigns.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([campaign, spend]) => ({ campaign, spend: round(spend) })),
        spend_share: pct(g.spend_all.spend, allSpend.spend),
        evidence: evidenceFor(stats, provisional),
        stats,
        shrunk,
        by_month: months.map((month) => {
          const ls = leadMonths.get(month) ?? [];
          return {
            month,
            spend: round(g.months.get(month)?.spend ?? 0),
            leads: ls.length,
            weighted_conversations: ls.filter((l) => l.conversation).reduce((s, l) => s + weightOf(l), 0),
            proposals: ls.filter((l) => l.proposal).length,
            funded: ls.filter((l) => l.funded).length,
          };
        }),
      };
    })
    .sort((a, b) => (b.stats.front.spend ?? 0) - (a.stats.front.spend ?? 0));

  // ── Ranking stage: deepest stage where 2+ graded ads clear it ─────────────
  const graded = ads.filter((a) => a.evidence.tier !== 'thin');
  const order: RankStage[] = ['funded', 'submission', 'proposal', 'conversation'];
  const depth = (s: RankStage | null) => (s ? order.length - order.indexOf(s) : 0);
  const rankStage =
    order.find((stage) => graded.filter((a) => depth(a.evidence.deepest_stage) >= depth(stage)).length >= 2) ?? null;
  const ranking = rankStage
    ? graded
        .filter((a) => depth(a.evidence.deepest_stage) >= depth(rankStage))
        .map((a) => ({
          ad_name: a.ad_name,
          supabase_ref: a.supabase_ref,
          funnel_stage: a.funnel_stage,
          rank_cost: a.shrunk[rankStage],
          raw_cost:
            rankStage === 'conversation'
              ? a.stats.conversation.cost_per_weighted_conversation
              : rankStage === 'proposal'
                ? a.stats.backend.proposal.cost
                : rankStage === 'submission'
                  ? a.stats.backend.submission.cost
                  : a.stats.backend.funded_cost.cost,
          cpl: a.stats.front.cpl,
          cpql: a.stats.front.cpql,
        }))
        .sort((a, b) => (a.rank_cost ?? Infinity) - (b.rank_cost ?? Infinity))
    : [];
  // Ads graded only at the conversation stage still get a conversation-stage rank.
  const conversationRanking = graded
    .map((a) => ({
      ad_name: a.ad_name,
      rank_cost: a.shrunk.conversation,
      raw_cost: a.stats.conversation.cost_per_weighted_conversation,
      cpconv_raw: a.stats.conversation.cpconv_raw,
      cpl: a.stats.front.cpl,
      cpql: a.stats.front.cpql,
    }))
    .sort((a, b) => (a.rank_cost ?? Infinity) - (b.rank_cost ?? Infinity));

  // Front end vs back end disagreement — the misread this skill exists to catch.
  const cplOrder = [...graded].sort((a, b) => (a.stats.front.cpl ?? Infinity) - (b.stats.front.cpl ?? Infinity));
  const disagreements = ranking.length >= 2
    ? ranking.map((r, i) => {
        const cplRank = cplOrder.findIndex((a) => a.ad_name === r.ad_name) + 1;
        return { ad_name: r.ad_name, downstream_rank: i + 1, cpl_rank: cplRank, gap: cplRank - (i + 1) };
      }).filter((d) => Math.abs(d.gap) >= 2)
    : [];

  // ── Stage owners: is the drop the same on every ad, or does it differ? ────
  type StageRate = { stage: string; owner: string; get: (s: StageStats) => [number, number] };
  const stageRates: StageRate[] = [
    { stage: 'click (CTR)', owner: 'ad', get: (s) => [s.front.clicks, s.front.impressions] },
    { stage: 'opt-in (leads ÷ clicks)', owner: 'landing page', get: (s) => [s.front.leads, s.front.clicks] },
    { stage: 'qualified rate', owner: 'ad (who it attracts)', get: (s) => [s.front.qualified, s.front.leads] },
    { stage: 'hot rate', owner: 'ad (who it attracts)', get: (s) => [s.front.hot, s.front.leads] },
    { stage: 'hand-raise rate', owner: 'setters', get: (s) => [s.conversation.hand_raises, s.conversation.pool_leads] },
    {
      stage: 'conversation → proposal',
      owner: "client's loan officer",
      get: (s) => [s.backend.proposals, s.backend.conversations],
    },
    {
      stage: 'proposal → submission',
      owner: "client's loan officer",
      get: (s) => [s.backend.submissions, s.backend.proposals],
    },
    { stage: 'submission → funded', owner: "client's loan officer / processing", get: (s) => [s.backend.funded, s.backend.submissions] },
  ];
  const stageDiagnosis = stageRates.map(({ stage, owner, get }) => {
    const [cx, cn] = get(clientStats);
    const perAd = graded
      .map((a) => {
        const [x, n] = get(a.stats);
        return { ad_name: a.ad_name, rate: pct(x, n), ci: wilson(x, n), n };
      })
      .filter((r) => r.n >= RATE_MIN_DENOM && r.ci);
    let differ = false;
    for (const a of perAd) for (const b of perAd) if (a.ci![1] < b.ci![0]) differ = true;
    const sorted = [...perAd].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
    return {
      stage,
      owner,
      client_rate: pct(cx, cn),
      client_ci: wilson(cx, cn),
      ads_compared: perAd.length,
      ads_differ: perAd.length >= 2 ? differ : null,
      worst: sorted[0] ?? null,
      best: sorted[sorted.length - 1] ?? null,
    };
  });

  // ── Same-product benchmark for the lead-table stages ──────────────────────
  const { data: peers, error: peerErr } = await service
    .from('clients')
    .select('id, name, reporting_type')
    .eq('is_live', true)
    .eq('reporting_type', client.reporting_type ?? '')
    .neq('id', client.id);
  if (peerErr) throw new Error(peerErr.message);
  const peerIds = (peers ?? []).map((p) => p.id as string);
  const benchStart = addDays(cut.mature, -365);
  const peerLeads = await step('peer leads', () =>
    inChunks(peerIds, 1, ([peerId]) =>
      fetchAll<Pick<LeadDbRow, 'client_id' | 'conversation_at' | 'proposal_at' | 'submission_at' | 'funded_at'>>(
        (from, to) =>
          service
            .from('leads')
            .select('client_id, conversation_at, proposal_at, submission_at, funded_at')
            .eq('client_id', peerId)
            .is('merged_into_id', null)
            .gte('first_seen_at', `${benchStart}T00:00:00Z`)
            .lte('first_seen_at', `${cut.mature}T23:59:59Z`)
            .order('first_seen_at')
            .order('id')
            .range(from, to),
      ),
    ),
  );
  const byPeer = new Map<string, { leads: number; conv: number; prop: number; sub: number; fund: number }>();
  for (const l of peerLeads) {
    const p = byPeer.get(l.client_id) ?? { leads: 0, conv: 0, prop: 0, sub: 0, fund: 0 };
    p.leads += 1;
    if (l.conversation_at) p.conv += 1;
    if (l.proposal_at || l.submission_at || l.funded_at) p.prop += 1;
    if (l.submission_at || l.funded_at) p.sub += 1;
    if (l.funded_at) p.fund += 1;
    byPeer.set(l.client_id, p);
  }
  type PeerAcc = { leads: number; conv: number; prop: number; sub: number; fund: number };
  const peerRows = [...byPeer.values()].filter((p) => p.leads >= 50);
  /**
   * A peer only counts toward a stage when its denominator is 5+ and it logs
   * the numerator at all. Many clients never log a proposal or submission, and
   * their 0% would read as a benchmark.
   */
  const benchRow = (stage: string, client: number | null, x: (p: PeerAcc) => number, n: (p: PeerAcc) => number) => {
    const used = peerRows.filter((p) => n(p) >= 5 && x(p) > 0);
    return {
      stage,
      client,
      peer_median: used.length >= 3 ? round(median(used.map((p) => (x(p) / n(p)) * 100)), 1) : null,
      peers_used: used.length,
    };
  };
  const cb = clientAllLeads.backend;
  const benchmark = {
    product: client.reporting_type,
    peer_clients: peerRows.length,
    window: { lead_start: benchStart, lead_end: cut.mature },
    note: 'Each stage uses only peers that log that stage. peer_median null = fewer than 3 peers log it; do not compare.',
    rows: [
      benchRow('lead → conversation', pct(cb.conversations, cb.leads), (p) => p.conv, (p) => p.leads),
      benchRow('conversation → proposal', cb.conversation_to_proposal, (p) => p.prop, (p) => p.conv),
      benchRow('proposal → submission', cb.proposal_to_submission, (p) => p.sub, (p) => p.prop),
      benchRow('submission → funded', cb.submission_to_funded, (p) => p.fund, (p) => p.sub),
      benchRow('lead → funded', cb.lead_to_funded, (p) => p.fund, (p) => p.leads),
    ],
  };

  // ── Angles: pool every ad (thin ones too) by tag and by format ────────────
  const pool = (keyOf: (a: AdOut) => string[]) => {
    const m = new Map<string, AdOut[]>();
    for (const a of ads) {
      if (!a.sourced) continue;
      for (const k of keyOf(a)) m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()]
      .map(([label, members]) => {
        const gs = members.map((a) => groups.get(a.key)!);
        const spend = gs.reduce(
          (acc, g) => ({
            spend: acc.spend + g.spend_all.spend,
            impressions: acc.impressions + g.spend_all.impressions,
            clicks: acc.clicks + g.spend_all.clicks,
          }),
          { spend: 0, impressions: 0, clicks: 0 },
        );
        const stats = stageStats(
          gs.flatMap((g) => g.leads),
          spend,
          gs.reduce((s, g) => s + g.spend_conv, 0),
          gs.reduce((s, g) => s + g.spend_mature, 0),
          cut,
        );
        const evidence = evidenceFor(stats, provisional);
        const { spend: stSpend, count } = stageCount(stats, evidence.deepest_stage ?? 'conversation');
        return {
          angle: label,
          ads: members.map((a) => a.ad_name),
          evidence,
          rank_cost_at_deepest_stage: stSpend > 0 ? shrunkCost(stSpend, count, perDollar[evidence.deepest_stage ?? 'conversation']) : null,
          spend: stats.front.spend,
          cpl: stats.front.cpl,
          cpql: stats.front.cpql,
          qualified_rate: stats.front.qualified_rate,
          hot_rate: stats.front.hot_rate,
          cost_per_weighted_conversation: stats.conversation.cost_per_weighted_conversation,
          hot_share_of_conversations: stats.conversation.hot_share_of_conversations,
          proposals: stats.backend.proposals,
          submissions: stats.backend.submissions,
          funded: stats.backend.funded,
          cost_per_proposal: stats.backend.proposal.cost,
          cost_per_funded: stats.backend.funded_cost.cost,
          conversation_to_proposal: stats.backend.conversation_to_proposal,
        };
      })
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  };

  const payload = {
    generated_at: new Date().toISOString(),
    client: {
      id: client.id,
      name: client.name,
      product: client.reporting_type,
      launch_date: client.launch_date,
      tenure_days: tenureDays,
      lifecycle_status: client.lifecycle_status,
      qualifies_leads: client.qualifies_leads,
      dial_pool: currentPool,
      dial_pool_switch: switchDate ? { date: switchDate, before: poolBefore } : null,
    },
    window: { start, end, conversation_cutoff: cut.conv, backend_cutoff: cut.mature, mature_days: matureDays },
    provisional,
    bars: {
      thin_spend: THIN_SPEND,
      conversation_min: CONV_MIN,
      backend_spend: provisional ? BACKEND_SPEND_PROVISIONAL : BACKEND_SPEND,
      backend_proposals: provisional ? BACKEND_PROPOSALS_PROVISIONAL : BACKEND_PROPOSALS,
      stage_count_min: STAGE_COUNT_MIN,
      prior_spend: PRIOR_SPEND,
      weights: { hot: HOT_WEIGHT, qualified: QUAL_WEIGHT, unqualified: 0 },
    },
    data_quality: {
      leads_in_window: leads.length,
      leads_without_ad: unattributed.length,
      leads_without_ad_pct: pct(unattributed.length, leads.length),
      leads_without_lead_event: leads.filter((l) => !tags.get(l.id)?.has_lead_event).length,
      funded_deals_without_lead: dealsWithoutLead,
      spend_without_leads: round(
        [...groups.values()].filter((g) => g.spend_all.spend > 0 && g.leads.length === 0).reduce((s, g) => s + g.spend_all.spend, 0),
      ),
      unsourced_spend: round(ads.filter((a) => !a.sourced).reduce((s, a) => s + (a.stats.front.spend ?? 0), 0)),
      unattributed_backend: {
        proposals: unattributed.filter((l) => l.proposal && l.date <= cut.mature).length,
        funded: unattributed.filter((l) => l.funded && l.date <= cut.mature).length,
      },
    },
    client_totals: { paid: clientStats, all_leads_backend: clientAllLeads.backend },
    benchmark,
    stage_diagnosis: stageDiagnosis,
    rank_stage: rankStage,
    ranking,
    conversation_ranking: conversationRanking,
    front_vs_back_disagreements: disagreements,
    spend_concentration: {
      top_ad_share: ads[0]?.spend_share ?? null,
      top3_share: pct(ads.slice(0, 3).reduce((s, a) => s + (a.stats.front.spend ?? 0), 0), allSpend.spend),
      ads_with_spend: ads.filter((a) => (a.stats.front.spend ?? 0) > 0).length,
    },
    campaigns: [...campaigns.entries()]
      .sort((a, b) => b[1].spend - a[1].spend)
      .map(([campaign, c]) => ({
        campaign,
        spend: round(c.spend),
        ctr: pct(c.clicks, c.impressions),
        ads: c.ads.size,
      })),
    angles: {
      by_tag: pool((a) => a.tags.map((t) => `${t.category}: ${t.label}`)),
      by_format: pool((a) => (a.ad_format ? [a.ad_format] : [])),
    },
    ads,
  };

  const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = resolve(tmpdir(), `client-ad-diagnosis_${slug}_${end}.json`);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${file}`);
  console.log(
    `${client.name} · ${client.reporting_type} · ${tenureDays ?? '?'} days live${provisional ? ' (provisional)' : ''} · ` +
      `${start}..${end} · back end on leads ≤ ${cut.mature}`,
  );
  console.log(
    `${ads.length} ads · ${graded.length} graded · spend $${round(allSpend.spend, 0)} · leads ${leads.length} ` +
      `(${unattributed.length} without ad) · rank stage ${rankStage ?? 'none'}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
