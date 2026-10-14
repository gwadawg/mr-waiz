import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseLoanSizeFromRaw } from '@/lib/loan-deals';

const GRAPH_VERSION = 'v20.0';
const SEND_TIMEOUT_MS = 8000;
const STALE_PENDING_MS = 60_000;

export const META_STAGES = [
  'qualified',
  'hot',
  'proposal_made',
  'submission_made',
  'loan_funded',
] as const;

export type MetaStage = (typeof META_STAGES)[number];

const STAGE_EVENT_NAME: Record<MetaStage, string> = {
  qualified: 'CompleteRegistration',
  hot: 'Contact',
  proposal_made: 'InitiateCheckout',
  submission_made: 'SubmitApplication',
  loan_funded: 'Purchase',
};

export function metaEventName(stage: MetaStage): string {
  return STAGE_EVENT_NAME[stage];
}

export function stagesForEvent(input: {
  eventType: string;
  isQualified: boolean;
  isHot: boolean;
}): MetaStage[] {
  const stages: MetaStage[] = [];
  if (input.eventType === 'lead') {
    if (input.isQualified) stages.push('qualified');
    if (input.isHot) stages.push('hot');
  } else if (
    input.eventType === 'proposal_made' ||
    input.eventType === 'submission_made' ||
    input.eventType === 'loan_funded'
  ) {
    stages.push(input.eventType);
  }
  return stages;
}

/** Newly true flags only. A flag that stays true does not send again. */
export function stagesForFlagChange(
  before: { is_qualified: boolean | null; is_hot: boolean | null },
  after: { is_qualified?: boolean; is_hot?: boolean },
): MetaStage[] {
  const stages: MetaStage[] = [];
  if (after.is_qualified === true && before.is_qualified !== true) stages.push('qualified');
  if (after.is_hot === true && before.is_hot !== true) stages.push('hot');
  return stages;
}

export function metaSourceKey(stage: MetaStage, id: string): string {
  if (stage === 'qualified') return `qualified:${id}`;
  if (stage === 'hot') return `hot:${id}`;
  return id;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashEmail(email: string | null | undefined): string | null {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  return sha256Hex(normalized);
}

/** Digits only, with a US country code when the number is 10 digits. */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export function hashPhone(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  return sha256Hex(digits);
}

export function hashExternalId(id: string | null | undefined): string | null {
  const normalized = (id ?? '').trim();
  if (!normalized) return null;
  return sha256Hex(normalized);
}

export function cleanFbclid(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed || null;
}

/** Meta click id. An already-built fbc value is kept as-is. */
export function buildFbc(fbclid: string | null | undefined, leadTimeMs: number): string | null {
  const value = cleanFbclid(fbclid);
  if (!value) return null;
  if (value.startsWith('fb.1.')) return value;
  const ms = Number.isFinite(leadTimeMs) && leadTimeMs > 0 ? Math.trunc(leadTimeMs) : Date.now();
  return `fb.1.${ms}.${value}`;
}

export type CapiIdentity = {
  email: string | null;
  phone: string | null;
  externalId: string | null;
  fbclid: string | null;
  leadTimeMs: number;
  eventTimeSec: number;
  value: number | null;
};

export function buildCapiEvent(
  stage: MetaStage,
  sourceId: string,
  identity: CapiIdentity,
): Record<string, unknown> | null {
  const em = hashEmail(identity.email);
  const ph = hashPhone(identity.phone);
  const externalId = hashExternalId(identity.externalId);
  const fbc = buildFbc(identity.fbclid, identity.leadTimeMs);
  if (!em && !ph && !fbc) return null;

  const userData: Record<string, unknown> = {};
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (externalId) userData.external_id = [externalId];
  if (fbc) userData.fbc = fbc;

  const event: Record<string, unknown> = {
    event_name: metaEventName(stage),
    event_time: identity.eventTimeSec,
    event_id: metaSourceKey(stage, sourceId),
    action_source: 'system_generated',
    user_data: userData,
  };

  if (stage === 'loan_funded' && identity.value != null && identity.value > 0) {
    event.custom_data = { currency: 'USD', value: identity.value };
  }
  return event;
}

type PixelRow = {
  id: string;
  pixel_id: string;
  access_token: string;
  test_event_code: string | null;
};

type LeadMatch = {
  fbclid: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  ghl_contact_id: string | null;
  lead_created_at: string | null;
  first_seen_at: string | null;
};

type SendRow = {
  id: string;
  status: string;
  created_at: string;
};

function eventTimeSec(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return Math.floor(Date.now() / 1000);
  return Math.floor(ms / 1000);
}

function leadTimeMs(lead: LeadMatch | null, occurredAt: string): number {
  const fromLead = Date.parse(lead?.lead_created_at ?? lead?.first_seen_at ?? '');
  if (Number.isFinite(fromLead)) return fromLead;
  const fromEvent = Date.parse(occurredAt);
  return Number.isFinite(fromEvent) ? fromEvent : Date.now();
}

function clipError(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

async function claimSend(
  service: SupabaseClient,
  row: {
    client_id: string;
    meta_pixel_id: string;
    source_key: string;
    event_name: string;
  },
): Promise<'skip' | 'send'> {
  const { data: existing, error: readError } = await service
    .from('meta_capi_sends')
    .select('id, status, created_at')
    .eq('source_key', row.source_key)
    .eq('event_name', row.event_name)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const prior = existing as SendRow | null;
  if (prior?.status === 'sent') return 'skip';
  if (prior?.status === 'pending') {
    const age = Date.now() - Date.parse(prior.created_at);
    if (Number.isFinite(age) && age < STALE_PENDING_MS) return 'skip';
  }

  if (!prior) {
    const { error } = await service.from('meta_capi_sends').insert({
      ...row,
      status: 'pending',
    });
    if (error?.code === '23505') return 'skip';
    if (error) throw new Error(error.message);
    return 'send';
  }

  const { error } = await service
    .from('meta_capi_sends')
    .update({ status: 'pending', error: null, meta_pixel_id: row.meta_pixel_id })
    .eq('id', prior.id);
  if (error) throw new Error(error.message);
  return 'send';
}

async function finishSend(
  service: SupabaseClient,
  sourceKey: string,
  eventName: string,
  result: { status: 'sent' | 'failed'; fbtraceId: string | null; error: string | null },
): Promise<void> {
  const { error } = await service
    .from('meta_capi_sends')
    .update({
      status: result.status,
      fbtrace_id: result.fbtraceId,
      error: result.error,
      sent_at: result.status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('source_key', sourceKey)
    .eq('event_name', eventName);
  if (error) console.error('[meta-capi] log update failed', error.message);
}

async function postEvent(
  pixel: PixelRow,
  event: Record<string, unknown>,
): Promise<{ ok: boolean; fbtraceId: string | null; error: string | null }> {
  const body: Record<string, unknown> = { data: [event] };
  if (pixel.test_event_code) body.test_event_code = pixel.test_event_code;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixel.pixel_id}/events?access_token=${encodeURIComponent(pixel.access_token)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    events_received?: number;
    fbtrace_id?: string;
    error?: { message?: string };
  };
  if (!response.ok || payload.error) {
    return {
      ok: false,
      fbtraceId: payload.fbtrace_id ?? null,
      error: clipError(payload.error?.message || `Meta responded ${response.status}`),
    };
  }
  return { ok: true, fbtraceId: payload.fbtrace_id ?? null, error: null };
}

async function purchaseValue(
  service: SupabaseClient,
  input: { stages: MetaStage[]; eventId: string; raw: unknown },
): Promise<number | null> {
  const fromRaw = parseLoanSizeFromRaw(input.raw);
  if (fromRaw != null && fromRaw > 0) return fromRaw;
  if (!input.stages.includes('loan_funded')) return fromRaw;
  const { data } = await service
    .from('loan_deals')
    .select('loan_size')
    .eq('conversion_event_id', input.eventId)
    .maybeSingle();
  const size = data?.loan_size != null ? Number(data.loan_size) : null;
  return size != null && Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * Send CRM stages for one ingested event. The pixel is the one selected on
 * that client's file. Never throws: a Meta failure must not reject the
 * webhook that already saved the event.
 */
export async function sendMetaStages(
  service: SupabaseClient,
  input: {
    clientId: string;
    stages: MetaStage[];
    eventId: string;
    leadId: string | null;
    occurredAt: string;
    ghlContactId: string | null;
    email: string | null;
    phone: string | null;
    fbclid: string | null;
    raw: unknown;
  },
): Promise<void> {
  if (input.stages.length === 0 || !input.clientId) return;

  try {
    const { data: clientRow, error: clientError } = await service
      .from('clients')
      .select('meta_pixel_id')
      .eq('id', input.clientId)
      .maybeSingle();
    if (clientError) {
      console.error('[meta-capi] client pixel lookup failed', clientError.message);
      return;
    }
    const selectedPixelId = (clientRow as { meta_pixel_id?: string | null } | null)?.meta_pixel_id;
    if (!selectedPixelId) return;

    const { data: pixelData, error: pixelError } = await service
      .from('meta_pixels')
      .select('id, pixel_id, access_token, test_event_code')
      .eq('id', selectedPixelId)
      .maybeSingle();
    if (pixelError) {
      console.error('[meta-capi] pixel lookup failed', pixelError.message);
      return;
    }
    const pixel = pixelData as PixelRow | null;
    if (!pixel) return;

    let lead: LeadMatch | null = null;
    if (input.leadId) {
      const { data } = await service
        .from('leads')
        .select('fbclid, lead_email, lead_phone, ghl_contact_id, lead_created_at, first_seen_at')
        .eq('id', input.leadId)
        .maybeSingle();
      lead = (data as LeadMatch | null) ?? null;
    } else if (input.ghlContactId) {
      const { data } = await service
        .from('leads')
        .select('fbclid, lead_email, lead_phone, ghl_contact_id, lead_created_at, first_seen_at')
        .eq('client_id', input.clientId)
        .eq('ghl_contact_id', input.ghlContactId)
        .is('merged_into_id', null)
        .limit(1)
        .maybeSingle();
      lead = (data as LeadMatch | null) ?? null;
    }

    const identityBase: CapiIdentity = {
      email: input.email || lead?.lead_email || null,
      phone: input.phone || lead?.lead_phone || null,
      externalId: input.ghlContactId || lead?.ghl_contact_id || null,
      fbclid: cleanFbclid(lead?.fbclid) || cleanFbclid(input.fbclid),
      leadTimeMs: leadTimeMs(lead, input.occurredAt),
      eventTimeSec: eventTimeSec(input.occurredAt),
      value: await purchaseValue(service, input),
    };
    const sourceId = input.leadId || input.eventId;

    for (const stage of input.stages) {
      const eventName = metaEventName(stage);
      const sourceKey = metaSourceKey(stage, stage === 'qualified' || stage === 'hot' ? sourceId : input.eventId);
      const event = buildCapiEvent(stage, stage === 'qualified' || stage === 'hot' ? sourceId : input.eventId, identityBase);
      if (!event) continue;

      const claim = await claimSend(service, {
        client_id: input.clientId,
        meta_pixel_id: pixel.id,
        source_key: sourceKey,
        event_name: eventName,
      });
      if (claim === 'skip') continue;

      try {
        const result = await postEvent(pixel, event);
        await finishSend(service, sourceKey, eventName, {
          status: result.ok ? 'sent' : 'failed',
          fbtraceId: result.fbtraceId,
          error: result.error,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Meta request failed';
        await finishSend(service, sourceKey, eventName, {
          status: 'failed',
          fbtraceId: null,
          error: clipError(message),
        });
      }
    }
  } catch (err) {
    console.error('[meta-capi] send failed', err);
  }
}
