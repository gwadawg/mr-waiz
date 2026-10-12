import {
  computeSpeedToLead,
  type AvailabilityWindow,
  type SpeedToLeadEventRow,
} from '@/lib/speed-to-lead';
import { dialPoolRate, type DialPool } from '@/lib/dial-pool';
import { CALL_CENTER_TIMEZONE } from '@/lib/time';

export type EventRow = {
  client_id?: string | null;
  event_type: string;
  ghl_contact_id?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  lead_name?: string | null;
  phone_number_used?: string | null;
  agent_name?: string | null;
  occurred_at?: string | null;
  occurred_at_has_time?: boolean | null;
  lead_created_at?: string | null;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  speed_to_lead_seconds: number | null;
  is_qualified?: boolean | null;
  is_hot?: boolean | null;
  is_out_of_state?: boolean | null;
};

export type SpendRow = { amount: number | string; platform?: string | null };

export type TrendEventRow = {
  event_type: string;
  occurred_at: string;
  is_qualified?: boolean | null;
  client_id?: string | null;
  ghl_contact_id?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  lead_name?: string | null;
};

export type TrendSpendRow = { spend_date: string; amount: number | string };

export type DailyCostBucket = {
  date: string;
  spend: number;
  leads: number;
  qualified_leads: number;
  /** Client conversations: live transfers + shows + claimed */
  client_conversations: number;
};

export type CostTrendPoint = {
  date: string;
  spend: number;
  leads: number;
  qualified_leads: number;
  client_conversations: number;
  cpl: number | null;
  cp_qualified: number | null;
  cp_conversation: number | null;
};

export type MetricsResult = {
  new_leads: number;
  qualified_leads: number;
  /** Qualified Leads ÷ Total Leads × 100. */
  qualified_rate: number;
  hot_leads: number;
  out_of_state_leads: number;
  /** Absolute booking events (includes rebooks / reschedules). */
  booked_appointments: number;
  /** Distinct leads with at least one booking in range. */
  unique_booked_appointments: number;
  /** Unique leads with a booking ÷ Qualified Leads (RM default). */
  appt_booking_rate: number;
  /** Unique leads with a booking ÷ Total Leads (HE overview). */
  lead_booking_rate: number;
  appts_to_take_place: number;
  shows: number;
  no_shows: number;
  /**
   * True Show: shows ÷ (shows + no-shows + LO bailed).
   * Of appointments that took place (final attendance outcome).
   * Excludes pending, cancelled, rescheduled.
   */
  show_pct: number;
  /**
   * Lead-only slot attendance: shows ÷ (shows + no-shows).
   * Excludes LO bails — prefer `show_pct` (True Show) on the board.
   */
  net_show_pct: number;
  /** LO bailed ÷ appointments booked. */
  lo_bail_rate: number;
  /**
   * Distinct leads with any client conversation path
   * (show ∪ claimed ∪ live transfer). One lead counted once.
   */
  unique_conversations: number;
  /**
   * Call Center billable: unique leads with live_transfer ∪ show.
   * Claimed never counts (client-handled, not charged).
   */
  billable_conversations: number;
  /**
   * Unique leads whose earliest claim in-range is strictly after
   * their earliest appointment_booked in-range (claim-watch / sabotage).
   */
  claimed_after_booked: number;
  /**
   * Unique booked leads who also spoke to the LO in-range
   * (booked ∩ (show ∪ claimed ∪ live_transfer)). Recovery-inclusive.
   */
  unique_booked_converted: number;
  /**
   * Show Rate: unique booked leads who eventually spoke ÷ unique booked × 100.
   * Graded quality (recovery-inclusive). Not the same as True Show (`show_pct`).
   */
  booked_to_conversation_rate: number;
  /** Unique conversations ÷ qualified leads. */
  conversation_rate: number;
  /**
   * Distinct leads with any hand-raise path (booked ∪ claimed ∪ live transfer).
   * One lead counted once even with multiple booking events.
   */
  unique_hand_raises: number;
  /**
   * Unique leads with any hand-raise path (booked, claimed, or live transfer)
   * ÷ qualified — intent to talk, before show. One lead counted once even if
   * they booked multiple times or were also claimed / live-transferred.
   */
  hand_raise_rate: number;
  /**
   * Unique hand-raises ÷ total leads × 100 (HE conversion benchmark).
   * Same numerator as hand_raise_rate; denominator is all leads, not qualified.
   */
  lead_hand_raise_rate: number;
  appointment_cancelled: number;
  /** Prior booking superseded by a later rebook (same lead / new GHL appointment id). */
  appointment_rescheduled: number;
  cancel_rate: number;
  /** Partner LO did not attend scheduled appointment with lead (“bailed”). */
  lo_bailed: number;
  /** Deal submitted / in processing (not yet funded). */
  loan_processing: number;
  live_transfers: number;
  /** Client manually contacted or spoke with the lead outside our booking flow. */
  claimed: number;
  total_conversations: number;
  proposals_sent: number;
  closed: number;
  proposals_made: number;
  submissions_made: number;
  funded_loans: number;
  /** Unique contacts with a client-log `manual_dq` in range. */
  manual_dqs: number;
  /** Loan transactions that reached submitted (includes later-funded files dated in range). */
  submitted_deals: number;
  /** Loan transactions that funded in range — production volume, not unique borrowers. */
  funded_deals: number;
  /** SUM(loan_size) of funded deals in range. */
  loan_volume: number;
  /** Ad spend ÷ funded_deals. */
  cp_funded_deal: number;
  cp_proposal_made: number;
  cp_submission_made: number;
  cp_loan_funded: number;
  /** Sum of client-logged funded commission in range. */
  commission_total: number;
  /** Commission ÷ ad spend when both > 0; otherwise null (hide the card). */
  roas: number | null;
  /** Sum of Meta ad spend (meta_ad_insights). */
  ad_spend: number;
  /** Meta / Facebook spend only (same as ad_spend). */
  ad_spend_meta: number;
  cpl: number;
  cp_qualified: number;
  cp_hot: number;
  cp_conversation: number;
  cp_appt: number;
  cps: number;
  outbound_dials: number;
  /** Outbound dials ÷ qualified leads (only qualified leads are dialed). */
  dials_per_lead: number;
  pickups: number;
  pickup_pct: number;
  conversations: number;
  conversation_pct: number;
  callbacks: number;
  cb_pct: number;
  /** Median minutes lead→first dial (precise timestamps + in-window leads only). */
  speed_to_lead_min: number;
  /** Number of leads contributing to speed_to_lead_min. */
  speed_to_lead_sample_size: number;
  /** Leads excluded from speed-to-lead because they arrived off-hours. */
  speed_to_lead_excluded_out_of_window: number;
  /** Leads/dials excluded from speed-to-lead due to a missing precise timestamp. */
  speed_to_lead_excluded_no_time: number;
  /** Leads excluded because lead arrival was before the manual cutoff. */
  speed_to_lead_excluded_before_cutoff: number;
  /** Leads excluded because lead arrival was after the manual cutoff. */
  speed_to_lead_excluded_after_cutoff: number;
};

const PROPOSAL_EVENT_TYPES = new Set(['proposal_made', 'proposal_sent']);
const SUBMISSION_EVENT_TYPES = new Set(['submission_made', 'loan_processing']);
const FUNDED_EVENT_TYPES = new Set(['loan_funded', 'closed']);

function normalizePhoneForKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Stable lead identity for unique-rate numerators (book / hand-raise). */
export function leadIdentityKey(event: {
  client_id?: string | null;
  ghl_contact_id?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  lead_name?: string | null;
}): string | null {
  const clientId = event.client_id ?? '';
  const ghl = (event.ghl_contact_id ?? '').trim();
  if (ghl) return `${clientId}|ghl:${ghl}`;
  const phone = normalizePhoneForKey(event.lead_phone);
  if (phone) return `${clientId}|phone:${phone}`;
  const email = (event.lead_email ?? '').trim().toLowerCase();
  if (email) return `${clientId}|email:${email}`;
  const name = (event.lead_name ?? '').trim().toLowerCase();
  if (name) return `${clientId}|name:${name}`;
  return null;
}

function uniqueLeadKeysForEvents(events: EventRow[], eventTypes: Set<string>): Set<string> {
  const leadKeys = new Set<string>();
  for (const event of events) {
    if (!eventTypes.has(event.event_type)) continue;
    const key = leadIdentityKey(event);
    if (!key) continue;
    leadKeys.add(key);
  }
  return leadKeys;
}

function uniqueLeadCountForEvents(events: EventRow[], eventTypes: Set<string>): number {
  return uniqueLeadKeysForEvents(events, eventTypes).size;
}

/** Count keys present in both sets (booked ∩ spoken). */
export function countLeadKeyIntersection(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const key of a) {
    if (b.has(key)) count++;
  }
  return count;
}

const SPOKEN_EVENT_TYPES = new Set(['show', 'claimed', 'live_transfer']);
const BOOKED_EVENT_TYPES = new Set(['appointment_booked']);

/**
 * Unique leads with ≥1 appointment_booked who also have ≥1 speak path
 * (show ∪ claimed ∪ live_transfer) in the same event set.
 */
export function countUniqueBookedConverted(events: EventRow[]): number {
  const booked = uniqueLeadKeysForEvents(events, BOOKED_EVENT_TYPES);
  if (booked.size === 0) return 0;
  const spoken = uniqueLeadKeysForEvents(events, SPOKEN_EVENT_TYPES);
  return countLeadKeyIntersection(booked, spoken);
}

/** Earliest book vs earliest claim per lead; count when claim is strictly after book. */
export function countClaimedAfterBooked(events: EventRow[]): number {
  const earliestBook = new Map<string, string>();
  const earliestClaim = new Map<string, string>();
  for (const event of events) {
    if (event.event_type !== 'appointment_booked' && event.event_type !== 'claimed') continue;
    const at = event.occurred_at;
    if (!at) continue;
    const key = leadIdentityKey(event);
    if (!key) continue;
    const bucket = event.event_type === 'appointment_booked' ? earliestBook : earliestClaim;
    const prev = bucket.get(key);
    if (!prev || at < prev) bucket.set(key, at);
  }
  let count = 0;
  for (const [key, claimAt] of earliestClaim) {
    const bookAt = earliestBook.get(key);
    if (bookAt && claimAt > bookAt) count++;
  }
  return count;
}

export function calculateMetrics(
  events: EventRow[],
  spendRows: SpendRow[],
  availability: AvailabilityWindow[] = [],
  timeZone: string = CALL_CENTER_TIMEZONE,
): MetricsResult {
  const leadEvents = events.filter(e => e.event_type === 'lead');
  const leads = leadEvents.length;
  const qualified_leads = leadEvents.filter(e => e.is_qualified === true).length;
  const hot_leads = leadEvents.filter(e => e.is_hot === true).length;
  const out_of_state_leads =
    leadEvents.filter(e => e.is_out_of_state === true).length +
    events.filter(e => e.event_type === 'out_of_state_lead').length;

  const booked = events.filter(e => e.event_type === 'appointment_booked').length;
  const cancelled = events.filter(e => e.event_type === 'appointment_cancelled').length;
  const rescheduled = events.filter(e => e.event_type === 'appointment_rescheduled').length;
  const shows = events.filter(e => e.event_type === 'show').length;
  const no_shows = events.filter(e => e.event_type === 'no_show').length;
  const lo_bailed = events.filter(e => e.event_type === 'lo_bailed').length;
  const loan_processing = events.filter(e => SUBMISSION_EVENT_TYPES.has(e.event_type)).length;
  const scheduled_total = booked + cancelled;
  // Appointments that actually took place (or should have). Excludes still-pending
  // bookings AND cancellations so the show rate reflects only appointments that were
  // expected to happen — not ones that haven't happened or were called off.
  const dispositioned_appointments = shows + no_shows + lo_bailed;
  const dials = events.filter(e => e.event_type === 'dial');
  const dial_count = dials.length;
  const pickups = dials.filter(e => e.is_pickup).length;
  const conversations = dials.filter(e => e.is_conversation).length;
  const callbacks = events.filter(e => e.event_type === 'callback_booked').length;
  const live_transfers = events.filter(e => e.event_type === 'live_transfer').length;
  const claimed = events.filter(e => e.event_type === 'claimed').length;
  const proposals_sent = events.filter(e => PROPOSAL_EVENT_TYPES.has(e.event_type)).length;
  const closed = events.filter(e => FUNDED_EVENT_TYPES.has(e.event_type)).length;
  // Funnel rollup: reaching a later stage implies every earlier stage.
  // Funded ⇒ also counts as submitted + proposed; Submitted ⇒ also counts as proposed.
  // Implied stages are derived here at read time so the event log stays truthful
  // (no synthetic proposal/submission rows) and counts stay deduped by lead.
  const submissionOrBeyondTypes = new Set([...SUBMISSION_EVENT_TYPES, ...FUNDED_EVENT_TYPES]);
  const proposalOrBeyondTypes = new Set([
    ...PROPOSAL_EVENT_TYPES,
    ...SUBMISSION_EVENT_TYPES,
    ...FUNDED_EVENT_TYPES,
  ]);
  const proposals_made = uniqueLeadCountForEvents(events, proposalOrBeyondTypes);
  const submissions_made = uniqueLeadCountForEvents(events, submissionOrBeyondTypes);
  const funded_loans = uniqueLeadCountForEvents(events, FUNDED_EVENT_TYPES);

  const ad_spend = spendRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const ad_spend_meta = spendRows
    .filter(r => r.platform === 'meta')
    .reduce((sum, r) => sum + Number(r.amount), 0);

  // Speed-to-lead: lead↔first-dial pairing, precise timestamps + in-window leads only,
  // summarized as a median (see src/lib/speed-to-lead.ts).
  const speedEvents: SpeedToLeadEventRow[] = events
    .filter(e => typeof e.occurred_at === 'string')
    .map(e => ({
      event_type: e.event_type,
      client_id: e.client_id ?? null,
      ghl_contact_id: e.ghl_contact_id ?? null,
      lead_phone: e.lead_phone ?? null,
      phone_number_used: e.phone_number_used ?? null,
      agent_name: e.agent_name ?? null,
      occurred_at: e.occurred_at as string,
      occurred_at_has_time: e.occurred_at_has_time ?? null,
      lead_created_at: e.lead_created_at ?? null,
    }));
  const speed = computeSpeedToLead(speedEvents, availability, timeZone);
  const speed_to_lead_min = speed.median_min ?? 0;

  const unique_booked_leads = uniqueLeadCountForEvents(events, BOOKED_EVENT_TYPES);
  const unique_hand_raise_leads = uniqueLeadCountForEvents(
    events,
    new Set(['appointment_booked', 'live_transfer', 'claimed']),
  );
  // Client conversations: show ∪ claimed ∪ live transfer — one lead once.
  const unique_conversation_leads = uniqueLeadCountForEvents(events, SPOKEN_EVENT_TYPES);
  // Call Center billable: live transfer ∪ show — claimed excluded.
  const billable_conversations = uniqueLeadCountForEvents(
    events,
    new Set(['show', 'live_transfer']),
  );
  const claimed_after_booked = countClaimedAfterBooked(events);
  const unique_booked_converted = countUniqueBookedConverted(events);

  return {
    new_leads: leads,
    qualified_leads,
    qualified_rate: leads > 0 ? (qualified_leads / leads) * 100 : 0,
    hot_leads,
    out_of_state_leads,
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
    conversation_rate: qualified_leads > 0 ? (unique_conversation_leads / qualified_leads) * 100 : 0,
    unique_hand_raises: unique_hand_raise_leads,
    hand_raise_rate: qualified_leads > 0 ? (unique_hand_raise_leads / qualified_leads) * 100 : 0,
    lead_hand_raise_rate: leads > 0 ? (unique_hand_raise_leads / leads) * 100 : 0,
    appointment_cancelled: cancelled,
    appointment_rescheduled: rescheduled,
    cancel_rate: scheduled_total > 0 ? (cancelled / scheduled_total) * 100 : 0,
    lo_bailed,
    loan_processing,
    live_transfers,
    claimed,
    total_conversations: conversations + claimed,
    proposals_sent,
    closed,
    proposals_made,
    submissions_made,
    funded_loans,
    manual_dqs: uniqueLeadCountForEvents(events, new Set(['manual_dq'])),
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
    cp_conversation: unique_conversation_leads > 0 ? ad_spend / unique_conversation_leads : 0,
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
    speed_to_lead_min,
    speed_to_lead_sample_size: speed.sample_size,
    speed_to_lead_excluded_out_of_window: speed.excluded_out_of_window,
    speed_to_lead_excluded_no_time: speed.excluded_no_time,
    speed_to_lead_excluded_before_cutoff: speed.excluded_before_cutoff,
    speed_to_lead_excluded_after_cutoff: speed.excluded_after_cutoff,
  };
}

export function attachCommissionRoas(
  metrics: MetricsResult,
  commissionTotal: number,
): MetricsResult {
  const total = Number.isFinite(commissionTotal) ? Math.max(0, commissionTotal) : 0;
  const roas = total > 0 && metrics.ad_spend > 0 ? total / metrics.ad_spend : null;
  return { ...metrics, commission_total: total, roas };
}

export function attachLoanDealMetrics(
  metrics: MetricsResult,
  deals: {
    submitted_deals: number;
    funded_deals: number;
    loan_volume: number;
    commission_total: number;
  },
): MetricsResult {
  const funded_deals = Math.max(0, Number(deals.funded_deals) || 0);
  const submitted_deals = Math.max(0, Number(deals.submitted_deals) || 0);
  const loan_volume = Math.max(0, Number(deals.loan_volume) || 0);
  const withRoas = attachCommissionRoas(metrics, deals.commission_total);
  return {
    ...withRoas,
    submitted_deals,
    funded_deals,
    loan_volume,
    cp_funded_deal: funded_deals > 0 ? withRoas.ad_spend / funded_deals : 0,
  };
}

function utcDateKey(iso: string): string {
  return new Date(iso).toISOString().split('T')[0];
}

function eachDateInRange(rangeStart: string, rangeEnd: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${rangeStart}T00:00:00.000Z`);
  const end = new Date(`${rangeEnd}T00:00:00.000Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Monday (UTC) of the week containing `dateStr` (YYYY-MM-DD). */
export function weekStartKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

export function daysInRange(rangeStart: string, rangeEnd: string): number {
  if (!rangeStart || !rangeEnd) return 0;
  const start = new Date(`${rangeStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${rangeEnd}T00:00:00.000Z`).getTime();
  if (end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

export function buildDailyCostSeries(
  events: TrendEventRow[],
  spendRows: TrendSpendRow[],
  rangeStart: string,
  rangeEnd: string,
): DailyCostBucket[] {
  type CostRaw = {
    date: string;
    spend: number;
    leads: number;
    qualified_leads: number;
    unique_conversations: Set<string>;
  };

  const byDate = new Map<string, CostRaw>();

  for (const date of eachDateInRange(rangeStart, rangeEnd)) {
    byDate.set(date, {
      date,
      spend: 0,
      leads: 0,
      qualified_leads: 0,
      unique_conversations: new Set(),
    });
  }

  for (const row of spendRows) {
    const date = row.spend_date;
    if (!byDate.has(date)) continue;
    const bucket = byDate.get(date)!;
    bucket.spend += Number(row.amount);
  }

  for (const e of events) {
    const date = utcDateKey(e.occurred_at);
    if (!byDate.has(date)) continue;
    const bucket = byDate.get(date)!;
    if (e.event_type === 'lead') {
      bucket.leads++;
      if (e.is_qualified === true) bucket.qualified_leads++;
    } else if (
      e.event_type === 'live_transfer' ||
      e.event_type === 'show' ||
      e.event_type === 'claimed'
    ) {
      const key = leadIdentityKey(e);
      if (key) bucket.unique_conversations.add(key);
    }
  }

  return eachDateInRange(rangeStart, rangeEnd).map(date => {
    const b = byDate.get(date)!;
    return {
      date: b.date,
      spend: b.spend,
      leads: b.leads,
      qualified_leads: b.qualified_leads,
      client_conversations: b.unique_conversations.size,
      _unique_conversations: b.unique_conversations,
    };
  }) as (DailyCostBucket & { _unique_conversations: Set<string> })[];
}

export function rollupCostSeriesToWeeks(daily: DailyCostBucket[]): DailyCostBucket[] {
  type DailyWithSet = DailyCostBucket & { _unique_conversations?: Set<string> };
  const byWeek = new Map<string, {
    date: string;
    spend: number;
    leads: number;
    qualified_leads: number;
    unique_conversations: Set<string>;
  }>();
  for (const row of daily as DailyWithSet[]) {
    const key = weekStartKey(row.date);
    let bucket = byWeek.get(key);
    if (!bucket) {
      bucket = {
        date: key,
        spend: 0,
        leads: 0,
        qualified_leads: 0,
        unique_conversations: new Set(),
      };
      byWeek.set(key, bucket);
    }
    bucket.spend += row.spend;
    bucket.leads += row.leads;
    bucket.qualified_leads += row.qualified_leads;
    if (row._unique_conversations) {
      for (const leadKey of row._unique_conversations) bucket.unique_conversations.add(leadKey);
    }
  }
  return [...byWeek.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(b => ({
      date: b.date,
      spend: b.spend,
      leads: b.leads,
      qualified_leads: b.qualified_leads,
      client_conversations: b.unique_conversations.size,
    }));
}

export function toCostTrendPoints(buckets: DailyCostBucket[]): CostTrendPoint[] {
  return buckets.map(b => ({
    date: b.date,
    spend: b.spend,
    leads: b.leads,
    qualified_leads: b.qualified_leads,
    client_conversations: b.client_conversations,
    cpl: b.leads > 0 ? b.spend / b.leads : null,
    cp_qualified: b.qualified_leads > 0 ? b.spend / b.qualified_leads : null,
    cp_conversation: b.client_conversations > 0 ? b.spend / b.client_conversations : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-client KPI timeline (drop-off detection)
// ─────────────────────────────────────────────────────────────────────────────

export type KpiTimelineEventRow = {
  event_type: string;
  occurred_at: string;
  is_qualified?: boolean | null;
  client_id?: string | null;
  ghl_contact_id?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  lead_name?: string | null;
};

export type KpiTimelineBucket = {
  /** Bucket start date (YYYY-MM-DD): the day, or the Monday of the week. */
  date: string;
  spend: number;
  leads: number;
  qualified_leads: number;
  booked: number;
  shows: number;
  no_shows: number;
  client_conversations: number;
  cpconv: number | null;
  cpql: number | null;
  cpl: number | null;
  show_rate: number | null;
  net_show_rate: number | null;
  /** Unique booked leads ÷ Qualified Leads. */
  booking_rate: number | null;
  /** Unique booked leads ÷ Total Leads (HE overview). */
  lead_booking_rate: number | null;
  conversation_rate: number | null;
  /** Unique hand-raise leads (booked ∪ claimed ∪ LT) ÷ Qualified Leads. */
  hand_raise_rate: number | null;
  /**
   * Unique (booked ∩ spoken) ÷ unique booked within this bucket.
   * Note: recovery across week boundaries only fully shows on whole-range metrics.
   */
  booked_to_conversation_rate: number | null;
  lead_to_qual: number | null;
};

type RawCounts = {
  date: string;
  spend: number;
  leads: number;
  qualified_leads: number;
  booked: number;
  shows: number;
  no_shows: number;
  lo_bailed: number;
  cancelled: number;
  live_transfers: number;
  claimed: number;
  unique_booked_leads: Set<string>;
  unique_hand_raise_leads: Set<string>;
  unique_conversation_leads: Set<string>;
};

function emptyCounts(date: string): RawCounts {
  return {
    date,
    spend: 0,
    leads: 0,
    qualified_leads: 0,
    booked: 0,
    shows: 0,
    no_shows: 0,
    lo_bailed: 0,
    cancelled: 0,
    live_transfers: 0,
    claimed: 0,
    unique_booked_leads: new Set(),
    unique_hand_raise_leads: new Set(),
    unique_conversation_leads: new Set(),
  };
}

function addLeadKey(set: Set<string>, event: KpiTimelineEventRow): void {
  const key = leadIdentityKey(event);
  if (key) set.add(key);
}

function finalizeBucket(c: RawCounts, pool: DialPool | null = null): KpiTimelineBucket {
  const uniqueConversations = c.unique_conversation_leads.size;
  const dispositioned = c.shows + c.no_shows + c.lo_bailed;
  const uniqueBooked = c.unique_booked_leads.size;
  const uniqueHandRaise = c.unique_hand_raise_leads.size;
  const uniqueBookedConverted = countLeadKeyIntersection(
    c.unique_booked_leads,
    c.unique_conversation_leads,
  );
  return {
    date: c.date,
    spend: c.spend,
    leads: c.leads,
    qualified_leads: c.qualified_leads,
    booked: c.booked,
    shows: c.shows,
    no_shows: c.no_shows,
    client_conversations: uniqueConversations,
    cpconv: uniqueConversations > 0 ? c.spend / uniqueConversations : null,
    cpql: c.qualified_leads > 0 ? c.spend / c.qualified_leads : null,
    cpl: c.leads > 0 ? c.spend / c.leads : null,
    show_rate: dispositioned > 0 ? (c.shows / dispositioned) * 100 : null,
    net_show_rate: c.shows + c.no_shows > 0 ? (c.shows / (c.shows + c.no_shows)) * 100 : null,
    booking_rate: c.qualified_leads > 0 ? (uniqueBooked / c.qualified_leads) * 100 : null,
    lead_booking_rate: c.leads > 0 ? (uniqueBooked / c.leads) * 100 : null,
    conversation_rate: dialPoolRate(uniqueConversations, c.qualified_leads, c.leads, pool),
    hand_raise_rate: dialPoolRate(uniqueHandRaise, c.qualified_leads, c.leads, pool),
    booked_to_conversation_rate:
      uniqueBooked > 0 ? (uniqueBookedConverted / uniqueBooked) * 100 : null,
    lead_to_qual: c.leads > 0 ? (c.qualified_leads / c.leads) * 100 : null,
  };
}

/**
 * Build a per-day or per-week KPI timeline for a single client so the team can
 * see exactly when an account fell off. Derived rates are recomputed per bucket
 * (never averaged) so they stay mathematically correct.
 */
export function buildClientKpiTimeline(
  events: KpiTimelineEventRow[],
  spendRows: TrendSpendRow[],
  rangeStart: string,
  rangeEnd: string,
  granularity: 'day' | 'week' = 'week',
  pool: DialPool | null = null,
): KpiTimelineBucket[] {
  const byDate = new Map<string, RawCounts>();
  for (const date of eachDateInRange(rangeStart, rangeEnd)) {
    byDate.set(date, emptyCounts(date));
  }

  for (const row of spendRows) {
    const bucket = byDate.get(row.spend_date);
    if (bucket) bucket.spend += Number(row.amount);
  }

  for (const e of events) {
    const date = utcDateKey(e.occurred_at);
    const bucket = byDate.get(date);
    if (!bucket) continue;
    if (e.event_type === 'lead') {
      bucket.leads++;
      if (e.is_qualified === true) bucket.qualified_leads++;
    } else if (e.event_type === 'appointment_booked') {
      bucket.booked++;
      addLeadKey(bucket.unique_booked_leads, e);
      addLeadKey(bucket.unique_hand_raise_leads, e);
    } else if (e.event_type === 'show') {
      bucket.shows++;
      addLeadKey(bucket.unique_conversation_leads, e);
    } else if (e.event_type === 'no_show') {
      bucket.no_shows++;
    } else if (e.event_type === 'lo_bailed') {
      bucket.lo_bailed++;
    } else if (e.event_type === 'appointment_cancelled') {
      bucket.cancelled++;
    } else if (e.event_type === 'live_transfer') {
      bucket.live_transfers++;
      addLeadKey(bucket.unique_hand_raise_leads, e);
      addLeadKey(bucket.unique_conversation_leads, e);
    } else if (e.event_type === 'claimed') {
      bucket.claimed++;
      addLeadKey(bucket.unique_hand_raise_leads, e);
      addLeadKey(bucket.unique_conversation_leads, e);
    }
  }

  const daily = eachDateInRange(rangeStart, rangeEnd).map(date => byDate.get(date)!);

  if (granularity === 'day') {
    return daily.map(row => finalizeBucket(row, pool));
  }

  const byWeek = new Map<string, RawCounts>();
  for (const row of daily) {
    const key = weekStartKey(row.date);
    let bucket = byWeek.get(key);
    if (!bucket) {
      bucket = emptyCounts(key);
      byWeek.set(key, bucket);
    }
    bucket.spend += row.spend;
    bucket.leads += row.leads;
    bucket.qualified_leads += row.qualified_leads;
    bucket.booked += row.booked;
    bucket.shows += row.shows;
    bucket.no_shows += row.no_shows;
    bucket.lo_bailed += row.lo_bailed;
    bucket.cancelled += row.cancelled;
    bucket.live_transfers += row.live_transfers;
    bucket.claimed += row.claimed;
    for (const leadKey of row.unique_booked_leads) bucket.unique_booked_leads.add(leadKey);
    for (const leadKey of row.unique_hand_raise_leads) bucket.unique_hand_raise_leads.add(leadKey);
    for (const leadKey of row.unique_conversation_leads) bucket.unique_conversation_leads.add(leadKey);
  }

  return [...byWeek.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(row => finalizeBucket(row, pool));
}

/** Parse GHL/sheet Y/N or boolean flags on webhook payloads. */
export function parseYnFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'y' || v === 'yes' || v === 'true' || v === '1';
  }
  return false;
}
