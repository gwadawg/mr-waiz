import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requirePermission, type AuthContext } from '@/lib/api-auth';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';
import { buildContactKey, eventPhone } from '@/lib/contact-key';
import { isClientLogFormRaw } from '@/lib/dq-reasons';
import { extractLeadIntake, leadProductFor, pickRaw, type LeadIntake, type LeadProduct } from '@/lib/lead-intake';
import {
  isActivityStage,
  isLeadQualityFilter,
  matchesLeadQuality,
  profilesForConversionExplorer,
} from '@/lib/conversion-explorer';

const PAGE_SIZE = 50;
/** Cap rows loaded for heavy in-memory grouping (conversion / unmapped). */
const MAX_EVENTS_HEAVY = 8_000;
/** Activity hydration cap for a single leads page. */
const MAX_EVENTS_PAGE_HYDRATE = 2_500;
/** Unscoped (all clients) Explorer windows wider than this are clamped. */
const MAX_UNSCOPED_RANGE_DAYS = 90;

type ClientEmbed = { name: string; ghl_location_id: string | null; reporting_type: string | null };

type EventRow = {
  id: string;
  client_id: string;
  event_type: string;
  occurred_at: string;
  scheduled_at: string | null;
  duration_seconds: number | null;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  speed_to_lead_seconds: number | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  agent_name: string | null;
  direction: string | null;
  call_status: string | null;
  recording_url: string | null;
  calendar_name: string | null;
  external_id: string | null;
  calendar_id: string | null;
  stage_booked: string | null;
  ghl_contact_id: string | null;
  lead_id: string | null;
  phone_number_used: string | null;
  is_qualified: boolean | null;
  is_hot: boolean | null;
  is_out_of_state: boolean | null;
  lead_source: string | null;
  ad_name: string | null;
  utm_term: string | null;
  dq_reason: string | null;
  raw: unknown;
  clients: ClientEmbed | ClientEmbed[] | null;
};

function clientRecord(
  clients: EventRow['clients'],
): ClientEmbed | null {
  if (!clients) return null;
  if (Array.isArray(clients)) return clients[0] ?? null;
  return clients;
}

function clientName(clients: EventRow['clients']): string {
  return clientRecord(clients)?.name ?? '—';
}

type TimelineItem = {
  id: string;
  event_type: string;
  occurred_at: string;
  scheduled_at: string | null;
  agent_name: string | null;
  duration_seconds: number | null;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  call_status: string | null;
  calendar_name: string | null;
  external_id: string | null;
  calendar_id: string | null;
  stage_booked: string | null;
  recording_url: string | null;
  dq_reason: string | null;
};

type LeadCounts = {
  dials: number;
  pickups: number;
  conversations: number;
  appointments_booked: number;
  shows: number;
  no_shows: number;
  lo_bailed: number;
  cancellations: number;
  callbacks: number;
  live_transfers: number;
  claimed: number;
  proposals: number;
  loan_processing: number;
  closed: number;
  proposals_made: number;
  submissions_made: number;
  funded_loans: number;
};

type LeadProfile = {
  contact_key: string;
  client_id: string;
  client_name: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  created_at: string;
  is_qualified: boolean;
  is_hot: boolean;
  is_out_of_state: boolean;
  loan_amount: string | null;
  property_value: string | null;
  ltv: number | null;
  b1_age: string | null;
  b2_age: string | null;
  state: string | null;
  credit_score_range: string | null;
  property_use: string | null;
  utm_term: string | null;
  product: LeadProduct | null;
  lead_source: string | null;
  ad_name: string | null;
  has_proposal_made: boolean;
  has_submission_made: boolean;
  has_loan_funded: boolean;
  has_manual_dq: boolean;
  dq_reason: string | null;
  ghl_contact_id: string | null;
  ghl_location_id: string | null;
  lead_id: string | null;
  counts: LeadCounts;
  timeline: TimelineItem[];
};

type UnmappedContact = {
  contact_key: string;
  client_id: string;
  client_name: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  ghl_contact_id: string | null;
  ghl_location_id: string | null;
  first_activity: string;
  last_activity: string;
  event_count: number;
  event_types: Record<string, number>;
  counts: LeadCounts;
  timeline: TimelineItem[];
};

type MappingSummary = {
  leads_in_period: number;
  unmapped_contacts: number;
  unmapped_events: number;
  unmapped_by_type: Record<string, number>;
};

type LeadIdentityRow = {
  client_id: string;
  ghl_contact_id: string | null;
  lead_phone: string | null;
  phone_number_used: string | null;
};

function rowContactKey(row: Pick<EventRow, 'client_id' | 'ghl_contact_id' | 'lead_phone' | 'phone_number_used'>): string {
  return buildContactKey(row.client_id, eventPhone(row), row.ghl_contact_id);
}

function profileKey(
  row: Pick<EventRow, 'lead_id' | 'client_id' | 'ghl_contact_id' | 'lead_phone' | 'phone_number_used'>,
): string {
  if (row.lead_id) return `lead:${row.lead_id}`;
  return rowContactKey(row);
}

type ProfileBuilder = LeadProfile & { has_lead_in_period: boolean; ad_from_entity?: boolean };

/** Contact keys that have at least one lead event on record (any date). */
async function loadContactKeysWithLeadEvents(
  service: AuthContext['service'],
  clientIds: string[],
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (clientIds.length === 0) return keys;

  const chunk = 1000;
  for (let from = 0; from < 50_000; from += chunk) {
    const { data, error } = await service
      .from('events')
      .select('client_id, ghl_contact_id, lead_phone, phone_number_used')
      .eq('event_type', 'lead')
      .in('client_id', clientIds)
      .range(from, from + chunk - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data as LeadIdentityRow[]) {
      keys.add(rowContactKey(row));
    }
    if (data.length < chunk) break;
  }
  return keys;
}

function buildUnmappedContact(profile: LeadProfile): UnmappedContact {
  const eventTypes: Record<string, number> = {};
  let firstActivity = profile.created_at;
  let lastActivity = profile.created_at;
  for (const item of profile.timeline) {
    eventTypes[item.event_type] = (eventTypes[item.event_type] ?? 0) + 1;
    if (new Date(item.occurred_at).getTime() < new Date(firstActivity).getTime()) {
      firstActivity = item.occurred_at;
    }
    if (new Date(item.occurred_at).getTime() > new Date(lastActivity).getTime()) {
      lastActivity = item.occurred_at;
    }
  }
  return {
    contact_key: profile.contact_key,
    client_id: profile.client_id,
    client_name: profile.client_name,
    lead_name: profile.lead_name,
    lead_phone: profile.lead_phone,
    lead_email: profile.lead_email,
    ghl_contact_id: profile.ghl_contact_id,
    ghl_location_id: profile.ghl_location_id,
    first_activity: firstActivity,
    last_activity: lastActivity,
    event_count: profile.timeline.length,
    event_types: eventTypes,
    counts: profile.counts,
    timeline: profile.timeline,
  };
}

function summarizeUnmapped(unmapped: UnmappedContact[]): Pick<
  MappingSummary,
  'unmapped_contacts' | 'unmapped_events' | 'unmapped_by_type'
> {
  const unmapped_by_type: Record<string, number> = {};
  let unmapped_events = 0;
  for (const contact of unmapped) {
    unmapped_events += contact.event_count;
    for (const [type, count] of Object.entries(contact.event_types)) {
      unmapped_by_type[type] = (unmapped_by_type[type] ?? 0) + count;
    }
  }
  return {
    unmapped_contacts: unmapped.length,
    unmapped_events,
    unmapped_by_type,
  };
}

const PROPOSAL_EVENT_TYPES = new Set(['proposal_made', 'proposal_sent']);
const SUBMISSION_EVENT_TYPES = new Set(['submission_made', 'loan_processing']);
const FUNDED_EVENT_TYPES = new Set(['loan_funded', 'closed']);

/** Copy intake fields onto a profile; a missing value never clears one already set. */
function applyIntake(profile: LeadProfile, intake: LeadIntake) {
  if (intake.loan_amount != null) profile.loan_amount = intake.loan_amount;
  if (intake.property_value != null) profile.property_value = intake.property_value;
  if (intake.ltv != null) profile.ltv = intake.ltv;
  if (intake.state != null) profile.state = intake.state;
  if (intake.b1_age != null) profile.b1_age = intake.b1_age;
  if (intake.b2_age != null) profile.b2_age = intake.b2_age;
  if (intake.credit_score_range != null) profile.credit_score_range = intake.credit_score_range;
  if (intake.property_use != null) profile.property_use = intake.property_use;
  if (intake.utm_term != null) profile.utm_term = intake.utm_term;
}

function extractLeadSource(row: EventRow): string | null {
  if (row.lead_source?.trim()) return row.lead_source.trim();
  const v = pickRaw(row.raw, ['lead_source', 'leadSource', 'list_source', 'listSource']);
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Meta creative name (GHL UTM Ad Name / utm_content). */
function extractAdName(row: EventRow): string | null {
  if (row.ad_name?.trim()) return row.ad_name.trim();
  const v = pickRaw(row.raw, ['ad_name', 'adName', 'utm_content', 'utmContent']);
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function emptyCounts(): LeadCounts {
  return {
    dials: 0,
    pickups: 0,
    conversations: 0,
    appointments_booked: 0,
    shows: 0,
    no_shows: 0,
    lo_bailed: 0,
    cancellations: 0,
    callbacks: 0,
    live_transfers: 0,
    claimed: 0,
    proposals: 0,
    loan_processing: 0,
    closed: 0,
    proposals_made: 0,
    submissions_made: 0,
    funded_loans: 0,
  };
}

function bumpCounts(counts: LeadCounts, eventType: string, row: EventRow) {
  switch (eventType) {
    case 'dial':
      counts.dials++;
      if (row.is_pickup) counts.pickups++;
      if (row.is_conversation) counts.conversations++;
      break;
    case 'appointment_booked':
      counts.appointments_booked++;
      break;
    case 'show':
      counts.shows++;
      break;
    case 'no_show':
      counts.no_shows++;
      break;
    case 'lo_bailed':
      counts.lo_bailed++;
      break;
    case 'appointment_cancelled':
      counts.cancellations++;
      break;
    case 'callback_booked':
      counts.callbacks++;
      break;
    case 'live_transfer':
      counts.live_transfers++;
      break;
    case 'claimed':
      counts.claimed++;
      break;
    case 'proposal_sent':
    case 'proposal_made':
      counts.proposals++;
      counts.proposals_made++;
      break;
    case 'loan_processing':
    case 'submission_made':
      counts.loan_processing++;
      counts.submissions_made++;
      break;
    case 'closed':
    case 'loan_funded':
      counts.closed++;
      counts.funded_loans++;
      break;
    default:
      break;
  }
}

function toTimelineItem(row: EventRow): TimelineItem {
  return {
    id: row.id,
    event_type: row.event_type,
    occurred_at: row.occurred_at,
    scheduled_at: row.scheduled_at,
    agent_name: row.agent_name,
    duration_seconds: row.duration_seconds,
    is_pickup: row.is_pickup,
    is_conversation: row.is_conversation,
    call_status: row.call_status,
    calendar_name: row.calendar_name,
    external_id: row.external_id,
    calendar_id: row.calendar_id,
    stage_booked: row.stage_booked,
    recording_url: row.recording_url,
    dq_reason: row.dq_reason,
  };
}

function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00.000Z`);
  const b = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function clampUnscopedStart(
  start: string | null,
  end: string | null,
  hasClientScope: boolean,
): { start: string | null; clamped: boolean } {
  if (hasClientScope || !start || !end) return { start, clamped: false };
  if (daysBetween(start, end) <= MAX_UNSCOPED_RANGE_DAYS) {
    return { start, clamped: false };
  }
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const clampedStart = new Date(endMs - MAX_UNSCOPED_RANGE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { start: clampedStart, clamped: true };
}

const EVENT_SELECT =
  'id, client_id, event_type, occurred_at, scheduled_at, duration_seconds, is_pickup, is_conversation, speed_to_lead_seconds, lead_name, lead_phone, lead_email, agent_name, direction, call_status, recording_url, phone_number_used, calendar_name, external_id, calendar_id, stage_booked, ghl_contact_id, lead_id, is_qualified, is_hot, is_out_of_state, lead_source, ad_name, utm_term, dq_reason, raw, clients(name, ghl_location_id, reporting_type)';

function applyClientScope<T extends { eq: Function; in: Function }>(
  q: T,
  clientId: string | null,
  liveClientIds: string[] | null,
): T {
  if (clientId) return q.eq('client_id', clientId) as T;
  if (liveClientIds) return q.in('client_id', liveClientFilter(liveClientIds)) as T;
  return q;
}

function applyDateRange<T extends { gte: Function; lte: Function }>(
  q: T,
  start: string | null,
  end: string | null,
): T {
  let next = q;
  if (start) next = next.gte('occurred_at', `${start}T00:00:00.000Z`) as T;
  if (end) next = next.lte('occurred_at', `${end}T23:59:59.999Z`) as T;
  return next;
}

function eventInRange(occurredAt: string, start: string | null, end: string | null): boolean {
  if (start && occurredAt < `${start}T00:00:00.000Z`) return false;
  if (end && occurredAt > `${end}T23:59:59.999Z`) return false;
  return true;
}

function ingestEventRows(
  rows: EventRow[],
  profiles: Map<string, ProfileBuilder>,
  range?: { start: string | null; end: string | null },
) {
  for (const row of rows) {
    const phone = eventPhone(row);
    const key = profileKey(row);

    if (!profiles.has(key)) {
      profiles.set(key, {
        contact_key: key,
        client_id: row.client_id,
        client_name: clientName(row.clients),
        lead_name: row.lead_name,
        lead_phone: phone,
        lead_email: row.lead_email,
        created_at: row.occurred_at,
        is_qualified: false,
        is_hot: false,
        is_out_of_state: false,
        loan_amount: null,
        property_value: null,
        ltv: null,
        b1_age: null,
        b2_age: null,
        state: null,
        credit_score_range: null,
        property_use: null,
        utm_term: null,
        product: leadProductFor(clientRecord(row.clients)?.reporting_type),
        lead_source: null,
        ad_name: null,
        has_proposal_made: false,
        has_submission_made: false,
        has_loan_funded: false,
        has_manual_dq: false,
        dq_reason: null,
        ghl_contact_id: null,
        ghl_location_id: clientRecord(row.clients)?.ghl_location_id ?? null,
        lead_id: row.lead_id,
        counts: emptyCounts(),
        timeline: [],
        has_lead_in_period: false,
      });
    }

    const profile = profiles.get(key)!;
    if (row.lead_id) profile.lead_id = row.lead_id;
    profile.timeline.push(toTimelineItem(row));
    const countsThisRow = !range || eventInRange(row.occurred_at, range.start, range.end);
    if (countsThisRow && row.event_type !== 'lead') {
      bumpCounts(profile.counts, row.event_type, row);
    }
    if (PROPOSAL_EVENT_TYPES.has(row.event_type)) profile.has_proposal_made = true;
    if (SUBMISSION_EVENT_TYPES.has(row.event_type)) profile.has_submission_made = true;
    if (FUNDED_EVENT_TYPES.has(row.event_type)) profile.has_loan_funded = true;
    if (row.event_type === 'manual_dq' && isClientLogFormRaw(row.raw)) {
      profile.has_manual_dq = true;
      if (row.dq_reason && !profile.dq_reason) profile.dq_reason = row.dq_reason;
    }

    if (row.lead_name && !profile.lead_name) profile.lead_name = row.lead_name;
    if (row.lead_email && !profile.lead_email) profile.lead_email = row.lead_email;
    if (phone && !profile.lead_phone) profile.lead_phone = phone;
    if (row.ghl_contact_id && !profile.ghl_contact_id) profile.ghl_contact_id = row.ghl_contact_id;
    if (!profile.ghl_location_id) {
      profile.ghl_location_id = clientRecord(row.clients)?.ghl_location_id ?? null;
    }

    if (row.event_type === 'lead') {
      profile.has_lead_in_period = true;
      if (row.is_qualified === true) profile.is_qualified = true;
      if (row.is_hot === true) profile.is_hot = true;
      if (row.is_out_of_state === true) profile.is_out_of_state = true;
      const intake = extractLeadIntake(row.raw, profile.product);
      const ls = extractLeadSource(row);
      const ad = extractAdName(row);
      applyIntake(profile, intake);
      if (row.utm_term?.trim()) profile.utm_term = row.utm_term.trim();
      if (ls != null && !profile.lead_source) profile.lead_source = ls;
      if (ad != null && !profile.ad_from_entity) profile.ad_name = ad;
      if (new Date(row.occurred_at).getTime() < new Date(profile.created_at).getTime()) {
        profile.created_at = row.occurred_at;
        if (row.lead_name) profile.lead_name = row.lead_name;
        if (row.lead_email) profile.lead_email = row.lead_email;
      }
    }
  }

  for (const profile of profiles.values()) {
    profile.timeline.sort(
      (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
    );
    if (profile.has_lead_in_period) {
      const leadTimes = profile.timeline
        .filter((t) => t.event_type === 'lead')
        .map((t) => t.occurred_at);
      if (leadTimes.length > 0) {
        profile.created_at = leadTimes.reduce((earliest, ts) =>
          new Date(ts).getTime() < new Date(earliest).getTime() ? ts : earliest,
        );
      }
    }
  }
}

type LeadEntityRow = {
  id: string;
  client_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  ghl_contact_id: string | null;
  lead_created_at: string | null;
  first_seen_at: string;
  utm_content: string | null;
  utm_term: string | null;
  ad_name: string | null;
  lead_source: string | null;
  conversation_at: string | null;
  conversation_source: string | null;
  proposal_at: string | null;
  proposal_implied: boolean;
  submission_at: string | null;
  submission_implied: boolean;
  funded_at: string | null;
  clients: EventRow['clients'];
  first_lead:
    | {
        is_qualified: boolean | null;
        is_hot: boolean | null;
        is_out_of_state: boolean | null;
        raw: unknown;
      }
    | {
        is_qualified: boolean | null;
        is_hot: boolean | null;
        is_out_of_state: boolean | null;
        raw: unknown;
      }[]
    | null;
};

function firstLeadOf(row: LeadEntityRow) {
  if (!row.first_lead) return null;
  return Array.isArray(row.first_lead) ? (row.first_lead[0] ?? null) : row.first_lead;
}

function publicGhlId(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('ldr:')) return null;
  return trimmed;
}

function impliedTimelineItem(id: string, eventType: string, occurredAt: string): TimelineItem {
  return {
    id,
    event_type: eventType,
    occurred_at: occurredAt,
    scheduled_at: null,
    agent_name: 'Implied',
    duration_seconds: null,
    is_pickup: null,
    is_conversation: null,
    call_status: null,
    calendar_name: null,
    external_id: null,
    calendar_id: null,
    stage_booked: null,
    recording_url: null,
    dq_reason: null,
  };
}

function applyLeadEntity(profile: ProfileBuilder, lead: LeadEntityRow, start: string | null, end: string | null) {
  const first = firstLeadOf(lead);
  const ghl = publicGhlId(lead.ghl_contact_id);
  profile.lead_id = lead.id;
  profile.ad_from_entity = true;
  profile.lead_name = lead.lead_name ?? profile.lead_name;
  profile.lead_phone = lead.lead_phone ?? profile.lead_phone;
  profile.lead_email = lead.lead_email ?? profile.lead_email;
  profile.ghl_contact_id = ghl ?? profile.ghl_contact_id;
  profile.lead_source = lead.lead_source ?? profile.lead_source;
  profile.ad_name = lead.utm_content?.trim() || lead.ad_name?.trim() || profile.ad_name;
  profile.created_at = lead.lead_created_at ?? lead.first_seen_at ?? profile.created_at;
  profile.has_lead_in_period = Boolean(lead.lead_created_at);
  profile.is_qualified = first?.is_qualified === true;
  profile.is_hot = first?.is_hot === true;
  profile.is_out_of_state = first?.is_out_of_state === true;
  profile.has_proposal_made = Boolean(lead.proposal_at);
  profile.has_submission_made = Boolean(lead.submission_at);
  profile.has_loan_funded = Boolean(lead.funded_at);
  applyIntake(profile, extractLeadIntake(first?.raw, profile.product));
  if (lead.utm_term?.trim()) profile.utm_term = lead.utm_term.trim();
  if (lead.proposal_implied && lead.proposal_at) {
    profile.timeline.push(impliedTimelineItem(`implied-proposal-${lead.id}`, 'proposal_made', lead.proposal_at));
    if (eventInRange(lead.proposal_at, start, end) && profile.counts.proposals_made === 0) {
      profile.counts.proposals_made = 1;
      profile.counts.proposals = 1;
    }
  }
  if (lead.submission_implied && lead.submission_at) {
    profile.timeline.push(impliedTimelineItem(`implied-submission-${lead.id}`, 'submission_made', lead.submission_at));
    if (eventInRange(lead.submission_at, start, end) && profile.counts.submissions_made === 0) {
      profile.counts.submissions_made = 1;
      profile.counts.loan_processing = 1;
    }
  }
  if (lead.conversation_source === 'implied_show' && lead.conversation_at) {
    profile.timeline.push(impliedTimelineItem(`implied-show-${lead.id}`, 'show', lead.conversation_at));
  }
  if (lead.conversation_source === 'implied_claimed' && lead.conversation_at) {
    profile.timeline.push(impliedTimelineItem(`implied-claimed-${lead.id}`, 'claimed', lead.conversation_at));
  }
  profile.timeline.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );
}

function milestoneDateColumn(stage: string | null): string | null {
  if (stage === 'proposal_made') return 'proposal_at';
  if (stage === 'submission_made') return 'submission_at';
  if (stage === 'loan_funded') return 'funded_at';
  if (stage === 'conversations') return 'conversation_at';
  return null;
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requirePermission(ctx, 'leads');
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  const live_only = searchParams.get('live_only') === 'true';
  let start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');
  const conversion_event = searchParams.get('conversion_event');
  const quality_raw = searchParams.get('quality');
  const quality = isLeadQualityFilter(quality_raw) ? quality_raw : null;
  const view = searchParams.get('view') === 'unmapped' ? 'unmapped' : 'leads';
  const search = searchParams.get('search')?.trim();
  const safeSearch = search ? search.replace(/[,()*]/g, ' ').trim() : '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));

  let liveClientIds: string[] | null = null;
  if (live_only && !client_id) {
    liveClientIds = await getLiveClientIds(ctx.service);
    // Empty .in() filters error in PostgREST — return a clean empty page instead.
    if (liveClientIds.length === 0) {
      return NextResponse.json({
        rows: [],
        total: 0,
        page,
        page_size: PAGE_SIZE,
        view,
        mapping_summary: {
          leads_in_period: 0,
          unmapped_contacts: 0,
          unmapped_events: 0,
          unmapped_by_type: {},
        },
        events_loaded: 0,
        capped: false,
        range_clamped: false,
        effective_start_date: start_date,
        effective_end_date: end_date,
      });
    }
  }

  const hasClientScope = Boolean(client_id || (liveClientIds && liveClientIds.length > 0));
  // Searching spans all dates by design; still clamp unscoped non-search windows.
  const clamp = safeSearch
    ? { start: start_date, clamped: false }
    : clampUnscopedStart(start_date, end_date, Boolean(client_id));
  start_date = clamp.start;

  const needsHeavyPath = view === 'unmapped' || Boolean(conversion_event);
  const stageColumn = view === 'leads' ? milestoneDateColumn(conversion_event) : null;

  // One row per lead. The date picks which leads appear; the timeline is the
  // lead's full history. Stage filters use that stage's own date.
  if (view === 'leads' && (stageColumn || !needsHeavyPath)) {
    const offset = (page - 1) * PAGE_SIZE;
    const dateColumn = stageColumn ?? 'lead_created_at';
    const firstLeadEmbed = quality
      ? 'first_lead:events!leads_first_lead_event_id_fkey!inner(is_qualified, is_hot, is_out_of_state, raw)'
      : 'first_lead:events!leads_first_lead_event_id_fkey(is_qualified, is_hot, is_out_of_state, raw)';
    let leadQuery = ctx.service
      .from('leads')
      .select(
        `id, client_id, lead_name, lead_phone, lead_email, ghl_contact_id, lead_created_at, first_seen_at, utm_content, utm_term, ad_name, lead_source, conversation_at, conversation_source, proposal_at, proposal_implied, submission_at, submission_implied, funded_at, clients(name, ghl_location_id, reporting_type), ${firstLeadEmbed}`,
        { count: 'exact' },
      )
      .is('merged_into_id', null)
      .order(dateColumn, { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    leadQuery = applyClientScope(leadQuery, client_id, liveClientIds);
    if (!stageColumn) leadQuery = leadQuery.not('lead_created_at', 'is', null);
    if (!safeSearch) {
      if (start_date) leadQuery = leadQuery.gte(dateColumn, `${start_date}T00:00:00.000Z`);
      if (end_date) leadQuery = leadQuery.lte(dateColumn, `${end_date}T23:59:59.999Z`);
    } else {
      leadQuery = leadQuery.or(
        `lead_name.ilike.%${safeSearch}%,lead_phone.ilike.%${safeSearch}%,lead_email.ilike.%${safeSearch}%`,
      );
    }
    if (quality === 'qualified' || quality === 'qualified_hot') {
      leadQuery = leadQuery.eq('first_lead.is_qualified', true);
    }
    if (quality === 'hot' || quality === 'qualified_hot') {
      leadQuery = leadQuery.eq('first_lead.is_hot', true);
    }

    const { data: leadData, error: leadError, count } = await leadQuery;
    if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });

    const leadRows = (leadData ?? []) as unknown as LeadEntityRow[];
    const profiles = new Map<string, ProfileBuilder>();
    for (const lead of leadRows) {
      const key = `lead:${lead.id}`;
      profiles.set(key, {
        contact_key: key,
        client_id: lead.client_id,
        client_name: clientName(lead.clients),
        lead_name: lead.lead_name,
        lead_phone: lead.lead_phone,
        lead_email: lead.lead_email,
        created_at: lead.lead_created_at ?? lead.first_seen_at,
        is_qualified: false,
        is_hot: false,
        is_out_of_state: false,
        loan_amount: null,
        property_value: null,
        ltv: null,
        b1_age: null,
        b2_age: null,
        state: null,
        credit_score_range: null,
        property_use: null,
        utm_term: null,
        product: leadProductFor(clientRecord(lead.clients)?.reporting_type),
        lead_source: lead.lead_source,
        ad_name: null,
        has_proposal_made: false,
        has_submission_made: false,
        has_loan_funded: false,
        has_manual_dq: false,
        dq_reason: null,
        ghl_contact_id: publicGhlId(lead.ghl_contact_id),
        ghl_location_id: clientRecord(lead.clients)?.ghl_location_id ?? null,
        lead_id: lead.id,
        counts: emptyCounts(),
        timeline: [],
        has_lead_in_period: Boolean(lead.lead_created_at),
        ad_from_entity: true,
      });
    }

    const ids = leadRows.map((lead) => lead.id);
    let eventsLoaded = 0;
    if (ids.length > 0) {
      const { data: activityData, error: activityError } = await ctx.service
        .from('events')
        .select(EVENT_SELECT)
        .in('lead_id', ids)
        .order('occurred_at', { ascending: false })
        .limit(MAX_EVENTS_PAGE_HYDRATE);
      if (activityError) return NextResponse.json({ error: activityError.message }, { status: 500 });
      const activity = (activityData ?? []) as unknown as EventRow[];
      eventsLoaded = activity.length;
      ingestEventRows(activity, profiles, safeSearch ? undefined : { start: start_date, end: end_date });
    }

    const countRange = safeSearch ? { start: null, end: null } : { start: start_date, end: end_date };
    for (const lead of leadRows) {
      const profile = profiles.get(`lead:${lead.id}`);
      if (profile) applyLeadEntity(profile, lead, countRange.start, countRange.end);
    }

    const stripInternal = (p: ProfileBuilder) => {
      const { has_lead_in_period: _period, ad_from_entity: _ad, ...rest } = p;
      return rest;
    };

    return NextResponse.json({
      rows: leadRows
        .map((lead) => profiles.get(`lead:${lead.id}`))
        .filter((profile): profile is ProfileBuilder => Boolean(profile))
        .map(stripInternal),
      total: count ?? leadRows.length,
      page,
      page_size: PAGE_SIZE,
      view,
      mapping_summary: {
        leads_in_period: count ?? leadRows.length,
        unmapped_contacts: 0,
        unmapped_events: 0,
        unmapped_by_type: {},
      },
      events_loaded: eventsLoaded,
      capped: eventsLoaded >= MAX_EVENTS_PAGE_HYDRATE,
      range_clamped: clamp.clamped,
      effective_start_date: start_date,
      effective_end_date: end_date,
    });
  }

  // ── Heavy path: conversion stage filter or unmapped activity scan ──
  let q = ctx.service
    .from('events')
    .select(EVENT_SELECT)
    .order('occurred_at', { ascending: false })
    .limit(MAX_EVENTS_HEAVY);

  q = applyClientScope(q, client_id, liveClientIds);
  if (!safeSearch) {
    q = applyDateRange(q, start_date, end_date);
  } else {
    q = q.or(
      `lead_name.ilike.%${safeSearch}%,lead_phone.ilike.%${safeSearch}%,lead_email.ilike.%${safeSearch}%`,
    );
  }

  // Stage filters only need the relevant event types, not every dial.
  if (conversion_event && view === 'leads') {
    if (conversion_event === 'manual_dq') {
      q = q.in('event_type', ['lead', 'manual_dq']);
    } else if (isActivityStage(conversion_event)) {
      q = q.in('event_type', ['lead', 'claimed', 'live_transfer', 'show']);
    } else {
      q = q.in('event_type', [
        'lead',
        'proposal_made',
        'proposal_sent',
        'submission_made',
        'loan_processing',
        'loan_funded',
        'closed',
      ]);
    }
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as EventRow[];
  const profiles = new Map<string, ProfileBuilder>();
  ingestEventRows(rows, profiles);

  const allProfiles = Array.from(profiles.values());
  const leadProfiles = allProfiles.filter((p) => p.has_lead_in_period);
  let conversionRows = profilesForConversionExplorer(allProfiles, conversion_event);
  if (quality) {
    conversionRows = conversionRows.filter((p) => matchesLeadQuality(p, quality));
  }
  const orphanCandidates = allProfiles.filter(
    (p) => !p.lead_id && !p.has_lead_in_period && p.timeline.some((t) => t.event_type !== 'lead'),
  );

  let unmappedContacts: UnmappedContact[] = [];
  if (view === 'unmapped' && orphanCandidates.length > 0) {
    const clientIds = Array.from(new Set(orphanCandidates.map((p) => p.client_id)));
    const keysWithLeadEver = await loadContactKeysWithLeadEvents(ctx.service, clientIds);
    unmappedContacts = orphanCandidates
      .filter((p) => !keysWithLeadEver.has(p.contact_key))
      .map((p) => buildUnmappedContact(p))
      .sort(
        (a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime(),
      );
  }

  const mappingSummary: MappingSummary = {
    leads_in_period: leadProfiles.length,
    unmapped_contacts: unmappedContacts.length,
    unmapped_events: 0,
    unmapped_by_type: {},
  };
  const unmappedStats = summarizeUnmapped(unmappedContacts);
  mappingSummary.unmapped_contacts = unmappedStats.unmapped_contacts;
  mappingSummary.unmapped_events = unmappedStats.unmapped_events;
  mappingSummary.unmapped_by_type = unmappedStats.unmapped_by_type;

  const sortedLeads = conversionRows.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const activeRows = view === 'unmapped' ? unmappedContacts : sortedLeads;
  const total = activeRows.length;
  const offset = (page - 1) * PAGE_SIZE;
  const pageRows = activeRows.slice(offset, offset + PAGE_SIZE);

  const stripInternal = (p: ProfileBuilder) => {
    const { has_lead_in_period: _period, ad_from_entity: _ad, ...rest } = p;
    return rest;
  };

  return NextResponse.json({
    rows:
      view === 'unmapped'
        ? pageRows
        : (pageRows as ProfileBuilder[]).map(stripInternal),
    total,
    page,
    page_size: PAGE_SIZE,
    view,
    mapping_summary: mappingSummary,
    events_loaded: rows.length,
    capped: rows.length >= MAX_EVENTS_HEAVY,
    range_clamped: clamp.clamped,
    effective_start_date: start_date,
    effective_end_date: end_date,
  });
}
