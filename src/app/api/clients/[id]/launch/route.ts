import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import {
  addClickUpTaskComment,
  applyClickUpFieldMap,
  getClickUpToken,
} from '@/lib/clickup';
import { CLIENT_CALL_FIELDS } from '@/lib/client-calls';
import { recordClientFormNote, saveMarkedClientNote } from '@/lib/client-form-notes';
import { insertFormSubmission, isBackfillFormSubmission, kickoffFiledClientIds } from '@/lib/form-submissions';
import { isKickoffIncomplete } from '@/lib/kickoff';
import { isLaunchBlockingForCycle, latestReinstateCutoffIso } from '@/lib/reinstate-progress';
import {
  getLaunchChecklistConfig,
  getFirstIncompleteItemKey,
  getLaunchItemsForProfile,
  isLaunchChecklistComplete,
  isLaunchItemSatisfied,
  LAUNCH_CLIENT_NOTE_MARKER,
  LAUNCH_FINAL_CONFIRMATION,
  LAUNCH_FORM_CLICKUP_KEY,
  LAUNCH_FORM_CLICKUP_VALUE,
  formatLaunchClickUpComment,
  launchClientFileNoteSections,
  launchDraftToResponses,
  profileFromClient,
  type LaunchFormDraft,
} from '@/lib/launch-form';
import type { OnboardingFormProfile } from '@/lib/onboarding-form-profile';
import { syncIsLiveWithLifecycle } from '@/lib/lifecycle-sync';
import { hasPermission } from '@/lib/permissions';
import { notifyLaunchComplete } from '@/lib/notifications';

const LAUNCH_PERMISSION_KEYS = ['admin_clients', 'admin_billing'];
const LAUNCH_LIFECYCLE_STATUSES = new Set(['new_account', 'onboarding']);
const LAUNCH_SUBMISSION_FIELDS = 'id, form_type, submitted_at, submitted_by, responses, applied_patch, status';
const REINSTATE_CUTOFF_FIELDS = 'form_type, submitted_at';

type LaunchGateRow = {
  form_type?: string;
  submitted_at: string;
  submitted_by?: string | null;
  responses?: Record<string, unknown> | null;
  applied_patch?: Record<string, unknown> | null;
  status?: string | null;
};

function alreadyLaunchedForCycle(
  launchRows: LaunchGateRow[],
  reinstateRows: Array<{ form_type: string; submitted_at: string }>,
): boolean {
  const cutoff = latestReinstateCutoffIso(reinstateRows);
  const operationalLaunchRowsWithSubmittedAt = launchRows.filter(
    row => !isBackfillFormSubmission(row),
  );
  return isLaunchBlockingForCycle(
    operationalLaunchRowsWithSubmittedAt.map(row => ({
      form_type: 'launch',
      submitted_at: row.submitted_at,
      status: row.status ?? 'applied',
    })),
    cutoff,
  );
}

async function fetchLaunchCycleSubmissions(service: SupabaseClient, clientId: string) {
  const [launchSubRes, reinstateSubRes] = await Promise.all([
    service
      .from('client_form_submissions')
      .select(LAUNCH_SUBMISSION_FIELDS)
      .eq('client_id', clientId)
      .eq('form_type', 'launch')
      .eq('status', 'applied')
      .order('submitted_at', { ascending: false })
      .limit(5),
    service
      .from('client_form_submissions')
      .select(REINSTATE_CUTOFF_FIELDS)
      .eq('client_id', clientId)
      .eq('form_type', 'reinstate')
      .in('status', ['applied', 'submitted'])
      .order('submitted_at', { ascending: false })
      .limit(5),
  ]);
  return { launchSubRes, reinstateSubRes };
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function canUserCompleteLaunch(profile: {
  is_owner: boolean;
  allowed_permissions: string[] | null;
}): boolean {
  if (profile.is_owner) return true;
  if (profile.allowed_permissions === null) return true;
  return LAUNCH_PERMISSION_KEYS.some(key =>
    hasPermission(key, { isOwner: false, allowedPermissions: profile.allowed_permissions }),
  );
}

export async function listAssignableLaunchUsers(
  service: SupabaseClient,
): Promise<{ id: string; email: string }[]> {
  const { data: authData, error } = await service.auth.admin.listUsers();
  if (error || !authData?.users) return [];

  const { data: profiles } = await service
    .from('profiles')
    .select('id, is_owner, allowed_permissions');

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

  return authData.users
    .filter(u => {
      const profile = profileMap[u.id];
      if (!profile) return false;
      return canUserCompleteLaunch(profile);
    })
    .map(u => ({ id: u.id, email: u.email ?? u.id }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function parseLaunchDraft(body: Record<string, unknown>, profile: OnboardingFormProfile): LaunchFormDraft {
  const items = getLaunchItemsForProfile(profile);
  const confirmations: Record<string, string> = {};
  const rawConfirmations = body.confirmations;
  if (rawConfirmations && typeof rawConfirmations === 'object') {
    for (const item of items) {
      if (item.confirmType === 'type_yes') {
        const val = (rawConfirmations as Record<string, unknown>)[item.key];
        confirmations[item.key] = typeof val === 'string' ? val : '';
      }
    }
  } else {
    for (const item of items) {
      if (item.confirmType === 'type_yes') confirmations[item.key] = '';
    }
  }

  const checklist: Record<string, boolean> = {};
  const rawChecklist = body.checklist;
  for (const item of items) {
    checklist[item.key] =
      rawChecklist && typeof rawChecklist === 'object'
        ? !!(rawChecklist as Record<string, boolean>)[item.key]
        : false;
  }

  return {
    launch_date: optionalText(body.launch_date) ?? new Date().toISOString().slice(0, 10),
    completed_by_user_id: optionalText(body.completed_by_user_id) ?? '',
    completed_by_label: optionalText(body.completed_by_label) ?? '',
    phone_ghl: optionalText(body.phone_ghl) ?? '',
    recording_url: optionalText(body.recording_url) ?? '',
    transcript: optionalText(body.transcript) ?? '',
    notes: optionalText(body.notes) ?? '',
    checklist,
    confirmations,
    final_confirmation: typeof body.final_confirmation === 'string' ? body.final_confirmation : '',
  };
}

function validateLaunchDraft(
  draft: LaunchFormDraft,
  profile: OnboardingFormProfile,
  assignableUsers: { id: string; email: string }[],
): NextResponse | null {
  if (!draft.completed_by_user_id) {
    return NextResponse.json({ error: 'Select who completed this launch checklist' }, { status: 400 });
  }

  if (!draft.recording_url.trim()) {
    return NextResponse.json({ error: 'Launch call recording link is required' }, { status: 400 });
  }

  if (!draft.phone_ghl.trim()) {
    return NextResponse.json(
      { error: 'Go High Level number is required (the number we prospect with)' },
      { status: 400 },
    );
  }

  const assignable = assignableUsers.find(u => u.id === draft.completed_by_user_id);
  if (!assignable) {
    return NextResponse.json({ error: 'Invalid completed-by user' }, { status: 400 });
  }

  if (!draft.completed_by_label.trim()) {
    draft.completed_by_label = assignable.email;
  }

  if (draft.final_confirmation.trim().toUpperCase() !== LAUNCH_FINAL_CONFIRMATION) {
    return NextResponse.json(
      { error: `Type ${LAUNCH_FINAL_CONFIRMATION} to confirm go-live` },
      { status: 400 },
    );
  }

  if (!isLaunchChecklistComplete(draft, profile)) {
    const incompleteKey = getFirstIncompleteItemKey(draft, profile);
    const incompleteItem = getLaunchItemsForProfile(profile).find(item => item.key === incompleteKey);
    const hint = incompleteItem
      ? incompleteItem.confirmType === 'type_yes'
        ? `"${incompleteItem.label}" requires typing yes and checking the box`
        : `"${incompleteItem.label}" must be confirmed`
      : 'All launch checklist items must be confirmed before going live';
    return NextResponse.json({ error: hint }, { status: 400 });
  }

  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, LAUNCH_PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;

  const [clientRes, cycleSubs, onboardingCallRes, assignableUsers, launchKitRes, kickoffFiled] = await Promise.all([
    ctx.service
      .from('clients')
      .select('id, name, lifecycle_status, ghl_location_id, phone_ghl, primary_contact_name, launch_date, slack_id, reporting_type, service_program')
      .eq('id', clientId)
      .single(),
    fetchLaunchCycleSubmissions(ctx.service, clientId),
    ctx.service
      .from('client_calls')
      .select('id, recording_url')
      .eq('client_id', clientId)
      .eq('call_type', 'onboarding')
      .is('deleted_at', null)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    listAssignableLaunchUsers(ctx.service),
    ctx.service
      .from('client_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('form_type', 'launch_kit')
      .eq('status', 'applied'),
    kickoffFiledClientIds(ctx.service, [clientId]),
  ]);

  if (clientRes.error) {
    const status = clientRes.error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: clientRes.error.message }, { status });
  }

  const formProfile = profileFromClient(clientRes.data);
  const kickoffIncomplete = isKickoffIncomplete(
    clientRes.data,
    onboardingCallRes.data,
    kickoffFiled.has(clientId),
  );
  const defaultUser = assignableUsers.find(u => u.id === ctx.userId);
  const alreadyLaunched = alreadyLaunchedForCycle(
    (cycleSubs.launchSubRes.data ?? []) as LaunchGateRow[],
    (cycleSubs.reinstateSubRes.data ?? []) as Array<{ form_type: string; submitted_at: string }>,
  );

  return NextResponse.json({
    client: clientRes.data,
    kickoff_complete: !kickoffIncomplete,
    already_launched: alreadyLaunched,
    has_launch_kit: (launchKitRes.count ?? 0) > 0,
    default_launch_date: clientRes.data.launch_date ?? new Date().toISOString().slice(0, 10),
    form_profile: formProfile,
    checklist_config: getLaunchChecklistConfig(formProfile),
    assignable_users: assignableUsers,
    default_completed_by: ctx.userId,
    default_completed_by_label: defaultUser?.email ?? ctx.userId,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, LAUNCH_PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;

  const [clientRes, cycleSubs, onboardingCallRes, kickoffFiled] = await Promise.all([
    ctx.service
      .from('clients')
      .select('id, name, lifecycle_status, slack_id, launch_date, ghl_location_id, primary_contact_name, reporting_type, service_program, onboarding_clickup_task_id')
      .eq('id', clientId)
      .single(),
    fetchLaunchCycleSubmissions(ctx.service, clientId),
    ctx.service
      .from('client_calls')
      .select('id, recording_url')
      .eq('client_id', clientId)
      .eq('call_type', 'onboarding')
      .is('deleted_at', null)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    kickoffFiledClientIds(ctx.service, [clientId]),
  ]);

  if (clientRes.error || !clientRes.data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const client = clientRes.data;
  const formProfile = profileFromClient(client);
  const body = await req.json();
  const draft = parseLaunchDraft(body, formProfile);

  const assignableUsers = await listAssignableLaunchUsers(ctx.service);
  const validationError = validateLaunchDraft(draft, formProfile, assignableUsers);
  if (validationError) return validationError;

  if (
    alreadyLaunchedForCycle(
      (cycleSubs.launchSubRes.data ?? []) as LaunchGateRow[],
      (cycleSubs.reinstateSubRes.data ?? []) as Array<{ form_type: string; submitted_at: string }>,
    )
  ) {
    return NextResponse.json({ error: 'This client already has a completed launch checklist' }, { status: 409 });
  }

  if (!LAUNCH_LIFECYCLE_STATUSES.has(client.lifecycle_status)) {
    return NextResponse.json(
      { error: 'Launch is only available for clients in onboarding or new account status' },
      { status: 400 },
    );
  }

  if (isKickoffIncomplete(client, onboardingCallRes.data, kickoffFiled.has(clientId))) {
    return NextResponse.json(
      { error: 'Complete the kick-off call before launching (GHL mapping + OB recording required)' },
      { status: 400 },
    );
  }

  const profileItems = getLaunchItemsForProfile(formProfile);
  for (const item of profileItems) {
    if (!isLaunchItemSatisfied(item, draft)) {
      return NextResponse.json(
        { error: `Checklist item not satisfied: ${item.label}` },
        { status: 400 },
      );
    }
  }

  const taskId = client.onboarding_clickup_task_id?.trim();
  if (!taskId) {
    return NextResponse.json(
      { error: 'Client is missing a ClickUp onboarding task ID. Launch writes only to the onboarding task.' },
      { status: 400 },
    );
  }

  const token = getClickUpToken();
  if (!token) {
    return NextResponse.json(
      { error: 'CLICKUP_API_TOKEN is not configured; Launch cannot update ClickUp.' },
      { status: 500 },
    );
  }

  const wrote = await applyClickUpFieldMap(
    taskId,
    token,
    { [LAUNCH_FORM_CLICKUP_KEY]: LAUNCH_FORM_CLICKUP_VALUE },
    '[launch-form]',
  );
  if (wrote < 1) {
    return NextResponse.json(
      { error: 'Launch Form ClickUp field is not configured in CLICKUP_OB_FIELD_MAP.' },
      { status: 500 },
    );
  }

  await addClickUpTaskComment(
    taskId,
    token,
    formatLaunchClickUpComment(client, draft, formProfile),
  );

  const responses = launchDraftToResponses(draft, {
    reporting_type: client.reporting_type ?? undefined,
    service_program: client.service_program ?? null,
    form_profile: formProfile,
  });
  const lifecycleStatus = 'active';

  const { error: updateErr } = await ctx.service
    .from('clients')
    .update({
      lifecycle_status: lifecycleStatus,
      launch_date: draft.launch_date,
      phone_ghl: draft.phone_ghl.trim(),
      is_live: syncIsLiveWithLifecycle(lifecycleStatus),
    })
    .eq('id', clientId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const now = new Date().toISOString();
  const { data: launchCall, error: callErr } = await ctx.service
    .from('client_calls')
    .insert({
      client_id: clientId,
      call_type: 'launch',
      called_at: now,
      recording_url: draft.recording_url.trim(),
      transcript: draft.transcript.trim() || null,
      disposition: 'completed',
      notes: draft.notes || 'Launch checklist completed',
      created_by: ctx.userId,
      updated_by: ctx.userId,
      updated_at: now,
    })
    .select(CLIENT_CALL_FIELDS)
    .single();
  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });

  await recordClientFormNote(
    ctx.service,
    clientId,
    LAUNCH_CLIENT_NOTE_MARKER,
    launchClientFileNoteSections(draft, formProfile),
    ctx.userId,
  );
  await saveMarkedClientNote(ctx.service, clientId, 'Launch checklist — Notes', null, ctx.userId);

  const submission = await insertFormSubmission(ctx.service, {
    client_id: clientId,
    form_type: 'launch',
    status: 'applied',
    submitted_by: draft.completed_by_user_id,
    responses,
    applied_patch: {
      lifecycle_status: lifecycleStatus,
      launch_date: draft.launch_date,
      phone_ghl: draft.phone_ghl.trim(),
      onboarding_clickup_task_id: taskId,
      clickup_field: LAUNCH_FORM_CLICKUP_KEY,
      clickup_value: LAUNCH_FORM_CLICKUP_VALUE,
    },
  });

  await notifyLaunchComplete(ctx.service, {
    client_id: clientId,
    client_name: client.name,
    launch_date: draft.launch_date,
    slack_id: client.slack_id,
    completed_by: draft.completed_by_label,
    responses,
  });

  return NextResponse.json({
    client_id: clientId,
    launch_call: launchCall,
    submission,
  });
}
