import {
  buildConversionLogRows,
  FORM_SOURCE,
  noonUtc,
  planContactEventSync,
  planDealWrite,
  planRemoval,
  type CorrectionDeal,
  type CorrectionEvent,
  type ConversionLogRow,
  type DealEditInput,
  type EventSyncPlan,
} from '@/lib/conversion-log-corrections';
import type { createServiceClient } from '@/lib/supabase';

type Service = ReturnType<typeof createServiceClient>;

const DEAL_SELECT =
  'id, stage, submitted_at, funded_at, fell_out_at, loan_size, commission_amount, transaction_label, ghl_contact_id, source, lead_name, lead_phone, raw';

const EVENT_SELECT =
  'id, event_type, ghl_contact_id, occurred_at, lead_name, lead_phone, raw';

const STAGE_EVENT_TYPES = [
  'proposal_made',
  'proposal_sent',
  'submission_made',
  'loan_processing',
  'loan_funded',
  'closed',
];

type DealRow = {
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
  raw: unknown;
};

type EventRow = {
  id: string;
  event_type: string;
  ghl_contact_id: string | null;
  occurred_at: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  raw: unknown;
};

function eventSource(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = (raw as { source?: unknown }).source;
  return typeof source === 'string' ? source : null;
}

function eventLoanSize(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as { loan_size?: unknown }).loan_size;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asDeal(row: DealRow): CorrectionDeal {
  return {
    id: row.id,
    stage: row.stage,
    submitted_at: row.submitted_at,
    funded_at: row.funded_at,
    fell_out_at: row.fell_out_at,
    loan_size: row.loan_size == null ? null : Number(row.loan_size),
    commission_amount: row.commission_amount == null ? null : Number(row.commission_amount),
    transaction_label: row.transaction_label,
    ghl_contact_id: row.ghl_contact_id,
    source: row.source,
    lead_name: row.lead_name,
    lead_phone: row.lead_phone,
  };
}

function asEvent(row: EventRow): CorrectionEvent {
  return {
    id: row.id,
    event_type: row.event_type,
    ghl_contact_id: row.ghl_contact_id,
    occurred_at: row.occurred_at,
    source: eventSource(row.raw),
    loan_size: eventLoanSize(row.raw),
    lead_name: row.lead_name,
    lead_phone: row.lead_phone,
  };
}

async function loadDeals(service: Service, clientId: string): Promise<DealRow[]> {
  const { data, error } = await service
    .from('loan_deals')
    .select(DEAL_SELECT)
    .eq('client_id', clientId)
    .eq('source', FORM_SOURCE)
    .order('submitted_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as DealRow[];
}

async function loadEvents(service: Service, clientId: string): Promise<EventRow[]> {
  const { data, error } = await service
    .from('events')
    .select(EVENT_SELECT)
    .eq('client_id', clientId)
    .in('event_type', STAGE_EVENT_TYPES)
    .order('occurred_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

async function loadContactStageEvents(service: Service, clientId: string, contactId: string): Promise<EventRow[]> {
  const { data, error } = await service
    .from('events')
    .select(EVENT_SELECT)
    .eq('client_id', clientId)
    .eq('ghl_contact_id', contactId)
    .in('event_type', [...STAGE_EVENT_TYPES, 'lead'])
    .order('occurred_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

async function contactHasOtherActivity(
  service: Service,
  clientId: string,
  contactId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from('events')
    .select('id')
    .eq('client_id', clientId)
    .eq('ghl_contact_id', contactId)
    .not('event_type', 'in', `(${[...STAGE_EVENT_TYPES, 'lead'].map(type => `"${type}"`).join(',')})`)
    .limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

export async function listConversionLogs(service: Service, clientId: string): Promise<ConversionLogRow[]> {
  const [deals, events] = await Promise.all([
    loadDeals(service, clientId),
    loadEvents(service, clientId),
  ]);
  return buildConversionLogRows(deals.map(asDeal), events.map(asEvent)).slice(0, 400);
}

function mergeRaw(raw: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  return { ...base, ...patch, source: FORM_SOURCE };
}

async function applyEventPlan(service: Service, plan: EventSyncPlan, events: EventRow[]): Promise<void> {
  const byId = new Map(events.map(event => [event.id, event]));
  if (plan.deleteIds.length > 0) {
    const { error } = await service.from('events').delete().in('id', plan.deleteIds);
    if (error) throw new Error(error.message);
  }

  for (const update of plan.updates) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    const sameDay = existing.occurred_at?.slice(0, 10) === update.occurred_at.slice(0, 10);
    const sameSize = eventLoanSize(existing.raw) === update.loan_size;
    if (sameDay && sameSize) continue;
    const raw = mergeRaw(existing.raw, {
      loan_size: update.loan_size,
      ...(update.commission_amount != null ? { commission_amount: update.commission_amount } : {}),
    });
    if (update.commission_amount == null) delete raw.commission_amount;
    const { error } = await service
      .from('events')
      .update({
        occurred_at: update.occurred_at,
        occurred_at_has_time: false,
        raw,
      })
      .eq('id', update.id);
    if (error) throw new Error(error.message);
  }
}

async function syncContact(
  service: Service,
  clientId: string,
  contactId: string | null,
  deleteIds: string[] = [],
): Promise<void> {
  if (!contactId && deleteIds.length === 0) return;
  const [deals, events] = await Promise.all([
    contactId
      ? service
          .from('loan_deals')
          .select(DEAL_SELECT)
          .eq('client_id', clientId)
          .eq('ghl_contact_id', contactId)
          .limit(100)
          .then(result => {
            if (result.error) throw new Error(result.error.message);
            return (result.data ?? []) as DealRow[];
          })
      : Promise.resolve([] as DealRow[]),
    contactId ? loadContactStageEvents(service, clientId, contactId) : Promise.resolve([] as EventRow[]),
  ]);

  const plan = contactId
    ? planContactEventSync({
        contactId,
        deals: deals.map(asDeal),
        events: events.map(asEvent),
      })
    : { deleteIds: [], updates: [] };
  const extra = deleteIds.filter(id => !plan.deleteIds.includes(id));
  await applyEventPlan(service, { ...plan, deleteIds: [...plan.deleteIds, ...extra] }, events);
}

function duplicateMessage(error: { code?: string; message: string }): string | null {
  if (error.code === '23505') {
    return 'Another file for this person already has that size and label on that day.';
  }
  return null;
}

export async function updateDealLog(
  service: Service,
  clientId: string,
  dealId: string,
  input: DealEditInput,
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await service
    .from('loan_deals')
    .select(DEAL_SELECT)
    .eq('id', dealId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: 'That log was not found.' };
  const current = asDeal(data as DealRow);
  if (current.source !== FORM_SOURCE) {
    return { error: 'Only logs from the client events tracker can be changed here.' };
  }

  const othersResult = current.ghl_contact_id
    ? await service
        .from('loan_deals')
        .select(DEAL_SELECT)
        .eq('client_id', clientId)
        .eq('ghl_contact_id', current.ghl_contact_id)
        .neq('id', dealId)
        .limit(100)
    : { data: [], error: null };
  if (othersResult.error) throw new Error(othersResult.error.message);
  const others = ((othersResult.data ?? []) as DealRow[]).map(asDeal);

  const planned = planDealWrite(current, others, input);
  if ('error' in planned) return planned;

  const raw = mergeRaw((data as DealRow).raw, {
    loan_size: planned.loan_size,
    ...(planned.commission_amount != null ? { commission_amount: planned.commission_amount } : {}),
    ...(planned.transaction_label ? { transaction_label: planned.transaction_label } : {}),
  });
  if (planned.commission_amount == null) delete raw.commission_amount;
  if (!planned.transaction_label) delete raw.transaction_label;

  const { error: updateError } = await service
    .from('loan_deals')
    .update({
      ...planned,
      raw,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId)
    .eq('client_id', clientId);
  if (updateError) {
    const clash = duplicateMessage(updateError);
    if (clash) return { error: clash };
    throw new Error(updateError.message);
  }

  await syncContact(service, clientId, current.ghl_contact_id);
  return { ok: true };
}

export async function updateEventLog(
  service: Service,
  clientId: string,
  eventId: string,
  input: { occurredOn: string; loanSize: number | null },
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await service
    .from('events')
    .select(EVENT_SELECT)
    .eq('id', eventId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: 'That log was not found.' };
  const current = asEvent(data as EventRow);
  if (current.source !== FORM_SOURCE) {
    return { error: 'Only logs from the client events tracker can be changed here.' };
  }
  if (!['proposal_made', 'proposal_sent', 'submission_made', 'loan_processing', 'loan_funded', 'closed'].includes(current.event_type)) {
    return { error: 'That log cannot be edited here.' };
  }

  const raw = mergeRaw((data as EventRow).raw, {
    ...(input.loanSize != null ? { loan_size: input.loanSize } : {}),
  });
  const { error: updateError } = await service
    .from('events')
    .update({
      occurred_at: noonUtc(input.occurredOn),
      occurred_at_has_time: false,
      raw,
    })
    .eq('id', eventId)
    .eq('client_id', clientId);
  if (updateError) throw new Error(updateError.message);
  return { ok: true };
}

export async function removeConversionLog(
  service: Service,
  clientId: string,
  kind: 'deal' | 'event',
  id: string,
): Promise<{ ok: true } | { error: string }> {
  if (kind === 'deal') {
    const { data, error } = await service
      .from('loan_deals')
      .select(DEAL_SELECT)
      .eq('id', id)
      .eq('client_id', clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { error: 'That log was not found.' };
    const current = asDeal(data as DealRow);
    if (current.source !== FORM_SOURCE) {
      return { error: 'Only logs from the client events tracker can be changed here.' };
    }

    const contactId = current.ghl_contact_id;
    const dealRows = contactId
      ? await service
          .from('loan_deals')
          .select(DEAL_SELECT)
          .eq('client_id', clientId)
          .eq('ghl_contact_id', contactId)
          .limit(100)
          .then(result => {
            if (result.error) throw new Error(result.error.message);
            return (result.data ?? []) as DealRow[];
          })
      : [];
    const eventRows = contactId ? await loadContactStageEvents(service, clientId, contactId) : [];
    const keepLead = contactId ? await contactHasOtherActivity(service, clientId, contactId) : false;

    let deleteIds = planRemoval({
      contactId,
      removedDealId: current.id,
      removedEventId: null,
      deals: dealRows.map(asDeal),
      events: eventRows.map(asEvent),
    });
    if (keepLead) {
      const leadIds = new Set(eventRows.filter(row => row.event_type === 'lead').map(row => row.id));
      deleteIds = deleteIds.filter(eventId => !leadIds.has(eventId));
    }

    const { error: deleteError } = await service
      .from('loan_deals')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId);
    if (deleteError) throw new Error(deleteError.message);

    if (deleteIds.length > 0) {
      const { error: eventError } = await service.from('events').delete().in('id', deleteIds);
      if (eventError) throw new Error(eventError.message);
    }
    await syncContact(service, clientId, contactId);
    return { ok: true };
  }

  const { data, error } = await service
    .from('events')
    .select(EVENT_SELECT)
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: 'That log was not found.' };
  const current = asEvent(data as EventRow);
  if (current.source !== FORM_SOURCE) {
    return { error: 'Only logs from the client events tracker can be changed here.' };
  }

  const contactId = current.ghl_contact_id;
  const eventRows = contactId ? await loadContactStageEvents(service, clientId, contactId) : [];
  const dealRows = contactId
    ? await service
        .from('loan_deals')
        .select(DEAL_SELECT)
        .eq('client_id', clientId)
        .eq('ghl_contact_id', contactId)
        .limit(100)
        .then(result => {
          if (result.error) throw new Error(result.error.message);
          return (result.data ?? []) as DealRow[];
        })
    : [];
  const keepLead = contactId ? await contactHasOtherActivity(service, clientId, contactId) : false;

  let deleteIds = planRemoval({
    contactId,
    removedDealId: null,
    removedEventId: current.id,
    deals: dealRows.map(asDeal),
    events: eventRows.map(asEvent),
  });
  if (keepLead) {
    const leadIds = new Set(eventRows.filter(row => row.event_type === 'lead').map(row => row.id));
    deleteIds = deleteIds.filter(eventId => !leadIds.has(eventId));
  }
  if (deleteIds.length === 0) return { ok: true };
  const { error: eventError } = await service.from('events').delete().in('id', deleteIds);
  if (eventError) throw new Error(eventError.message);
  return { ok: true };
}
