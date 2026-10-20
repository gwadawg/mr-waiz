/**
 * Launch Kit — pure block builder. Fixed section order from the Wm-os template:
 *   00 Welcome → 01 What's live → 02 How the engine works → 03 Week 1 →
 *   04 Resource index + 05 Creative (same page) → 06 First 30 days → 07 Who to ping.
 *
 * Only client fields are substituted. All copy comes from ./copy.
 */

import {
  AT_A_GLANCE_HEADING,
  coverLead,
  creativeBlocks,
  engineBlocks,
  FIRST_30_DAYS,
  FIRST_30_DAYS_JOB_CLIENT_DIALS,
  FIRST_30_DAYS_JOB_WAIZ_DIALS,
  ON_FILE_HEADING,
  ON_FILE_INTRO,
  ON_FILE_NOTE,
  PHONE_NUMBERS_NOTE,
  PLEASE_REVIEW_HEADING,
  PLEASE_REVIEW_INTRO,
  RESOURCE_INDEX_INTRO,
  resourceTable,
  TEMPLATE_VERSION,
  week1Blocks,
  weekByWeekTable,
  welcomeBlocks,
  WHATS_LIVE_CALLOUT,
  WHATS_LIVE_CALLOUT_WAIZ_DIALS,
  WHATS_LIVE_INTRO,
  whoToPingBlocks,
  YOUR_JOB_HEADING,
} from './copy';
import {
  isPropertyNa,
  LAUNCH_KIT_PROPERTIES,
  LAUNCH_KIT_REVIEW_FIELDS,
  resolveVariant,
  TO_FILL,
  type LaunchKitDraft,
} from './intake';
import { KIT_PRODUCT_LABELS, type KitBlock, type KitCoverMeta, type KitVariant } from './types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "15 September 2026" */
export function formatLongDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso.trim() || TO_FILL;
  return `${p.d} ${MONTHS[p.m - 1] ?? p.m} ${p.y}`;
}

/** "Monday, 15 September 2026" */
export function formatWeekdayDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso.trim() || TO_FILL;
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${weekday}, ${formatLongDate(iso)}`;
}

export function formatMonthYear(iso: string, fallback = new Date()): string {
  const p = parseIsoDate(iso);
  if (p) return `${MONTHS[p.m - 1] ?? p.m} ${p.y}`;
  return `${MONTHS[fallback.getMonth()]} ${fallback.getFullYear()}`;
}

function orFill(v: string): string {
  const t = v.trim();
  return t || TO_FILL;
}

function slackChannelLabel(draft: LaunchKitDraft): string {
  const s = draft.slack_channel_name.trim();
  if (!s) return TO_FILL;
  return s.startsWith('#') ? s : `#${s}`;
}

/** 01 property list. Lead logging and Slack sit before the Drive folder. */
function whatsLiveRows(draft: LaunchKitDraft): string[][] {
  const rows: string[][] = [];
  for (const property of LAUNCH_KIT_PROPERTIES) {
    if (property.key === 'launch_kit_folder_url') {
      if (draft.lead_logging_form_url.trim()) rows.push(['Lead logging form', draft.lead_logging_form_url.trim()]);
      if (draft.slack_channel_name.trim()) rows.push(['Slack channel', slackChannelLabel(draft)]);
    }
    if (isPropertyNa(draft, property.key)) continue;
    rows.push([property.label, orFill(draft[property.key])]);
  }
  return rows;
}

const REVIEW_NA_LABEL = 'Declined / not part of this account';

/** Client-facing review checklist. Optional blanks are omitted. Declines stay visible. */
function pleaseReviewRows(draft: LaunchKitDraft): string[][] {
  const rows: string[][] = [];
  for (const field of LAUNCH_KIT_REVIEW_FIELDS) {
    const value = draft[field.key].trim();
    const na = isPropertyNa(draft, field.key);
    if (field.optional && (!value || na)) continue;
    if (na) {
      rows.push([field.pdfLabel, REVIEW_NA_LABEL]);
      continue;
    }
    rows.push([field.pdfLabel, orFill(value)]);
  }
  return rows;
}

function onFileRows(draft: LaunchKitDraft, company: string): string[][] {
  return [
    ['Company name', orFill(company)],
    ['NMLS #', orFill(draft.nmls)],
    ['States licensed', orFill(draft.states_licensed)],
  ];
}

function launchKitFolderValue(draft: LaunchKitDraft): string {
  if (isPropertyNa(draft, 'launch_kit_folder_url')) return 'Your CSM shares the folder link in Slack';
  return orFill(draft.launch_kit_folder_url);
}

function leadLoggingBlocks(draft: LaunchKitDraft): KitBlock[] {
  return [
    { type: 'h2', text: 'Lead logging form' },
    {
      type: 'body',
      text: 'Use this form to log qualified and disqualified leads. Your reporting depends on those outcomes: when the form is current, lead quality, qualification rate, and follow-up visibility stay accurate.',
    },
    {
      type: 'table',
      variant: 'kv',
      headers: ['Use this for', 'Open'],
      col_widths: [0.44, 0.56],
      rows: [['Qualified and disqualified lead outcomes', orFill(draft.lead_logging_form_url)]],
    },
  ];
}

export type BuiltLaunchKit = {
  blocks: KitBlock[];
  variant: KitVariant;
  cover: KitCoverMeta;
};

/**
 * Build the block list for a kit. Blank fields render as `[TO FILL]` so drafts can be
 * previewed; `validateForGenerate` blocks shipping a kit that still contains one.
 */
export function buildLaunchKitBlocks(
  draft: LaunchKitDraft,
  opts: { version: number; clientName: string; now?: Date },
): BuiltLaunchKit {
  const variant = resolveVariant(draft) ?? { product: 'rm', dialOwner: 'client' };
  const productLabel = KIT_PRODUCT_LABELS[variant.product];
  const productPhrase = variant.product === 'dscr' ? 'DSCR' : 'reverse-mortgage';
  const contact = orFill(draft.contact_first_name);
  const company = draft.company_name.trim() || opts.clientName;
  const goLive = formatLongDate(draft.go_live_date);
  const monthYear = formatMonthYear(draft.go_live_date, opts.now);
  const csm = orFill(draft.csm_name);
  const whoWorks = orFill(draft.who_works_leads);

  const blocks: KitBlock[] = [
    // 00 Welcome
    ...welcomeBlocks({ contactFirstName: contact, productPhrase }),
    { type: 'pagebreak' },

    // 01 What's live: the properties we click on the call, then the account summary
    ...WHATS_LIVE_INTRO,
    {
      type: 'table',
      variant: 'kv',
      headers: ['Property', 'Where to find it'],
      col_widths: [0.3, 0.7],
      rows: whatsLiveRows(draft),
    },
    variant.dialOwner === 'waiz' ? WHATS_LIVE_CALLOUT_WAIZ_DIALS : WHATS_LIVE_CALLOUT,
    AT_A_GLANCE_HEADING,
    {
      type: 'table',
      variant: 'kv',
      headers: ['Account', 'Detail'],
      col_widths: [0.3, 0.7],
      rows: [
        ['Client', `${contact}, ${company}`],
        ['Product line', productLabel],
        ['Go-live', formatWeekdayDate(draft.go_live_date)],
        ['Who works new leads', whoWorks],
        ['Client Success Manager', csm],
      ],
    },
    { type: 'pagebreak' },

    // 01 continued. The confirmation page: what the client ticks off, and the receipt of what we hold
    PLEASE_REVIEW_HEADING,
    PLEASE_REVIEW_INTRO,
    PHONE_NUMBERS_NOTE,
    {
      type: 'table',
      variant: 'checklist',
      headers: ['Item', 'Open / confirm'],
      col_widths: [0.36, 0.64],
      rows: pleaseReviewRows(draft),
    },
    ON_FILE_HEADING,
    ON_FILE_INTRO,
    {
      type: 'table',
      variant: 'receipt',
      headers: ['Detail', 'On file'],
      col_widths: [0.3, 0.7],
      rows: onFileRows(draft, company),
    },
    ON_FILE_NOTE,
    { type: 'pagebreak' },

    // 02 How the engine works
    ...engineBlocks(variant),
    { type: 'pagebreak' },

    // 03 Week 1
    ...week1Blocks({ variant, whoWorksLeads: whoWorks, speedStandard: draft.speed_standard }),
    { type: 'pagebreak' },

    // 04 + 05 on one page
    ...RESOURCE_INDEX_INTRO,
    ...leadLoggingBlocks(draft),
    resourceTable(draft.resources),
    ...creativeBlocks(launchKitFolderValue(draft), variant),
    { type: 'pagebreak' },

    // 06 First 30 days
    ...FIRST_30_DAYS,
    weekByWeekTable(variant.dialOwner),
    YOUR_JOB_HEADING,
    ...(variant.dialOwner === 'waiz' ? FIRST_30_DAYS_JOB_WAIZ_DIALS : FIRST_30_DAYS_JOB_CLIENT_DIALS),
    { type: 'pagebreak' },

    // 07 Who to ping
    ...whoToPingBlocks({
      slackChannelLabel: slackChannelLabel(draft),
      csmName: csm,
      contactFirstName: contact,
      dialOwner: variant.dialOwner,
    }),
    // The running page footer carries "Waiz Media / Client Launch Kit for {company}",
    // so the closing caption from the Wm-os template is not repeated here.
  ];

  const cover: KitCoverMeta = {
    title: 'Client Launch Kit',
    subtitle: company,
    abstract: `${productLabel}. Go-live ${goLive}.`,
    welcomeName: contact === TO_FILL ? 'there' : contact,
    lead: coverLead(productPhrase),
    clientName: company,
    productLabel,
    goLiveLabel: goLive,
    dateLabel: monthYear,
    version: opts.version,
    templateVersion: TEMPLATE_VERSION,
  };

  return { blocks, variant, cover };
}

/** Text of every block, for tests and search. */
export function flattenBlockText(blocks: KitBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'table') {
      out.push(...b.headers, ...b.rows.flat());
    } else if ('text' in b) {
      out.push(b.text);
    }
  }
  return out;
}

/** Section order check: h1 titles in the order the template fixes. */
export const EXPECTED_H1_ORDER = [
  'Welcome to Waiz',
  "01  What's live",
  '02  How the engine works',
  '03  Week 1 operator checklist',
  '04  Resource index',
  '05  Creative and swipe files',
  '06  First 30 days',
  '07  Who to ping',
] as const;
