/**
 * Build MetricsResult / trend payloads from SQL dashboard_kpi_* RPCs
 * (speed-to-lead summary via dashboard_speed_to_lead_summary when available).
 */

import { dialPoolRate, type DialPool } from '@/lib/dial-pool';
import {
  daysInRange,
  toCostTrendPoints,
  weekStartKey,
  type CostTrendPoint,
  type DailyCostBucket,
  type KpiTimelineBucket,
  type MetricsResult,
  type SpendRow,
  type TrendSpendRow,
} from '@/lib/metrics';
import type { SpeedToLeadResult } from '@/lib/speed-to-lead';

export type SqlKpiCounts = {
  new_leads: number;
  qualified_leads: number;
  hot_leads: number;
  out_of_state_leads: number;
  booked_appointments: number;
  appointment_cancelled: number;
  appointment_rescheduled: number;
  shows: number;
  no_shows: number;
  lo_bailed: number;
  loan_processing: number;
  outbound_dials: number;
  pickups: number;
  conversations: number;
  callbacks: number;
  live_transfers: number;
  claimed: number;
  proposals_sent: number;
  closed: number;
  unique_booked_appointments: number;
  unique_hand_raises: number;
  unique_conversations: number;
  billable_conversations: number;
  claimed_after_booked: number;
  /** Unique booked leads who also have show ∪ claimed ∪ live_transfer. */
  unique_booked_converted: number;
  proposals_made: number;
  submissions_made: number;
  funded_loans: number;
};

export type SqlTimelineRow = {
  bucket_date: string;
  leads: number;
  qualified_leads: number;
  booked: number;
  shows: number;
  no_shows: number;
  lo_bailed: number;
  cancelled: number;
  live_transfers: number;
  claimed: number;
  unique_booked_leads: number;
  unique_hand_raise_leads: number;
  unique_conversation_leads: number;
  /** Unique booked ∩ spoken within the bucket (when SQL provides it). */
  unique_booked_converted_leads: number;
};

function n(value: unknown): number {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export function emptySqlKpiCounts(): SqlKpiCounts {
  return {
    new_leads: 0,
    qualified_leads: 0,
    hot_leads: 0,
    out_of_state_leads: 0,
    booked_appointments: 0,
    appointment_cancelled: 0,
    appointment_rescheduled: 0,
    shows: 0,
    no_shows: 0,
    lo_bailed: 0,
    loan_processing: 0,
    outbound_dials: 0,
    pickups: 0,
    conversations: 0,
    callbacks: 0,
    live_transfers: 0,
    claimed: 0,
    proposals_sent: 0,
    closed: 0,
    unique_booked_appointments: 0,
    unique_hand_raises: 0,
    unique_conversations: 0,
    billable_conversations: 0,
    claimed_after_booked: 0,
    unique_booked_converted: 0,
    proposals_made: 0,
    submissions_made: 0,
    funded_loans: 0,
  };
}

export function parseSqlKpiCounts(raw: unknown): SqlKpiCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    new_leads: n(o.new_leads),
    qualified_leads: n(o.qualified_leads),
    hot_leads: n(o.hot_leads),
    out_of_state_leads: n(o.out_of_state_leads),
    booked_appointments: n(o.booked_appointments),
    appointment_cancelled: n(o.appointment_cancelled),
    appointment_rescheduled: n(o.appointment_rescheduled),
    shows: n(o.shows),
    no_shows: n(o.no_shows),
    lo_bailed: n(o.lo_bailed),
    loan_processing: n(o.loan_processing),
    outbound_dials: n(o.outbound_dials),
    pickups: n(o.pickups),
    conversations: n(o.conversations),
    callbacks: n(o.callbacks),
    live_transfers: n(o.live_transfers),
    claimed: n(o.claimed),
    proposals_sent: n(o.proposals_sent),
    closed: n(o.closed),
    unique_booked_appointments: n(o.unique_booked_appointments),
    unique_hand_raises: n(o.unique_hand_raises),
    unique_conversations: n(o.unique_conversations),
    billable_conversations: n(o.billable_conversations),
    claimed_after_booked: n(o.claimed_after_booked),
    unique_booked_converted: n(o.unique_booked_converted),
    proposals_made: n(o.proposals_made),
    submissions_made: n(o.submissions_made),
    funded_loans: n(o.funded_loans),
  };
}

/** Parse rows from dashboard_kpi_counts_by_client into a client_id → counts map. */
export function parseSqlKpiCountsByClient(raw: unknown): Map<string, SqlKpiCounts> {
  const map = new Map<string, SqlKpiCounts>();
  if (!Array.isArray(raw)) return map;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = String(o.client_id ?? '');
    if (!id) continue;
    const counts = parseSqlKpiCounts(o);
    if (counts) map.set(id, counts);
  }
  return map;
}

export function metricsFromSqlCounts(
  counts: SqlKpiCounts,
  spendRows: SpendRow[],
  speed: Pick<
    SpeedToLeadResult,
    | 'median_min'
    | 'sample_size'
    | 'excluded_out_of_window'
    | 'excluded_no_time'
    | 'excluded_before_cutoff'
    | 'excluded_after_cutoff'
  > = {
    median_min: null,
    sample_size: 0,
    excluded_out_of_window: 0,
    excluded_no_time: 0,
    excluded_before_cutoff: 0,
    excluded_after_cutoff: 0,
  },
): MetricsResult {
  const leads = counts.new_leads;
  const qualified_leads = counts.qualified_leads;
  const hot_leads = counts.hot_leads;
  const booked = counts.booked_appointments;
  const cancelled = counts.appointment_cancelled;
  const rescheduled = counts.appointment_rescheduled;
  const shows = counts.shows;
  const no_shows = counts.no_shows;
  const lo_bailed = counts.lo_bailed;
  const dial_count = counts.outbound_dials;
  const pickups = counts.pickups;
  const conversations = counts.conversations;
  const callbacks = counts.callbacks;
  const live_transfers = counts.live_transfers;
  const claimed = counts.claimed;
  const unique_booked_leads = counts.unique_booked_appointments;
  const unique_hand_raise_leads = counts.unique_hand_raises;
  const unique_conversation_leads = counts.unique_conversations;
  const billable_conversations = counts.billable_conversations;
  const claimed_after_booked = counts.claimed_after_booked;
  const unique_booked_converted = counts.unique_booked_converted;
  const proposals_made = counts.proposals_made;
  const submissions_made = counts.submissions_made;
  const funded_loans = counts.funded_loans;
  const scheduled_total = booked + cancelled;
  const dispositioned_appointments = shows + no_shows + lo_bailed;

  const ad_spend = spendRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const ad_spend_meta = spendRows
    .filter(r => r.platform === 'meta')
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return {
    new_leads: leads,
    qualified_leads,
    qualified_rate: leads > 0 ? (qualified_leads / leads) * 100 : 0,
    hot_leads,
    out_of_state_leads: counts.out_of_state_leads,
    booked_appointments: booked,
    unique_booked_appointments: unique_booked_leads,
    appt_booking_rate: qualified_leads > 0 ? (unique_booked_leads / qualified_leads) * 100 : 0,
    lead_booking_rate: leads > 0 ? (unique_booked_leads / leads) * 100 : 0,
    appts_to_take_place: Math.max(0, booked - shows - no_shows - cancelled - lo_bailed - rescheduled),
    shows,
    no_shows,
    show_pct: dispositioned_appointments > 0 ? (shows / dispositioned_appointments) * 100 : 0,
    net_show_pct: shows + no_shows > 0 ? (shows / (shows + no_shows)) * 100 : 0,
    lo_bail_rate: booked > 0 ? (lo_bailed / booked) * 100 : 0,
    unique_conversations: unique_conversation_leads,
    billable_conversations,
    claimed_after_booked,
    unique_booked_converted,
    booked_to_conversation_rate:
      unique_booked_leads > 0 ? (unique_booked_converted / unique_booked_leads) * 100 : 0,
    conversation_rate:
      qualified_leads > 0 ? (unique_conversation_leads / qualified_leads) * 100 : 0,
    unique_hand_raises: unique_hand_raise_leads,
    hand_raise_rate:
      qualified_leads > 0 ? (unique_hand_raise_leads / qualified_leads) * 100 : 0,
    lead_hand_raise_rate: leads > 0 ? (unique_hand_raise_leads / leads) * 100 : 0,
    appointment_cancelled: cancelled,
    appointment_rescheduled: rescheduled,
    cancel_rate: scheduled_total > 0 ? (cancelled / scheduled_total) * 100 : 0,
    lo_bailed,
    loan_processing: counts.loan_processing,
    live_transfers,
    claimed,
    total_conversations: conversations + claimed,
    proposals_sent: counts.proposals_sent,
    closed: counts.closed,
    proposals_made,
    submissions_made,
    funded_loans,
    manual_dqs: 0,
    submitted_deals: 0,
    funded_deals: 0,
    loan_volume: 0,
    cp_funded_deal: 0,
    cp_proposal_made: proposals_made > 0 ? ad_spend / proposals_made : 0,
    cp_submission_made: submissions_made > 0 ? ad_spend / submissions_made : 0,
    cp_loan_funded: funded_loans > 0 ? ad_spend / funded_loans : 0,
    commission_total: 0,
    roas: null,
    ad_spend,
    ad_spend_meta,
    cpl: leads > 0 ? ad_spend / leads : 0,
    cp_qualified: qualified_leads > 0 ? ad_spend / qualified_leads : 0,
    cp_hot: hot_leads > 0 ? ad_spend / hot_leads : 0,
    cp_conversation:
      unique_conversation_leads > 0 ? ad_spend / unique_conversation_leads : 0,
    cp_appt: booked > 0 ? ad_spend / booked : 0,
    cps: shows > 0 ? ad_spend / shows : 0,
    outbound_dials: dial_count,
    dials_per_lead: qualified_leads > 0 ? dial_count / qualified_leads : 0,
    pickups,
    pickup_pct: dial_count > 0 ? (pickups / dial_count) * 100 : 0,
    conversations,
    conversation_pct: pickups > 0 ? (conversations / pickups) * 100 : 0,
    callbacks,
    cb_pct: leads > 0 ? (callbacks / leads) * 100 : 0,
    speed_to_lead_min: speed.median_min ?? 0,
    speed_to_lead_sample_size: speed.sample_size,
    speed_to_lead_excluded_out_of_window: speed.excluded_out_of_window,
    speed_to_lead_excluded_no_time: speed.excluded_no_time,
    speed_to_lead_excluded_before_cutoff: speed.excluded_before_cutoff,
    speed_to_lead_excluded_after_cutoff: speed.excluded_after_cutoff,
  };
}

function finalizeTimelineBucket(
  row: SqlTimelineRow,
  spend: number,
  pool: DialPool | null = null,
): KpiTimelineBucket {
  const uniqueConversations = row.unique_conversation_leads;
  const dispositioned = row.shows + row.no_shows + row.lo_bailed;
  const uniqueBooked = row.unique_booked_leads;
  const uniqueHandRaise = row.unique_hand_raise_leads;
  const uniqueBookedConverted = row.unique_booked_converted_leads;
  return {
    date: row.bucket_date,
    spend,
    leads: row.leads,
    qualified_leads: row.qualified_leads,
    booked: row.booked,
    shows: row.shows,
    no_shows: row.no_shows,
    client_conversations: uniqueConversations,
    cpconv: uniqueConversations > 0 ? spend / uniqueConversations : null,
    cpql: row.qualified_leads > 0 ? spend / row.qualified_leads : null,
    cpl: row.leads > 0 ? spend / row.leads : null,
    show_rate: dispositioned > 0 ? (row.shows / dispositioned) * 100 : null,
    net_show_rate:
      row.shows + row.no_shows > 0 ? (row.shows / (row.shows + row.no_shows)) * 100 : null,
    booking_rate:
      row.qualified_leads > 0 ? (uniqueBooked / row.qualified_leads) * 100 : null,
    lead_booking_rate: row.leads > 0 ? (uniqueBooked / row.leads) * 100 : null,
    conversation_rate: dialPoolRate(uniqueConversations, row.qualified_leads, row.leads, pool),
    hand_raise_rate: dialPoolRate(uniqueHandRaise, row.qualified_leads, row.leads, pool),
    booked_to_conversation_rate:
      uniqueBooked > 0 ? (uniqueBookedConverted / uniqueBooked) * 100 : null,
    lead_to_qual: row.leads > 0 ? (row.qualified_leads / row.leads) * 100 : null,
  };
}

function spendByBucket(
  spendRows: TrendSpendRow[],
  granularity: 'day' | 'week',
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of spendRows) {
    const key = granularity === 'week' ? weekStartKey(row.spend_date) : row.spend_date;
    map.set(key, (map.get(key) ?? 0) + Number(row.amount));
  }
  return map;
}

export function parseSqlTimelineRows(raw: unknown): SqlTimelineRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(row => {
    const o = row as Record<string, unknown>;
    const dateRaw = o.bucket_date;
    const bucket_date =
      typeof dateRaw === 'string'
        ? dateRaw.slice(0, 10)
        : dateRaw instanceof Date
          ? dateRaw.toISOString().slice(0, 10)
          : String(dateRaw ?? '').slice(0, 10);
    return {
      bucket_date,
      leads: n(o.leads),
      qualified_leads: n(o.qualified_leads),
      booked: n(o.booked),
      shows: n(o.shows),
      no_shows: n(o.no_shows),
      lo_bailed: n(o.lo_bailed),
      cancelled: n(o.cancelled),
      live_transfers: n(o.live_transfers),
      claimed: n(o.claimed),
      unique_booked_leads: n(o.unique_booked_leads),
      unique_hand_raise_leads: n(o.unique_hand_raise_leads),
      unique_conversation_leads: n(o.unique_conversation_leads),
      unique_booked_converted_leads: n(o.unique_booked_converted_leads),
    };
  });
}

export function trendsFromSqlTimeline(
  rows: SqlTimelineRow[],
  spendRows: TrendSpendRow[],
  granularity: 'day' | 'week',
  pool: DialPool | null = null,
): { series: CostTrendPoint[]; kpiSeries: KpiTimelineBucket[] } {
  const spendMap = spendByBucket(spendRows, granularity);

  const kpiSeries = rows.map(row =>
    finalizeTimelineBucket(row, spendMap.get(row.bucket_date) ?? 0, pool),
  );

  const dailyCost: DailyCostBucket[] = rows.map(row => ({
    date: row.bucket_date,
    spend: spendMap.get(row.bucket_date) ?? 0,
    leads: row.leads,
    qualified_leads: row.qualified_leads,
    client_conversations: row.unique_conversation_leads,
  }));

  return {
    series: toCostTrendPoints(dailyCost),
    kpiSeries,
  };
}

export function emptySpeedResult(): SpeedToLeadResult {
  return {
    median_min: null,
    sample_size: 0,
    excluded_out_of_window: 0,
    excluded_no_time: 0,
    excluded_before_cutoff: 0,
    excluded_after_cutoff: 0,
    by_agent: {},
    by_hour: {},
    readings: [],
    time_zone: 'America/New_York',
    live_window_count: 0,
  };
}

/** Summary fields returned by dashboard_speed_to_lead_summary RPC. */
export type SqlSpeedToLeadSummary = Pick<
  SpeedToLeadResult,
  | 'median_min'
  | 'sample_size'
  | 'excluded_out_of_window'
  | 'excluded_no_time'
  | 'excluded_before_cutoff'
  | 'excluded_after_cutoff'
  | 'time_zone'
  | 'live_window_count'
>;

export function parseSqlSpeedToLeadSummary(raw: unknown): SqlSpeedToLeadSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const medianRaw = o.median_min;
  const median_min =
    medianRaw === null || medianRaw === undefined
      ? null
      : (() => {
          const n = typeof medianRaw === 'number' ? medianRaw : Number(medianRaw);
          return Number.isFinite(n) ? n : null;
        })();
  return {
    median_min,
    sample_size: num(o.sample_size),
    excluded_out_of_window: num(o.excluded_out_of_window),
    excluded_no_time: num(o.excluded_no_time),
    excluded_before_cutoff: num(o.excluded_before_cutoff),
    excluded_after_cutoff: num(o.excluded_after_cutoff),
    time_zone: typeof o.time_zone === 'string' ? o.time_zone : 'America/Sao_Paulo',
    live_window_count: num(o.live_window_count),
  };
}

/** Expand SQL summary into a full SpeedToLeadResult (empty readings / by_*). */
export function speedResultFromSqlSummary(summary: SqlSpeedToLeadSummary): SpeedToLeadResult {
  return {
    ...emptySpeedResult(),
    median_min: summary.median_min,
    sample_size: summary.sample_size,
    excluded_out_of_window: summary.excluded_out_of_window,
    excluded_no_time: summary.excluded_no_time,
    excluded_before_cutoff: summary.excluded_before_cutoff,
    excluded_after_cutoff: summary.excluded_after_cutoff,
    time_zone: summary.time_zone,
    live_window_count: summary.live_window_count,
  };
}

/** Re-export for callers that only need the day-count helper nearby. */
export { daysInRange };
