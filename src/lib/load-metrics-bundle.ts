/**
 * Shared dashboard metrics loader.
 * Prefer Postgres dashboard_kpi_* RPCs (counts + timeline + speed-to-lead summary);
 * fall back to shipping event rows only if an RPC is unavailable (dev / override).
 */

import {
  attachLoanDealMetrics,
  buildClientKpiTimeline,
  buildDailyCostSeries,
  calculateMetrics,
  daysInRange,
  rollupCostSeriesToWeeks,
  toCostTrendPoints,
  type CostTrendPoint,
  type EventRow,
  type KpiTimelineBucket,
  type MetricsResult,
} from '@/lib/metrics';
import { fetchLoanDealTotals } from '@/lib/loan-deals';
import {
  metricsFromSqlCounts,
  parseSqlKpiCounts,
  parseSqlSpeedToLeadSummary,
  parseSqlTimelineRows,
  speedResultFromSqlSummary,
  trendsFromSqlTimeline,
} from '@/lib/metrics-from-sql';
import { dialPoolForClient, withDialPoolRates, type DialPool } from '@/lib/dial-pool';
import { fetchCombinedSpendForMetrics, fetchCombinedTrendSpend } from '@/lib/spend';
import {
  getClientIdsByReportingType,
  getLiveClientIds,
  intersectClientFilters,
  liveClientFilter,
} from '@/lib/db-helpers';
import { createTtlCache } from '@/lib/ttl-cache';
import {
  computeSpeedToLead,
  type AvailabilityWindow,
  type SpeedToLeadEventRow,
  type SpeedToLeadResult,
} from '@/lib/speed-to-lead';
import { isClientLogFormRaw } from '@/lib/dq-reasons';
import { CALL_CENTER_TIMEZONE } from '@/lib/time';
import { enforceRowCap } from '@/lib/row-cap';
import {
  isClosedUtcRange,
  readMetricsRangeCache,
  writeMetricsRangeCache,
} from '@/lib/metrics-range-cache';
import type { createServiceClient } from '@/lib/supabase';
import type { SqlKpiCounts } from '@/lib/metrics-from-sql';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Fallback select when SQL RPCs are unavailable. */
export const METRICS_EVENT_SELECT =
  'client_id, event_type, ghl_contact_id, lead_phone, lead_email, lead_name, phone_number_used, agent_name, occurred_at, occurred_at_has_time, lead_created_at, is_pickup, is_conversation, is_qualified, is_hot, is_out_of_state, speed_to_lead_seconds';

const STL_EVENT_SELECT =
  'event_type, client_id, ghl_contact_id, lead_phone, phone_number_used, agent_name, occurred_at, occurred_at_has_time, lead_created_at';

/** Hard caps for residual row pulls (RPC path preferred). */
export const METRICS_EVENTS_ROW_LIMIT = 100_000;
export const STL_EVENTS_ROW_LIMIT = 100_000;

function isMissingRpcError(message: string, rpcName: string): boolean {
  return new RegExp(`${rpcName}|Could not find the function|schema cache`, 'i').test(message);
}

export type TrendsPayload = {
  granularity: 'day' | 'week';
  series: CostTrendPoint[];
  kpiSeries: KpiTimelineBucket[];
};

export type MetricsBundleFilters = {
  client_id?: string | null;
  live_only?: boolean;
  reporting_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type MetricsBundleResult = {
  metrics: MetricsResult;
  trends: TrendsPayload | null;
  /** Paid-ads single-client pool. Null on blends and call center. */
  dial_pool: DialPool | null;
  /** Present when a capped row pull hit its limit (dev / override only). */
  warnings?: string[];
};

type ScopedIds = string[] | null;

const bundleCache = createTtlCache<MetricsBundleResult>(30_000);
const availabilityCache = createTtlCache<AvailabilityWindow[]>(60_000);

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=15' } as const;

export function metricsCacheHeaders(): Record<string, string> {
  return { ...CACHE_HEADERS };
}

function filterKey(
  filters: MetricsBundleFilters,
  includeTrends: boolean,
  granularity: string,
  dialPool: DialPool | null,
): string {
  return [
    filters.client_id ?? '',
    filters.live_only ? '1' : '0',
    filters.reporting_type ?? '',
    filters.start_date ?? '',
    filters.end_date ?? '',
    includeTrends ? '1' : '0',
    granularity,
    dialPool ?? '',
  ].join('|');
}

async function lookupClientDialPool(
  service: ServiceClient,
  clientId: string | null | undefined,
): Promise<DialPool | null> {
  if (!clientId) return null;
  const { data, error } = await service
    .from('clients')
    .select('reporting_type, qualifies_leads')
    .eq('id', clientId)
    .maybeSingle();
  if (error || !data) return null;
  return dialPoolForClient(data.reporting_type, data.qualifies_leads);
}

async function resolveScopedClientIds(
  service: ServiceClient,
  filters: MetricsBundleFilters,
): Promise<ScopedIds> {
  let scoped: ScopedIds = null;
  if (filters.live_only && !filters.client_id) {
    scoped = await getLiveClientIds(service);
  }
  if (filters.reporting_type && !filters.client_id) {
    const offerIds = await getClientIdsByReportingType(service, filters.reporting_type);
    scoped = intersectClientFilters(scoped, offerIds);
  }
  return scoped;
}

async function loadAvailability(
  service: ServiceClient,
): Promise<{ data: AvailabilityWindow[]; error: string | null }> {
  const cached = availabilityCache.get('all');
  if (cached) return { data: cached, error: null };

  const { data, error } = await service
    .from('setter_availability')
    .select('weekday, time_start, time_end, is_live');
  if (error) return { data: [], error: error.message };
  const rows = (data ?? []) as AvailabilityWindow[];
  availabilityCache.set('all', rows);
  return { data: rows, error: null };
}

function resolveGranularity(
  start: string,
  end: string,
  granularityParam?: string | null,
): 'day' | 'week' {
  const dayCount = daysInRange(start, end);
  if (granularityParam === 'week' || granularityParam === 'day') return granularityParam;
  return dayCount > 90 ? 'week' : 'day';
}

function rpcClientIds(
  filters: MetricsBundleFilters,
  scopedClientIds: ScopedIds,
): string[] | null {
  if (filters.client_id) return [filters.client_id];
  if (scopedClientIds) return liveClientFilter(scopedClientIds);
  return null;
}

function rangeBounds(filters: MetricsBundleFilters): {
  startIso: string | null;
  endIso: string | null;
} {
  return {
    startIso: filters.start_date ? `${filters.start_date}T00:00:00.000Z` : null,
    endIso: filters.end_date ? `${filters.end_date}T23:59:59.999Z` : null,
  };
}

/**
 * Unique contacts with a client-log manual DQ in range.
 * Uses events_type_occurred_idx (event_type + occurred_at), then keeps form rows.
 */
async function countFormManualDqs(
  service: ServiceClient,
  clientIds: string[] | null,
  startIso: string | null,
  endIso: string | null,
): Promise<number> {
  const keys = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; from < 20_000; from += pageSize) {
    let q = service
      .from('events')
      .select('client_id, ghl_contact_id, lead_phone, raw')
      .eq('event_type', 'manual_dq')
      .order('occurred_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (clientIds && clientIds.length > 0) q = q.in('client_id', clientIds);
    if (startIso) q = q.gte('occurred_at', startIso);
    if (endIso) q = q.lte('occurred_at', endIso);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      if (!isClientLogFormRaw(row.raw)) continue;
      const id = (row.ghl_contact_id ?? '').trim() || (row.lead_phone ?? '').trim();
      if (!id) continue;
      keys.add(`${row.client_id}|${id}`);
    }
    if (rows.length < pageSize) break;
  }
  return keys.size;
}

async function fetchDealTotals(
  service: ServiceClient,
  filters: MetricsBundleFilters,
  scopedClientIds: ScopedIds,
) {
  return fetchLoanDealTotals(service, {
    client_id: filters.client_id,
    client_ids: scopedClientIds ? liveClientFilter(scopedClientIds) : null,
    start_date: filters.start_date,
    end_date: filters.end_date,
  });
}

async function fetchSpeedToLeadEvents(
  service: ServiceClient,
  filters: MetricsBundleFilters,
  scopedClientIds: ScopedIds,
): Promise<SpeedToLeadEventRow[]> {
  let q = service
    .from('events')
    .select(STL_EVENT_SELECT)
    .in('event_type', ['lead', 'dial']);
  if (filters.client_id) q = q.eq('client_id', filters.client_id);
  else if (scopedClientIds) q = q.in('client_id', liveClientFilter(scopedClientIds));
  if (filters.start_date) q = q.gte('occurred_at', `${filters.start_date}T00:00:00.000Z`);
  if (filters.end_date) q = q.lte('occurred_at', `${filters.end_date}T23:59:59.999Z`);
  q = q.limit(STL_EVENTS_ROW_LIMIT);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SpeedToLeadEventRow[];
  enforceRowCap(rows.length, STL_EVENTS_ROW_LIMIT, 'speed-to-lead events');
  return rows;
}

async function resolveSpeedToLead(
  service: ServiceClient,
  filters: MetricsBundleFilters,
  scopedClientIds: ScopedIds,
  clientIds: string[] | null,
  startIso: string | null,
  endIso: string | null,
): Promise<SpeedToLeadResult> {
  const stlRes = await service.rpc('dashboard_speed_to_lead_summary', {
    p_client_ids: clientIds,
    p_start: startIso,
    p_end: endIso,
    p_time_zone: CALL_CENTER_TIMEZONE,
  });

  if (!stlRes.error) {
    const summary = parseSqlSpeedToLeadSummary(stlRes.data);
    if (summary) return speedResultFromSqlSummary(summary);
  } else if (!isMissingRpcError(stlRes.error.message, 'dashboard_speed_to_lead_summary')) {
    throw new Error(stlRes.error.message);
  }

  // RPC missing / empty — fall back to row pull + JS (golden path for local / pre-migration).
  const [stlEvents, availability] = await Promise.all([
    fetchSpeedToLeadEvents(service, filters, scopedClientIds),
    loadAvailability(service),
  ]);
  if (availability.error) throw new Error(availability.error);
  return computeSpeedToLead(stlEvents, availability.data);
}

async function resolveKpiCounts(
  service: ServiceClient,
  clientIds: string[] | null,
  filters: MetricsBundleFilters,
  startIso: string | null,
  endIso: string | null,
): Promise<
  | { ok: true; counts: SqlKpiCounts }
  | { ok: false; missingRpc: true }
  | { ok: false; missingRpc: false; error: string }
> {
  if (filters.start_date && filters.end_date && isClosedUtcRange(filters.start_date, filters.end_date)) {
    const cached = await readMetricsRangeCache(
      service,
      clientIds,
      filters.start_date,
      filters.end_date,
    );
    if (cached) return { ok: true, counts: cached };
  }

  const countsRes = await service.rpc('dashboard_kpi_counts', {
    p_client_ids: clientIds,
    p_start: startIso,
    p_end: endIso,
  });

  if (countsRes.error) {
    if (isMissingRpcError(countsRes.error.message, 'dashboard_kpi_counts')) {
      return { ok: false, missingRpc: true };
    }
    return { ok: false, missingRpc: false, error: countsRes.error.message };
  }

  const counts = parseSqlKpiCounts(countsRes.data);
  if (!counts) {
    return { ok: false, missingRpc: false, error: 'dashboard_kpi_counts returned empty payload' };
  }

  if (filters.start_date && filters.end_date) {
    void writeMetricsRangeCache(
      service,
      clientIds,
      filters.start_date,
      filters.end_date,
      counts,
    ).catch(() => undefined);
  }

  return { ok: true, counts };
}

async function loadViaSql(
  service: ServiceClient,
  filters: MetricsBundleFilters,
  scopedClientIds: ScopedIds,
  opts: { includeTrends: boolean; granularity: 'day' | 'week'; dialPool: DialPool | null },
): Promise<MetricsBundleResult | null> {
  const clientIds = rpcClientIds(filters, scopedClientIds);
  const { startIso, endIso } = rangeBounds(filters);
  const spendFilters = {
    client_id: filters.client_id ?? undefined,
    client_ids: scopedClientIds,
    start_date: filters.start_date ?? undefined,
    end_date: filters.end_date ?? undefined,
  };

  const timelinePromise =
    opts.includeTrends && filters.start_date && filters.end_date
      ? service.rpc('dashboard_kpi_timeline', {
          p_client_ids: clientIds,
          p_start: filters.start_date,
          p_end: filters.end_date,
          p_granularity: opts.granularity,
        })
      : Promise.resolve({ data: null, error: null as { message: string } | null });

  // All-clients (null scope) + month windows: running counts + timeline + STL in
  // parallel saturates Postgres and hits statement timeout. Serialize counts first.
  const broadScope = clientIds == null;

  let countsResolved: Awaited<ReturnType<typeof resolveKpiCounts>>;
  let timelineRes: { data: unknown; error: { message: string } | null };
  let spendRows: Awaited<ReturnType<typeof fetchCombinedSpendForMetrics>>;
  let trendSpend: Awaited<ReturnType<typeof fetchCombinedTrendSpend>>;
  let speed: SpeedToLeadResult;
  let dealTotals: Awaited<ReturnType<typeof fetchDealTotals>>;

  if (broadScope) {
    countsResolved = await resolveKpiCounts(
      service,
      clientIds,
      filters,
      startIso,
      endIso,
    );
    [timelineRes, spendRows, trendSpend, speed, dealTotals] = await Promise.all([
      timelinePromise,
      fetchCombinedSpendForMetrics(service, spendFilters),
      opts.includeTrends
        ? fetchCombinedTrendSpend(service, spendFilters)
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchCombinedTrendSpend>>),
      resolveSpeedToLead(service, filters, scopedClientIds, clientIds, startIso, endIso),
      fetchDealTotals(service, filters, scopedClientIds),
    ]);
  } else {
    [
      countsResolved,
      timelineRes,
      spendRows,
      trendSpend,
      speed,
      dealTotals,
    ] = await Promise.all([
      resolveKpiCounts(service, clientIds, filters, startIso, endIso),
      timelinePromise,
      fetchCombinedSpendForMetrics(service, spendFilters),
      opts.includeTrends
        ? fetchCombinedTrendSpend(service, spendFilters)
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchCombinedTrendSpend>>),
      resolveSpeedToLead(service, filters, scopedClientIds, clientIds, startIso, endIso),
      fetchDealTotals(service, filters, scopedClientIds),
    ]);
  }

  if (!countsResolved.ok) {
    if (countsResolved.missingRpc) return null;
    throw new Error(countsResolved.error);
  }

  const metrics = withDialPoolRates(
    attachLoanDealMetrics(
      metricsFromSqlCounts(countsResolved.counts, spendRows, speed),
      dealTotals,
    ),
    opts.dialPool,
  );
  metrics.manual_dqs = await countFormManualDqs(service, clientIds, startIso, endIso);

  let trends: TrendsPayload | null = null;
  if (opts.includeTrends && filters.start_date && filters.end_date) {
    if (timelineRes.error) {
      if (isMissingRpcError(timelineRes.error.message, 'dashboard_kpi_timeline')) {
        return null;
      }
      throw new Error(timelineRes.error.message);
    }
    const rows = parseSqlTimelineRows(timelineRes.data);
    const built = trendsFromSqlTimeline(rows, trendSpend, opts.granularity, opts.dialPool);
    trends = {
      granularity: opts.granularity,
      series: built.series,
      kpiSeries: built.kpiSeries,
    };
  }

  return { metrics, trends, dial_pool: opts.dialPool };
}

async function loadViaEventsFallback(
  service: ServiceClient,
  filters: MetricsBundleFilters,
  scopedClientIds: ScopedIds,
  opts: { includeTrends: boolean; granularity: 'day' | 'week'; dialPool: DialPool | null },
): Promise<MetricsBundleResult> {
  let eventsQuery = service.from('events').select(METRICS_EVENT_SELECT);
  if (filters.client_id) eventsQuery = eventsQuery.eq('client_id', filters.client_id);
  else if (scopedClientIds) {
    eventsQuery = eventsQuery.in('client_id', liveClientFilter(scopedClientIds));
  }
  if (filters.start_date) {
    eventsQuery = eventsQuery.gte('occurred_at', `${filters.start_date}T00:00:00.000Z`);
  }
  if (filters.end_date) {
    eventsQuery = eventsQuery.lte('occurred_at', `${filters.end_date}T23:59:59.999Z`);
  }
  eventsQuery = eventsQuery.limit(METRICS_EVENTS_ROW_LIMIT);

  const spendFilters = {
    client_id: filters.client_id ?? undefined,
    client_ids: scopedClientIds,
    start_date: filters.start_date ?? undefined,
    end_date: filters.end_date ?? undefined,
  };

  const [{ data: events, error: eventsError }, spendRows, trendSpend, availability, dealTotals] =
    await Promise.all([
      eventsQuery,
      fetchCombinedSpendForMetrics(service, spendFilters),
      opts.includeTrends
        ? fetchCombinedTrendSpend(service, spendFilters)
        : Promise.resolve([]),
      loadAvailability(service),
      fetchDealTotals(service, filters, scopedClientIds),
    ]);

  if (eventsError) throw new Error(eventsError.message);
  if (availability.error) throw new Error(availability.error);

  const eventRows = (events ?? []) as EventRow[];
  const truncWarn = enforceRowCap(
    eventRows.length,
    METRICS_EVENTS_ROW_LIMIT,
    'metrics events fallback',
  );
  const metrics = withDialPoolRates(
    attachLoanDealMetrics(
      calculateMetrics(eventRows, spendRows, availability.data),
      dealTotals,
    ),
    opts.dialPool,
  );
  const { startIso, endIso } = rangeBounds(filters);
  metrics.manual_dqs = await countFormManualDqs(
    service,
    rpcClientIds(filters, scopedClientIds),
    startIso,
    endIso,
  );

  let trends: TrendsPayload | null = null;
  if (opts.includeTrends && filters.start_date && filters.end_date) {
    const trendEvents = eventRows.filter(
      (e): e is EventRow & { occurred_at: string } => Boolean(e.occurred_at),
    );
    const daily = buildDailyCostSeries(
      trendEvents,
      trendSpend,
      filters.start_date,
      filters.end_date,
    );
    const buckets =
      opts.granularity === 'week' ? rollupCostSeriesToWeeks(daily) : daily;
    trends = {
      granularity: opts.granularity,
      series: toCostTrendPoints(buckets),
      kpiSeries: buildClientKpiTimeline(
        trendEvents,
        trendSpend,
        filters.start_date,
        filters.end_date,
        opts.granularity,
        opts.dialPool,
      ),
    };
  }

  return {
    metrics,
    trends,
    dial_pool: opts.dialPool,
    ...(truncWarn ? { warnings: [truncWarn] } : {}),
  };
}

export async function loadMetricsBundle(
  service: ServiceClient,
  filters: MetricsBundleFilters,
  opts: {
    includeTrends?: boolean;
    granularity?: string | null;
  } = {},
): Promise<{ data: MetricsBundleResult | null; error: string | null }> {
  const includeTrends = Boolean(
    opts.includeTrends && filters.start_date && filters.end_date,
  );
  const granularity =
    includeTrends && filters.start_date && filters.end_date
      ? resolveGranularity(filters.start_date, filters.end_date, opts.granularity)
      : 'day';
  const dialPool = await lookupClientDialPool(service, filters.client_id);

  const cacheKey = filterKey(filters, includeTrends, granularity, dialPool);
  const cached = bundleCache.get(cacheKey);
  if (cached) return { data: cached, error: null };

  if (!includeTrends && filters.start_date && filters.end_date) {
    const g = resolveGranularity(filters.start_date, filters.end_date, opts.granularity);
    const hit = bundleCache.get(filterKey(filters, true, g, dialPool));
    if (hit) {
      const slim: MetricsBundleResult = { metrics: hit.metrics, trends: null, dial_pool: hit.dial_pool };
      bundleCache.set(cacheKey, slim);
      return { data: slim, error: null };
    }
  }

  try {
    const scopedClientIds = await resolveScopedClientIds(service, filters);
    const loadOpts = { includeTrends, granularity, dialPool };

    let result = await loadViaSql(service, filters, scopedClientIds, loadOpts);
    if (!result) {
      const allowEventsFallback =
        process.env.NODE_ENV !== 'production' ||
        process.env.ALLOW_METRICS_EVENTS_FALLBACK === '1';
      if (!allowEventsFallback) {
        throw new Error(
          'dashboard_kpi_* RPC unavailable; refusing events fallback in production. Apply KPI migrations or set ALLOW_METRICS_EVENTS_FALLBACK=1.',
        );
      }
      result = await loadViaEventsFallback(service, filters, scopedClientIds, loadOpts);
    }

    bundleCache.set(cacheKey, result);
    return { data: result, error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : 'Metrics load failed',
    };
  }
}
