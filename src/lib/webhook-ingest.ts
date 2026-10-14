import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeStoredAgentName } from '@/lib/agent-name-aliases';
import { isAiBookedFromPayload, needsAgentCredit } from '@/lib/credit-queue-eligibility';
import { parseYnFlag } from '@/lib/metrics';
import { resolveClientId } from '@/lib/resolve-client';
import { recordingUrlField } from '@/lib/recording-url';
import {
  normalizeTimestamp,
  normalizeTimeZone,
  CALL_CENTER_TIMEZONE,
  INGEST_SOURCE_TIMEZONE,
} from '@/lib/time';
import { onEventTouchpointHooks } from '@/lib/cs-touchpoint-rules';
import { ensureDealFromConversionEvent } from '@/lib/loan-deals';
import { sendMetaStages, stagesForEvent, stagesForFlagChange } from '@/lib/meta-capi';
import {
  OUTCOME_EVENT_TYPES,
  propagateBookingAgentToOutcomes,
  resolveOutcomeAgentFromBooking,
  supersedePriorPendingBookings,
} from '@/lib/appointments';

export const VALID_EVENT_TYPES = [
  'dial', 'lead', 'appointment_booked', 'show', 'no_show', 'callback_booked',
  'live_transfer', 'proposal_sent', 'loan_processing', 'closed', 'out_of_state_lead',
  'proposal_made', 'submission_made', 'loan_funded',
  'appointment_cancelled', 'appointment_rescheduled', 'lo_bailed', 'lo_audit', 'claimed',
  'manual_dq',
] as const;

const QUOTE_ONLY_VALUE = /^["'`\s]+$/;

function isTruthyPayloadFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  return false;
}

export function normalizeEventType(eventType: string): string {
  if (eventType === 'proposal_sent') return 'proposal_made';
  if (eventType === 'loan_processing') return 'submission_made';
  if (eventType === 'closed') return 'loan_funded';
  return eventType;
}

function resolveRecordingUrl(payload: Record<string, unknown>): string | null {
  return (
    recordingUrlField(payload.recording_url) ??
    recordingUrlField(payload.recordingUrl) ??
    recordingUrlField(payload.attachments) ??
    recordingUrlField(payload.message_attachments)
  );
}

function jsonSafeString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;

  let s = v.trim();
  if (!s || QUOTE_ONLY_VALUE.test(s)) return null;

  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!s || QUOTE_ONLY_VALUE.test(s)) return null;

  return s;
}

export function jsonStringField(v: unknown): string | null {
  return jsonSafeString(v);
}

export function sanitizeWebhookPayload(value: unknown): unknown {
  if (typeof value === 'string') return jsonSafeString(value) ?? '';
  if (Array.isArray(value)) return value.map(sanitizeWebhookPayload);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeWebhookPayload(v);
    }
    return out;
  }
  return value;
}

function numberField(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function booleanField(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
}

export type IngestWebhookResult =
  | {
      ok: true;
      updated?: boolean;
      event_id?: string;
      duplicate?: boolean;
      skipped?: boolean;
      superseded_ids?: string[];
      normalized_event_type: string;
      source_event_type: string;
    }
  | { error: string; status: 400 | 404 | 500 };

export async function ingestWebhookEvent(
  service: SupabaseClient,
  payload: Record<string, unknown>,
  opts?: { client_id?: string },
): Promise<IngestWebhookResult> {
  const eventType = payload.event_type;
  if (typeof eventType !== 'string' || !VALID_EVENT_TYPES.includes(eventType as (typeof VALID_EVENT_TYPES)[number])) {
    return {
      error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
      status: 400,
    };
  }

  const normalizedEventType = normalizeEventType(eventType);
  const agentName = normalizeStoredAgentName(jsonStringField(payload.agent_name));
  if (agentName) payload.agent_name = agentName;

  let client_id = opts?.client_id;

  if (!client_id) {
    const resolved = await resolveClientId(service, payload, jsonStringField);
    if ('error' in resolved) {
      return { error: resolved.error, status: resolved.status };
    }
    client_id = resolved.client_id;
  }

  if (normalizedEventType === 'lead' && isTruthyPayloadFlag(payload.update_flags_only)) {
    const ghlContactId = jsonStringField(payload.ghl_contact_id);
    if (!ghlContactId) {
      return { error: 'ghl_contact_id is required when update_flags_only is true', status: 400 };
    }

    const { data: rows, error: selErr } = await service
      .from('events')
      .select('id, lead_id, fbclid, raw, is_qualified, is_hot, is_out_of_state')
      .eq('client_id', client_id)
      .eq('event_type', 'lead')
      .eq('ghl_contact_id', ghlContactId)
      .order('occurred_at', { ascending: true })
      .limit(1);

    if (selErr) return { error: selErr.message, status: 500 };

    const existing = rows?.[0];
    if (!existing) {
      return {
        error:
          'No existing lead event for this ghl_contact_id. Send the initial lead webhook first, or omit update_flags_only.',
        status: 404,
      };
    }

    const updates: Record<string, unknown> = {};

    if ('is_qualified' in payload || 'qualified' in payload) {
      updates.is_qualified = parseYnFlag(payload.is_qualified ?? payload.qualified);
    }
    if ('is_hot' in payload || 'hot' in payload) {
      updates.is_hot = parseYnFlag(payload.is_hot ?? payload.hot);
    }
    if ('is_out_of_state' in payload || 'out_of_state' in payload) {
      updates.is_out_of_state = parseYnFlag(payload.is_out_of_state ?? payload.out_of_state);
    }

    if (Object.keys(updates).length === 0) {
      return {
        error:
          'No flags to update. Include is_qualified, is_hot, and/or is_out_of_state (or qualified, hot, out_of_state).',
        status: 400,
      };
    }

    const incomingFbclid = jsonStringField(payload.fbclid);
    if (incomingFbclid && !jsonStringField(existing.fbclid)) {
      updates.fbclid = incomingFbclid;
    }

    const prevRaw =
      typeof existing.raw === 'object' && existing.raw !== null && !Array.isArray(existing.raw)
        ? (existing.raw as Record<string, unknown>)
        : {};
    updates.raw = {
      ...prevRaw,
      ...(sanitizeWebhookPayload(payload) as Record<string, unknown>),
      _flags_updated_at: new Date().toISOString(),
    };

    const { error: updErr } = await service.from('events').update(updates).eq('id', existing.id);
    if (updErr) return { error: updErr.message, status: 500 };

    const flagStages = stagesForFlagChange(
      { is_qualified: existing.is_qualified, is_hot: existing.is_hot },
      {
        is_qualified: updates.is_qualified === true ? true : undefined,
        is_hot: updates.is_hot === true ? true : undefined,
      },
    );
    if (flagStages.length > 0 && client_id) {
      await sendMetaStages(service, {
        clientId: client_id,
        stages: flagStages,
        eventId: existing.id,
        leadId: jsonStringField(existing.lead_id),
        occurredAt: new Date().toISOString(),
        ghlContactId,
        email: jsonStringField(payload.lead_email),
        phone: jsonStringField(payload.lead_phone),
        fbclid: incomingFbclid,
        raw: payload,
      });
    }

    return {
      ok: true,
      updated: true,
      event_id: existing.id,
      normalized_event_type: normalizedEventType,
      source_event_type: eventType,
    };
  }

  let clientTz = CALL_CENTER_TIMEZONE;
  {
    const { data: clientRow } = await service
      .from('clients')
      .select('timezone')
      .eq('id', client_id)
      .maybeSingle();
    if (clientRow?.timezone) clientTz = clientRow.timezone;
  }

  const leadTz = normalizeTimeZone(payload.lead_timezone ?? payload.timezone);
  const occurredFallbackTz =
    eventType === 'lead'
      ? leadTz ?? INGEST_SOURCE_TIMEZONE
      : eventType === 'dial'
        ? INGEST_SOURCE_TIMEZONE
        : clientTz;
  const occ = normalizeTimestamp(payload.occurred_at, occurredFallbackTz);
  const occurredAtIso = occ.iso ?? new Date().toISOString();
  const occurredHasTime = occ.iso === null ? true : occ.hasTime;

  let lead_created_at: string | null = null;
  if (eventType === 'dial') {
    const lc = normalizeTimestamp(
      payload.lead_created_at ?? payload.lead_created_date,
      leadTz ?? INGEST_SOURCE_TIMEZONE,
    );
    if (lc.iso && lc.hasTime) lead_created_at = lc.iso;
  }

  let speed_to_lead_seconds = payload.speed_to_lead_seconds ?? null;
  const dialGhlContactId = jsonStringField(payload.ghl_contact_id);
  if (
    eventType === 'dial' &&
    speed_to_lead_seconds === null &&
    occurredHasTime &&
    dialGhlContactId
  ) {
    const [{ data: priorDial }, { data: leadEvent }] = await Promise.all([
      service
        .from('events')
        .select('id')
        .eq('client_id', client_id)
        .eq('event_type', 'dial')
        .eq('ghl_contact_id', dialGhlContactId)
        .limit(1)
        .maybeSingle(),
      service
        .from('events')
        .select('occurred_at, occurred_at_has_time')
        .eq('client_id', client_id)
        .eq('event_type', 'lead')
        .eq('ghl_contact_id', dialGhlContactId)
        .order('occurred_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!priorDial) {
      let leadMs: number | null = null;
      if (lead_created_at) {
        leadMs = new Date(lead_created_at).getTime();
      } else if (leadEvent && leadEvent.occurred_at_has_time !== false) {
        leadMs = new Date(leadEvent.occurred_at).getTime();
      }
      const dialMs = new Date(occurredAtIso).getTime();
      if (leadMs !== null && dialMs > leadMs) {
        speed_to_lead_seconds = Math.floor((dialMs - leadMs) / 1000);
      }
    }
  }

  const isLead = eventType === 'lead';
  const isManualDq = normalizedEventType === 'manual_dq';
  const duration_seconds = numberField(payload.duration_seconds);
  const isDial = eventType === 'dial';
  const is_pickup =
    isDial ? booleanField(payload.is_pickup) ?? (duration_seconds != null ? duration_seconds >= 40 : null) : null;
  const is_conversation =
    isDial
      ? booleanField(payload.is_conversation) ??
        (duration_seconds != null ? duration_seconds >= 120 : null)
      : null;
  const calIdRaw = payload.calendar_id ?? payload.ghl_calendar_id;
  const calendar_id = jsonStringField(calIdRaw);
  const external_id = jsonStringField(payload.external_id ?? payload.ghl_appointment_id);
  const dial_source = jsonStringField(
    payload.dial_source ?? payload.software ?? payload.dialer_source ?? payload.call_source,
  );

  const utm_source = jsonStringField(payload.utm_source);
  const utm_campaign = jsonStringField(payload.utm_campaign);
  const utm_term = jsonStringField(payload.utm_term ?? payload.utmTerm);
  const fbclid = jsonStringField(payload.fbclid);
  const ad_name = jsonStringField(payload.ad_name ?? payload.adName ?? payload.utm_content);
  // Make only maps GHL "UTM Ad Name" → ad_name today. Stamp utm_content as the
  // immutable original so later ad_name remaps cannot silently move attribution.
  const utm_content = jsonStringField(payload.utm_content) ?? ad_name;
  const adset_name = jsonStringField(payload.adset_name ?? payload.ad_set_name ?? payload.adSetName);
  const campaign_name = jsonStringField(
    payload.campaign_name ?? payload.campaignName ?? payload.utm_campaign,
  );
  const lead_source = jsonStringField(
    payload.lead_source ?? payload.leadSource ?? payload.list_source ?? payload.listSource,
  );

  const isCreditableBooking =
    normalizedEventType === 'appointment_booked' || normalizedEventType === 'callback_booked';
  const is_ai_booked = isCreditableBooking ? isAiBookedFromPayload(payload) : null;

  const scheduled_at = normalizeTimestamp(payload.scheduled_at, clientTz).iso;
  const ghl_contact_id = jsonStringField(payload.ghl_contact_id);
  const lead_name = jsonStringField(payload.lead_name);
  const lead_phone = jsonStringField(payload.lead_phone);
  const lead_email = jsonStringField(payload.lead_email);
  const calendar_name = jsonStringField(payload.calendar_name);
  const stage_booked = jsonStringField(payload.stage_booked);
  const previous_external_id = jsonStringField(
    payload.previous_external_id ?? payload.previous_appointment_id ?? payload.prior_external_id,
  );

  let dq_reason = isManualDq
    ? jsonStringField(payload.dq_reason ?? payload.reason ?? payload.disqualify_reason)
    : null;
  if (isManualDq && !dq_reason) {
    const reasons = payload.dq_reasons;
    if (Array.isArray(reasons) && reasons.length > 0) {
      dq_reason = reasons
        .map(r => (typeof r === 'string' ? r.trim() : ''))
        .filter(Boolean)
        .join('; ');
    }
  }

  let lead_event_id = isManualDq ? jsonStringField(payload.lead_event_id) : null;
  if (isManualDq && !lead_event_id && ghl_contact_id && client_id) {
    const { data: sourceLead } = await service
      .from('events')
      .select('id')
      .eq('client_id', client_id)
      .eq('event_type', 'lead')
      .eq('ghl_contact_id', ghl_contact_id)
      .order('occurred_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    lead_event_id = sourceLead?.id ?? null;
  }

  // Outcomes (show / no_show / …) often arrive from GHL with blank agent_name.
  // Inherit the booking agent so payroll + KPIs credit the setter who booked.
  const isOutcomeEvent = (OUTCOME_EVENT_TYPES as readonly string[]).includes(normalizedEventType);
  let resolvedAgentName = agentName;
  let inheritedBookingId: string | null = null;
  if (isOutcomeEvent && needsAgentCredit(agentName)) {
    try {
      const resolved = await resolveOutcomeAgentFromBooking(service, {
        agent_name: agentName,
        external_id,
        ghl_contact_id,
        scheduled_at,
        client_id,
        lead_phone,
        raw: payload,
      });
      if (resolved.agent_name) {
        resolvedAgentName = resolved.agent_name;
        inheritedBookingId = resolved.booking_id;
      }
    } catch (err) {
      console.error('[webhook-ingest] resolve outcome agent from booking failed', err);
    }
  }

  const eventRow = {
    client_id,
    event_type: normalizedEventType,
    occurred_at: occurredAtIso,
    occurred_at_has_time: occurredHasTime,
    lead_created_at,
    lead_timezone: leadTz,
    duration_seconds,
    is_pickup,
    is_conversation,
    is_qualified: isLead ? parseYnFlag(payload.is_qualified ?? payload.qualified) : null,
    is_hot: isLead ? parseYnFlag(payload.is_hot ?? payload.hot) : null,
    is_out_of_state: isLead ? parseYnFlag(payload.is_out_of_state ?? payload.out_of_state) : null,
    speed_to_lead_seconds,
    ghl_contact_id,
    scheduled_at,
    external_id,
    calendar_name,
    calendar_id,
    lead_name,
    lead_phone,
    lead_email,
    agent_name: resolvedAgentName,
    direction: jsonStringField(payload.direction),
    call_status: jsonStringField(payload.call_status),
    recording_url: resolveRecordingUrl(payload),
    call_summary: jsonStringField(payload.call_summary),
    phone_number_used: jsonStringField(payload.phone_number_used),
    dial_source,
    stage_booked,
    ad_name,
    adset_name,
    campaign_name,
    utm_source,
    utm_campaign,
    utm_content,
    utm_term,
    fbclid,
    lead_source: isLead ? lead_source : null,
    is_ai_booked,
    dq_reason: isManualDq ? dq_reason : null,
    lead_event_id: isManualDq ? lead_event_id : null,
    raw:
      inheritedBookingId && typeof payload === 'object' && payload
        ? {
            ...payload,
            appointment_event_id: inheritedBookingId,
            agent_inherited_from_booking: true,
          }
        : payload,
  };

  // Same contact can only have one manual_dq — update reason/metadata in place.
  if (isManualDq && ghl_contact_id && client_id) {
    const { data: existingDq, error: findDqErr } = await service
      .from('events')
      .select('id')
      .eq('client_id', client_id)
      .eq('event_type', 'manual_dq')
      .eq('ghl_contact_id', ghl_contact_id)
      .maybeSingle();
    if (findDqErr) return { error: findDqErr.message, status: 500 };

    if (existingDq?.id) {
      const { error: updErr } = await service
        .from('events')
        .update({
          occurred_at: occurredAtIso,
          occurred_at_has_time: occurredHasTime,
          dq_reason,
          lead_event_id,
          lead_name,
          lead_phone,
          lead_email,
          agent_name: resolvedAgentName,
          ad_name,
          adset_name,
          campaign_name,
          utm_source,
          utm_campaign,
          utm_content,
          utm_term,
          raw: payload,
        })
        .eq('id', existingDq.id);
      if (updErr) return { error: updErr.message, status: 500 };
      return {
        ok: true,
        updated: true,
        event_id: existingDq.id,
        normalized_event_type: normalizedEventType,
        source_event_type: eventType,
      };
    }
  }

  // Same GHL appointment id → update scheduled time / metadata in place (reschedule
  // that keeps appointment.id). Matches acquisition/CS upsert behavior.
  if (normalizedEventType === 'appointment_booked' && external_id && client_id) {
    const { data: existing, error: findErr } = await service
      .from('events')
      .select('id')
      .eq('client_id', client_id)
      .eq('event_type', 'appointment_booked')
      .eq('external_id', external_id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) return { error: findErr.message, status: 500 };

    if (existing?.id) {
      const { error: updErr } = await service
        .from('events')
        .update({
          scheduled_at,
          calendar_name,
          calendar_id,
          lead_name,
          lead_phone,
          lead_email,
          agent_name: agentName,
          stage_booked,
          ghl_contact_id,
          is_ai_booked,
          raw: payload,
        })
        .eq('id', existing.id);
      if (updErr) return { error: updErr.message, status: 500 };

      // Booking agent may now be set — backfill linked null-agent outcomes.
      if (agentName && !needsAgentCredit(agentName)) {
        try {
          await propagateBookingAgentToOutcomes(service, {
            id: existing.id,
            agent_name: agentName,
            external_id,
            ghl_contact_id,
            scheduled_at,
            client_id,
            lead_phone,
          });
        } catch (err) {
          console.error('[webhook-ingest] propagate booking agent on update failed', err);
        }
      }

      return {
        ok: true,
        updated: true,
        event_id: existing.id,
        normalized_event_type: normalizedEventType,
        source_event_type: eventType,
      };
    }
  }

  const { data: inserted, error } = await service
    .from('events')
    .insert(eventRow)
    .select('id, lead_id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: true,
        duplicate: true,
        skipped: true,
        normalized_event_type: normalizedEventType,
        source_event_type: eventType,
      };
    }
    return { error: error.message, status: 500 };
  }

  let superseded_ids: string[] | undefined;
  if (normalizedEventType === 'appointment_booked' && inserted?.id && client_id) {
    try {
      const superseded = await supersedePriorPendingBookings(service, {
        clientId: client_id,
        ghlContactId: ghl_contact_id,
        newEventId: inserted.id,
        newExternalId: external_id,
        newCalendarId: calendar_id,
        newOccurredAt: occurredAtIso,
        previousExternalId: previous_external_id,
      });
      superseded_ids = superseded.superseded_ids;
    } catch (err) {
      console.error('[appointments] supersede prior bookings failed', err);
    }

    // Outcome rows (show) may already exist with null agent from an earlier webhook.
    if (agentName && !needsAgentCredit(agentName)) {
      try {
        await propagateBookingAgentToOutcomes(service, {
          id: inserted.id,
          agent_name: agentName,
          external_id,
          ghl_contact_id,
          scheduled_at,
          client_id,
          lead_phone,
        });
      } catch (err) {
        console.error('[webhook-ingest] propagate booking agent on insert failed', err);
      }
    }
  }

  if (inserted?.id && client_id) {
    try {
      await onEventTouchpointHooks(service, {
        clientId: client_id,
        eventType: normalizedEventType,
        eventId: inserted.id,
        occurredAt: typeof payload.occurred_at === 'string' ? payload.occurred_at : null,
      });
    } catch (err) {
      console.error('[cs_touchpoints] event hook failed', err);
    }

    try {
      await ensureDealFromConversionEvent(service, {
        eventId: inserted.id,
        clientId: client_id,
        eventType: normalizedEventType,
        occurredAt: occurredAtIso,
        ghlContactId: ghl_contact_id,
        leadName: lead_name,
        leadPhone: lead_phone,
        leadEmail: lead_email,
        raw: payload,
      });
    } catch (err) {
      console.error('[loan_deals] conversion event hook failed', err);
    }

    const metaStages = stagesForEvent({
      eventType: normalizedEventType,
      isQualified: eventRow.is_qualified === true,
      isHot: eventRow.is_hot === true,
    });
    if (metaStages.length > 0) {
      await sendMetaStages(service, {
        clientId: client_id,
        stages: metaStages,
        eventId: inserted.id,
        leadId: jsonStringField(inserted.lead_id),
        occurredAt: occurredAtIso,
        ghlContactId: ghl_contact_id,
        email: lead_email,
        phone: lead_phone,
        fbclid,
        raw: payload,
      });
    }
  }

  return {
    ok: true,
    event_id: inserted?.id,
    superseded_ids,
    normalized_event_type: normalizedEventType,
    source_event_type: eventType,
  };
}
