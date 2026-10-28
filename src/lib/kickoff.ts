// Kick-off call workflow: fields, completion checks, and role options.

import {
  isKickoffIdentityFieldComplete,
  KICKOFF_IDENTITY_FIELD_KEYS,
  type KickoffIdentityFieldKey,
} from '@/lib/client-identity';
import { clientNeedsGhlMapping } from '@/lib/client-ghl-mapping';
import { formatMarkedClientNote } from '@/lib/client-form-notes';

export { isKickoffIdentityFieldComplete, KICKOFF_IDENTITY_FIELD_KEYS, type KickoffIdentityFieldKey };
import {
  getOnboardingFormProfile,
  type OnboardingFormProfile,
} from '@/lib/onboarding-form-profile';
import { normalizeReportingType, type ReportingType } from '@/lib/reporting-types';
import {
  kickoffSystemTypeLabel,
  normalizeServiceProgram,
  resolveKickoffServiceProgram,
  serviceProgramApplies,
  type ServiceProgram,
} from '@/lib/service-program';
import { formatStatesLicensed } from '@/lib/us-states';

export const KICKOFF_CLIENT_FIELDS =
  'id, name, lifecycle_status, primary_contact_name, phone, contact_role, states_licensed, nmls, brokerage_name, timezone, appointment_settings, daily_adspend, facebook_page_name, phone_notifications, phone_live_transfer, live_transfer_approved, ghl_location_id, reporting_type, service_program, offer, lead_nurturing_host, booking_hours, brand_colors, account_shape, team_routing_notes, qualifies_leads, qualification_notes, headshot_url, biography, date_signed';

export const CONTACT_ROLE_OPTIONS = [
  'Loan Officer',
  'Branch Manager',
  'Broker Owner',
  'MLO',
  'Team Lead',
  'Other',
] as const;

export type KickoffFieldKey =
  | 'phone'
  | 'contact_role'
  | 'states_licensed'
  | 'nmls'
  | 'brokerage_name'
  | 'timezone'
  | 'appointment_settings'
  | 'daily_adspend'
  | 'facebook_page_name'
  | 'phone_notifications'
  | 'phone_live_transfer'
  | 'live_transfer_approved'
  | 'pm_landing_copy'
  | 'pm_brand_assets'
  | 'pm_compliance_notes'
  | 'pm_competitor_refs'
  | 'pm_funnel_requirements'
  | 'cc_lead_source'
  | 'cc_qualification_criteria'
  | 'cc_hp_tag_user'
  | 'cc_setter_notes'
  | 'sub_account_name'
  | 'ghl_location_id'
  | 'recording_url';

export type KickoffSectionId =
  | 'confirm'
  | 'get_info'
  | 'pm'
  | 'call_center'
  | 'post_call';

export type KickoffFieldDef = {
  key: KickoffFieldKey;
  section: KickoffSectionId;
  profiles: OnboardingFormProfile[];
  requiresRevenue?: boolean;
};

export const KICKOFF_FIELD_REGISTRY: KickoffFieldDef[] = [
  { key: 'states_licensed', section: 'confirm', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'nmls', section: 'confirm', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'brokerage_name', section: 'confirm', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'timezone', section: 'confirm', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'daily_adspend', section: 'get_info', profiles: ['marketing_core', 'marketing_lead_gen'], requiresRevenue: true },
  { key: 'facebook_page_name', section: 'get_info', profiles: ['marketing_core', 'marketing_lead_gen'] },
  { key: 'phone_notifications', section: 'get_info', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'phone_live_transfer', section: 'get_info', profiles: ['marketing_core', 'call_center'] },
  { key: 'live_transfer_approved', section: 'get_info', profiles: ['marketing_core', 'call_center'] },
  { key: 'pm_landing_copy', section: 'pm', profiles: ['marketing_core', 'marketing_lead_gen'] },
  { key: 'pm_brand_assets', section: 'pm', profiles: ['marketing_core', 'marketing_lead_gen'] },
  { key: 'pm_compliance_notes', section: 'pm', profiles: ['marketing_core', 'marketing_lead_gen'] },
  { key: 'pm_competitor_refs', section: 'pm', profiles: ['marketing_core', 'marketing_lead_gen'] },
  { key: 'pm_funnel_requirements', section: 'pm', profiles: ['marketing_core', 'marketing_lead_gen'] },
  { key: 'cc_lead_source', section: 'call_center', profiles: ['call_center'] },
  { key: 'cc_qualification_criteria', section: 'call_center', profiles: ['call_center'] },
  { key: 'cc_hp_tag_user', section: 'call_center', profiles: ['call_center'] },
  { key: 'cc_setter_notes', section: 'call_center', profiles: ['call_center'] },
  { key: 'sub_account_name', section: 'post_call', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'ghl_location_id', section: 'post_call', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
  { key: 'recording_url', section: 'post_call', profiles: ['marketing_core', 'marketing_lead_gen', 'call_center'] },
];

export const CC_KICKOFF_FIELD_LABELS = {
  cc_lead_source: 'Lead source / how leads arrive',
  cc_qualification_criteria: 'Setter qualification criteria',
  cc_hp_tag_user: 'GHL assigned user / HP tag contact',
  cc_setter_notes: 'Setter script / dial notes',
} as const;

/** Brand / landing narrative. Stored on the client file as a note, not client columns. */
export const KICKOFF_PM_FIELD_LABELS = {
  pm_landing_copy: 'Landing page copy notes',
  pm_compliance_notes: 'Compliance disclaimers',
  pm_competitor_refs: 'Competitor references',
  pm_funnel_requirements: 'Special funnel requirements',
} as const;

export const LEAD_NURTURING_HOSTS = ['internal', 'external', 'Both'] as const;
export type LeadNurturingHost = (typeof LEAD_NURTURING_HOSTS)[number];

export const CONTACT_ROLE_CONFIRM_OPTIONS = [
  { value: 'owner', label: 'Company owner', stored: 'Broker Owner' },
  { value: 'mlo', label: 'Loan officer', stored: 'MLO' },
] as const;

export const KICKOFF_PM_NOTE_MARKER = 'Kick-off — Brand & landing notes';
export const KICKOFF_CC_NOTE_MARKER = 'Kick-off — Call center notes';

const KICKOFF_NARRATIVE_KEYS = [
  'pm_landing_copy',
  'pm_brand_assets',
  'pm_compliance_notes',
  'pm_competitor_refs',
  'pm_funnel_requirements',
  'cc_lead_source',
  'cc_qualification_criteria',
  'cc_hp_tag_user',
  'cc_setter_notes',
  'recording_url',
  'transcript',
  'reviews',
  'trust_notes',
  'stock_criteria_url',
  'facebook_follow_up_at',
] as const satisfies readonly (keyof KickoffDraft)[];

export type KickoffNarrativeKey = (typeof KICKOFF_NARRATIVE_KEYS)[number];

export type KickoffClient = {
  id: string;
  name: string;
  lifecycle_status: string | null;
  primary_contact_name: string | null;
  phone: string | null;
  contact_role: string | null;
  states_licensed: string[] | null;
  nmls: string | null;
  brokerage_name: string | null;
  timezone: string | null;
  appointment_settings: string | null;
  daily_adspend: number | null;
  facebook_page_name: string | null;
  phone_notifications: string | null;
  phone_live_transfer: string | null;
  live_transfer_approved: boolean | null;
  ghl_location_id: string | null;
  reporting_type: string | null;
  service_program: string | null;
  offer: string | null;
  lead_nurturing_host: string | null;
  booking_hours: string | null;
  brand_colors: string | null;
  account_shape: string | null;
  team_routing_notes: string | null;
  qualifies_leads: boolean | null;
  qualification_notes: string | null;
  headshot_url: string | null;
  biography: string | null;
  date_signed: string | null;
};

export type KickoffOnboardingCall = {
  id: string;
  recording_url: string | null;
  transcript: string | null;
  called_at: string;
};

export type KickoffConfig = {
  profile: OnboardingFormProfile;
  visibleFields: KickoffFieldKey[];
  visibleSections: KickoffSectionId[];
  showPmSection: boolean;
  showCallCenterSection: boolean;
};

export function getKickoffConfig(
  profile: OnboardingFormProfile,
  canViewRevenue = true,
): KickoffConfig {
  const visibleFields = KICKOFF_FIELD_REGISTRY.filter(
    f => f.profiles.includes(profile) && (!f.requiresRevenue || canViewRevenue),
  ).map(f => f.key);
  const visibleSections = [...new Set(
    KICKOFF_FIELD_REGISTRY.filter(f => f.profiles.includes(profile)).map(f => f.section),
  )];
  return {
    profile,
    visibleFields,
    visibleSections,
    showPmSection: profile === 'marketing_core' || profile === 'marketing_lead_gen',
    showCallCenterSection: profile === 'call_center',
  };
}

export function isKickoffFieldVisible(
  key: KickoffFieldKey,
  profile: OnboardingFormProfile,
  canViewRevenue = true,
): boolean {
  const def = KICKOFF_FIELD_REGISTRY.find(f => f.key === key);
  if (!def) return false;
  if (def.requiresRevenue && !canViewRevenue) return false;
  return def.profiles.includes(profile);
}

export function isKickoffLifecycle(status: string | null | undefined): boolean {
  return status === 'new_account' || status === 'onboarding';
}

/**
 * Kick-off still blocks later work (roster, Launch Kit, launch checklist).
 * A kick-off form filed this cycle clears that block.
 * Before it is filed, an onboarding client still needs a mapped GHL location
 * and an OB recording. Callers that do not have the call must pass `submitted`
 * from the form record — a missing call is not the same as a filed form.
 */
export function isKickoffIncomplete(
  client: {
    lifecycle_status?: string | null;
    ghl_location_id?: string | null;
    name?: string | null;
    primary_contact_name?: string | null;
  },
  onboardingCall: { recording_url?: string | null } | null | undefined,
  submitted = false,
): boolean {
  if (!isKickoffLifecycle(client.lifecycle_status)) return false;
  if (submitted) return false;
  if (clientNeedsGhlMapping(client)) return true;
  return !client.ghl_location_id?.trim() || !onboardingCall?.recording_url?.trim();
}

export type KickoffDraft = {
  reporting_type: ReportingType;
  service_program: ServiceProgram | '';
  vertical_confirmed: boolean;
  sub_account_name: string;
  phone: string;
  contact_role: string;
  states_licensed: string[];
  nmls: string;
  brokerage_name: string;
  timezone: string;
  appointment_settings: string;
  daily_adspend: string;
  facebook_page_name: string;
  phone_notifications: string;
  phone_live_transfer: string;
  live_transfer_approved: '' | 'yes' | 'no';
  ghl_location_id: string;
  recording_url: string;
  transcript: string;
  advance_lifecycle: boolean;
  pm_landing_copy: string;
  pm_brand_assets: string;
  pm_compliance_notes: string;
  pm_competitor_refs: string;
  pm_funnel_requirements: string;
  cc_lead_source: string;
  cc_qualification_criteria: string;
  cc_hp_tag_user: string;
  cc_setter_notes: string;
  lead_nurturing_host: LeadNurturingHost | '';
  account_shape: '' | 'solo' | 'team';
  team_routing_notes: string;
  booking_hours: string;
  qualifies_leads: '' | 'yes' | 'no';
  qualification_notes: string;
  brand_colors: string;
  headshot_url: string;
  biography: string;
  reviews: string;
  trust_notes: string;
  stock_criteria_url: string;
  integrated_on_call: boolean;
  facebook_access: '' | 'granted' | 'follow_up';
  facebook_follow_up_at: string;
  slack_team_added: boolean;
  date_signed: string;
  contact_role_choice: '' | 'owner' | 'mlo';
};

export function kickoffDraftFromClient(
  c: KickoffClient,
  recordingUrl = '',
  verticalConfirmed = false,
  transcript = '',
): KickoffDraft {
  const phone = c.phone ?? '';
  return {
    reporting_type: normalizeReportingType(c.reporting_type),
    service_program: normalizeServiceProgram(c.service_program) ?? '',
    vertical_confirmed: verticalConfirmed,
    sub_account_name: c.name ?? '',
    phone,
    contact_role: c.contact_role ?? '',
    states_licensed: c.states_licensed ?? [],
    nmls: c.nmls ?? '',
    brokerage_name: c.brokerage_name ?? '',
    timezone: c.timezone ?? '',
    appointment_settings: c.appointment_settings ?? '',
    daily_adspend: c.daily_adspend != null ? String(c.daily_adspend) : '',
    facebook_page_name: c.facebook_page_name ?? '',
    phone_notifications: c.phone_notifications ?? phone,
    phone_live_transfer: c.phone_live_transfer ?? '',
    live_transfer_approved: c.live_transfer_approved === true ? 'yes' : c.live_transfer_approved === false ? 'no' : '',
    ghl_location_id: c.ghl_location_id ?? '',
    recording_url: recordingUrl,
    transcript,
    advance_lifecycle: c.lifecycle_status === 'new_account',
    pm_landing_copy: '',
    pm_brand_assets: '',
    pm_compliance_notes: '',
    pm_competitor_refs: '',
    pm_funnel_requirements: '',
    cc_lead_source: '',
    cc_qualification_criteria: '',
    cc_hp_tag_user: '',
    cc_setter_notes: '',
    lead_nurturing_host: hostFromStored(c.lead_nurturing_host),
    account_shape: c.account_shape === 'solo' || c.account_shape === 'team' ? c.account_shape : '',
    team_routing_notes: c.team_routing_notes ?? '',
    booking_hours: c.booking_hours ?? '',
    qualifies_leads: c.qualifies_leads === true ? 'yes' : c.qualifies_leads === false ? 'no' : '',
    qualification_notes: c.qualification_notes ?? '',
    brand_colors: c.brand_colors ?? '',
    headshot_url: c.headshot_url ?? '',
    biography: c.biography ?? '',
    reviews: '',
    trust_notes: '',
    stock_criteria_url: '',
    integrated_on_call: false,
    facebook_access: '',
    facebook_follow_up_at: '',
    slack_team_added: false,
    date_signed: toDateInputValue(c.date_signed),
    contact_role_choice: contactRoleChoiceFromStored(c.contact_role),
  };
}

function hostFromStored(value: string | null | undefined): LeadNurturingHost | '' {
  if (value === 'internal' || value === 'external' || value === 'Both') return value;
  return '';
}

export function contactRoleNeedsConfirm(role: string | null | undefined): boolean {
  const value = (role ?? '').trim();
  return value !== 'Broker Owner' && value !== 'MLO';
}

export function contactRoleChoiceFromStored(role: string | null | undefined): '' | 'owner' | 'mlo' {
  if (role === 'Broker Owner') return 'owner';
  if (role === 'MLO') return 'mlo';
  return '';
}

export function storedContactRoleFromChoice(choice: unknown): 'Broker Owner' | 'MLO' | null {
  if (choice === 'owner') return 'Broker Owner';
  if (choice === 'mlo') return 'MLO';
  return null;
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

const PREFILL_TRACKED_KEYS: (keyof KickoffDraft)[] = [
  'sub_account_name', 'phone', 'contact_role', 'states_licensed', 'nmls', 'brokerage_name', 'timezone',
  'appointment_settings', 'daily_adspend', 'facebook_page_name', 'phone_notifications',
  'phone_live_transfer', 'live_transfer_approved', 'ghl_location_id', 'recording_url',
  'cc_lead_source', 'cc_qualification_criteria', 'cc_hp_tag_user', 'cc_setter_notes',
  'pm_landing_copy', 'pm_brand_assets', 'pm_compliance_notes', 'pm_competitor_refs', 'pm_funnel_requirements',
  'lead_nurturing_host', 'account_shape', 'team_routing_notes', 'booking_hours', 'qualifies_leads',
  'qualification_notes', 'brand_colors', 'headshot_url', 'biography', 'reviews', 'trust_notes',
  'stock_criteria_url', 'facebook_access', 'facebook_follow_up_at', 'date_signed',
];

export function kickoffFieldHadValue(draft: KickoffDraft, key: keyof KickoffDraft): boolean {
  const v = draft[key];
  if (Array.isArray(v)) return v.length > 0;
  if (key === 'live_transfer_approved') return v === 'yes' || v === 'no';
  if (key === 'advance_lifecycle' || key === 'vertical_confirmed') return false;
  if (typeof v === 'boolean') return v;
  return typeof v === 'string' && v.trim().length > 0;
}

export function countKickoffFieldsOnFile(draft: KickoffDraft): number {
  return PREFILL_TRACKED_KEYS.filter(k => kickoffFieldHadValue(draft, k)).length;
}

export function kickoffFieldsMatch(a: KickoffDraft, b: KickoffDraft, key: keyof KickoffDraft): boolean {
  const left = a[key];
  const right = b[key];
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

export function kickoffPmFieldsFromDraft(draft: KickoffDraft): Record<string, unknown> {
  return {
    pm_landing_copy: draft.pm_landing_copy.trim() || null,
    pm_brand_assets: draft.pm_brand_assets.trim() || null,
    pm_compliance_notes: draft.pm_compliance_notes.trim() || null,
    pm_competitor_refs: draft.pm_competitor_refs.trim() || null,
    pm_funnel_requirements: draft.pm_funnel_requirements.trim() || null,
  };
}

export function kickoffCcFieldsFromDraft(draft: KickoffDraft): Record<string, unknown> {
  return {
    cc_lead_source: draft.cc_lead_source.trim() || null,
    cc_qualification_criteria: draft.cc_qualification_criteria.trim() || null,
    cc_hp_tag_user: draft.cc_hp_tag_user.trim() || null,
    cc_setter_notes: draft.cc_setter_notes.trim() || null,
  };
}

export function kickoffExtraFieldsFromDraft(
  profile: OnboardingFormProfile,
  draft: KickoffDraft,
): Record<string, unknown> {
  if (profile === 'call_center') return kickoffCcFieldsFromDraft(draft);
  if (profile === 'marketing_core' || profile === 'marketing_lead_gen') return kickoffPmFieldsFromDraft(draft);
  return {};
}

export type KickoffSavedNarrative = Partial<Pick<KickoffDraft, KickoffNarrativeKey>> & {
  integrated_on_call?: boolean;
  slack_team_added?: boolean;
  facebook_access?: '' | 'granted' | 'follow_up';
};

export function kickoffNarrativeFromResponses(
  responses: Record<string, unknown> | null | undefined,
): KickoffSavedNarrative {
  const out: KickoffSavedNarrative = {};
  if (!responses) return out;
  for (const key of KICKOFF_NARRATIVE_KEYS) {
    const value = responses[key];
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  if (responses.integrated_on_call === true) out.integrated_on_call = true;
  if (responses.slack_team_added === true) out.slack_team_added = true;
  if (responses.facebook_access === 'granted' || responses.facebook_access === 'follow_up') {
    out.facebook_access = responses.facebook_access;
  }
  return out;
}

/** Fill brand / call-center narrative that is not stored on the client row. */
export function applyKickoffSavedNarrative(
  draft: KickoffDraft,
  saved: KickoffSavedNarrative | null | undefined,
): KickoffDraft {
  if (!saved) return draft;
  const next = { ...draft };
  for (const key of KICKOFF_NARRATIVE_KEYS) {
    const value = saved[key];
    if (typeof value === 'string' && value.trim() && !next[key].trim()) next[key] = value;
  }
  if (saved.integrated_on_call === true) next.integrated_on_call = true;
  if (saved.slack_team_added === true) next.slack_team_added = true;
  if (saved.facebook_access === 'granted' || saved.facebook_access === 'follow_up') {
    next.facebook_access = saved.facebook_access;
  }
  return next;
}

function yesNoLabel(value: string | boolean | null | undefined): string {
  if (value === true || value === 'yes') return 'Yes';
  if (value === false || value === 'no') return 'No';
  return '';
}

/** Full kick-off snapshot for Client notes. Null when every field is blank. */
export function kickoffClientFileNote(
  profile: OnboardingFormProfile,
  draft: KickoffDraft,
  includeRevenue = true,
): { marker: string; body: string } | null {
  const marker = profile === 'call_center' ? KICKOFF_CC_NOTE_MARKER : KICKOFF_PM_NOTE_MARKER;
  const sections: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text && text !== '—') sections.push({ label, value: text });
  };

  add('Client type', draft.reporting_type === 'RM' || draft.reporting_type === 'DSCR' ? draft.reporting_type : '');
  if (serviceProgramApplies(draft.reporting_type)) {
    add('System Type', kickoffSystemTypeLabel(draft.service_program) ?? '');
  }
  add('Lead Nurturing Host', draft.lead_nurturing_host);
  add('Team', draft.account_shape === 'team' ? 'Team' : draft.account_shape === 'solo' ? 'Solo' : '');
  if (draft.account_shape === 'team') add('Lead routing', draft.team_routing_notes);
  add('We qualify leads', draft.qualifies_leads === 'yes' ? 'Yes — dial qualified only' : draft.qualifies_leads === 'no' ? 'No — book every lead' : '');
  if (draft.qualifies_leads === 'yes') add('How we qualify', draft.qualification_notes);
  add('Brand colors', draft.brand_colors);
  add('Headshot', draft.headshot_url);
  add('Bio', draft.biography);
  if (resolveKickoffServiceProgram(draft.service_program) === 'core') {
    add('Booking hours', draft.booking_hours);
  }
  const role = storedContactRoleFromChoice(draft.contact_role_choice);
  add('Company owner or loan officer', role === 'Broker Owner' ? 'Company owner' : role === 'MLO' ? 'Loan officer' : draft.contact_role);
  if (draft.states_licensed.length) add('States licensed', formatStatesLicensed(draft.states_licensed));
  add('NMLS', draft.nmls);
  add('Brokerage', draft.brokerage_name);
  add('Timezone', draft.timezone);

  if (includeRevenue && isKickoffFieldVisible('daily_adspend', profile, includeRevenue)) {
    add('Daily ad spend', draft.daily_adspend.trim() ? `$${draft.daily_adspend.trim()}` : '');
  }
  if (isKickoffFieldVisible('facebook_page_name', profile, includeRevenue)) {
    add('Facebook page', draft.facebook_page_name);
  }
  if (isKickoffFieldVisible('phone_notifications', profile, includeRevenue)) {
    add('Notification number', draft.phone_notifications);
  }
  if (isKickoffFieldVisible('phone_live_transfer', profile, includeRevenue)) {
    add('Live transfer number', draft.phone_live_transfer);
    add('Live transfer approved', yesNoLabel(draft.live_transfer_approved));
  }

  for (const key of Object.keys(KICKOFF_PM_FIELD_LABELS) as (keyof typeof KICKOFF_PM_FIELD_LABELS)[]) {
    add(KICKOFF_PM_FIELD_LABELS[key], draft[key]);
  }
  add('Reviews', draft.reviews);
  add('Trust', draft.trust_notes);
  add('Stock criteria', draft.stock_criteria_url);
  if (draft.integrated_on_call) add('Integrated on the call', 'Yes');
  if (draft.facebook_access === 'granted') add('Facebook Business Manager', 'Granted');
  if (draft.facebook_access === 'follow_up') {
    add('Facebook Business Manager', 'Follow-up booked');
    add('Facebook follow-up', draft.facebook_follow_up_at);
  }
  add('Date signed', draft.date_signed);

  add('GHL sub-account name', draft.sub_account_name);
  add('GHL location ID', draft.ghl_location_id);
  add('OB call recording', draft.recording_url);

  const body = formatMarkedClientNote(marker, sections);
  return body ? { marker, body } : null;
}

export function kickoffDraftToBody(
  draft: KickoffDraft,
  canViewRevenue: boolean,
  saveMode: 'progress' | 'complete' = 'complete',
): Record<string, unknown> {
  const profile = getOnboardingFormProfile(draft.reporting_type, draft.service_program);
  const program = resolveKickoffServiceProgram(draft.service_program);
  const callCenter = program === 'core';
  const body: Record<string, unknown> = {
    save_mode: saveMode,
    reporting_type: draft.reporting_type,
    service_program: program,
    vertical_confirmed: draft.vertical_confirmed,
    sub_account_name: draft.sub_account_name.trim() || null,
    contact_role_choice: draft.contact_role_choice || null,
    states_licensed: draft.states_licensed,
    nmls: draft.nmls.trim() || null,
    brokerage_name: draft.brokerage_name.trim() || null,
    timezone: draft.timezone.trim() || null,
    ghl_location_id: draft.ghl_location_id.trim() || null,
    recording_url: draft.recording_url.trim() || null,
    transcript: draft.transcript.trim() || null,
    advance_lifecycle: draft.advance_lifecycle,
    lead_nurturing_host: draft.lead_nurturing_host || null,
    account_shape: draft.account_shape || null,
    team_routing_notes: draft.account_shape === 'team' ? draft.team_routing_notes.trim() || null : null,
    qualifies_leads: draft.qualifies_leads || null,
    qualification_notes: draft.qualifies_leads === 'yes' ? draft.qualification_notes.trim() || null : null,
    brand_colors: draft.brand_colors.trim() || null,
    headshot_url: draft.headshot_url.trim() || null,
    biography: draft.biography.trim() || null,
    reviews: draft.reviews.trim() || null,
    trust_notes: draft.trust_notes.trim() || null,
    stock_criteria_url: draft.stock_criteria_url.trim() || null,
    integrated_on_call: draft.lead_nurturing_host === 'internal' ? false : draft.integrated_on_call,
    facebook_access: draft.facebook_access || null,
    facebook_follow_up_at: draft.facebook_access === 'follow_up' ? draft.facebook_follow_up_at.trim() || null : null,
    slack_team_added: draft.slack_team_added,
    date_signed: draft.date_signed.trim() || null,
    phone_notifications: draft.phone_notifications.trim() || null,
  };

  if (callCenter) {
    body.phone_live_transfer = draft.phone_live_transfer.trim() || null;
    body.live_transfer_approved =
      draft.live_transfer_approved === 'yes'
        ? true
        : draft.live_transfer_approved === 'no'
          ? false
          : null;
    body.booking_hours = draft.booking_hours.trim() || null;
  }
  if (isKickoffFieldVisible('facebook_page_name', profile, canViewRevenue)) {
    body.facebook_page_name = draft.facebook_page_name.trim() || null;
  }
  if (canViewRevenue && isKickoffFieldVisible('daily_adspend', profile, canViewRevenue)) {
    body.daily_adspend = draft.daily_adspend.trim() || null;
  }

  Object.assign(body, kickoffPmFieldsFromDraft(draft));

  return body;
}

export function kickoffIdentitySlice(draft: KickoffDraft): Record<KickoffIdentityFieldKey, unknown> {
  return {
    contact_role: draft.contact_role,
    states_licensed: draft.states_licensed,
    nmls: draft.nmls,
    brokerage_name: draft.brokerage_name,
    timezone: draft.timezone,
  };
}

export const KICKOFF_CLICKUP_FIELDS = {
  kickoff_form: 'Submitted',
  ob_stage: 'In Build',
} as const;

export function formatKickoffClickUpComment(
  client: { id: string; name: string },
  draft: KickoffDraft,
): string {
  const lines = [
    '✅ Kickoff Form submitted',
    '',
    `Client (Mr. Waiz): ${client.name}`,
    `Mr. Waiz ID: ${client.id}`,
    'Kickoff Form: Submitted',
    'OB Stage: In Build',
  ];
  const add = (label: string, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text && text !== '—') lines.push(`${label}: ${text}`);
  };
  const note = kickoffClientFileNote(
    getOnboardingFormProfile(draft.reporting_type, draft.service_program),
    draft,
  );
  if (note) {
    for (const block of note.body.split('\n\n').slice(1)) {
      const [label, ...rest] = block.split('\n');
      const value = rest.join('\n').trim();
      if (label && value) add(label, value);
    }
  }
  return lines.join('\n');
}

export function isKickoffSetupResolved(draft: KickoffDraft): boolean {
  if (!draft.vertical_confirmed) return false;
  if (draft.reporting_type === 'CALL_CENTER') return false;
  return resolveKickoffServiceProgram(draft.service_program) != null;
}

export function facebookFollowUpError(draft: KickoffDraft, now = Date.now()): string | null {
  if (draft.facebook_access !== 'follow_up') return null;
  const when = Date.parse(draft.facebook_follow_up_at);
  if (!Number.isFinite(when)) return 'Facebook follow-up needs a time';
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const latest = startOfToday.getTime() + 4 * 24 * 60 * 60 * 1000;
  if (when < startOfToday.getTime() || when >= latest) {
    return 'Facebook follow-up must be within 3 days';
  }
  return null;
}
