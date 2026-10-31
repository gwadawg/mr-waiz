/**
 * Load per-client KPI snapshots for Client Compare.
 * Calendar window only — no matured-grading clamp.
 * Table-only: no cost-history / timeline series.
 */

import {
  compareRowFromMetrics,
  isDefaultRosterClient,
  type ClientCompareRow,
} from '@/lib/client-compare';
import {
  groupEventsByClient,
  groupSpendByClient,
  type ClientEventWithDate,
  type ClientKpiBenchmarks,
} from '@/lib/client-health';
import { gradeMetrics, resolveCriteriaSpans, type CriteriaLens } from '@/lib/kpi-criteria';
import { loadCriteriaCatalog } from '@/lib/kpi-criteria-store';
import { normalizeReportingType } from '@/lib/kpi-layouts';
import type { EventRow } from '@/lib/metrics';
import {
  emptySqlKpiCounts,
  metricsFromSqlCounts,
  parseSqlKpiCountsByClient,
  type SqlKpiCounts,
} from '@/lib/metrics-from-sql';
import { enforceRowCap } from '@/lib/row-cap';
import type { createServiceClient } from '@/lib/supabase';

const EVENT_SELECT =
  'client_id, occurred_at, event_type, is_pickup, is_conversation, speed_to_lead_seconds, is_qualified, is_hot, is_out_of_state, ghl_contact_id, lead_phone, lead_email, lead_name';

const COMPARE_EVENTS_ROW_LIMIT = 200_000;

type ServiceClient = ReturnType<typeof createServiceClient>;

type ClientRow = {
  id: string;
  name: string;
  reporting_type: string | null;
  lifecycle_status: string | null;
  billing_paused: boolean | null;
  kpi_benchmarks: unknown;
  qualifies_leads: boolean | null;
  service_program?: string | null;
};

type DatedSpend = { client_id: string; spend_date: string; amount: number; platform?: string };

function isoBound(start: string, end: string) {
  return {
    p_start: `${start}T00:00:00.000Z`,
    p_end: `${end}T23:59:59.999Z`,
  };
}

async function fetchCountsByClient(
  service: ServiceClient,
  start: string,
  end: string,
): Promise<Map<string, SqlKpiCounts> | null> {
  const { p_start, p_end } = isoBound(start, end);
  const { data, error } = await service.rpc('dashboard_kpi_counts_by_client', {
    p_client_ids: null,
    p_start,
    p_end,
  });
  if (error) {
    if (/dashboard_kpi_counts_by_client|Could not find the function|schema cache/i.test(error.message)) {
      return null;
    }
    throw new Error(error.message);
  }
  return parseSqlKpiCountsByClient(data);
}

async function fetchMetaSpend(
  service: ServiceClient,
  start: string,
  end: string,
): Promise<DatedSpend[]> {
  const { data, error } = await service
    .from('daily_meta_spend')
    .select('client_id, spend_date, amount')
    .gte('spend_date', start)
    .lte('spend_date', end);
  if (error) throw error;
  return (data ?? []).map(r => ({
    client_id: String(r.client_id),
    spend_date: String(r.spend_date).slice(0, 10),
    amount: Number(r.amount),
    platform: 'meta',
  }));
}

function includeClient(c: ClientRow, extraIds: Set<string>): boolean {
  if (extraIds.has(c.id)) return true;
  return isDefaultRosterClient({
    lifecycle_status: c.lifecycle_status,
    billing_paused: c.billing_paused,
  });
}

export type ClientCompareBundle = {
  period: { start: string; end: string };
  clients: ClientCompareRow[];
};

export async function loadClientCompareBundle(
  service: ServiceClient,
  opts: { start: string; end: string; extraIds?: string[]; lens?: CriteriaLens },
): Promise<ClientCompareBundle> {
  const extraIds = new Set((opts.extraIds ?? []).filter(Boolean));

  const { data: clients, error: clientsError } = await service
    .from('clients')
    .select('id, name, reporting_type, service_program, lifecycle_status, billing_paused, kpi_benchmarks, qualifies_leads')
    .order('name');
  if (clientsError) throw new Error(clientsError.message);

  const lens: CriteriaLens = opts.lens ?? 'as_judged_then';
  const catalog = await loadCriteriaCatalog(service).catch(() => ({ stock: [], custom: [] }));
  const roster = ((clients ?? []) as ClientRow[]).filter(c => includeClient(c, extraIds));
  const criteriaFor = (c: ClientRow) => {
    if (catalog.stock.length === 0) return null;
    const spans = resolveCriteriaSpans(
      {
        id: c.id,
        reportingType: c.reporting_type,
        serviceProgram: c.service_program,
        qualifiesLeads: c.qualifies_leads,
      },
      opts.start,
      opts.end,
      catalog,
      { lens },
    );
    return spans;
  };

  const [countsMap, spendRows] = await Promise.all([
    fetchCountsByClient(service, opts.start, opts.end),
    fetchMetaSpend(service, opts.start, opts.end),
  ]);

  const spendByClient = groupSpendByClient(spendRows);

  let rows: ClientCompareRow[];

  if (countsMap) {
    const spansByClient = new Map(roster.map(c => [c.id, criteriaFor(c)] as const));
    const extraRanges = new Map<string, { start: string; end: string }>();
    for (const spans of spansByClient.values()) {
      if (!spans || spans.segments.length < 2) continue;
      for (const seg of spans.segments) extraRanges.set(`${seg.start}|${seg.end}`, seg);
    }
    const extraCounts = new Map<string, Map<string, SqlKpiCounts>>();
    await Promise.all(
      [...extraRanges.entries()].map(async ([key, range]) => {
        const counts = await fetchCountsByClient(service, range.start, range.end);
        if (counts) extraCounts.set(key, counts);
      }),
    );
    const datedSpend = new Map<string, DatedSpend[]>();
    for (const row of spendRows) {
      const list = datedSpend.get(row.client_id) ?? [];
      list.push(row);
      datedSpend.set(row.client_id, list);
    }
    rows = roster.map(c => {
      const spend = spendByClient.get(c.id) ?? [];
      const metrics = metricsFromSqlCounts(countsMap.get(c.id) ?? emptySqlKpiCounts(), spend);
      const spans = spansByClient.get(c.id) ?? null;
      const metricsFor = (start: string, end: string) => {
        const sliced = extraCounts.get(`${start}|${end}`)?.get(c.id);
        if (!sliced) return metrics;
        const segSpend = (datedSpend.get(c.id) ?? [])
          .filter(row => row.spend_date >= start && row.spend_date <= end)
          .map(row => ({ amount: row.amount, platform: row.platform }));
        return metricsFromSqlCounts(sliced, segSpend);
      };
      return compareRowFromMetrics({
        id: c.id,
        name: c.name,
        reporting_type: normalizeReportingType(c.reporting_type),
        lifecycle_status: c.lifecycle_status,
        billing_paused: c.billing_paused,
        metrics,
        benchmarks: (c.kpi_benchmarks ?? null) as ClientKpiBenchmarks | null,
        qualifies_leads: c.qualifies_leads,
        criteria: spans?.single ?? null,
        criteria_split: Boolean(spans && spans.segments.length > 1),
        criteria_segments: spans && spans.segments.length > 1
          ? spans.segments.map(seg => ({
              start: seg.start,
              end: seg.end,
              tier: gradeMetrics(seg.criteria, metricsFor(seg.start, seg.end)).worst_tier,
              stock_version_id: seg.criteria.stockVersionId,
              custom_version_id: seg.criteria.customVersionId,
              profile: seg.criteria.profile,
              effective_start: seg.criteria.stockEffectiveStart,
              custom: seg.criteria.customKeys.length > 0,
            }))
          : null,
        criteria_replay: lens === 'on_todays_criteria',
        criteria_caption: spans && spans.segments.length > 1
          ? 'This range crosses a criteria change. Each side is graded on its own ruler.'
          : lens === 'on_todays_criteria'
            ? 'On today’s criteria. This is not the judgment that was made then.'
            : null,
      });
    });
  } else {
    const eventsRes = await service
      .from('events')
      .select(EVENT_SELECT)
      .gte('occurred_at', `${opts.start}T00:00:00.000Z`)
      .lte('occurred_at', `${opts.end}T23:59:59.999Z`)
      .limit(COMPARE_EVENTS_ROW_LIMIT);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    const events = (eventsRes.data ?? []) as ClientEventWithDate[];
    enforceRowCap(events.length, COMPARE_EVENTS_ROW_LIMIT, 'client-compare events fallback');
    const byClient = groupEventsByClient(events);
    const { calculateMetrics } = await import('@/lib/metrics');
    rows = roster.map(c => {
      const spend = spendByClient.get(c.id) ?? [];
      const clientEvents = (byClient.get(c.id) ?? []) as EventRow[];
      const spans = criteriaFor(c);
      const metricsFor = (start: string, end: string) => {
        const ev = clientEvents.filter(e => {
          const at = (e as ClientEventWithDate).occurred_at ?? '';
          return at >= `${start}T00:00:00.000Z` && at <= `${end}T23:59:59.999Z`;
        });
        const segSpend = spend.filter(row => {
          const dated = row as { spend_date?: string };
          return !dated.spend_date || (dated.spend_date >= start && dated.spend_date <= end);
        });
        return calculateMetrics(ev, segSpend);
      };
      return compareRowFromMetrics({
        id: c.id,
        name: c.name,
        reporting_type: normalizeReportingType(c.reporting_type),
        lifecycle_status: c.lifecycle_status,
        billing_paused: c.billing_paused,
        metrics: calculateMetrics(clientEvents, spend),
        benchmarks: (c.kpi_benchmarks ?? null) as ClientKpiBenchmarks | null,
        qualifies_leads: c.qualifies_leads,
        criteria: spans?.single ?? null,
        criteria_split: Boolean(spans && spans.segments.length > 1),
        criteria_segments: spans && spans.segments.length > 1
          ? spans.segments.map(seg => ({
              start: seg.start,
              end: seg.end,
              tier: gradeMetrics(seg.criteria, metricsFor(seg.start, seg.end)).worst_tier,
              stock_version_id: seg.criteria.stockVersionId,
              custom_version_id: seg.criteria.customVersionId,
              profile: seg.criteria.profile,
              effective_start: seg.criteria.stockEffectiveStart,
              custom: seg.criteria.customKeys.length > 0,
            }))
          : null,
        criteria_replay: lens === 'on_todays_criteria',
        criteria_caption: spans && spans.segments.length > 1
          ? 'This range crosses a criteria change. Each side is graded on its own ruler.'
          : lens === 'on_todays_criteria'
            ? 'On today’s criteria. This is not the judgment that was made then.'
            : null,
      });
    });
  }

  return {
    period: { start: opts.start, end: opts.end },
    clients: rows,
  };
}
