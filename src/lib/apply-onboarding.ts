import type { SupabaseClient } from '@supabase/supabase-js';
import { syncIsLiveWithLifecycle } from '@/lib/lifecycle-sync';
import { recordClientFormNote, saveMarkedClientNote } from '@/lib/client-form-notes';
import {
  ONBOARDING_OVERFLOW_NOTE_MARKER,
  PREVIOUS_ONBOARDING_NOTE_MARKER,
  onboardingOverflowNoteSections,
  onboardingResponsesFromInput,
  onboardingToClientPatch,
  parseOnboardingFormFields,
  primaryContactNameFromInput,
  type OnboardingFormInput,
  type OnboardingMemberInput,
} from '@/lib/onboarding-form';
import {
  findClientsByContact,
  insertFormSubmission,
  type FormSubmissionRow,
} from '@/lib/form-submissions';
import { runOnboardingSideEffects, runOnboardingUnmappedNotification } from '@/lib/onboarding-side-effects';
import { ensureAccountGroupForNewClient } from '@/lib/client-account-groups';
import { saveSubmittedPerson } from '@/lib/person-store';

const CLIENT_FIELDS =
  'id, name, lifecycle_status, email, phone, primary_contact_name, slack_id, onboarding_clickup_task_id, clickup_task_id, ghl_contact_id';

async function saveOnboardingOverflowNote(
  service: SupabaseClient,
  clientId: string,
  input: OnboardingFormInput,
) {
  await recordClientFormNote(
    service,
    clientId,
    ONBOARDING_OVERFLOW_NOTE_MARKER,
    onboardingOverflowNoteSections(input),
    null,
  );
  await saveMarkedClientNote(service, clientId, PREVIOUS_ONBOARDING_NOTE_MARKER, null, null);
}

export type OnboardingSubmitResult = {
  matched: boolean;
  client_id: string | null;
  submission_id: string;
  status: 'applied' | 'unmapped';
};

export async function applyOnboardingSubmission(
  service: SupabaseClient,
  input: OnboardingFormInput,
  rawBody: Record<string, unknown>,
): Promise<OnboardingSubmitResult> {
  const matches = await findClientsByContact(service, input.email, input.phone);
  const responses = { ...onboardingResponsesFromInput(input), ...rawBody };

  if (matches.length !== 1) {
    const submission = await insertFormSubmission(service, {
      client_id: null,
      form_type: 'onboarding',
      status: 'unmapped',
      submitted_by: 'client',
      match_email: input.email,
      match_phone: input.phone,
      responses,
    });

    void runOnboardingUnmappedNotification(service, input, {
      submission_id: submission.id,
      match_count: matches.length,
    });

    return {
      matched: false,
      client_id: null,
      submission_id: submission.id,
      status: 'unmapped',
    };
  }

  const client = matches[0];
  const patch = onboardingToClientPatch(input);
  const updates: Record<string, unknown> = { ...patch };

  const { data: existing } = await service
    .from('clients')
    .select('lifecycle_status')
    .eq('id', client.id)
    .single();

  if (existing?.lifecycle_status === 'new_account') {
    updates.lifecycle_status = 'onboarding';
    updates.is_live = syncIsLiveWithLifecycle('onboarding');
  }

  const { data: updated, error } = await service
    .from('clients')
    .update(updates)
    .eq('id', client.id)
    .select(CLIENT_FIELDS)
    .single();
  if (error) throw new Error(error.message);

  await insertOnboardingContacts(service, client.id, input.additional_members);
  await savePrimaryFromOnboarding(service, client.id, input);
  await saveOnboardingOverflowNote(service, client.id, input);

  const submission = await insertFormSubmission(service, {
    client_id: client.id,
    form_type: 'onboarding',
    status: 'applied',
    submitted_by: 'client',
    match_email: input.email,
    match_phone: input.phone,
    responses,
    applied_patch: patch,
  });

  await runOnboardingSideEffects(
    {
      id: updated.id,
      name: updated.name,
      onboarding_clickup_task_id: updated.onboarding_clickup_task_id ?? null,
      clickup_task_id: updated.clickup_task_id ?? null,
      ghl_contact_id: updated.ghl_contact_id ?? null,
    },
    input,
    service,
  );

  return {
    matched: true,
    client_id: client.id,
    submission_id: submission.id,
    status: 'applied',
  };
}

export async function applyPendingOnboardingToClient(
  service: SupabaseClient,
  submissionId: string,
  clientId: string,
  submittedBy: string | null,
): Promise<FormSubmissionRow> {
  const { data: row, error } = await service
    .from('client_form_submissions')
    .select('*')
    .eq('id', submissionId)
    .eq('form_type', 'onboarding')
    .single();
  if (error || !row) throw new Error('Submission not found');

  const responses = (row.responses ?? {}) as Record<string, unknown>;
  const input = parseOnboardingFormFields(responses);
  const patch = onboardingToClientPatch(input);
  const updates: Record<string, unknown> = { ...patch };

  const { data: existing } = await service
    .from('clients')
    .select('lifecycle_status')
    .eq('id', clientId)
    .single();

  if (existing?.lifecycle_status === 'new_account') {
    updates.lifecycle_status = 'onboarding';
    updates.is_live = syncIsLiveWithLifecycle('onboarding');
  }

  const { error: upErr } = await service.from('clients').update(updates).eq('id', clientId);
  if (upErr) throw new Error(upErr.message);

  await insertOnboardingContacts(service, clientId, input.additional_members);
  await savePrimaryFromOnboarding(service, clientId, input);
  await saveOnboardingOverflowNote(service, clientId, input);

  const { data: updatedSub, error: subErr } = await service
    .from('client_form_submissions')
    .update({
      client_id: clientId,
      status: 'applied',
      applied_patch: patch,
      submitted_by: submittedBy ?? row.submitted_by,
    })
    .eq('id', submissionId)
    .select('*')
    .single();
  if (subErr) throw new Error(subErr.message);

  const { data: client } = await service
    .from('clients')
    .select(CLIENT_FIELDS)
    .eq('id', clientId)
    .single();

  if (client) {
    await runOnboardingSideEffects(
      {
        id: clientId,
        name: client.name,
        onboarding_clickup_task_id: client.onboarding_clickup_task_id ?? null,
        clickup_task_id: client.clickup_task_id ?? null,
        ghl_contact_id: client.ghl_contact_id ?? null,
      },
      input,
      service,
    );
  }

  return updatedSub as FormSubmissionRow;
}

export async function createClientAndApplyPendingOnboarding(
  service: SupabaseClient,
  submissionId: string,
  submittedBy: string | null,
): Promise<{ client: { id: string; name: string }; submission: FormSubmissionRow }> {
  const { data: row, error } = await service
    .from('client_form_submissions')
    .select('*')
    .eq('id', submissionId)
    .eq('form_type', 'onboarding')
    .eq('status', 'unmapped')
    .single();
  if (error || !row) throw new Error('Submission not found or already resolved');

  const responses = (row.responses ?? {}) as Record<string, unknown>;
  const input = parseOnboardingFormFields(responses);
  const clientName =
    input.brokerage_name.trim() ||
    input.legal_business_name.trim() ||
    input.email.split('@')[0] ||
    'New client';

  const accountLink = await ensureAccountGroupForNewClient(service, {
    name: clientName,
    primary_contact_name: primaryContactNameFromInput(input),
    primary_contact: primaryContactNameFromInput(input),
    email: input.email,
  });

  const { data: client, error: insertErr } = await service
    .from('clients')
    .insert({
      name: clientName,
      lifecycle_status: 'onboarding',
      is_live: syncIsLiveWithLifecycle('onboarding'),
      account_group_id: accountLink.account_group_id,
      engagement_kind: accountLink.engagement_kind,
      ...(accountLink.origin_client_id
        ? { origin_client_id: accountLink.origin_client_id }
        : {}),
    })
    .select('id, name')
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const submission = await applyPendingOnboardingToClient(service, submissionId, client.id, submittedBy);
  return { client: client as { id: string; name: string }, submission };
}

export async function insertOnboardingContacts(
  service: SupabaseClient,
  clientId: string,
  members: OnboardingMemberInput[],
): Promise<void> {
  for (const member of members) {
    await saveSubmittedPerson(service, clientId, {
      contact_type: member.contact_type,
      name: member.name,
      email: member.email,
      phone: member.phone,
      nmls: member.nmls,
      states_licensed: member.states_licensed,
      profile: member.profile,
      notes: member.notes,
      attachments: member.attachments,
    }, null);
  }
}

async function savePrimaryFromOnboarding(
  service: SupabaseClient,
  clientId: string,
  input: OnboardingFormInput,
): Promise<void> {
  const address = [input.street_address, input.city, input.state, input.zip_code].filter(Boolean).join(', ');
  await saveSubmittedPerson(service, clientId, {
    contact_type: 'primary_lo',
    name: primaryContactNameFromInput(input) || input.email,
    email: input.email,
    phone: input.phone,
    nmls: input.nmls,
    states_licensed: input.states_licensed,
    profile: {
      ...(input.biography ? { biography: input.biography } : {}),
      ...(input.review_url ? { review_url: input.review_url } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(address ? { personal_address: address } : {}),
    },
    notes: input.person_notes ?? [],
    headshotUrl: input.headshot_url,
    attachments: input.primary_attachments ?? [],
  }, null);
}

export async function uploadClientHeadshot(
  service: SupabaseClient,
  file: File,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const allowed = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
  if (!allowed.has(ext)) throw new Error('Headshot must be JPG, PNG, WEBP, or GIF');

  const path = `${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await service.storage.from('client-headshots').upload(path, buffer, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = service.storage.from('client-headshots').getPublicUrl(path);
  return data.publicUrl;
}
