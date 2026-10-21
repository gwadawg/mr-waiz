/**
 * Launch Kit — 03 Week 1 operator checklist, one page per variant.
 *
 * Product x dial-owner matrix:
 *   rm/client    — LO / VA works leads (Wm-os template: Reverse mortgage appendix)
 *   rm/waiz      — Waiz call center dials + books; LO takes the appointment
 *   dscr/client  — LO / VA works every lead; drip is the safety net (Wm-os: DSCR self-serve)
 *   dscr/waiz    — Laura owns SMS + booking; LO owns the consult (Wm-os: DSCR Laura)
 *
 * SOURCE OF TRUTH: Wm-os docs/templates/client-launch-kit-template.md — "Product appendix — Week 1"
 * and the sample content.json (rm/client is ported 1:1; the other three follow its shape).
 */

import type { KitBlock, KitVariant } from '../types';

export type Week1Params = {
  variant: KitVariant;
  /** Sentence subject — e.g. "You and your VA", "The Waiz call center", "Laura (your AI assistant)". */
  whoWorksLeads: string;
  /** Speed standard exactly as sold on Kickoff. Empty → we do not invent one. */
  speedStandard: string;
};

const H1: KitBlock = { type: 'h1', text: '05  Week 1 operator checklist' };
const IF_THEN: KitBlock = { type: 'h2', text: 'If / then' };
const DAILY_RHYTHM: KitBlock = { type: 'h2', text: 'Daily rhythm' };

function speedCallout(speedStandard: string): KitBlock {
  const s = speedStandard.trim();
  if (s) {
    return { type: 'callout', text: `Speed standard, as agreed on your kickoff: ${s}.` };
  }
  return {
    type: 'callout',
    text: 'Speed standard: as agreed on your kickoff. If you are unsure what you committed to, ask on the call.',
  };
}

function ifThen(rows: string[][]): KitBlock {
  return { type: 'table', variant: 'grid', headers: ['If', 'Then'], col_widths: [0.42, 0.58], rows };
}

function dailyRhythm(rows: string[][]): KitBlock {
  return { type: 'table', variant: 'rhythm', headers: ['Block', 'What happens'], col_widths: [0.26, 0.74], rows };
}

const RHYTHM_CLIENT_DIALS = dailyRhythm([
  ['Morning', "Clear overnight leads. Confirm today's appointments."],
  ['Midday', 'Work new inbound as it lands. Second attempt on the morning misses.'],
  ['End of day', "Every lead has a disposition. Tomorrow's holds are confirmed."],
]);

const RHYTHM_WAIZ_DIALS = dailyRhythm([
  ['Morning', "Check today's calendar. Read the notes on every appointment before the first one."],
  ['Midday', 'Take appointments as booked. Log the outcome right after each one.'],
  ['End of day', "Every appointment has an outcome. Tomorrow's holds are confirmed on your calendar."],
]);

function rmClient(p: Week1Params): KitBlock[] {
  return [
    H1,
    {
      type: 'body',
      text: `Reverse mortgage. ${p.whoWorksLeads} work new leads. The bot and the drip support you. They do not replace the phone.`,
    },
    { type: 'numbered', text: 'When a lead hits, work it. Do not batch until tonight.' },
    { type: 'numbered', text: 'Call first. Text if you miss. Leave a short voicemail, then move on.' },
    { type: 'numbered', text: 'Never end a live conversation without the next step on the calendar.' },
    { type: 'numbered', text: 'Update the disposition before you touch the next name.' },
    { type: 'numbered', text: 'If they text back, call. Do not write a novel in the thread.' },
    { type: 'numbered', text: 'Stay in Slack. If something looks broken, say so the same day.' },
    IF_THEN,
    ifThen([
      ['A new lead hits and you are free', 'Call now. Do not wait for a block.'],
      ['No answer', 'Voicemail + text. Disposition. Next name.'],
      ['They engage but will not book', 'Hold a time inside 72 hours or set a real callback.'],
      ['They book', 'Confirm on the phone. Reminders stay on.'],
      ['Something in the CRM looks wrong', 'Slack. Do not invent a workaround.'],
    ]),
    DAILY_RHYTHM,
    RHYTHM_CLIENT_DIALS,
    speedCallout(p.speedStandard),
  ];
}

function rmWaiz(p: Week1Params): KitBlock[] {
  return [
    H1,
    {
      type: 'body',
      text: `Reverse mortgage. ${p.whoWorksLeads} works new leads and books the appointment. You own the appointment. The system only works if the calendar is real and you show up ready.`,
    },
    { type: 'numbered', text: 'Keep your calendar accurate. Block time you cannot take before we book into it.' },
    { type: 'numbered', text: 'Show up to every booked appointment on time and prepared. Read the notes first.' },
    { type: 'numbered', text: 'If we send a live transfer, pick up. That homeowner is on the line now.' },
    { type: 'numbered', text: 'After every appointment, log the outcome so the pipeline stays honest.' },
    { type: 'numbered', text: 'Do not call or text leads we are still working unless we hand them to you.' },
    { type: 'numbered', text: 'Stay in Slack. If something looks broken, say so the same day.' },
    IF_THEN,
    ifThen([
      ['An appointment lands on your calendar', 'Accept it. Read the notes. Show up.'],
      ['A lead no-shows', 'Tell us in Slack. We re-engage and rebook.'],
      ['You need to move an appointment', 'Slack. We reschedule and re-confirm so the lead is not lost.'],
      ['You want to reach a lead directly', 'Ask first. We keep one voice in front of the prospect.'],
      ['Something in the CRM looks wrong', 'Slack. Do not invent a workaround.'],
    ]),
    DAILY_RHYTHM,
    RHYTHM_WAIZ_DIALS,
    speedCallout(p.speedStandard),
  ];
}

function dscrClient(p: Week1Params): KitBlock[] {
  return [
    H1,
    {
      type: 'body',
      text: `DSCR. ${p.whoWorksLeads} are the system. The drip is the safety net. It does not replace the call.`,
    },
    { type: 'numbered', text: 'You or your VA work every lead. Do not also run our assistant as the daily owner.' },
    { type: 'numbered', text: 'The first 48 hours decide the file. When they text back, call.' },
    { type: 'numbered', text: 'Never end a live conversation without the next step on the calendar.' },
    { type: 'numbered', text: 'Update the disposition before you touch the next name.' },
    { type: 'numbered', text: 'Do not quote a rate, LTV, or payment over text. Run their numbers on the call.' },
    { type: 'numbered', text: 'Stay in Slack. If something looks broken, say so the same day.' },
    IF_THEN,
    ifThen([
      ['A new lead hits and you are free', 'Call now. Do not wait for a block.'],
      ['No answer', 'Short voicemail + text. Disposition. Next name.'],
      ['They text back', 'Call. Do not negotiate in the thread.'],
      ['They engage but will not book', 'Hold a time inside 72 hours or set a real callback.'],
      ['Something in the CRM looks wrong', 'Slack. Do not invent a workaround.'],
    ]),
    DAILY_RHYTHM,
    RHYTHM_CLIENT_DIALS,
    speedCallout(p.speedStandard),
  ];
}

function dscrWaiz(p: Week1Params): KitBlock[] {
  return [
    H1,
    {
      type: 'body',
      text: `DSCR. ${p.whoWorksLeads} owns SMS and booking. You own the consult. Do not run a second daily system on top of it.`,
    },
    { type: 'numbered', text: 'Confirm calendar holds the same day they land. Show up prepared.' },
    { type: 'numbered', text: 'Read the lead notes before the consult. Run their exact numbers on the call, not over text.' },
    { type: 'numbered', text: 'After every consult, log the outcome so the pipeline stays honest.' },
    { type: 'numbered', text: 'If a lead needs you before a consult is booked, we ping you in Slack. Pick up.' },
    { type: 'numbered', text: 'Do not text leads the assistant is still working unless we hand them to you.' },
    { type: 'numbered', text: 'Stay in Slack. If something looks broken, say so the same day.' },
    IF_THEN,
    ifThen([
      ['A consult lands on your calendar', 'Accept it. Read the notes. Show up.'],
      ['A lead no-shows', 'Tell us in Slack. We re-engage and rebook.'],
      ['You need to move a consult', 'Slack. We reschedule and re-confirm so the lead is not lost.'],
      ['A lead asks you for numbers over text', 'Move it to the call. No rates, LTV, or payments in a thread.'],
      ['Something in the CRM looks wrong', 'Slack. Do not invent a workaround.'],
    ]),
    DAILY_RHYTHM,
    RHYTHM_WAIZ_DIALS,
    speedCallout(p.speedStandard),
  ];
}

export function week1Blocks(p: Week1Params): KitBlock[] {
  const { product, dialOwner } = p.variant;
  if (product === 'rm') return dialOwner === 'client' ? rmClient(p) : rmWaiz(p);
  return dialOwner === 'client' ? dscrClient(p) : dscrWaiz(p);
}
