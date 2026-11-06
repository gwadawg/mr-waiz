import { parseLoanLogDate } from '@/lib/loan-log-form';
import { normalizeTransactionLabel } from '@/lib/loan-deals';

/**
 * Client events-tracker corrections.
 *
 * A submitted or funded log is a loan file plus at most one conversion event
 * per stage for that person. Proposal logs are the event only. Person-level
 * KPI dates are rebuilt from both, so a correction has to change them together.
 */

export const FORM_SOURCE = 'loan_log_form';

const FUNDED_TYPES = new Set(['loan_funded', 'closed']);
const SUBMISSION_TYPES = new Set(['submission_made', 'loan_processing']);
const PROPOSAL_TYPES = new Set(['proposal_made', 'proposal_sent']);

export type CorrectionKind = 'deal' | 'event';

export type CorrectionStage = 'proposal' | 'submitted' | 'funded' | 'fell_out';

export type CorrectionDeal = {
  id: string;
  stage: 'submitted' | 'funded';
  submitted_at: string;
  funded_at: string | null;
  fell_out_at: string | null;
  loan_size: number | null;
  commission_amount: number | null;
  transaction_label: string | null;
  ghl_contact_id: string | null;
  source: string | null;
  lead_name: string | null;
  lead_phone: string | null;
};

export type CorrectionEvent = {
  id: string;
  event_type: string;
  ghl_contact_id: string | null;
  occurred_at: string | null;
  source: string | null;
  loan_size: number | null;
  lead_name: string | null;
  lead_phone: string | null;
};

export type ConversionLogRow = {
  id: string;
  kind: CorrectionKind;
  stage: CorrectionStage;
  lead_name: string;
  lead_phone: string | null;
  occurred_on: string;
  submitted_on: string | null;
  loan_size: number | null;
  commission_amount: number | null;
  transaction_label: string | null;
  ghl_contact_id: string | null;
};

export type DealWrite = {
  stage: 'submitted' | 'funded';
  submitted_at: string;
  funded_at: string | null;
  loan_size: number;
  commission_amount: number | null;
  transaction_label: string | null;
};

export type DealEditInput = {
  occurredOn: string;
  loanSize: number;
  commissionAmount: number | null;
  transactionLabel: string | null;
  pullBackToSubmitted: boolean;
};

export type EventTouch = {
  id: string;
  occurred_at: string;
  loan_size: number | null;
  commission_amount: number | null;
};

export type EventSyncPlan = {
  deleteIds: string[];
  updates: EventTouch[];
};

export function noonUtc(date: string): string {
  return `${date}T12:00:00.000Z`;
}

export function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function countsAsRealSubmission(deal: {
  stage: string;
  submitted_at: string;
  funded_at: string | null;
}): boolean {
  if (deal.stage !== 'funded') return true;
  return dayKey(deal.submitted_at) !== dayKey(deal.funded_at);
}

function sameMoney(a: number | null | undefined, b: number): boolean {
  if (a == null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) < 0.005;
}

function sameLabel(a: string | null | undefined, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

function identityDay(deal: {
  stage: string;
  submitted_at: string;
  funded_at: string | null;
}): string | null {
  const iso = deal.stage === 'funded' ? deal.funded_at ?? deal.submitted_at : deal.submitted_at;
  return dayKey(iso);
}

export function dealIdentityClash(
  candidate: { day: string; loanSize: number; transactionLabel: string | null },
  others: CorrectionDeal[],
): boolean {
  return others.some(other => {
    if (identityDay(other) !== candidate.day) return false;
    if (!sameMoney(other.loan_size, candidate.loanSize)) return false;
    return sameLabel(other.transaction_label, candidate.transactionLabel);
  });
}

function minIso(values: string[]): string {
  return values.reduce((best, value) => (value < best ? value : best));
}

function forContact<T extends { ghl_contact_id: string | null }>(
  rows: T[],
  contactId: string | null,
): T[] {
  if (!contactId) return [];
  return rows.filter(row => row.ghl_contact_id === contactId);
}

export function planDealWrite(
  deal: CorrectionDeal,
  others: CorrectionDeal[],
  input: DealEditInput,
): { error: string } | DealWrite {
  const occurredOn = parseLoanLogDate(input.occurredOn);
  if (!occurredOn) return { error: 'Enter a valid date.' };
  if (!Number.isFinite(input.loanSize) || input.loanSize <= 0) {
    return { error: 'Loan size is required.' };
  }
  if (input.commissionAmount != null && (!Number.isFinite(input.commissionAmount) || input.commissionAmount < 0)) {
    return { error: 'Commission has to be a dollar amount.' };
  }

  const pullBack = input.pullBackToSubmitted && deal.stage === 'funded';
  const stage: 'submitted' | 'funded' = pullBack || deal.stage === 'submitted' ? 'submitted' : 'funded';
  const at = noonUtc(occurredOn);

  let submittedAt = deal.submitted_at;
  let fundedAt: string | null = deal.funded_at;
  if (stage === 'submitted') {
    submittedAt = at;
    fundedAt = null;
  } else {
    fundedAt = at;
    if (dayKey(deal.submitted_at) === dayKey(deal.funded_at)) submittedAt = at;
  }

  const write: DealWrite = {
    stage,
    submitted_at: submittedAt,
    funded_at: fundedAt,
    loan_size: input.loanSize,
    commission_amount: stage === 'funded' ? input.commissionAmount : null,
    transaction_label: normalizeTransactionLabel(input.transactionLabel),
  };

  const day = identityDay(write);
  if (
    day &&
    dealIdentityClash(
      { day, loanSize: write.loan_size, transactionLabel: write.transaction_label },
      others,
    )
  ) {
    return {
      error: 'Another file for this person already has that size and label on that day.',
    };
  }

  return write;
}

export function planContactEventSync(args: {
  contactId: string | null;
  deals: CorrectionDeal[];
  events: CorrectionEvent[];
}): EventSyncPlan {
  const deals = forContact(args.deals, args.contactId);
  const events = forContact(args.events, args.contactId).filter(event => event.source === FORM_SOURCE);

  const deleteIds: string[] = [];
  const updates: EventTouch[] = [];

  const fundedDeals = deals.filter(deal => deal.stage === 'funded' && deal.funded_at);
  const fundedEvents = events.filter(event => FUNDED_TYPES.has(event.event_type));
  if (fundedDeals.length === 0) {
    deleteIds.push(...fundedEvents.map(event => event.id));
  } else {
    const earliest = minIso(fundedDeals.map(deal => deal.funded_at!));
    const money = fundedDeals.find(deal => deal.funded_at === earliest) ?? fundedDeals[0];
    for (const event of fundedEvents) {
      updates.push({
        id: event.id,
        occurred_at: earliest,
        loan_size: money.loan_size,
        commission_amount: money.commission_amount,
      });
    }
  }

  const realSubs = deals.filter(deal => countsAsRealSubmission(deal));
  const submissionEvents = events.filter(event => SUBMISSION_TYPES.has(event.event_type));
  if (realSubs.length === 0) {
    deleteIds.push(...submissionEvents.map(event => event.id));
  } else {
    const earliest = minIso(realSubs.map(deal => deal.submitted_at));
    const money = realSubs.find(deal => deal.submitted_at === earliest) ?? realSubs[0];
    for (const event of submissionEvents) {
      updates.push({
        id: event.id,
        occurred_at: earliest,
        loan_size: money.loan_size,
        commission_amount: null,
      });
    }
  }

  return { deleteIds, updates };
}

export function planLeadCleanup(events: CorrectionEvent[], deletingIds: string[]): string[] {
  const deleting = new Set(deletingIds);
  const remaining = events.filter(event => !deleting.has(event.id));
  const leftover = remaining.filter(
    event => !(event.event_type === 'lead' && event.source === FORM_SOURCE),
  );
  if (leftover.length > 0) return [];
  return remaining
    .filter(event => event.event_type === 'lead' && event.source === FORM_SOURCE)
    .map(event => event.id);
}

export function planRemoval(args: {
  contactId: string | null;
  removedDealId: string | null;
  removedEventId: string | null;
  deals: CorrectionDeal[];
  events: CorrectionEvent[];
}): string[] {
  const deals = args.removedDealId
    ? args.deals.filter(deal => deal.id !== args.removedDealId)
    : args.deals;
  const sync = planContactEventSync({ contactId: args.contactId, deals, events: args.events });
  const deleteIds = [...sync.deleteIds];
  if (args.removedEventId && !deleteIds.includes(args.removedEventId)) {
    deleteIds.push(args.removedEventId);
  }
  const contactEvents = forContact(args.events, args.contactId);
  deleteIds.push(...planLeadCleanup(contactEvents, deleteIds));
  return deleteIds;
}

function stageOfDeal(deal: CorrectionDeal): CorrectionStage {
  if (deal.stage === 'funded') return 'funded';
  if (deal.fell_out_at) return 'fell_out';
  return 'submitted';
}

function eventStage(event: CorrectionEvent): CorrectionStage | null {
  if (PROPOSAL_TYPES.has(event.event_type)) return 'proposal';
  if (SUBMISSION_TYPES.has(event.event_type)) return 'submitted';
  if (FUNDED_TYPES.has(event.event_type)) return 'funded';
  return null;
}

export function buildConversionLogRows(
  deals: CorrectionDeal[],
  events: CorrectionEvent[],
): ConversionLogRow[] {
  const formDeals = deals.filter(deal => deal.source === FORM_SOURCE);
  const formEvents = events.filter(event => event.source === FORM_SOURCE);
  const rows: ConversionLogRow[] = [];

  for (const deal of formDeals) {
    const occurred = deal.stage === 'funded' ? deal.funded_at ?? deal.submitted_at : deal.submitted_at;
    rows.push({
      id: deal.id,
      kind: 'deal',
      stage: stageOfDeal(deal),
      lead_name: deal.lead_name?.trim() || 'Unknown',
      lead_phone: deal.lead_phone,
      occurred_on: occurred.slice(0, 10),
      submitted_on: deal.submitted_at.slice(0, 10),
      loan_size: deal.loan_size,
      commission_amount: deal.stage === 'funded' ? deal.commission_amount : null,
      transaction_label: deal.transaction_label,
      ghl_contact_id: deal.ghl_contact_id,
    });
  }

  const fundedContacts = new Set(
    formDeals.filter(deal => deal.stage === 'funded').map(deal => deal.ghl_contact_id).filter(Boolean),
  );
  const submissionContacts = new Set(
    formDeals.filter(deal => countsAsRealSubmission(deal)).map(deal => deal.ghl_contact_id).filter(Boolean),
  );

  for (const event of formEvents) {
    const stage = eventStage(event);
    if (!stage || !event.occurred_at) continue;
    if (stage === 'funded' && event.ghl_contact_id && fundedContacts.has(event.ghl_contact_id)) continue;
    if (stage === 'submitted' && event.ghl_contact_id && submissionContacts.has(event.ghl_contact_id)) continue;
    if (stage !== 'proposal' && stage !== 'funded' && stage !== 'submitted') continue;
    if ((stage === 'funded' || stage === 'submitted') && !event.ghl_contact_id) continue;
    rows.push({
      id: event.id,
      kind: 'event',
      stage,
      lead_name: event.lead_name?.trim() || 'Unknown',
      lead_phone: event.lead_phone,
      occurred_on: event.occurred_at.slice(0, 10),
      submitted_on: null,
      loan_size: event.loan_size,
      commission_amount: null,
      transaction_label: null,
      ghl_contact_id: event.ghl_contact_id,
    });
  }

  rows.sort((a, b) => {
    if (a.occurred_on !== b.occurred_on) return b.occurred_on.localeCompare(a.occurred_on);
    return a.lead_name.localeCompare(b.lead_name);
  });
  return rows;
}

export function parseDealEditBody(body: unknown): { error: string } | DealEditInput {
  if (!body || typeof body !== 'object') return { error: 'Invalid payload.' };
  const record = body as Record<string, unknown>;
  const occurredOn = parseLoanLogDate(record.occurred_on);
  if (!occurredOn) return { error: 'Enter a valid date.' };

  const loanSize = parseMoney(record.loan_size);
  if (loanSize == null || loanSize <= 0) return { error: 'Loan size is required.' };

  let commissionAmount: number | null = null;
  if (record.commission_amount != null && record.commission_amount !== '') {
    commissionAmount = parseMoney(record.commission_amount);
    if (commissionAmount == null) return { error: 'Commission has to be a dollar amount.' };
  }

  return {
    occurredOn,
    loanSize,
    commissionAmount,
    transactionLabel: normalizeTransactionLabel(record.transaction_label),
    pullBackToSubmitted: record.pull_back_to_submitted === true,
  };
}

export function parseEventEditBody(
  body: unknown,
): { error: string } | { occurredOn: string; loanSize: number | null } {
  if (!body || typeof body !== 'object') return { error: 'Invalid payload.' };
  const record = body as Record<string, unknown>;
  const occurredOn = parseLoanLogDate(record.occurred_on);
  if (!occurredOn) return { error: 'Enter a valid date.' };
  const loanSize =
    record.loan_size == null || record.loan_size === '' ? null : parseMoney(record.loan_size);
  if (record.loan_size != null && record.loan_size !== '' && (loanSize == null || loanSize <= 0)) {
    return { error: 'Loan size is required.' };
  }
  return { occurredOn, loanSize };
}

function parseMoney(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
