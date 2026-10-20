/**
 * Media Buyer Command aggregator — underperforming ads lens, 7d launch checks,
 * onboarding queue, day playbook.
 */

import {
  daysSinceLaunch,
  KPI_META,
  SUCCESS_METRIC_META,
  TIER_LABEL,
  type HealthTier,
  type KpiGrade,
  type SuccessMetricKey,
} from '@/lib/client-health';
import {
  OPEN_ACTION_STATUSES,
  summarizeOpenAction,
} from '@/lib/client-health-interventions';
import { ymdLocal } from '@/lib/date-presets';
import { gradesForLens, mediaBuyerStatus, TIER_WEIGHT } from '@/lib/dept-health';
import { kickoffFiledClientIds } from '@/lib/form-submissions';
import { isKickoffIncomplete } from '@/lib/kickoff';
import { defaultHealthGradingRange, loadClientHealthBundle } from '@/lib/load-client-health';
import {
  buildMbDayContext,
  type MbDayContext,
} from '@/lib/team-dashboards/media-playbook';
import {
  buildAccountPulse,
  buildChangesInFlight,
  type InFlightActionInput,
  type MbAccountPulse,
  type MbChangeInFlight,
} from '@/lib/team-dashboards/media-pulse';
import type { createServiceClient } from '@/lib/supabase';

export type {
  MbAccountPulse,
  MbChangeInFlight,
  MbInFlightVerdict,
  MbPulseFlag,
  MbPulseRow,
} from '@/lib/team-dashboards/media-pulse';
export { PULSE_FLAG_META, needsPulseAttention } from '@/lib/team-dashboards/media-pulse';

/** Post-launch verification window for MB Command (distinct from FRESH_LAUNCH_DAYS=14 health). */
export const MB_LAUNCH_CHECK_DAYS = 7;

const ONBOARDING_STATUSES = new Set(['new_account', 'onboarding']);

/** Ads / landing layers Christian owns on Client Success interventions. */
const MB_ACTION_LAYERS = new Set(['L1', 'L2']);
const MB_SUCCESS_METRICS = new Set([
  'cpl',
  'cpql',
  'lead_to_qual',
  'optin_rate',
]);

export type MbLaunchCheckField = 'funnel' | 'ads_manager' | 'mr_waiz';

export type MbLaunchChecks = {
  funnel_checked_at: string | null;
  ads_manager_checked_at: string | null;
  mr_waiz_checked_at: string | null;
};

export type MbUnderperformingClient = {
  client_id: string;
  client_name: string;
  reporting_type: string;
  mb_tier: HealthTier;
  mb_tier_label: string;
  constraint: string;
  constraint_label: string;
  red_kpis: string[];
  cpl: number | null;
  cpql: number | null;
  qual_pct: number | null;
  days_live: number | null;
  attention_score: number;
};

export type MbFreshLaunchClient = {
  client_id: string;
  client_name: string;
  launch_date: string;
  days_since_launch: number;
  reporting_type: string;
  checks: MbLaunchChecks;
  all_checked: boolean;
};

export type MbOnboardingClient = {
  client_id: string;
  client_name: string;
  lifecycle_status: string | null;
  days_in_onboarding: number | null;
  kickoff_incomplete: boolean;
  next_gate: string;
};

/** Open L1/L2 account changes whose review_date is today or overdue. */
export type MbReflectionDue = {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  layer: string | null;
  status: string;
  success_metric: string | null;
  success_metric_label: string | null;
  change_date: string | null;
  review_date: string | null;
  baseline_value: number | null;
  target_value: number | null;
  change_description: string | null;
  hypothesis: string | null;
  overdue: boolean;
  due_today: boolean;
};

export type MediaBuyerCommandPayload = {
  generated_at: string;
  today: string;
  health_period: { start: string; end: string };
  counts: {
    reflections_due: number;
    reflections_overdue: number;
    underperforming: number;
    fresh_launches: number;
    fresh_incomplete: number;
    onboarding: number;
    in_flight: number;
    in_flight_off_track: number;
    in_flight_planned: number;
    pulse_flagged: number;
    pulse_no_delivery: number;
  };
  reflectionsDue: MbReflectionDue[];
  /** Open ads/landing bets that are live but not yet due — evaluated today. */
  changesInFlight: MbChangeInFlight[];
  /** Per-client spend delivery / pacing / CPL momentum + Meta sync freshness. */
  pulse: MbAccountPulse | null;
  underperforming: MbUnderperformingClient[];
  freshLaunches: MbFreshLaunchClient[];
  onboarding: MbOnboardingClient[];
  dayContext: MbDayContext;
  errors: {
    underperforming?: string;
    fresh?: string;
    onboarding?: string;
    reflections?: string;
    in_flight?: string;
    pulse?: string;
    pulse_fatigue?: string;
  };
};

function isMbOwnedAction(opts: {
  layer: string | null;
  success_metric: string | null;
}): boolean {
  if (opts.layer && MB_ACTION_LAYERS.has(opts.layer)) return true;
  if (opts.success_metric && MB_SUCCESS_METRICS.has(opts.success_metric)) return true;
  return false;
}

function metricLabel(key: string | null): string | null {
  if (!key) return null;
  return SUCCESS_METRIC_META[key as SuccessMetricKey]?.label ?? key;
}

function daysBetween(fromYmd: string | null | undefined, toYmd: string): number | null {
  if (!fromYmd) return null;
  const a = Date.parse(`${fromYmd.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${toYmd}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function nextGateLabel(opts: {
  lifecycle_status: string | null;
  kickoff_incomplete: boolean;
}): string {
  if (opts.kickoff_incomplete) return 'Finish kickoff';
  if (opts.lifecycle_status === 'new_account') return 'Advance to onboarding';
  if (opts.lifecycle_status === 'onboarding') return 'Launch checklist';
  return '—';
}

function redKpisForMb(grades: KpiGrade[]): string[] {
  return gradesForLens(grades, 'media_buyer')
    .filter(g => g.tier === 'critical' || g.tier === 'below')
    .map(g => KPI_META[g.key]?.short ?? g.label);
}

function emptyChecks(): MbLaunchChecks {
  return {
    funnel_checked_at: null,
    ads_manager_checked_at: null,
    mr_waiz_checked_at: null,
  };
}

function checksComplete(c: MbLaunchChecks): boolean {
  return Boolean(
    c.funnel_checked_at && c.ads_manager_checked_at && c.mr_waiz_checked_at,
  );
}

export async function buildMediaBuyerCommandPayload(
  service: ReturnType<typeof createServiceClient>,
): Promise<MediaBuyerCommandPayload> {
  const today = ymdLocal(new Date());
  const healthRange = defaultHealthGradingRange();
  const dayContext = buildMbDayContext(new Date());
  const errors: MediaBuyerCommandPayload['errors'] = {};

  let underperforming: MbUnderperformingClient[] = [];
  const freshLaunches: MbFreshLaunchClient[] = [];
  let onboarding: MbOnboardingClient[] = [];
  let reflectionsDue: MbReflectionDue[] = [];
  let changesInFlight: MbChangeInFlight[] = [];
  let pulse: MbAccountPulse | null = null;

  const [clientsRes, onboardingCallsRes, checksRes, actionsRes, healthResult] =
    await Promise.all([
      service
        .from('clients')
        .select(
          'id, name, lifecycle_status, launch_date, date_signed, last_status_changed_at, created_at, ghl_location_id, primary_contact_name, reporting_type, is_live, kpi_benchmarks, daily_adspend, ads_paused, ads_paused_at, ads_paused_note',
        )
        .order('name'),
      service
        .from('client_calls')
        .select('client_id, recording_url, call_type, called_at')
        .eq('call_type', 'onboarding')
        .order('called_at', { ascending: false }),
      service.from('mb_launch_checks').select(
        'client_id, funnel_checked_at, ads_manager_checked_at, mr_waiz_checked_at',
      ),
      // All open bets — partitioned below into reflections due vs in flight.
      service
        .from('client_action_logs')
        .select(
          'id, client_id, title, layer, status, success_metric, change_date, review_date, planned_date, baseline_value, target_value, change_description, hypothesis, bet_category, loom_url, created_at, baseline_snapshot_id, outcome_value, outcome_recorded_at, work_type',
        )
        .eq('work_type', 'bet')
        .in('status', [...OPEN_ACTION_STATUSES]),
      loadClientHealthBundle(service, {
        start_date: healthRange.start,
        end_date: healthRange.end,
        live_only: true,
      }).catch((e: unknown) => {
        errors.underperforming = e instanceof Error ? e.message : String(e);
        return null;
      }),
    ]);

  if (clientsRes.error) {
    errors.onboarding = clientsRes.error.message;
    errors.fresh = clientsRes.error.message;
  }
  if (onboardingCallsRes.error && !errors.onboarding) {
    errors.onboarding = onboardingCallsRes.error.message;
  }
  if (checksRes.error && !errors.fresh) {
    errors.fresh = checksRes.error.message;
  }
  if (actionsRes.error) {
    errors.reflections = actionsRes.error.message;
  }

  const allClients = clientsRes.data ?? [];
  const clientNameById = new Map(allClients.map(c => [c.id as string, c.name as string]));
  const checksById = new Map<string, MbLaunchChecks>();
  for (const row of checksRes.data ?? []) {
    checksById.set(row.client_id, {
      funnel_checked_at: row.funnel_checked_at ?? null,
      ads_manager_checked_at: row.ads_manager_checked_at ?? null,
      mr_waiz_checked_at: row.mr_waiz_checked_at ?? null,
    });
  }

  const latestOnboardingCall = new Map<string, { recording_url?: string | null }>();
  for (const call of onboardingCallsRes.data ?? []) {
    if (!latestOnboardingCall.has(call.client_id)) {
      latestOnboardingCall.set(call.client_id, { recording_url: call.recording_url });
    }
  }

  // ── Partition open MB bets: due for review vs still in flight ─────────────
  const mbOpenBets = (actionsRes.data ?? []).filter(a =>
    isMbOwnedAction({
      layer: (a.layer as string | null) ?? null,
      success_metric: (a.success_metric as string | null) ?? null,
    }),
  );
  const isReviewDue = (a: { review_date: string | null }) => {
    const r = a.review_date?.slice(0, 10) ?? null;
    return r != null && r <= today;
  };

  // ── Reflections due (L1/L2 account changes — review today or overdue) ─────
  reflectionsDue = mbOpenBets
    .filter(isReviewDue)
    .map(a => {
      const summary = summarizeOpenAction(
        {
          id: a.id,
          client_id: a.client_id,
          created_at: a.created_at,
          change_date: a.change_date,
          title: a.title,
          success_metric: a.success_metric,
          baseline_value: a.baseline_value != null ? Number(a.baseline_value) : null,
          target_value: a.target_value != null ? Number(a.target_value) : null,
          baseline_snapshot_id: a.baseline_snapshot_id,
          review_date: a.review_date,
          status: a.status,
          outcome_value: a.outcome_value != null ? Number(a.outcome_value) : null,
          outcome_recorded_at: a.outcome_recorded_at,
        },
        today,
      );
      const review = (a.review_date as string | null)?.slice(0, 10) ?? null;
      return {
        id: a.id as string,
        client_id: a.client_id as string,
        client_name: clientNameById.get(a.client_id) ?? 'Unknown',
        title: a.title as string,
        layer: (a.layer as string | null) ?? null,
        status: a.status as string,
        success_metric: (a.success_metric as string | null) ?? null,
        success_metric_label: metricLabel((a.success_metric as string | null) ?? null),
        change_date: (a.change_date as string | null)?.slice(0, 10) ?? null,
        review_date: review,
        baseline_value: a.baseline_value != null ? Number(a.baseline_value) : null,
        target_value: a.target_value != null ? Number(a.target_value) : null,
        change_description: (a.change_description as string | null) ?? null,
        hypothesis: (a.hypothesis as string | null) ?? null,
        overdue: summary.overdue,
        due_today: review === today,
      };
    })
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (a.review_date ?? '').localeCompare(b.review_date ?? '') ||
        a.client_name.localeCompare(b.client_name),
    );

  // ── Changes in flight + Account pulse (independent; run together) ────────
  const inFlightInputs: InFlightActionInput[] = mbOpenBets
    .filter(a => !isReviewDue(a))
    .map(a => ({
      id: a.id as string,
      client_id: a.client_id as string,
      created_at: a.created_at as string,
      change_date: (a.change_date as string | null) ?? null,
      planned_date: (a.planned_date as string | null) ?? null,
      work_type: (a.work_type as string | null) ?? null,
      title: a.title as string,
      layer: (a.layer as string | null) ?? null,
      bet_category: (a.bet_category as string | null) ?? null,
      change_description: (a.change_description as string | null) ?? null,
      hypothesis: (a.hypothesis as string | null) ?? null,
      loom_url: (a.loom_url as string | null) ?? null,
      success_metric: (a.success_metric as string | null) ?? null,
      baseline_value: a.baseline_value != null ? Number(a.baseline_value) : null,
      target_value: a.target_value != null ? Number(a.target_value) : null,
      baseline_snapshot_id: (a.baseline_snapshot_id as string | null) ?? null,
      review_date: (a.review_date as string | null) ?? null,
      status: a.status as string,
      outcome_value: a.outcome_value != null ? Number(a.outcome_value) : null,
      outcome_recorded_at: (a.outcome_recorded_at as string | null) ?? null,
    }));

  const [inFlightResult, pulseResult] = await Promise.all([
    buildChangesInFlight(service, {
      today,
      actions: inFlightInputs,
      clients: allClients.map(c => ({
        id: c.id as string,
        name: c.name as string,
        reporting_type: (c.reporting_type as string | null) ?? null,
        kpi_benchmarks: c.kpi_benchmarks,
      })),
    }).catch((e: unknown) => {
      errors.in_flight = e instanceof Error ? e.message : String(e);
      return null;
    }),
    buildAccountPulse(service, {
      today,
      clients: allClients.map(c => ({
        id: c.id as string,
        name: c.name as string,
        reporting_type: (c.reporting_type as string | null) ?? null,
        lifecycle_status: (c.lifecycle_status as string | null) ?? null,
        is_live: (c.is_live as boolean | null) ?? null,
        daily_adspend: (c.daily_adspend as number | string | null) ?? null,
        ads_paused: (c.ads_paused as boolean | null) ?? null,
        ads_paused_at: (c.ads_paused_at as string | null) ?? null,
        ads_paused_note: (c.ads_paused_note as string | null) ?? null,
      })),
      health: healthResult?.clients ?? null,
    }).catch((e: unknown) => {
      errors.pulse = e instanceof Error ? e.message : String(e);
      return null;
    }),
  ]);

  if (inFlightResult) {
    changesInFlight = inFlightResult.rows;
    if (inFlightResult.errors.length > 0 && !errors.in_flight) {
      errors.in_flight = inFlightResult.errors.slice(0, 3).join(' · ');
    }
  }
  if (pulseResult) {
    const { fatigue_error, ...pulseData } = pulseResult as typeof pulseResult & {
      fatigue_error?: string;
    };
    pulse = pulseData;
    if (fatigue_error) errors.pulse_fatigue = fatigue_error;
  }

  // ── Onboarding queue ──────────────────────────────────────────────────────
  const onboardingClients = allClients.filter(c =>
    ONBOARDING_STATUSES.has(c.lifecycle_status ?? ''),
  );
  let kickoffFiled = new Set<string>();
  if (onboardingClients.length) {
    try {
      kickoffFiled = await kickoffFiledClientIds(
        service,
        onboardingClients.map(c => c.id as string),
      );
    } catch (e) {
      if (!errors.onboarding) errors.onboarding = e instanceof Error ? e.message : String(e);
    }
  }
  onboarding = onboardingClients
    .map(c => {
      const kickoff_incomplete = isKickoffIncomplete(
        {
          lifecycle_status: c.lifecycle_status,
          ghl_location_id: c.ghl_location_id,
          name: c.name,
          primary_contact_name: c.primary_contact_name,
        },
        latestOnboardingCall.get(c.id as string),
        kickoffFiled.has(c.id as string),
      );
      const anchor =
        (c.last_status_changed_at as string | null)?.slice(0, 10) ||
        (c.date_signed as string | null)?.slice(0, 10) ||
        (c.created_at as string | null)?.slice(0, 10) ||
        null;
      return {
        client_id: c.id,
        client_name: c.name,
        lifecycle_status: c.lifecycle_status,
        days_in_onboarding: daysBetween(anchor, today),
        kickoff_incomplete,
        next_gate: nextGateLabel({
          lifecycle_status: c.lifecycle_status,
          kickoff_incomplete,
        }),
      };
    })
    .sort(
      (a, b) =>
        (b.days_in_onboarding ?? 0) - (a.days_in_onboarding ?? 0) ||
        a.client_name.localeCompare(b.client_name),
    );

  // ── Fresh launches (≤7d) + checks ─────────────────────────────────────────
  const freshIds = new Set<string>();
  for (const c of allClients) {
    if (c.lifecycle_status !== 'active') continue;
    const launch = (c.launch_date as string | null)?.slice(0, 10) ?? null;
    if (!launch) continue;
    const days = daysSinceLaunch(launch, today);
    if (days < 0 || days >= MB_LAUNCH_CHECK_DAYS) continue;
    const checks = checksById.get(c.id) ?? emptyChecks();
    freshLaunches.push({
      client_id: c.id,
      client_name: c.name,
      launch_date: launch,
      days_since_launch: days,
      reporting_type: c.reporting_type ?? 'RM',
      checks,
      all_checked: checksComplete(checks),
    });
    freshIds.add(c.id);
  }
  freshLaunches.sort(
    (a, b) =>
      Number(a.all_checked) - Number(b.all_checked) ||
      a.days_since_launch - b.days_since_launch ||
      a.client_name.localeCompare(b.client_name),
  );

  // ── Underperforming (MB lens) ─────────────────────────────────────────────
  if (healthResult) {
    underperforming = healthResult.clients
      .filter(r => {
        if (r.is_live === false || !r.has_activity) return false;
        if (freshIds.has(r.client_id)) return false;
        if (r.launch_date) {
          const days = daysSinceLaunch(r.launch_date, today);
          if (days >= 0 && days < MB_LAUNCH_CHECK_DAYS) return false;
        }
        const tier = mediaBuyerStatus(r);
        return tier === 'critical' || tier === 'below';
      })
      .map(r => {
        const tier = mediaBuyerStatus(r);
        const snap = r.current;
        const cpl = snap.metrics.cpl;
        const red_kpis = redKpisForMb(snap.grades);
        return {
          client_id: r.client_id,
          client_name: r.client_name,
          reporting_type: r.reporting_type,
          mb_tier: tier,
          mb_tier_label: TIER_LABEL[tier],
          constraint: snap.constraint,
          constraint_label: snap.constraint_label,
          red_kpis:
            red_kpis.length > 0
              ? red_kpis
              : [snap.constraint_label || 'Ads KPI'],
          cpl: Number.isFinite(cpl) ? cpl : null,
          cpql: Number.isFinite(snap.cpql) ? snap.cpql : null,
          qual_pct: Number.isFinite(snap.lead_to_qualified_pct)
            ? snap.lead_to_qualified_pct
            : null,
          days_live: r.launch_date ? daysBetween(r.launch_date, today) : null,
          attention_score: snap.attention_score,
        };
      })
      .sort(
        (a, b) =>
          TIER_WEIGHT[b.mb_tier] - TIER_WEIGHT[a.mb_tier] ||
          b.attention_score - a.attention_score ||
          a.client_name.localeCompare(b.client_name),
      );
  }

  const fresh_incomplete = freshLaunches.filter(f => !f.all_checked).length;
  const reflections_overdue = reflectionsDue.filter(r => r.overdue).length;

  return {
    generated_at: new Date().toISOString(),
    today,
    health_period: healthResult?.period ?? {
      start: healthRange.start,
      end: healthRange.end,
    },
    counts: {
      reflections_due: reflectionsDue.length,
      reflections_overdue,
      underperforming: underperforming.length,
      fresh_launches: freshLaunches.length,
      fresh_incomplete,
      onboarding: onboarding.length,
      in_flight: changesInFlight.filter(c => c.phase === 'live').length,
      in_flight_off_track: changesInFlight.filter(c => c.verdict === 'off_track').length,
      in_flight_planned: changesInFlight.filter(c => c.phase === 'planned').length,
      pulse_flagged: pulse?.totals.flagged ?? 0,
      pulse_no_delivery: pulse?.totals.no_delivery ?? 0,
    },
    reflectionsDue,
    changesInFlight,
    pulse,
    underperforming,
    freshLaunches,
    onboarding,
    dayContext,
    errors,
  };
}

const FIELD_TO_COLUMN: Record<MbLaunchCheckField, keyof MbLaunchChecks> = {
  funnel: 'funnel_checked_at',
  ads_manager: 'ads_manager_checked_at',
  mr_waiz: 'mr_waiz_checked_at',
};

export async function upsertMbLaunchCheck(
  service: ReturnType<typeof createServiceClient>,
  opts: {
    clientId: string;
    field: MbLaunchCheckField;
    checked: boolean;
    userId: string;
  },
): Promise<MbLaunchChecks> {
  const col = FIELD_TO_COLUMN[opts.field];
  const nowIso = new Date().toISOString();
  const value = opts.checked ? nowIso : null;

  const { data: existing, error: readErr } = await service
    .from('mb_launch_checks')
    .select('funnel_checked_at, ads_manager_checked_at, mr_waiz_checked_at')
    .eq('client_id', opts.clientId)
    .maybeSingle();

  if (readErr) throw new Error(readErr.message);

  const next: MbLaunchChecks = {
    funnel_checked_at: existing?.funnel_checked_at ?? null,
    ads_manager_checked_at: existing?.ads_manager_checked_at ?? null,
    mr_waiz_checked_at: existing?.mr_waiz_checked_at ?? null,
    [col]: value,
  };

  const { data, error } = await service
    .from('mb_launch_checks')
    .upsert(
      {
        client_id: opts.clientId,
        funnel_checked_at: next.funnel_checked_at,
        ads_manager_checked_at: next.ads_manager_checked_at,
        mr_waiz_checked_at: next.mr_waiz_checked_at,
        updated_by: opts.userId,
        updated_at: nowIso,
      },
      { onConflict: 'client_id' },
    )
    .select('funnel_checked_at, ads_manager_checked_at, mr_waiz_checked_at')
    .single();

  if (error) throw new Error(error.message);

  return {
    funnel_checked_at: data.funnel_checked_at ?? null,
    ads_manager_checked_at: data.ads_manager_checked_at ?? null,
    mr_waiz_checked_at: data.mr_waiz_checked_at ?? null,
  };
}
