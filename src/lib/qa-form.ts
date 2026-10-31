import { latestReinstateCutoffIso, mapCycleProgress } from '@/lib/reinstate-progress';
import { usesCallCenterKpiLayout } from '@/lib/reporting-types';

export const QA_SKELETON_VERSION = 'qa-skeleton-v0';
export const QA_FINAL_CONFIRMATION = 'QA';

/**
 * Creative QA has no fixed ClickUp key in code. Submit writes one of these
 * only when that key is already present in CLICKUP_OB_FIELD_MAP.
 */
export const CREATIVE_QA_FIELD_KEYS = ['creative_qa', 'creative'] as const;

/** Same onboarding window as kickoff / launch. QA is not a live-account action. */
export function isQaLifecycle(status: string | null | undefined): boolean {
  return status === 'new_account' || status === 'onboarding';
}

export type QaFormType = 'tech_qa' | 'marketing_qa' | 'creative';

export function isQaCompleteForCycle(
  rows: Array<{ form_type: string; submitted_at: string; status?: string }>,
  formType: QaFormType,
): boolean {
  return !!mapCycleProgress(rows, latestReinstateCutoffIso(rows))[formType];
}

export type QaLane = 'tech_setup' | 'media_buying' | 'creative';

export type QaChecklistItemDef = {
  key: string;
  label: string;
  helpText?: string;
  section?: string;
};

export type QaLinkDef = {
  key: string;
  label: string;
  section: string;
  readOnly: boolean;
  helpText?: string;
};

export type QaFormConfig = {
  lane: QaLane;
  formType: QaFormType;
  /** Null when the ClickUp key is resolved from the field map at submit time. */
  clickupFieldKey: 'tech_qa' | 'marketing_qa' | null;
  title: string;
  shortLabel: string;
  description: string;
  ownerLabel: string;
  items: QaChecklistItemDef[];
  links: QaLinkDef[];
  /** Tech and Media require every line. Creative can leave a line off. */
  requireEveryItem: boolean;
  /** Creative stores only confirmed lines. Unchecked lines are omitted. */
  omitUnchecked: boolean;
};

export type QaFormDraft = {
  completed_by_label: string;
  checklist: Record<string, boolean>;
  links: Record<string, string>;
  evidence: string;
  blockers: string;
  notes: string;
  final_confirmation: string;
};

export const QA_FORM_CONFIGS: Record<QaLane, QaFormConfig> = {
  tech_setup: {
    lane: 'tech_setup',
    formType: 'tech_qa',
    clickupFieldKey: 'tech_qa',
    title: 'Tech Setup QA',
    shortLabel: 'Tech QA',
    ownerLabel: 'Tech / VA',
    description:
      'Skeleton QA gate for A2P, GHL, routing, phone, and Closebot readiness. This closes the Tech QA fact for ClickUp automation testing.',
    requireEveryItem: true,
    omitUnchecked: false,
    links: [],
    items: [
      {
        key: 'a2p_status_checked',
        label: 'A2P status checked and any dependency is noted',
      },
      {
        key: 'ghl_subaccount_ready',
        label: 'GHL subaccount, custom values, calendar, and routing basics reviewed',
      },
      {
        key: 'phone_and_notifications_checked',
        label: 'Prospecting, notification, and live-transfer phone paths checked where applicable',
      },
      {
        key: 'closebot_or_booking_path_checked',
        label: 'Closebot / booking path reviewed or marked not applicable',
      },
      {
        key: 'no_unresolved_launch_blocker',
        label: 'No unresolved tech blocker remains for launch review',
        helpText: 'If something is still open, do not submit this QA. Note the blocker on the ClickUp lane task instead.',
      },
    ],
  },
  media_buying: {
    lane: 'media_buying',
    formType: 'marketing_qa',
    clickupFieldKey: 'marketing_qa',
    title: 'Media Buying QA',
    shortLabel: 'Media QA',
    ownerLabel: 'Media Buyer',
    description:
      'Skeleton QA gate for media buying and funnel readiness. This closes the Marketing QA fact for ClickUp automation testing.',
    requireEveryItem: true,
    omitUnchecked: false,
    links: [],
    items: [
      {
        key: 'ad_access_confirmed',
        label: 'Ad account, page, pixel, and required access reviewed',
      },
      {
        key: 'funnel_link_checked',
        label: 'Funnel link is present, opens correctly, and matches the intended offer',
      },
      {
        key: 'campaign_structure_ready',
        label: 'Campaign/ad set structure is prepared for launch review',
      },
      {
        key: 'creative_and_copy_reviewed',
        label: 'Creative, copy, naming, and compliance language received a launch-readiness pass',
      },
      {
        key: 'no_unresolved_marketing_blocker',
        label: 'No unresolved marketing blocker remains for launch review',
        helpText: 'If ads, funnel, or access are still blocked, leave QA pending and note the blocker in ClickUp.',
      },
    ],
  },
  creative: {
    lane: 'creative',
    formType: 'creative',
    clickupFieldKey: null,
    title: 'Creative QA',
    shortLabel: 'Creative QA',
    ownerLabel: 'Creative',
    description:
      'Confirm creative builds and the Perspective funnel. Leave a checklist line unchecked when it does not apply. This form is separate from Media Buying QA.',
    requireEveryItem: false,
    omitUnchecked: true,
    links: [
      {
        key: 'perspective_funnel_link',
        label: 'Perspective funnel link',
        section: 'Funnel',
        readOnly: false,
        helpText: 'Saved on the client as the Perspective funnel link.',
      },
      {
        key: 'apex_funnel_link',
        label: 'Apex funnel link',
        section: 'Funnel',
        readOnly: true,
        helpText: 'Read-only. Published as {site}/{slug}/. That publish also writes this URL onto the Perspective funnel link column.',
      },
      {
        key: 'thank_you_link',
        label: 'Thank-you link',
        section: 'Funnel',
        readOnly: true,
        helpText: 'Read-only from the thank-you page on file ({site}/{slug}/thank-you).',
      },
    ],
    items: [
      {
        key: 'ads_uploaded_to_client_drive',
        label: 'Ads uploaded to the client drive',
        section: 'Creatives',
      },
      {
        key: 'fine_line_includes_nmls',
        label: 'Client name / business name fine line includes the NMLS#',
        section: 'Creatives',
      },
      {
        key: 'offer_and_message_clean',
        label: 'Offer and message make sense and have no typos',
        section: 'Creatives',
      },
      {
        key: 'perspective_footer_privacy',
        label: 'Perspective footer has the correct privacy policy and legal notice',
        section: 'Funnel',
      },
      {
        key: 'client_bio_clean',
        label: 'Client bio is clean and makes sense',
        section: 'Funnel',
      },
      {
        key: 'brand_colors_align',
        label: 'Brand colors align from WM Apex to Perspective',
        section: 'Funnel',
      },
      {
        key: 'perspective_pixel',
        label: 'Correct pixel on the Perspective account',
        section: 'Funnel',
      },
      {
        key: 'highlevel_integration',
        label: 'HighLevel integration complete',
        section: 'Funnel',
      },
      {
        key: 'opt_in_client_name',
        label: 'Opt-in language uses the client name',
        section: 'Funnel',
      },
      {
        key: 'perspective_url_offer',
        label: 'Correct URL on Perspective (DSCR vs retirement experts)',
        section: 'Funnel',
      },
    ],
  },
};

export function isQaLane(value: string): value is QaLane {
  return value === 'tech_setup' || value === 'media_buying' || value === 'creative';
}

export function getQaFormConfig(lane: QaLane): QaFormConfig {
  return QA_FORM_CONFIGS[lane];
}

/**
 * ClickUp custom-field key for this submit.
 * Tech and Media always use their fixed keys.
 * Creative uses creative_qa or creative only when that key is already in the field map.
 */
export function resolveQaClickUpFieldKey(
  config: QaFormConfig,
  fieldMap: Record<string, unknown>,
): string | null {
  if (config.formType !== 'creative') return config.clickupFieldKey;
  for (const key of CREATIVE_QA_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fieldMap, key)) return key;
  }
  return null;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function linkMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key, value.trim()]),
  );
}

/** Body posted by the QA wizard. Unchecked boxes stay false here; storage omits them for Creative. */
export function qaDraftFromSubmitBody(body: Record<string, unknown>): QaFormDraft {
  const rawChecklist = body.checklist;
  return {
    completed_by_label: optionalText(body.completed_by_label),
    checklist:
      rawChecklist && typeof rawChecklist === 'object' && !Array.isArray(rawChecklist)
        ? Object.fromEntries(
            Object.entries(rawChecklist as Record<string, unknown>).map(([key, value]) => [key, value === true]),
          )
        : {},
    links: linkMap(body.links),
    evidence: optionalText(body.evidence),
    blockers: optionalText(body.blockers),
    notes: optionalText(body.notes),
    final_confirmation: optionalText(body.final_confirmation),
  };
}

/** Server-owned funnel links. Apex and thank-you ignore whatever the browser posted. */
export function sealCreativeFunnelLinks(
  draft: QaFormDraft,
  sources: { perspective: string; apex: string | null; thankYou: string | null },
): QaFormDraft {
  return {
    ...draft,
    links: {
      ...draft.links,
      perspective_funnel_link: sources.perspective.trim(),
      apex_funnel_link: sources.apex?.trim() ?? '',
      thank_you_link: sources.thankYou?.trim() ?? '',
    },
  };
}

export function emptyQaFormDraft(config: QaFormConfig, completedByLabel = ''): QaFormDraft {
  return {
    completed_by_label: completedByLabel,
    checklist: Object.fromEntries(config.items.map(item => [item.key, false])),
    links: Object.fromEntries((config.links ?? []).map(link => [link.key, ''])),
    evidence: '',
    blockers: '',
    notes: '',
    final_confirmation: '',
  };
}

export function isQaChecklistComplete(draft: QaFormDraft, config: QaFormConfig): boolean {
  if (!draft.completed_by_label.trim()) return false;
  if (draft.final_confirmation.trim().toUpperCase() !== QA_FINAL_CONFIRMATION) return false;
  if (!config.requireEveryItem) return true;
  return config.items.every(item => draft.checklist[item.key] === true);
}

export function getFirstIncompleteQaItemKey(
  draft: QaFormDraft,
  config: QaFormConfig,
): string | null {
  if (!config.requireEveryItem) return null;
  for (const item of config.items) {
    if (draft.checklist[item.key] !== true) return item.key;
  }
  return null;
}

function storedChecklist(draft: QaFormDraft, config: QaFormConfig): Record<string, boolean> {
  if (!config.omitUnchecked) return draft.checklist;
  const stored: Record<string, boolean> = {};
  for (const item of config.items) {
    if (draft.checklist[item.key] === true) stored[item.key] = true;
  }
  return stored;
}

function storedLinks(draft: QaFormDraft, config: QaFormConfig): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const link of config.links) {
    const value = draft.links[link.key]?.trim() ?? '';
    if (value) stored[link.key] = value;
  }
  return stored;
}

export function qaDraftToResponses(
  draft: QaFormDraft,
  config: QaFormConfig,
): Record<string, unknown> {
  return {
    qa_lane: config.lane,
    skeleton_version: QA_SKELETON_VERSION,
    completed_by_label: draft.completed_by_label.trim(),
    checklist: storedChecklist(draft, config),
    ...(config.links.length > 0 ? { links: storedLinks(draft, config) } : {}),
    evidence: draft.evidence.trim() || null,
    blockers: draft.blockers.trim() || null,
    notes: draft.notes.trim() || null,
    final_confirmation: draft.final_confirmation.trim().toUpperCase(),
  };
}

export function formatQaClickUpComment(
  client: { id: string; name: string },
  config: QaFormConfig,
  draft: QaFormDraft,
): string {
  const confirmed = config.omitUnchecked
    ? config.items.filter(item => draft.checklist[item.key] === true)
    : config.items;
  const linkLines = config.links
    .map(link => {
      const value = draft.links[link.key]?.trim() ?? '';
      return value ? `${link.label}: ${value}` : '';
    })
    .filter(Boolean);
  const lines = [
    `✅ ${config.title} submitted`,
    '',
    `Client (Mr. Waiz): ${client.name}`,
    `Mr. Waiz ID: ${client.id}`,
    `Skeleton: ${QA_SKELETON_VERSION}`,
    `Completed by: ${draft.completed_by_label.trim() || '—'}`,
    '',
    ...(linkLines.length > 0 ? ['— Links —', ...linkLines, ''] : []),
    '— Checklist —',
    ...confirmed.map(item => `✓ ${item.label}`),
  ];

  const evidence = draft.evidence.trim();
  const blockers = draft.blockers.trim();
  const notes = draft.notes.trim();

  if (evidence) lines.push('', '— Evidence —', evidence);
  if (blockers) lines.push('', '— Blockers / exceptions —', blockers);
  if (notes) lines.push('', '— Notes —', notes);

  return lines.join('\n');
}
/** Ads QA the media buyer fills after the build. Not the five-line skeleton. */
export const MEDIA_QA_VERSION = 'media-buying-qa-v1';

export type MediaQaItem = {
  key: string;
  number: string;
  label: string;
  helpText: string;
  required: boolean;
  /** Rendered once, above the first item in the group. */
  groupLabel?: string;
};

export const MEDIA_QA_ITEMS: MediaQaItem[] = [
  {
    key: 'dummy_account',
    number: '2',
    label: 'Dummy account setup with a $5 budget',
    helpText: 'A dummy ad account exists and its budget is $5. A live campaign set to $5 does not count. This box does not save a dollar amount.',
    required: false,
  },
  {
    key: 'states_targeted',
    number: '3',
    label: 'Correct states being targeted',
    helpText: 'Locations on the ad set match the licensed states already on the client file. You are not typing a new state list.',
    required: false,
  },
  {
    key: 'placements',
    number: '4',
    label: 'Only targeting feeds, stories, and reels',
    helpText: 'The ad set placements are only feeds, stories, and reels.',
    required: false,
  },
  {
    key: 'title_matches_creative',
    number: '5',
    label: 'Title for the ad matches the creative',
    helpText: 'The ad title matches the words on the creative (the image or video). This is not the headline field. Headlines are check 6.',
    required: false,
  },
  {
    key: 'headlines_and_primary',
    number: '6',
    label: '2 headlines and 2 primary text',
    helpText: 'Two headline fields are filled and two primary text fields are filled. One of each is not done.',
    required: false,
  },
  {
    key: 'fb_profile_pic',
    number: '7',
    label: 'Profile picture is up',
    helpText: 'The page shows a real profile photo. A blank or default image is not done.',
    required: true,
    groupLabel: 'Facebook page updated with profile pic, description, and banner',
  },
  {
    key: 'fb_description',
    number: '7',
    label: 'Page description is written',
    helpText: 'The Facebook page About / description is filled in. This is the page, not the ad description in check 11.',
    required: true,
  },
  {
    key: 'fb_banner',
    number: '7',
    label: 'Banner is up',
    helpText: 'The page cover image is set. A bare cover is not done.',
    required: true,
  },
  {
    key: 'utm_placed',
    number: '8',
    label: 'UTM accurately placed',
    helpText: 'The website URL on the ad includes UTM tags, and those tags are for this client. No UTM template is stored on the client, so you are checking the URL on the ad.',
    required: true,
  },
  {
    key: 'make_subaccount_name',
    number: '9',
    label: 'MAKE scenario uses the exact sub-account name in the node',
    helpText: 'The Make node text is the exact sub-account name on the client file. Same spelling and spacing. Not a nickname.',
    required: true,
  },
  {
    key: 'creative_matches_headline',
    number: '10',
    label: 'Creative matches the funnel headline',
    helpText: 'The headline on the creative is the same sentence as the funnel headline. This box does not collect the funnel link.',
    required: false,
  },
  {
    key: 'ad_description_identity',
    number: '11',
    label: 'NMLS, full name, and business name in the ad description',
    helpText: 'The ad description field shows the NMLS number, the client’s full name, and the business name. This is the ad, not the Facebook page description in check 7.',
    required: false,
  },
];

export type MediaQaDraft = {
  completed_by_label: string;
  ad_account_url: string;
  ad_account_skipped: boolean;
  done: Record<string, boolean>;
  skipped: Record<string, boolean>;
  final_confirmation: string;
};

/** Call-center lead product (no ad-gen) does not fill this pass. */
export function mediaBuyingQaApplies(reportingType: unknown): boolean {
  if (reportingType == null || String(reportingType).trim() === '') return true;
  return !usesCallCenterKpiLayout(reportingType);
}

export function emptyMediaQaDraft(completedByLabel = '', adAccountUrl = ''): MediaQaDraft {
  return {
    completed_by_label: completedByLabel,
    ad_account_url: adAccountUrl,
    ad_account_skipped: false,
    done: {},
    skipped: {},
    final_confirmation: '',
  };
}

export function normalizeAdAccountUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function flagMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, flag]) => [key, flag === true]),
  );
}

export function parseMediaQaBody(body: Record<string, unknown>): MediaQaDraft {
  return {
    completed_by_label: typeof body.completed_by_label === 'string' ? body.completed_by_label.trim() : '',
    ad_account_url: typeof body.ad_account_url === 'string' ? body.ad_account_url.trim() : '',
    ad_account_skipped: body.ad_account_skipped === true,
    done: flagMap(body.done),
    skipped: flagMap(body.skipped),
    final_confirmation: typeof body.final_confirmation === 'string' ? body.final_confirmation.trim() : '',
  };
}

export function validateMediaQaDraft(draft: MediaQaDraft): string | null {
  if (!draft.completed_by_label.trim()) return 'Add who completed this QA.';
  if (draft.final_confirmation.trim().toUpperCase() !== QA_FINAL_CONFIRMATION) {
    return `Type ${QA_FINAL_CONFIRMATION} to submit.`;
  }
  if (!draft.ad_account_skipped && !normalizeAdAccountUrl(draft.ad_account_url)) {
    return 'Paste the ad account link, or mark it does not apply.';
  }
  for (const item of MEDIA_QA_ITEMS) {
    const done = draft.done[item.key] === true;
    const skipped = draft.skipped[item.key] === true;
    if (item.required) {
      if (!done || skipped) return `${item.label} is required.`;
      continue;
    }
    if (done && skipped) return `Confirm ${item.label}, or mark it does not apply.`;
    if (!done && !skipped) return `Confirm ${item.label}, or mark it does not apply.`;
  }
  return null;
}

export function mediaQaToResponses(draft: MediaQaDraft): Record<string, unknown> {
  const checklist: Record<string, boolean> = {};
  const skipped: string[] = [];
  for (const item of MEDIA_QA_ITEMS) {
    if (item.required || draft.done[item.key] === true) {
      if (draft.skipped[item.key] === true && !item.required) continue;
      if (draft.done[item.key] === true) checklist[item.key] = true;
    } else if (draft.skipped[item.key] === true) {
      skipped.push(item.key);
    }
  }
  const url = draft.ad_account_skipped ? null : normalizeAdAccountUrl(draft.ad_account_url);
  return {
    qa_lane: 'media_buying',
    skeleton_version: MEDIA_QA_VERSION,
    completed_by_label: draft.completed_by_label.trim(),
    ad_account_url: url,
    ad_account_skipped: draft.ad_account_skipped,
    checklist,
    skipped,
    final_confirmation: QA_FINAL_CONFIRMATION,
  };
}

export function formatMediaQaClickUpComment(
  client: { id: string; name: string },
  draft: MediaQaDraft,
): string {
  const lines = [
    'Media Buying QA submitted',
    '',
    `Client (Mr. Waiz): ${client.name}`,
    `Mr. Waiz ID: ${client.id}`,
    `Version: ${MEDIA_QA_VERSION}`,
    `Completed by: ${draft.completed_by_label.trim() || '—'}`,
    '',
    '— Ad account link —',
    draft.ad_account_skipped
      ? 'Skipped. Roster link unchanged.'
      : (normalizeAdAccountUrl(draft.ad_account_url) ?? '—'),
    '',
    '— Checks —',
  ];
  for (const item of MEDIA_QA_ITEMS) {
    if (draft.done[item.key] === true && !(draft.skipped[item.key] === true && !item.required)) {
      lines.push(`✓ ${item.number}. ${item.label}`);
    } else if (!item.required && draft.skipped[item.key] === true) {
      lines.push(`Skipped ${item.number}. ${item.label}`);
    }
  }
  return lines.join('\n');
}

export function isMediaQaV1(responses: Record<string, unknown>): boolean {
  return responses.skeleton_version === MEDIA_QA_VERSION;
}

