/**
 * Shared loader for client-health rows — used by /api/client-health and /api/ops-overview.
 * Prefers per-client SQL KPI aggregates; falls back to shipping event rows if RPCs missing.
 */

import {
  buildClientHealthRow,
  clientHealthSnapshotFromMetrics,
  heClientHealthSnapshotFromMetrics,
  recentLeadingFromMetrics,
  freshLaunchFromMetrics,
  type CriteriaSegmentView,
  getPriorPeriod,
  getRecentPriorPeriod,
  groupEventsByClient,
  groupSpendByClient,
  maturedWindow,
  calendarLeadingWindow,
  isFreshLaunchClient,
  freshLaunchWindow,
  filterEventsToRange,
  compareHealthTrend,
  computeFocus,
  MATURITY_DAYS,
  FRESH_LAUNCH_DAYS,
  type ClientEventWithDate,
  type ClientHealthRow,
  type ClientHealthSnapshot,
  type ClientKpiBenchmarks,
  type CostWindowSlice,
  type FreshLaunchSnapshot,
  type OpenActionSummary,
  type PendingIntervention,
  type RecentLeading,
} from '@/lib/client-health';
import { OPEN_ACTION_STATUSES, summarizeOpenAction, type ActionLogRow } from '@/lib/client-health-interventions';
import { normalizeReportingType, usesCallCenterKpiLayout } from '@/lib/kpi-layouts';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';
import { enforceRowCap } from '@/lib/row-cap';
import { calculateMetrics, type EventRow, type MetricsResult, type SpendRow } from '@/lib/metrics';
import {
  emptySqlKpiCounts,
  metricsFromSqlCounts,
  parseSqlKpiCountsByClient,
  type SqlKpiCounts,
} from '@/lib/metrics-from-sql';
import {
  gradeMetrics,
  resolveCriteriaSpans,
  seedStockVersions,
  type CriteriaCatalog,
  type CriteriaClient,
  type CriteriaLens,
  type SpanResolution,
} from '@/lib/kpi-criteria';
import { loadCriteriaCatalog } from '@/lib/kpi-criteria-store';
import type { createServiceClient } from '@/lib/supabase';

const EVENT_SELECT =
  'client_id, occurred_at, event_type, is_pickup, is_conversation, speed_to_lead_seconds, is_qualified, is_hot, is_out_of_state, ghl_contact_id, lead_phone, lead_email, lead_name';

type SpendByClientRow = {
  client_id: string;
  spend_date: string;
  amount: number;
  platform?: string;
};

type ActionRow = ActionLogRow;
type ServiceClient = ReturnType<typeof createServiceClient>;

function spendInRange(rows: SpendByClientRow[], start: string, end: string): SpendByClientRow[] {
  return rows.filter(r => r.spend_date >= start && r.spend_date <= end);
}

function pickOpenAction(actions: ActionRow[], today: string): OpenActionSummary | null {
  const open = actions.filter(a =>
    OPEN_ACTION_STATUSES.includes(a.status as (typeof OPEN_ACTION_STATUSES)[number]),
  );
  if (open.length === 0) return null;
  open.sort((a, b) => {
    const ad = a.review_date ?? '9999-12-31';
    const bd = b.review_date ?? '9999-12-31';
    return ad.localeCompare(bd);
  });
  const a = open[0];
  return {
    id: a.id,
    title: a.title,
    review_date: a.review_date,
    status: a.status,
    overdue: !!a.review_date && a.review_date < today,
  };
}

async function fetchMetaSpendByClient(
  service: ServiceClient,
  filters: { start_date: string; end_date: string; client_ids: string[] | null },
): Promise<SpendByClientRow[]> {
  let q = service.from('daily_meta_spend').select('client_id, spend_date, amount');
  if (filters.client_ids?.length) q = q.in('client_id', liveClientFilter(filters.client_ids));
  q = q.gte('spend_date', filters.start_date);
  q = q.lte('spend_date', filters.end_date);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(r => ({
    client_id: String(r.client_id),
    spend_date: String(r.spend_date),
    amount: Number(r.amount),
    platform: 'meta',
  }));
}

function isoBound(start: string, end: string) {
  return {
    p_start: `${start}T00:00:00.000Z`,
    p_end: `${end}T23:59:59.999Z`,
  };
}

async function fetchCountsByClient(
  service: ServiceClient,
  clientIds: string[] | null,
  start: string,
  end: string,
): Promise<Map<string, SqlKpiCounts> | null> {
  const { p_start, p_end } = isoBound(start, end);
  const { data, error } = await service.rpc('dashboard_kpi_counts_by_client', {
    p_client_ids: clientIds,
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

async function fetchFreshLaunchCounts(
  service: ServiceClient,
  clientIds: string[] | null,
  today: string,
): Promise<Map<string, SqlKpiCounts> | null> {
  const { data, error } = await service.rpc('fresh_launch_kpi_counts_by_client', {
    p_client_ids: clientIds,
    p_today: today,
    p_fresh_days: FRESH_LAUNCH_DAYS,
  });
  if (error) {
    if (/fresh_launch_kpi_counts_by_client|Could not find the function|schema cache/i.test(error.message)) {
      return null;
    }
    throw new Error(error.message);
  }
  return parseSqlKpiCountsByClient(data);
}

function metricsForClient(
  countsMap: Map<string, SqlKpiCounts>,
  clientId: string,
  spend: SpendRow[],
): MetricsResult {
  return metricsFromSqlCounts(countsMap.get(clientId) ?? emptySqlKpiCounts(), spend);
}

function snapshotFor(
  isHe: boolean,
  metrics: MetricsResult,
  benchmarks: ClientKpiBenchmarks | null,
): ClientHealthSnapshot {
  return isHe
    ? heClientHealthSnapshotFromMetrics(metrics, benchmarks)
    : clientHealthSnapshotFromMetrics(metrics, benchmarks);
}

function criteriaClient(c: {
  id: string;
  reporting_type: string | null;
  service_program?: string | null;
  qualifies_leads?: boolean | null;
}): CriteriaClient {
  return {
    id: c.id,
    reportingType: c.reporting_type,
    serviceProgram: c.service_program,
    qualifiesLeads: c.qualifies_leads,
  };
}

function spansFor(
  c: Parameters<typeof criteriaClient>[0],
  start: string,
  end: string,
  catalog: CriteriaCatalog,
  lens: CriteriaLens,
): SpanResolution {
  return resolveCriteriaSpans(criteriaClient(c), start, end, catalog, { lens });
}

export type ClientHealthBundle = {
  period: { start: string; end: string };
  prior_period: { start: string; end: string } | null;
  maturity: {
    days: number;
    matured_through: string;
    clamped: boolean;
    empty: boolean;
    leading_window_days: number;
    leading_start: string;
    leading_end: string;
    leading_prior_start: string | null;
    leading_prior_end: string | null;
    recent_window_days: number;
    recent_start: string;
    recent_end: string;
    recent_prior_start: string | null;
    recent_prior_end: string | null;
  };
  summary: {
    act_now: number;
    monitor: number;
    recovering: number;
    on_track: number;
    follow_up_due: number;
    follow_up_overdue: number;
    fresh_launch_count: number;
  };
  pending_interventions: PendingIntervention[];
  clients: ClientHealthRow[];
};

function assembleBundle(
  clients: Array<{
    id: string;
    name: string;
    is_live: boolean | null;
    reporting_type: string | null;
    kpi_benchmarks: unknown;
    launch_date: string | null;
    lifecycle_status?: string | null;
  }>,
  rows: ClientHealthRow[],
  actionRows: ActionRow[] | null,
  start_date: string,
  end_date: string,
  verdictPrior: { start: string; end: string } | null,
  matured: ReturnType<typeof maturedWindow>,
  leading: ReturnType<typeof calendarLeadingWindow>,
  leadingPrior: { start: string; end: string } | null,
  today: string,
): ClientHealthBundle {
  const fresh_launch_count = rows.filter(r => r.is_fresh_launch).length;
  const follow_up_due = rows.filter(r => r.open_action?.review_date).length;
  const follow_up_overdue = rows.filter(r => r.open_action?.overdue).length;

  const clientNameById = new Map(clients.map(c => [c.id, c.name]));
  const clientTypeById = new Map(
    clients.map(c => [c.id, normalizeReportingType(c.reporting_type)]),
  );

  const pending_interventions: PendingIntervention[] = (actionRows ?? [])
    .map(a => {
      const row = a as ActionRow;
      const summary = summarizeOpenAction(row, today);
      return {
        id: row.id,
        client_id: row.client_id,
        client_name: clientNameById.get(row.client_id) ?? 'Unknown',
        reporting_type: clientTypeById.get(row.client_id) ?? 'RM',
        title: row.title,
        status: row.status,
        success_metric: row.success_metric,
        change_date: row.change_date,
        review_date: row.review_date,
        baseline_value: row.baseline_value != null ? Number(row.baseline_value) : null,
        outcome_value: row.outcome_value != null ? Number(row.outcome_value) : null,
        overdue: summary.overdue,
        review_due: !!row.review_date && row.review_date <= today,
      };
    })
    .sort((a, b) => {
      if (a.review_due !== b.review_due) return a.review_due ? -1 : 1;
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const ad = a.review_date ?? '9999-12-31';
      const bd = b.review_date ?? '9999-12-31';
      return ad.localeCompare(bd);
    });

  return {
    period: { start: start_date, end: end_date },
    prior_period: verdictPrior,
    maturity: {
      days: matured.maturity_days,
      matured_through: matured.matured_through,
      clamped: matured.clamped,
      empty: matured.empty,
      leading_window_days: leading.window_days,
      leading_start: leading.start,
      leading_end: leading.end,
      leading_prior_start: leadingPrior?.start ?? null,
      leading_prior_end: leadingPrior?.end ?? null,
      recent_window_days: leading.window_days,
      recent_start: leading.start,
      recent_end: leading.end,
      recent_prior_start: leadingPrior?.start ?? null,
      recent_prior_end: leadingPrior?.end ?? null,
    },
    summary: {
      act_now: rows.filter(r => r.focus.focus === 'act_now' && r.has_activity && !r.is_fresh_launch).length,
      monitor: rows.filter(r => r.focus.focus === 'monitor' && r.has_activity && !r.is_fresh_launch).length,
      recovering: rows.filter(r => r.focus.focus === 'recovering' && r.has_activity && !r.is_fresh_launch).length,
      on_track: rows.filter(r => r.focus.focus === 'on_track' && r.has_activity && !r.is_fresh_launch).length,
      follow_up_due,
      follow_up_overdue,
      fresh_launch_count,
    },
    pending_interventions,
    clients: rows,
  };
}

export async function loadClientHealthBundle(
  service: ServiceClient,
  opts: { start_date: string; end_date: string; live_only?: boolean; lens?: CriteriaLens },
): Promise<ClientHealthBundle> {
  const { start_date, end_date, live_only = false } = opts;
  const lens: CriteriaLens = opts.lens ?? 'as_judged_then';
  const today = new Date().toISOString().split('T')[0];
  const matured = maturedWindow(start_date, end_date);
  const verdictPrior = getPriorPeriod(start_date, end_date);
  const leading = calendarLeadingWindow();
  const leadingPrior = getRecentPriorPeriod(leading.start, leading.end);

  let clientQuery = service
    .from('clients')
    .select('id, name, is_live, reporting_type, service_program, qualifies_leads, kpi_benchmarks, launch_date, lifecycle_status')
    .order('name');

  if (live_only) clientQuery = clientQuery.eq('is_live', true);

  let liveClientIds: string[] | null = null;
  if (live_only) {
    liveClientIds = await getLiveClientIds(service);
  }

  const { data: clients, error: clientsError } = await clientQuery;
  if (clientsError) throw new Error(clientsError.message);

  const catalog: CriteriaCatalog = await loadCriteriaCatalog(service).catch(() => ({
    stock: seedStockVersions(today),
    custom: [],
  }));

  const rangeStart = [verdictPrior?.start, leadingPrior?.start, start_date]
    .concat(
      (clients ?? [])
        .filter(c => isFreshLaunchClient(c.launch_date as string | null, today))
        .map(c => c.launch_date as string),
    )
    .filter(Boolean)
    .sort()[0] as string;
  const rangeEnd = leading.end > end_date ? leading.end : end_date;

  const spendFilters = {
    start_date: rangeStart,
    end_date: rangeEnd,
    client_ids: liveClientIds,
  };

  let actionsQuery = service
    .from('client_action_logs')
    .select(
      'id, client_id, title, review_date, status, created_at, change_date, success_metric, baseline_value, target_value, baseline_snapshot_id, outcome_value, outcome_recorded_at, work_type',
    )
    .in('status', [...OPEN_ACTION_STATUSES])
    .eq('work_type', 'bet');
  if (liveClientIds?.length) {
    actionsQuery = actionsQuery.in('client_id', liveClientFilter(liveClientIds));
  }

  const rpcClientIds = liveClientIds ? liveClientFilter(liveClientIds) : null;

  const [
    verdictCounts,
    priorCounts,
    recentCounts,
    recentPriorCounts,
    freshCounts,
    { data: actionRows, error: actionsError },
    metaSpend,
  ] = await Promise.all([
    fetchCountsByClient(service, rpcClientIds, start_date, end_date),
    verdictPrior
      ? fetchCountsByClient(service, rpcClientIds, verdictPrior.start, verdictPrior.end)
      : Promise.resolve(new Map<string, SqlKpiCounts>()),
    fetchCountsByClient(service, rpcClientIds, leading.start, leading.end),
    leadingPrior
      ? fetchCountsByClient(service, rpcClientIds, leadingPrior.start, leadingPrior.end)
      : Promise.resolve(new Map<string, SqlKpiCounts>()),
    fetchFreshLaunchCounts(service, rpcClientIds, today),
    actionsQuery,
    fetchMetaSpendByClient(service, spendFilters),
  ]);

  // Interventions are additive. A missing column/query must not blank the roster.
  if (actionsError) {
    console.error('[client-health] action logs query failed:', actionsError.message);
  }
  const safeActionRows = (actionsError ? [] : actionRows) ?? [];

  const sqlReady =
    verdictCounts != null &&
    priorCounts != null &&
    recentCounts != null &&
    recentPriorCounts != null &&
    freshCounts != null;

  if (sqlReady) {
    const spendRows = [...metaSpend];
    const spendByClientFn = (rows: SpendByClientRow[]) =>
      groupSpendByClient(rows.map(({ client_id, amount, platform }) => ({ client_id, amount, platform })));

    const currentSpendByClient = spendByClientFn(spendInRange(spendRows, start_date, end_date));
    const priorSpendByClient = verdictPrior
      ? spendByClientFn(spendInRange(spendRows, verdictPrior.start, verdictPrior.end))
      : new Map<string, SpendRow[]>();
    const recentSpendByClient = spendByClientFn(spendInRange(spendRows, leading.start, leading.end));
    const recentPriorSpendByClient = leadingPrior
      ? spendByClientFn(spendInRange(spendRows, leadingPrior.start, leadingPrior.end))
      : new Map<string, SpendRow[]>();

    const actionsByClient = new Map<string, ActionRow[]>();
    for (const a of safeActionRows) {
      const list = actionsByClient.get(a.client_id) ?? [];
      list.push(a as ActionRow);
      actionsByClient.set(a.client_id, list);
    }

    const rangeKey = (start: string, end: string) => `${start}|${end}`;
    const extraRanges = new Map<string, { start: string; end: string }>();
    const noteSpans = (c: (typeof clients)[number], start: string, end: string) => {
      const spans = spansFor(c, start, end, catalog, lens);
      if (
        spans.segments.length !== 1 ||
        spans.segments[0].start !== start ||
        spans.segments[0].end !== end
      ) {
        for (const seg of spans.segments) extraRanges.set(rangeKey(seg.start, seg.end), seg);
      }
      return spans;
    };
    for (const c of clients ?? []) {
      noteSpans(c, start_date, end_date);
      if (verdictPrior) noteSpans(c, verdictPrior.start, verdictPrior.end);
      noteSpans(c, leading.start, leading.end);
      if (leadingPrior) noteSpans(c, leadingPrior.start, leadingPrior.end);
      if (c.launch_date && isFreshLaunchClient(c.launch_date as string | null, today)) {
        const win = freshLaunchWindow(c.launch_date as string, today);
        noteSpans(c, win.start, win.end);
      }
    }
    const extraCounts = new Map<string, Map<string, SqlKpiCounts>>();
    await Promise.all(
      [...extraRanges.entries()].map(async ([key, range]) => {
        const counts = await fetchCountsByClient(service, rpcClientIds, range.start, range.end);
        if (counts) extraCounts.set(key, counts);
      }),
    );

    const metricsForSpan = (
      c: (typeof clients)[number],
      start: string,
      end: string,
      fallback: Map<string, SqlKpiCounts>,
      spend: SpendRow[],
    ) => {
      const counts = extraCounts.get(rangeKey(start, end)) ?? fallback;
      return metricsForClient(counts, c.id, spend);
    };

    const rows: ClientHealthRow[] = (clients ?? []).map(c => {
      const benchmarks = (c.kpi_benchmarks ?? null) as ClientKpiBenchmarks | null;
      const reporting_type = normalizeReportingType(c.reporting_type);
      const isHe = usesCallCenterKpiLayout(reporting_type);
      const launch_date = (c.launch_date as string | null) ?? null;

      const verdictMetrics = metricsForClient(verdictCounts, c.id, currentSpendByClient.get(c.id) ?? []);
      const priorMetrics = verdictPrior
        ? metricsForClient(priorCounts, c.id, priorSpendByClient.get(c.id) ?? [])
        : null;
      const recentMetrics = metricsForClient(
        recentCounts,
        c.id,
        isHe ? [] : recentSpendByClient.get(c.id) ?? [],
      );
      const recentPriorMetrics =
        leadingPrior != null
          ? metricsForClient(
              recentPriorCounts,
              c.id,
              isHe ? [] : recentPriorSpendByClient.get(c.id) ?? [],
            )
          : null;
      // RM cost slice uses the same leading window (fresh cost = leading).
      const costMetrics = isHe
        ? null
        : metricsForClient(recentCounts, c.id, recentSpendByClient.get(c.id) ?? []);
      const costPriorMetrics =
        isHe || !leadingPrior
          ? null
          : metricsForClient(recentPriorCounts, c.id, recentPriorSpendByClient.get(c.id) ?? []);

      const verdictSpans = spansFor(c, start_date, end_date, catalog, lens);
      const priorSpans = verdictPrior
        ? spansFor(c, verdictPrior.start, verdictPrior.end, catalog, lens)
        : null;
      const leadingSpans = spansFor(c, leading.start, leading.end, catalog, lens);
      const criteriaSegments: CriteriaSegmentView[] | null = verdictSpans.segments.length > 1
        ? verdictSpans.segments.map(seg => {
            const segSpend = spendInRange(spendRows.filter(r => r.client_id === c.id), seg.start, seg.end)
              .map(({ amount, platform }) => ({ amount, platform }));
            const segSnap = gradeMetrics(
              seg.criteria,
              metricsForSpan(c, seg.start, seg.end, verdictCounts, segSpend),
            );
            return {
              start: seg.start,
              end: seg.end,
              tier: segSnap.worst_tier,
              stock_version_id: seg.criteria.stockVersionId,
              custom_version_id: seg.criteria.customVersionId,
              profile: seg.criteria.profile,
              effective_start: seg.criteria.stockEffectiveStart,
              custom: seg.criteria.customKeys.length > 0,
            };
          })
        : null;
      const current = verdictSpans.single
        ? gradeMetrics(verdictSpans.single, verdictMetrics)
        : snapshotFor(isHe, verdictMetrics, benchmarks);
      const priorSnapshot = priorSpans?.single && priorMetrics != null
        ? gradeMetrics(priorSpans.single, priorMetrics)
        : priorMetrics != null
          ? snapshotFor(isHe, priorMetrics, benchmarks)
          : null;
      const sameRuler = Boolean(
        verdictSpans.single &&
        priorSpans?.single &&
        verdictSpans.single.stockVersionId === priorSpans.single.stockVersionId &&
        verdictSpans.single.customVersionId === priorSpans.single.customVersionId,
      );

      const recentPriorLeading =
        recentPriorMetrics != null && leadingPrior != null
          ? recentLeadingFromMetrics({
              funnel: recentPriorMetrics,
              cost: costPriorMetrics,
              start: leadingPrior.start,
              end: leadingPrior.end,
              windowDays: leading.window_days,
              reportingType: reporting_type,
              benchmarks,
              criteria: leadingSpans.single?.gradePlan ?? null,
              prior: null,
              costWindow: costPriorMetrics
                ? { ...leadingPrior, window_days: leading.window_days }
                : null,
            })
          : null;

      const recentLeading = recentLeadingFromMetrics({
        funnel: recentMetrics,
        cost: costMetrics,
        start: leading.start,
        end: leading.end,
        windowDays: leading.window_days,
        reportingType: reporting_type,
        benchmarks,
        criteria: leadingSpans.single?.gradePlan ?? null,
        prior: recentPriorLeading,
        costWindow: costMetrics ? leading : null,
      });

      const fresh: FreshLaunchSnapshot | null =
        launch_date != null && isFreshLaunchClient(launch_date, today)
          ? freshLaunchFromMetrics(
              metricsForClient(
                freshCounts,
                c.id,
                spendInRange(
                  spendRows.filter(r => r.client_id === c.id),
                  freshLaunchWindow(launch_date, today).start,
                  freshLaunchWindow(launch_date, today).end,
                ).map(({ amount, platform }) => ({ amount, platform })),
              ),
              launch_date,
              reporting_type,
              benchmarks,
              today,
              spansFor(
                c,
                freshLaunchWindow(launch_date, today).start,
                freshLaunchWindow(launch_date, today).end,
                catalog,
                lens,
              ).single?.gradePlan ?? null,
            )
          : null;

      const trendResult = sameRuler && !criteriaSegments
        ? compareHealthTrend(current, priorSnapshot)
        : { trend: 'insufficient' as const, trend_delta_score: 0 };
      const { trend, trend_delta_score } = trendResult;
      const focus = criteriaSegments
        ? {
            focus: 'monitor' as const,
            label: 'Ruler changed',
            verdict_critical: false,
            leading_critical: false,
          }
        : computeFocus(current, recentLeading, reporting_type);
      const has_activity =
        current.metrics.new_leads > 0 ||
        current.metrics.booked_appointments > 0 ||
        current.metrics.ad_spend > 0 ||
        recentLeading.leads > 0 ||
        recentLeading.dials > 0 ||
        (fresh?.leads ?? 0) > 0 ||
        (fresh?.dials ?? 0) > 0;

      // Reuse buildClientHealthRow shape by calling it with empty events then overlaying
      // would drop fields — assemble the row explicitly from existing helpers' outputs.
      const emptyRow = buildClientHealthRow({
        client_id: c.id,
        client_name: c.name,
        is_live: c.is_live !== false,
        reporting_type,
        benchmarks,
        verdictEvents: [],
        priorEvents: [],
        recentEvents: [],
        recentPriorEvents: [],
        verdictSpend: currentSpendByClient.get(c.id) ?? [],
        priorSpend: priorSpendByClient.get(c.id) ?? [],
        recentSpend: recentSpendByClient.get(c.id) ?? [],
        recentPriorSpend: recentPriorSpendByClient.get(c.id) ?? [],
        start_date,
        end_date,
        verdictPrior,
        open_action: pickOpenAction(actionsByClient.get(c.id) ?? [], today),
        launch_date,
        freshLaunchEvents: [],
        freshLaunchSpend: [],
        today,
      });

      return {
        ...emptyRow,
        current,
        prior: priorSnapshot,
        recent: recentLeading,
        recent_prior: recentPriorLeading,
        trend,
        trend_delta_score,
        focus,
        has_activity,
        is_fresh_launch: fresh != null,
        fresh,
        graded_keys: verdictSpans.single?.gradedKeys,
        criteria_lens: lens,
        criteria_replay: lens === 'on_todays_criteria',
        criteria_split: Boolean(criteriaSegments),
        criteria_segments: criteriaSegments,
        criteria_caption: criteriaSegments
          ? 'This range crosses a criteria change. Each side is graded on its own ruler.'
          : lens === 'on_todays_criteria'
            ? 'On today’s criteria. This is not the judgment that was made then.'
            : verdictSpans.single
              ? `${verdictSpans.single.profile} from ${verdictSpans.single.stockEffectiveStart}${verdictSpans.single.customKeys.length ? ' · custom' : ' · stock'}`
              : null,
      };
    });

    return assembleBundle(
      clients ?? [],
      rows,
      safeActionRows as ActionRow[],
      start_date,
      end_date,
      verdictPrior,
      matured,
      leading,
      leadingPrior,
      today,
    );
  }

  // ── Fallback: original event-row pull ─────────────────────────────────────
  let eventsQuery = service.from('events').select(EVENT_SELECT);
  if (liveClientIds) eventsQuery = eventsQuery.in('client_id', liveClientFilter(liveClientIds));
  eventsQuery = eventsQuery.gte('occurred_at', `${rangeStart}T00:00:00.000Z`);
  eventsQuery = eventsQuery.lte('occurred_at', `${rangeEnd}T23:59:59.999Z`);
  eventsQuery = eventsQuery.limit(200000);

  const { data: events, error: eventsError } = await eventsQuery;
  if (eventsError) throw new Error(eventsError.message);

  const allEvents = (events ?? []) as ClientEventWithDate[];
  enforceRowCap(allEvents.length, 200000, 'client-health events fallback');
  const inRange = (e: ClientEventWithDate, s: string, en: string) =>
    e.occurred_at >= `${s}T00:00:00.000Z` && e.occurred_at <= `${en}T23:59:59.999Z`;

  const verdictEvents = allEvents.filter(e => inRange(e, start_date, end_date));
  const priorEvents = verdictPrior
    ? allEvents.filter(e => inRange(e, verdictPrior.start, verdictPrior.end))
    : [];
  const recentEvents = allEvents.filter(e => inRange(e, leading.start, leading.end));
  const recentPriorEvents = leadingPrior
    ? allEvents.filter(e => inRange(e, leadingPrior.start, leadingPrior.end))
    : [];

  const spendRows = [...metaSpend];
  const verdictSpend = spendInRange(spendRows, start_date, end_date);
  const priorSpend = verdictPrior
    ? spendInRange(spendRows, verdictPrior.start, verdictPrior.end)
    : [];
  const recentSpend = spendInRange(spendRows, leading.start, leading.end);
  const recentPriorSpend = leadingPrior
    ? spendInRange(spendRows, leadingPrior.start, leadingPrior.end)
    : [];

  const currentByClient = groupEventsByClient(verdictEvents);
  const priorByClient = groupEventsByClient(priorEvents);
  const recentByClient = groupEventsByClient(recentEvents);
  const recentPriorByClient = groupEventsByClient(recentPriorEvents);

  const spendByClient = (rows: SpendByClientRow[]) =>
    groupSpendByClient(rows.map(({ client_id, amount, platform }) => ({ client_id, amount, platform })));

  const currentSpendByClient = spendByClient(verdictSpend);
  const priorSpendByClient = spendByClient(priorSpend);
  const recentSpendByClient = spendByClient(recentSpend);
  const recentPriorSpendByClient = spendByClient(recentPriorSpend);

  const freshCostByClient = groupEventsByClient(recentEvents);
  const freshCostPriorByClient = groupEventsByClient(recentPriorEvents);
  const freshCostSpendByClient = spendByClient(recentSpend);
  const freshCostPriorSpendByClient = spendByClient(recentPriorSpend);

  const actionsByClient = new Map<string, ActionRow[]>();
  for (const a of safeActionRows) {
    const list = actionsByClient.get(a.client_id) ?? [];
    list.push(a as ActionRow);
    actionsByClient.set(a.client_id, list);
  }

  const allEventsByClient = groupEventsByClient(allEvents);

  const rows = (clients ?? []).map(c => {
    const benchmarks = (c.kpi_benchmarks ?? null) as ClientKpiBenchmarks | null;
    const reporting_type = normalizeReportingType(c.reporting_type);
    const isHe = usesCallCenterKpiLayout(reporting_type);
    const launch_date = (c.launch_date as string | null) ?? null;
    const clientEvents = allEventsByClient.get(c.id) ?? [];
    const freshWin =
      launch_date && isFreshLaunchClient(launch_date, today)
        ? freshLaunchWindow(launch_date, today)
        : null;
    const freshLaunchEvents = freshWin
      ? filterEventsToRange(
          clientEvents as Array<EventRow & { occurred_at: string }>,
          freshWin.start,
          freshWin.end,
        )
      : [];
    const freshLaunchSpend = freshWin
      ? spendInRange(spendRows.filter(r => r.client_id === c.id), freshWin.start, freshWin.end).map(
          ({ client_id: _cid, amount, platform }) => ({ amount, platform }),
        )
      : [];
    const toCostSlice = (
      ev: EventRow[],
      spend: SpendRow[],
      win: { start: string; end: string; window_days: number },
    ): CostWindowSlice => ({
      start: win.start,
      end: win.end,
      window_days: win.window_days,
      events: ev ?? [],
      spend: spend ?? [],
    });
    const built = buildClientHealthRow({
      client_id: c.id,
      client_name: c.name,
      is_live: c.is_live !== false,
      reporting_type,
      benchmarks,
      verdictEvents: currentByClient.get(c.id) ?? [],
      priorEvents: priorByClient.get(c.id) ?? [],
      recentEvents: recentByClient.get(c.id) ?? [],
      recentPriorEvents: recentPriorByClient.get(c.id) ?? [],
      verdictSpend: currentSpendByClient.get(c.id) ?? [],
      priorSpend: priorSpendByClient.get(c.id) ?? [],
      recentSpend: recentSpendByClient.get(c.id) ?? [],
      recentPriorSpend: recentPriorSpendByClient.get(c.id) ?? [],
      freshCost: isHe
        ? null
        : toCostSlice(
            freshCostByClient.get(c.id) ?? [],
            freshCostSpendByClient.get(c.id) ?? [],
            leading,
          ),
      freshCostPrior:
        isHe || !leadingPrior
          ? null
          : toCostSlice(
              freshCostPriorByClient.get(c.id) ?? [],
              freshCostPriorSpendByClient.get(c.id) ?? [],
              { ...leadingPrior, window_days: leading.window_days },
            ),
      start_date,
      end_date,
      verdictPrior,
      open_action: pickOpenAction(actionsByClient.get(c.id) ?? [], today),
      launch_date,
      freshLaunchEvents,
      freshLaunchSpend,
      today,
    });
    const verdictSpans = spansFor(c, start_date, end_date, catalog, lens);
    if (verdictSpans.segments.length > 1) {
      const criteria_segments: CriteriaSegmentView[] = verdictSpans.segments.map(seg => {
        const ev = ((currentByClient.get(c.id) ?? []) as EventRow[]).filter(e =>
          inRange(e as ClientEventWithDate, seg.start, seg.end),
        );
        const spend = spendInRange(
          spendRows.filter(r => r.client_id === c.id),
          seg.start,
          seg.end,
        ).map(({ amount, platform }) => ({ amount, platform }));
        const snap = gradeMetrics(seg.criteria, calculateMetrics(ev, spend));
        return {
          start: seg.start,
          end: seg.end,
          tier: snap.worst_tier,
          stock_version_id: seg.criteria.stockVersionId,
          custom_version_id: seg.criteria.customVersionId,
          profile: seg.criteria.profile,
          effective_start: seg.criteria.stockEffectiveStart,
          custom: seg.criteria.customKeys.length > 0,
        };
      });
      return {
        ...built,
        criteria_split: true,
        criteria_segments,
        criteria_lens: lens,
        criteria_replay: lens === 'on_todays_criteria',
        criteria_caption: 'This range crosses a criteria change. Each side is graded on its own ruler.',
        trend: 'insufficient' as const,
        trend_delta_score: 0,
        focus: {
          focus: 'monitor' as const,
          label: 'Ruler changed',
          verdict_critical: false,
          leading_critical: false,
        },
      };
    }
    if (verdictSpans.single) {
      const snap = gradeMetrics(
        verdictSpans.single,
        calculateMetrics(
          (currentByClient.get(c.id) ?? []) as EventRow[],
          currentSpendByClient.get(c.id) ?? [],
        ),
      );
      return {
        ...built,
        current: snap,
        graded_keys: verdictSpans.single.gradedKeys,
        criteria_lens: lens,
        criteria_replay: lens === 'on_todays_criteria',
        criteria_caption: lens === 'on_todays_criteria'
          ? 'On today’s criteria. This is not the judgment that was made then.'
          : `${verdictSpans.single.profile} from ${verdictSpans.single.stockEffectiveStart}${verdictSpans.single.customKeys.length ? ' · custom' : ' · stock'}`,
      };
    }
    return built;
  });

  return assembleBundle(
    clients ?? [],
    rows,
    safeActionRows as ActionRow[],
    start_date,
    end_date,
    verdictPrior,
    matured,
    leading,
    leadingPrior,
    today,
  );
}

/** Same matured 30d window Client Success uses by default (ends MATURITY_DAYS before today). */
export function defaultHealthGradingRange(maturityDays = MATURITY_DAYS, windowDays = 30): {
  start: string;
  end: string;
} {
  const end = new Date(Date.now() - maturityDays * 86400000);
  const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
  const ymd = (d: Date) => d.toISOString().split('T')[0];
  return { start: ymd(start), end: ymd(end) };
}
