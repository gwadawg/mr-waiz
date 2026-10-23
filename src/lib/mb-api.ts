import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildAdDrilldown,
  buildMultiAdDrilldown,
} from '@/lib/ad-performance';
import { contactTypeLabel } from '@/lib/client-contacts';
import { fetchLoanDealTotals } from '@/lib/loan-deals';
import {
  loadLibraryVariants,
  loadMediaBuyerBoard,
  loadMediaBuyerDrilldownRows,
  uniqueAdNames,
  type MediaBuyerScope,
} from '@/lib/media-buyer-window';
import {
  attachLoanDealMetrics,
  calculateMetrics,
  type EventRow,
  type MetricsResult,
} from '@/lib/metrics';
import type { AvailabilityWindow } from '@/lib/speed-to-lead';
import {
  getOnboardingFormProfile,
  ONBOARDING_PROFILE_META,
} from '@/lib/onboarding-form-profile';
import { getSalesPackageLabel, normalizeSalesPackage } from '@/lib/offer-catalog';
import { getServiceProgramLabel } from '@/lib/service-program';
import { fetchCombinedSpendForMetrics } from '@/lib/spend';
import { fieldsFromResponses } from '@/lib/landing-page/responses';
import { groupLandingSites, siteIdFromResponses, type LandingSiteRow } from '@/lib/landing-page/sites';
import { listLandingRows } from '@/lib/landing-page/storage';
import type { LandingDraft } from '@/lib/landing-page/types';
import { tagsByLibraryId } from '@/lib/ad-tags-db';
import { resolveUserLabels } from '@/lib/user-resolver';

/** Named in every payload. These values are never selected. */
export const MB_API_EXCLUSIONS = [
  'mrr',
  'invoices',
  'stripe',
  'billing',
  'retainers',
  'contract_price',
  'what_waiz_charges',
  'payroll',
  'pay_rates',
  'company_kpis',
  'company_spend',
  'company_revenue',
  'ghl_subaccount',
  'setter_recordings',
  'checkin_calls',
  'churn_calls',
  'free_text_notes',
  'l3_l4_change_log',
] as const;

/**
 * Client file columns this API may read.
 * Package name and fulfillment are included. Dollar price and GHL login are not.
 */
export const MB_CLIENT_SELECT =
  'id, name, is_live, reporting_type, service_program, sales_package, offer_summary, lifecycle_status, primary_contact_name, contact_role, email, phone, phone_ghl, phone_live_transfer, phone_notifications, live_transfer_approved, website, brokerage_name, legal_business_name, nmls, street_address, city, state, zip_code, states_licensed, timezone, facebook_page_name, instagram_handle, ad_account_name, ad_account_url, funnel_url, landing_page_url, thank_you_page_url, second_landing_page_url, drive_folder_url, daily_adspend, ads_paused, ads_paused_at, ads_paused_note, launch_date';

export const MB_CONTACT_SELECT =
  'id, contact_type, name, email, phone, nmls, states_licensed';

/** Role only. Pay amounts, phone, and email of Waiz staff stay off this select. */
export const MB_AGENT_SELECT = 'id, name, pay_type';

/** Lead and dial rows. No recording_url. */
export const MB_ACTIVITY_SELECT =
  'id, client_id, event_type, occurred_at, scheduled_at, duration_seconds, lead_name, lead_phone, lead_email, agent_name, ad_name, is_qualified, is_hot, is_out_of_state, is_pickup, is_conversation, speed_to_lead_seconds, direction, call_status, dq_reason';

export const MB_CALL_TYPES = ['onboarding', 'launch'] as const;

export const MB_CHANGE_LAYERS = ['L1', 'L2'] as const;

export const MB_CHANGE_SELECT =
  'id, client_id, title, layer, constraint_label, change_description, hypothesis, success_metric, status, review_date, change_date, planned_date, baseline_value, target_value, outcome_value, outcome_recorded_at, work_type, created_at, created_by';

/** Full creative catalog for naming. No spend, no client, no alias table ids. */
export const MB_LIBRARY_SELECT =
  'id, ad_name, product, ad_format, status, summary, visual_notes, drive_url';

export const MB_LIBRARY_ALIAS_SELECT = 'library_id, alias_name';

const METRICS_EVENT_SELECT =
  'client_id, event_type, ghl_contact_id, lead_phone, lead_email, lead_name, phone_number_used, agent_name, occurred_at, occurred_at_has_time, lead_created_at, is_pickup, is_conversation, speed_to_lead_seconds, is_qualified, is_hot, is_out_of_state';

const EVENT_CAP = 100_000;
const ACTIVITY_DEFAULT_LIMIT = 200;
const ACTIVITY_MAX_LIMIT = 500;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const MB_ACTIVITY_KINDS = {
  leads: ['lead', 'manual_dq', 'out_of_state_lead'],
  dials: ['dial'],
  appointments: [
    'appointment_booked',
    'show',
    'no_show',
    'appointment_cancelled',
    'appointment_rescheduled',
    'lo_bailed',
  ],
  closes: [
    'proposal_made',
    'proposal_sent',
    'submission_made',
    'loan_processing',
    'loan_funded',
    'closed',
    'claimed',
    'live_transfer',
  ],
} as const;

export type MbActivityKind = keyof typeof MB_ACTIVITY_KINDS;

const ROLE_LABEL: Record<string, string> = {
  call_rep: 'Call rep',
  b2b_setter: 'Setter',
  admin: 'Admin',
  media_buyer: 'Media buyer',
  operations: 'Operations',
  client_success: 'Client success',
  ccm: 'CCM',
  other: 'Other',
};

type Service = SupabaseClient;

export type MbRange = { start_date: string; end_date: string };

export function mbDefaultRange(): MbRange {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(end.getUTCDate() - 29);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: iso(start), end_date: iso(end) };
}

export function parseMbRange(params: URLSearchParams): MbRange {
  const defaults = mbDefaultRange();
  const start_date = params.get('start_date')?.trim() || defaults.start_date;
  const end_date = params.get('end_date')?.trim() || defaults.end_date;
  if (!DAY.test(start_date) || !DAY.test(end_date)) {
    throw new Error('start_date and end_date must be YYYY-MM-DD');
  }
  if (start_date > end_date) throw new Error('start_date must be on or before end_date');
  return { start_date, end_date };
}

export function requireMbClientId(params: URLSearchParams): string {
  const clientId = params.get('clientId')?.trim();
  if (!clientId) throw new Error('clientId is required');
  return clientId;
}

/** Null when unset. Does not invent Call Center for a blank package. */
export function mbPackage(raw: string | null | undefined): { code: string | null; label: string | null } {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return { code: null, label: null };
  const code = normalizeSalesPackage(trimmed);
  return { code, label: getSalesPackageLabel(code) || null };
}

/** Call Center, Leads Only, or HE. This is who dials, separate from the package name. */
export function mbFulfillment(
  reportingType: string | null | undefined,
  serviceProgram: string | null | undefined,
): { code: string; label: string; service_program: string | null; service_program_label: string | null } {
  const code = getOnboardingFormProfile(reportingType, serviceProgram);
  return {
    code,
    label: ONBOARDING_PROFILE_META[code].label,
    service_program: serviceProgram?.trim() || null,
    service_program_label: getServiceProgramLabel(serviceProgram),
  };
}

export function mbRoleLabel(payType: string | null | undefined): string {
  if (!payType) return 'Team';
  return ROLE_LABEL[payType] ?? 'Team';
}

/**
 * Client KPI slice. Ad spend is the client's media budget.
 * Loan volume is the client's funded loan size.
 * Waiz fees, company P&L, commission, and ROAS are not copied.
 */
export function toMbPerformance(m: MetricsResult) {
  return {
    ad_spend: m.ad_spend,
    leads: m.new_leads,
    qualified_leads: m.qualified_leads,
    qualified_rate: m.qualified_rate,
    hot_leads: m.hot_leads,
    out_of_state_leads: m.out_of_state_leads,
    manual_dqs: m.manual_dqs,
    booked_appointments: m.booked_appointments,
    unique_booked_appointments: m.unique_booked_appointments,
    booking_rate: m.appt_booking_rate,
    lead_booking_rate: m.lead_booking_rate,
    shows: m.shows,
    no_shows: m.no_shows,
    show_rate: m.booked_to_conversation_rate,
    true_show_pct: m.show_pct,
    lo_bailed: m.lo_bailed,
    lo_bail_rate: m.lo_bail_rate,
    live_transfers: m.live_transfers,
    claimed: m.claimed,
    unique_hand_raises: m.unique_hand_raises,
    hand_raise_rate: m.hand_raise_rate,
    unique_conversations: m.unique_conversations,
    conversation_rate: m.conversation_rate,
    proposals_sent: m.proposals_sent,
    proposals_made: m.proposals_made,
    submissions_made: m.submissions_made,
    submitted_deals: m.submitted_deals,
    funded_loans: m.funded_loans,
    funded_deals: m.funded_deals,
    closed: m.closed,
    loan_volume: m.loan_volume,
    cpl: m.cpl,
    cp_qualified: m.cp_qualified,
    cp_hot: m.cp_hot,
    cp_conversation: m.cp_conversation,
    cp_appt: m.cp_appt,
    cost_per_show: m.cps,
    cp_proposal: m.cp_proposal_made,
    cp_submission: m.cp_submission_made,
    cp_funded: m.cp_funded_deal,
    cp_loan_funded: m.cp_loan_funded,
    outbound_dials: m.outbound_dials,
    dials_per_lead: m.dials_per_lead,
    pickups: m.pickups,
    pickup_pct: m.pickup_pct,
    dial_conversations: m.conversations,
    dial_conversation_pct: m.conversation_pct,
    speed_to_lead_min: m.speed_to_lead_min,
    speed_to_lead_sample_size: m.speed_to_lead_sample_size,
  };
}

type ClientRow = {
  id: string;
  name: string | null;
  is_live: boolean | null;
  reporting_type: string | null;
  service_program: string | null;
  sales_package: string | null;
  offer_summary: string | null;
  lifecycle_status: string | null;
  primary_contact_name: string | null;
  contact_role: string | null;
  email: string | null;
  phone: string | null;
  phone_ghl: string | null;
  phone_live_transfer: string | null;
  phone_notifications: string | null;
  live_transfer_approved: boolean | null;
  website: string | null;
  brokerage_name: string | null;
  legal_business_name: string | null;
  nmls: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  states_licensed: string[] | null;
  timezone: string | null;
  facebook_page_name: string | null;
  instagram_handle: string | null;
  ad_account_name: string | null;
  ad_account_url: string | null;
  funnel_url: string | null;
  landing_page_url: string | null;
  thank_you_page_url: string | null;
  second_landing_page_url: string | null;
  drive_folder_url: string | null;
  daily_adspend: number | string | null;
  ads_paused: boolean | null;
  ads_paused_at: string | null;
  ads_paused_note: string | null;
  launch_date: string | null;
};

function toMbClient(row: ClientRow) {
  const spend = row.daily_adspend == null || row.daily_adspend === ''
    ? null
    : Number(row.daily_adspend);
  return {
    id: row.id,
    name: row.name,
    is_live: row.is_live === true,
    lifecycle_status: row.lifecycle_status,
    reporting_type: row.reporting_type,
    fulfillment: mbFulfillment(row.reporting_type, row.service_program),
    package: mbPackage(row.sales_package),
    offer_summary: row.offer_summary,
    launch_date: row.launch_date,
    primary_contact_name: row.primary_contact_name,
    contact_role: row.contact_role,
    email: row.email,
    phone: row.phone,
    phone_ghl: row.phone_ghl,
    phone_live_transfer: row.phone_live_transfer,
    phone_notifications: row.phone_notifications,
    live_transfer_approved: row.live_transfer_approved === true,
    website: row.website,
    brokerage_name: row.brokerage_name,
    legal_business_name: row.legal_business_name,
    nmls: row.nmls,
    street_address: row.street_address,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    states_licensed: row.states_licensed ?? [],
    timezone: row.timezone,
    facebook_page_name: row.facebook_page_name,
    instagram_handle: row.instagram_handle,
    ad_account_name: row.ad_account_name,
    ad_account_url: row.ad_account_url,
    funnel_url: row.funnel_url,
    landing_page_url: row.landing_page_url,
    thank_you_page_url: row.thank_you_page_url,
    second_landing_page_url: row.second_landing_page_url,
    drive_folder_url: row.drive_folder_url,
    daily_adspend: spend != null && Number.isFinite(spend) ? spend : null,
    ads_paused: row.ads_paused === true,
    ads_paused_at: row.ads_paused_at,
    ads_paused_note: row.ads_paused_note,
  };
}

export async function listMbClients(service: Service, search?: string) {
  let query = service
    .from('clients')
    .select('id, name, is_live, reporting_type, service_program, sales_package, lifecycle_status, city, state')
    .order('name')
    .limit(500);

  const q = search?.trim();
  if (q) {
    const safe = q.replace(/[%_]/g, '');
    if (safe) query = query.ilike('name', `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return {
    clients: (data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      is_live: row.is_live === true,
      lifecycle_status: row.lifecycle_status,
      city: row.city,
      state: row.state,
      reporting_type: row.reporting_type,
      fulfillment: mbFulfillment(row.reporting_type, row.service_program),
      package: mbPackage(row.sales_package),
    })),
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

async function loadWaizTeam(service: Service, clientId: string) {
  const { data: shifts, error } = await service
    .from('focus_schedule')
    .select('agent_id')
    .eq('client_id', clientId);
  if (error) throw new Error(error.message);

  const ids = [...new Set((shifts ?? []).map(row => row.agent_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return [];

  const { data: agents, error: agentError } = await service
    .from('agents')
    .select(MB_AGENT_SELECT)
    .in('id', ids);
  if (agentError) throw new Error(agentError.message);

  return (agents ?? []).map(agent => ({
    id: agent.id as string,
    name: agent.name as string,
    role: mbRoleLabel(agent.pay_type as string | null),
  }));
}

export async function getMbClient(service: Service, clientId: string) {
  const [{ data: client, error: clientError }, { data: contacts, error: contactsError }, team] =
    await Promise.all([
      service.from('clients').select(MB_CLIENT_SELECT).eq('id', clientId).maybeSingle(),
      service
        .from('client_contacts')
        .select(`${MB_CONTACT_SELECT}, sort_order`)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true }),
      loadWaizTeam(service, clientId),
    ]);

  if (clientError) throw new Error(clientError.message);
  if (!client) throw new Error('Client not found');
  if (contactsError) throw new Error(contactsError.message);

  return {
    client: toMbClient(client as ClientRow),
    contacts: (contacts ?? []).map(contact => ({
      id: contact.id,
      role: contactTypeLabel(contact.contact_type),
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      nmls: contact.nmls,
      states_licensed: contact.states_licensed ?? [],
    })),
    waiz_team: team,
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

export async function getMbPerformance(service: Service, clientId: string, range: MbRange) {
  const startIso = `${range.start_date}T00:00:00.000Z`;
  const endIso = `${range.end_date}T23:59:59.999Z`;

  const [eventsResult, spendRows, availabilityResult, deals] = await Promise.all([
    service
      .from('events')
      .select(METRICS_EVENT_SELECT)
      .eq('client_id', clientId)
      .gte('occurred_at', startIso)
      .lte('occurred_at', endIso)
      .limit(EVENT_CAP),
    fetchCombinedSpendForMetrics(service, {
      client_id: clientId,
      start_date: range.start_date,
      end_date: range.end_date,
    }),
    service.from('setter_availability').select('weekday, time_start, time_end, is_live'),
    fetchLoanDealTotals(service, {
      client_id: clientId,
      start_date: range.start_date,
      end_date: range.end_date,
    }),
  ]);

  if (eventsResult.error) throw new Error(eventsResult.error.message);
  if (availabilityResult.error) throw new Error(availabilityResult.error.message);

  const events = (eventsResult.data ?? []) as EventRow[];
  const metrics = attachLoanDealMetrics(
    calculateMetrics(events, spendRows, (availabilityResult.data ?? []) as AvailabilityWindow[]),
    deals,
  );

  return {
    clientId,
    range,
    truncated: events.length >= EVENT_CAP,
    performance: toMbPerformance(metrics),
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

export async function getMbAds(
  service: Service,
  scope: MediaBuyerScope,
  drill: { libraryId: string | null; ad: string | null; variants: string | null },
) {
  if (drill.libraryId || drill.ad) {
    let displayName = drill.ad?.trim() || '';
    let variantNames = uniqueAdNames(
      drill.variants
        ? drill.variants.split('\n').map(s => s.trim())
        : drill.ad
          ? [drill.ad]
          : [],
    );
    let libraryId: string | null = drill.libraryId;

    if (drill.libraryId) {
      const resolved = await loadLibraryVariants(service, drill.libraryId);
      if (resolved.error || !resolved.data) {
        throw Object.assign(new Error(resolved.error ?? 'Library entry not found'), {
          status: resolved.status ?? 500,
        });
      }
      displayName = resolved.data.library.ad_name;
      variantNames = resolved.data.variantNames;
      libraryId = resolved.data.library.id;
    }

    const slim = await loadMediaBuyerDrilldownRows(service, scope, variantNames);
    if (slim.error || !slim.data) throw new Error(slim.error ?? 'Drilldown failed');

    const drilldown = libraryId
      ? buildMultiAdDrilldown(
          displayName,
          variantNames,
          slim.data.meta,
          slim.data.events,
          libraryId,
          { startDate: scope.startDate, endDate: scope.endDate },
        )
      : buildAdDrilldown(displayName, slim.data.meta, slim.data.events, {
          startDate: scope.startDate,
          endDate: scope.endDate,
        });

    const clientIds = drilldown.perClient.map(row => row.client_id);
    let names = new Map<string, string>();
    if (clientIds.length) {
      const { data: clients, error } = await service
        .from('clients')
        .select('id, name')
        .in('id', clientIds);
      if (error) throw new Error(error.message);
      names = new Map((clients ?? []).map(client => [client.id as string, client.name as string]));
    }

    return {
      drilldown: {
        ...drilldown,
        perClient: drilldown.perClient.map(row => ({
          ...row,
          client_name: names.get(row.client_id) ?? null,
        })),
      },
      truncated: slim.data.truncated,
      exclusions: [...MB_API_EXCLUSIONS],
    };
  }

  const board = await loadMediaBuyerBoard(service, scope);
  if (board.error || !board.data) throw new Error(board.error ?? 'Failed to load ads');

  return {
    ads: board.data.ads,
    truncated: board.data.truncated,
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

const LIBRARY_PAGE = 1000;

async function fetchPages<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += LIBRARY_PAGE) {
    const { data, error } = await load(from, from + LIBRARY_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < LIBRARY_PAGE) break;
  }
  return out;
}

type LibraryRow = {
  id: string;
  ad_name: string;
  product: string | null;
  ad_format: string | null;
  status: string | null;
  summary: string | null;
  visual_notes: string | null;
  drive_url: string | null;
};

/** Every library name and alias. Naming uniqueness uses this, not the performance board. */
export async function getMbLibrary(service: Service) {
  const ads = await fetchPages<LibraryRow>((from, to) =>
    service
      .from('ad_library')
      .select(MB_LIBRARY_SELECT)
      .order('ad_name', { ascending: true })
      .range(from, to),
  );
  const aliases = await fetchPages<{ library_id: string; alias_name: string }>((from, to) =>
    service
      .from('ad_library_aliases')
      .select(MB_LIBRARY_ALIAS_SELECT)
      .order('alias_name', { ascending: true })
      .range(from, to),
  );

  const aliasByLibrary = new Map<string, string[]>();
  for (const alias of aliases) {
    const list = aliasByLibrary.get(alias.library_id) ?? [];
    list.push(alias.alias_name);
    aliasByLibrary.set(alias.library_id, list);
  }

  const tags = new Map<string, { slug: string; label: string }[]>();
  const ids = ads.map(row => row.id);
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = await tagsByLibraryId(service, ids.slice(i, i + 150));
    if (chunk.error) throw new Error(chunk.error);
    for (const [libraryId, list] of chunk.data) {
      tags.set(
        libraryId,
        list.map(tag => ({ slug: tag.slug, label: tag.label })),
      );
    }
  }

  return {
    ads: ads.map(row => ({
      id: row.id,
      ad_name: row.ad_name,
      product: row.product,
      ad_format: row.ad_format,
      status: row.status,
      summary: row.summary,
      visual_notes: row.visual_notes,
      drive_url: row.drive_url,
      aliases: aliasByLibrary.get(row.id) ?? [],
      tags: tags.get(row.id) ?? [],
    })),
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

export function parseMbActivityKind(raw: string | null): MbActivityKind {
  const kind = (raw ?? 'dials').trim().toLowerCase();
  if (kind in MB_ACTIVITY_KINDS) return kind as MbActivityKind;
  throw new Error('kind must be leads, dials, appointments, or closes');
}

export function parseMbLimit(raw: string | null, fallback = ACTIVITY_DEFAULT_LIMIT): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error('limit must be a positive integer');
  return Math.min(n, ACTIVITY_MAX_LIMIT);
}

export function parseMbOffset(raw: string | null): number {
  if (!raw?.trim()) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error('offset must be a non-negative integer');
  return n;
}

export async function getMbActivity(
  service: Service,
  clientId: string,
  range: MbRange,
  kind: MbActivityKind,
  limit: number,
  offset: number,
) {
  const types = MB_ACTIVITY_KINDS[kind];
  const { data, error } = await service
    .from('events')
    .select(MB_ACTIVITY_SELECT)
    .eq('client_id', clientId)
    .in('event_type', [...types])
    .gte('occurred_at', `${range.start_date}T00:00:00.000Z`)
    .lte('occurred_at', `${range.end_date}T23:59:59.999Z`)
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    clientId,
    range,
    kind,
    rows: data ?? [],
    limit,
    offset,
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

export async function getMbCalls(service: Service, clientId: string) {
  const { data, error } = await service
    .from('client_calls')
    .select(
      'id, client_id, call_type, called_at, disposition, duration_seconds, notes, attendees, recording_url, transcript, follow_up_due_at',
    )
    .eq('client_id', clientId)
    .in('call_type', [...MB_CALL_TYPES])
    .is('deleted_at', null)
    .order('called_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  return {
    clientId,
    calls: (data ?? []).map(call => ({
      id: call.id,
      call_type: call.call_type,
      called_at: call.called_at,
      disposition: call.disposition,
      duration_seconds: call.duration_seconds,
      follow_up_due_at: call.follow_up_due_at,
      notes: call.notes,
      attendees: call.attendees,
      recording_url: call.recording_url,
      transcript: call.transcript,
    })),
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

export async function getMbChanges(service: Service, clientId: string) {
  const { data, error } = await service
    .from('client_action_logs')
    .select(MB_CHANGE_SELECT)
    .eq('client_id', clientId)
    .in('layer', [...MB_CHANGE_LAYERS])
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const labels = await resolveUserLabels(
    service,
    rows.map(row => row.created_by as string | null),
  );

  return {
    clientId,
    changes: rows.map(row => ({
      id: row.id,
      title: row.title,
      layer: row.layer,
      constraint_label: row.constraint_label,
      change_description: row.change_description,
      hypothesis: row.hypothesis,
      success_metric: row.success_metric,
      status: row.status,
      review_date: row.review_date,
      change_date: row.change_date,
      planned_date: row.planned_date,
      baseline_value: row.baseline_value,
      target_value: row.target_value,
      outcome_value: row.outcome_value,
      outcome_recorded_at: row.outcome_recorded_at,
      work_type: row.work_type,
      created_at: row.created_at,
      author: row.created_by ? labels[row.created_by as string] ?? null : null,
    })),
    exclusions: [...MB_API_EXCLUSIONS],
  };
}

function publicDraft(draft: LandingDraft) {
  return {
    name: draft.name,
    first_name: draft.firstName,
    title: draft.title,
    company: draft.company,
    tagline: draft.tagline,
    bio: draft.bio,
    phone: draft.phone,
    email: draft.email,
    street: draft.street,
    city: draft.city,
    region: draft.region,
    postal_code: draft.postalCode,
    nmls_individual: draft.nmlsIndividual,
    nmls_company: draft.nmlsCompany,
    legal_name: draft.legalName,
    hero_headline: draft.heroHeadline,
    fit_age: draft.fitAge,
    fit_credit: draft.fitCredit,
    apply_url: draft.applyUrl,
    booking_url: draft.bookingUrl,
  };
}

export async function getMbLanding(service: Service, clientId: string) {
  const rows = await listLandingRows(service, clientId);
  const sites = groupLandingSites(rows as LandingSiteRow[]);

  const pages = sites.map(site => {
    const newest = rows
      .filter(row => siteIdFromResponses(row.responses as Record<string, unknown> | null) === site.siteId)
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
    const draft = fieldsFromResponses(newest?.responses as Record<string, unknown> | null);
    return {
      site_id: site.siteId,
      product: site.product,
      slug: site.slug,
      label: site.label,
      status: site.status,
      landing_page_url: site.landingPageUrl,
      thank_you_page_url: site.thankYouPageUrl,
      draft: draft ? publicDraft(draft) : null,
    };
  });

  return {
    clientId,
    read_only: true,
    pages,
    exclusions: [...MB_API_EXCLUSIONS],
  };
}
