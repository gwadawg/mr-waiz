import type { MetricsResult } from '@/lib/metrics';
import {
  DEFAULT_KPI_BANDS,
  KPI_META,
  type Bands,
  type HealthTier,
  type KpiGrade,
  type KpiKey,
} from '@/lib/client-health';

/** How spend and lead volume are linked in the UI. */
export type CostAnchor = 'spend_cpl' | 'spend_leads';

/**
 * conversation — default. Closes = conversations × close rate (people the LO spoke with).
 * pipeline — optional. Proposals → submissions → funded with separate stage rates.
 */
export type FunnelMode = 'conversation' | 'pipeline';

export type SimulatorInputs = {
  funnel_mode: FunnelMode;
  cost_anchor: CostAnchor;
  ad_spend: number;
  /** Used when cost_anchor = spend_cpl (leads derived as spend ÷ cpl). */
  cpl: number;
  /** Used when cost_anchor = spend_leads (cpl derived as spend ÷ leads). */
  total_leads: number;
  lead_to_qual_pct: number;
  booking_rate_pct: number;
  net_show_rate_pct: number;
  /** Share of qualified leads that live-transfer (parallel path). */
  live_transfer_pct: number;
  /** Share of qualified leads the client claims (parallel path). */
  claimed_pct: number;
  /** Conversation mode: funded closes ÷ conversations (people spoken with). */
  conversation_close_rate_pct: number;
  /** Pipeline mode: conversations → proposals. */
  proposal_rate_pct: number;
  /** Pipeline mode: proposals → submissions. */
  submission_rate_pct: number;
  /** Pipeline mode: submissions → funded. */
  funded_rate_pct: number;
  avg_commission: number;
};

export type SimulatorCounts = {
  total_leads: number;
  qualified_leads: number;
  booked_appointments: number;
  shows: number;
  live_transfers: number;
  claimed: number;
  conversations: number;
  proposals_made: number;
  submissions_made: number;
  funded_loans: number;
};

export type SimulatorRates = {
  lead_to_qual_pct: number;
  booking_rate_pct: number;
  net_show_rate_pct: number;
  conversation_rate_pct: number;
  conversation_yield: number;
  conversation_close_rate_pct: number;
  proposal_rate_pct: number;
  submission_rate_pct: number;
  funded_rate_pct: number;
  /** End-to-end: funded ÷ conversations (always computed when conversations > 0). */
  close_rate_from_conversations_pct: number;
};

export type SimulatorCosts = {
  cpl: number;
  cpql: number;
  cp_conversation: number;
  cp_appt: number;
  cps: number;
  cp_proposal: number;
  cp_submission: number;
  cp_funded: number;
};

export type SimulatorResult = {
  inputs: SimulatorInputs;
  counts: SimulatorCounts;
  rates: SimulatorRates;
  costs: SimulatorCosts;
  ad_spend: number;
  revenue: number;
  roas: number | null;
  cpconv_cross_check: number | null;
  grades: KpiGrade[];
};

export type WaizPreset = 'at_kpi' | 'below' | 'above';

export type GoalSolveResult = {
  target_funded: number;
  required: SimulatorCounts & { ad_spend: number };
  current: SimulatorCounts & { ad_spend: number };
  gaps: {
    ad_spend: number;
    total_leads: number;
    qualified_leads: number;
    conversations: number;
    proposals_made: number;
    submissions_made: number;
    funded_loans: number;
  };
  fastest_lever: FastestLever | null;
};

export type FastestLever = {
  field: keyof SimulatorInputs;
  label: string;
  current_funded: number;
  improved_funded: number;
  delta: number;
};

const KPI_MIN_DENOMINATOR: Partial<Record<KpiKey, number>> = {
  lead_to_qualified: 5,
  hand_raise_rate: 5,
  show_rate: 10,
  close_rate: 10,
  cpl: 5,
  cpql: 3,
  cps: 5,
};

const TIER_LABEL: Record<HealthTier, string> = {
  critical: '911',
  below: 'Below KPI',
  at: 'At KPI',
  above: 'Above KPI',
  insufficient: '—',
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function tierFromBands(
  value: number,
  bands: Bands,
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

function grade(key: KpiKey, value: number, display: string, denominator: number): KpiGrade {
  const spec = DEFAULT_KPI_BANDS[key];
  const tier = tierFromBands(
    value,
    spec.bands,
    spec.higherIsBetter,
    KPI_MIN_DENOMINATOR[key] ?? 1,
    denominator,
  );
  return {
    key,
    label: KPI_META[key].label,
    value,
    display,
    tier,
    tierLabel: TIER_LABEL[tier],
  };
}

function resolveLeadsAndSpend(inputs: SimulatorInputs): { ad_spend: number; total_leads: number; cpl: number } {
  const spend = Math.max(0, inputs.ad_spend);
  if (inputs.cost_anchor === 'spend_cpl') {
    const cpl = Math.max(0.01, inputs.cpl);
    const leads = spend / cpl;
    return { ad_spend: spend, total_leads: leads, cpl };
  }
  const leads = Math.max(0, inputs.total_leads);
  const cpl = leads > 0 ? spend / leads : 0;
  return { ad_spend: spend, total_leads: leads, cpl };
}

function pctRate(value: number): number {
  return Math.max(0, Math.min(100, value)) / 100;
}

function computeDownstreamCounts(
  inputs: SimulatorInputs,
  conversations: number,
): Pick<SimulatorCounts, 'proposals_made' | 'submissions_made' | 'funded_loans'> {
  if (inputs.funnel_mode === 'conversation') {
    const funded_loans = conversations * pctRate(inputs.conversation_close_rate_pct);
    return { proposals_made: 0, submissions_made: 0, funded_loans };
  }

  const proposalRate = pctRate(inputs.proposal_rate_pct);
  const submissionRate = pctRate(inputs.submission_rate_pct);
  const fundedRate = pctRate(inputs.funded_rate_pct);
  const proposals_made = conversations * proposalRate;
  const submissions_made = proposals_made * submissionRate;
  const funded_loans = submissions_made * fundedRate;
  return { proposals_made, submissions_made, funded_loans };
}

/** Forward simulation: assumptions → funnel counts, rates, costs, tiers. */
export function simulateFunnel(inputs: SimulatorInputs): SimulatorResult {
  const { ad_spend, total_leads } = resolveLeadsAndSpend(inputs);

  const qualRate = pctRate(inputs.lead_to_qual_pct);
  const bookingRate = pctRate(inputs.booking_rate_pct);
  const showRate = pctRate(inputs.net_show_rate_pct);
  const ltRate = pctRate(inputs.live_transfer_pct);
  const claimedRate = pctRate(inputs.claimed_pct);

  const qualified_leads = total_leads * qualRate;
  const booked_appointments = qualified_leads * bookingRate;
  const shows = booked_appointments * showRate;
  const live_transfers = qualified_leads * ltRate;
  const claimed = qualified_leads * claimedRate;
  const conversations = shows + live_transfers + claimed;

  const downstream = computeDownstreamCounts(inputs, conversations);
  const { proposals_made, submissions_made, funded_loans } = downstream;

  const counts: SimulatorCounts = {
    total_leads,
    qualified_leads,
    booked_appointments,
    shows,
    live_transfers,
    claimed,
    conversations,
    proposals_made,
    submissions_made,
    funded_loans,
  };

  const conversation_rate_pct =
    qualified_leads > 0 ? (conversations / qualified_leads) * 100 : 0;
  const conversation_yield = qualified_leads > 0 ? conversations / qualified_leads : 0;
  const close_rate_from_conversations_pct =
    conversations > 0 ? (funded_loans / conversations) * 100 : 0;

  const costs: SimulatorCosts = {
    cpl: total_leads > 0 ? ad_spend / total_leads : 0,
    cpql: qualified_leads > 0 ? ad_spend / qualified_leads : 0,
    cp_conversation: conversations > 0 ? ad_spend / conversations : 0,
    cp_appt: booked_appointments > 0 ? ad_spend / booked_appointments : 0,
    cps: shows > 0 ? ad_spend / shows : 0,
    cp_proposal: proposals_made > 0 ? ad_spend / proposals_made : 0,
    cp_submission: submissions_made > 0 ? ad_spend / submissions_made : 0,
    cp_funded: funded_loans > 0 ? ad_spend / funded_loans : 0,
  };

  const cpconv_cross_check =
    conversation_yield > 0 ? costs.cpql / conversation_yield : null;

  const revenue = funded_loans * Math.max(0, inputs.avg_commission);
  const roas = ad_spend > 0 && revenue > 0 ? revenue / ad_spend : null;

  const hand_raise_rate =
    qualified_leads > 0
      ? ((booked_appointments + live_transfers + claimed) / qualified_leads) * 100
      : 0;

  const closeRateForGrade =
    inputs.funnel_mode === 'conversation'
      ? inputs.conversation_close_rate_pct
      : close_rate_from_conversations_pct;

  const grades: KpiGrade[] = [
    grade('lead_to_qualified', inputs.lead_to_qual_pct, pct(inputs.lead_to_qual_pct), total_leads),
    grade('hand_raise_rate', hand_raise_rate, pct(hand_raise_rate), qualified_leads),
    grade('show_rate', inputs.net_show_rate_pct, pct(inputs.net_show_rate_pct), shows + booked_appointments * (1 - showRate)),
    grade('close_rate', closeRateForGrade, pct(closeRateForGrade), conversations),
    grade('cpl', costs.cpl, money(costs.cpl), total_leads),
    grade('cpql', costs.cpql, money(costs.cpql), qualified_leads),
    grade('cps', costs.cp_conversation, money(costs.cp_conversation), conversations),
  ];

  return {
    inputs,
    counts,
    rates: {
      lead_to_qual_pct: inputs.lead_to_qual_pct,
      booking_rate_pct: inputs.booking_rate_pct,
      net_show_rate_pct: inputs.net_show_rate_pct,
      conversation_rate_pct,
      conversation_yield,
      conversation_close_rate_pct: inputs.conversation_close_rate_pct,
      proposal_rate_pct: inputs.proposal_rate_pct,
      submission_rate_pct: inputs.submission_rate_pct,
      funded_rate_pct: inputs.funded_rate_pct,
      close_rate_from_conversations_pct,
    },
    costs,
    ad_spend,
    revenue,
    roas,
    cpconv_cross_check,
    grades,
  };
}

export type StockBandSource = Partial<
  Record<KpiKey, { bands: { critical?: number; below?: number; at?: number }; higherIsBetter: boolean }>
>;

function bandMidpoint(key: KpiKey, preset: WaizPreset, stock?: StockBandSource): number {
  const fallback = DEFAULT_KPI_BANDS[key];
  const spec = stock?.[key];
  const bands = spec?.bands ?? fallback.bands;
  const higherIsBetter = spec?.higherIsBetter ?? fallback.higherIsBetter;
  if (preset === 'above') {
    if (higherIsBetter) return (bands.at ?? 0) + 5;
    return Math.max(1, (bands.at ?? 0) - 3);
  }
  if (preset === 'below') {
    if (higherIsBetter) return ((bands.critical ?? 0) + (bands.below ?? 0)) / 2;
    return ((bands.below ?? 0) + (bands.critical ?? 0)) / 2;
  }
  if (higherIsBetter) {
    return ((bands.below ?? 0) + (bands.at ?? 0)) / 2;
  }
  return ((bands.at ?? 0) + (bands.below ?? 0)) / 2;
}

export function defaultSimulatorInputs(): SimulatorInputs {
  return applyWaizPreset('at_kpi');
}

export function applyWaizPreset(preset: WaizPreset, stock?: StockBandSource): SimulatorInputs {
  return {
    funnel_mode: 'conversation',
    cost_anchor: 'spend_cpl',
    ad_spend: 5000,
    cpl: bandMidpoint('cpl', preset === 'above' ? 'above' : preset === 'below' ? 'below' : 'at_kpi', stock),
    total_leads: 0,
    lead_to_qual_pct: bandMidpoint('lead_to_qualified', preset, stock),
    booking_rate_pct: bandMidpoint('hand_raise_rate', preset, stock),
    net_show_rate_pct: bandMidpoint('show_rate', preset, stock),
    live_transfer_pct: 3,
    claimed_pct: 2,
    conversation_close_rate_pct: bandMidpoint('close_rate', preset, stock),
    proposal_rate_pct: 55,
    submission_rate_pct: 65,
    funded_rate_pct: bandMidpoint('close_rate', preset, stock),
    avg_commission: 8500,
  };
}

/** Map live dashboard metrics into simulator starting assumptions. */
export function metricsToSimulatorInputs(metrics: MetricsResult): SimulatorInputs {
  const conversations = metrics.live_transfers + metrics.claimed + metrics.shows;
  const conversationCloseRate =
    conversations > 0 ? (metrics.funded_loans / conversations) * 100 : bandMidpoint('close_rate', 'at_kpi');
  const proposalRate =
    conversations > 0 ? (metrics.proposals_made / conversations) * 100 : 55;
  const submissionRate =
    metrics.proposals_made > 0 ? (metrics.submissions_made / metrics.proposals_made) * 100 : 65;
  const fundedRate =
    metrics.submissions_made > 0 ? (metrics.funded_loans / metrics.submissions_made) * 100 : 25;

  const ltPct =
    metrics.qualified_leads > 0 ? (metrics.live_transfers / metrics.qualified_leads) * 100 : 0;
  const claimedPct =
    metrics.qualified_leads > 0 ? (metrics.claimed / metrics.qualified_leads) * 100 : 0;

  return {
    funnel_mode: 'conversation',
    cost_anchor: 'spend_cpl',
    ad_spend: metrics.ad_spend || 5000,
    cpl: metrics.cpl > 0 ? metrics.cpl : 15,
    total_leads: metrics.new_leads,
    lead_to_qual_pct: metrics.qualified_rate,
    booking_rate_pct: metrics.appt_booking_rate,
    net_show_rate_pct: metrics.show_pct,
    live_transfer_pct: ltPct,
    claimed_pct: claimedPct,
    conversation_close_rate_pct: conversationCloseRate,
    proposal_rate_pct: proposalRate,
    submission_rate_pct: submissionRate,
    funded_rate_pct: fundedRate,
    avg_commission: 8500,
  };
}

function conversationPathMix(forward: SimulatorResult): { showShare: number; ltShare: number; claimedShare: number } {
  const { shows, live_transfers, claimed, conversations } = forward.counts;
  if (conversations <= 0) {
    return { showShare: 0.85, ltShare: 0.1, claimedShare: 0.05 };
  }
  const parallel = live_transfers + claimed;
  return {
    showShare: shows / conversations,
    ltShare: parallel > 0 ? live_transfers / parallel : 0.5,
    claimedShare: parallel > 0 ? claimed / parallel : 0.5,
  };
}

function solveConversationsNeeded(
  targetFunded: number,
  inputs: SimulatorInputs,
): number | null {
  if (inputs.funnel_mode === 'conversation') {
    const closeRate = pctRate(inputs.conversation_close_rate_pct);
    if (closeRate <= 0) return null;
    return targetFunded / closeRate;
  }

  const fundedRate = pctRate(inputs.funded_rate_pct);
  const submissionRate = pctRate(inputs.submission_rate_pct);
  const proposalRate = pctRate(inputs.proposal_rate_pct);
  if (fundedRate <= 0 || submissionRate <= 0 || proposalRate <= 0) return null;

  const submissions_made = targetFunded / fundedRate;
  const proposals_made = submissions_made / submissionRate;
  return proposals_made / proposalRate;
}

/** Reverse-engineer upstream volume and spend for a close/funded target. */
export function solveForTargetFunded(
  targetFunded: number,
  inputs: SimulatorInputs,
  forward?: SimulatorResult,
): GoalSolveResult | null {
  const target = Math.max(0, targetFunded);
  if (target <= 0) return null;

  const base = forward ?? simulateFunnel(inputs);
  const conversations = solveConversationsNeeded(target, inputs);
  if (conversations == null) return null;

  const showRate = pctRate(inputs.net_show_rate_pct);
  const bookingRate = pctRate(inputs.booking_rate_pct);
  const qualRate = pctRate(inputs.lead_to_qual_pct);
  const ltRate = pctRate(inputs.live_transfer_pct);
  const claimedRate = pctRate(inputs.claimed_pct);
  if (qualRate <= 0) return null;

  const mix = conversationPathMix(base);
  const shows = conversations * mix.showShare;
  const parallel = conversations - shows;
  const live_transfers = parallel * mix.ltShare;
  const claimed = parallel * mix.claimedShare;
  const booked_appointments = showRate > 0 ? shows / showRate : 0;

  const qualifiedFromBooked = bookingRate > 0 ? booked_appointments / bookingRate : 0;
  const qualifiedFromLt = ltRate > 0 ? live_transfers / ltRate : 0;
  const qualifiedFromClaimed = claimedRate > 0 ? claimed / claimedRate : 0;
  const qualified_leads = Math.max(qualifiedFromBooked, qualifiedFromLt, qualifiedFromClaimed, 0);

  const total_leads = qualified_leads / qualRate;
  const { cpl } = resolveLeadsAndSpend(inputs);
  const ad_spend = total_leads * cpl;

  const downstream = computeDownstreamCounts(inputs, conversations);

  const required = {
    total_leads,
    qualified_leads,
    booked_appointments,
    shows,
    live_transfers,
    claimed,
    conversations,
    proposals_made: downstream.proposals_made,
    submissions_made: downstream.submissions_made,
    funded_loans: target,
    ad_spend,
  };

  const current = {
    ...base.counts,
    ad_spend: base.ad_spend,
  };

  const gaps = {
    ad_spend: required.ad_spend - current.ad_spend,
    total_leads: required.total_leads - current.total_leads,
    qualified_leads: required.qualified_leads - current.qualified_leads,
    conversations: required.conversations - current.conversations,
    proposals_made: required.proposals_made - current.proposals_made,
    submissions_made: required.submissions_made - current.submissions_made,
    funded_loans: required.funded_loans - current.funded_loans,
  };

  return {
    target_funded: target,
    required,
    current,
    gaps,
    fastest_lever: findFastestLever(inputs, base),
  };
}

const CORE_LEVER_FIELDS: { field: keyof SimulatorInputs; label: string; kpiKey: KpiKey }[] = [
  { field: 'lead_to_qual_pct', label: 'Lead-to-Qualified %', kpiKey: 'lead_to_qualified' },
  { field: 'booking_rate_pct', label: 'Booking Rate', kpiKey: 'hand_raise_rate' },
  { field: 'net_show_rate_pct', label: 'True Show', kpiKey: 'show_rate' },
  { field: 'conversation_close_rate_pct', label: 'Close Rate (÷ conversations)', kpiKey: 'close_rate' },
];

const PIPELINE_LEVER_FIELDS: { field: keyof SimulatorInputs; label: string; kpiKey: KpiKey }[] = [
  { field: 'proposal_rate_pct', label: 'Proposal Rate', kpiKey: 'close_rate' },
  { field: 'submission_rate_pct', label: 'Submission Rate', kpiKey: 'close_rate' },
  { field: 'funded_rate_pct', label: 'Funded Rate', kpiKey: 'close_rate' },
];

function findFastestLever(inputs: SimulatorInputs, base: SimulatorResult): FastestLever | null {
  const currentFunded = base.counts.funded_loans;
  const levers =
    inputs.funnel_mode === 'pipeline'
      ? [...CORE_LEVER_FIELDS.filter(l => l.field !== 'conversation_close_rate_pct'), ...PIPELINE_LEVER_FIELDS]
      : CORE_LEVER_FIELDS;

  let best: FastestLever | null = null;

  for (const lever of levers) {
    const spec = DEFAULT_KPI_BANDS[lever.kpiKey];
    const atValue = spec.bands.at ?? spec.bands.below ?? 0;

    const currentValue = inputs[lever.field] as number;
    if (typeof currentValue !== 'number') continue;
    if (spec.higherIsBetter && currentValue >= atValue) continue;
    if (!spec.higherIsBetter && currentValue <= atValue) continue;

    const improved = { ...inputs, [lever.field]: atValue };
    const improvedResult = simulateFunnel(improved);
    const delta = improvedResult.counts.funded_loans - currentFunded;
    if (delta <= 0) continue;
    if (!best || delta > best.delta) {
      best = {
        field: lever.field,
        label: lever.label,
        current_funded: currentFunded,
        improved_funded: improvedResult.counts.funded_loans,
        delta,
      };
    }
  }

  return best;
}

function normalizeDecodedInputs(parsed: Partial<SimulatorInputs>): SimulatorInputs {
  const defaults = defaultSimulatorInputs();
  const merged = { ...defaults, ...parsed };

  if (!merged.funnel_mode) merged.funnel_mode = 'conversation';
  if (merged.conversation_close_rate_pct == null || merged.conversation_close_rate_pct <= 0) {
    merged.conversation_close_rate_pct = bandMidpoint('close_rate', 'at_kpi');
  }

  return merged as SimulatorInputs;
}

/** Serialize simulator state for URL sharing. */
export function encodeSimulatorState(inputs: SimulatorInputs): string {
  return btoa(JSON.stringify(inputs));
}

export function decodeSimulatorState(encoded: string): SimulatorInputs | null {
  try {
    const parsed = JSON.parse(atob(encoded)) as Partial<SimulatorInputs>;
    if (typeof parsed.ad_spend !== 'number') return null;
    return normalizeDecodedInputs(parsed);
  } catch {
    return null;
  }
}

export const TIER_COLORS: Record<HealthTier, string> = {
  critical: '#ef4444',
  below: '#f97316',
  at: '#eab308',
  above: '#22c55e',
  insufficient: '#64748b',
};
