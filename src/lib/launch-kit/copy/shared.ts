/**
 * Launch Kit — copy shared by every variant.
 *
 * SOURCE OF TRUTH: Wm-os `docs/templates/client-launch-kit-template.md` and the sample
 * `docs/client-fulfillment/onboarding/assets/launch-kit-sample/content.json`. Edit copy
 * there first, then mirror here and bump TEMPLATE_VERSION in `./index.ts`.
 * Client-safe (`paying-client`) copy only — no SOPs, pricing, KPI targets, CRM/bot specs,
 * or internal doc names.
 */

import type { KitBlock, KitVariant } from '../types';

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

export function coverLead(productPhrase: string): string {
  return `Your ${productPhrase} acquisition engine is built and checked. This kit is the map for launch day and the first 30 days: what is live, what to confirm, how to run Week 1, and who to reach.`;
}

// ---------------------------------------------------------------------------
// 00 Welcome
// ---------------------------------------------------------------------------

export function welcomeBlocks(p: { contactFirstName: string; productPhrase: string }): KitBlock[] {
  return [
    { type: 'h1', text: `Welcome to Waiz, ${p.contactFirstName}` },
    {
      type: 'body',
      text: `Your ${p.productPhrase} acquisition engine is built, checked, and ready to go live. This kit is the leave-behind from your launch call. It is not homework. It is the map: what is live, what to review, how to run Week 1, where every file lives, and who to reach when something needs attention.`,
    },
    {
      type: 'body',
      text: 'Most agencies hand you a login and wish you luck. We are pulling up the hood. When you understand the system, you show up better on your calls, you use the tools correctly, and you get more out of every dollar you invest with us.',
    },
    {
      type: 'callout',
      text: 'The PDF is the conversation. The Drive folder is the vault. Anything that changes (ads, swipe files, recordings) lives in Drive so this document never goes stale.',
    },
    { type: 'h2', text: "What's inside" },
    {
      type: 'table',
      variant: 'toc',
      headers: ['', 'Section', 'The question it answers'],
      col_widths: [0.08, 0.34, 0.58],
      rows: [
        ['01', "What's live", 'Where are my pages and my CRM? What should I review, and what do you have on file?'],
        ['02', 'How the engine works', 'What happens to a person between the first ad and a held appointment?'],
        ['03', 'Week 1 operator checklist', 'What do I do when a lead hits?'],
        ['04', 'Resource index', 'Where are the playbooks behind the rules?'],
        ['05', 'Creative and swipe files', 'What can I see, use, and remix?'],
        ['06', 'First 30 days', 'What should I expect, and what should I ignore?'],
        ['07', 'Who to ping', 'Slack now, or bring it to the weekly call?'],
      ],
    },
    {
      type: 'body',
      text: 'Read it once end to end. Then keep it open on launch day. Sections 01 and 03 are the ones you will come back to most.',
    },
  ];
}

// ---------------------------------------------------------------------------
// 01 What's live
// ---------------------------------------------------------------------------

export const WHATS_LIVE_INTRO: KitBlock[] = [
  { type: 'h1', text: "01  What's live" },
  {
    type: 'body',
    text: 'These are your properties. We click every one of them on the launch call. If a link does not open or a login fails, we fix it before we treat the account as live. Access first. Volume second.',
  },
];

export const AT_A_GLANCE_HEADING: KitBlock = { type: 'h2', text: 'Your account at a glance' };

export const PLEASE_REVIEW_HEADING: KitBlock = { type: 'h2', text: 'Please review' };

export const PLEASE_REVIEW_INTRO: KitBlock = {
  type: 'body',
  text: 'Open every link and confirm every number on the launch call. If something is wrong, say so before we treat the account as live.',
};

export const PHONE_NUMBERS_NOTE: KitBlock = {
  type: 'body',
  text: 'Save the Go High Level number in your contacts. That is the number we use to text and call your leads, and the number you will see when we text you or live-transfer a call. The live transfer number is your phone: the number we call to connect a lead to you. The notification number, when listed, is a separate line where we send account notifications.',
};

export const ON_FILE_HEADING: KitBlock = { type: 'h2', text: 'On file with us' };

export const ON_FILE_INTRO: KitBlock = {
  type: 'body',
  text: 'A receipt of what we have on file for you. Ads, compliance copy, and call scripts are built from these three details, so check them closely.',
};

export const ON_FILE_NOTE: KitBlock = {
  type: 'caption',
  text: 'If any detail is inaccurate, tell your CSM before launch so we can correct it. Keep this page: it is the record you can point back to.',
};

export const WHATS_LIVE_CALLOUT: KitBlock = {
  type: 'callout',
  text: 'Bookmark the CRM on your phone today. Speed-to-lead starts with not hunting for the login.',
};

export const WHATS_LIVE_CALLOUT_WAIZ_DIALS: KitBlock = {
  type: 'callout',
  text: 'Bookmark the CRM on your phone today. When an appointment lands, you should be one tap from the notes.',
};

// ---------------------------------------------------------------------------
// 02 How the engine works
// ---------------------------------------------------------------------------

const ENGINE_H1: KitBlock = { type: 'h1', text: '02  How the engine works' };

function engineIntro(prospectNoun: string): KitBlock {
  return {
    type: 'body',
    text: `We are not a lead vendor. We built an acquisition engine around you. You do not need to know how we build it. You do need to know what happens to ${prospectNoun} from the first ad to a held appointment, and where you come in.`,
  };
}

const ENGINE_REPETITION: KitBlock = {
  type: 'body',
  text: 'Repetition builds familiarity, and familiarity builds trust. That is why the ads keep running after the click.',
};

const ENGINE_DIFFERENT: KitBlock[] = [
  { type: 'h2', text: 'What we do differently' },
  {
    type: 'table',
    variant: 'compare',
    headers: ['What everyone else does', 'What Waiz does'],
    col_widths: [0.5, 0.5],
    rows: [
      ['Runs stock-image ads', 'Builds a full acquisition engine around your brand'],
      ['Drops leads in your inbox', 'Controls every stage of the lead journey'],
      ['Disappears', 'Qualifies, calls, books, and nurtures'],
      ['Blames the market', 'Stays accountable to your outcomes'],
    ],
  },
];

export function engineBlocks(p: { product: 'rm' | 'dscr'; dialOwner: 'waiz' | 'client' }): KitBlock[] {
  const prospectNoun = p.product === 'rm' ? 'a homeowner' : 'an investor';
  const rows =
    p.dialOwner === 'client'
      ? [
          ['Awareness', 'They see your ads. If they watch or click without submitting, they are followed until they are ready.', 'Nothing yet. Stay off the scoreboard.'],
          ['Funnel', 'They land on your page and opt in. Qualification happens here, before your calendar.', 'Do not rewrite the page mid-test.'],
          ['CRM + first contact', 'The lead lands in your CRM and is acknowledged within minutes. Speed is the offer.', 'Call. Text. Log the disposition.'],
          ['Booking', 'A qualified conversation ends on the calendar, not in a voicemail loop.', 'Never hang up without the next step.'],
          ['Pre-appointment', 'Reminders and nurture protect the show.', 'Confirm. Do not go dark after the book.'],
          ['Long-term pipeline', 'People who are not ready stay in a system that keeps you in front of them.', "Work today's leads. The drip holds the rest."],
        ]
      : [
          ['Awareness', 'They see your ads. If they watch or click without submitting, they are followed until they are ready.', 'Nothing yet. Stay off the scoreboard.'],
          ['Funnel', 'They land on your page and opt in. Qualification happens here, before your calendar.', 'Do not rewrite the page mid-test.'],
          ['CRM + first contact', 'The lead lands in the CRM and our team makes first contact within minutes. Speed is the offer.', 'Watch the calendar, not the inbox.'],
          ['Booking', 'A qualified conversation ends on your calendar, not in a voicemail loop.', 'Keep your calendar accurate. Holds are real.'],
          ['Pre-appointment', 'Reminders and nurture protect the show.', 'Read the notes. Show up prepared.'],
          ['Long-term pipeline', 'People who are not ready stay in a system that keeps you in front of them.', 'Take the consults. We hold the rest.'],
        ];
  return [
    ENGINE_H1,
    engineIntro(prospectNoun),
    {
      type: 'table',
      variant: 'steps',
      headers: ['Stage', 'What the prospect experiences', 'What you do'],
      col_widths: [0.24, 0.46, 0.3],
      rows,
    },
    ENGINE_REPETITION,
    ...ENGINE_DIFFERENT,
  ];
}

// ---------------------------------------------------------------------------
// 04 Resource index + 05 Creative and swipe files (same page)
// ---------------------------------------------------------------------------

export const RESOURCE_INDEX_INTRO: KitBlock[] = [
  { type: 'h1', text: '04  Resource index' },
  {
    type: 'body',
    text: 'The playbooks behind the rules in Section 03. Use them when you are in the work, not on the launch call. If one is not in your Drive yet, your CSM sends it.',
  },
];

export function creativeBlocks(
  launchKitFolderValue: string,
  variant?: KitVariant | null,
): KitBlock[] {
  const rows: string[][] = [
    ['Launch Kit (root)', launchKitFolderValue],
    ['01-Launch-PDF', 'This document'],
    ['02-Links', 'Shortcuts to every page in Section 01'],
    ['03-Swipe-and-Ads', 'Your live ads plus approved examples you can reference or remix'],
    ['04-Recordings', 'Launch-call recording, posted after the call'],
  ];
  if (variant?.product === 'dscr' && variant.dialOwner === 'client') {
    rows.push([
      '05-Playbooks',
      'DSCR-Prospecting-Playbook.pdf (how to work leads) + DSCR-Cash-Out-Drip.md (CRM sequence when they go quiet)',
    ]);
  }
  return [
    { type: 'h1', text: '05  Creative and swipe files' },
    { type: 'body', text: 'The files that change live in Drive, not in this PDF.' },
    {
      type: 'table',
      variant: 'kv',
      headers: ['Folder', "What's in it"],
      col_widths: [0.3, 0.7],
      rows,
    },
    { type: 'bullet', text: 'Use the swipe pack to see what is running and what we have already approved.' },
    { type: 'bullet', text: 'Send ad ideas to Slack and we will tell you if they are usable. Do not drop competitor ads into the folder.' },
    { type: 'bullet', text: 'We own the live campaigns. Ask for changes; do not edit ads or budgets yourself.' },
    ...(variant?.product === 'dscr' && variant.dialOwner === 'client'
      ? [
          {
            type: 'bullet' as const,
            text: 'Open 05-Playbooks before you start dialing. The Prospecting Playbook is the daily system; the Cash-Out Drip is the safety net in your CRM.',
          },
        ]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// 06 First 30 days
// ---------------------------------------------------------------------------

export const FIRST_30_DAYS: KitBlock[] = [
  { type: 'h1', text: '06  First 30 days' },
  {
    type: 'body',
    text: 'Weeks 1 to 4 are a test. We are collecting data across ads, audiences, and angles. No single combination has earned the whole budget yet. That is the work, not a delay.',
  },
  {
    type: 'table',
    variant: 'grid',
    headers: ['What you will feel', 'What it means'],
    col_widths: [0.42, 0.58],
    rows: [
      ['Lead volume is uneven', 'Normal. Tests do not arrive in a straight line.'],
      ['Cost per lead looks high', 'Expected while we learn. Not the scoreboard.'],
      ['A deal closes in Week 2', 'Celebrate. Still do not call the month a verdict.'],
      ['A quiet day', 'Not a failure. Stay on the phone for what did come in.'],
      ['The urge to rebuild everything', 'Talk to us first. Mid-test rewrites reset the clock.'],
    ],
  },
  { type: 'h2', text: 'Week by week' },
];

export function weekByWeekTable(dialOwner: 'waiz' | 'client'): KitBlock {
  return {
    type: 'table',
    variant: 'timeline',
    headers: ['Week', 'Focus'],
    col_widths: [0.18, 0.82],
    rows: [
      [
        'Week 1',
        dialOwner === 'client'
          ? 'Ads live. Access confirmed. First leads worked inside the speed standard.'
          : 'Ads live. Access confirmed. First leads contacted and first appointments on your calendar.',
      ],
      ['Week 2', 'Data accumulates. First patterns in who responds and when.'],
      ['Week 3', 'Early winners emerge. We start leaning budget toward them.'],
      ['Week 4', 'Month 1 review on the weekly call. What we learned, what changes next.'],
    ],
  };
}

export const YOUR_JOB_HEADING: KitBlock = { type: 'h2', text: 'Your job this month' };

export const FIRST_30_DAYS_JOB_CLIENT_DIALS: KitBlock[] = [
  { type: 'numbered', text: 'Work every lead. Keep dispositions clean.' },
  { type: 'numbered', text: 'Show up to the weekly check-in with what you heard on the phone.' },
  { type: 'numbered', text: 'Stay in Slack. Celebrate the first lead, the first book, the first show.' },
  { type: 'numbered', text: 'Do not judge the system by ROI in Month 1.' },
  {
    type: 'callout',
    text: 'Closings can happen. They are not how we score Week 1. We score whether the engine is live and whether you are on the leads.',
  },
];

export const FIRST_30_DAYS_JOB_WAIZ_DIALS: KitBlock[] = [
  { type: 'numbered', text: 'Take every booked appointment. Show up prepared and on time.' },
  { type: 'numbered', text: 'Log the outcome after every appointment so the pipeline stays honest.' },
  { type: 'numbered', text: 'Show up to the weekly check-in with what you heard on the calls.' },
  { type: 'numbered', text: 'Stay in Slack. Celebrate the first lead, the first book, the first show.' },
  { type: 'numbered', text: 'Do not judge the system by ROI in Month 1.' },
  {
    type: 'callout',
    text: 'Closings can happen. They are not how we score Week 1. We score whether the engine is live and whether the calendar is filling.',
  },
];

// ---------------------------------------------------------------------------
// 07 Who to ping
// ---------------------------------------------------------------------------

export type WhoToPing = {
  slackChannelLabel: string;
  csmName: string;
  contactFirstName: string;
  dialOwner: 'waiz' | 'client';
};

export function whoToPingBlocks(p: WhoToPing): KitBlock[] {
  return [
    { type: 'h1', text: '07  Who to ping' },
    {
      type: 'body',
      text: 'Two channels. Slack for anything that is broken or time-sensitive. The weekly check-in for everything you want to think through together.',
    },
    {
      type: 'table',
      variant: 'grid',
      headers: ['Situation', 'Where', 'When'],
      col_widths: [0.42, 0.2, 0.38],
      rows: [
        ['Cannot log in / page is down / ads look off', 'Slack', 'Same day. Do not wait for the call.'],
        ['A lead you cannot find in the CRM', 'Slack', 'Same day'],
        ['How a conversation went / a pattern you are seeing', 'Weekly check-in', 'Bring notes'],
        ['A new ad idea or landing-page tweak', 'Slack', 'We will queue it. Not same-hour unless broken.'],
        ['You are underwater and need a reset', 'Slack + CSM', 'Say it. Do not disappear.'],
      ],
    },
    { type: 'h2', text: 'Your team' },
    {
      type: 'table',
      variant: 'grid',
      headers: ['Role', 'Who', 'How'],
      col_widths: [0.32, 0.24, 0.44],
      rows: [
        ['Client Success Manager', p.csmName, `Slack ${p.slackChannelLabel} and the weekly check-in`],
        ['Media buying', 'Waiz team', `Via ${p.csmName}. Do not edit campaigns directly.`],
        ['Tech / CRM', 'Waiz team', 'Via Slack. Describe what you saw, we fix it.'],
      ],
    },
    {
      type: 'body',
      text: 'Weekly check-ins start the first week the ads are live. Your CSM will send the recurring invite before launch day.',
    },
    {
      type: 'callout',
      text:
        p.dialOwner === 'client'
          ? `Welcome aboard, ${p.contactFirstName}. The engine is live. Your job this month is simple: be on the phone when the leads come in.`
          : `Welcome aboard, ${p.contactFirstName}. The engine is live. Your job this month is simple: show up ready for every appointment we put on your calendar.`,
    },
  ];
}

export function footerBlocks(p: { companyName: string; monthYear: string }): KitBlock[] {
  return [
    { type: 'divider' },
    { type: 'caption', text: `Waiz Media. Client Launch Kit for ${p.companyName}, ${p.monthYear}.` },
  ];
}
