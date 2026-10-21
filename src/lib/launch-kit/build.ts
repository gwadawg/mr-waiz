/**
 * Launch Kit — pure block builder. Section order:
 *   00 Welcome → 01 Review → 02 Save → 03 Lead logging → 04 Engine →
 *   05 Week 1 → 06 Resources + creative → 07 First 30 days → 08 Who to ping.
 *
 * Only client fields are substituted. All copy comes from ./copy.
 */

import {
  coverLead,
  creativeBlocks,
  engineBlocks,
  FIRST_30_DAYS,
  FIRST_30_DAYS_JOB_CLIENT_DIALS,
  FIRST_30_DAYS_JOB_WAIZ_DIALS,
  leadLoggingBlocks,
  PHONE_FLOW_CAPTION,
  PHONE_FLOW_DIAGRAM,
  PHONE_FLOW_HEADING,
  RESOURCE_INDEX_INTRO,
  resourceTable,
  REVIEW_INTRO,
  REVIEW_LIST_HEADING,
  reviewWrittenNotice,
  SAVE_INTRO,
  TEMPLATE_VERSION,
  week1Blocks,
  weekByWeekTable,
  welcomeBlocks,
  whoToPingBlocks,
  YOUR_JOB_HEADING,
} from './copy';
import {
  isPropertyNa,
  LAUNCH_KIT_REVIEW_FIELDS,
  resolveVariant,
  SLACK_DOWNLOAD_URL,
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

const REVIEW_NA_LABEL = 'Declined / not part of this account';
const NOTIFICATION_SAME = 'Same as live transfer number';

/** Review checklist rows: [label, description, value]. WM Number is on Save, not here. */
function reviewRows(draft: LaunchKitDraft, company: string): string[][] {
  const rows: string[][] = [];
  const reviewKeys = LAUNCH_KIT_REVIEW_FIELDS.filter(f => f.key !== 'phone_prospecting');

  for (const field of reviewKeys) {
    const value = draft[field.key].trim();
    const na = isPropertyNa(draft, field.key);
    if (field.key === 'phone_notifications') {
      if (na) {
        rows.push([field.pdfLabel, field.pdfDescription, NOTIFICATION_SAME]);
      } else {
        rows.push([field.pdfLabel, field.pdfDescription, value || NOTIFICATION_SAME]);
      }
      continue;
    }
    if (field.optional && (!value || na)) continue;
    if (na) {
      rows.push([field.pdfLabel, field.pdfDescription, REVIEW_NA_LABEL]);
      continue;
    }
    rows.push([field.pdfLabel, field.pdfDescription, orFill(value)]);
  }

  if (!isPropertyNa(draft, 'funnel_url')) {
    rows.push([
      'Apex funnel',
      'The page and information a lead sees when they opt in. Confirm it is what you want.',
      orFill(draft.funnel_url),
    ]);
  }

  rows.push([
    'Daily ad spend',
    'The average daily amount. We may start lower to warm the account up.',
    orFill(draft.daily_adspend),
  ]);
  rows.push([
    'Licensed states',
    'The states we have you licensed in.',
    orFill(draft.states_licensed),
  ]);
  rows.push([
    'Company name',
    'The business name on your ads and pages.',
    orFill(company),
  ]);
  rows.push([
    'NMLS',
    'The license number we use on your ads and pages.',
    orFill(draft.nmls),
  ]);

  return rows;
}

function launchKitFolderValue(draft: LaunchKitDraft): string {
  if (isPropertyNa(draft, 'launch_kit_folder_url')) return 'Your CSM shares the folder link in Slack';
  return orFill(draft.launch_kit_folder_url);
}

/** Save tiles: [action, title, description, link]. */
function saveRows(draft: LaunchKitDraft): string[][] {
  const rows: string[][] = [];
  const wm = LAUNCH_KIT_REVIEW_FIELDS.find(f => f.key === 'phone_prospecting');
  if (wm && !isPropertyNa(draft, 'phone_prospecting')) {
    rows.push(['SAVE AS CONTACT', wm.pdfLabel, wm.pdfDescription, orFill(draft.phone_prospecting)]);
  } else if (wm && isPropertyNa(draft, 'phone_prospecting')) {
    rows.push(['SAVE AS CONTACT', wm.pdfLabel, wm.pdfDescription, REVIEW_NA_LABEL]);
  }

  if (!isPropertyNa(draft, 'crm_url')) {
    rows.push([
      'BOOKMARK',
      'CRM',
      'Your Go High Level login. Bookmark it on your phone so speed-to-lead is one tap.',
      orFill(draft.crm_url),
    ]);
  }

  rows.push([
    'BOOKMARK',
    'Lead logging form',
    'Where you log qualified and disqualified outcomes. Bookmark it. Section 03 explains why.',
    orFill(draft.lead_logging_form_url),
  ]);

  rows.push([
    'BOOKMARK',
    'Launch kit folder',
    'The place to come back to for this kit, swipe files, and recordings.',
    launchKitFolderValue(draft),
  ]);

  rows.push([
    'DOWNLOAD',
    'Slack desktop app',
    'Install the desktop app. That is how we get faster communication when something needs attention.',
    SLACK_DOWNLOAD_URL,
  ]);

  return rows;
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
  const slackLabel = slackChannelLabel(draft);

  const blocks: KitBlock[] = [
    ...welcomeBlocks({ contactFirstName: contact, productPhrase }),
    { type: 'pagebreak' },

    // 01 Review
    ...REVIEW_INTRO,
    PHONE_FLOW_HEADING,
    PHONE_FLOW_DIAGRAM,
    PHONE_FLOW_CAPTION,
    REVIEW_LIST_HEADING,
    {
      type: 'table',
      variant: 'review',
      headers: ['Item', 'What it means', 'Value'],
      col_widths: [0.28, 0.4, 0.32],
      rows: reviewRows(draft, company),
    },
    reviewWrittenNotice(slackLabel),
    { type: 'pagebreak' },

    // 02 Save
    ...SAVE_INTRO,
    {
      type: 'table',
      variant: 'save',
      headers: ['Action', 'Item', 'Why', 'Open'],
      col_widths: [0.2, 0.2, 0.35, 0.25],
      rows: saveRows(draft),
    },
    { type: 'pagebreak' },

    // 03 Lead logging
    ...leadLoggingBlocks(orFill(draft.lead_logging_form_url)),
    { type: 'pagebreak' },

    // 04 Engine
    ...engineBlocks(variant),
    { type: 'pagebreak' },

    // 05 Week 1
    ...week1Blocks({ variant, whoWorksLeads: whoWorks, speedStandard: draft.speed_standard }),
    { type: 'pagebreak' },

    // 06 Resources + creative
    ...RESOURCE_INDEX_INTRO,
    ...resourceTable(draft.resources),
    ...creativeBlocks(launchKitFolderValue(draft), variant),
    { type: 'pagebreak' },

    // 07 First 30 days
    ...FIRST_30_DAYS,
    weekByWeekTable(variant.dialOwner),
    YOUR_JOB_HEADING,
    ...(variant.dialOwner === 'waiz' ? FIRST_30_DAYS_JOB_WAIZ_DIALS : FIRST_30_DAYS_JOB_CLIENT_DIALS),
    { type: 'pagebreak' },

    // 08 Who to ping
    ...whoToPingBlocks({
      slackChannelLabel: slackLabel,
      csmName: csm,
      contactFirstName: contact,
      dialOwner: variant.dialOwner,
    }),
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
    } else if (b.type === 'spot') {
      out.push(b.heading, ...b.bodies);
    } else if (b.type === 'image' || b.type === 'diagram') {
      // no text
    } else if ('text' in b) {
      out.push(b.text);
    }
  }
  return out;
}

/** Section order check: h1 titles in the order the template fixes. */
export const EXPECTED_H1_ORDER = [
  'Welcome to Waiz',
  '01  Review before we launch',
  '02  Save before launch',
  '03  Lead logging form',
  '04  How the engine works',
  '05  Week 1 operator checklist',
  '06  Resources and creative files',
  '07  First 30 days',
  '08  Who to ping',
] as const;
