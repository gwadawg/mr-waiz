// Launch checklist — stored in client_form_submissions.responses, not clients columns.

import {
  getOnboardingFormProfile,
  type OnboardingFormProfile,
} from '@/lib/onboarding-form-profile';
import { normalizeReportingType } from '@/lib/reporting-types';
import { normalizeServiceProgram } from '@/lib/service-program';

/** Live walkthrough sections. Older submissions still use the legacy section ids. */
export const LAUNCH_SECTIONS = [
  { id: 'tech', label: 'Tech spot check' },
] as const;

export type LaunchSectionId =
  | (typeof LAUNCH_SECTIONS)[number]['id']
  | 'flow'
  | 'account'
  | 'media_buying'
  | 'funnel'
  | 'ghl_subaccount'
  | 'admin';

export const LAUNCH_SECTION_LABELS: Record<LaunchSectionId, string> = {
  tech: 'Tech spot check',
  flow: 'Lead flow',
  account: 'Account',
  media_buying: 'Media Buying',
  funnel: 'Funnel',
  ghl_subaccount: 'GHL Subaccount',
  admin: 'Admin',
};

export type LaunchChecklistLink = {
  href: string;
  label: string;
};

export type LaunchChecklistItemDef = {
  key: string;
  label: string;
  section: LaunchSectionId;
  confirmType: 'checkbox' | 'type_yes' | 'evidence';
  /** Shown on evidence lines. The typed value is the proof, not the word yes. */
  evidencePrompt?: string;
  helpText?: string;
  links?: LaunchChecklistLink[];
  profiles?: OnboardingFormProfile[];
};

/** Ads-running accounts cannot fill the walkthrough until this is set. */
export const LAUNCH_ADS_READY = ['scheduled', 'published'] as const;
export type LaunchAdsReady = (typeof LAUNCH_ADS_READY)[number];

/** Designated AI Contact inbox for the launch text test. */
export const AI_CONTACT_TEST_INBOX_URL =
  'https://app.gohighlevel.com/v2/location/oUpd4eO1gisJSY1A49vP/conversations/conversations/q0KzN7xCasbmo94N2hRY?category=team-inbox&tab=all';
export const AI_CONTACT_TEST_PHONE_DISPLAY = '(949) 518-0137';
export const AI_CONTACT_TEST_PHONE_TEL = 'tel:+19495180137';

const ALL_PROFILES: OnboardingFormProfile[] = ['marketing_core', 'marketing_lead_gen', 'call_center'];

const AD_PROFILES: OnboardingFormProfile[] = ['marketing_core', 'marketing_lead_gen'];

export const LAUNCH_CHECKLIST_ITEMS: LaunchChecklistItemDef[] = [
  {
    key: 'tech_ads_budget',
    label: 'Ads are scheduled with the correct budget',
    section: 'tech',
    confirmType: 'evidence',
    evidencePrompt: 'Budget you saw on the scheduled campaign',
    helpText: 'The campaign is scheduled, not a draft, and the budget matches what this client bought. A plain yes does not count.',
    profiles: ALL_PROFILES,
  },
  {
    key: 'tech_make_scenario',
    label: 'The MAKE scenario is activated and a test run worked',
    section: 'tech',
    confirmType: 'evidence',
    evidencePrompt: 'Scenario name and what the test run did',
    helpText: 'The scenario that delivers this client’s leads is on, and you saw a test run succeed. Name the scenario.',
    profiles: ALL_PROFILES,
  },
  {
    key: 'tech_lead_end_to_end',
    label: 'A lead was tested from the front of the funnel to the end',
    section: 'tech',
    confirmType: 'evidence',
    evidencePrompt: 'Test lead name or phone, and where it landed',
    helpText: 'You sent one lead through the live path and saw it arrive at the end. Name that lead.',
    profiles: ALL_PROFILES,
  },
  {
    key: 'tech_launch_packet_sent',
    label: 'The launch packet was sent to the client',
    section: 'tech',
    confirmType: 'evidence',
    evidencePrompt: 'Where you sent the packet',
    helpText: 'Generated is not sent. The client has the packet. Name the channel.',
    profiles: ALL_PROFILES,
  },
  {
    key: 'tech_team_updated',
    label: 'The team was updated on this new client with the details',
    section: 'tech',
    confirmType: 'evidence',
    evidencePrompt: 'Channel you posted in, and what you told them',
    helpText: 'The update names the client, the offer, and what is live. Name the channel.',
    profiles: ALL_PROFILES,
  },
  {
    key: 'tech_funnel_pixel',
    label: 'The funnel pixel is set to the correct event',
    section: 'tech',
    confirmType: 'evidence',
    evidencePrompt: 'Pixel event you saw fire',
    helpText: 'You saw the pixel fire the conversion event this account uses. Name that event.',
    profiles: ALL_PROFILES,
  },
];

/** Previous spot check. Used only to read submissions already on file. */
const PRIOR_LAUNCH_CHECKLIST_ITEMS: LaunchChecklistItemDef[] = [
  {
    key: 'flow_ad_opens_funnel',
    label: 'The ad link opens the live funnel',
    section: 'flow',
    confirmType: 'checkbox',
    helpText: 'Spot check the destination only. Creative and the funnel build are already signed off.',
    profiles: AD_PROFILES,
  },
  {
    key: 'flow_lead_reaches_ghl',
    label: 'A lead from this ad reaches Go High Level',
    section: 'flow',
    confirmType: 'checkbox',
    helpText: 'The Facebook lead path is on. Do not go live if the ad can spend and the lead dies before GHL.',
    profiles: AD_PROFILES,
  },
  {
    key: 'flow_ai_contact_books',
    label: `Text ${AI_CONTACT_TEST_PHONE_DISPLAY} and the appointment books in the AI Contact inbox`,
    section: 'flow',
    confirmType: 'type_yes',
    helpText: 'Use the designated subaccount inbox. Send the text, then confirm the appointment is booked.',
    links: [
      { href: AI_CONTACT_TEST_INBOX_URL, label: 'Open the AI Contact inbox' },
      { href: AI_CONTACT_TEST_PHONE_TEL, label: `Text ${AI_CONTACT_TEST_PHONE_DISPLAY}` },
    ],
    profiles: ['marketing_core'],
  },
  {
    key: 'flow_appointment_on_calendar',
    label: 'That appointment is on the client calendar',
    section: 'flow',
    confirmType: 'checkbox',
    helpText: 'The booked test sits on the client’s calendar, assigned to the right user.',
    profiles: ['marketing_core'],
  },
  {
    key: 'flow_lead_gen_notified',
    label: 'A test lead lands in the client GHL and the client is notified',
    section: 'flow',
    confirmType: 'type_yes',
    helpText: 'Leads Only: the client works the lead. Confirm they actually get it.',
    profiles: ['marketing_lead_gen'],
  },
  {
    key: 'flow_cc_dial_books',
    label: 'A test lead can be dialed, qualified, and booked',
    section: 'flow',
    confirmType: 'type_yes',
    profiles: ['call_center'],
  },
  {
    key: 'acct_hp_tag',
    label: 'Client info was not overwritten, and the assigned user still has the HP tag',
    section: 'account',
    confirmType: 'type_yes',
    helpText: 'Do not change the client’s user. Confirm the assigned user still has the HP tag.',
    profiles: ['marketing_core', 'call_center'],
  },
  {
    key: 'acct_bonzo_new_lead',
    label: 'Make scenario "New Lead Bonzo" is active, and the queue is clear',
    section: 'account',
    confirmType: 'checkbox',
    profiles: ['call_center'],
  },
  {
    key: 'acct_bonzo_claimed',
    label: 'Make scenario "Claimed Bonzo" is active',
    section: 'account',
    confirmType: 'checkbox',
    profiles: ['call_center'],
  },
  {
    key: 'acct_records_filled',
    label: 'Mr. Waiz and ClickUp onboarding fields are filled out',
    section: 'account',
    confirmType: 'checkbox',
    profiles: ALL_PROFILES,
  },
];

/** Previous creative / media checklist. Used only to read submissions already on file. */
const LEGACY_LAUNCH_CHECKLIST_ITEMS: LaunchChecklistItemDef[] = [
  {
    key: 'mb_creative_message_aligned',
    label: 'Headline / primary text aligned with creative message',
    section: 'media_buying',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'mb_states_targeted',
    label: 'Correct states are being targeted',
    section: 'media_buying',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'mb_budget_set',
    label: 'Correct budget is set',
    section: 'media_buying',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'mb_midnight_schedule',
    label: 'Campaign scheduled for launch at midnight',
    section: 'media_buying',
    confirmType: 'type_yes',
    profiles: AD_PROFILES,
  },
  {
    key: 'mb_funnel_in_ad_live',
    label: 'Correct funnel is in the ad and tested funnel is live correctly',
    section: 'media_buying',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'fn_headline_congruent',
    label: 'Funnel headline congruent to ad message / angle',
    section: 'funnel',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'fn_split_test_headlines',
    label: 'Split test between two headlines is on',
    section: 'funnel',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'fn_pixel_conversion_event',
    label: 'Pixel data working with correct conversion event',
    section: 'funnel',
    confirmType: 'type_yes',
    profiles: AD_PROFILES,
  },
  {
    key: 'fn_ghl_integrated',
    label: 'GHL subaccount correctly integrated',
    section: 'funnel',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'fn_privacy_compliant_footer',
    label: 'Privacy policy and compliant footer added',
    section: 'funnel',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'fn_sms_compliant_checkbox',
    label: "Compliant checkbox for sending SMS with client's name",
    section: 'funnel',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'ghl_client_info_not_updated',
    label: 'Client info NOT updated — client assigned user with HP tag (call center model)',
    section: 'ghl_subaccount',
    confirmType: 'type_yes',
    profiles: ['marketing_core', 'call_center'],
  },
  {
    key: 'ghl_custom_values_filled',
    label: 'Custom values all filled out',
    section: 'ghl_subaccount',
    confirmType: 'checkbox',
    profiles: ALL_PROFILES,
  },
  {
    key: 'ghl_calendar_assigned',
    label: 'Calendar assigned to correct user',
    section: 'ghl_subaccount',
    confirmType: 'checkbox',
    profiles: ALL_PROFILES,
  },
  {
    key: 'ghl_a2p_approved',
    label: 'A2P approved',
    section: 'ghl_subaccount',
    confirmType: 'type_yes',
    profiles: ALL_PROFILES,
  },
  {
    key: 'adm_mrw_clickup_complete',
    label: 'Mr. Waiz and ClickUp fields fully filled out',
    section: 'admin',
    confirmType: 'checkbox',
    profiles: ALL_PROFILES,
  },
  {
    key: 'adm_make_facebook_active',
    label: 'Make scenario for Facebook is active',
    section: 'admin',
    confirmType: 'checkbox',
    profiles: AD_PROFILES,
  },
  {
    key: 'adm_full_test_lead_flow',
    label: 'Full test lead executed: perspective → SMS → AI booking → appointment booked',
    section: 'admin',
    confirmType: 'type_yes',
    profiles: ['marketing_core'],
  },
  {
    key: 'lg_test_lead_flow',
    label: 'Full test executed: ad → landing → lead in GHL → client notified',
    section: 'admin',
    confirmType: 'type_yes',
    profiles: ['marketing_lead_gen'],
  },
  {
    key: 'cc_test_lead_flow',
    label: 'Full test executed: lead ingested → setter dial → qualified → appointment booked',
    section: 'admin',
    confirmType: 'type_yes',
    profiles: ['call_center'],
  },
  {
    key: 'cc_make_new_lead_bonzo_active',
    label: 'Make scenario "New Lead Bonzo" is active, and the leads in queue cleared',
    section: 'admin',
    confirmType: 'checkbox',
    profiles: ['call_center'],
  },
  {
    key: 'cc_make_claimed_bonzo_active',
    label: 'Make scenario "Claimed Bonzo" is active',
    section: 'admin',
    confirmType: 'checkbox',
    profiles: ['call_center'],
  },
];

export type LaunchChecklistKey = (typeof LAUNCH_CHECKLIST_ITEMS)[number]['key'];

export const LAUNCH_FINAL_CONFIRMATION = 'LAUNCH';

export type LaunchFormDraft = {
  launch_date: string;
  completed_by_user_id: string;
  completed_by_label: string;
  /** GHL subaccount phone we prospect with — written to clients.phone_ghl on launch. */
  phone_ghl: string;
  /** Required before the walkthrough can be filled on ad-running accounts. */
  ads_ready: LaunchAdsReady | '';
  recording_url: string;
  transcript: string;
  notes: string;
  checklist: Record<string, boolean>;
  confirmations: Record<string, string>;
  final_confirmation: string;
};

export function itemAppliesToProfile(
  item: LaunchChecklistItemDef,
  profile: OnboardingFormProfile,
): boolean {
  if (!item.profiles) return profile === 'marketing_core';
  return item.profiles.includes(profile);
}

export function getLaunchItemsForProfile(profile: OnboardingFormProfile): LaunchChecklistItemDef[] {
  return LAUNCH_CHECKLIST_ITEMS.filter(item => itemAppliesToProfile(item, profile));
}

function priorLaunchItemsForProfile(profile: OnboardingFormProfile): LaunchChecklistItemDef[] {
  return PRIOR_LAUNCH_CHECKLIST_ITEMS.filter(item => itemAppliesToProfile(item, profile));
}

function legacyLaunchItemsForProfile(profile: OnboardingFormProfile): LaunchChecklistItemDef[] {
  return LEGACY_LAUNCH_CHECKLIST_ITEMS.filter(item => itemAppliesToProfile(item, profile));
}

export function isLaunchAdsReady(value: unknown): value is LaunchAdsReady {
  return value === 'scheduled' || value === 'published';
}

export function launchAdsReadyLabel(value: LaunchAdsReady): string {
  return value === 'scheduled' ? 'Scheduled' : 'Published';
}

export function launchWalkthroughBlurb(_profile?: OnboardingFormProfile): string {
  return 'The client and CSM already ran the earlier forms. Spot-check the tech path. Each line needs the detail you saw. A plain yes does not count.';
}

export function getLaunchSectionsForProfile(profile: OnboardingFormProfile) {
  return sectionsForItems(getLaunchItemsForProfile(profile));
}

export function sectionsForItems(items: LaunchChecklistItemDef[]) {
  const seen: LaunchSectionId[] = [];
  for (const item of items) {
    if (!seen.includes(item.section)) seen.push(item.section);
  }
  return seen.map(id => ({ id, label: LAUNCH_SECTION_LABELS[id] }));
}

function checklistKeys(responses: Record<string, unknown>): string[] {
  const raw = responses.checklist;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw as Record<string, unknown>);
}

/** Current tech spot check, unless this submission was filed on an older checklist. */
export function itemsForLaunchResponses(
  responses: Record<string, unknown>,
  profileOverride?: OnboardingFormProfile,
): LaunchChecklistItemDef[] {
  const profile = profileOverride ?? profileFromLaunchResponses(responses);
  const live = getLaunchItemsForProfile(profile);
  const keys = checklistKeys(responses);
  const liveKeys = new Set(live.map(item => item.key));
  if (keys.some(key => liveKeys.has(key)) || keys.length === 0) return live;

  const prior = priorLaunchItemsForProfile(profile);
  const priorKeys = new Set(prior.map(item => item.key));
  if (keys.some(key => priorKeys.has(key)) || isLaunchAdsReady(responses.ads_ready)) return prior;

  const legacy = legacyLaunchItemsForProfile(profile);
  const legacyKeys = new Set(legacy.map(item => item.key));
  if (keys.some(key => legacyKeys.has(key))) return legacy;
  return live;
}

export function profileFromLaunchResponses(responses: Record<string, unknown>): OnboardingFormProfile {
  const stored = responses.form_profile;
  if (
    stored === 'marketing_core' ||
    stored === 'marketing_lead_gen' ||
    stored === 'call_center'
  ) {
    return stored;
  }
  return getOnboardingFormProfile(responses.reporting_type, responses.service_program);
}

export function profileFromClient(client: {
  reporting_type?: unknown;
  service_program?: unknown;
}): OnboardingFormProfile {
  return getOnboardingFormProfile(client.reporting_type, client.service_program);
}

export function emptyLaunchDraft(
  profile: OnboardingFormProfile = 'marketing_core',
  launchDate = '',
  completedByUserId = '',
  completedByLabel = '',
  phoneGhl = '',
): LaunchFormDraft {
  const checklist: Record<string, boolean> = {};
  const confirmations: Record<string, string> = {};
  for (const item of getLaunchItemsForProfile(profile)) {
    checklist[item.key] = false;
    if (item.confirmType === 'type_yes' || item.confirmType === 'evidence') confirmations[item.key] = '';
  }
  return {
    launch_date: launchDate || new Date().toISOString().slice(0, 10),
    completed_by_user_id: completedByUserId,
    completed_by_label: completedByLabel,
    phone_ghl: phoneGhl,
    ads_ready: '',
    recording_url: '',
    transcript: '',
    notes: '',
    checklist,
    confirmations,
    final_confirmation: '',
  };
}

export function isTypedYes(value: string): boolean {
  return value.trim().toLowerCase() === 'yes';
}

const LAUNCH_RUBBER_STAMP = new Set([
  'yes', 'y', 'ok', 'okay', 'done', 'checked', 'check', 'complete', 'completed',
  'na', 'pass', 'passed', 'good', 'true', 'confirmed', 'yup', 'yeah', 'yep',
  'sure', 'correct', 'right', 'launch',
]);

/** Proof typed on a spot check. A plain yes, or the word LAUNCH, does not count. */
export function isSubstantiveLaunchEvidence(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized.length >= 3 && !LAUNCH_RUBBER_STAMP.has(normalized);
}

export function isLaunchItemSatisfied(item: LaunchChecklistItemDef, draft: LaunchFormDraft): boolean {
  if (!draft.checklist[item.key]) return false;
  if (item.confirmType === 'type_yes') {
    return isTypedYes(draft.confirmations[item.key] ?? '');
  }
  if (item.confirmType === 'evidence') {
    return isSubstantiveLaunchEvidence(draft.confirmations[item.key] ?? '');
  }
  return true;
}

export function countSatisfiedItems(
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile = 'marketing_core',
): number {
  return getLaunchItemsForProfile(profile).filter(item => isLaunchItemSatisfied(item, draft)).length;
}

export function countSatisfiedInSection(
  sectionId: LaunchSectionId,
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile = 'marketing_core',
): { satisfied: number; total: number } {
  const items = getLaunchItemsForProfile(profile).filter(item => item.section === sectionId);
  return {
    satisfied: items.filter(item => isLaunchItemSatisfied(item, draft)).length,
    total: items.length,
  };
}

export function isLaunchChecklistComplete(
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile = 'marketing_core',
): boolean {
  if (!draft.launch_date.trim()) return false;
  if (!draft.completed_by_user_id.trim()) return false;
  if (draft.final_confirmation.trim().toUpperCase() !== LAUNCH_FINAL_CONFIRMATION) return false;
  return getLaunchItemsForProfile(profile).every(item => isLaunchItemSatisfied(item, draft));
}

export function getFirstIncompleteItemKey(
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile = 'marketing_core',
): string | null {
  for (const item of getLaunchItemsForProfile(profile)) {
    if (!isLaunchItemSatisfied(item, draft)) return item.key;
  }
  return null;
}

export function launchDraftToResponses(
  draft: LaunchFormDraft,
  meta?: {
    reporting_type?: string;
    service_program?: string | null;
    form_profile?: OnboardingFormProfile;
  },
): Record<string, unknown> {
  return {
    launch_date: draft.launch_date,
    completed_by_user_id: draft.completed_by_user_id,
    completed_by_label: draft.completed_by_label.trim() || null,
    phone_ghl: draft.phone_ghl.trim() || null,
    ads_ready: isLaunchAdsReady(draft.ads_ready) ? draft.ads_ready : null,
    recording_url: draft.recording_url.trim() || null,
    transcript: draft.transcript.trim() || null,
    notes: draft.notes.trim() || null,
    checklist: draft.checklist,
    confirmations: draft.confirmations,
    final_confirmation: draft.final_confirmation.trim().toUpperCase(),
    ...(meta?.reporting_type != null ? { reporting_type: meta.reporting_type } : {}),
    ...(meta?.service_program !== undefined ? { service_program: meta.service_program } : {}),
    ...(meta?.form_profile ? { form_profile: meta.form_profile } : {}),
  };
}

export function launchResponsesToDraft(
  responses: Record<string, unknown>,
  profileOverride?: OnboardingFormProfile,
): LaunchFormDraft {
  const profile = profileOverride ?? profileFromLaunchResponses(responses);
  const items = itemsForLaunchResponses(responses, profile);
  const draft = emptyLaunchDraft(
    profile,
    typeof responses.launch_date === 'string' ? responses.launch_date : undefined,
    typeof responses.completed_by_user_id === 'string' ? responses.completed_by_user_id : '',
    typeof responses.completed_by_label === 'string' ? responses.completed_by_label : '',
    typeof responses.phone_ghl === 'string' ? responses.phone_ghl : '',
  );
  draft.ads_ready = isLaunchAdsReady(responses.ads_ready) ? responses.ads_ready : '';
  draft.recording_url = typeof responses.recording_url === 'string' ? responses.recording_url : '';
  draft.transcript = typeof responses.transcript === 'string' ? responses.transcript : '';
  draft.notes = typeof responses.notes === 'string' ? responses.notes : '';
  draft.final_confirmation =
    typeof responses.final_confirmation === 'string' ? responses.final_confirmation : '';
  draft.checklist = {};
  draft.confirmations = {};

  const rawChecklist = responses.checklist;
  if (rawChecklist && typeof rawChecklist === 'object') {
    for (const item of items) {
      draft.checklist[item.key] = !!(rawChecklist as Record<string, boolean>)[item.key];
    }
  }

  const rawConfirmations = responses.confirmations;
  if (rawConfirmations && typeof rawConfirmations === 'object') {
    for (const item of items) {
      if (item.confirmType === 'type_yes' || item.confirmType === 'evidence') {
        const val = (rawConfirmations as Record<string, string>)[item.key];
        draft.confirmations[item.key] = typeof val === 'string' ? val : '';
      }
    }
  }

  return draft;
}

export function launchChecklistSummary(responses: Record<string, unknown>): string[] {
  const draft = launchResponsesToDraft(responses);
  return itemsForLaunchResponses(responses)
    .filter(item => isLaunchItemSatisfied(item, draft))
    .map(item => item.label);
}

export const LAUNCH_CLIENT_NOTE_MARKER = 'Launch checklist';

/** Every launch answer, including checklist rows and the call transcript. */
export function launchClientFileNoteSections(
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile,
): { label: string; value: string }[] {
  const sections: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text) sections.push({ label, value: text });
  };

  add('Launch date', draft.launch_date);
  add('Completed by', draft.completed_by_label);
  add('GHL prospecting phone', draft.phone_ghl);
  if (isLaunchAdsReady(draft.ads_ready)) add('Ads', launchAdsReadyLabel(draft.ads_ready));
  add('Launch call recording', draft.recording_url);
  add('Launch call transcript', draft.transcript);
  add('Notes', draft.notes);

  for (const section of getLaunchSectionsForProfile(profile)) {
    const items = getLaunchItemsForProfile(profile).filter(item => item.section === section.id);
    for (const item of items) {
      const status = formatLaunchItemStatus(item, draft);
      const proof = (draft.confirmations[item.key] ?? '').trim();
      const value =
        status === 'confirmed_evidence'
          ? proof
          : status === 'confirmed_typed_yes'
            ? 'Confirmed (typed yes)'
            : status === 'confirmed'
              ? 'Confirmed'
              : 'Not confirmed';
      sections.push({ label: `${section.label} — ${item.label}`, value });
    }
  }

  return sections;
}

export function formatLaunchItemStatus(
  item: LaunchChecklistItemDef,
  draft: LaunchFormDraft,
): 'confirmed' | 'confirmed_typed_yes' | 'confirmed_evidence' | 'missing' {
  if (!isLaunchItemSatisfied(item, draft)) return 'missing';
  if (item.confirmType === 'evidence') return 'confirmed_evidence';
  if (item.confirmType === 'type_yes') return 'confirmed_typed_yes';
  return 'confirmed';
}

export const LAUNCH_FORM_CLICKUP_KEY = 'launch_form';
export const LAUNCH_FORM_CLICKUP_VALUE = 'Submitted';

export function formatLaunchClickUpComment(
  client: { id: string; name: string },
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile,
): string {
  const responses = launchDraftToResponses(draft, { form_profile: profile });
  return [
    '✅ Launch Form submitted',
    '',
    `Client (Mr. Waiz): ${client.name}`,
    `Mr. Waiz ID: ${client.id}`,
    `Completed by: ${draft.completed_by_label.trim() || '—'}`,
    `Launch date: ${draft.launch_date}`,
    ...(draft.recording_url.trim() ? [`Recording: ${draft.recording_url.trim()}`] : []),
    '',
    formatLaunchSlackChecklist(responses),
  ].join('\n');
}

export function formatLaunchSlackChecklist(responses: Record<string, unknown>): string {
  const draft = launchResponsesToDraft(responses);
  const items = itemsForLaunchResponses(responses);
  const lines: string[] = [];
  if (isLaunchAdsReady(draft.ads_ready)) {
    lines.push(`Ads: ${launchAdsReadyLabel(draft.ads_ready)}`, '');
  }

  for (const section of sectionsForItems(items)) {
    lines.push(section.label);
    const sectionItems = items.filter(item => item.section === section.id);
    for (const item of sectionItems) {
      const status = formatLaunchItemStatus(item, draft);
      if (status === 'missing') {
        lines.push(`  — ${item.label}`);
      } else if (status === 'confirmed_evidence') {
        const proof = (draft.confirmations[item.key] ?? '').trim();
        lines.push(`  ✓ ${item.label}: ${proof}`);
      } else if (status === 'confirmed_typed_yes') {
        lines.push(`  ✓ ${item.label} (typed yes)`);
      } else {
        lines.push(`  ✓ ${item.label}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function getLaunchChecklistConfig(profile: OnboardingFormProfile = 'marketing_core') {
  return {
    profile,
    sections: getLaunchSectionsForProfile(profile),
    items: getLaunchItemsForProfile(profile),
  };
}

export function inferLaunchProfileFromResponses(responses: Record<string, unknown>): OnboardingFormProfile {
  if (responses.form_profile) return profileFromLaunchResponses(responses);
  const vertical = normalizeReportingType(responses.reporting_type);
  const program = normalizeServiceProgram(responses.service_program);
  if (vertical || program) {
    return getOnboardingFormProfile(vertical, program);
  }
  return 'marketing_core';
}
