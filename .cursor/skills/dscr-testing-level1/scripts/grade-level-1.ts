/**
 * Level 1 creative-test grader for a Meta Ads Manager export.
 *
 * Rules are copied from docs/CREATIVE_TESTING.md (Stage 1) and the
 * Gate 1 tables in docs/AD_TESTING_RULEBOOK.md. Change the doc first,
 * then this file. Do not invent a looser bar here.
 *
 * CPQL_MAX is the 2,000-impression rescue only. It is not the general
 * $50 CPL standard and not the Stage 2 $80 hot exception.
 *
 *   npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts --file report.csv --baseline 2.1
 *   npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts --self-test
 */
import { readFileSync } from 'fs';

const FLOOR = 1000;
const FINAL = 2000;
/** Hourly turn-off rules overshoot. Past this, the ad is no longer a Level 1 read. */
const PAST = 2500;
const KILL_CTR = 1.5;
const PROMOTE_CTR = 2.0;
const GOOD_CTR = 2.2;
const CPM_LOW = 90;
const CPM_HIGH = 190;
const CPQL_MAX = 65;
const RESCUE_QUALIFIED = 5;
const CLICK_TO_LEAD_LEAK = 0.06;
const MAX_GRADUATE = 3;
const CPC_PAUSE = 10;

type BaselineSource = 'flag' | 'campaign_name' | 'new_account_median' | 'missing';

type Verdict =
  | 'waiting'
  | 'extend'
  | 'graduate'
  | 'kill'
  | 'held'
  | 'page_stop'
  | 'needs_baseline'
  | 'past_level_1'
  | 'ungraded';

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
  hookPlays: number | null;
  resultType: string | null;
}

interface GradedAd {
  ad_name: string;
  ad_id: string;
  impressions: number;
  link_clicks: number;
  spend: number;
  link_ctr_pct: number | null;
  cpm: number | null;
  cpc: number | null;
  results: number | null;
  qualified: number | null;
  cpql: number | null;
  stage: 'waiting' | 'floor' | 'final' | 'past';
  verdict: Verdict;
  rule: string;
  why: string;
  would_have_been: Verdict | null;
  notes: string[];
  priority: number | null;
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
    graduate: string[];
    held: string[];
    turn_off: string[];
    confirm_before_kill: string[];
    extend: string[];
    waiting: string[];
    needs_baseline: string[];
    past_level_1: string[];
    ungraded: string[];
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
  const iHook = col(
    header,
    '3-second video plays',
    '3-second video plays (view)',
    'video plays',
  );

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
    const hook = parseNumber(cell(row, iHook));

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
        hookPlays: null,
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
    if (hook != null) acc.hookPlays = (acc.hookPlays ?? 0) + hook;
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
      hookPlays: acc.hookPlays,
      resultType,
    };
  });
}

function linkCtr(ad: RawAd): number | null {
  if (ad.impressions <= 0) return null;
  return (ad.linkClicks / ad.impressions) * 100;
}

function cpmOf(ad: RawAd): number | null {
  if (ad.impressions <= 0) return null;
  return (ad.spend / ad.impressions) * 1000;
}

function cpcOf(ad: RawAd): number | null {
  if (ad.linkClicks <= 0) return null;
  return ad.spend / ad.linkClicks;
}

function stageOf(impr: number): GradedAd['stage'] {
  if (impr < FLOOR) return 'waiting';
  if (impr < FINAL) return 'floor';
  if (impr <= PAST) return 'final';
  return 'past';
}

function parseBaselineFromName(campaign: string): number | null {
  const m = campaign.match(
    /(?:baseline|link\s*ctr|bctr)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i,
  );
  if (!m) return null;
  return Number(m[1]);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

interface RuleHit {
  verdict: Verdict;
  rule: string;
  why: string;
}

function inPromoteBand(ctr: number, cpm: number, baseline: number): boolean {
  return ctr >= PROMOTE_CTR && ctr >= baseline && cpm >= CPM_LOW && cpm <= CPM_HIGH;
}

/**
 * First matching row wins. Mirrors the buyer sheet.
 * `results` null means the export did not say, which is not the same as zero.
 */
export function gradeWindow(
  ad: RawAd,
  stage: 'floor' | 'final',
  baseline: number | null,
  isBest: boolean,
): RuleHit {
  const ctr = linkCtr(ad);
  const cpm = cpmOf(ad);
  if (ctr == null || cpm == null) {
    return {
      verdict: 'needs_baseline',
      rule: 'missing-metrics',
      why: 'Impressions, link clicks, or spend were missing after the rows were added up.',
    };
  }

  const clears =
    baseline != null && inPromoteBand(ctr, cpm, baseline);

  if (stage === 'floor') {
    if (isBest && ctr >= PROMOTE_CTR && ad.results === 0 && !(ad.qualified != null && ad.qualified >= 1)) {
      return {
        verdict: 'extend',
        rule: 'floor-1',
        why: `Best link CTR in the batch (${round2(ctr)}%) is at or above 2.0% and the export shows zero leads. Leave it on to 2,000. This is a page check, not a promotion.`,
      };
    }

    const failsRow3 = baseline == null ? ctr < PROMOTE_CTR || cpm < CPM_LOW || cpm > CPM_HIGH : !clears;
    if (failsRow3 && ad.qualified != null && ad.qualified >= 1) {
      return {
        verdict: 'extend',
        rule: 'floor-2',
        why: `${ad.qualified} qualified lead${ad.qualified === 1 ? '' : 's'} stops a kill. One more run to 2,000. A lead does not promote it.`,
      };
    }

    if (baseline == null && ctr >= PROMOTE_CTR && cpm >= CPM_LOW && cpm <= CPM_HIGH) {
      return {
        verdict: 'needs_baseline',
        rule: 'floor-baseline',
        why: `Link CTR ${round2(ctr)}% and CPM $${round2(cpm)} would graduate if this account's trailing link CTR is ${round2(ctr)}% or lower. The campaign name has no baseline.`,
      };
    }

    if (clears && baseline != null) {
      const good = ctr >= GOOD_CTR ? ' 2.2% or better, so it goes first if several graduate.' : '';
      return {
        verdict: 'graduate',
        rule: 'floor-3',
        why: `Link CTR ${round2(ctr)}% clears 2.0% and the ${round2(baseline)}% account baseline. CPM $${round2(cpm)} is inside $90–$190.${good}`,
      };
    }

    const middle = ctr >= KILL_CTR && ctr < PROMOTE_CTR;
    const underBaseline =
      baseline != null && ctr >= PROMOTE_CTR && ctr < baseline;
    const cheap = cpm < CPM_LOW;
    if (middle || underBaseline || cheap) {
      const bits: string[] = [];
      if (middle) bits.push(`link CTR ${round2(ctr)}% is in the 1.5–2.0% band`);
      if (underBaseline) bits.push(`link CTR ${round2(ctr)}% is under the ${round2(baseline!)}% baseline`);
      if (cheap) bits.push(`CPM $${round2(cpm)} is under $90 (cheap inventory, not a win)`);
      return {
        verdict: 'extend',
        rule: 'floor-4',
        why: `Leave it on to 2,000. ${bits.join('; ')}.`,
      };
    }

    if (ctr < KILL_CTR || cpm > CPM_HIGH) {
      const why =
        ctr < KILL_CTR
          ? `Link CTR ${round2(ctr)}% is under 1.5%.`
          : `CPM $${round2(cpm)} is over $190.`;
      return { verdict: 'kill', rule: 'floor-5', why: `${why} Turn it off.` };
    }

    return {
      verdict: 'kill',
      rule: 'floor-5',
      why: `Link CTR ${round2(ctr)}% and CPM $${round2(cpm)} did not clear a graduate or extend row.`,
    };
  }

  if (baseline != null && clears) {
    const good = ctr >= GOOD_CTR ? ' 2.2% or better, so it goes first if several graduate.' : '';
    return {
      verdict: 'graduate',
      rule: 'final-1',
      why: `At 2,000 impressions, link CTR ${round2(ctr)}% clears 2.0% and the ${round2(baseline)}% baseline. CPM $${round2(cpm)} is inside $90–$190.${good}`,
    };
  }

  if (baseline == null && ctr >= PROMOTE_CTR && cpm >= CPM_LOW && cpm <= CPM_HIGH) {
    return {
      verdict: 'needs_baseline',
      rule: 'final-baseline',
      why: `Link CTR ${round2(ctr)}% and CPM $${round2(cpm)} would graduate if the account baseline is ${round2(ctr)}% or lower.`,
    };
  }

  if (ad.qualified != null && ad.qualified >= RESCUE_QUALIFIED) {
    const cpql = ad.spend / ad.qualified;
    if (cpql <= CPQL_MAX) {
      return {
        verdict: 'graduate',
        rule: 'final-2',
        why: `${ad.qualified} qualified leads at CPQL $${round2(cpql)} (bar is $65). This is the only Level 1 promotion that ignores link CTR and CPM.`,
      };
    }
  }

  const bits: string[] = [];
  if (ctr < PROMOTE_CTR) bits.push(`link CTR ${round2(ctr)}% is under 2.0%`);
  else if (baseline != null && ctr < baseline) bits.push(`link CTR ${round2(ctr)}% is under the ${round2(baseline)}% baseline`);
  if (cpm < CPM_LOW) bits.push(`CPM $${round2(cpm)} is still under $90`);
  if (cpm > CPM_HIGH) bits.push(`CPM $${round2(cpm)} is over $190`);
  if (ad.qualified == null) bits.push('qualified leads were not in the export, so the 5-lead rescue was not checked');
  else if (ad.qualified < RESCUE_QUALIFIED) bits.push(`${ad.qualified} qualified leads is under the 5-lead rescue`);
  else bits.push(`CPQL $${round2(ad.spend / ad.qualified)} is over $65`);
  return {
    verdict: 'kill',
    rule: 'final-3',
    why: `Final look. ${bits.join('; ')}. Turn it off. No third run.`,
  };
}

function notesFor(ad: RawAd, hit: RuleHit, stage: GradedAd['stage']): string[] {
  const notes: string[] = [];
  const cpc = cpcOf(ad);
  if (cpc != null && cpc > CPC_PAUSE) {
    notes.push(
      `CPC is $${round2(cpc)}, over the $10 pause line. CPC is CPM ÷ link CTR, so it does not change this verdict.`,
    );
  }
  if (hit.verdict === 'kill' && ad.qualified == null && stage === 'floor') {
    notes.push(
      'Confirm 0 qualified leads in Mr. Waiz before turning it off. One qualified lead at this sample extends it instead.',
    );
  }
  if (hit.verdict === 'kill' && ad.qualified == null && stage === 'final') {
    notes.push(
      'Confirm it does not have 5+ qualified leads at CPQL $65 or under. That is the only thing that saves an ad at 2,000.',
    );
  }
  if (cpmOf(ad) != null && cpmOf(ad)! < CPM_LOW && hit.verdict === 'extend') {
    notes.push('Check placements and exclude Audience Network before the second run.');
  }
  if (ad.resultType && !isLeadResult(ad.resultType)) {
    notes.push(`Results column is "${ad.resultType}", not leads, so it was ignored.`);
  }
  return notes;
}

function hookRate(ad: RawAd): number | null {
  if (ad.hookPlays == null || ad.impressions <= 0) return null;
  return ad.hookPlays / ad.impressions;
}

function gradeBatch(
  rawAds: RawAd[],
  baselinePct: number | null,
  baselineSource: BaselineSource,
): Batch {
  const campaign = rawAds[0]?.campaign ?? '';
  const adSet = rawAds[0]?.adSet ?? '';
  const instant = baselinePct != null && baselinePct < KILL_CTR;

  const measured = rawAds
    .map((ad) => ({ ad, ctr: linkCtr(ad), stage: stageOf(ad.impressions) }))
    .filter((x) => x.ctr != null);

  const windowAds = measured.filter((x) => x.stage === 'floor' || x.stage === 'final');
  const bestCtr = windowAds.reduce((max, x) => Math.max(max, x.ctr ?? 0), -1);
  const bestIds = new Set(
    windowAds.filter((x) => x.ctr != null && Math.abs(x.ctr - bestCtr) < 1e-9).map((x) => x.ad.adId || x.ad.adName),
  );

  const graded: GradedAd[] = rawAds.map((ad) => {
    const ctr = linkCtr(ad);
    const cpm = cpmOf(ad);
    const stage = stageOf(ad.impressions);
    const key = ad.adId || ad.adName;
    const base: GradedAd = {
      ad_name: ad.adName,
      ad_id: ad.adId,
      impressions: ad.impressions,
      link_clicks: ad.linkClicks,
      spend: round2(ad.spend),
      link_ctr_pct: ctr == null ? null : round2(ctr),
      cpm: cpm == null ? null : round2(cpm),
      cpc: cpcOf(ad) == null ? null : round2(cpcOf(ad)!),
      results: ad.results,
      qualified: ad.qualified,
      cpql:
        ad.qualified != null && ad.qualified > 0 ? round2(ad.spend / ad.qualified) : null,
      stage,
      verdict: 'waiting',
      rule: 'waiting',
      why: `${ad.impressions} impressions. Under 1,000. Still waiting, not failing.`,
      would_have_been: null,
      notes: [],
      priority: null,
    };

    if (stage === 'waiting') return base;

    if (instant) {
      const vs =
        ctr != null && baselinePct != null
          ? ctr >= baselinePct
            ? `Link CTR ${round2(ctr)}% is at or above this account's ${round2(baselinePct)}% baseline.`
            : `Link CTR ${round2(ctr)}% is under this account's ${round2(baselinePct)}% baseline.`
          : 'No link CTR.';
      base.verdict = 'ungraded';
      base.rule = 'instant-form';
      base.why = `Account baseline is under 1.5%, so these are not landing-page bars. Do not kill on 1.5% and do not graduate on 2.0%. ${vs}`;
      return base;
    }

    const hit = gradeWindow(
      ad,
      stage === 'past' ? 'final' : stage,
      baselinePct,
      bestIds.has(key),
    );

    if (stage === 'past') {
      base.verdict = 'past_level_1';
      base.would_have_been = hit.verdict;
      base.rule = 'past';
      base.why = `${ad.impressions} impressions is past the Level 1 window (judge at 1,000, final at 2,000, overshoot kept through ${PAST}). Do not turn this ad off from this sheet. On these totals the 2,000 rule would have said ${hit.verdict}. Gate 2 and Gate 3 judge it from here.`;
      base.notes = notesFor(ad, hit, 'final');
      return base;
    }

    base.verdict = hit.verdict;
    base.rule = hit.rule;
    base.why = hit.why;
    base.notes = notesFor(ad, hit, stage);
    if (
      bestIds.has(key) &&
      ad.results == null &&
      (hit.verdict === 'graduate' || hit.verdict === 'needs_baseline')
    ) {
      base.notes.push(
        'Results was blank, so the zero-lead page check did not run. If this ad has zero leads, extend it to 2,000 instead of graduating.',
      );
    }
    if (
      stage === 'final' &&
      hit.verdict === 'graduate' &&
      hit.rule === 'final-1' &&
      ad.results === 0 &&
      windowAds.length < 2
    ) {
      base.notes.push(
        'Zero leads at 2,000. One ad cannot show a page leak. Graduate on link CTR and watch the page.',
      );
    }
    return base;
  });

  let pageLeak = false;
  let pageLeakReason: string | null = null;
  if (!instant) {
    const inWindow = graded.filter((g) => g.stage === 'floor' || g.stage === 'final');
    const known = inWindow.every((g) => g.results !== null);
    const clicks = rawAds
      .filter((a) => {
        const s = stageOf(a.impressions);
        return s === 'floor' || s === 'final';
      })
      .reduce((s, a) => s + a.linkClicks, 0);
    const leads = inWindow.reduce((s, g) => s + (g.results ?? 0), 0);
    const high = inWindow.filter((g) => (g.link_ctr_pct ?? 0) >= PROMOTE_CTR).length;
    if (inWindow.length >= 2 && known && clicks > 0 && leads / clicks < CLICK_TO_LEAD_LEAK && high * 2 > inWindow.length) {
      pageLeak = true;
      const pct = round2((leads / clicks) * 100);
      pageLeakReason = `${high} of ${inWindow.length} ads at the floor are at or above 2.0% link CTR, and click-to-lead is ${pct}% (under 6%). Stop. Fix the page, form, or pixel. Re-run these same ads. Do not graduate or kill them for creative.`;
      for (const g of inWindow) {
        g.verdict = 'page_stop';
        g.rule = 'page';
        g.why = pageLeakReason;
        g.priority = null;
      }
    }
  }

  if (!pageLeak && !instant) {
    const grads = graded.filter((g) => g.verdict === 'graduate');
    const rawByKey = new Map(rawAds.map((r) => [r.adId || r.adName, r]));
    grads.sort((a, b) => {
      const ctrGap = (b.link_ctr_pct ?? 0) - (a.link_ctr_pct ?? 0);
      if (Math.abs(ctrGap) > 0.05) return ctrGap;
      const ha = hookRate(rawByKey.get(a.ad_id || a.ad_name)!);
      const hb = hookRate(rawByKey.get(b.ad_id || b.ad_name)!);
      if (ha != null && hb != null && hb !== ha) return hb - ha;
      if (Math.abs(ctrGap) > 1e-9) return ctrGap;
      return a.ad_name.localeCompare(b.ad_name);
    });
    grads.forEach((g, i) => {
      if (i < MAX_GRADUATE) {
        g.priority = i + 1;
      } else {
        g.verdict = 'held';
        g.rule = `${g.rule}+held`;
        g.priority = null;
        g.why = `${g.why} Held. Already graduating ${MAX_GRADUATE} ads with a higher link CTR.`;
      }
    });
  }

  const names = (v: Verdict) =>
    graded.filter((g) => g.verdict === v).map((g) => g.ad_name);

  const kills = graded.filter((g) => g.verdict === 'kill');
  const warning =
    rawAds.length > 12
      ? 'This ad set has more than 12 ads. A Level 1 batch is sized from the testing budget, usually 3–5. Confirm this is the test before acting.'
      : null;

  const clickToLead = (() => {
    const inWindow = rawAds.filter((a) => {
      const s = stageOf(a.impressions);
      return s === 'floor' || s === 'final';
    });
    if (inWindow.some((a) => a.results == null)) return null;
    const clicks = inWindow.reduce((s, a) => s + a.linkClicks, 0);
    const leads = inWindow.reduce((s, a) => s + (a.results ?? 0), 0);
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
    ads: graded.sort((a, b) => (b.link_ctr_pct ?? -1) - (a.link_ctr_pct ?? -1)),
    actions: {
      graduate: names('graduate'),
      held: names('held'),
      turn_off: names('kill'),
      confirm_before_kill: kills.filter((g) => g.qualified == null).map((g) => g.ad_name),
      extend: names('extend'),
      waiting: names('waiting'),
      needs_baseline: names('needs_baseline'),
      past_level_1: names('past_level_1'),
      ungraded: names('ungraded'),
      page_stop: names('page_stop'),
    },
  };
}

export function gradeAds(
  rawAds: RawAd[],
  opts: { baseline: number | null; newAccount: boolean },
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
    if (baseline == null && opts.newAccount) {
      const sample = ads
        .filter((a) => a.impressions >= FLOOR && a.impressions <= PAST)
        .map((a) => linkCtr(a))
        .filter((n): n is number => n != null);
      const pool = sample.length
        ? sample
        : ads.map((a) => linkCtr(a)).filter((n): n is number => n != null);
      baseline = median(pool);
      source = 'new_account_median';
    }
    return gradeBatch(ads, baseline, source);
  });
}

function assert(cond: boolean, message: string, failures: string[]): void {
  if (!cond) failures.push(message);
}

function ad(partial: Partial<RawAd> & Pick<RawAd, 'adName' | 'impressions' | 'linkClicks' | 'spend'>): RawAd {
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
    hookPlays: partial.hookPlays ?? null,
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

  const standard = gradeAds(
    [
      ad({ adName: 'grad', impressions: 1000, linkClicks: 22, spend: 120, results: 2, qualified: 0 }),
      ad({ adName: 'middle', impressions: 1000, linkClicks: 17, spend: 120, results: 1, qualified: 0 }),
      ad({ adName: 'killctr', impressions: 1100, linkClicks: 10, spend: 121, results: 0, qualified: 0 }),
      ad({ adName: 'veto', impressions: 1000, linkClicks: 10, spend: 150, results: 1, qualified: 1 }),
      ad({ adName: 'cheap', impressions: 1000, linkClicks: 8, spend: 80, results: 0, qualified: 0 }),
      ad({ adName: 'expensive', impressions: 1000, linkClicks: 25, spend: 200, results: 3, qualified: 0 }),
      ad({ adName: 'wait', impressions: 800, linkClicks: 20, spend: 80, results: 1, qualified: 0 }),
      ad({ adName: 'pagecheck', impressions: 1000, linkClicks: 25, spend: 120, results: 0, qualified: 0, adSet: 'Page' }),
      ad({ adName: 'weaker', impressions: 1000, linkClicks: 16, spend: 120, results: 1, qualified: 0, adSet: 'Page' }),
    ],
    { baseline: 2, newAccount: false },
  );
  assert(verdictOf(standard, 'grad').verdict === 'graduate', 'clear ad should graduate', failures);
  assert(verdictOf(standard, 'middle').verdict === 'extend', '1.7% should extend', failures);
  assert(verdictOf(standard, 'killctr').verdict === 'kill', '0.9% with 0 qualified should kill', failures);
  assert(verdictOf(standard, 'veto').verdict === 'extend' && verdictOf(standard, 'veto').rule === 'floor-2', 'qualified lead vetoes a kill', failures);
  assert(verdictOf(standard, 'cheap').verdict === 'extend', 'cheap CPM extends even with weak CTR', failures);
  assert(verdictOf(standard, 'expensive').verdict === 'kill', 'CPM over $190 kills', failures);
  assert(verdictOf(standard, 'wait').verdict === 'waiting', 'under 1,000 waits', failures);
  assert(verdictOf(standard, 'pagecheck').rule === 'floor-1', 'best ad with zero leads is a page check', failures);

  const rescue = gradeAds(
    [
      ad({ adName: 'save', impressions: 2100, linkClicks: 20, spend: 250, results: 6, qualified: 5 }),
      ad({ adName: 'pricey', impressions: 2100, linkClicks: 20, spend: 400, results: 6, qualified: 5 }),
      ad({ adName: 'ctrwin', impressions: 2100, linkClicks: 50, spend: 250, results: 4, qualified: 0 }),
    ],
    { baseline: 2, newAccount: false },
  );
  assert(verdictOf(rescue, 'save').rule === 'final-2', '5 qualified at CPQL $50 graduates', failures);
  assert(verdictOf(rescue, 'pricey').verdict === 'kill', 'CPQL over $65 does not rescue', failures);
  assert(verdictOf(rescue, 'ctrwin').rule === 'final-1', '2,000 with a clear CTR graduates', failures);

  const cap = gradeAds(
    [40, 35, 30, 25].map((clicks, i) =>
      ad({
        adName: `c${clicks}`,
        impressions: 1000,
        linkClicks: clicks,
        spend: 120,
        results: 5,
        qualified: 0,
      }),
    ),
    { baseline: 2, newAccount: false },
  );
  const capBatch = cap[0];
  assert(capBatch.actions.graduate.length === 3, 'promote at most 3', failures);
  assert(capBatch.actions.graduate[0] === 'c40', 'highest link CTR graduates first', failures);
  assert(capBatch.actions.held[0] === 'c25', 'fourth graduate is held', failures);
  assert(!capBatch.page_leak, '15% click-to-lead is not a page leak', failures);

  const leak = gradeAds(
    [1, 2, 3].map((n) =>
      ad({
        adName: `dry${n}`,
        impressions: 1000,
        linkClicks: 25,
        spend: 120,
        results: 1,
        qualified: 0,
      }),
    ),
    { baseline: 2, newAccount: false },
  );
  assert(leak[0].page_leak, 'high CTR and click-to-lead under 6% stops the batch', failures);
  assert(leak[0].actions.graduate.length === 0, 'page leak does not graduate', failures);
  assert(leak[0].actions.page_stop.length === 3, 'page leak keeps every ad for the re-run', failures);

  const missing = gradeAds(
    [
      ad({ adName: 'maybe', campaign: 'No Baseline', impressions: 1000, linkClicks: 25, spend: 120, results: 3, qualified: 0 }),
      ad({ adName: 'dead', campaign: 'No Baseline', impressions: 1000, linkClicks: 12, spend: 120, results: 0, qualified: 0 }),
    ],
    { baseline: null, newAccount: false },
  );
  assert(verdictOf(missing, 'maybe').verdict === 'needs_baseline', '2.5% without a baseline does not graduate', failures);
  assert(verdictOf(missing, 'dead').verdict === 'kill', 'under 1.5% still kills without a baseline', failures);

  const instant = gradeAds(
    [ad({ adName: 'form', campaign: 'IF', impressions: 1000, linkClicks: 12, spend: 120, results: 1, qualified: 0 })],
    { baseline: 1.11, newAccount: false },
  );
  assert(instant[0].instant_form && verdictOf(instant, 'form').verdict === 'ungraded', 'instant form is not killed on 1.5%', failures);

  const parsed = gradeAds(
    [ad({ adName: 'named', impressions: 1000, linkClicks: 22, spend: 120, results: 2, qualified: 0 })],
    { baseline: null, newAccount: false },
  );
  assert(parsed[0].baseline_source === 'campaign_name', 'baseline is read from the campaign name', failures);
  assert(verdictOf(parsed, 'named').verdict === 'graduate', 'campaign-name baseline can graduate', failures);

  const past = gradeAds(
    [ad({ adName: 'old', impressions: 18000, linkClicks: 200, spend: 2000, results: 40, qualified: 0 })],
    { baseline: 2, newAccount: false },
  );
  assert(verdictOf(past, 'old').verdict === 'past_level_1', 'scaled ads are not cut from Level 1', failures);

  const csv = `Campaign name,Ad set name,Ad name,Ad ID,Day,Impressions,Link clicks,Amount spent (USD),CTR (all),Results,Result type
Totals,,,,,1200,12,120,4.00%,,
"Test, baseline 2.00%",Set,Ad A,111,2026-10-01,600,6,60,4.00%,1,lead
"Test, baseline 2.00%",Set,Ad A,111,2026-10-02,600,6,60,4.00%,0,lead
`;
  const fromCsv = gradeAds(adsFromCsv(csv), { baseline: null, newAccount: false });
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

  const batches = gradeAds(ads, {
    baseline,
    newAccount: hasFlag('--new-account'),
  });

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
