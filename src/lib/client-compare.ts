/**
 * Client Compare — peer-wall helpers. KPI math stays in metrics.ts /
 * client-health.ts; this layer nulls empty denominators, decides which
 * clients appear on which chart, and computes visible-set medians.
 */

import {
  clientHealthSnapshotFromMetrics,
  heClientHealthSnapshotFromMetrics,
  KPI_MIN_DENOMINATOR,
  type ClientKpiBenchmarks,
  type HealthTier,
  type KpiKey,
} from '@/lib/client-health';
import { worstTier } from '@/lib/dept-health';
import { dialPoolForClient, withDialPoolRates, type DialPool } from '@/lib/dial-pool';
import { usesCallCenterKpiLayout, type ReportingType } from '@/lib/kpi-layouts';
import {
  buildDailyCostSeries,
  rollupCostSeriesToWeeks,
  toCostTrendPoints,
  weekStartKey,
  type MetricsResult,
  type TrendEventRow,
  type TrendSpendRow,
} from '@/lib/metrics';

export type CompareOfferFilter = 'all' | ReportingType;

export type CompareKpiKey =
  | 'spend'
  | 'cpl'
  | 'cpql'
  | 'cpconv'
  | 'hand_raise'
  | 'show_rate'
  | 'leads'
  | 'conversations'
  | 'booked';

export const COST_CHART_KEYS: CompareKpiKey[] = ['spend', 'cpl', 'cpql', 'cpconv'];
export const RATE_CHART_KEYS: CompareKpiKey[] = ['hand_raise', 'show_rate'];
export const VOLUME_CHART_KEYS: CompareKpiKey[] = ['leads', 'conversations'];

export type CompareGradeMap = Partial<Record<CompareKpiKey, HealthTier>>;

export type ClientCompareRow = {
  id: string;
  name: string;
  reporting_type: ReportingType;
  lifecycle_status: string | null;
  on_default_roster: boolean;
  spend: number | null;
  spend_missing: boolean;
  leads: number;
  qualified: number;
  unique_conversations: number;
  unique_booked: number;
  booked: number;
  cpl: number | null;
  cpql: number | null;
  cpconv: number | null;
  hand_raise: number | null;
  conversation_rate: number | null;
  show_rate: number | null;
  dials: number;
  dials_per_qualified: number | null;
  grades: CompareGradeMap;
  north_star_grade: HealthTier;
  has_custom_cpl_benchmark: boolean;
  is_call_center: boolean;
  /** Paid-ads dial pool for the two rates. Null on call center. */
  dial_pool: DialPool | null;
};

export type CompareMapPoint = {
  id: string;
  name: string;
  reporting_type: ReportingType;
  x: number;
  y: number;
  z: number;
  hollow: boolean;
  colorTier: HealthTier;
  row: ClientCompareRow;
};

export type CompareBar = {
  id: string;
  name: string;
  value: number;
  hollow: boolean;
  grade: HealthTier | null;
  row: ClientCompareRow;
};

const CHURNED = new Set(['churned']);

export function isDefaultRosterClient(input: {
  lifecycle_status?: string | null;
  billing_paused?: boolean | null;
}): boolean {
  if (input.billing_paused === true) return false;
  const status = (input.lifecycle_status ?? 'active').toLowerCase();
  return !CHURNED.has(status);
}

function nullIfEmptyDenom(value: number, denom: number): number | null {
  if (!(denom > 0)) return null;
  return value;
}

function gradeOf(
  grades: { key: KpiKey; tier: HealthTier }[],
  key: KpiKey,
): HealthTier {
  return grades.find(g => g.key === key)?.tier ?? 'insufficient';
}

export function compareRowFromMetrics(input: {
  id: string;
  name: string;
  reporting_type: ReportingType;
  lifecycle_status?: string | null;
  billing_paused?: boolean | null;
  metrics: MetricsResult;
  /** Per-client Client Success overrides — used only to flag the tooltip. */
  benchmarks?: ClientKpiBenchmarks | null;
  qualifies_leads?: boolean | null;
}): ClientCompareRow {
  const isCc = usesCallCenterKpiLayout(input.reporting_type);
  const m = input.metrics;
  const pool = dialPoolForClient(input.reporting_type, input.qualifies_leads);
  const reported = withDialPoolRates(m, pool);
  const snap = isCc
    ? heClientHealthSnapshotFromMetrics(m, null)
    : clientHealthSnapshotFromMetrics(m, null);

  const spend = isCc ? null : m.ad_spend;
  const spendMissing = false;
  const cpl = isCc ? null : nullIfEmptyDenom(m.cpl, m.new_leads);
  const cpql = isCc ? null : nullIfEmptyDenom(m.cp_qualified, m.qualified_leads);
  const cpconv = isCc ? null : nullIfEmptyDenom(m.cp_conversation, m.unique_conversations);
  const handRaise = isCc
    ? nullIfEmptyDenom(m.lead_hand_raise_rate, m.new_leads)
    : nullIfEmptyDenom(reported.hand_raise_rate, pool === 'all' ? m.new_leads : m.qualified_leads);
  const conversationDenom = isCc || pool !== 'all' ? m.qualified_leads : m.new_leads;
  const conversationRate = nullIfEmptyDenom(
    isCc ? m.conversation_rate : reported.conversation_rate,
    conversationDenom,
  );
  const showRate = nullIfEmptyDenom(m.booked_to_conversation_rate, m.unique_booked_appointments);
  const dials = m.outbound_dials;
  const dialsPerQualified = m.qualified_leads > 0 ? dials / m.qualified_leads : null;

  const grades: CompareGradeMap = {
    hand_raise: gradeOf(snap.grades, 'hand_raise_rate'),
    show_rate: gradeOf(snap.grades, 'show_rate'),
  };
  if (!isCc) {
    grades.cpl = gradeOf(snap.grades, 'cpl');
    grades.cpql = gradeOf(snap.grades, 'cpql');
    grades.cpconv = gradeOf(snap.grades, 'cps');
  }

  const northStar: HealthTier = isCc
    ? worstTier(grades.hand_raise ?? 'insufficient', grades.show_rate ?? 'insufficient')
    : grades.cpconv ?? 'insufficient';

  return {
    id: input.id,
    name: input.name,
    reporting_type: input.reporting_type,
    lifecycle_status: input.lifecycle_status ?? null,
    on_default_roster: isDefaultRosterClient(input),
    spend,
    spend_missing: spendMissing,
    leads: m.new_leads,
    qualified: m.qualified_leads,
    unique_conversations: m.unique_conversations,
    unique_booked: m.unique_booked_appointments,
    booked: m.booked_appointments,
    cpl,
    cpql,
    cpconv,
    hand_raise: handRaise,
    conversation_rate: conversationRate,
    show_rate: showRate,
    dials,
    dials_per_qualified: dialsPerQualified,
    grades,
    north_star_grade: northStar,
    has_custom_cpl_benchmark: Boolean(input.benchmarks?.cpl),
    is_call_center: isCc,
    dial_pool: pool,
  };
}

export function rosterIdsForOffer(
  rows: ClientCompareRow[],
  offer: CompareOfferFilter,
): string[] {
  return rows
    .filter(r => r.on_default_roster)
    .filter(r => offer === 'all' || r.reporting_type === offer)
    .map(r => r.id);
}

export function rowsByIds(
  rows: ClientCompareRow[],
  ids: string[],
): ClientCompareRow[] {
  const want = new Set(ids);
  return rows.filter(r => want.has(r.id));
}

export function visibleChartKeys(rows: ClientCompareRow[]): CompareKpiKey[] {
  if (rows.length === 0) return [];
  const allCc = rows.every(r => r.is_call_center);
  const anyPaid = rows.some(r => !r.is_call_center);
  const keys: CompareKpiKey[] = [];
  if (anyPaid) keys.push(...COST_CHART_KEYS);
  keys.push(...RATE_CHART_KEYS, ...VOLUME_CHART_KEYS);
  if (allCc) keys.push('booked');
  return keys;
}

export function costChartsCaption(rows: ClientCompareRow[]): string | null {
  const anyPaid = rows.some(r => !r.is_call_center);
  const anyCc = rows.some(r => r.is_call_center);
  if (anyPaid && anyCc) return 'Call Center accounts excluded.';
  return null;
}

export function valueFor(row: ClientCompareRow, key: CompareKpiKey): number | null {
  switch (key) {
    case 'spend':
      return row.spend;
    case 'cpl':
      return row.cpl;
    case 'cpql':
      return row.cpql;
    case 'cpconv':
      return row.cpconv;
    case 'hand_raise':
      return row.hand_raise;
    case 'show_rate':
      return row.show_rate;
    case 'leads':
      return row.leads;
    case 'conversations':
      return row.unique_conversations;
    case 'booked':
      return row.booked;
  }
}

function denomFor(row: ClientCompareRow, key: CompareKpiKey): number {
  switch (key) {
    case 'spend':
      return 1;
    case 'cpl':
      return row.leads;
    case 'cpql':
      return row.qualified;
    case 'cpconv':
      return row.unique_conversations;
    case 'hand_raise':
      return handRaiseDenom(row);
    case 'show_rate':
      return row.unique_booked;
    case 'leads':
    case 'conversations':
    case 'booked':
      return 1;
  }
}

function minDenomFor(row: ClientCompareRow, key: CompareKpiKey): number {
  switch (key) {
    case 'cpl':
      return KPI_MIN_DENOMINATOR.cpl;
    case 'cpql':
      return KPI_MIN_DENOMINATOR.cpql;
    case 'cpconv':
      return KPI_MIN_DENOMINATOR.cps;
    case 'hand_raise':
      return row.is_call_center
        ? KPI_MIN_DENOMINATOR.lead_booking_rate
        : KPI_MIN_DENOMINATOR.hand_raise_rate;
    case 'show_rate':
      return KPI_MIN_DENOMINATOR.show_rate;
    default:
      return 0;
  }
}

export function isHollowBar(row: ClientCompareRow, key: CompareKpiKey): boolean {
  const min = minDenomFor(row, key);
  if (min <= 0) return false;
  return denomFor(row, key) < min;
}

function lowerIsWorse(key: CompareKpiKey): boolean {
  return key === 'hand_raise' || key === 'show_rate' || key === 'leads' || key === 'conversations' || key === 'booked';
}

export function barsForChart(rows: ClientCompareRow[], key: CompareKpiKey): CompareBar[] {
  const cost = (COST_CHART_KEYS as string[]).includes(key);
  const eligible = rows.filter(r => {
    if (cost && r.is_call_center) return false;
    return valueFor(r, key) != null;
  });
  const bars: CompareBar[] = eligible.map(row => ({
    id: row.id,
    name: row.name,
    value: valueFor(row, key) as number,
    hollow: isHollowBar(row, key),
    grade: row.grades[key] ?? null,
    row,
  }));
  const asc = lowerIsWorse(key);
  bars.sort((a, b) => (asc ? a.value - b.value : b.value - a.value));
  return bars;
}

export function medianOf(values: number[]): number | null {
  const nums = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

export function medianForBars(bars: CompareBar[]): number | null {
  return medianOf(bars.filter(b => !b.hollow).map(b => b.value));
}

function handRaiseDenom(row: ClientCompareRow): number {
  return row.is_call_center || row.dial_pool === 'all' ? row.leads : row.qualified;
}

function costMapHollow(row: ClientCompareRow): boolean {
  return (
    row.unique_conversations < KPI_MIN_DENOMINATOR.cps
    || handRaiseDenom(row) < KPI_MIN_DENOMINATOR.hand_raise_rate
  );
}

function rateMapHollow(row: ClientCompareRow): boolean {
  const hrMin = row.is_call_center
    ? KPI_MIN_DENOMINATOR.lead_booking_rate
    : KPI_MIN_DENOMINATOR.hand_raise_rate;
  return handRaiseDenom(row) < hrMin || row.unique_booked < KPI_MIN_DENOMINATOR.show_rate;
}

export function costMapPoints(rows: ClientCompareRow[]): CompareMapPoint[] {
  return rows
    .filter(r => !r.is_call_center && r.cpconv != null && r.hand_raise != null)
    .map(row => {
      const hollow = costMapHollow(row);
      return {
        id: row.id,
        name: row.name,
        reporting_type: row.reporting_type,
        x: row.cpconv as number,
        y: row.hand_raise as number,
        z: Math.max(row.unique_conversations, 1),
        hollow,
        colorTier: hollow ? 'insufficient' : row.north_star_grade,
        row,
      };
    });
}

export function rateMapPoints(rows: ClientCompareRow[]): CompareMapPoint[] {
  return rows
    .filter(r => r.hand_raise != null && r.show_rate != null)
    .map(row => {
      const hollow = rateMapHollow(row);
      return {
        id: row.id,
        name: row.name,
        reporting_type: row.reporting_type,
        x: row.hand_raise as number,
        y: row.show_rate as number,
        z: Math.max(row.unique_conversations, 1),
        hollow,
        colorTier: hollow ? 'insufficient' : row.north_star_grade,
        row,
      };
    });
}

export function mapMedians(points: CompareMapPoint[]): { x: number | null; y: number | null } {
  const solid = points.filter(p => !p.hollow);
  return {
    x: medianOf(solid.map(p => p.x)),
    y: medianOf(solid.map(p => p.y)),
  };
}

export function shouldDefaultToRateMap(rows: ClientCompareRow[]): boolean {
  return costMapPoints(rows).length === 0;
}

export function countWithSpend(rows: ClientCompareRow[]): number {
  return rows.filter(r => r.spend != null).length;
}

export function inclusiveDayCount(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

export function showPendingCaveat(start: string, end: string): boolean {
  return inclusiveDayCount(start, end) <= 14;
}

export type CompareDatePreset = 'last_7' | 'last_30' | 'last_60' | 'last_90' | 'custom';

export const COMPARE_PRESET_LABELS: Record<CompareDatePreset, string> = {
  last_7: 'Last 7',
  last_30: 'Last 30',
  last_60: 'Last 60',
  last_90: 'Last 90',
  custom: 'Custom',
};

function addDaysYmd(ymd: string, deltaDays: number): string {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  const d = new Date(t + deltaDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Match dashboard last_N: start = today − N days, end = today. */
export function rangeForComparePreset(
  preset: CompareDatePreset,
  todayYmd: string,
  custom?: { start: string; end: string },
): { start: string; end: string } {
  if (preset === 'custom') {
    const start = custom?.start || todayYmd;
    const end = custom?.end || todayYmd;
    return start <= end ? { start, end } : { start: end, end: start };
  }
  const days = preset === 'last_7' ? 7 : preset === 'last_30' ? 30 : preset === 'last_60' ? 60 : 90;
  return { start: addDaysYmd(todayYmd, -days), end: todayYmd };
}

export function parseOfferFilter(raw: string | null | undefined): CompareOfferFilter {
  const v = String(raw ?? 'all').trim().toUpperCase();
  if (v === 'RM' || v === 'DSCR' || v === 'CALL_CENTER') return v;
  return 'all';
}

export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export type CompareTableColumnKey =
  | 'name'
  | 'spend'
  | 'cpl'
  | 'cpql'
  | 'hand_raise'
  | 'conversation_rate'
  | 'show_rate'
  | 'cpconv'
  | 'dials'
  | 'dials_per_qualified';

export type CompareSortDir = 'asc' | 'desc';

export const COMPARE_TABLE_COLUMNS: CompareTableColumnKey[] = [
  'name',
  'spend',
  'cpl',
  'cpql',
  'hand_raise',
  'conversation_rate',
  'show_rate',
  'cpconv',
  'dials',
  'dials_per_qualified',
];

const TABLE_COLUMN_SET = new Set<string>(COMPARE_TABLE_COLUMNS);

export function defaultSortDir(key: CompareTableColumnKey): CompareSortDir {
  if (
    key === 'spend' ||
    key === 'cpl' ||
    key === 'cpql' ||
    key === 'cpconv' ||
    key === 'dials_per_qualified' ||
    key === 'name'
  ) {
    return 'asc';
  }
  return 'desc';
}

export function parseTableSortKey(raw: string | null | undefined): CompareTableColumnKey {
  const v = String(raw ?? '').trim();
  if (TABLE_COLUMN_SET.has(v)) return v as CompareTableColumnKey;
  return 'name';
}

export function parseSortDir(
  raw: string | null | undefined,
  key: CompareTableColumnKey,
): CompareSortDir {
  if (raw === 'asc' || raw === 'desc') return raw;
  return defaultSortDir(key);
}

export function nextSortState(
  currentKey: CompareTableColumnKey,
  currentDir: CompareSortDir,
  clicked: CompareTableColumnKey,
): { key: CompareTableColumnKey; dir: CompareSortDir } {
  if (clicked === currentKey) {
    return { key: currentKey, dir: currentDir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clicked, dir: defaultSortDir(clicked) };
}

export function tableValueFor(
  row: ClientCompareRow,
  key: CompareTableColumnKey,
): number | string | null {
  switch (key) {
    case 'name':
      return row.name;
    case 'spend':
      return row.spend;
    case 'cpl':
      return row.cpl;
    case 'cpql':
      return row.cpql;
    case 'hand_raise':
      return row.hand_raise;
    case 'conversation_rate':
      return row.conversation_rate;
    case 'show_rate':
      return row.show_rate;
    case 'cpconv':
      return row.cpconv;
    case 'dials':
      return row.dials;
    case 'dials_per_qualified':
      return row.dials_per_qualified;
  }
}

export function sortCompareRows(
  rows: ClientCompareRow[],
  key: CompareTableColumnKey,
  dir: CompareSortDir,
): ClientCompareRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return sign * a.name.localeCompare(b.name);
    }
    const av = tableValueFor(a, key);
    const bv = tableValueFor(b, key);
    const aNull = typeof av !== 'number';
    const bNull = typeof bv !== 'number';
    if (aNull && bNull) return a.name.localeCompare(b.name);
    if (aNull) return 1;
    if (bNull) return -1;
    if (av !== bv) return sign * (av - bv);
    return a.name.localeCompare(b.name);
  });
}

export type CompareCostMetric = 'cpl' | 'cpql' | 'cpconv';

export type CompareCostPoint = {
  date: string;
  cpl: number | null;
  cpql: number | null;
  cpconv: number | null;
};

export type CompareClientCostSeries = {
  id: string;
  name: string;
  points: CompareCostPoint[];
};

export function compareCostGranularity(start: string, end: string): 'day' | 'week' {
  return inclusiveDayCount(start, end) <= 21 ? 'day' : 'week';
}

function eachYmd(start: string, end: string): string[] {
  const out: string[] = [];
  const last = Date.parse(`${end}T00:00:00.000Z`);
  let cur = Date.parse(`${start}T00:00:00.000Z`);
  if (!Number.isFinite(cur) || !Number.isFinite(last) || last < cur) return out;
  while (cur <= last) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86400000;
  }
  return out;
}

export function compareTimelineDates(
  start: string,
  end: string,
  granularity: 'day' | 'week',
): string[] {
  const days = eachYmd(start, end);
  if (granularity === 'day') return days;
  const weeks: string[] = [];
  const seen = new Set<string>();
  for (const d of days) {
    const key = weekStartKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    weeks.push(key);
  }
  return weeks;
}

function emptyPoint(date: string): CompareCostPoint {
  return { date, cpl: null, cpql: null, cpconv: null };
}

function pointFromCounts(
  date: string,
  spend: number,
  leads: number,
  qualified: number,
  conversations: number,
): CompareCostPoint {
  return {
    date,
    cpl: leads > 0 ? spend / leads : null,
    cpql: qualified > 0 ? spend / qualified : null,
    cpconv: conversations > 0 ? spend / conversations : null,
  };
}

export function costHistoryFromDailySeries(
  clients: Array<{ id: string; name: string; is_call_center: boolean }>,
  eventsByClient: Map<string, TrendEventRow[]>,
  spendRows: Array<{ client_id: string; spend_date: string; amount: number }>,
  start: string,
  end: string,
  granularity: 'day' | 'week',
): CompareClientCostSeries[] {
  const spendByClient = new Map<string, TrendSpendRow[]>();
  for (const row of spendRows) {
    const list = spendByClient.get(row.client_id) ?? [];
    list.push({ spend_date: row.spend_date, amount: row.amount });
    spendByClient.set(row.client_id, list);
  }

  const dates = compareTimelineDates(start, end, granularity);
  return clients
    .filter(c => !c.is_call_center)
    .map(c => {
      const daily = buildDailyCostSeries(
        eventsByClient.get(c.id) ?? [],
        spendByClient.get(c.id) ?? [],
        start,
        end,
      );
      const buckets = granularity === 'week' ? rollupCostSeriesToWeeks(daily) : daily;
      const byDate = new Map(toCostTrendPoints(buckets).map(p => [p.date, p]));
      const points = dates.map(date => {
        const p = byDate.get(date);
        if (!p) return emptyPoint(date);
        return {
          date,
          cpl: p.cpl,
          cpql: p.cp_qualified,
          cpconv: p.cp_conversation,
        };
      });
      return { id: c.id, name: c.name, points };
    });
}

export function costHistoryFromSqlBuckets(
  clients: Array<{ id: string; name: string; is_call_center: boolean }>,
  buckets: Array<{
    client_id: string;
    date: string;
    leads: number;
    qualified_leads: number;
    conversations: number;
  }>,
  spendRows: Array<{ client_id: string; spend_date: string; amount: number }>,
  start: string,
  end: string,
  granularity: 'day' | 'week',
): CompareClientCostSeries[] {
  const dates = compareTimelineDates(start, end, granularity);
  const spendKey = (clientId: string, date: string) => `${clientId}|${date}`;
  const spendMap = new Map<string, number>();
  for (const row of spendRows) {
    const date = granularity === 'week' ? weekStartKey(row.spend_date) : row.spend_date;
    const key = spendKey(row.client_id, date);
    spendMap.set(key, (spendMap.get(key) ?? 0) + row.amount);
  }

  const bucketMap = new Map<string, { leads: number; qualified_leads: number; conversations: number }>();
  for (const row of buckets) {
    const date = granularity === 'week' ? weekStartKey(row.date) : row.date;
    const key = spendKey(row.client_id, date);
    const prev = bucketMap.get(key) ?? { leads: 0, qualified_leads: 0, conversations: 0 };
    prev.leads += row.leads;
    prev.qualified_leads += row.qualified_leads;
    prev.conversations += row.conversations;
    bucketMap.set(key, prev);
  }

  return clients
    .filter(c => !c.is_call_center)
    .map(c => ({
      id: c.id,
      name: c.name,
      points: dates.map(date => {
        const key = spendKey(c.id, date);
        const b = bucketMap.get(key);
        const spend = spendMap.get(key) ?? 0;
        return pointFromCounts(
          date,
          spend,
          b?.leads ?? 0,
          b?.qualified_leads ?? 0,
          b?.conversations ?? 0,
        );
      }),
    }));
}

/** Recharts-friendly: one row per date, one column per client id. */
export function pivotCostHistory(
  series: CompareClientCostSeries[],
  metric: CompareCostMetric,
): Array<Record<string, string | number | null>> {
  if (series.length === 0) return [];
  const dates = series[0].points.map(p => p.date);
  return dates.map((date, i) => {
    const row: Record<string, string | number | null> = { date };
    for (const s of series) {
      row[s.id] = s.points[i]?.[metric] ?? null;
    }
    return row;
  });
}

export const COMPARE_LINE_COLORS = [
  '#38bdf8',
  '#fbbf24',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#22d3ee',
  '#f97316',
  '#4ade80',
  '#e879f9',
  '#60a5fa',
  '#facc15',
] as const;

export function lineColorForIndex(i: number): string {
  return COMPARE_LINE_COLORS[i % COMPARE_LINE_COLORS.length];
}

