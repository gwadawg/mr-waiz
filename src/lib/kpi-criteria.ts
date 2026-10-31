/**
 * One ruler for Client Success, Compare, Ops, and the team dashboards.
 * Closed versions are immutable. Dates are UTC YYYY-MM-DD, half-open
 * [effective_start, effective_end).
 */

import {
  clientHealthSnapshotForCriteria,
  DEFAULT_KPI_BANDS,
  KPI_MIN_DENOMINATOR,
  RM_KPI_KEYS,
  tierFromBands,
  type ClientKpiBenchmarks,
  type CriteriaAccountMode,
  type CriteriaGradePlan,
  type CriteriaSegmentView,
  type HealthTier,
  type KpiBandSpec,
  type KpiKey,
} from '@/lib/client-health';
import { dialPoolForClient, type DialPool } from '@/lib/dial-pool';
import { DEMO_WAIZ, WAIZ_RANGES } from '@/lib/lead-source-roi/config';
import type { MetricsResult } from '@/lib/metrics';
import { normalizeReportingType, type ReportingType } from '@/lib/reporting-types';
import { normalizeServiceProgram, type ServiceProgram } from '@/lib/service-program';

export const CRITERIA_LEGACY_START = '2000-01-01';

export type CriteriaProfile = 'RM' | 'DSCR' | 'CALL_CENTER';
export type CriteriaRuler = 'legacy' | 'current';
export type CriteriaLens = 'as_judged_then' | 'on_todays_criteria';

export type StoredBand = KpiBandSpec & { minDenominator?: number };

export type CplPlaceholder = {
  worst: number;
  demo: number;
  best: number;
  approved: false;
};

export type VersionPlaceholders = {
  cpl?: CplPlaceholder;
  rates?: { source: 'shared_rm' };
} | null;

export type StockVersion = {
  id: string;
  profileId: CriteriaProfile;
  effectiveStart: string;
  effectiveEnd: string | null;
  ruler: CriteriaRuler;
  bands: Partial<Record<KpiKey, StoredBand>>;
  placeholders: VersionPlaceholders;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type CustomVersion = {
  id: string;
  clientId: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  ruler: CriteriaRuler;
  /** Sparse band numbers. Only keys that differ from stock. */
  bands: Partial<Record<KpiKey, { critical?: number; below?: number; at?: number }>>;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type CriteriaCatalog = {
  stock: StockVersion[];
  custom: CustomVersion[];
};

export type CriteriaClient = {
  id: string;
  reportingType: unknown;
  serviceProgram?: unknown;
  qualifiesLeads?: boolean | null;
};

export type ResolvedCriteria = {
  profile: CriteriaProfile;
  onDate: string;
  ruler: CriteriaRuler;
  serviceProgram: ServiceProgram | null;
  programUnset: boolean;
  pool: DialPool | null;
  gradedKeys: KpiKey[];
  bands: Partial<Record<KpiKey, StoredBand>>;
  customKeys: KpiKey[];
  stockVersionId: string;
  customVersionId: string | null;
  stockEffectiveStart: string;
  customEffectiveStart: string | null;
  rateLinesShared: boolean;
  costUnapproved: boolean;
  placeholders: VersionPlaceholders;
  accountMode: CriteriaAccountMode;
  gradePlan: CriteriaGradePlan;
};

export type CriteriaSegment = {
  start: string;
  end: string;
  criteria: ResolvedCriteria;
};

export type SpanResolution = {
  segments: CriteriaSegment[];
  /** Null when the range uses more than one ruler. */
  single: ResolvedCriteria | null;
  writes: false;
  lens: CriteriaLens;
};

export type GradedSegment = CriteriaSegmentView & { criteria: ResolvedCriteria };

export type GradedRange = {
  segments: GradedSegment[];
  tier: HealthTier | null;
  writes: false;
  lens: CriteriaLens;
};

const SET_RULE_KEYS: KpiKey[] = ['hand_raise_rate', 'show_rate', 'lead_to_qualified'];
const MARKET_KEYS: KpiKey[] = ['cpl', 'cpql', 'cps'];
const COST_UNAPPROVED = 'DSCR cost stock is a placeholder, not 911 / Below / At.';

export function shiftYmd(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayBefore(date: string): string {
  return shiftYmd(date, -1);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function specFromDefault(key: KpiKey, bands = DEFAULT_KPI_BANDS[key].bands): StoredBand {
  const def = DEFAULT_KPI_BANDS[key];
  return {
    bands: { ...bands },
    higherIsBetter: def.higherIsBetter,
    unit: def.unit,
    minDenominator: KPI_MIN_DENOMINATOR[key],
  };
}

function copyKeys(keys: KpiKey[], source: Partial<Record<KpiKey, StoredBand>> = {}): Partial<Record<KpiKey, StoredBand>> {
  const out: Partial<Record<KpiKey, StoredBand>> = {};
  for (const key of keys) {
    out[key] = source[key] ? { ...source[key], bands: { ...source[key].bands } } : specFromDefault(key);
  }
  return out;
}

function fullRmBands(): Partial<Record<KpiKey, StoredBand>> {
  const out: Partial<Record<KpiKey, StoredBand>> = {};
  for (const key of Object.keys(DEFAULT_KPI_BANDS) as KpiKey[]) {
    out[key] = specFromDefault(key);
  }
  return out;
}

export function dscrCplPlaceholder(): CplPlaceholder {
  return {
    worst: WAIZ_RANGES.cpl.worst,
    demo: DEMO_WAIZ.cpl,
    best: WAIZ_RANGES.cpl.best,
    approved: false,
  };
}

/** Seed rows. Legacy reproduces today's grader. Open rows carry the new ruler. */
export function seedStockVersions(cutover: string, nowIso = `${cutover}T00:00:00.000Z`): StockVersion[] {
  const rm = fullRmBands();
  const callCenterBands: Partial<Record<KpiKey, StoredBand>> = {
    hand_raise_rate: specFromDefault('lead_booking_rate'),
    show_rate: specFromDefault('show_rate'),
    lead_booking_rate: specFromDefault('lead_booking_rate'),
  };
  callCenterBands.hand_raise_rate = {
    ...callCenterBands.hand_raise_rate!,
    bands: { ...DEFAULT_KPI_BANDS.lead_booking_rate.bands },
  };
  const dscrRates = copyKeys(
    ['lead_to_qualified', 'hand_raise_rate', 'show_rate', 'close_rate', 'lead_booking_rate'],
    rm,
  );
  const profiles: Array<{ id: string; profileId: CriteriaProfile; ruler: CriteriaRuler; start: string; end: string | null; bands: Partial<Record<KpiKey, StoredBand>>; placeholders: VersionPlaceholders; note: string }> = [
    {
      id: 'stock-rm-legacy',
      profileId: 'RM',
      ruler: 'legacy',
      start: CRITERIA_LEGACY_START,
      end: cutover,
      bands: rm,
      placeholders: null,
      note: 'Legacy ruler. One paid-ads line. Custom CPL only.',
    },
    {
      id: 'stock-rm-open',
      profileId: 'RM',
      ruler: 'current',
      start: cutover,
      end: null,
      bands: fullRmBands(),
      placeholders: null,
      note: 'Open RM stock.',
    },
    {
      id: 'stock-dscr-legacy',
      profileId: 'DSCR',
      ruler: 'legacy',
      start: CRITERIA_LEGACY_START,
      end: cutover,
      bands: fullRmBands(),
      placeholders: null,
      note: 'Legacy ruler. DSCR was graded on the RM line, including cost.',
    },
    {
      id: 'stock-dscr-open',
      profileId: 'DSCR',
      ruler: 'current',
      start: cutover,
      end: null,
      bands: dscrRates,
      placeholders: { cpl: dscrCplPlaceholder(), rates: { source: 'shared_rm' } },
      note: 'DSCR rate lines are a frozen copy of RM. Cost tiers are unset.',
    },
    {
      id: 'stock-cc-legacy',
      profileId: 'CALL_CENTER',
      ruler: 'legacy',
      start: CRITERIA_LEGACY_START,
      end: cutover,
      bands: callCenterBands,
      placeholders: null,
      note: 'Legacy call center. Hand-raise on 3 / 5 / 8.',
    },
    {
      id: 'stock-cc-open',
      profileId: 'CALL_CENTER',
      ruler: 'current',
      start: cutover,
      end: null,
      bands: {
        hand_raise_rate: specFromDefault('hand_raise_rate', { ...DEFAULT_KPI_BANDS.lead_booking_rate.bands }),
        show_rate: specFromDefault('show_rate'),
        lead_booking_rate: specFromDefault('lead_booking_rate'),
      },
      placeholders: null,
      note: 'Open call center stock.',
    },
  ];
  return profiles.map(row => ({
    id: row.id,
    profileId: row.profileId,
    effectiveStart: row.start,
    effectiveEnd: row.end,
    ruler: row.ruler,
    bands: row.bands,
    placeholders: row.placeholders,
    note: row.note,
    createdBy: null,
    createdAt: nowIso,
  }));
}

export function profileFor(reportingType: unknown): CriteriaProfile {
  const normalized = normalizeReportingType(reportingType);
  if (normalized === 'DSCR' || normalized === 'CALL_CENTER') return normalized;
  return 'RM';
}

function covers(version: { effectiveStart: string; effectiveEnd: string | null }, date: string): boolean {
  return version.effectiveStart <= date && (version.effectiveEnd == null || date < version.effectiveEnd);
}

function versionInForce<T extends { effectiveStart: string; effectiveEnd: string | null }>(
  versions: T[],
  date: string,
): T | null {
  const hits = versions.filter(v => covers(v, date));
  hits.sort((a, b) => b.effectiveStart.localeCompare(a.effectiveStart));
  return hits[0] ?? null;
}

function openVersion<T extends { effectiveEnd: string | null; effectiveStart: string }>(versions: T[]): T | null {
  const open = versions.filter(v => v.effectiveEnd == null);
  open.sort((a, b) => b.effectiveStart.localeCompare(a.effectiveStart));
  return open[0] ?? null;
}

function approved(bands: { critical?: number; below?: number; at?: number } | undefined): boolean {
  return !!bands && [bands.critical, bands.below, bands.at].every(n => typeof n === 'number' && Number.isFinite(n));
}

function deriveQualifiedCosts(
  cpl: { critical?: number; below?: number; at?: number },
  qual: { critical?: number; below?: number; at?: number },
  hand: { critical?: number; below?: number; at?: number },
): { cpql: StoredBand; cps: StoredBand } {
  const cpqlBands: { critical?: number; below?: number; at?: number } = {};
  const cpsBands: { critical?: number; below?: number; at?: number } = {};
  for (const band of ['critical', 'below', 'at'] as const) {
    const cplValue = cpl[band];
    const qualPct = qual[band];
    const handPct = hand[band];
    if (cplValue == null || qualPct == null || handPct == null || qualPct === 0 || handPct === 0) continue;
    const cpql = cplValue / (qualPct / 100);
    cpqlBands[band] = roundMoney(cpql);
    cpsBands[band] = roundMoney(cpql / (handPct / 100));
  }
  return {
    cpql: { ...specFromDefault('cpql'), bands: cpqlBands },
    cps: { ...specFromDefault('cps'), bands: cpsBands },
  };
}

function deriveAllLeadsCpconv(
  cpl: { critical?: number; below?: number; at?: number },
  yieldBands: { critical?: number; below?: number; at?: number },
): StoredBand {
  const bands: { critical?: number; below?: number; at?: number } = {};
  for (const band of ['critical', 'below', 'at'] as const) {
    const cplValue = cpl[band];
    const yieldPct = yieldBands[band];
    if (cplValue == null || yieldPct == null || yieldPct === 0) continue;
    bands[band] = roundMoney(cplValue / (yieldPct / 100));
  }
  return { ...specFromDefault('cps'), bands };
}

function gradedKeysFor(input: {
  profile: CriteriaProfile;
  ruler: CriteriaRuler;
  serviceProgram: ServiceProgram | null;
  pool: DialPool | null;
}): { keys: KpiKey[]; accountMode: CriteriaAccountMode; pool: DialPool | null } {
  if (input.profile === 'CALL_CENTER') {
    return { keys: ['hand_raise_rate', 'show_rate'], accountMode: 'worst', pool: null };
  }
  if (input.ruler === 'legacy') {
    return { keys: [...RM_KPI_KEYS], accountMode: 'cpconv', pool: 'qualified' };
  }
  const service = input.serviceProgram ?? 'core';
  const pool = input.pool ?? 'qualified';
  if (service === 'lead_gen') {
    const keys: KpiKey[] = ['cpl'];
    if (pool === 'qualified') keys.push('lead_to_qualified', 'cpql');
    return { keys, accountMode: 'acquisition', pool };
  }
  if (pool === 'all') {
    return {
      keys: ['cpl', 'hand_raise_rate', 'show_rate', 'close_rate', 'cps'],
      accountMode: 'cpconv',
      pool,
    };
  }
  return { keys: [...RM_KPI_KEYS], accountMode: 'cpconv', pool: 'qualified' };
}

function overlayNumber(
  base: StoredBand | undefined,
  custom: { critical?: number; below?: number; at?: number } | undefined,
  key: KpiKey,
): StoredBand | undefined {
  if (!custom) return base;
  const spec = base ?? specFromDefault(key);
  return { ...spec, bands: { ...spec.bands, ...custom } };
}

export function resolveClientCriteria(
  client: CriteriaClient,
  onDate: string,
  catalog: CriteriaCatalog,
  opts?: { lens?: CriteriaLens },
): ResolvedCriteria | null {
  const lens = opts?.lens ?? 'as_judged_then';
  const profile = profileFor(client.reportingType);
  const stockRows = catalog.stock.filter(v => v.profileId === profile);
  const customRows = catalog.custom.filter(v => v.clientId === client.id);
  const stock = lens === 'on_todays_criteria' ? openVersion(stockRows) : versionInForce(stockRows, onDate);
  if (!stock) return null;
  const custom = lens === 'on_todays_criteria' ? openVersion(customRows) : versionInForce(customRows, onDate);
  const serviceProgram = normalizeServiceProgram(client.serviceProgram);
  const programUnset = serviceProgram == null && profile !== 'CALL_CENTER';
  const livePool = dialPoolForClient(client.reportingType, client.qualifiesLeads);
  const shape = gradedKeysFor({
    profile,
    ruler: stock.ruler,
    serviceProgram,
    pool: livePool,
  });
  const pool = shape.pool;
  const customBands = stock.ruler === 'legacy'
    ? (custom?.bands.cpl ? { cpl: custom.bands.cpl } : {})
    : (custom?.bands ?? {});

  const bands: Partial<Record<KpiKey, StoredBand>> = {};
  for (const key of shape.keys) {
    const stockBand = key === 'hand_raise_rate' && profile === 'CALL_CENTER'
      ? stock.bands.hand_raise_rate ?? specFromDefault('hand_raise_rate', { ...DEFAULT_KPI_BANDS.lead_booking_rate.bands })
      : stock.bands[key];
    bands[key] = overlayNumber(stockBand, customBands[key], key);
  }

  const qualLines = stock.bands.lead_to_qualified?.bands ?? DEFAULT_KPI_BANDS.lead_to_qualified.bands;
  const handLines = stock.bands.hand_raise_rate?.bands ?? DEFAULT_KPI_BANDS.hand_raise_rate.bands;
  const yieldLines = stock.bands.lead_booking_rate?.bands ?? DEFAULT_KPI_BANDS.lead_booking_rate.bands;
  const explicitCpql = customBands.cpql && stock.ruler === 'current' ? customBands.cpql : undefined;
  const explicitCps = customBands.cps && stock.ruler === 'current' ? customBands.cps : undefined;
  const customCplTurnsOnCost = stock.ruler === 'current' && approved(customBands.cpl);

  if (stock.ruler === 'current' && pool === 'all' && shape.keys.includes('hand_raise_rate')) {
    const yieldSpec = stock.bands.lead_booking_rate ?? specFromDefault('lead_booking_rate');
    bands.hand_raise_rate = overlayNumber(yieldSpec, customBands.hand_raise_rate, 'hand_raise_rate');
  }

  if (shape.keys.includes('cpql') || shape.keys.includes('cps')) {
    const stockCostsApproved = approved(stock.bands.cpl?.bands);
    if (stock.ruler === 'current' && !stockCostsApproved && !customCplTurnsOnCost) {
      if (!approved(bands.cpl?.bands)) bands.cpl = undefined;
      if (!explicitCpql) bands.cpql = undefined;
      if (!explicitCps) bands.cps = undefined;
    } else if (pool === 'all' && shape.keys.includes('cps') && !explicitCps) {
      const cplForYield = bands.cpl?.bands ?? stock.bands.cpl?.bands;
      if (cplForYield) bands.cps = deriveAllLeadsCpconv(cplForYield, yieldLines);
    } else if (customCplTurnsOnCost && customBands.cpl && pool !== 'all') {
      const derived = deriveQualifiedCosts(customBands.cpl, qualLines, handLines);
      if (shape.keys.includes('cpql') && !explicitCpql) bands.cpql = derived.cpql;
      if (shape.keys.includes('cps') && !explicitCps) bands.cps = derived.cps;
    } else if (stock.ruler === 'legacy' && customBands.cpl) {
      const legacy = deriveQualifiedCosts(
        customBands.cpl,
        DEFAULT_KPI_BANDS.lead_to_qualified.bands,
        DEFAULT_KPI_BANDS.hand_raise_rate.bands,
      );
      if (shape.keys.includes('cpql')) bands.cpql = legacy.cpql;
      if (shape.keys.includes('cps')) bands.cps = legacy.cps;
    }
    if (explicitCpql) bands.cpql = overlayNumber(bands.cpql ?? specFromDefault('cpql'), explicitCpql, 'cpql');
    if (explicitCps) bands.cps = overlayNumber(bands.cps ?? specFromDefault('cps'), explicitCps, 'cps');
  }

  const costUnapproved = profile === 'DSCR'
    && stock.ruler === 'current'
    && !approved(stock.bands.cpl?.bands)
    && !customCplTurnsOnCost;

  const notes: Partial<Record<KpiKey, string>> = {};
  if (costUnapproved) {
    for (const key of ['cpl', 'cpql', 'cps'] as const) {
      if (shape.keys.includes(key)) notes[key] = COST_UNAPPROVED;
    }
  }

  const customKeys = (Object.keys(customBands) as KpiKey[]).filter(key => shape.keys.includes(key) && customBands[key]);

  const gradePlan: CriteriaGradePlan = {
    gradedKeys: shape.keys,
    bands,
    pool: profile === 'CALL_CENTER' ? null : pool,
    accountMode: shape.accountMode,
    notes,
  };

  return {
    profile,
    onDate,
    ruler: stock.ruler,
    serviceProgram,
    programUnset,
    pool: gradePlan.pool,
    gradedKeys: shape.keys,
    bands,
    customKeys,
    stockVersionId: stock.id,
    customVersionId: custom?.id ?? null,
    stockEffectiveStart: stock.effectiveStart,
    customEffectiveStart: custom?.effectiveStart ?? null,
    rateLinesShared: profile === 'DSCR' && stock.placeholders?.rates?.source === 'shared_rm',
    costUnapproved,
    placeholders: stock.placeholders,
    accountMode: shape.accountMode,
    gradePlan,
  };
}

function boundaries(client: CriteriaClient, catalog: CriteriaCatalog): string[] {
  const profile = profileFor(client.reportingType);
  const dates = [
    ...catalog.stock.filter(v => v.profileId === profile).map(v => v.effectiveStart),
    ...catalog.custom.filter(v => v.clientId === client.id).map(v => v.effectiveStart),
  ];
  return [...new Set(dates)].sort();
}

export function resolveCriteriaSpans(
  client: CriteriaClient,
  start: string,
  end: string,
  catalog: CriteriaCatalog,
  opts?: { lens?: CriteriaLens },
): SpanResolution {
  const lens = opts?.lens ?? 'as_judged_then';
  if (end < start) {
    return { segments: [], single: null, writes: false, lens };
  }
  const cuts = lens === 'on_todays_criteria'
    ? []
    : boundaries(client, catalog).filter(date => date > start && date <= end);
  const points = [start, ...cuts, shiftYmd(end, 1)];
  const unique = [...new Set(points)].sort();
  const segments: CriteriaSegment[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const segStart = unique[i];
    const segEnd = shiftYmd(unique[i + 1], -1);
    if (segStart > segEnd) continue;
    const criteria = resolveClientCriteria(client, lens === 'on_todays_criteria' ? segStart : segStart, catalog, { lens });
    if (!criteria) continue;
    segments.push({ start: segStart, end: segEnd, criteria });
  }
  return {
    segments,
    single: segments.length === 1 ? segments[0].criteria : null,
    writes: false,
    lens,
  };
}

export function gradeRange(
  segments: CriteriaSegment[],
  metricsFor: (segment: CriteriaSegment) => MetricsResult,
  lens: CriteriaLens = 'as_judged_then',
): GradedRange {
  const graded = segments.map(segment => {
    const snap = clientHealthSnapshotForCriteria(metricsFor(segment), segment.criteria.gradePlan);
    return {
      start: segment.start,
      end: segment.end,
      tier: segments.length === 1 ? snap.worst_tier : snap.worst_tier,
      stock_version_id: segment.criteria.stockVersionId,
      custom_version_id: segment.criteria.customVersionId,
      profile: segment.criteria.profile,
      effective_start: segment.criteria.stockEffectiveStart,
      custom: segment.criteria.customVersionId != null && segment.criteria.customKeys.length > 0,
      criteria: segment.criteria,
      snapshotTier: snap.worst_tier,
      snap,
    };
  });
  return {
    segments: graded.map(({ snap: _snap, snapshotTier: _t, ...view }) => view),
    tier: graded.length === 1 ? graded[0].snapshotTier : null,
    writes: false,
    lens,
  };
}

export function gradeMetrics(criteria: ResolvedCriteria, metrics: MetricsResult) {
  return clientHealthSnapshotForCriteria(metrics, criteria.gradePlan);
}

export type HistoryChange = {
  key: KpiKey;
  layer: 'set_rule' | 'market' | 'reported' | 'yield';
  before: string;
  after: string;
};

function layerOf(key: KpiKey): HistoryChange['layer'] {
  if (SET_RULE_KEYS.includes(key)) return 'set_rule';
  if (MARKET_KEYS.includes(key)) return 'market';
  if (key === 'close_rate') return 'reported';
  return 'yield';
}

function bandLabel(band: StoredBand | { critical?: number; below?: number; at?: number } | undefined): string {
  if (!band) return 'unset';
  const edges = 'bands' in band ? band.bands : band;
  if (!edges || (edges.critical == null && edges.below == null && edges.at == null)) return 'unset';
  const min = 'minDenominator' in (band as StoredBand) && (band as StoredBand).minDenominator != null
    ? ` min ${(band as StoredBand).minDenominator}`
    : '';
  return `911 ${edges.critical ?? '—'} / Below ${edges.below ?? '—'} / At ${edges.at ?? '—'}${min}`;
}

export function diffBandMaps(
  previous: Partial<Record<KpiKey, StoredBand | { critical?: number; below?: number; at?: number }>> | null,
  next: Partial<Record<KpiKey, StoredBand | { critical?: number; below?: number; at?: number }>>,
): HistoryChange[] {
  const keys = new Set<KpiKey>([
    ...(Object.keys(previous ?? {}) as KpiKey[]),
    ...(Object.keys(next) as KpiKey[]),
  ]);
  const changes: HistoryChange[] = [];
  for (const key of keys) {
    const before = bandLabel(previous?.[key]);
    const after = bandLabel(next[key]);
    if (before === after) continue;
    changes.push({ key, layer: layerOf(key), before, after });
  }
  return changes;
}

export type HistoryRow = {
  id: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  effectiveLabel: string;
  createdBy: string | null;
  createdAt: string;
  note: string | null;
  first: boolean;
  changes: HistoryChange[];
};

function historyRows<T extends { id: string; effectiveStart: string; effectiveEnd: string | null; createdBy: string | null; createdAt: string; note: string | null }>(
  versions: T[],
  bandsOf: (row: T) => Partial<Record<KpiKey, StoredBand | { critical?: number; below?: number; at?: number }>>,
): HistoryRow[] {
  const closed = versions
    .filter(v => v.effectiveEnd != null)
    .slice()
    .sort((a, b) => a.effectiveStart.localeCompare(b.effectiveStart));
  return closed.map((row, index) => {
    const previous = index === 0 ? null : bandsOf(closed[index - 1]);
    return {
      id: row.id,
      effectiveStart: row.effectiveStart,
      effectiveEnd: row.effectiveEnd,
      effectiveLabel: `${row.effectiveStart} through ${dayBefore(row.effectiveEnd!)}`,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      note: row.note,
      first: index === 0,
      changes: index === 0 ? [] : diffBandMaps(previous, bandsOf(row)),
    };
  });
}

export function stockHistory(versions: StockVersion[], profile: CriteriaProfile): HistoryRow[] {
  return historyRows(
    versions.filter(v => v.profileId === profile),
    row => row.bands,
  );
}

export function customHistory(versions: CustomVersion[], clientId: string): HistoryRow[] {
  return historyRows(
    versions.filter(v => v.clientId === clientId),
    row => row.bands,
  );
}

export class ClosedVersionError extends Error {
  constructor() {
    super('Closed criteria versions cannot be updated');
    this.name = 'ClosedVersionError';
  }
}

/** Closed rows stay as they were. The only write on an open row is closing it. */
export function assertVersionUpdate(
  row: { effectiveEnd: string | null },
  patch: { bands?: unknown; effectiveStart?: string; effectiveEnd?: string | null; closeOnly?: boolean },
): void {
  if (row.effectiveEnd != null) throw new ClosedVersionError();
  if (patch.bands != null || patch.effectiveStart != null) throw new ClosedVersionError();
  if (!patch.closeOnly) throw new ClosedVersionError();
}

export function planStockSave(
  versions: StockVersion[],
  profile: CriteriaProfile,
  effectiveStart: string,
  today: string,
  bands: Partial<Record<KpiKey, StoredBand>>,
  placeholders: VersionPlaceholders,
  note: string | null,
): { versions: StockVersion[]; error?: string } {
  if (!effectiveStart) return { versions, error: 'Effective start is required' };
  if (effectiveStart < today) return { versions, error: 'Effective start cannot be before today' };
  const mine = versions.filter(v => v.profileId === profile);
  if (mine.some(v => v.effectiveStart === effectiveStart)) {
    return { versions, error: 'That start date is already a version. Pick a later date.' };
  }
  const open = mine.find(v => v.effectiveEnd == null);
  if (!open) return { versions, error: 'No open stock version' };
  if (effectiveStart <= open.effectiveStart) {
    return { versions, error: 'Effective start must be after the open version start' };
  }
  const closed = { ...open, effectiveEnd: effectiveStart };
  const next: StockVersion = {
    ...open,
    id: `${open.id}-from-${effectiveStart}`,
    effectiveStart,
    effectiveEnd: null,
    ruler: 'current',
    bands,
    placeholders,
    note,
    createdAt: `${effectiveStart}T00:00:00.000Z`,
  };
  return {
    versions: versions.map(v => (v.id === open.id ? closed : v)).concat(next),
  };
}

export function copyBands(bands: Partial<Record<KpiKey, StoredBand>>): Partial<Record<KpiKey, StoredBand>> {
  const out: Partial<Record<KpiKey, StoredBand>> = {};
  for (const [key, spec] of Object.entries(bands) as Array<[KpiKey, StoredBand]>) {
    out[key] = { ...spec, bands: { ...spec.bands } };
  }
  return out;
}

export function applyStockEdit(
  previous: Partial<Record<KpiKey, StoredBand>>,
  patch: Partial<Record<KpiKey, { critical?: number; below?: number; at?: number } | null>>,
): Partial<Record<KpiKey, StoredBand>> {
  const next = copyBands(previous);
  for (const [key, value] of Object.entries(patch) as Array<[KpiKey, { critical?: number; below?: number; at?: number } | null]>) {
    if (value == null) {
      delete next[key];
      continue;
    }
    const spec = next[key] ?? specFromDefault(key);
    next[key] = { ...spec, bands: { ...spec.bands, ...value } };
  }
  return next;
}

const KPI_KEYS = Object.keys(DEFAULT_KPI_BANDS) as KpiKey[];

export function normalizeOverlay(
  input: unknown,
  gradedKeys: KpiKey[],
): ClientKpiBenchmarks | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = new Set(gradedKeys);
  const out: ClientKpiBenchmarks = {};
  for (const key of KPI_KEYS) {
    if (!allowed.has(key)) continue;
    const raw = (input as Record<string, unknown>)[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const bands: { critical?: number; below?: number; at?: number } = {};
    for (const edge of ['critical', 'below', 'at'] as const) {
      const value = (raw as Record<string, unknown>)[edge];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) bands[edge] = value;
    }
    if (Object.keys(bands).length > 0) out[key] = bands;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Stored non-CPL keys the old grader ignored. Not backdated. */
export function ignoredStoredKeys(
  stored: ClientKpiBenchmarks | null | undefined,
  openOverlay: ClientKpiBenchmarks | null | undefined,
): KpiKey[] {
  if (!stored) return [];
  const openKeys = new Set(Object.keys(openOverlay ?? {}) as KpiKey[]);
  return (Object.keys(stored) as KpiKey[]).filter(key => key !== 'cpl' && !openKeys.has(key) && stored[key]);
}

export function segmentCaption(segment: CriteriaSegment): string {
  const custom = segment.criteria.customKeys.length > 0 ? 'custom' : 'stock';
  return `${segment.criteria.profile} from ${segment.criteria.stockEffectiveStart} (${custom})`;
}

export { tierFromBands };
