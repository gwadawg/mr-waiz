import { withDialPoolRates, type DialPool } from '@/lib/dial-pool';
import { calculateMetrics, type EventRow, type MetricsResult, type SpendRow } from '@/lib/metrics';
import { normalizeReportingType, usesCallCenterKpiLayout, type ReportingType } from '@/lib/kpi-layouts';

export type HealthTier = 'critical' | 'below' | 'at' | 'above' | 'insufficient';

export type ConstraintLayer =
  | 'lead_quality'
  | 'lead_cost'
  | 'call_center'
  | 'show_rate'
  | 'data_issue'
  | 'healthy'
  | 'insufficient_data';

export type KpiKey =
  | 'lead_to_qualified'
  | 'pickup_rate'
  | 'booking_rate'
  | 'hand_raise_rate'
  | 'lead_booking_rate'
  | 'show_rate'
  | 'close_rate'
  | 'cpl'
  | 'cpql'
  | 'cps';

export type KpiGrade = {
  key: KpiKey;
  label: string;
  value: number | null;
  display: string;
  tier: HealthTier;
  tierLabel: string;
  /** Why a grade is insufficient, when the number itself is not the reason. */
  note?: string;
};

export type ClientHealthSnapshot = {
  metrics: MetricsResult;
  lead_to_qualified_pct: number;
  close_rate_pct: number;
  cpql: number;
  /** Cost per conversation (= ad spend ÷ (live transfers + shows + claimed)). The verdict metric. */
  cpconv: number;
  /** Conversation yield = conversations ÷ qualified leads (credits live transfers, not just shows). */
  conversation_yield: number;
  /** Leads ÷ Meta ad clicks × 100 (funnel opt-in / landing conversion). */
  optin_rate_pct: number;
  grades: KpiGrade[];
  worst_tier: HealthTier;
  attention_score: number;
  constraint: ConstraintLayer;
  constraint_label: string;
  /** Tier edges the grade actually used. Diagnosis copy reads these. */
  ruler_edges?: Partial<Record<KpiKey, { critical?: number; below?: number; at?: number }>>;
};

/** Opt-in rate = new leads ÷ ad clicks to landing page. */
export function computeOptinRatePct(newLeads: number, adClicks: number): number {
  return adClicks > 0 ? (newLeads / adClicks) * 100 : 0;
}

/** Attach opt-in rate when Meta click volume is available for the window. */
export function withOptinRate(snap: ClientHealthSnapshot, adClicks: number): ClientHealthSnapshot {
  return {
    ...snap,
    optin_rate_pct: computeOptinRatePct(snap.metrics.new_leads, adClicks),
  };
}

/** Funnel layer that owns a constraint, used for ordering and ownership. */
export type FunnelLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'DATA' | 'NONE';

export type FixStep = {
  owner: string;
  action: string;
  timebox?: string;
  successMetric?: string;
};

/** Plain-English diagnosis + ordered fix steps for a client's primary constraint. */
export type ConstraintGuidance = {
  layer: FunnelLayer;
  /** One-line "biggest fallout". */
  headline: string;
  /** Plain-English explanation of what is wrong, with the actual numbers. */
  whatsWrong: string;
  fixSteps: FixStep[];
  doNotDo: string[];
  /** Human-readable CPConv arithmetic: "spend ÷ conversations = $X". */
  cpconvMath: string;
  /** Cross-check via CPQL ÷ CY. */
  crossCheck: string;
};

export type ClientFocus = 'act_now' | 'monitor' | 'recovering' | 'on_track';

export type FocusResult = {
  focus: ClientFocus;
  label: string;
  /** 911 on matured north star (CPConv for RM, any graded HE KPI). */
  verdict_critical: boolean;
  /** 911 on leading KPIs in the recent window — early warning only (not Act now). */
  leading_critical: boolean;
};

export type OpenActionSummary = {
  id: string;
  title: string;
  review_date: string | null;
  status: string;
  overdue: boolean;
};

export type PendingIntervention = {
  id: string;
  client_id: string;
  client_name: string;
  reporting_type: ReportingType;
  title: string;
  status: string;
  success_metric: string | null;
  change_date: string | null;
  review_date: string | null;
  baseline_value: number | null;
  outcome_value: number | null;
  overdue: boolean;
  review_due: boolean;
};

/** One piece of a date range that crossed a criteria version boundary. */
export type CriteriaSegmentView = {
  start: string;
  end: string;
  tier: HealthTier | null;
  stock_version_id: string;
  custom_version_id: string | null;
  profile: string;
  effective_start: string;
  custom: boolean;
};

export type ClientHealthRow = {
  client_id: string;
  client_name: string;
  is_live: boolean;
  reporting_type: ReportingType;
  current: ClientHealthSnapshot;
  prior: ClientHealthSnapshot | null;
  trend: 'improved' | 'worsened' | 'stable' | 'new' | 'insufficient';
  trend_delta_score: number;
  has_activity: boolean;
  /** Leading-indicator snapshot of the most recent window (early-warning instrument). */
  recent: RecentLeading | null;
  /** Prior equal-length leading window for momentum comparison. */
  recent_prior: RecentLeading | null;
  focus: FocusResult;
  /** Next open intervention follow-up, if any. */
  open_action: OpenActionSummary | null;
  /** ISO launch date when set; used for fresh-launch grading. */
  launch_date: string | null;
  /** Within the first {@link FRESH_LAUNCH_DAYS} after launch — graded on leading KPIs only. */
  is_fresh_launch: boolean;
  /** Launch-to-date snapshot (CPL / CPQL / booking — no CPConv). */
  fresh: FreshLaunchSnapshot | null;
  /** Keys the ruler in force actually grades. Dept lenses honor this list. */
  graded_keys?: KpiKey[];
  criteria_lens?: 'as_judged_then' | 'on_todays_criteria';
  /** True when the row is a replay on the open ruler and nothing was saved. */
  criteria_replay?: boolean;
  criteria_caption?: string | null;
  criteria_split?: boolean;
  criteria_segments?: CriteriaSegmentView[] | null;
};

/** First N days after launch use leading KPIs instead of matured CPConv grading. */
export const FRESH_LAUNCH_DAYS = 14;

export const FRESH_LAUNCH_RM_KEYS: KpiKey[] = [
  'cpl',
  'cpql',
  'hand_raise_rate',
  'lead_to_qualified',
];

export const FRESH_LAUNCH_HE_KEYS: KpiKey[] = ['hand_raise_rate'];

export type FreshLaunchSnapshot = {
  launch_date: string;
  days_since_launch: number;
  window_days: number;
  start: string;
  end: string;
  leads: number;
  qualified_leads: number;
  dials: number;
  grades: KpiGrade[];
  worst_tier: HealthTier;
};

/**
 * Leading indicators over the calendar-last N days through today. These resolve
 * fast (no booking→appointment lag), so they're shown separately as an early-warning
 * instrument rather than folded into the matured verdict.
 */
export type RecentLeading = {
  window_days: number;
  start: string;
  end: string;
  leads: number;
  qualified_leads: number;
  dials: number;
  lead_to_qualified_pct: number;
  /** Live transfers + claimed + shows in the recent window. */
  conversations: number;
  /** Appointments booked only (RM reference). */
  booking_rate: number;
  /** Booked + claimed + live transfer ÷ qualified (RM leading + L3 grade). */
  hand_raise_rate: number;
  /** RM only — leading cost signals for early warning. */
  cpl: number;
  cpql: number;
  /**
   * RM only — CPL/CPQL are graded on this fresh window (ends today) so ad-cost
   * spikes surface before the maturity lag on CPConv.
   */
  cost_window_days?: number;
  cost_start?: string;
  cost_end?: string;
  /** Graded tiers for leading KPIs only (no CPConv / show on this window). */
  leading_grades: KpiGrade[];
  momentum: 'improving' | 'slipping' | 'stable' | 'insufficient';
};

export type CostWindowSlice = {
  start: string;
  end: string;
  window_days: number;
  events: EventRow[];
  spend: SpendRow[];
};

const TIER_WEIGHT: Record<HealthTier, number> = {
  critical: 4,
  below: 3,
  at: 2,
  above: 1,
  insufficient: 0,
};

const TIER_LABEL: Record<HealthTier, string> = {
  critical: '911',
  below: 'Below KPI',
  at: 'At KPI',
  above: 'Above KPI',
  insufficient: '—',
};

export const KPI_META: Record<KpiKey, { label: string; short: string }> = {
  lead_to_qualified: { label: 'Lead-to-Qualified %', short: 'Qual %' },
  pickup_rate: { label: 'Contact / Pickup Rate', short: 'Pickup' },
  booking_rate: { label: 'Booking Rate (unique ÷ qualified)', short: 'Booking' },
  hand_raise_rate: { label: 'Hand-raise Rate (unique booked ∪ claimed ∪ LT)', short: 'Hand-raise' },
  lead_booking_rate: { label: 'Booking Rate (unique ÷ total leads)', short: 'Book %' },
  show_rate: { label: 'Show Rate (unique booked → spoke)', short: 'Show rate' },
  close_rate: { label: 'Close Rate', short: 'Close' },
  cpl: { label: 'Cost Per Lead', short: 'CPL' },
  cpql: { label: 'Cost Per Qualified Lead', short: 'CPQL' },
  cps: { label: 'Cost Per Conversation (CPConv)', short: 'CPConv' },
};

export type Bands = { critical?: number; below?: number; at?: number };

export type KpiBandSpec = {
  bands: Bands;
  /** true = higher value is better (rates); false = lower is better (costs). */
  higherIsBetter: boolean;
  /** unit of the threshold values, for the editor UI. */
  unit: 'pct' | 'money';
};

/**
 * Global default bands — the single source of truth for the grader and the
 * per-client benchmark editor. Values calibrated against the live per-client
 * distribution (see docs/CLIENT-HEALTH-REDESIGN.md §8.1). Per-client overrides
 * are layered on top of these; anything not overridden falls back here.
 */
/** KPIs graded for HE (appointment-only) clients — no ad-cost metrics, no pickup (text bookings). */
export const HE_KPI_KEYS: KpiKey[] = ['hand_raise_rate', 'show_rate'];

/** KPIs graded for RM (paid-ads) clients — pickup omitted (many bookings via text). Booking-only rate is not graded. */
export const RM_KPI_KEYS: KpiKey[] = [
  'lead_to_qualified', 'hand_raise_rate', 'show_rate', 'close_rate', 'cpl', 'cpql', 'cps',
];

export const DEFAULT_KPI_BANDS: Record<KpiKey, KpiBandSpec> = {
  lead_to_qualified: { bands: { critical: 40, below: 50, at: 65 }, higherIsBetter: true, unit: 'pct' },
  pickup_rate:       { bands: { critical: 20, below: 30, at: 45 }, higherIsBetter: true, unit: 'pct' },
  booking_rate:      { bands: { critical: 20, below: 25, at: 30 }, higherIsBetter: true, unit: 'pct' },
  hand_raise_rate:   { bands: { critical: 20, below: 25, at: 30 }, higherIsBetter: true, unit: 'pct' },
  lead_booking_rate: { bands: { critical: 3, below: 5, at: 8 }, higherIsBetter: true, unit: 'pct' },
  show_rate:         { bands: { critical: 55, below: 63, at: 70 }, higherIsBetter: true, unit: 'pct' },
  close_rate:        { bands: { critical: 10, below: 20, at: 35 }, higherIsBetter: true, unit: 'pct' },
  cpl:               { bands: { critical: 25, below: 20, at: 15 }, higherIsBetter: false, unit: 'money' },
  // Downstream cost defaults are derived from CPL and the matching global
  // conversion band:
  //   CPQL   = CPL ÷ lead-to-qualified %
  //   CPConv = CPQL ÷ hand-raise / conversation %
  cpql:              { bands: { critical: 62.5, below: 40, at: 23.08 }, higherIsBetter: false, unit: 'money' },
  cps:               { bands: { critical: 312.5, below: 160, at: 76.92 }, higherIsBetter: false, unit: 'money' },
};

/** Minimum denominator per KPI before it can be graded (volume guard). */
export const KPI_MIN_DENOMINATOR: Record<KpiKey, number> = {
  lead_to_qualified: 5,
  pickup_rate: 20,
  booking_rate: 5,
  hand_raise_rate: 5,
  lead_booking_rate: 5,
  show_rate: 5,
  close_rate: 10,
  cpl: 5,
  cpql: 3,
  cps: 5,
};

/**
 * Per-client manual benchmark overrides. Sparse: only the KPIs/bands a human has
 * customized are present; everything else inherits DEFAULT_KPI_BANDS. Markets and
 * client profiles differ, so a global truth is unfair — this lets each client be
 * judged against its own bar while measurement stays identical.
 */
export type ClientKpiBenchmarks = Partial<Record<KpiKey, Bands>>;

/** Merge a client's overrides over the global defaults for one KPI. */
function resolveBands(key: KpiKey, overrides?: ClientKpiBenchmarks | null): KpiBandSpec {
  const def = DEFAULT_KPI_BANDS[key];
  const cplOverride = overrides?.cpl;

  // Conversion standards are global. CPL is the only client-specific input;
  // CPQL and CPConv are always derived from it so legacy independent overrides
  // cannot produce a mathematically inconsistent cost stack.
  if (key === 'cpl') {
    return cplOverride
      ? { ...def, bands: { ...def.bands, ...cplOverride } }
      : def;
  }
  if ((key === 'cpql' || key === 'cps') && cplOverride) {
    const bands: Bands = {};
    for (const band of ['critical', 'below', 'at'] as const) {
      const cpl = cplOverride[band] ?? DEFAULT_KPI_BANDS.cpl.bands[band];
      const qual = DEFAULT_KPI_BANDS.lead_to_qualified.bands[band];
      const conversation = DEFAULT_KPI_BANDS.hand_raise_rate.bands[band];
      if (cpl == null || qual == null || conversation == null) continue;
      const cpql = cpl / (qual / 100);
      bands[band] =
        Math.round((key === 'cpql' ? cpql : cpql / (conversation / 100)) * 100) / 100;
    }
    return { ...def, bands };
  }
  return def;
}

type ClientEventRow = EventRow & { client_id: string };
type ClientSpendRow = SpendRow & { client_id: string };

export function tierFromBands(
  value: number,
  bands: { critical?: number; below?: number; at?: number; above?: number },
  higherIsBetter: boolean,
  minDenominator: number,
  denominator: number,
): HealthTier {
  if (denominator < minDenominator) return 'insufficient';
  if (higherIsBetter) {
    if (bands.critical != null && value < bands.critical) return 'critical';
    if (bands.below != null && value < bands.below) return 'below';
    if (bands.at != null && value < bands.at) return 'at';
    return 'above';
  }
  if (bands.critical != null && value > bands.critical) return 'critical';
  if (bands.below != null && value > bands.below) return 'below';
  if (bands.at != null && value > bands.at) return 'at';
  return 'above';
}

/**
 * Overall verdict tier — anchored on the north-star metric, Cost per Conversation
 * (CPConv / `cps`).
 *
 * CPConv = total ad spend ÷ conversations, so it already integrates every upstream
 * cost and conversion inefficiency into one bottom-line number: pricey leads or a
 * leaky funnel necessarily show up as a higher CPConv. The practical effect is that
 * strong KPIs "carry" weak ones through the north star — a single underperforming
 * sub-metric no longer drags an otherwise-efficient account down to "Below". The
 * individual KPI tiers, the constraint, and attention_score still surface those
 * weak spots for triage; they just stop hijacking the headline.
 *
 * This replaces two earlier rules in turn: the original "worst-tier-wins" (one
 * 'below' nuked the account) and the equal-weight average across all 8 KPIs (which
 * let a few weak funnel metrics outvote a healthy north star).
 *
 * Fallback: when CPConv has too little volume to grade, there is no north-star
 * signal, so we revert to the volume-blind weighted average of the gradeable KPIs
 * (with the 911/critical override) rather than guessing.
 */
function computeOverallTier(graded: KpiGrade[]): HealthTier {
  if (graded.length === 0) return 'insufficient';
  const northStar = graded.find(g => g.key === 'cps');
  if (northStar) return northStar.tier;
  if (graded.some(g => g.tier === 'critical')) return 'critical';
  const avg = graded.reduce((sum, g) => sum + TIER_WEIGHT[g.tier], 0) / graded.length;
  if (avg < 1.5) return 'above';
  if (avg < 2.5) return 'at';
  return 'below';
}

/** HE verdict: worst tier among booking and show. */
function computeHeOverallTier(graded: KpiGrade[]): HealthTier {
  if (graded.length === 0) return 'insufficient';
  return graded.reduce(
    (worst, g) => (TIER_WEIGHT[g.tier] > TIER_WEIGHT[worst] ? g.tier : worst),
    'above' as HealthTier,
  );
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

export function buildClientHealthSnapshot(
  events: EventRow[],
  spendRows: SpendRow[],
  benchmarks?: ClientKpiBenchmarks | null,
): ClientHealthSnapshot {
  return clientHealthSnapshotFromMetrics(calculateMetrics(events, spendRows), benchmarks);
}

/** Grade an already-aggregated MetricsResult (from SQL RPCs or calculateMetrics). */
export function clientHealthSnapshotFromMetrics(
  metrics: MetricsResult,
  benchmarks?: ClientKpiBenchmarks | null,
): ClientHealthSnapshot {
  const lead_to_qualified_pct =
    metrics.new_leads > 0 ? (metrics.qualified_leads / metrics.new_leads) * 100 : 0;
  const close_rate_pct =
    metrics.shows > 0 ? (metrics.closed / metrics.shows) * 100 : 0;
  const cpql =
    metrics.qualified_leads > 0 ? metrics.ad_spend / metrics.qualified_leads : 0;
  // CPConv = ad spend ÷ conversations (live transfers + shows + claimed). The verdict
  // metric. Previously this was shows-only (= CPS) mislabeled as CPConv; corrected to
  // the conversation-inclusive definition so the live-transfer path is credited.
  const cpconv = metrics.cp_conversation;
  // Unique leads who showed, were claimed, or live-transferred — same denominator as
  // metrics.cp_conversation. Raw event sums double-count and inflated the volume guard
  // so a $0 CPConv (missing identity fields) could still grade as "Above KPI".
  const conversation_count = metrics.unique_conversations;
  // Conversation yield = unique conversations ÷ qualified leads (credits the live-transfer
  // path, not just shows), keeping CPQL ÷ CY == CPConv consistent.
  const conversation_yield =
    metrics.qualified_leads > 0 ? conversation_count / metrics.qualified_leads : 0;

  // Grade one KPI against its resolved (default + per-client override) bands.
  const grade = (key: KpiKey, value: number, display: string, denominator: number): KpiGrade => {
    const spec = resolveBands(key, benchmarks);
    return gradeKpi(
      key,
      value,
      display,
      tierFromBands(value, spec.bands, spec.higherIsBetter, KPI_MIN_DENOMINATOR[key], denominator),
    );
  };

  const grades: KpiGrade[] = [
    grade('lead_to_qualified', lead_to_qualified_pct, formatPct(lead_to_qualified_pct), metrics.new_leads),
    grade('hand_raise_rate', metrics.hand_raise_rate, formatPct(metrics.hand_raise_rate), metrics.qualified_leads),
    // Show Rate: unique booked leads who spoke (show∪claim∪LT) ÷ unique booked.
    // Denominator is unique bookings — sample enough unique booked, not event show+no-show.
    grade(
      'show_rate',
      metrics.booked_to_conversation_rate,
      formatPct(metrics.booked_to_conversation_rate),
      metrics.unique_booked_appointments,
    ),
    grade('close_rate', close_rate_pct, formatPct(close_rate_pct), metrics.shows),
    grade('cpl', metrics.cpl, formatMoney(metrics.cpl), metrics.new_leads),
    grade('cpql', cpql, formatMoney(cpql), metrics.qualified_leads),
    // True CPConv (cost per conversation), the verdict metric.
    grade('cps', cpconv, formatMoney(cpconv), conversation_count),
  ];

  const graded = grades.filter(g => g.tier !== 'insufficient');
  const worst_tier = computeOverallTier(graded);
  const attention_score = graded.reduce((sum, g) => sum + TIER_WEIGHT[g.tier], 0);
  const { constraint, constraint_label } = inferConstraint(metrics, grades, lead_to_qualified_pct, cpql);

  return {
    metrics,
    lead_to_qualified_pct,
    close_rate_pct,
    cpql,
    cpconv,
    conversation_yield,
    optin_rate_pct: 0,
    grades,
    worst_tier,
    attention_score,
    constraint,
    constraint_label,
  };
}

export type CriteriaAccountMode = 'cpconv' | 'worst' | 'acquisition';

export type CriteriaGradePlan = {
  gradedKeys: KpiKey[];
  bands: Partial<Record<KpiKey, KpiBandSpec & { minDenominator?: number }>>;
  /** Null on call center (all-leads hand-raise is already on the metrics). */
  pool: DialPool | null;
  accountMode: CriteriaAccountMode;
  notes?: Partial<Record<KpiKey, string>>;
};

function accountTierForCriteria(grades: KpiGrade[], mode: CriteriaAccountMode): HealthTier {
  const usable = grades.filter(g => g.tier !== 'insufficient' && g.key !== 'close_rate');
  if (usable.length === 0) return 'insufficient';
  if (mode === 'cpconv') {
    const north = usable.find(g => g.key === 'cps');
    if (north) return north.tier;
    if (usable.some(g => g.tier === 'critical')) return 'critical';
    const avg = usable.reduce((sum, g) => sum + TIER_WEIGHT[g.tier], 0) / usable.length;
    if (avg < 1.5) return 'above';
    if (avg < 2.5) return 'at';
    return 'below';
  }
  return usable.reduce(
    (worst, g) => (TIER_WEIGHT[g.tier] > TIER_WEIGHT[worst] ? g.tier : worst),
    'above' as HealthTier,
  );
}

/**
 * Grade one window with an already-resolved ruler. Close rate can appear in
 * `grades` and stays out of the account tier. Missing bands grade insufficient.
 */
export function clientHealthSnapshotForCriteria(
  metrics: MetricsResult,
  plan: CriteriaGradePlan,
): ClientHealthSnapshot {
  const m = plan.pool === 'all' ? withDialPoolRates(metrics, 'all') : metrics;
  const lead_to_qualified_pct =
    m.new_leads > 0 ? (m.qualified_leads / m.new_leads) * 100 : 0;
  const close_rate_pct = m.shows > 0 ? (m.closed / m.shows) * 100 : 0;
  const cpql = m.qualified_leads > 0 ? m.ad_spend / m.qualified_leads : 0;
  const cpconv = m.cp_conversation;
  const conversation_yield =
    m.qualified_leads > 0 ? m.unique_conversations / m.qualified_leads : 0;

  const measure = (key: KpiKey): { value: number; display: string; denominator: number } => {
    switch (key) {
      case 'lead_to_qualified':
        return { value: lead_to_qualified_pct, display: formatPct(lead_to_qualified_pct), denominator: m.new_leads };
      case 'hand_raise_rate':
        if (plan.pool == null) {
          return {
            value: m.lead_hand_raise_rate,
            display: formatPct(m.lead_hand_raise_rate),
            denominator: m.new_leads,
          };
        }
        return {
          value: m.hand_raise_rate,
          display: formatPct(m.hand_raise_rate),
          denominator: plan.pool === 'all' ? m.new_leads : m.qualified_leads,
        };
      case 'show_rate':
        return {
          value: m.booked_to_conversation_rate,
          display: formatPct(m.booked_to_conversation_rate),
          denominator: m.unique_booked_appointments,
        };
      case 'close_rate':
        return { value: close_rate_pct, display: formatPct(close_rate_pct), denominator: m.shows };
      case 'cpl':
        return { value: m.cpl, display: formatMoney(m.cpl), denominator: m.new_leads };
      case 'cpql':
        return { value: cpql, display: formatMoney(cpql), denominator: m.qualified_leads };
      case 'cps':
        return { value: cpconv, display: formatMoney(cpconv), denominator: m.unique_conversations };
      default:
        return { value: 0, display: '—', denominator: 0 };
    }
  };

  const ruler_edges: NonNullable<ClientHealthSnapshot['ruler_edges']> = {};
  const grades: KpiGrade[] = plan.gradedKeys.map(key => {
    const measured = measure(key);
    const spec = plan.bands[key];
    const note = plan.notes?.[key];
    if (spec?.bands) {
      ruler_edges[key] = spec.bands;
    }
    const tier =
      note || !spec
        ? 'insufficient'
        : tierFromBands(
            measured.value,
            spec.bands,
            spec.higherIsBetter,
            spec.minDenominator ?? KPI_MIN_DENOMINATOR[key],
            measured.denominator,
          );
    return { ...gradeKpi(key, measured.value, measured.display, tier), ...(note ? { note } : {}) };
  });

  const graded = grades.filter(g => g.tier !== 'insufficient');
  const worst_tier = accountTierForCriteria(grades, plan.accountMode);
  const attention_score = graded.reduce((sum, g) => sum + TIER_WEIGHT[g.tier], 0);
  const constraintInput = plan.accountMode === 'worst'
    ? inferHeConstraint(m, grades)
    : inferConstraint(m, grades, lead_to_qualified_pct, cpql);

  return {
    metrics: m,
    lead_to_qualified_pct,
    close_rate_pct,
    cpql,
    cpconv,
    conversation_yield,
    optin_rate_pct: 0,
    grades,
    worst_tier,
    attention_score,
    constraint: constraintInput.constraint,
    constraint_label: constraintInput.constraint_label,
    ruler_edges,
  };
}

/** HE (appointment-only) health snapshot — grades unique hand-raise + show only. */
export function buildHeClientHealthSnapshot(
  events: EventRow[],
  benchmarks?: ClientKpiBenchmarks | null,
): ClientHealthSnapshot {
  return heClientHealthSnapshotFromMetrics(calculateMetrics(events, []), benchmarks);
}

export function heClientHealthSnapshotFromMetrics(
  metrics: MetricsResult,
  benchmarks?: ClientKpiBenchmarks | null,
): ClientHealthSnapshot {
  const lead_to_qualified_pct =
    metrics.new_leads > 0 ? (metrics.qualified_leads / metrics.new_leads) * 100 : 0;
  const close_rate_pct =
    metrics.shows > 0 ? (metrics.closed / metrics.shows) * 100 : 0;

  // HE conversion = unique hand-raises (booked ∪ claimed ∪ LT) ÷ total leads.
  // Uses lead_booking_rate bands (calibrated for ÷ all leads, not ÷ qualified).
  const heHandRaisePct = metrics.lead_hand_raise_rate;

  const grade = (key: KpiKey, value: number, display: string, denominator: number): KpiGrade => {
    const spec =
      key === 'hand_raise_rate'
        ? resolveBands('lead_booking_rate', benchmarks)
        : resolveBands(key, benchmarks);
    const minDenom =
      key === 'hand_raise_rate'
        ? KPI_MIN_DENOMINATOR.lead_booking_rate
        : KPI_MIN_DENOMINATOR[key];
    return gradeKpi(
      key,
      value,
      display,
      tierFromBands(value, spec.bands, spec.higherIsBetter, minDenom, denominator),
    );
  };

  const grades: KpiGrade[] = [
    grade('hand_raise_rate', heHandRaisePct, formatPct(heHandRaisePct), metrics.new_leads),
    grade(
      'show_rate',
      metrics.booked_to_conversation_rate,
      formatPct(metrics.booked_to_conversation_rate),
      metrics.unique_booked_appointments,
    ),
  ];

  const graded = grades.filter(g => g.tier !== 'insufficient');
  const worst_tier = computeHeOverallTier(graded);
  const attention_score = graded.reduce((sum, g) => sum + TIER_WEIGHT[g.tier], 0);
  const { constraint, constraint_label } = inferHeConstraint(metrics, grades);

  return {
    metrics,
    lead_to_qualified_pct,
    close_rate_pct,
    cpql: 0,
    cpconv: 0,
    conversation_yield: 0,
    optin_rate_pct: 0,
    grades,
    worst_tier,
    attention_score,
    constraint,
    constraint_label,
  };
}

function gradeKpi(
  key: KpiKey,
  value: number,
  display: string,
  tier: HealthTier,
): KpiGrade {
  return {
    key,
    label: KPI_META[key].label,
    value,
    display,
    tier,
    tierLabel: TIER_LABEL[tier],
  };
}

function tierAtOrBetter(tier: HealthTier, target: HealthTier): boolean {
  return TIER_WEIGHT[tier] <= TIER_WEIGHT[target];
}

function inferConstraint(
  metrics: MetricsResult,
  grades: KpiGrade[],
  leadToQual: number,
  cpql: number,
): { constraint: ConstraintLayer; constraint_label: string } {
  const byKey = Object.fromEntries(grades.map(g => [g.key, g])) as Record<KpiKey, KpiGrade>;
  const hasData = metrics.new_leads > 0 || metrics.booked_appointments > 0;
  if (!hasData) {
    return { constraint: 'insufficient_data', constraint_label: 'No activity in period' };
  }

  const cpqlOk =
    byKey.cpql != null &&
    byKey.cpql.tier !== 'insufficient' &&
    (byKey.cpql.tier === 'at' || byKey.cpql.tier === 'above');
  const handRaiseBad =
    byKey.hand_raise_rate?.tier === 'critical' || byKey.hand_raise_rate?.tier === 'below';
  const showBad = byKey.show_rate?.tier === 'critical' || byKey.show_rate?.tier === 'below';
  const qualBad =
    byKey.lead_to_qualified?.tier === 'critical' || byKey.lead_to_qualified?.tier === 'below';
  const cplBad = byKey.cpl?.tier === 'critical' || byKey.cpl?.tier === 'below';
  const cpqlBad = byKey.cpql?.tier === 'critical' || byKey.cpql?.tier === 'below';
  const cpsBad = byKey.cps?.tier === 'critical' || byKey.cps?.tier === 'below';

  const individualOk =
    grades.filter(g => g.tier !== 'insufficient').every(g => tierAtOrBetter(g.tier, 'at')) &&
    grades.some(g => g.tier !== 'insufficient');

  if (individualOk && cpsBad) {
    return { constraint: 'data_issue', constraint_label: 'Check attribution — metrics OK but CPS high' };
  }
  if (qualBad) {
    return { constraint: 'lead_quality', constraint_label: 'Lead quality — targeting / messaging' };
  }
  if (cplBad && cpqlBad) {
    return { constraint: 'lead_cost', constraint_label: 'Lead cost — ads / audience' };
  }
  if (cpqlOk && handRaiseBad) {
    return { constraint: 'call_center', constraint_label: 'Call center — script / booking flow' };
  }
  if (!handRaiseBad && showBad && metrics.booked_appointments >= 3) {
    return { constraint: 'show_rate', constraint_label: 'Show Rate — confirmations / rebook / LO prep' };
  }
  if (grades.every(g => g.tier === 'insufficient')) {
    return { constraint: 'insufficient_data', constraint_label: 'Not enough volume to grade' };
  }
  return { constraint: 'healthy', constraint_label: 'Within KPI range — monitor' };
}

function inferHeConstraint(
  metrics: MetricsResult,
  grades: KpiGrade[],
): { constraint: ConstraintLayer; constraint_label: string } {
  const byKey = Object.fromEntries(grades.map(g => [g.key, g])) as Partial<Record<KpiKey, KpiGrade>>;
  const hasData =
    metrics.new_leads > 0 || metrics.booked_appointments > 0 || metrics.outbound_dials > 0;
  if (!hasData) {
    return { constraint: 'insufficient_data', constraint_label: 'No activity in period' };
  }

  const handRaiseBad =
    byKey.hand_raise_rate?.tier === 'critical' || byKey.hand_raise_rate?.tier === 'below';
  const showBad = byKey.show_rate?.tier === 'critical' || byKey.show_rate?.tier === 'below';

  if (handRaiseBad) {
    return { constraint: 'call_center', constraint_label: 'Call center — script / booking / LT flow' };
  }
  if (showBad && metrics.booked_appointments >= 3) {
    return { constraint: 'show_rate', constraint_label: 'Show Rate — confirmations / rebook / LO prep' };
  }
  if (grades.every(g => g.tier === 'insufficient')) {
    return { constraint: 'insufficient_data', constraint_label: 'Not enough volume to grade' };
  }
  return { constraint: 'healthy', constraint_label: 'Within KPI range — monitor' };
}

const CONSTRAINT_LAYER: Record<ConstraintLayer, FunnelLayer> = {
  lead_quality: 'L2',
  lead_cost: 'L1',
  call_center: 'L3',
  show_rate: 'L4',
  data_issue: 'DATA',
  healthy: 'NONE',
  insufficient_data: 'NONE',
};

/**
 * Turn a computed snapshot into a plain-English "what's wrong / what to do"
 * payload. The numbers come from the deterministic engine; this only frames
 * them and attaches the right levers + owners from the diagnostic playbook.
 */
function rulerEdge(
  snapshot: ClientHealthSnapshot,
  key: KpiKey,
): { critical?: number; below?: number; at?: number } {
  return snapshot.ruler_edges?.[key] ?? DEFAULT_KPI_BANDS[key].bands;
}

function atKpiPhrase(snapshot: ClientHealthSnapshot, key: KpiKey): string {
  const edge = rulerEdge(snapshot, key);
  const spec = DEFAULT_KPI_BANDS[key];
  const fmt = (n: number | undefined) =>
    n == null ? '—' : spec.unit === 'money' ? formatMoney(n) : `${n}%`;
  if (spec.higherIsBetter) {
    return `At KPI is ${fmt(edge.below)} up to under ${fmt(edge.at)}`;
  }
  return `At KPI is above ${fmt(edge.at)} through ${fmt(edge.below)}`;
}

export function buildConstraintGuidance(
  snapshot: ClientHealthSnapshot,
  reportingType: ReportingType = 'RM',
): ConstraintGuidance {
  if (usesCallCenterKpiLayout(reportingType)) {
    return buildHeConstraintGuidance(snapshot);
  }
  const m = snapshot.metrics;
  const layer = CONSTRAINT_LAYER[snapshot.constraint];

  const conversationCount = m.unique_conversations;
  const cpconvMath =
    conversationCount > 0
      ? `${formatMoney(m.ad_spend)} spend ÷ ${conversationCount} unique conversation${conversationCount === 1 ? '' : 's'} (show ∪ claimed ∪ live transfer) = ${formatMoney(snapshot.cpconv)} CPConv`
      : `No conversations in period — CPConv cannot be computed (${formatMoney(m.ad_spend)} spend, 0 conversations)`;

  const crossCheck =
    snapshot.conversation_yield > 0 && snapshot.cpql > 0
      ? `Cross-check: CPQL ${formatMoney(snapshot.cpql)} ÷ CY ${snapshot.conversation_yield.toFixed(3)} = ${formatMoney(
          snapshot.cpql / snapshot.conversation_yield,
        )}`
      : 'Cross-check unavailable (need qualified leads + conversations).';

  const base = { layer, cpconvMath, crossCheck };

  switch (snapshot.constraint) {
    case 'lead_quality':
      return {
        ...base,
        headline: 'Lead quality — too few leads qualify',
        whatsWrong: `Only ${snapshot.lead_to_qualified_pct.toFixed(0)}% of leads qualify (${atKpiPhrase(snapshot, 'lead_to_qualified')}). The ads are attracting the wrong people, so spend is wasted before the call center ever gets a fair shot. CPQL is ${formatMoney(
          snapshot.cpql,
        )}.`,
        fixSteps: [
          {
            owner: 'Media buyer (L1–L2)',
            action: 'Pull disqualification reasons and tighten audience/targeting toward the qualifying archetype.',
            timebox: '7 days',
            successMetric: atKpiPhrase(snapshot, 'lead_to_qualified'),
          },
          {
            owner: 'Media buyer (L2)',
            action: 'Sharpen ad message + landing-page match so the offer self-selects qualified leads.',
            timebox: '7 days',
          },
          {
            owner: 'CSR manager (L3)',
            action: 'Confirm qualification criteria are applied consistently on calls (not too loose).',
          },
        ],
        doNotDo: [
          'Do not blame the call center yet — fix targeting first.',
          'Do not just cut budget; that lowers volume without fixing quality.',
        ],
      };
    case 'lead_cost':
      return {
        ...base,
        headline: 'Lead cost — qualified leads are too expensive',
        whatsWrong: `CPL is ${formatMoney(m.cpl)} and CPQL is ${formatMoney(
          snapshot.cpql,
        )} — both above the ruler in force (${atKpiPhrase(snapshot, 'cpql')}). Leads qualify fine, they just cost too much, which drags CPConv to ${formatMoney(
          snapshot.cpconv,
        )}.`,
        fixSteps: [
          {
            owner: 'Media buyer (L1)',
            action: 'Rotate 3–5 fresh creatives and widen the audience to lower acquisition cost.',
            timebox: '7 days',
            successMetric: atKpiPhrase(snapshot, 'cpql'),
          },
          {
            owner: 'Media buyer (L1)',
            action: 'Check frequency/fatigue; pause the worst-performing ad sets by CPQL.',
            timebox: '7 days',
          },
        ],
        doNotDo: [
          'Do not tighten qualification — leads already qualify; that would only cut volume.',
        ],
      };
    case 'call_center':
      return {
        ...base,
        headline: 'Call center — leads qualify but are not raising their hand',
        whatsWrong: `Lead cost is healthy (CPQL ${formatMoney(
          snapshot.cpql,
        )}) but hand-raise rate is ${m.hand_raise_rate.toFixed(
          0,
        )}% (booked + claimed + live transfers ÷ qualified). The constraint is in the booking script, live-transfer path, or follow-up flow.`,
        fixSteps: [
          {
            owner: 'CSR manager (L3)',
            action: 'Audit booking script, live-transfer handoff, text/SMS follow-up, and speed-to-lead for qualified leads.',
            timebox: '5 business days',
            successMetric: atKpiPhrase(snapshot, 'hand_raise_rate'),
          },
          {
            owner: 'CSR manager (L3)',
            action: 'Audit speed-to-lead and number of dial attempts per lead.',
            timebox: '5 business days',
          },
        ],
        doNotDo: [
          'Do not change the ad campaign — the upstream funnel is healthy (G-1).',
        ],
      };
    case 'show_rate':
      return {
        ...base,
        headline: 'Show Rate — booked leads are not speaking to the LO',
        whatsWrong: `Booking is healthy but only ${m.booked_to_conversation_rate.toFixed(
          0,
        )}% of unique booked leads spoke (${m.unique_booked_converted} of ${m.unique_booked_appointments}). Include show, claim, and live transfer after recovery.`,
        fixSteps: [
          {
            owner: 'Client success (L4)',
            action: 'Audit and strengthen the GHL reminder/confirmation sequence (SMS + call) before each appointment.',
            timebox: '5 business days',
            successMetric: atKpiPhrase(snapshot, 'show_rate'),
          },
          {
            owner: 'Client success (L4)',
            action: 'Run no-show rebook process aggressively; prefer near-term slots and LO pre-call prep.',
            timebox: '5 business days',
          },
        ],
        doNotDo: [
          'Do not re-diagnose ads or booking — those layers are clear.',
        ],
      };
    case 'data_issue':
      return {
        ...base,
        headline: 'Data / attribution — metrics look fine but CPConv is off',
        whatsWrong: `Every upstream metric reads At KPI, yet CPConv is ${formatMoney(
          snapshot.cpconv,
        )}. That pattern points to a tracking/disposition gap, not an operational failure.`,
        fixSteps: [
          {
            owner: 'Ops / Founder',
            action: 'Validate appointment dispositions, spend reconciliation, and show/no-show logging before any operational change.',
            timebox: 'Immediate',
          },
          {
            owner: 'Founder',
            action: 'Escalate — no funnel changes until attribution is confirmed.',
            timebox: 'Same day',
          },
        ],
        doNotDo: [
          'Do not make ads, booking, or show-rate changes until the data is trusted (G-2).',
        ],
      };
    case 'insufficient_data':
      return {
        ...base,
        headline: 'Not enough volume to grade',
        whatsWrong:
          'This account does not have enough leads/appointments in the selected period to produce a reliable verdict. Treat any tier as provisional.',
        fixSteps: [
          {
            owner: 'Client success',
            action: 'Widen the date range or wait for more volume before diagnosing.',
          },
        ],
        doNotDo: ['Do not act on a single low-volume week.'],
      };
    case 'healthy':
    default:
      return {
        ...base,
        headline: 'Healthy — within KPI range',
        whatsWrong: `CPConv is ${formatMoney(
          snapshot.cpconv,
        )} and all layers are at or above target. The funnel is working.`,
        fixSteps: [
          {
            owner: 'Client success',
            action: `Log weekly and monitor the last-${LEADING_WINDOW_DAYS}-day trend for early slides.`,
          },
        ],
        doNotDo: [
          'Do not chase CPL or pause campaigns over a single upstream metric while CPConv is healthy (G-1).',
        ],
      };
  }
}

function buildHeConstraintGuidance(snapshot: ClientHealthSnapshot): ConstraintGuidance {
  const heSnapshot: ClientHealthSnapshot = snapshot.ruler_edges?.hand_raise_rate
    ? snapshot
    : {
        ...snapshot,
        ruler_edges: {
          ...snapshot.ruler_edges,
          hand_raise_rate: DEFAULT_KPI_BANDS.lead_booking_rate.bands,
        },
      };
  const hePhrase = (key: KpiKey) => atKpiPhrase(heSnapshot, key);
  const m = snapshot.metrics;
  const heHandRaisePct = m.lead_hand_raise_rate;
  const base = {
    layer: CONSTRAINT_LAYER[snapshot.constraint],
    cpconvMath: `${m.outbound_dials} outbound dials · ${m.new_leads} leads · ${m.unique_hand_raises} unique hand-raises`,
    crossCheck: `Hand-raise ${heHandRaisePct.toFixed(1)}% (unique ÷ total leads) · Show rate ${m.booked_to_conversation_rate.toFixed(0)}% · ${m.outbound_dials} dials`,
  };

  switch (snapshot.constraint) {
    case 'call_center':
      return {
        ...base,
        headline: 'Call center — leads are not converting to hand-raises',
        whatsWrong: `Unique hand-raise rate is ${heHandRaisePct.toFixed(
          1,
        )}% (÷ total leads). With ${m.outbound_dials} dials in period, the constraint is in the booking / LT script or text follow-up.`,
        fixSteps: [
          {
            owner: 'CSR manager (L3)',
            action: 'Audit booking script and text/SMS cadence — many HE bookings happen without a long phone pickup.',
            timebox: '5 business days',
            successMetric: hePhrase('hand_raise_rate'),
          },
          {
            owner: 'CSR manager (L3)',
            action: 'Audit speed-to-lead and number of dial attempts per lead.',
            timebox: '5 business days',
          },
        ],
        doNotDo: ['Do not compare to ad-cost metrics — HE accounts have no ad spend.'],
      };
    case 'show_rate':
      return {
        ...base,
        headline: 'Show Rate — booked leads are not speaking to the LO',
        whatsWrong: `Hand-raise is healthy but only ${m.booked_to_conversation_rate.toFixed(
          0,
        )}% of unique booked leads spoke (${m.unique_booked_converted} of ${m.unique_booked_appointments}).`,
        fixSteps: [
          {
            owner: 'Client success (L4)',
            action: 'Audit and strengthen the GHL reminder/confirmation sequence (SMS + call) before each appointment.',
            timebox: '5 business days',
            successMetric: hePhrase('show_rate'),
          },
          {
            owner: 'Client success (L4)',
            action: 'Run no-show rebook process aggressively; prefer near-term slots and LO pre-call prep.',
            timebox: '5 business days',
          },
        ],
        doNotDo: ['Do not re-diagnose dialing — focus on post-booking follow-through.'],
      };
    case 'insufficient_data':
      return {
        ...base,
        headline: 'Not enough volume to grade',
        whatsWrong:
          'This account does not have enough leads/dials/appointments in the selected period to produce a reliable verdict.',
        fixSteps: [
          {
            owner: 'Client success',
            action: 'Widen the date range or wait for more volume before diagnosing.',
          },
        ],
        doNotDo: ['Do not act on a single low-volume week.'],
      };
    case 'healthy':
    default:
      return {
        ...base,
        headline: 'Healthy — within KPI range',
        whatsWrong: `Hand-raise ${heHandRaisePct.toFixed(1)}%, Show rate ${m.booked_to_conversation_rate.toFixed(
          0,
        )}% — all at or above target.`,
        fixSteps: [
          {
            owner: 'Client success',
            action: 'Log weekly and monitor the recent trend for early slides.',
          },
        ],
        doNotDo: ['Do not chase volume at the expense of hand-raise or Show Rate.'],
      };
  }
}

export type SuccessMetricKey =
  | 'cpconv'
  | 'cpql'
  | 'cpl'
  | 'show_rate'
  | 'hand_raise_rate'
  | 'booking_rate'
  | 'lead_booking_rate'
  | 'lead_to_qual'
  | 'conversation_yield'
  | 'optin_rate';

export const SUCCESS_METRIC_META: Record<
  SuccessMetricKey,
  { label: string; lowerIsBetter: boolean; unit: 'money' | 'pct' | 'ratio' }
> = {
  cpconv: { label: 'CPConv (cost / conv)', lowerIsBetter: true, unit: 'money' },
  cpql: { label: 'Cost per qualified lead', lowerIsBetter: true, unit: 'money' },
  cpl: { label: 'Cost per lead', lowerIsBetter: true, unit: 'money' },
  show_rate: { label: 'Show Rate (unique booked → spoke)', lowerIsBetter: false, unit: 'pct' },
  hand_raise_rate: { label: 'Hand-raise rate (unique booked ∪ claimed ∪ LT)', lowerIsBetter: false, unit: 'pct' },
  booking_rate: { label: 'Booking rate (unique ÷ qualified)', lowerIsBetter: false, unit: 'pct' },
  lead_booking_rate: { label: 'Booking rate (unique ÷ total leads)', lowerIsBetter: false, unit: 'pct' },
  lead_to_qual: { label: 'Lead-to-qualified', lowerIsBetter: false, unit: 'pct' },
  conversation_yield: { label: 'Conversation yield', lowerIsBetter: false, unit: 'ratio' },
  optin_rate: { label: 'Opt-in rate (leads ÷ ad clicks)', lowerIsBetter: false, unit: 'pct' },
};

/** Pull a single success-metric value out of a computed snapshot. */
export function metricValue(
  snapshot: ClientHealthSnapshot,
  key: SuccessMetricKey,
  reportingType: ReportingType = 'RM',
): number {
  const isHe = usesCallCenterKpiLayout(reportingType);
  switch (key) {
    case 'cpconv':
      return snapshot.cpconv;
    case 'cpql':
      return snapshot.cpql;
    case 'cpl':
      return snapshot.metrics.cpl;
    case 'show_rate':
      return snapshot.metrics.booked_to_conversation_rate;
    case 'hand_raise_rate':
      return snapshot.metrics.hand_raise_rate;
    case 'booking_rate':
      return isHe ? snapshot.metrics.lead_booking_rate : snapshot.metrics.appt_booking_rate;
    case 'lead_booking_rate':
      return snapshot.metrics.lead_booking_rate;
    case 'lead_to_qual':
      return snapshot.lead_to_qualified_pct;
    case 'conversation_yield':
      return snapshot.conversation_yield;
    case 'optin_rate':
      return snapshot.optin_rate_pct;
  }
}

export function compareHealthTrend(
  current: ClientHealthSnapshot,
  prior: ClientHealthSnapshot | null,
): { trend: ClientHealthRow['trend']; trend_delta_score: number } {
  if (!prior || (!prior.metrics.new_leads && !prior.metrics.booked_appointments)) {
    return { trend: 'new', trend_delta_score: 0 };
  }
  const delta = current.attention_score - prior.attention_score;
  if (current.attention_score === 0 && prior.attention_score === 0) {
    return { trend: 'insufficient', trend_delta_score: 0 };
  }
  if (delta <= -2) return { trend: 'improved', trend_delta_score: delta };
  if (delta >= 2) return { trend: 'worsened', trend_delta_score: delta };
  return { trend: 'stable', trend_delta_score: delta };
}

export function computePriorityScore(row: ClientHealthRow): number {
  return computeFocusPriority(row);
}

/**
 * Maturity cutoff (days). Most bookings land within ~2 days of the lead inquiry;
 * a 3-day buffer covers that lag plus light outcome settling so CPConv / show /
 * close stay trustworthy. The verdict window excludes the most recent MATURITY_DAYS.
 */
export const MATURITY_DAYS = 3;

/**
 * Calendar-last N days through today for the leading early-warning instrument
 * (CPL, CPQL, qual %, hand-raise / booking). Independent of the matured verdict.
 */
export const LEADING_WINDOW_DAYS = 5;

/** @deprecated Use LEADING_WINDOW_DAYS */
export const RECENT_WINDOW_DAYS = LEADING_WINDOW_DAYS;

/** CPL/CPQL share the leading calendar window. */
export const FRESH_COST_WINDOW_DAYS = LEADING_WINDOW_DAYS;

function shiftDays(date: string, n: number): string {
  const ms = new Date(`${date}T00:00:00.000Z`).getTime() + n * 86400000;
  return new Date(ms).toISOString().split('T')[0];
}

function utcToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Clamp the selected [start, end] back by `maturityDays` to get the matured
 * verdict window. `empty` is true when the selected window is too recent to have
 * any matured data (e.g. "Last 7 Days") — the verdict is then "still maturing"
 * and the Recent instrument carries the signal.
 */
export function maturedWindow(
  start: string,
  end: string,
  today: string = utcToday(),
  maturityDays: number = MATURITY_DAYS,
): { start: string; end: string; empty: boolean; clamped: boolean; matured_through: string; maturity_days: number } {
  const cutoff = shiftDays(today, -maturityDays);
  const maturedEnd = end < cutoff ? end : cutoff;
  return {
    start,
    end: maturedEnd,
    empty: maturedEnd < start,
    clamped: maturedEnd < end,
    matured_through: maturedEnd,
    maturity_days: maturityDays,
  };
}

/** Calendar-last N days through today — leading funnel + cost alarms. */
export function calendarLeadingWindow(
  days: number = LEADING_WINDOW_DAYS,
  today: string = utcToday(),
): { start: string; end: string; window_days: number } {
  const start = shiftDays(today, -(days - 1));
  return { start, end: today, window_days: days };
}

export function daysSinceLaunch(launchDate: string, today: string = utcToday()): number {
  const launchMs = new Date(`${launchDate}T00:00:00.000Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
  return Math.floor((todayMs - launchMs) / 86400000);
}

/** True when the client is in the first {@link FRESH_LAUNCH_DAYS} after launch. */
export function isFreshLaunchClient(
  launchDate: string | null | undefined,
  today: string = utcToday(),
): boolean {
  if (!launchDate) return false;
  const days = daysSinceLaunch(launchDate, today);
  return days >= 0 && days < FRESH_LAUNCH_DAYS;
}

/** Calendar window from launch date through today (capped at 14 days). */
export function freshLaunchWindow(
  launchDate: string,
  today: string = utcToday(),
): { start: string; end: string; window_days: number } {
  const cappedEnd = shiftDays(launchDate, FRESH_LAUNCH_DAYS - 1);
  const end = today < cappedEnd ? today : cappedEnd;
  const window_days = daysSinceLaunch(launchDate, today) + 1;
  return { start: launchDate, end, window_days: Math.min(window_days, FRESH_LAUNCH_DAYS) };
}

export function computeFreshOverallTier(graded: KpiGrade[]): HealthTier {
  if (graded.length === 0) return 'insufficient';
  if (graded.some(g => g.tier === 'critical')) return 'critical';
  return graded.reduce(
    (worst, g) => (TIER_WEIGHT[g.tier] > TIER_WEIGHT[worst] ? g.tier : worst),
    'above' as HealthTier,
  );
}

/** Grade a newly launched client on CPL / CPQL / hand-raise (no CPConv). */
export function buildFreshLaunchSnapshot(
  events: EventRow[],
  spendRows: SpendRow[],
  launchDate: string,
  reportingType: ReportingType = 'RM',
  benchmarks?: ClientKpiBenchmarks | null,
  today: string = utcToday(),
): FreshLaunchSnapshot {
  const win = freshLaunchWindow(launchDate, today);
  const isHe = usesCallCenterKpiLayout(reportingType);
  const snap = isHe
    ? buildHeClientHealthSnapshot(events, benchmarks)
    : buildClientHealthSnapshot(events, spendRows, benchmarks);
  const m = snap.metrics;
  const keys = isHe ? FRESH_LAUNCH_HE_KEYS : FRESH_LAUNCH_RM_KEYS;
  const grades = snap.grades.filter(g => keys.includes(g.key));
  const graded = grades.filter(g => g.tier !== 'insufficient');

  return {
    launch_date: launchDate,
    days_since_launch: daysSinceLaunch(launchDate, today),
    window_days: win.window_days,
    start: win.start,
    end: win.end,
    leads: m.new_leads,
    qualified_leads: m.qualified_leads,
    dials: m.outbound_dials,
    grades,
    worst_tier: computeFreshOverallTier(graded),
  };
}

/** @deprecated Verdict-relative slice; use calendarLeadingWindow for leading signal. */
export function recentWindow(
  start: string,
  end: string,
  days: number = LEADING_WINDOW_DAYS,
): { start: string; end: string; window_days: number } {
  const candidate = shiftDays(end, -(days - 1));
  return { start: candidate > start ? candidate : start, end, window_days: days };
}

/** @deprecated Leading window is fixed calendar days, not scaled to verdict length. */
export function recentWindowDaysForVerdict(_verdictDays: number): number {
  return LEADING_WINDOW_DAYS;
}

/** Alias for calendarLeadingWindow — CPL/CPQL use the same leading slice. */
export function freshCostWindow(
  days: number = FRESH_COST_WINDOW_DAYS,
  today: string = utcToday(),
): { start: string; end: string; window_days: number } {
  return calendarLeadingWindow(days, today);
}

/** Prior equal-length window immediately before [recentStart, recentEnd]. */
export function getRecentPriorPeriod(
  recentStart: string,
  recentEnd: string,
): { start: string; end: string } | null {
  return getPriorPeriod(recentStart, recentEnd);
}

const LEADING_RM_FUNNEL_KEYS: KpiKey[] = ['lead_to_qualified', 'hand_raise_rate'];
const LEADING_RM_COST_KEYS: KpiKey[] = ['cpl', 'cpql'];
const LEADING_RM_KEYS: KpiKey[] = [...LEADING_RM_COST_KEYS, ...LEADING_RM_FUNNEL_KEYS];
const LEADING_HE_KEYS: KpiKey[] = ['hand_raise_rate'];

function gradeLeadingOnly(
  snap: ClientHealthSnapshot,
  keys: KpiKey[],
  benchmarks?: ClientKpiBenchmarks | null,
): KpiGrade[] {
  const byKey = Object.fromEntries(snap.grades.map(g => [g.key, g])) as Partial<Record<KpiKey, KpiGrade>>;
  return keys
    .map(k => byKey[k])
    .filter((g): g is KpiGrade => !!g && g.tier !== 'insufficient');
}

export function compareLeadingMomentum(
  current: RecentLeading,
  prior: RecentLeading | null,
  isHe = false,
): RecentLeading['momentum'] {
  if (!prior) return 'insufficient';
  const checks: boolean[] = [];
  if (current.leads >= 5 && prior.leads >= 5) {
    checks.push(current.hand_raise_rate >= prior.hand_raise_rate);
    if (!isHe) {
      checks.push(current.lead_to_qualified_pct >= prior.lead_to_qualified_pct);
    }
  }
  if (current.cpl > 0 && prior.cpl > 0) checks.push(current.cpl <= prior.cpl);
  if (current.cpql > 0 && prior.cpql > 0) checks.push(current.cpql <= prior.cpql);
  if (checks.length === 0) return 'insufficient';
  const improved = checks.filter(Boolean).length;
  const worsened = checks.length - improved;
  if (improved >= 2 && improved > worsened) return 'improving';
  if (worsened >= 2 && worsened > improved) return 'slipping';
  return 'stable';
}

/**
 * Focus triage (Overview / account lens):
 * - Act now = 911 on matured north star only (CPConv for RM; worst graded for HE)
 * - Leading-only 911s (CPL / CPQL / qual / hand-raise) → Monitor — early warning, not account 911
 * - Recovering = weak north star with improving leading momentum
 */
export function computeFocus(
  current: ClientHealthSnapshot,
  recent: RecentLeading | null,
  reportingType: ReportingType = 'RM',
): FocusResult {
  const isHe = usesCallCenterKpiLayout(reportingType);
  const northStar = isHe
    ? current.grades.find(g => g.tier === 'critical')
    : current.grades.find(g => g.key === 'cps');
  const verdictCritical = northStar?.tier === 'critical' || current.worst_tier === 'critical';

  const leadingCritical =
    recent?.leading_grades.some(g => g.tier === 'critical') ?? false;

  const verdictWeak =
    current.worst_tier === 'critical' ||
    current.worst_tier === 'below' ||
    (current.grades.find(g => g.key === 'cps')?.tier === 'below' && !isHe);

  if (verdictCritical) {
    return {
      focus: 'act_now',
      label: 'Act now',
      verdict_critical: true,
      leading_critical: leadingCritical,
    };
  }

  if (verdictWeak && recent?.momentum === 'improving') {
    return {
      focus: 'recovering',
      label: 'Recovering',
      verdict_critical: false,
      leading_critical: leadingCritical,
    };
  }

  if (
    current.worst_tier === 'below' ||
    leadingCritical ||
    (recent?.leading_grades.some(g => g.tier === 'below') ?? false)
  ) {
    return {
      focus: 'monitor',
      label: leadingCritical ? 'Leading watch' : 'Monitor',
      verdict_critical: false,
      leading_critical: leadingCritical,
    };
  }

  return {
    focus: 'on_track',
    label: 'On track',
    verdict_critical: false,
    leading_critical: false,
  };
}

const FOCUS_PRIORITY: Record<ClientFocus, number> = {
  act_now: 4,
  monitor: 3,
  recovering: 2,
  on_track: 1,
};

export function computeFocusPriority(row: ClientHealthRow): number {
  if (!row.has_activity) return -1;
  const base = FOCUS_PRIORITY[row.focus.focus] * 10;
  const spendBoost =
    usesCallCenterKpiLayout(row.reporting_type)
      ? 0
      : Math.min(3, Math.log10(Math.max(1, row.current.metrics.ad_spend)) / 2);
  const overdueBoost = row.open_action?.overdue ? 5 : 0;
  return base + spendBoost + overdueBoost + row.current.attention_score / 10;
}

/** Build the leading-indicator summary for the recent window (spend included for RM cost KPIs). */
export function buildRecentLeading(
  events: EventRow[],
  start: string,
  end: string,
  windowDays: number = LEADING_WINDOW_DAYS,
  reportingType: ReportingType = 'RM',
  spendRows: SpendRow[] = [],
  benchmarks?: ClientKpiBenchmarks | null,
  prior?: RecentLeading | null,
  costSlice?: CostWindowSlice | null,
): RecentLeading {
  const isHe = usesCallCenterKpiLayout(reportingType);
  const funnelSnap = isHe
    ? buildHeClientHealthSnapshot(events, benchmarks)
    : buildClientHealthSnapshot(events, costSlice ? [] : spendRows, benchmarks);
  const m = funnelSnap.metrics;

  let cpl = m.cpl;
  let cpql = isHe ? 0 : (funnelSnap as ClientHealthSnapshot).cpql;
  let leading_grades: KpiGrade[];

  if (isHe) {
    leading_grades = gradeLeadingOnly(funnelSnap, LEADING_HE_KEYS, benchmarks);
  } else if (costSlice) {
    const costSnap = buildClientHealthSnapshot(costSlice.events, costSlice.spend, benchmarks);
    cpl = costSnap.metrics.cpl;
    cpql = costSnap.cpql;
    leading_grades = [
      ...gradeLeadingOnly(costSnap, LEADING_RM_COST_KEYS, benchmarks),
      ...gradeLeadingOnly(funnelSnap, LEADING_RM_FUNNEL_KEYS, benchmarks),
    ];
  } else {
    leading_grades = gradeLeadingOnly(funnelSnap, LEADING_RM_KEYS, benchmarks);
  }

  const base: RecentLeading = {
    window_days: windowDays,
    start,
    end,
    leads: m.new_leads,
    qualified_leads: m.qualified_leads,
    dials: m.outbound_dials,
    lead_to_qualified_pct: m.new_leads > 0 ? (m.qualified_leads / m.new_leads) * 100 : 0,
    conversations: m.unique_conversations,
    /** Reference only — unique booked ÷ denom. Not a graded benchmark. */
    booking_rate: isHe ? m.lead_booking_rate : m.appt_booking_rate,
    hand_raise_rate: isHe ? m.lead_hand_raise_rate : m.hand_raise_rate,
    cpl,
    cpql,
    ...(costSlice
      ? {
          cost_window_days: costSlice.window_days,
          cost_start: costSlice.start,
          cost_end: costSlice.end,
        }
      : {}),
    leading_grades,
    momentum: 'insufficient',
  };
  base.momentum = compareLeadingMomentum(base, prior ?? null, isHe);
  return base;
}

/** Build RecentLeading from pre-aggregated MetricsResult (SQL path). */
export function recentLeadingFromMetrics(input: {
  funnel: MetricsResult;
  cost?: MetricsResult | null;
  start: string;
  end: string;
  windowDays: number;
  reportingType?: ReportingType;
  benchmarks?: ClientKpiBenchmarks | null;
  prior?: RecentLeading | null;
  costWindow?: { start: string; end: string; window_days: number } | null;
  criteria?: CriteriaGradePlan | null;
}): RecentLeading {
  const reportingType = input.reportingType ?? 'RM';
  const isHe = usesCallCenterKpiLayout(reportingType);
  const funnelSnap = input.criteria
    ? clientHealthSnapshotForCriteria(input.funnel, input.criteria)
    : isHe
      ? heClientHealthSnapshotFromMetrics(input.funnel, input.benchmarks)
      : clientHealthSnapshotFromMetrics(input.funnel, input.benchmarks);

  let cpl = funnelSnap.metrics.cpl;
  let cpql = isHe ? 0 : funnelSnap.cpql;
  let leading_grades: KpiGrade[];

  if (input.criteria) {
    const allowed = new Set(input.criteria.gradedKeys);
    const leadingKeys = (isHe ? LEADING_HE_KEYS : LEADING_RM_KEYS).filter(key => allowed.has(key));
    cpl = funnelSnap.metrics.cpl;
    cpql = funnelSnap.cpql;
    leading_grades = funnelSnap.grades.filter(g => leadingKeys.includes(g.key));
  } else if (isHe) {
    leading_grades = gradeLeadingOnly(funnelSnap, LEADING_HE_KEYS, input.benchmarks);
  } else if (input.cost) {
    const costSnap = clientHealthSnapshotFromMetrics(input.cost, input.benchmarks);
    cpl = costSnap.metrics.cpl;
    cpql = costSnap.cpql;
    leading_grades = [
      ...gradeLeadingOnly(costSnap, LEADING_RM_COST_KEYS, input.benchmarks),
      ...gradeLeadingOnly(funnelSnap, LEADING_RM_FUNNEL_KEYS, input.benchmarks),
    ];
  } else {
    leading_grades = gradeLeadingOnly(funnelSnap, LEADING_RM_KEYS, input.benchmarks);
  }

  const m = funnelSnap.metrics;
  const base: RecentLeading = {
    window_days: input.windowDays,
    start: input.start,
    end: input.end,
    leads: m.new_leads,
    qualified_leads: m.qualified_leads,
    dials: m.outbound_dials,
    lead_to_qualified_pct: m.new_leads > 0 ? (m.qualified_leads / m.new_leads) * 100 : 0,
    conversations: m.unique_conversations,
    booking_rate: isHe ? m.lead_booking_rate : m.appt_booking_rate,
    hand_raise_rate: isHe ? m.lead_hand_raise_rate : m.hand_raise_rate,
    cpl,
    cpql,
    ...(input.costWindow
      ? {
          cost_window_days: input.costWindow.window_days,
          cost_start: input.costWindow.start,
          cost_end: input.costWindow.end,
        }
      : {}),
    leading_grades,
    momentum: 'insufficient',
  };
  base.momentum = compareLeadingMomentum(base, input.prior ?? null, isHe);
  return base;
}

/** Build FreshLaunchSnapshot from pre-aggregated MetricsResult (SQL path). */
export function freshLaunchFromMetrics(
  metrics: MetricsResult,
  launchDate: string,
  reportingType: ReportingType = 'RM',
  benchmarks?: ClientKpiBenchmarks | null,
  today: string = utcToday(),
  criteria?: CriteriaGradePlan | null,
): FreshLaunchSnapshot {
  const isHe = usesCallCenterKpiLayout(reportingType);
  const snap = criteria
    ? clientHealthSnapshotForCriteria(metrics, criteria)
    : isHe
      ? heClientHealthSnapshotFromMetrics(metrics, benchmarks)
      : clientHealthSnapshotFromMetrics(metrics, benchmarks);
  const win = freshLaunchWindow(launchDate, today);
  const allowed = criteria ? new Set(criteria.gradedKeys) : null;
  const keys = (isHe ? FRESH_LAUNCH_HE_KEYS : FRESH_LAUNCH_RM_KEYS).filter(
    key => !allowed || allowed.has(key),
  );
  const grades = snap.grades.filter(g => keys.includes(g.key));
  const graded = grades.filter(g => g.tier !== 'insufficient');
  return {
    launch_date: launchDate,
    days_since_launch: daysSinceLaunch(launchDate, today),
    window_days: win.window_days,
    start: win.start,
    end: win.end,
    leads: metrics.new_leads,
    qualified_leads: metrics.qualified_leads,
    dials: metrics.outbound_dials,
    grades,
    worst_tier: computeFreshOverallTier(graded),
  };
}

export function getPriorPeriod(start: string, end: string): { start: string; end: string } | null {
  if (!start || !end) return null;
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  if (endMs < startMs) return null;
  const days = Math.floor((endMs - startMs) / 86400000) + 1;
  const priorEndMs = startMs - 86400000;
  const priorStartMs = priorEndMs - (days - 1) * 86400000;
  return {
    start: new Date(priorStartMs).toISOString().split('T')[0],
    end: new Date(priorEndMs).toISOString().split('T')[0],
  };
}

export function groupEventsByClient(events: ClientEventRow[]): Map<string, EventRow[]> {
  const map = new Map<string, EventRow[]>();
  for (const e of events) {
    const list = map.get(e.client_id) ?? [];
    const { client_id: _cid, ...row } = e;
    list.push(row);
    map.set(e.client_id, list);
  }
  return map;
}

export function groupSpendByClient(rows: ClientSpendRow[]): Map<string, SpendRow[]> {
  const map = new Map<string, SpendRow[]>();
  for (const r of rows) {
    const list = map.get(r.client_id) ?? [];
    list.push({ amount: r.amount, platform: r.platform });
    map.set(r.client_id, list);
  }
  return map;
}

export function filterEventsToRange<T extends { occurred_at: string }>(
  events: T[],
  start: string,
  end: string,
): T[] {
  const startIso = `${start}T00:00:00.000Z`;
  const endIso = `${end}T23:59:59.999Z`;
  return events.filter(e => e.occurred_at >= startIso && e.occurred_at <= endIso);
}

/** Tier for a leading KPI from the calendar-recent window (defaults to insufficient). */
export function leadingGradeFor(recent: RecentLeading | null, key: KpiKey): HealthTier {
  return recent?.leading_grades.find(g => g.key === key)?.tier ?? 'insufficient';
}

export type ClientEventWithDate = ClientEventRow & { occurred_at: string };

export const FOCUS_STYLES: Record<ClientFocus, { bg: string; text: string; border: string }> = {
  act_now: { bg: 'rgba(239,68,68,0.18)', text: '#f87171', border: 'rgba(239,68,68,0.4)' },
  monitor: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24', border: 'rgba(245,158,11,0.35)' },
  recovering: { bg: 'rgba(56,189,248,0.12)', text: '#38bdf8', border: 'rgba(56,189,248,0.3)' },
  on_track: { bg: 'rgba(52,211,153,0.12)', text: '#34d399', border: 'rgba(52,211,153,0.3)' },
};

export type BuildHealthRowInput = {
  client_id: string;
  client_name: string;
  is_live: boolean;
  reporting_type: ReportingType;
  benchmarks: ClientKpiBenchmarks | null;
  verdictEvents: EventRow[];
  priorEvents: EventRow[];
  recentEvents: EventRow[];
  recentPriorEvents: EventRow[];
  verdictSpend: SpendRow[];
  priorSpend: SpendRow[];
  recentSpend: SpendRow[];
  recentPriorSpend: SpendRow[];
  /** RM only — fresh calendar leading slice for CPL/CPQL leading grades. */
  freshCost?: CostWindowSlice | null;
  freshCostPrior?: CostWindowSlice | null;
  start_date: string;
  end_date: string;
  verdictPrior: { start: string; end: string } | null;
  open_action?: OpenActionSummary | null;
  launch_date?: string | null;
  freshLaunchEvents?: EventRow[];
  freshLaunchSpend?: SpendRow[];
  today?: string;
};

/** Assemble one ClientHealthRow from pre-sliced events/spend. */
export function buildClientHealthRow(input: BuildHealthRowInput): ClientHealthRow {
  const {
    reporting_type,
    benchmarks,
    verdictEvents,
    priorEvents,
    recentEvents,
    recentPriorEvents,
    verdictSpend,
    priorSpend,
    recentSpend,
    recentPriorSpend,
    freshCost = null,
    freshCostPrior = null,
    start_date,
    end_date,
    verdictPrior,
    open_action = null,
    launch_date = null,
    freshLaunchEvents = [],
    freshLaunchSpend = [],
    today = utcToday(),
  } = input;
  const isHe = usesCallCenterKpiLayout(reporting_type);

  const fresh: FreshLaunchSnapshot | null =
    launch_date != null && isFreshLaunchClient(launch_date, today)
      ? buildFreshLaunchSnapshot(
          freshLaunchEvents,
          freshLaunchSpend,
          launch_date,
          reporting_type,
          benchmarks,
          today,
        )
      : null;
  const is_fresh_launch = fresh != null;

  const leading = calendarLeadingWindow();
  const leadingPrior = getRecentPriorPeriod(leading.start, leading.end);

  const current = isHe
    ? buildHeClientHealthSnapshot(verdictEvents, benchmarks)
    : buildClientHealthSnapshot(verdictEvents, verdictSpend, benchmarks);
  const priorSnapshot =
    verdictPrior != null
      ? isHe
        ? buildHeClientHealthSnapshot(priorEvents, benchmarks)
        : buildClientHealthSnapshot(priorEvents, priorSpend, benchmarks)
      : null;

  const recentPriorLeading =
    leadingPrior != null
      ? buildRecentLeading(
          recentPriorEvents,
          leadingPrior.start,
          leadingPrior.end,
          leading.window_days,
          reporting_type,
          recentPriorSpend,
          benchmarks,
          null,
          freshCostPrior,
        )
      : null;

  const recentLeading = buildRecentLeading(
    recentEvents,
    leading.start,
    leading.end,
    leading.window_days,
    reporting_type,
    recentSpend,
    benchmarks,
    recentPriorLeading,
    freshCost,
  );

  const { trend, trend_delta_score } = compareHealthTrend(current, priorSnapshot);
  const focus = computeFocus(current, recentLeading, reporting_type);
  const has_activity =
    current.metrics.new_leads > 0 ||
    current.metrics.booked_appointments > 0 ||
    current.metrics.ad_spend > 0 ||
    recentLeading.leads > 0 ||
    recentLeading.dials > 0 ||
    (fresh?.leads ?? 0) > 0 ||
    (fresh?.dials ?? 0) > 0;

  return {
    client_id: input.client_id,
    client_name: input.client_name,
    is_live: input.is_live,
    reporting_type,
    current,
    prior: priorSnapshot,
    trend,
    trend_delta_score,
    has_activity,
    recent: recentLeading,
    recent_prior: recentPriorLeading,
    focus,
    open_action,
    launch_date,
    is_fresh_launch,
    fresh,
  };
}

export { TIER_LABEL };
