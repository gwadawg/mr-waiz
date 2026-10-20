import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAppBaseUrl } from '@/lib/app-url';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import { recordClientFormNote, saveMarkedClientNote } from '@/lib/client-form-notes';
import { insertFormSubmission, kickoffFiledClientIds } from '@/lib/form-submissions';
import { isKickoffIncomplete } from '@/lib/kickoff';
import { buildLaunchKitBlocks } from '@/lib/launch-kit/build';
import {
  clientPatchFromDraft,
  draftFromClient,
  draftToResponses,
  isLaunchKitLifecycle,
  LAUNCH_KIT_CLIENT_FIELDS,
  LAUNCH_KIT_NOTE_MARKER,
  LAUNCH_KIT_PROPERTIES,
  launchKitClientFileNoteSections,
  parseLaunchKitDraft,
  resolveVariant,
  validateForGenerate,
  type LaunchKitClient,
} from '@/lib/launch-kit/intake';
import { renderLaunchKitPdf } from '@/lib/launch-kit/render';
import {
  getLatestLaunchKitDraft,
  LAUNCH_KIT_SLACK_LINK_TTL_SEC,
  launchKitFileName,
  listLaunchKitVersions,
  nextLaunchKitVersion,
  signLaunchKitUrl,
  uploadLaunchKitPdf,
} from '@/lib/launch-kit/storage';
import { KIT_DIAL_OWNER_LABELS, KIT_PRODUCT_LABELS } from '@/lib/launch-kit/types';
import { TEMPLATE_VERSION } from '@/lib/launch-kit/copy';
import { notifyMrWaizActivity, resolveActorDisplayName } from '@/lib/mr-waiz-activity-notify';
import {
  formatLaunchKitOpsSlackMessage,
  getSlackOpsChannelSlug,
  isSlackConfigured,
  postToTeamChannel,
} from '@/lib/slack-notify';

const LAUNCH_KIT_PERMISSION_KEYS = ['admin_clients', 'admin_billing'];

async function loadClient(service: SupabaseClient, clientId: string) {
  const { data, error } = await service
    .from('clients')
    .select(LAUNCH_KIT_CLIENT_FIELDS)
    .eq('id', clientId)
    .single();
  if (error || !data) return null;
  return data as unknown as LaunchKitClient;
}

async function loadOnboardingCall(service: SupabaseClient, clientId: string) {
  const { data } = await service
    .from('client_calls')
    .select('id, recording_url')
    .eq('client_id', clientId)
    .eq('call_type', 'onboarding')
    .is('deleted_at', null)
    .order('called_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, LAUNCH_KIT_PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const [client, onboardingCall, kits, draftRow, kickoffFiled] = await Promise.all([
    loadClient(ctx.service, clientId),
    loadOnboardingCall(ctx.service, clientId),
    listLaunchKitVersions(ctx.service, clientId),
    getLatestLaunchKitDraft(ctx.service, clientId),
    kickoffFiledClientIds(ctx.service, [clientId]),
  ]);
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const latestApplied = kits.rows[0] ?? null;
  // Prefill precedence: unsent draft newer than the last generated kit → that draft; else last kit.
  const prefillSource =
    draftRow && (!latestApplied || draftRow.submitted_at > latestApplied.submitted_at)
      ? draftRow
      : latestApplied;
  const draft = draftFromClient(client, prefillSource?.responses ?? null);
  const kickoffIncomplete = isKickoffIncomplete(client, onboardingCall, kickoffFiled.has(clientId));

  return NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      lifecycle_status: client.lifecycle_status,
      slack_id: client.slack_id,
      reporting_type: client.reporting_type,
      service_program: client.service_program,
      drive_folder_url: client.drive_folder_url,
    },
    kickoff_complete: !kickoffIncomplete,
    lifecycle_ok: isLaunchKitLifecycle(client.lifecycle_status),
    draft,
    prefill_source: prefillSource ? prefillSource.status : null,
    variant: resolveVariant(draft),
    properties: LAUNCH_KIT_PROPERTIES,
    versions: kits.versions,
    template_version: TEMPLATE_VERSION,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, LAUNCH_KIT_PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const body = (await req.json().catch(() => null)) as { mode?: string; draft?: unknown } | null;
  const mode = body?.mode === 'generate' ? 'generate' : 'draft';
  const draft = parseLaunchKitDraft(body?.draft);

  const [client, onboardingCall, kickoffFiled] = await Promise.all([
    loadClient(ctx.service, clientId),
    loadOnboardingCall(ctx.service, clientId),
    kickoffFiledClientIds(ctx.service, [clientId]),
  ]);
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  if (mode === 'draft') {
    await recordClientFormNote(
      ctx.service,
      clientId,
      LAUNCH_KIT_NOTE_MARKER,
      launchKitClientFileNoteSections(draft),
      ctx.userId,
    );
    await saveMarkedClientNote(ctx.service, clientId, 'Launch Kit — Internal notes', null, ctx.userId);
    const submission = await insertFormSubmission(ctx.service, {
      client_id: clientId,
      form_type: 'launch_kit',
      status: 'draft',
      submitted_by: ctx.userId,
      responses: { ...draftToResponses(draft), template_version: TEMPLATE_VERSION },
    });
    return NextResponse.json({ mode, submission_id: submission.id });
  }

  // ---- generate ----
  if (!isLaunchKitLifecycle(client.lifecycle_status)) {
    return NextResponse.json(
      { error: 'Launch Kit is only available for clients in new account, onboarding, or active status' },
      { status: 400 },
    );
  }
  if (isKickoffIncomplete(client, onboardingCall, kickoffFiled.has(clientId))) {
    return NextResponse.json(
      { error: 'Complete the kick-off call before generating the Launch Kit (GHL mapping + OB recording required)' },
      { status: 400 },
    );
  }
  const errors = validateForGenerate(draft);
  if (errors.length) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const { versions } = await listLaunchKitVersions(ctx.service, clientId);
  const version = nextLaunchKitVersion(versions);
  const built = buildLaunchKitBlocks(draft, { version, clientName: client.name });

  let pdf: Buffer;
  try {
    pdf = await renderLaunchKitPdf(built.blocks, built.cover);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'PDF render failed';
    console.error('[launch-kit] render failed', message);
    return NextResponse.json({ error: `PDF render failed: ${message}` }, { status: 500 });
  }

  let storagePath: string;
  try {
    const uploaded = await uploadLaunchKitPdf(ctx.service, {
      clientId,
      companyName: draft.company_name,
      clientName: client.name,
      version,
      pdf,
    });
    storagePath = uploaded.path;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    console.error('[launch-kit] upload failed', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const clientPatch = clientPatchFromDraft(draft, client);
  if (Object.keys(clientPatch).length) {
    const { error: patchErr } = await ctx.service.from('clients').update(clientPatch).eq('id', clientId);
    if (patchErr) {
      console.error('[launch-kit] client patch failed', patchErr.message);
      return NextResponse.json(
        { error: `Could not save these values back to the client file: ${patchErr.message}. The kit was not recorded.` },
        { status: 500 },
      );
    }
  }

  const responses = {
    ...draftToResponses(draft),
    storage_path: storagePath,
    version,
    template_version: TEMPLATE_VERSION,
    variant: built.variant,
    generated_by: ctx.userId,
    sent_to_client_at: null,
  };

  await recordClientFormNote(
    ctx.service,
    clientId,
    LAUNCH_KIT_NOTE_MARKER,
    launchKitClientFileNoteSections(draft),
    ctx.userId,
  );
  await saveMarkedClientNote(ctx.service, clientId, 'Launch Kit — Internal notes', null, ctx.userId);

  const submission = await insertFormSubmission(ctx.service, {
    client_id: clientId,
    form_type: 'launch_kit',
    status: 'applied',
    submitted_by: ctx.userId,
    responses,
    applied_patch: Object.keys(clientPatch).length ? clientPatch : null,
  });

  // Retire any open drafts now that a kit exists.
  await ctx.service
    .from('client_form_submissions')
    .update({ status: 'dismissed' })
    .eq('client_id', clientId)
    .eq('form_type', 'launch_kit')
    .eq('status', 'draft');

  const appUrl = `${getAppBaseUrl()}/dashboard?view=admin_clients`;
  const downloadName = launchKitFileName(storagePath);
  const downloadUrl = await signLaunchKitUrl(ctx.service, storagePath, LAUNCH_KIT_SLACK_LINK_TTL_SEC, downloadName);
  const actor = await resolveActorDisplayName(ctx.service, { userId: ctx.userId });

  if (isSlackConfigured()) {
    const opsText = formatLaunchKitOpsSlackMessage({
      client_name: client.name,
      version,
      product_label: KIT_PRODUCT_LABELS[built.variant.product],
      dial_owner_label: KIT_DIAL_OWNER_LABELS[built.variant.dialOwner],
      go_live_date: draft.go_live_date,
      generated_by: actor,
      app_url: appUrl,
      download_url: downloadUrl,
      client_patch_fields: Object.keys(clientPatch),
    });
    const res = await postToTeamChannel(ctx.service, getSlackOpsChannelSlug(), opsText);
    if (res && !res.ok) console.error('[launch-kit] ops Slack failed', res.error);
  }

  void notifyMrWaizActivity(ctx.service, {
    eventKey: 'client.launch_kit_generated',
    actor: { userId: ctx.userId, label: actor },
    fields: {
      client_name: client.name,
      version: String(version),
      variant: `${KIT_PRODUCT_LABELS[built.variant.product]} · ${KIT_DIAL_OWNER_LABELS[built.variant.dialOwner]}`,
      go_live_date: draft.go_live_date,
      app_url: appUrl,
    },
  });

  return NextResponse.json({
    mode,
    submission_id: submission.id,
    version,
    storage_path: storagePath,
    download_url: downloadUrl,
    client_patch: clientPatch,
  });
}
