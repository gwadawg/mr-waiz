import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import {
  addClickUpTaskComment,
  applyClickUpFieldMap,
  getClickUpToken,
} from '@/lib/clickup';
import { CLIENT_CALL_FIELDS } from '@/lib/client-calls';
import {
  canViewClientRevenue,
  redactClientMoneyFields,
} from '@/lib/client-revenue-access';
import { syncIsLiveWithLifecycle } from '@/lib/lifecycle-sync';
import {
  getOnboardingFormProfile,
  isClientVerticalConfirmed,
  validateKickoffClassification,
} from '@/lib/onboarding-form-profile';
import {
  KICKOFF_CLIENT_FIELDS,
  KICKOFF_CLICKUP_FIELDS,
  contactRoleNeedsConfirm,
  facebookFollowUpError,
  formatKickoffClickUpComment,
  getKickoffConfig,
  isKickoffFieldVisible,
  isKickoffIncomplete,
  applyKickoffSavedNarrative,
  KICKOFF_CC_NOTE_MARKER,
  KICKOFF_PM_NOTE_MARKER,
  kickoffClientFileNote,
  kickoffDraftFromClient,
  kickoffExtraFieldsFromDraft,
  kickoffIdentitySlice,
  kickoffNarrativeFromResponses,
  storedContactRoleFromChoice,
  type KickoffClient,
  type KickoffDraft,
  type LeadNurturingHost,
} from '@/lib/kickoff';
import { resolveKickoffServiceProgram } from '@/lib/service-program';
import { saveMarkedClientNote } from '@/lib/client-form-notes';
import { insertFormSubmission, kickoffFiledClientIds } from '@/lib/form-submissions';
import { normalizeReportingType } from '@/lib/reporting-types';
import { normalizeStatesLicensed } from '@/lib/us-states';
import {
  findClientConflicts,
  formatClientConflictMessage,
} from '@/lib/client-duplicate-check';
import { replayPendingForClientId } from '@/lib/pending-events';
import { extractGhlLocationId } from '@/lib/ghl-location-id';
import {
  identityFieldsFromPatch,
  isKickoffIdentityFieldComplete,
  loadClientIdentityGroup,
  propagateIdentityFields,
  withIdentityProfile,
} from '@/lib/client-identity';

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseDailyAdspend(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function parseLiveTransferApproved(value: unknown): boolean | null {
  if (value === true || value === 'yes') return true;
  if (value === false || value === 'no') return false;
  return null;
}

async function findOnboardingCall(service: SupabaseClient, clientId: string) {
  const { data } = await service
    .from('client_calls')
    .select('id, recording_url, transcript, called_at')
    .eq('client_id', clientId)
    .eq('call_type', 'onboarding')
    .is('deleted_at', null)
    .order('called_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function findLatestKickoffNarrative(
  service: SupabaseClient,
  clientId: string,
) {
  const { data } = await service
    .from('client_form_submissions')
    .select('responses')
    .eq('client_id', clientId)
    .eq('form_type', 'kickoff')
    .in('status', ['draft', 'applied'])
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return kickoffNarrativeFromResponses(data?.responses as Record<string, unknown> | undefined);
}

async function persistKickoffNarrative(
  service: SupabaseClient,
  noteClientId: string,
  formClientId: string,
  userId: string | null,
  formProfile: ReturnType<typeof getOnboardingFormProfile>,
  draft: KickoffDraft,
  saveMode: 'progress' | 'complete',
  includeRevenue = true,
) {
  const note = kickoffClientFileNote(formProfile, draft, includeRevenue);
  const marker = note?.marker ?? (
    formProfile === 'call_center' ? KICKOFF_CC_NOTE_MARKER : KICKOFF_PM_NOTE_MARKER
  );
  await saveMarkedClientNote(service, noteClientId, marker, note?.body ?? null, userId);

  if (saveMode !== 'progress') return;

  const responses = {
    ...kickoffExtraFieldsFromDraft(formProfile, draft),
    ...kickoffChecklistResponses(draft),
    recording_url: draft.recording_url.trim() || null,
    transcript: draft.transcript.trim() || null,
    reporting_type: draft.reporting_type,
    service_program: resolveKickoffServiceProgram(draft.service_program),
    form_profile: formProfile,
    vertical_confirmed: draft.vertical_confirmed,
  };
  const { data: existing } = await service
    .from('client_form_submissions')
    .select('id')
    .eq('client_id', formClientId)
    .eq('form_type', 'kickoff')
    .eq('status', 'draft')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await service
      .from('client_form_submissions')
      .update({
        responses,
        submitted_by: userId,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) console.error('[kickoff] progress draft update failed', error.message);
    return;
  }

  try {
    await insertFormSubmission(service, {
      client_id: formClientId,
      form_type: 'kickoff',
      status: 'draft',
      submitted_by: userId,
      responses,
    });
  } catch (e) {
    console.error('[kickoff] progress draft insert failed', e);
  }
}

async function findLatestKickoffVerticalConfirmed(
  service: SupabaseClient,
  clientId: string,
): Promise<boolean> {
  const { data } = await service
    .from('client_form_submissions')
    .select('responses')
    .eq('client_id', clientId)
    .eq('form_type', 'kickoff')
    .eq('status', 'applied')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const responses = data?.responses as Record<string, unknown> | undefined;
  return responses?.vertical_confirmed === true;
}

function kickoffChecklistResponses(draft: KickoffDraft): Record<string, unknown> {
  return {
    reviews: draft.reviews.trim() || null,
    trust_notes: draft.trust_notes.trim() || null,
    stock_criteria_url: draft.stock_criteria_url.trim() || null,
    integrated_on_call: draft.integrated_on_call,
    facebook_access: draft.facebook_access || null,
    facebook_follow_up_at: draft.facebook_follow_up_at.trim() || null,
    slack_team_added: draft.slack_team_added,
    pm_landing_copy: draft.pm_landing_copy.trim() || null,
    pm_compliance_notes: draft.pm_compliance_notes.trim() || null,
    pm_competitor_refs: draft.pm_competitor_refs.trim() || null,
    pm_funnel_requirements: draft.pm_funnel_requirements.trim() || null,
  };
}

function hostFromBody(value: unknown): LeadNurturingHost | '' {
  if (value === 'internal' || value === 'external' || value === 'Both') return value;
  return '';
}

function draftFromBody(body: Record<string, unknown>): KickoffDraft {
  const program = resolveKickoffServiceProgram(body.service_program);
  return {
    reporting_type: normalizeReportingType(body.reporting_type),
    service_program: program ?? '',
    vertical_confirmed: body.vertical_confirmed === true,
    sub_account_name: optionalText(body.sub_account_name) ?? '',
    phone: optionalText(body.phone) ?? '',
    contact_role: optionalText(body.contact_role) ?? '',
    states_licensed: normalizeStatesLicensed(body.states_licensed) ?? [],
    nmls: optionalText(body.nmls) ?? '',
    brokerage_name: optionalText(body.brokerage_name) ?? '',
    timezone: optionalText(body.timezone) ?? '',
    appointment_settings: optionalText(body.appointment_settings) ?? '',
    daily_adspend: body.daily_adspend != null ? String(body.daily_adspend) : '',
    facebook_page_name: optionalText(body.facebook_page_name) ?? '',
    phone_notifications: optionalText(body.phone_notifications) ?? '',
    phone_live_transfer: optionalText(body.phone_live_transfer) ?? '',
    live_transfer_approved:
      body.live_transfer_approved === true || body.live_transfer_approved === 'yes'
        ? 'yes'
        : body.live_transfer_approved === false || body.live_transfer_approved === 'no'
          ? 'no'
          : '',
    ghl_location_id: optionalText(body.ghl_location_id) ?? '',
    recording_url: optionalText(body.recording_url) ?? '',
    transcript: optionalText(body.transcript) ?? '',
    advance_lifecycle: body.advance_lifecycle !== false,
    pm_landing_copy: optionalText(body.pm_landing_copy) ?? '',
    pm_brand_assets: optionalText(body.pm_brand_assets) ?? '',
    pm_compliance_notes: optionalText(body.pm_compliance_notes) ?? '',
    pm_competitor_refs: optionalText(body.pm_competitor_refs) ?? '',
    pm_funnel_requirements: optionalText(body.pm_funnel_requirements) ?? '',
    cc_lead_source: optionalText(body.cc_lead_source) ?? '',
    cc_qualification_criteria: optionalText(body.cc_qualification_criteria) ?? '',
    cc_hp_tag_user: optionalText(body.cc_hp_tag_user) ?? '',
    cc_setter_notes: optionalText(body.cc_setter_notes) ?? '',
    lead_nurturing_host: hostFromBody(body.lead_nurturing_host),
    account_shape: body.account_shape === 'solo' || body.account_shape === 'team' ? body.account_shape : '',
    team_routing_notes: optionalText(body.team_routing_notes) ?? '',
    booking_hours: optionalText(body.booking_hours) ?? '',
    qualifies_leads: body.qualifies_leads === 'yes' || body.qualifies_leads === 'no' ? body.qualifies_leads : '',
    qualification_notes: optionalText(body.qualification_notes) ?? '',
    brand_colors: optionalText(body.brand_colors) ?? '',
    headshot_url: optionalText(body.headshot_url) ?? '',
    biography: optionalText(body.biography) ?? '',
    reviews: optionalText(body.reviews) ?? '',
    trust_notes: optionalText(body.trust_notes) ?? '',
    stock_criteria_url: optionalText(body.stock_criteria_url) ?? '',
    integrated_on_call: body.integrated_on_call === true,
    facebook_access: body.facebook_access === 'granted' || body.facebook_access === 'follow_up' ? body.facebook_access : '',
    facebook_follow_up_at: optionalText(body.facebook_follow_up_at) ?? '',
    slack_team_added: body.slack_team_added === true,
    date_signed: optionalText(body.date_signed)?.slice(0, 10) ?? '',
    contact_role_choice: body.contact_role_choice === 'owner' || body.contact_role_choice === 'mlo'
      ? body.contact_role_choice
      : '',
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id } = await params;
  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);

  const [clientRes, onboardingCall, priorKickoffConfirmed, savedNarrative, kickoffFiled] = await Promise.all([
    ctx.service.from('clients').select(KICKOFF_CLIENT_FIELDS).eq('id', id).single(),
    findOnboardingCall(ctx.service, id),
    findLatestKickoffVerticalConfirmed(ctx.service, id),
    findLatestKickoffNarrative(ctx.service, id),
    kickoffFiledClientIds(ctx.service, [id]),
  ]);

  if (clientRes.error) {
    const status = clientRes.error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: clientRes.error.message }, { status });
  }

  const rawClient = clientRes.data as KickoffClient;
  const identityGroup = await loadClientIdentityGroup(ctx.service, id);
  const mergedClient = identityGroup
    ? (withIdentityProfile(rawClient, identityGroup.identity) as KickoffClient)
    : rawClient;
  const storedProduct = normalizeReportingType(rawClient.reporting_type);
  const verticalConfirmed = storedProduct !== 'CALL_CENTER' && isClientVerticalConfirmed({
    reporting_type: rawClient.reporting_type,
    offer: rawClient.offer,
    service_program: rawClient.service_program,
    vertical_confirmed: priorKickoffConfirmed,
  });

  const client = includeRevenue
    ? mergedClient
    : (redactClientMoneyFields(mergedClient) as KickoffClient);

  const formProfile = getOnboardingFormProfile(client.reporting_type, client.service_program);
  const identityDraft = kickoffDraftFromClient(
    client,
    onboardingCall?.recording_url ?? '',
    verticalConfirmed,
    onboardingCall?.transcript ?? '',
  );
  const identityComplete = isKickoffIdentityFieldComplete(kickoffIdentitySlice(identityDraft));
  const narrativeDraft = applyKickoffSavedNarrative(identityDraft, savedNarrative);
  const filedNote = kickoffClientFileNote(formProfile, narrativeDraft, includeRevenue);
  if (filedNote) {
    await saveMarkedClientNote(
      ctx.service,
      identityGroup?.identity_client_id ?? id,
      filedNote.marker,
      filedNote.body,
      ctx.userId,
      { insertOnly: true },
    );
  }

  return NextResponse.json({
    client,
    onboarding_call: onboardingCall,
    kickoff_complete: !isKickoffIncomplete(mergedClient, onboardingCall, kickoffFiled.has(id)),
    can_view_revenue: includeRevenue,
    vertical_confirmed: verticalConfirmed,
    form_profile: formProfile,
    kickoff_config: getKickoffConfig(formProfile, includeRevenue),
    identity_client_id: identityGroup?.identity_client_id ?? id,
    identity_complete: identityComplete,
    related_offers: identityGroup?.offers ?? [],
    saved_narrative: savedNarrative,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id: clientId } = await params;
  const body = await req.json();
  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);

  const saveMode = body.save_mode === 'progress' ? 'progress' : 'complete';
  const draft = draftFromBody(body);
  const formProfile = getOnboardingFormProfile(draft.reporting_type, draft.service_program);

  const classificationError = validateKickoffClassification(
    draft.reporting_type,
    draft.service_program,
    saveMode,
  );
  if (classificationError) {
    return NextResponse.json({ error: classificationError }, { status: 400 });
  }

  if (saveMode === 'complete' && !draft.vertical_confirmed) {
    return NextResponse.json(
      { error: 'Confirm client vertical before completing kick-off' },
      { status: 400 },
    );
  }
  if (saveMode === 'complete' && !draft.lead_nurturing_host) {
    return NextResponse.json({ error: 'Select Lead Nurturing Host before completing kick-off' }, { status: 400 });
  }
  if (saveMode === 'complete' && !draft.qualifies_leads) {
    return NextResponse.json({ error: 'Select whether we qualify leads before completing kick-off' }, { status: 400 });
  }
  if (saveMode === 'complete' && !draft.account_shape) {
    return NextResponse.json({ error: 'Select Solo or Team before completing kick-off' }, { status: 400 });
  }
  if (saveMode === 'complete') {
    const followUpError = facebookFollowUpError(draft);
    if (followUpError) return NextResponse.json({ error: followUpError }, { status: 400 });
  }

  let ghlLocationId = extractGhlLocationId(optionalText(body.ghl_location_id));
  let recordingUrl = optionalText(body.recording_url);
  let transcript = optionalText(body.transcript);
  const subAccountName = optionalText(body.sub_account_name);

  if (!includeRevenue && body.daily_adspend != null && body.daily_adspend !== '') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: existingClient, error: clientError } = await ctx.service
    .from('clients')
    .select('id, name, primary_contact_name, lifecycle_status, ghl_location_id, onboarding_clickup_task_id, contact_role')
    .eq('id', clientId)
    .single();

  if (clientError) {
    const status = clientError.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: clientError.message }, { status });
  }
  if (!existingClient) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (saveMode === 'complete' && contactRoleNeedsConfirm(existingClient.contact_role) && !draft.contact_role_choice) {
    return NextResponse.json(
      { error: 'Confirm whether they own the company or are a loan officer' },
      { status: 400 },
    );
  }

  const existingOnboardingCall = await findOnboardingCall(ctx.service, clientId);

  if (saveMode === 'complete') {
    ghlLocationId = ghlLocationId ?? extractGhlLocationId(existingClient.ghl_location_id);
    recordingUrl = recordingUrl ?? optionalText(existingOnboardingCall?.recording_url);
    transcript = transcript ?? optionalText(existingOnboardingCall?.transcript);
    const effectiveSubName = subAccountName ?? optionalText(existingClient.name);
    // Sub-account name may match the LO — that is valid when it is the real GHL location name.
    if (!effectiveSubName) {
      return NextResponse.json(
        { error: 'GHL sub-account name is required — copy the exact location name from GHL.' },
        { status: 400 },
      );
    }
    if (!ghlLocationId) {
      return NextResponse.json({ error: 'Client GHL Location ID is required' }, { status: 400 });
    }
    if (!recordingUrl) {
      return NextResponse.json({ error: 'OB call recording link is required' }, { status: 400 });
    }
  }

  if (subAccountName) {
    const conflicts = await findClientConflicts(ctx.service, {
      name: subAccountName,
      excludeId: clientId,
    });
    if (conflicts.blocked) {
      return NextResponse.json(
        { error: formatClientConflictMessage(conflicts.conflicts), conflicts: conflicts.conflicts },
        { status: 409 },
      );
    }
  }

  let kickoffClickUpTaskId: string | null = null;
  if (saveMode === 'complete') {
    kickoffClickUpTaskId = existingClient.onboarding_clickup_task_id?.trim() || null;
    if (!kickoffClickUpTaskId) {
      return NextResponse.json(
        { error: 'Client is missing a ClickUp onboarding task ID. Kickoff writes only to the onboarding task.' },
        { status: 400 },
      );
    }
    const token = getClickUpToken();
    if (!token) {
      return NextResponse.json(
        { error: 'CLICKUP_API_TOKEN is not configured; Kickoff cannot update ClickUp.' },
        { status: 500 },
      );
    }
    const wrote = await applyClickUpFieldMap(
      kickoffClickUpTaskId,
      token,
      { ...KICKOFF_CLICKUP_FIELDS },
      '[kickoff]',
    );
    if (wrote < Object.keys(KICKOFF_CLICKUP_FIELDS).length) {
      return NextResponse.json(
        { error: 'Kickoff Form or OB Stage is not configured in CLICKUP_OB_FIELD_MAP.' },
        { status: 500 },
      );
    }
    await addClickUpTaskComment(
      kickoffClickUpTaskId,
      token,
      formatKickoffClickUpComment(existingClient, draft),
    );
  }

  const program = resolveKickoffServiceProgram(draft.service_program);
  const updates: Record<string, unknown> = {
    reporting_type: draft.reporting_type,
    states_licensed: normalizeStatesLicensed(body.states_licensed),
    nmls: optionalText(body.nmls),
    brokerage_name: optionalText(body.brokerage_name),
    timezone: optionalText(body.timezone),
    biography: optionalText(body.biography),
    headshot_url: optionalText(body.headshot_url),
    brand_colors: optionalText(body.brand_colors),
    phone_notifications: optionalText(body.phone_notifications),
  };
  if (program && draft.reporting_type !== 'CALL_CENTER') {
    updates.service_program = program;
  }
  if (draft.reporting_type === 'RM' || draft.reporting_type === 'DSCR') {
    updates.offer = draft.reporting_type;
  }
  const chosenRole = storedContactRoleFromChoice(draft.contact_role_choice);
  if (chosenRole) updates.contact_role = chosenRole;
  if (draft.lead_nurturing_host) updates.lead_nurturing_host = draft.lead_nurturing_host;
  if (draft.account_shape) {
    updates.account_shape = draft.account_shape;
    updates.team_routing_notes = draft.account_shape === 'team'
      ? optionalText(body.team_routing_notes)
      : null;
  }
  if (draft.qualifies_leads === 'yes' || draft.qualifies_leads === 'no') {
    updates.qualifies_leads = draft.qualifies_leads === 'yes';
    updates.qualification_notes = draft.qualifies_leads === 'yes'
      ? optionalText(body.qualification_notes)
      : null;
  }
  if (optionalText(body.date_signed)) updates.date_signed = optionalText(body.date_signed)!.slice(0, 10);
  if (program === 'core') {
    updates.phone_live_transfer = optionalText(body.phone_live_transfer);
    updates.live_transfer_approved = parseLiveTransferApproved(body.live_transfer_approved);
    updates.booking_hours = optionalText(body.booking_hours);
  }

  const identityPatch = identityFieldsFromPatch(updates);
  const identityGroup = await loadClientIdentityGroup(ctx.service, clientId);
  if (identityGroup && Object.keys(identityPatch).length) {
    await propagateIdentityFields(ctx.service, identityGroup.identity_client_id, identityPatch);
  }

  if (isKickoffFieldVisible('facebook_page_name', formProfile, includeRevenue)) {
    updates.facebook_page_name = optionalText(body.facebook_page_name);
  }
  if (includeRevenue && isKickoffFieldVisible('daily_adspend', formProfile, includeRevenue)) {
    updates.daily_adspend = parseDailyAdspend(body.daily_adspend);
  }

  if (ghlLocationId) {
    updates.ghl_location_id = ghlLocationId;
    const rawLoc = optionalText(body.ghl_location_id);
    if (rawLoc && /^https?:\/\//i.test(rawLoc)) {
      updates.ghl_subaccount_url = rawLoc;
    }
  }
  if (subAccountName) updates.name = subAccountName;

  if (saveMode === 'complete') {
    const advanceLifecycle = body.advance_lifecycle !== false;
    if (advanceLifecycle && existingClient.lifecycle_status === 'new_account') {
      updates.lifecycle_status = 'onboarding';
      updates.is_live = syncIsLiveWithLifecycle('onboarding');
    }
  }

  const { data: client, error: updateError } = await ctx.service
    .from('clients')
    .update(updates)
    .eq('id', clientId)
    .select(KICKOFF_CLIENT_FIELDS)
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  let onboardingCall = existingOnboardingCall;

  if (saveMode === 'complete' && recordingUrl) {
    const now = new Date().toISOString();
    const calledAt =
      typeof body.called_at === 'string' && body.called_at.trim()
        ? new Date(body.called_at).toISOString()
        : now;

    if (existingOnboardingCall) {
      const { data, error } = await ctx.service
        .from('client_calls')
        .update({
          recording_url: recordingUrl,
          transcript,
          disposition: 'completed',
          updated_by: ctx.userId,
          updated_at: now,
        })
        .eq('id', existingOnboardingCall.id)
        .select(CLIENT_CALL_FIELDS)
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      onboardingCall = data;
    } else {
      const { data, error } = await ctx.service
        .from('client_calls')
        .insert({
          client_id: clientId,
          call_type: 'onboarding',
          called_at: calledAt,
          recording_url: recordingUrl,
          transcript,
          disposition: 'completed',
          created_by: ctx.userId,
          updated_by: ctx.userId,
          updated_at: now,
        })
        .select(CLIENT_CALL_FIELDS)
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      onboardingCall = data;
    }
  }

  const redactedClient = includeRevenue ? client : redactClientMoneyFields(client);
  const kickoffClient = redactedClient as KickoffClient;

  let pending_replay = { replayed: 0, skipped: 0, failed: 0, errors: [] as string[] };
  if (subAccountName || ghlLocationId) {
    try {
      pending_replay = await replayPendingForClientId(ctx.service, clientId);
    } catch (e) {
      console.error('[kickoff] pending replay failed', e);
    }
  }

  const noteClientId = identityGroup?.identity_client_id ?? clientId;
  try {
    await persistKickoffNarrative(
      ctx.service,
      noteClientId,
      clientId,
      ctx.userId,
      formProfile,
      draft,
      saveMode,
      includeRevenue,
    );
  } catch (e) {
    console.error('[kickoff] narrative note failed', e);
  }

  if (saveMode === 'complete') {
    try {
      const extraFields = kickoffExtraFieldsFromDraft(formProfile, draft);
      await insertFormSubmission(ctx.service, {
        client_id: clientId,
        form_type: 'kickoff',
        status: 'applied',
        submitted_by: ctx.userId,
        responses: {
          ...extraFields,
          ...kickoffChecklistResponses(draft),
          reporting_type: draft.reporting_type,
          service_program: program,
          form_profile: formProfile,
          vertical_confirmed: draft.vertical_confirmed,
          sub_account_name: subAccountName,
          ghl_location_id: ghlLocationId,
          recording_url: recordingUrl,
          transcript,
        },
        applied_patch: {
          ...updates,
          ...(kickoffClickUpTaskId
            ? {
                onboarding_clickup_task_id: kickoffClickUpTaskId,
                clickup_fields: KICKOFF_CLICKUP_FIELDS,
              }
            : {}),
        },
      });
    } catch (e) {
      console.error('[kickoff] form submission log failed', e);
    }

    const { error: dismissError } = await ctx.service
      .from('client_form_submissions')
      .update({ status: 'dismissed' })
      .eq('client_id', clientId)
      .eq('form_type', 'kickoff')
      .eq('status', 'draft');
    if (dismissError) console.error('[kickoff] draft dismiss failed', dismissError.message);
  }

  const savedProduct = normalizeReportingType(kickoffClient.reporting_type);
  const verticalConfirmed = savedProduct !== 'CALL_CENTER' && isClientVerticalConfirmed({
    reporting_type: kickoffClient.reporting_type,
    offer: kickoffClient.offer,
    service_program: kickoffClient.service_program,
    vertical_confirmed: draft.vertical_confirmed,
  });

  return NextResponse.json({
    client: redactedClient,
    onboarding_call: onboardingCall,
    kickoff_complete: !isKickoffIncomplete(
      kickoffClient,
      onboardingCall,
      saveMode === 'complete' || (await kickoffFiledClientIds(ctx.service, [clientId])).has(clientId),
    ),
    saved_mode: saveMode,
    pending_replay,
    vertical_confirmed: verticalConfirmed,
    form_profile: formProfile,
    kickoff_config: getKickoffConfig(formProfile, includeRevenue),
    identity_client_id: identityGroup?.identity_client_id ?? clientId,
    identity_complete: isKickoffIdentityFieldComplete(kickoffIdentitySlice(draft)),
    related_offers: identityGroup?.offers ?? [],
    saved_narrative: kickoffNarrativeFromResponses(kickoffChecklistResponses(draft)),
  });
}
