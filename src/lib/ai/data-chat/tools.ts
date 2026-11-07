import type { AuthContext } from '../../api-auth';
import { calculateMetrics } from '../../metrics';
import { fetchCombinedSpendForMetrics } from '../../spend';
import {
  getLiveClientIds,
  liveClientFilter,
} from '../../db-helpers';
import { computeDialAnalytics } from '../../dial-analytics';
import {
  emptyOutcomeCounts,
  fetchEnrichedBookingsInRange,
  grossShowRate,
  summarizeOutcomesByAgent,
} from '../../agent-appointment-stats';
import { buildRosterMatcher } from '../../agent-roster';
import { fetchAgentEventsInRange } from '../../agent-event-fetch';
import { computeSpeedToLead, type SpeedToLeadEventRow } from '../../speed-to-lead';
import { CLIENT_CONTACT_FIELDS } from '../../client-contacts';
import { CLIENT_CALL_FIELDS } from '../../client-calls';
import { LIBRARY_DOCS } from '../../library-manifest';
import { loadLibraryDoc } from '../../library-content';
import { TOOLS_BY_SCOPE, type DataChatFilters, type DataChatScope } from './scopes';

export type { DataChatFilters, DataChatScope };

/** Profile fields safe for chat — no MRR, billing, adspend contracts. */
const SAFE_CLIENT_FIELDS =
  'id, name, is_live, reporting_type, service_program, sales_package, offer, offer_summary, lifecycle_status, client_stage, primary_contact_name, email, phone, website, brokerage_name, legal_business_name, nmls, city, state, states_licensed, timezone, ghl_location_id, phone_live_transfer, phone_notifications, live_transfer_approved, contact_role, appointment_settings, facebook_page_name, launch_date, date_signed, source, created_at';

const PLAYBOOK_BODY_MAX = 6000;
const TRANSCRIPT_SNIPPET = 280;

const METRICS_EVENT_SELECT =
  'client_id, event_type, ghl_contact_id, lead_phone, lead_email, lead_name, phone_number_used, agent_name, occurred_at, occurred_at_has_time, lead_created_at, is_pickup, is_conversation, speed_to_lead_seconds, is_qualified, is_hot, is_out_of_state';

const DIAL_EVENT_SELECT =
  'agent_name, client_id, event_type, is_pickup, is_conversation, is_qualified, speed_to_lead_seconds, occurred_at, occurred_at_has_time, lead_created_at, dial_source, ghl_contact_id, lead_phone, lead_name, phone_number_used';

function resolveClientScope(filters: DataChatFilters, overrideClientId?: string) {
  const client_id = overrideClientId || filters.client_id || null;
  const live_only = !client_id && !!filters.live_only;
  return { client_id, live_only };
}

async function fetchFulfillmentMetrics(ctx: AuthContext, filters: DataChatFilters, overrideClientId?: string) {
  const { client_id, live_only } = resolveClientScope(filters, overrideClientId);
  const { start_date, end_date } = filters;

  let scopedClientIds: string[] | null = null;
  if (live_only) {
    scopedClientIds = await getLiveClientIds(ctx.service);
  }

  let eventsQuery = ctx.service.from('events').select(METRICS_EVENT_SELECT);
  if (client_id) eventsQuery = eventsQuery.eq('client_id', client_id);
  else if (scopedClientIds) eventsQuery = eventsQuery.in('client_id', liveClientFilter(scopedClientIds));
  eventsQuery = eventsQuery
    .gte('occurred_at', `${start_date}T00:00:00.000Z`)
    .lte('occurred_at', `${end_date}T23:59:59.999Z`)
    .limit(100000);

  const [{ data: events, error: eventsError }, spendRows, { data: availability, error: availabilityError }] =
    await Promise.all([
      eventsQuery,
      fetchCombinedSpendForMetrics(ctx.service, {
        client_id: client_id ?? undefined,
        client_ids: scopedClientIds,
        start_date,
        end_date,
      }).then(
        rows => ({ data: rows, error: null as Error | null }),
        (error: Error) => ({ data: null, error }),
      ),
      ctx.service.from('setter_availability').select('weekday, time_start, time_end, is_live'),
    ]);

  if (eventsError) throw new Error(eventsError.message);
  if (spendRows.error) throw new Error(spendRows.error.message);
  if (availabilityError) throw new Error(availabilityError.message);

  const m = calculateMetrics(events ?? [], spendRows.data ?? [], availability ?? []);

  // Trim to the KPIs the model needs — keep tokens low.
  return {
    range: { start_date, end_date },
    scope: client_id ? { client_id } : live_only ? { live_only: true } : { all_clients: true },
    funnel: {
      new_leads: m.new_leads,
      qualified_leads: m.qualified_leads,
      qualified_rate: m.qualified_rate,
      hot_leads: m.hot_leads,
      booked_appointments: m.booked_appointments,
      unique_booked_appointments: m.unique_booked_appointments,
      appt_booking_rate: m.appt_booking_rate,
      shows: m.shows,
      no_shows: m.no_shows,
      show_pct: m.show_pct,
      net_show_pct: m.net_show_pct,
      lo_bailed: m.lo_bailed,
      lo_bail_rate: m.lo_bail_rate,
      live_transfers: m.live_transfers,
      claimed: m.claimed,
      unique_conversations: m.unique_conversations,
      booked_to_conversation_rate: m.booked_to_conversation_rate,
      unique_booked_converted: m.unique_booked_converted,
      conversation_rate: m.conversation_rate,
      hand_raise_rate: m.hand_raise_rate,
      closed: m.closed,
      funded_loans: m.funded_loans,
      funded_deals: m.funded_deals,
      loan_volume: m.loan_volume,
    },
    cost: {
      ad_spend: m.ad_spend,
      cpl: m.cpl,
      cp_qualified: m.cp_qualified,
      cp_conversation: m.cp_conversation,
      cp_appt: m.cp_appt,
      cps: m.cps,
    },
    dials: {
      outbound_dials: m.outbound_dials,
      dials_per_lead: m.dials_per_lead,
      pickups: m.pickups,
      pickup_pct: m.pickup_pct,
      conversations: m.conversations,
      conversation_pct: m.conversation_pct,
      speed_to_lead_min: m.speed_to_lead_min,
      speed_to_lead_sample_size: m.speed_to_lead_sample_size,
    },
  };
}

async function listClients(ctx: AuthContext, search?: string) {
  let query = ctx.service
    .from('clients')
    .select('id, name, is_live')
    .order('name')
    .limit(100);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  if (!search?.trim()) return { clients: rows };

  const q = search.trim().toLowerCase();
  return {
    clients: rows.filter(c => (c.name ?? '').toLowerCase().includes(q)),
  };
}

async function fetchDialPerformance(ctx: AuthContext, filters: DataChatFilters, overrideClientId?: string) {
  const { client_id, live_only } = resolveClientScope(filters, overrideClientId);
  const startDate = filters.start_date;
  const endDate = filters.end_date;

  let liveClientIds: string[] | null = null;
  if (live_only) {
    liveClientIds = await getLiveClientIds(ctx.service);
  }

  let eventsQuery = ctx.service.from('events').select(DIAL_EVENT_SELECT);
  if (client_id) eventsQuery = eventsQuery.eq('client_id', client_id);
  else if (liveClientIds) eventsQuery = eventsQuery.in('client_id', liveClientFilter(liveClientIds));
  eventsQuery = eventsQuery
    .gte('occurred_at', `${startDate}T00:00:00.000Z`)
    .lte('occurred_at', `${endDate}T23:59:59.999Z`)
    .limit(100000);

  const [
    { data: roster, error: rosterError },
    { data: clients, error: clientsError },
    { data: events, error: eventsError },
    { data: availability, error: availabilityError },
  ] = await Promise.all([
    ctx.service.from('agents').select('name, phone').order('name'),
    ctx.service.from('clients').select('id, name, is_live').order('name'),
    eventsQuery,
    ctx.service.from('setter_availability').select('weekday, time_start, time_end, is_live'),
  ]);

  if (rosterError) throw new Error(rosterError.message);
  if (clientsError) throw new Error(clientsError.message);
  if (eventsError) throw new Error(eventsError.message);
  if (availabilityError) throw new Error(availabilityError.message);

  const result = computeDialAnalytics(
    events ?? [],
    clients ?? [],
    roster ?? [],
    startDate,
    endDate,
    availability ?? [],
  );

  const { summary, agents, clients: clientRows, trend, dial_sources } = result;

  return {
    range: { start_date: startDate, end_date: endDate },
    scope: client_id ? { client_id } : live_only ? { live_only: true } : { all_clients: true },
    summary: {
      dials: summary.dials,
      pickups: summary.pickups,
      pickup_rate: summary.pickup_rate,
      conversations: summary.conversations,
      conversation_rate: summary.conversation_rate,
      leads: summary.leads,
      qualified_leads: summary.qualified_leads,
      dials_per_lead: summary.dials_per_lead,
      appointments: summary.appointments,
      booking_rate: summary.booking_rate,
      avg_speed_to_lead_min: summary.avg_speed_to_lead_min,
      period_days: summary.period_days,
      avg_dials_per_day: summary.avg_dials_per_day,
      today_dials: summary.today_dials,
      today_pickups: summary.today_pickups,
    },
    agents: agents.slice(0, 25).map(a => ({
      agent_name: a.agent_name,
      dials: a.dials,
      pickups: a.pickups,
      pickup_rate: a.pickup_rate,
      conversations: a.conversations,
      conversation_rate: a.conversation_rate,
      appointments: a.appointments,
      avg_speed_to_lead_min: a.avg_speed_to_lead_min,
      dials_per_day: a.dials_per_day,
    })),
    flagged_clients: clientRows
      .filter(c => c.flag)
      .slice(0, 15)
      .map(c => ({
        client_name: c.client_name,
        client_id: c.client_id,
        dials: c.dials,
        pickup_rate: c.pickup_rate,
        dials_per_lead: c.dials_per_lead,
        booking_rate: c.booking_rate,
        flag: c.flag,
        flag_label: c.flag_label,
      })),
    top_clients_by_dials: clientRows.slice(0, 10).map(c => ({
      client_name: c.client_name,
      dials: c.dials,
      pickups: c.pickups,
      pickup_rate: c.pickup_rate,
      appointments: c.appointments,
      booking_rate: c.booking_rate,
    })),
    trend_tail: trend.slice(-14),
    dial_sources: dial_sources.slice(0, 10),
  };
}

async function fetchAgentScorecards(ctx: AuthContext, filters: DataChatFilters) {
  const startDate = filters.start_date;
  const endDate = filters.end_date;

  const [
    { data: roster, error: rosterError },
    data,
    { data: availability, error: availabilityError },
    enrichedBookings,
  ] = await Promise.all([
    ctx.service.from('agents').select('name, phone').order('name'),
    fetchAgentEventsInRange(ctx.service, startDate, endDate),
    ctx.service.from('setter_availability').select('weekday, time_start, time_end, is_live'),
    fetchEnrichedBookingsInRange(ctx.service, startDate, endDate),
  ]);

  if (rosterError) throw new Error(rosterError.message);
  if (availabilityError) throw new Error(availabilityError.message);

  const resolveAgent = buildRosterMatcher(roster ?? []);
  const outcomeByAgent = summarizeOutcomesByAgent(enrichedBookings, resolveAgent);
  const speed = computeSpeedToLead(
    data as SpeedToLeadEventRow[],
    availability ?? [],
    undefined,
    resolveAgent,
  );

  type Acc = {
    agent_name: string;
    dials: number;
    pickups: number;
    conversations: number;
    appointments: number;
    callbacks: number;
    live_transfers: number;
  };

  const agentMap = new Map<string, Acc>();
  for (const agent of roster ?? []) {
    agentMap.set(agent.name, {
      agent_name: agent.name,
      dials: 0,
      pickups: 0,
      conversations: 0,
      appointments: 0,
      callbacks: 0,
      live_transfers: 0,
    });
  }

  for (const row of data) {
    const name = resolveAgent(row.agent_name);
    if (!name) continue;
    const a = agentMap.get(name);
    if (!a) continue;
    if (row.event_type === 'dial') {
      a.dials++;
      if (row.is_pickup) a.pickups++;
      if (row.is_conversation) a.conversations++;
    } else if (row.event_type === 'appointment_booked') {
      a.appointments++;
    } else if (row.event_type === 'callback_booked') {
      a.callbacks++;
    } else if (row.event_type === 'live_transfer') {
      a.live_transfers++;
    }
  }

  const agents = Array.from(agentMap.values())
    .map(a => {
      const outcomes = outcomeByAgent.get(a.agent_name) ?? emptyOutcomeCounts();
      return {
        agent_name: a.agent_name,
        dials: a.dials,
        pickups: a.pickups,
        pickup_rate: a.dials > 0 ? Math.round((a.pickups / a.dials) * 100) : 0,
        conversations: a.conversations,
        conversation_rate: a.dials > 0 ? Math.round((a.conversations / a.dials) * 100) : 0,
        appointments: outcomes.appointments,
        callbacks: a.callbacks,
        live_transfers: a.live_transfers,
        shows: outcomes.shows,
        no_shows: outcomes.no_shows,
        lo_bailed: outcomes.lo_bailed,
        pending: outcomes.pending,
        show_rate: grossShowRate(outcomes),
        avg_speed_to_lead_min: speed.by_agent[a.agent_name]?.median_min ?? null,
      };
    })
    .filter(
      a =>
        a.dials > 0 ||
        a.appointments > 0 ||
        a.callbacks > 0 ||
        a.live_transfers > 0 ||
        a.shows > 0 ||
        a.no_shows > 0,
    )
    .sort((a, b) => b.appointments - a.appointments || a.agent_name.localeCompare(b.agent_name));

  const active = agents.length || 1;
  const team = {
    agents: agents.length,
    dials: agents.reduce((s, a) => s + a.dials, 0),
    pickups: agents.reduce((s, a) => s + a.pickups, 0),
    conversations: agents.reduce((s, a) => s + a.conversations, 0),
    appointments: agents.reduce((s, a) => s + a.appointments, 0),
    shows: agents.reduce((s, a) => s + a.shows, 0),
    no_shows: agents.reduce((s, a) => s + a.no_shows, 0),
    live_transfers: agents.reduce((s, a) => s + a.live_transfers, 0),
    avg_dials_per_agent: Math.round(agents.reduce((s, a) => s + a.dials, 0) / active),
    avg_appointments_per_agent: Math.round((agents.reduce((s, a) => s + a.appointments, 0) / active) * 10) / 10,
  };

  return {
    range: { start_date: startDate, end_date: endDate },
    team,
    agents: agents.slice(0, 30),
  };
}

function resolveRequiredClientId(
  filters: DataChatFilters,
  input: Record<string, unknown>,
): string {
  const fromInput =
    typeof input.client_id === 'string' && input.client_id.trim()
      ? input.client_id.trim()
      : null;
  const id = fromInput || filters.client_id || null;
  if (!id) {
    throw new Error('client_id is required — pick a client in the filter or pass client_id.');
  }
  return id;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function snippet(text: string | null | undefined, max = TRANSCRIPT_SNIPPET): string | null {
  if (!text?.trim()) return null;
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

async function fetchClientProfile(ctx: AuthContext, clientId: string) {
  const [{ data: client, error: clientError }, { data: contacts, error: contactsError }] =
    await Promise.all([
      ctx.service.from('clients').select(SAFE_CLIENT_FIELDS).eq('id', clientId).single(),
      ctx.service
        .from('client_contacts')
        .select(CLIENT_CONTACT_FIELDS)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

  if (clientError || !client) {
    throw new Error(clientError?.message ?? 'Client not found');
  }
  if (contactsError) throw new Error(contactsError.message);

  return {
    client,
    contacts: (contacts ?? []).map(c => ({
      id: c.id,
      contact_type: c.contact_type,
      name: c.name,
      email: c.email,
      phone: c.phone,
      nmls: c.nmls,
      states_licensed: c.states_licensed,
      notes: c.notes,
    })),
  };
}

async function searchClientCalls(
  ctx: AuthContext,
  clientId: string,
  callType?: string,
  limit = 10,
) {
  let query = ctx.service
    .from('client_calls')
    .select(
      'id, client_id, call_type, called_at, disposition, duration_seconds, notes, attendees, transcript, follow_up_due_at, recording_url',
    )
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('called_at', { ascending: false })
    .limit(limit);

  if (callType?.trim()) {
    query = query.eq('call_type', callType.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return {
    client_id: clientId,
    calls: (data ?? []).map(row => ({
      id: row.id,
      call_type: row.call_type,
      called_at: row.called_at,
      disposition: row.disposition,
      duration_seconds: row.duration_seconds,
      follow_up_due_at: row.follow_up_due_at,
      has_recording: !!row.recording_url,
      has_transcript: !!row.transcript,
      notes_snippet: snippet(row.notes, 200),
      transcript_snippet: snippet(row.transcript),
      attendees: row.attendees,
    })),
  };
}

async function fetchClientCall(ctx: AuthContext, callId: string) {
  const { data, error } = await ctx.service
    .from('client_calls')
    .select(CLIENT_CALL_FIELDS)
    .eq('id', callId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Call not found');

  return {
    call: {
      id: data.id,
      client_id: data.client_id,
      call_type: data.call_type,
      called_at: data.called_at,
      disposition: data.disposition,
      duration_seconds: data.duration_seconds,
      follow_up_due_at: data.follow_up_due_at,
      notes: data.notes,
      attendees: data.attendees,
      checkin_form: data.checkin_form,
      recording_url: data.recording_url,
      transcript: data.transcript
        ? data.transcript.length > 20000
          ? `${data.transcript.slice(0, 20000)}…[truncated]`
          : data.transcript
        : null,
    },
  };
}

async function fetchClientHealthSummary(ctx: AuthContext, clientId: string) {
  const [{ data: client }, { data: snapshot }, { data: actions }] = await Promise.all([
    ctx.service
      .from('clients')
      .select('id, name, lifecycle_status, cs_status, ad_status, ads_paused, ads_paused_at, ads_paused_note, is_live')
      .eq('id', clientId)
      .maybeSingle(),
    ctx.service
      .from('client_health_snapshots')
      .select(
        'id, period_start, period_end, window_code, cpconv, cpql, cpl, conversation_yield, show_rate, booking_rate, lead_to_qual, attention_score, worst_tier, primary_constraint, constraint_label, created_at',
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.service
      .from('client_action_logs')
      .select('id, title, layer, constraint_label, status, review_date, created_at, work_type')
      .eq('client_id', clientId)
      .eq('work_type', 'bet')
      .in('status', ['planned', 'in_progress', 'measuring'])
      .order('review_date', { ascending: true })
      .limit(10),
  ]);

  if (!client) throw new Error('Client not found');

  return {
    client: {
      id: client.id,
      name: client.name,
      lifecycle_status: client.lifecycle_status,
      cs_status: client.cs_status,
      ad_status: client.ad_status,
      ads_paused: client.ads_paused === true,
      ads_paused_at: client.ads_paused_at ?? null,
      ads_paused_note: client.ads_paused_note ?? null,
      is_live: client.is_live,
    },
    latest_snapshot: snapshot ?? null,
    open_interventions: actions ?? [],
  };
}

async function fetchClientNotes(ctx: AuthContext, clientId: string, limit = 15) {
  const { data, error } = await ctx.service
    .from('client_notes')
    .select('id, note_type, reason_code, body, related_call_id, created_at')
    .eq('client_id', clientId)
    .is('contact_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return {
    client_id: clientId,
    notes: (data ?? []).map(n => ({
      id: n.id,
      note_type: n.note_type,
      reason_code: n.reason_code,
      body: snippet(n.body, 800) ?? '',
      related_call_id: n.related_call_id,
      created_at: n.created_at,
    })),
  };
}

async function fetchClientInterventions(ctx: AuthContext, clientId: string, limit = 15) {
  const { data, error } = await ctx.service
    .from('client_action_logs')
    .select(
      'id, title, layer, constraint_label, change_description, hypothesis, success_metric, status, review_date, outcome_notes, created_at, work_type, change_date, planned_date',
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return { client_id: clientId, interventions: data ?? [] };
}

function searchPlaybooks(query: string, department?: string) {
  const q = query.trim().toLowerCase();
  if (!q) throw new Error('query is required');

  const dept = department?.trim().toLowerCase();
  const hits = LIBRARY_DOCS.filter(doc => {
    if (doc.status === 'draft') return false;
    if (dept && (doc.department ?? '') !== dept && !doc.domain.includes(dept)) return false;
    const hay = `${doc.title} ${doc.description} ${doc.slug} ${doc.domain} ${doc.artifact_type}`.toLowerCase();
    return q.split(/\s+/).every(token => hay.includes(token));
  })
    .slice(0, 12)
    .map(doc => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      department: doc.department ?? null,
      domain: doc.domain,
      artifact_type: doc.artifact_type,
      owner: doc.owner,
    }));

  return { query: q, department: dept ?? null, results: hits };
}

async function fetchPlaybook(slug: string) {
  const doc = await loadLibraryDoc(slug);
  if (!doc) throw new Error(`Playbook not found: ${slug}`);

  const body =
    doc.body.length > PLAYBOOK_BODY_MAX
      ? `${doc.body.slice(0, PLAYBOOK_BODY_MAX)}\n\n…[truncated — ask a narrower question or another section]`
      : doc.body;

  return {
    slug: doc.meta.slug,
    title: doc.meta.title,
    description: doc.meta.description,
    department: doc.meta.department ?? null,
    artifact_type: doc.meta.artifact_type,
    source: doc.source,
    body,
  };
}

export async function executeDataChatTool(
  ctx: AuthContext,
  scope: DataChatScope,
  name: string,
  input: Record<string, unknown>,
  filters: DataChatFilters,
): Promise<unknown> {
  const allowed = TOOLS_BY_SCOPE[scope];
  if (!allowed.has(name)) {
    throw new Error(`Tool "${name}" is not available in the ${scope} scope.`);
  }

  const overrideClientId =
    typeof input.client_id === 'string' && input.client_id.trim()
      ? input.client_id.trim()
      : undefined;

  switch (name) {
    case 'get_fulfillment_metrics':
      return fetchFulfillmentMetrics(ctx, filters, overrideClientId);
    case 'list_clients':
      return listClients(ctx, typeof input.search === 'string' ? input.search : undefined);
    case 'get_dial_performance':
      return fetchDialPerformance(ctx, filters, overrideClientId);
    case 'get_agent_scorecards':
      return fetchAgentScorecards(ctx, filters);
    case 'get_client_profile':
      return fetchClientProfile(ctx, resolveRequiredClientId(filters, input));
    case 'search_client_calls':
      return searchClientCalls(
        ctx,
        resolveRequiredClientId(filters, input),
        typeof input.call_type === 'string' ? input.call_type : undefined,
        clampLimit(input.limit, 10, 20),
      );
    case 'get_client_call': {
      const callId =
        typeof input.call_id === 'string' && input.call_id.trim()
          ? input.call_id.trim()
          : '';
      if (!callId) throw new Error('call_id is required');
      return fetchClientCall(ctx, callId);
    }
    case 'get_client_health_summary':
      return fetchClientHealthSummary(ctx, resolveRequiredClientId(filters, input));
    case 'get_client_notes':
      return fetchClientNotes(
        ctx,
        resolveRequiredClientId(filters, input),
        clampLimit(input.limit, 15, 30),
      );
    case 'get_client_interventions':
      return fetchClientInterventions(
        ctx,
        resolveRequiredClientId(filters, input),
        clampLimit(input.limit, 15, 30),
      );
    case 'search_playbooks': {
      const query = typeof input.query === 'string' ? input.query : '';
      const department = typeof input.department === 'string' ? input.department : undefined;
      return searchPlaybooks(query, department);
    }
    case 'get_playbook': {
      const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
      if (!slug) throw new Error('slug is required');
      return fetchPlaybook(slug);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
