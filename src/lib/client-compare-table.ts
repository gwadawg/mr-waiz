/**
 * Client Compare — table-only v2 (Client Workspace › Compare tab).
 *
 * Pure helpers for the flat all-clients scorecard: column set with volume
 * counts, health-tier sorting, period-over-period deltas, month presets,
 * median footer, and CSV export. The legacy chart wall (client-compare.ts)
 * is untouched; this module only reuses its row type and shared math.
 */

import {
  inclusiveDayCount,
  medianOf,
  type ClientCompareRow,
  type CompareOfferFilter,
} from '@/lib/client-compare';
import type { HealthTier } from '@/lib/client-health';

// ---------------------------------------------------------------------------
// Columns

export type CompareTableV2Key =
  | 'health'
  | 'name'
  | 'leads'
  | 'qualified'
  | 'booked'
  | 'conversations'
  | 'spend'
  | 'cpl'
  | 'cpql'
  | 'hand_raise'
  | 'conversation_rate'
  | 'show_rate'
  | 'cpconv'
  | 'dials';

export const COMPARE_V2_COLUMNS: CompareTableV2Key[] = [
  'health',
  'name',
  'leads',
  'qualified',
  'booked',
  'conversations',
  'spend',
  'cpl',
  'cpql',
  'hand_raise',
  'conversation_rate',
  'show_rate',
  'cpconv',
  'dials',
];

/** Columns that render a period-over-period delta chip. */
export const COMPARE_V2_DELTA_KEYS = new Set<CompareTableV2Key>([
  'leads',
  'spend',
  'cpl',
  'cpql',
  'show_rate',
]);

/** Columns whose numbers carry the client-health grade color. */
export const COMPARE_V2_GRADED_KEYS = new Set<CompareTableV2Key>([
  'cpl',
  'cpql',
  'cpconv',
  'hand_raise',
  'show_rate',
]);

/** Worst first so "sort by health" is a triage button. Insufficient sinks. */
export const TIER_SORT_RANK: Record<HealthTier, number> = {
  critical: 0,
  below: 1,
  at: 2,
  above: 3,
  insufficient: 4,
};

export function tableV2ValueFor(
  row: ClientCompareRow,
  key: CompareTableV2Key,
): number | string | null {
  switch (key) {
    case 'health':
      return TIER_SORT_RANK[row.north_star_grade];
    case 'name':
      return row.name;
    case 'leads':
      return row.leads;
    case 'qualified':
      return row.qualified;
    case 'booked':
      return row.booked;
    case 'conversations':
      return row.unique_conversations;
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
  }
}

export type CompareV2SortDir = 'asc' | 'desc';

/** Costs ascending (cheapest first); volumes and rates descending. */
export function defaultV2SortDir(key: CompareTableV2Key): CompareV2SortDir {
  if (
    key === 'health' ||
    key === 'name' ||
    key === 'spend' ||
    key === 'cpl' ||
    key === 'cpql' ||
    key === 'cpconv'
  ) {
    return 'asc';
  }
  return 'desc';
}

export function nextV2SortState(
  currentKey: CompareTableV2Key,
  currentDir: CompareV2SortDir,
  clicked: CompareTableV2Key,
): { key: CompareTableV2Key; dir: CompareV2SortDir } {
  if (clicked === currentKey) {
    return { key: currentKey, dir: currentDir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clicked, dir: defaultV2SortDir(clicked) };
}

/** Nulls always sink to the bottom regardless of direction. */
export function sortV2Rows(
  rows: ClientCompareRow[],
  key: CompareTableV2Key,
  dir: CompareV2SortDir,
): ClientCompareRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name);
    const av = tableV2ValueFor(a, key);
    const bv = tableV2ValueFor(b, key);
    const aNull = typeof av !== 'number';
    const bNull = typeof bv !== 'number';
    if (aNull && bNull) return a.name.localeCompare(b.name);
    if (aNull) return 1;
    if (bNull) return -1;
    if (av !== bv) return sign * ((av as number) - (bv as number));
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Filters

export function filterV2Rows(
  rows: ClientCompareRow[],
  offer: CompareOfferFilter,
  query: string,
): ClientCompareRow[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter(r => r.on_default_roster)
    .filter(r => offer === 'all' || r.reporting_type === offer)
    .filter(r => !q || r.name.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Date presets (adds month windows the chart wall never had)

export type CompareV2Preset =
  | 'last_7'
  | 'last_30'
  | 'last_60'
  | 'last_90'
  | 'this_month'
  | 'last_month'
  | 'custom';

export const COMPARE_V2_PRESET_LABELS: Record<CompareV2Preset, string> = {
  last_7: 'Last 7',
  last_30: 'Last 30',
  last_60: 'Last 60',
  last_90: 'Last 90',
  this_month: 'This month',
  last_month: 'Last month',
  custom: 'Custom',
};

function addDaysYmd(ymd: string, deltaDays: number): string {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  return new Date(t + deltaDays * 86400000).toISOString().slice(0, 10);
}

export function rangeForV2Preset(
  preset: CompareV2Preset,
  todayYmd: string,
  custom?: { start: string; end: string },
): { start: string; end: string } {
  if (preset === 'custom') {
    const start = custom?.start || todayYmd;
    const end = custom?.end || todayYmd;
    return start <= end ? { start, end } : { start: end, end: start };
  }
  if (preset === 'this_month') {
    return { start: `${todayYmd.slice(0, 7)}-01`, end: todayYmd };
  }
  if (preset === 'last_month') {
    const firstOfThis = `${todayYmd.slice(0, 7)}-01`;
    const lastOfPrev = addDaysYmd(firstOfThis, -1);
    return { start: `${lastOfPrev.slice(0, 7)}-01`, end: lastOfPrev };
  }
  const days =
    preset === 'last_7' ? 7 : preset === 'last_30' ? 30 : preset === 'last_60' ? 60 : 90;
  return { start: addDaysYmd(todayYmd, -days), end: todayYmd };
}

/** The window of equal length immediately before [start, end]. */
export function previousRange(
  start: string,
  end: string,
): { start: string; end: string } | null {
  const days = inclusiveDayCount(start, end);
  if (days <= 0) return null;
  const prevEnd = addDaysYmd(start, -1);
  return { start: addDaysYmd(prevEnd, -(days - 1)), end: prevEnd };
}

// ---------------------------------------------------------------------------
// Period-over-period deltas

export type DeltaDirection = 'better' | 'worse' | 'flat' | 'neutral';

export type CompareDelta = {
  /** Signed percent change, e.g. -12.5 means down 12.5%. */
  pct: number;
  direction: DeltaDirection;
};

const LOWER_IS_BETTER = new Set<CompareTableV2Key>(['cpl', 'cpql', 'cpconv']);
/** Spend moving isn't inherently good or bad. */
const DIRECTIONLESS = new Set<CompareTableV2Key>(['spend']);

export function deltaFor(
  key: CompareTableV2Key,
  current: number | null | undefined,
  previous: number | null | undefined,
): CompareDelta | null {
  if (typeof current !== 'number' || typeof previous !== 'number') return null;
  if (!(previous > 0)) return null;
  const pct = ((current - previous) / previous) * 100;
  if (DIRECTIONLESS.has(key)) {
    return { pct, direction: 'neutral' };
  }
  if (Math.abs(pct) < 0.5) return { pct, direction: 'flat' };
  const improved = LOWER_IS_BETTER.has(key) ? pct < 0 : pct > 0;
  return { pct, direction: improved ? 'better' : 'worse' };
}

// ---------------------------------------------------------------------------
// Median footer

export function medianForColumn(
  rows: ClientCompareRow[],
  key: CompareTableV2Key,
): number | null {
  if (key === 'name' || key === 'health') return null;
  const values = rows
    .map(r => tableV2ValueFor(r, key))
    .filter((v): v is number => typeof v === 'number');
  return medianOf(values);
}

// ---------------------------------------------------------------------------
// CSV export

const CSV_HEADERS: Record<CompareTableV2Key, string> = {
  health: 'Health',
  name: 'Client',
  leads: 'Leads',
  qualified: 'Qualified',
  booked: 'Booked',
  conversations: 'Conversations',
  spend: 'Spend',
  cpl: 'CPL',
  cpql: 'CPQL',
  hand_raise: 'Hand-raise %',
  conversation_rate: 'Conv %',
  show_rate: 'Show %',
  cpconv: 'CPConv',
  dials: 'Dials',
};

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function compareRowsToCsv(rows: ClientCompareRow[]): string {
  const header = [
    ...COMPARE_V2_COLUMNS.map(k => CSV_HEADERS[k]),
    'Offer',
  ].join(',');
  const lines = rows.map(row => {
    const cells = COMPARE_V2_COLUMNS.map(key => {
      if (key === 'health') return row.north_star_grade;
      if (key === 'name') return csvEscape(row.name);
      const v = tableV2ValueFor(row, key);
      return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '';
    });
    return [...cells, row.reporting_type].join(',');
  });
  return [header, ...lines].join('\n');
}
