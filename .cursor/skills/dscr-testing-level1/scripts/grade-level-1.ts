/**
 * Testing-card grader for a Meta Ads Manager export.
 *
 * Rules are copied from docs/CREATIVE_TESTING.md (the ruling card).
 * Change the doc first, then this file. Do not invent a looser bar
 * here.
 *
 * The card, first match wins:
 *   1. Under 1,000 impressions ............ waiting
 *   2. Link CTR under 1.5% ................ kill (skipped on instant-form
 *      accounts, and skipped once the ad is already at the row-5 stop —
 *      a drifted CTR does not block a pass)
 *   3. Spend under $200 ................... spending (leave on)
 *   4. $200+ and 0–1 leads ................ off; shelf creative if CTR >= 1.5%
 *      ($500 with 0–1 leads is this row, not a grade)
 *   5. 10 leads, or $500 with 2+ leads .... off and grade: CPQL <= $65 and
 *      qualified rate >= 70% passes to Growth; anything else is off for good.
 *      Qualified rate >= 70% and CTR >= 1.5% that only missed the cost
 *      shelves the creative.
 *   (else: $200–$500 with 2–9 leads ....... spending)
 *
 *   npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts --file report.csv
 *   npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts --self-test
 */
import { readFileSync } from 'fs';

const FLOOR = 1000;
const KILL_CTR = 1.5;
const SPEND_MIN = 200;
const SPEND_MAX = 500;
const LEADS_DONE = 10;
const CPQL_MAX = 65;
const QUAL_RATE_MIN = 0.7;
const CLICK_TO_LEAD_LEAK = 0.06;
const HEALTHY_CTR = 2.0;
/** Spend past which this is probably not a testing ad set. Warning only. */
const PAST_SPEND = 750;

type BaselineSource = 'flag' | 'campaign_name' | 'missing';

type Verdict =
  | 'waiting'
  | 'kill'
  | 'spending'
  | 'off_no_leads'
  | 'pass'
  | 'off_graded'
  | 'needs_leads'
  | 'needs_qualified'
  | 'page_stop';

interface RawAd {
  campaign: string;
  adSet: string;
  adName: string;
  adId: string;
  impressions: number;
  linkClicks: number;
  spend: number;
  results: number | null;
  qualified: number | null;
  resultType: string | null;
}

interface GradedAd {
  ad_name: string;
  ad_id: string;
  impressions: number;
  link_clicks: number;
  spend: number;
  link_ctr_pct: number | null;
  leads: number | null;
  qualified: number | null;
  qualified_rate: number | null;
  cpql: number | null;
  rule: string;
  verdict: Verdict;
  shelf_creative: boolean;
  why: string;
  notes: string[];
}

interface Batch {
  campaign: string;
  ad_set: string;
  baseline_pct: number | null;
  baseline_source: BaselineSource;
  instant_form: boolean;
  page_leak: boolean;
  page_leak_reason: string | null;
  click_to_lead: number | null;
  warning: string | null;
  ads: GradedAd[];
  actions: {
    turn_off: string[];
    pass_to_growth: string[];
    shelf_creative: string[];
    spending: string[];
    waiting: string[];
    needs_leads: string[];
    needs_qualified: string[];
    page_stop: string[];
  };
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/[$,%]/g, '').replace(/,/g, '');
  if (t === '' || t === '-' || t === '—') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function readText(path: string): string {
  const buf = readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/** RFC 4180-ish. Meta exports quote fields that contain commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findHeader(rows: string[][]): { header: string[]; index: number } {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const header = rows[i].map(normHeader);
    const hasImpr = header.some((h) => h === 'impressions');
    const hasAd = header.some((h) => h === 'ad name' || h === 'ad id');
    if (hasImpr && hasAd) return { header, index: i };
  }
  throw new Error(
    'No header row with Impressions and Ad name (or Ad ID). Export an ad-level Ads Manager report.',
  );
}

function col(header: string[], ...names: string[]): number {
  for (const name of names) {
    const i = header.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

function cell(row: string[], i: number): string {
  if (i < 0 || i >= row.length) return '';
  return row[i] ?? '';
}

function isLeadResult(type: string | null): boolean {
  if (type == null || type.trim() === '') return true;
  return type.toLowerCase().includes('lead');
}

interface QualifiedRow {
  adId: string;
  adName: string;
  qualified: number;
}

function loadQualified(path: string): QualifiedRow[] {
  const rows = parseCsv(readText(path));
  const { header, index } = findLooseHeader(rows);
  const idI = col(header, 'ad id', 'ad_id');
  const nameI = col(header, 'ad name', 'ad_name');
  const qI = col(header, 'qualified', 'qualified leads', 'qualified_leads');
  if (qI < 0 || (idI < 0 && nameI < 0)) {
    throw new Error(
      'Qualified file needs a qualified column and an ad id or ad name column.',
    );
  }
  const out: QualifiedRow[] = [];
  for (const row of rows.slice(index + 1)) {
    const q = parseNumber(cell(row, qI));
    if (q == null) continue;
    out.push({
      adId: cell(row, idI).trim(),
      adName: cell(row, nameI).trim().toLowerCase(),
      qualified: q,
    });
  }
  return out;
}

function findLooseHeader(rows: string[][]): { header: string[]; index: number } {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const header = rows[i].map(normHeader);
    if (header.some((h) => h.includes('qualified') || h === 'ad name' || h === 'ad id')) {
      return { header, index: i };
    }
  }
  throw new Error('Qualified file has no header row.');
}

function attachQualified(ads: RawAd[], extra: QualifiedRow[]): void {
  for (const ad of ads) {
    if (ad.qualified != null) continue;
    const hit = extra.find(
      (q) =>
        (q.adId !== '' && q.adId === ad.adId) ||
        (q.adName !== '' && q.adName === ad.adName.trim().toLowerCase()),
    );
    if (hit) ad.qualified = hit.qualified;
  }
}

export function adsFromCsv(text: string): RawAd[] {
  const rows = parseCsv(text);
  const { header, index } = findHeader(rows);
  const iCampaign = col(header, 'campaign name');
  const iAdSet = col(header, 'ad set name');
  const iName = col(header, 'ad name');
  const iId = col(header, 'ad id');
  const iImpr = col(header, 'impressions');
  const iLinks = col(header, 'link clicks');
  const iSpend = header.findIndex((h) => h.startsWith('amount spent'));
  const iResults = col(header, 'results');
  const iResultType = col(header, 'result type');
  const iQualified = col(header, 'qualified', 'qualified leads');

  if (iImpr < 0 || iLinks < 0 || iSpend < 0) {
    throw new Error(
      'Export must include Impressions, Link clicks, and Amount spent. Link CTR is computed from those. CTR (all) is not a substitute.',
    );
  }

  type Acc = RawAd & { resultTypes: Set<string>; sawResult: boolean };
  const grouped = new Map<string, Acc>();

  for (const row of rows.slice(index + 1)) {
    const adName = cell(row, iName).trim();
    const adId = cell(row, iId).trim();
    if (adName === '' && adId === '') continue;

    const impressions = parseNumber(cell(row, iImpr)) ?? 0;
    const linkClicks = parseNumber(cell(row, iLinks)) ?? 0;
    const spend = parseNumber(cell(row, iSpend)) ?? 0;
    const resultType = cell(row, iResultType).trim();
    const resultNum = parseNumber(cell(row, iResults));
    const qualified = parseNumber(cell(row, iQualified));

    const key = `${cell(row, iCampaign).trim()}||${cell(row, iAdSet).trim()}||${adId || adName}`;
    let acc = grouped.get(key);
    if (!acc) {
      acc = {
        campaign: cell(row, iCampaign).trim(),
        adSet: cell(row, iAdSet).trim(),
        adName: adName || adId,
        adId,
        impressions: 0,
        linkClicks: 0,
        spend: 0,
        results: null,
        qualified: null,
        resultType: null,
        resultTypes: new Set<string>(),
        sawResult: false,
      };
      grouped.set(key, acc);
    }
    acc.impressions += impressions;
    acc.linkClicks += linkClicks;
    acc.spend += spend;
    if (resultType) acc.resultTypes.add(resultType.toLowerCase());
    if (resultNum != null && isLeadResult(resultType || null)) {
      acc.results = (acc.results ?? 0) + resultNum;
      acc.sawResult = true;
    }
    if (qualified != null) acc.qualified = (acc.qualified ?? 0) + qualified;
  }

  return [...grouped.values()].map((acc) => {
    const types = [...acc.resultTypes];
    let results = acc.results;
    let resultType: string | null = types.length ? types.join(', ') : null;
    if (types.length > 1 || (types.length === 1 && !isLeadResult(types[0]))) {
      results = null;
      resultType = types.join(', ') || null;
    }
    if (!acc.sawResult) results = null;
    return {
      campaign: acc.campaign,
      adSet: acc.adSet,
      adName: acc.adName,
      adId: acc.adId,
      impressions: acc.impressions,
      linkClicks: acc.linkClicks,
      spend: acc.spend,
      results,
      qualified: acc.qualified,
      resultType,
    };
  });
}

function linkCtr(ad: RawAd): number | null {
  if (ad.impressions <= 0) return null;
  return (ad.linkClicks / ad.impressions) * 100;
}

function parseBaselineFromName(campaign: string): number | null {
  const m = campaign.match(
    /(?:baseline|link\s*ctr|bctr)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i,
  );
  if (!m) return null;
  return Number(m[1]);
}

interface RuleHit {
  verdict: Verdict;
  rule: string;
  shelf: boolean;
  why: string;
}

/**
 * The ruling card. First matching row wins.
 * `results` null means the export did not say, which is not zero.
 */
export function gradeCard(ad: RawAd, instantForm: boolean): RuleHit {
  const ctr = linkCtr(ad);

  // Row 1 — under the floor.
  if (ad.impressions < FLOOR) {
    return {
      verdict: 'waiting',
      rule: 'row-1',
      shelf: false,
      why: `${ad.impressions} impressions. Under 1,000. Waiting, not failing.`,
    };
  }

  const leads = ad.results;
  // Row 5 is read before the click kill. A link CTR that drifted under
  // 1.5% after the ad reached 10 leads, or $500 with 2+ leads, does not
  // block the grade. $500 with 0–1 leads is row 4, so it is not a stop.
  const atGradeStop =
    leads != null && leads >= 2 && (leads >= LEADS_DONE || ad.spend >= SPEND_MAX);
  if (atGradeStop) return gradeAtStop(ad, ctr, leads);

  // Row 2 — the click kill. Skipped on instant-form accounts.
  if (!instantForm && ctr != null && ctr < KILL_CTR) {
    return {
      verdict: 'kill',
      rule: 'row-2',
      shelf: false,
      why: `Link CTR ${round2(ctr)}% is under 1.5%. Turn it off.`,
    };
  }

  // Row 3 — buying its lead sample.
  if (ad.spend < SPEND_MIN) {
    return {
      verdict: 'spending',
      rule: 'row-3',
      shelf: false,
      why: `$${round2(ad.spend)} spent is under $200. Leave it on. One expensive lead is not a cost.`,
    };
  }

  if (leads == null) {
    return {
      verdict: 'needs_leads',
      rule: 'needs-leads',
      shelf: false,
      why: `$${round2(ad.spend)} spent, but the export has no usable lead count (Results missing or not a lead type). Rows 4 and 5 cannot be read.`,
    };
  }

  // Row 4 — spend with nothing behind it. Includes $500 with 0–1 leads.
  if (leads <= 1) {
    const shelf = ctr != null && ctr >= KILL_CTR;
    return {
      verdict: 'off_no_leads',
      rule: 'row-4',
      shelf,
      why:
        `$${round2(ad.spend)} spent with ${leads} lead${leads === 1 ? '' : 's'}. Turn it off.` +
        (shelf
          ? ` Link CTR ${round2(ctr!)}% is still 1.5%+, so the page missed, not the ad. Shelf the creative.`
          : ''),
    };
  }

  // No row matched: $200–$500 with 2–9 leads.
  return {
    verdict: 'spending',
    rule: 'between',
    shelf: false,
    why: `$${round2(ad.spend)} with ${leads} leads. Between the stops. Leave it on.`,
  };
}

/** Row 5. The ad is already off; this only decides pass, shelf, or done. */
function gradeAtStop(ad: RawAd, ctr: number | null, leads: number): RuleHit {
  if (ad.qualified == null) {
    return {
      verdict: 'needs_qualified',
      rule: 'row-5',
      shelf: false,
      why: `At a stop (${leads} leads, $${round2(ad.spend)}). Grade needs the qualified count from the pipeline. Turn it off, then grade.`,
    };
  }
  const qualRate = leads > 0 ? ad.qualified / leads : 0;
  const cpql = ad.qualified > 0 ? ad.spend / ad.qualified : null;
  if (cpql != null && cpql <= CPQL_MAX && qualRate >= QUAL_RATE_MIN) {
    return {
      verdict: 'pass',
      rule: 'row-5',
      shelf: false,
      why: `CPQL $${round2(cpql)} is $65 or under and the qualified rate is ${Math.round(qualRate * 100)}%. Duplicate into Growth, publish it, then turn this copy off.`,
    };
  }
  const shelf = qualRate >= QUAL_RATE_MIN && ctr != null && ctr >= KILL_CTR;
  const bits: string[] = [];
  if (cpql == null) bits.push('no qualified leads');
  else if (cpql > CPQL_MAX) bits.push(`CPQL $${round2(cpql)} is over $65`);
  if (qualRate < QUAL_RATE_MIN)
    bits.push(`qualified rate ${Math.round(qualRate * 100)}% is under 70%`);
  return {
    verdict: 'off_graded',
    rule: 'row-5',
    shelf,
    why:
      `Graded at the stop: ${bits.join('; ')}. Turn it off for good.` +
      (shelf
        ? ' Qualified rate held and the click held, so the page made the lead expensive. Shelf the creative for a later page test.'
        : ''),
  };
}

function notesFor(ad: RawAd, hit: RuleHit): string[] {
  const notes: string[] = [];
  if (hit.verdict === 'kill' && ad.qualified != null && ad.qualified > 0) {
    notes.push(
      `This ad has ${ad.qualified} qualified lead${ad.qualified === 1 ? '' : 's'}. The card still says off: there is no lead veto at the click kill.`,
    );
  }
  if (ad.spend > PAST_SPEND) {
    notes.push(
      `$${round2(ad.spend)} spent is past the $500 testing ceiling. Confirm this is a testing ad set and not Growth before acting.`,
    );
  }
  if (ad.resultType && !isLeadResult(ad.resultType)) {
    notes.push(`Results column is "${ad.resultType}", not leads, so it was ignored.`);
  }
  return notes;
}

function gradeBatch(
  rawAds: RawAd[],
  baselinePct: number | null,
  baselineSource: BaselineSource,
): Batch {
  const campaign = rawAds[0]?.campaign ?? '';
  const adSet = rawAds[0]?.adSet ?? '';
  const instant = baselinePct != null && baselinePct < KILL_CTR;

  const graded: GradedAd[] = rawAds.map((ad) => {
    const ctr = linkCtr(ad);
    const hit = gradeCard(ad, instant);
    const leads = ad.results;
    const qualRate =
      leads != null && leads > 0 && ad.qualified != null
        ? round2(ad.qualified / leads)
        : null;
    return {
      ad_name: ad.adName,
      ad_id: ad.adId,
      impressions: ad.impressions,
      link_clicks: ad.linkClicks,
      spend: round2(ad.spend),
      link_ctr_pct: ctr == null ? null : round2(ctr),
      leads,
      qualified: ad.qualified,
      qualified_rate: qualRate,
      cpql:
        ad.qualified != null && ad.qualified > 0
          ? round2(ad.spend / ad.qualified)
          : null,
      rule: hit.rule,
      verdict: hit.verdict,
      shelf_creative: hit.shelf,
      why: hit.why,
      notes: notesFor(ad, hit),
    };
  });

  // Page check: survivors mostly healthy on clicks, batch not converting.
  let pageLeak = false;
  let pageLeakReason: string | null = null;
  if (!instant) {
    const inWindow = graded.filter((g) => g.impressions >= FLOOR);
    const survivors = inWindow.filter((g) => g.verdict !== 'kill');
    const known = inWindow.every((g) => g.leads !== null);
    const clicks = inWindow.reduce((s, g) => s + g.link_clicks, 0);
    const leads = inWindow.reduce((s, g) => s + (g.leads ?? 0), 0);
    const healthy = survivors.filter(
      (g) => (g.link_ctr_pct ?? 0) >= HEALTHY_CTR,
    ).length;
    if (
      survivors.length >= 2 &&
      known &&
      clicks > 0 &&
      leads / clicks < CLICK_TO_LEAD_LEAK &&
      healthy * 2 > survivors.length
    ) {
      pageLeak = true;
      const pct = round2((leads / clicks) * 100);
      pageLeakReason = `${healthy} of ${survivors.length} surviving ads are at 2.0%+ link CTR and batch click-to-lead is ${pct}% (under 6%). Stop. Fix the page, form, or pixel, then re-run these ads. Do not pass or kill on creative.`;
      for (const g of inWindow) {
        g.verdict = 'page_stop';
        g.rule = 'page';
        g.shelf_creative = false;
        g.why = pageLeakReason;
      }
    }
  }

  const names = (v: Verdict) =>
    graded.filter((g) => g.verdict === v).map((g) => g.ad_name);

  const warning =
    rawAds.length > 12
      ? 'This ad set has more than 12 ads. A batch is 3–5 ads in its own ad set. Confirm this is a testing ad set before acting.'
      : null;

  const clickToLead = (() => {
    const inWindow = graded.filter((g) => g.impressions >= FLOOR);
    if (inWindow.some((g) => g.leads == null)) return null;
    const clicks = inWindow.reduce((s, g) => s + g.link_clicks, 0);
    const leads = inWindow.reduce((s, g) => s + (g.leads ?? 0), 0);
    if (clicks <= 0) return null;
    return round2(leads / clicks);
  })();

  return {
    campaign,
    ad_set: adSet,
    baseline_pct: baselinePct == null ? null : round2(baselinePct),
    baseline_source: baselineSource,
    instant_form: instant,
    page_leak: pageLeak,
    page_leak_reason: pageLeakReason,
    click_to_lead: clickToLead,
    warning,
    ads: graded.sort((a, b) => b.spend - a.spend),
    actions: {
      turn_off: [
        ...names('kill'),
        ...names('off_no_leads'),
        ...names('off_graded'),
      ],
      pass_to_growth: names('pass'),
      shelf_creative: graded
        .filter((g) => g.shelf_creative)
        .map((g) => g.ad_name),
      spending: names('spending'),
      waiting: names('waiting'),
      needs_leads: names('needs_leads'),
      needs_qualified: names('needs_qualified'),
      page_stop: names('page_stop'),
    },
  };
}

export function gradeAds(
  rawAds: RawAd[],
  opts: { baseline: number | null },
): Batch[] {
  const groups = new Map<string, RawAd[]>();
  for (const ad of rawAds) {
    const key = `${ad.campaign}||${ad.adSet}`;
    const list = groups.get(key) ?? [];
    list.push(ad);
    groups.set(key, list);
  }

  return [...groups.values()].map((ads) => {
    let baseline = opts.baseline;
    let source: BaselineSource = baseline != null ? 'flag' : 'missing';
    if (baseline == null) {
      const fromName = parseBaselineFromName(ads[0]?.campaign ?? '');
      if (fromName != null) {
        baseline = fromName;
        source = 'campaign_name';
      }
    }
    return gradeBatch(ads, baseline, source);
  });
}

function assert(cond: boolean, message: string, failures: string[]): void {
  if (!cond) failures.push(message);
}

function ad(
  partial: Partial<RawAd> &
    Pick<RawAd, 'adName' | 'impressions' | 'linkClicks' | 'spend'>,
): RawAd {
  return {
    campaign: partial.campaign ?? 'Test | baseline 2.00%',
    adSet: partial.adSet ?? 'Batch',
    adName: partial.adName,
    adId: partial.adId ?? partial.adName,
    impressions: partial.impressions,
    linkClicks: partial.linkClicks,
    spend: partial.spend,
    results: partial.results === undefined ? 2 : partial.results,
    qualified: partial.qualified === undefined ? 0 : partial.qualified,
    resultType: partial.resultType ?? null,
  };
}

function verdictOf(batches: Batch[], name: string): GradedAd {
  for (const b of batches) {
    const hit = b.ads.find((a) => a.ad_name === name);
    if (hit) return hit;
  }
  throw new Error(`missing ad ${name}`);
}

export function selfTest(): string[] {
  const failures: string[] = [];

  const card = gradeAds(
    [
      // Row 1: under the floor.
      ad({ adName: 'wait', impressions: 800, linkClicks: 20, spend: 80 }),
      // Row 2: click kill, even with a qualified lead (no veto).
      ad({ adName: 'killctr', impressions: 1100, linkClicks: 10, spend: 121, qualified: 1 }),
      // Row 3: past the floor, healthy click, still buying its sample.
      ad({ adName: 'sample', impressions: 1600, linkClicks: 28, spend: 150, results: 2 }),
      // Row 4: $200+ and one lead, click held -> shelf.
      ad({ adName: 'pagemiss', impressions: 2000, linkClicks: 40, spend: 240, results: 1 }),
      // Row 4: $200+ and zero leads, click still 1.54% -> shelf.
      ad({ adName: 'nothing', impressions: 2600, linkClicks: 40, spend: 260, results: 0 }),
      // Between the stops: leave on.
      ad({ adName: 'midband', impressions: 2500, linkClicks: 50, spend: 300, results: 5, qualified: 4 }),
    ],
    { baseline: 2 },
  );
  assert(verdictOf(card, 'wait').verdict === 'waiting', 'under 1,000 waits', failures);
  assert(verdictOf(card, 'killctr').verdict === 'kill', '0.9% kills', failures);
  assert(
    verdictOf(card, 'killctr').notes.some((n) => n.includes('no lead veto')),
    'kill with a qualified lead carries the no-veto note',
    failures,
  );
  assert(verdictOf(card, 'sample').verdict === 'spending', 'under $200 leaves on', failures);
  const pagemiss = verdictOf(card, 'pagemiss');
  assert(pagemiss.verdict === 'off_no_leads' && pagemiss.shelf_creative, '1 lead at $240 with 2% CTR is off and shelved', failures);
  const nothing = verdictOf(card, 'nothing');
  assert(nothing.verdict === 'off_no_leads' && nothing.shelf_creative, '1.54% CTR still shelves at row 4', failures);
  assert(verdictOf(card, 'midband').verdict === 'spending', '$300 with 5 leads is between the stops', failures);

  const stops = gradeAds(
    [
      // Pass: 10 leads, 8 qualified (80%), CPQL $56.25.
      ad({ adName: 'winner', impressions: 4000, linkClicks: 70, spend: 450, results: 10, qualified: 8 }),
      // Fail on rate: 10 leads, 6 qualified (60%), cheap.
      ad({ adName: 'lowqual', impressions: 4000, linkClicks: 70, spend: 300, results: 10, qualified: 6 }),
      // Fail on cost at $500 ceiling: 6 leads, 5 qualified (83%), CPQL $100 -> shelf.
      ad({ adName: 'pricey', impressions: 4500, linkClicks: 80, spend: 500, results: 6, qualified: 5 }),
      // At a stop with no qualified data.
      ad({ adName: 'blind', impressions: 4000, linkClicks: 70, spend: 520, results: 8, qualified: null }),
    ],
    { baseline: 2 },
  );
  assert(verdictOf(stops, 'winner').verdict === 'pass', '80% at $56 CPQL passes to Growth', failures);
  assert(verdictOf(stops, 'lowqual').verdict === 'off_graded', '60% qualified rate fails', failures);
  const drifted = gradeAds(
    [
      // Row 5 pass even though link CTR has drifted to 1.25%.
      ad({ adName: 'driftpass', impressions: 4000, linkClicks: 50, spend: 450, results: 10, qualified: 8 }),
      // $500 with one lead is row 4, not a grade.
      ad({ adName: 'ceiling', impressions: 5000, linkClicks: 100, spend: 500, results: 1, qualified: 1 }),
    ],
    { baseline: 2 },
  );
  assert(verdictOf(drifted, 'driftpass').verdict === 'pass', 'a drifted link CTR does not block a row-5 pass', failures);
  assert(verdictOf(drifted, 'ceiling').verdict === 'off_no_leads', '$500 with one lead is row 4', failures);
  const pricey = verdictOf(stops, 'pricey');
  assert(pricey.verdict === 'off_graded' && pricey.shelf_creative, 'good rate, missed cost shelves the creative', failures);
  assert(verdictOf(stops, 'blind').verdict === 'needs_qualified', 'a stop without qualified data asks for it', failures);

  const leak = gradeAds(
    [
      ...[1, 2, 3].map((n) =>
        ad({
          adName: `dry${n}`,
          impressions: 1200,
          linkClicks: 30,
          spend: 150,
          results: 1,
          qualified: 0,
        }),
      ),
      ad({
        adName: 'weakclick',
        impressions: 1200,
        linkClicks: 10,
        spend: 140,
        results: 0,
        qualified: 0,
      }),
    ],
    { baseline: 2 },
  );
  assert(leak[0].page_leak, 'high CTR and click-to-lead under 6% stops the batch', failures);
  assert(leak[0].actions.page_stop.length === 4, 'page leak holds the batch, including the click kill', failures);
  assert(leak[0].actions.turn_off.length === 0, 'page leak turns nothing off on creative', failures);
  assert(leak[0].actions.pass_to_growth.length === 0, 'page leak passes nothing', failures);

  const instant = gradeAds(
    [ad({ adName: 'form', campaign: 'IF | baseline 1.11%', impressions: 1500, linkClicks: 15, spend: 150, results: 3 })],
    { baseline: null },
  );
  assert(instant[0].instant_form, 'baseline under 1.5% flags instant form', failures);
  assert(verdictOf(instant, 'form').verdict === 'spending', 'instant form skips the click kill, spend rows still run', failures);
  const instantOff = gradeAds(
    [
      ad({
        adName: 'formdry',
        campaign: 'IF | baseline 1.11%',
        impressions: 2600,
        linkClicks: 30,
        spend: 260,
        results: 0,
      }),
    ],
    { baseline: null },
  );
  const formdry = verdictOf(instantOff, 'formdry');
  assert(
    formdry.verdict === 'off_no_leads' && !formdry.shelf_creative,
    'instant form at row 4 with CTR under 1.5% is off and not shelved',
    failures,
  );

  const noLeads = gradeAds(
    [ad({ adName: 'noresults', campaign: 'X', impressions: 2000, linkClicks: 40, spend: 300, results: null })],
    { baseline: null },
  );
  assert(verdictOf(noLeads, 'noresults').verdict === 'needs_leads', 'missing Results past $200 asks for data', failures);

  const csv = `Campaign name,Ad set name,Ad name,Ad ID,Day,Impressions,Link clicks,Amount spent (USD),CTR (all),Results,Result type
Totals,,,,,1200,12,120,4.00%,,
"Test, baseline 2.00%",Set,Ad A,111,2026-10-01,600,6,60,4.00%,1,lead
"Test, baseline 2.00%",Set,Ad A,111,2026-10-02,600,6,60,4.00%,0,lead
`;
  const fromCsv = gradeAds(adsFromCsv(csv), { baseline: null });
  assert(fromCsv.length === 1, 'totals row is dropped and days collapse to one batch', failures);
  assert(fromCsv[0].ads.length === 1, 'two days are one ad', failures);
  const summed = fromCsv[0].ads[0];
  assert(summed.impressions === 1200 && summed.link_clicks === 12, 'days are summed', failures);
  assert(summed.verdict === 'kill', 'link CTR is clicks ÷ impressions, not CTR (all)', failures);
  assert(summed.link_ctr_pct === 1, `expected 1% link CTR, got ${summed.link_ctr_pct}`, failures);
  assert(fromCsv[0].baseline_source === 'campaign_name', 'baseline parsed inside a quoted campaign name', failures);

  const bigId = adsFromCsv(
    'Ad name,Ad ID,Impressions,Link clicks,Amount spent (USD)\nKeep,120240949772070364,100,2,10\n',
  );
  assert(bigId[0].adId === '120240949772070364', 'ad id stays a string', failures);

  return failures;
}

function main(): void {
  if (hasFlag('--self-test')) {
    const failures = selfTest();
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exit(2);
    }
    console.log('ok');
    return;
  }

  const file = arg('--file');
  if (!file) {
    console.error('Pass --file path.csv or --self-test');
    process.exit(1);
  }

  const baselineRaw = arg('--baseline');
  const baseline = baselineRaw == null ? null : parseNumber(baselineRaw.replace('%', ''));
  if (baselineRaw != null && (baseline == null || baseline <= 0 || baseline >= 100)) {
    console.error('--baseline is a percent, like 2.1 or 2.10%');
    process.exit(1);
  }

  const text = readText(file);
  const ads = adsFromCsv(text);
  const qualifiedPath = arg('--qualified');
  if (qualifiedPath) attachQualified(ads, loadQualified(qualifiedPath));

  const batches = gradeAds(ads, { baseline });

  console.log(
    JSON.stringify(
      {
        source: 'docs/CREATIVE_TESTING.md',
        file,
        ad_count: ads.length,
        batches,
      },
      null,
      2,
    ),
  );
}

const invokedDirectly = process.argv[1]?.includes('grade-level-1');
if (invokedDirectly) main();
