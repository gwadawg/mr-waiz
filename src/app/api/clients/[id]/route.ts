import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import { getAppBaseUrlFromRequest } from '@/lib/app-url';
import { VOIDED_BILLING_STATUS } from '@/lib/billing-query';
import { CLIENT_CALL_FIELDS } from '@/lib/client-calls';
import {
  isValidReasonCode,
  requiresReasonOnChurn,
} from '@/lib/client-feedback';
import { deriveServiceProgram, normalizeSalesPackage } from '@/lib/offer-catalog';
import { normalizeServiceProgram } from '@/lib/service-program';
import { normalizeReportingType } from '@/lib/kpi-layouts';
import { normalizeBillingModel } from '@/lib/billing-model';
import { normalizeStatesLicensed } from '@/lib/us-states';
import { syncIsLiveWithLifecycle } from '@/lib/lifecycle-sync';
import { normalizeClientLeadSource } from '@/lib/client-lead-source';
import { extractGhlLocationId } from '@/lib/ghl-location-id';
import {
  canViewClientRevenue,
  redactBillingRows,
  redactClientMoneyFields,
} from '@/lib/client-revenue-access';
import { resolveUserLabels } from '@/lib/user-resolver';
import {
  findClientConflicts,
  formatClientConflictMessage,
} from '@/lib/client-duplicate-check';
import { replayPendingForClientId } from '@/lib/pending-events';
import { CLIENT_CONTACT_FIELDS } from '@/lib/client-contacts';
import { parseClientDatePatch } from '@/lib/client-dates';
import {
  normalizeAccountShape,
  normalizeBrandSubject,
  parseQualifiesLeads,
} from '@/lib/client-launch-setup';
import {
  identityFieldsFromPatch,
  loadClientIdentityGroup,
  propagateIdentityFields,
  withIdentityProfile,
} from '@/lib/client-identity';
import { buildWelcomeBackUrl } from '@/lib/reinstate-client';

const STATUS_HISTORY_FIELDS =
  'id, previous_status, new_status, reason_code, note, mrr_at_change, changed_at, changed_by, source, related_call_id';

const CLIENT_NOTES_FIELDS =
  'id, note_type, reason_code, body, created_at, created_by, updated_at, related_call_id';

const FILE_CLIENT_FIELDS =
  'id, name, identity_client_id, is_live, reporting_type, service_program, sales_package, offer, offer_summary, lifecycle_status, client_stage, mrr, billing_type, billing_day, launch_date, date_signed, contract_end_date, contract_term_months, daily_adspend, ads_paused, ads_paused_at, ads_paused_note, performance_terms, billing_email, primary_contact, primary_contact_name, email, phone, source, website, drive_folder_url, funnel_url, virtual_business_card_url, virtual_card_slug, landing_page_url, brokerage_name, legal_business_name, nmls, city, state, states_licensed, timezone, ghl_location_id, phone_ghl, phone_live_transfer, phone_notifications, live_transfer_approved, appointment_watch, brand_subject, account_shape, team_routing_notes, qualifies_leads, qualification_notes, contact_role, appointment_settings, facebook_page_name, instagram_handle, ad_account_name, ad_account_url, meta_pixel_id, thank_you_page_url, second_landing_page_url, onboarding_clickup_task_id, clickup_task_id, created_at, churned_at, reinstated_at, welcome_back_token';

const PIXEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FILE_BILLING_FIELDS =
  'id, billed_on, due_date, period_start, period_end, amount, base_amount, performance_amount, late_fee, discount, passthrough_amount, amount_paid, status, paid_on, method, invoice_ref, note, revenue_type, revenue_segment, lead_source, term_months, processing_fee, stripe_invoice_id, stripe_payment_intent_id, is_first_payment, is_extension, created_at';

// GET /api/clients/[id] — the client "file": the full client record plus its
// complete billing/revenue history. Structured so more sections (success
// reports, KPI history, notes) can be added over time.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id } = await params;

  const [clientRes, billingsRes, historyRes, notesRes, callsRes, formSubmissionsRes, contactsRes, pixelsRes] = await Promise.all([
    ctx.service.from('clients').select(FILE_CLIENT_FIELDS).eq('id', id).single(),
    ctx.service
      .from('client_billings')
      .select(FILE_BILLING_FIELDS)
      .neq('status', VOIDED_BILLING_STATUS)
      .eq('client_id', id)
      .order('billed_on', { ascending: false }),
    ctx.service
      .from('client_status_history')
      .select(STATUS_HISTORY_FIELDS)
      .eq('client_id', id)
      .order('changed_at', { ascending: false }),
    ctx.service
      .from('client_notes')
      .select(CLIENT_NOTES_FIELDS)
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    ctx.service
      .from('client_calls')
      .select(CLIENT_CALL_FIELDS)
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('called_at', { ascending: false }),
    ctx.service
      .from('client_form_submissions')
      .select('id, form_type, status, submitted_by, submitted_at, responses, applied_patch')
      .eq('client_id', id)
      .neq('status', 'dismissed')
      .order('submitted_at', { ascending: false }),
    ctx.service
      .from('client_contacts')
      .select(CLIENT_CONTACT_FIELDS)
      .eq('client_id', id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    ctx.service.from('meta_pixels').select('id, name').order('name'),
  ]);

  if (clientRes.error) {
    const status = clientRes.error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: clientRes.error.message }, { status });
  }
  if (billingsRes.error) return NextResponse.json({ error: billingsRes.error.message }, { status: 500 });
  if (historyRes.error) return NextResponse.json({ error: historyRes.error.message }, { status: 500 });
  if (notesRes.error) return NextResponse.json({ error: notesRes.error.message }, { status: 500 });
  if (callsRes.error) return NextResponse.json({ error: callsRes.error.message }, { status: 500 });
  if (formSubmissionsRes.error) {
    return NextResponse.json({ error: formSubmissionsRes.error.message }, { status: 500 });
  }
  if (contactsRes.error) {
    return NextResponse.json({ error: contactsRes.error.message }, { status: 500 });
  }
  if (pixelsRes.error) {
    return NextResponse.json({ error: pixelsRes.error.message }, { status: 500 });
  }

  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);
  const rawClient = clientRes.data;
  const identityGroup = await loadClientIdentityGroup(ctx.service, id);
  const mergedClient = identityGroup
    ? withIdentityProfile(rawClient, identityGroup.identity)
    : rawClient;
  const client = includeRevenue ? mergedClient : redactClientMoneyFields(mergedClient);
  const billings = includeRevenue ? (billingsRes.data ?? []) : redactBillingRows(billingsRes.data);
  const statusHistory = historyRes.data ?? [];
  const notes = notesRes.data ?? [];
  const calls = callsRes.data ?? [];
  const form_submissions = formSubmissionsRes.data ?? [];
  const contacts = contactsRes.data ?? [];

  const welcomeToken =
    typeof (rawClient as { welcome_back_token?: string | null }).welcome_back_token === 'string'
      ? (rawClient as { welcome_back_token: string }).welcome_back_token.trim()
      : '';
  const welcome_back_url = welcomeToken
    ? buildWelcomeBackUrl(getAppBaseUrlFromRequest(req), welcomeToken)
    : null;

  const authorIds = [
    ...notes.map((n: { created_by?: string | null }) => n.created_by),
    ...calls.map((c: { created_by?: string | null }) => c.created_by),
  ];
  const authorLabels = await resolveUserLabels(ctx.service, authorIds);

  return NextResponse.json({
    client,
    welcome_back_url,
    offer: rawClient,
    related_offers: identityGroup?.offers ?? [],
    identity_client_id: identityGroup?.identity_client_id ?? id,
    billings,
    status_history: statusHistory,
    notes: notes.map((n: { created_by?: string | null }) => ({
      ...n,
      created_by_label: n.created_by ? authorLabels[n.created_by] ?? null : null,
    })),
    calls: calls.map((c: { created_by?: string | null }) => ({
      ...c,
      created_by_label: c.created_by ? authorLabels[c.created_by] ?? null : null,
    })),
    form_submissions,
    contacts,
    author_labels: authorLabels,
    can_view_revenue: includeRevenue,
    pixel_options: pixelsRes.data ?? [],
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await params;
  const body = await req.json();

  // Client Success may update only KPI judgment standards; media/CS may toggle ads pause.
  // Full client edits stay admin (+ billing for billing fields).
  const kpiOnlyKeys = new Set(['kpi_benchmarks', 'kpi_benchmarks_note']);
  const adsOnlyKeys = new Set(['ads_paused', 'ads_paused_note']);
  const bodyKeys = Object.keys(body ?? {});
  const isKpiOnlyPatch =
    bodyKeys.length > 0 && bodyKeys.every(k => kpiOnlyKeys.has(k));
  const isAdsOnlyPatch =
    bodyKeys.length > 0 && bodyKeys.every(k => adsOnlyKeys.has(k));

  const denied = isKpiOnlyPatch
    ? requireAnyPermission(ctx, ['admin_clients', 'admin_billing', 'client_health'])
    : isAdsOnlyPatch
      ? requireAnyPermission(ctx, [
          'admin_clients',
          'admin_billing',
          'media_buyer',
          'client_workspace',
          'client_health',
        ])
      : requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);
  const revenueFields = new Set(['mrr', 'daily_adspend', 'pay_per_show', 'pay_per_bailed']);
  if (!includeRevenue && Object.keys(body).some(k => revenueFields.has(k))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const allowed = [
    'name', 'reporting_type', 'service_program', 'sales_package', 'offer',
    // Billing fields (editable from the Client Billing tab)
    'mrr', 'billing_type', 'billing_day', 'launch_date', 'date_signed', 'contract_end_date', 'contract_term_months', 'daily_adspend',
    'billing_model', 'pay_per_show', 'pay_per_bailed',
    // Lifecycle (pause/churn/reactivate) + performance pricing note.
    // billing_paused: billing-tab pause without changing lifecycle status.
    // ads_paused: media spend off without changing lifecycle status.
    'lifecycle_status', 'churned_at', 'performance_terms', 'billing_paused', 'billing_paused_note',
    'ads_paused', 'ads_paused_note',
    // Identity / contact (Client Roster + Client File editor)
    'email', 'billing_email', 'primary_contact', 'primary_contact_name', 'ghl_location_id', 'onboarding_clickup_task_id', 'clickup_task_id',
    'phone', 'source', 'website', 'drive_folder_url', 'funnel_url', 'virtual_business_card_url', 'virtual_card_slug', 'landing_page_url', 'brokerage_name', 'legal_business_name', 'nmls',
    'city', 'state', 'states_licensed', 'timezone',
    'identity_client_id',
    // Kick-off / ops fields + setter-facing directory blurb
    'phone_ghl', 'phone_live_transfer', 'phone_notifications', 'live_transfer_approved',
    'appointment_watch', 'brand_subject', 'account_shape', 'team_routing_notes',
    'qualifies_leads', 'qualification_notes',
    'contact_role', 'appointment_settings', 'facebook_page_name', 'offer_summary',
    // Media buying account ops
    'instagram_handle', 'ad_account_name', 'ad_account_url', 'meta_pixel_id',
    'thank_you_page_url', 'second_landing_page_url',
    // Per-client KPI band overrides (Client Success benchmark editor)
    'kpi_benchmarks',
  ];
  const numericFields = new Set(['mrr', 'contract_term_months', 'daily_adspend', 'billing_day', 'pay_per_show', 'pay_per_bailed']);
  const booleanFields = new Set(['live_transfer_approved', 'appointment_watch', 'billing_paused', 'ads_paused']);
  const updates: Record<string, unknown> = {};
  if ('states_licensed' in body) {
    updates.states_licensed = normalizeStatesLicensed(body.states_licensed);
  }
  for (const k of allowed) {
    if (!(k in body)) continue;
    if (k === 'states_licensed') continue;
    if (k === 'churned_at') continue;
    if (!includeRevenue && revenueFields.has(k)) continue;
    if (k === 'reporting_type' || k === 'offer') updates[k] = normalizeReportingType(body[k]);
    else if (k === 'billing_model') updates[k] = normalizeBillingModel(body[k]);
    else if (k === 'sales_package') updates[k] = body[k] ? normalizeSalesPackage(body[k]) : null;
    else if (k === 'service_program') {
      // Direct override when sales_package is not in the same PATCH.
      // When sales_package is present, derive below wins.
      if (!('sales_package' in body)) {
        const raw = body.service_program;
        updates.service_program =
          raw === '' || raw == null ? null : normalizeServiceProgram(raw);
      }
    }
    else if (k === 'onboarding_clickup_task_id' || k === 'clickup_task_id') {
      const raw = typeof body[k] === 'string' ? body[k].trim() : '';
      updates[k] = raw || null;
    }
    else if (k === 'ghl_location_id') {
      const raw = typeof body[k] === 'string' ? body[k] : body[k] == null ? null : String(body[k]);
      if (raw === '' || raw == null) {
        updates[k] = null;
      } else {
        const extracted = extractGhlLocationId(raw);
        if (!extracted) {
          return NextResponse.json(
            { error: 'ghl_location_id must be a GHL location id or dashboard URL containing /location/{id}' },
            { status: 400 },
          );
        }
        updates[k] = extracted;
        // Preserve a pasted dashboard URL on the CRM link field when empty.
        if (/^https?:\/\//i.test(String(raw).trim()) && !('ghl_subaccount_url' in body)) {
          updates.ghl_subaccount_url = String(raw).trim();
        }
      }
    }
    else if (k === 'source') {
      if (body[k] === '' || body[k] == null) {
        updates[k] = null;
      } else if (typeof body[k] !== 'string') {
        return NextResponse.json({ error: 'source must be Cold, Meta, Referral, or null' }, { status: 400 });
      } else {
        const normalized = normalizeClientLeadSource(body[k]);
        if (!normalized) {
          return NextResponse.json(
            { error: 'source must be Cold, Meta, or Referral' },
            { status: 400 },
          );
        }
        updates[k] = normalized;
      }
    }
    else if (k === 'kpi_benchmarks') updates[k] = body[k] ?? null; // object or null, stored as-is
    else if (k === 'brand_subject') {
      const brand = normalizeBrandSubject(body[k]);
      if (brand === 'invalid') {
        return NextResponse.json({ error: 'brand_subject must be client, company, or empty' }, { status: 400 });
      }
      updates[k] = brand;
    }
    else if (k === 'account_shape') {
      const shape = normalizeAccountShape(body[k]);
      if (shape === 'invalid') {
        return NextResponse.json({ error: 'account_shape must be solo, team, or empty' }, { status: 400 });
      }
      updates[k] = shape;
    }
    else if (k === 'qualifies_leads') {
      const qualifies = parseQualifiesLeads(body[k]);
      if (qualifies === 'invalid') {
        return NextResponse.json({ error: 'qualifies_leads must be yes, no, or empty' }, { status: 400 });
      }
      updates[k] = qualifies;
    }
    else if (k === 'meta_pixel_id') {
      const raw = body[k];
      if (raw === '' || raw == null) {
        updates[k] = null;
      } else if (typeof raw !== 'string' || !PIXEL_ID_RE.test(raw)) {
        return NextResponse.json({ error: 'Choose a pixel from the list.' }, { status: 400 });
      } else {
        const { data: pixel, error: pixelError } = await ctx.service
          .from('meta_pixels')
          .select('id')
          .eq('id', raw)
          .maybeSingle();
        if (pixelError) return NextResponse.json({ error: pixelError.message }, { status: 500 });
        if (!pixel) return NextResponse.json({ error: 'That pixel was not found.' }, { status: 400 });
        updates[k] = raw;
      }
    }
    else if (k === 'team_routing_notes' || k === 'qualification_notes') {
      const raw = typeof body[k] === 'string' ? body[k].trim() : '';
      updates[k] = raw || null;
    }
    else if (booleanFields.has(k)) updates[k] = body[k] === true || body[k] === 'yes';
    else if (numericFields.has(k)) updates[k] = body[k] === '' || body[k] === null ? null : Number(body[k]);
    else updates[k] = body[k] === '' ? null : body[k];
  }

  // Routing and qualification notes only exist with the answer that needs them.
  if ('account_shape' in updates && updates.account_shape !== 'team') {
    updates.team_routing_notes = null;
  }
  if ('qualifies_leads' in updates && updates.qualifies_leads !== true) {
    updates.qualification_notes = null;
  }

  // When only vertical changes, keep offer aligned unless the editor sent an explicit offer.
  // Derive service_program from package only when the client did not send an explicit program
  // and is not patching sales_package (sales_package block below handles that).
  if ('reporting_type' in updates) {
    if (!('offer' in body)) {
      updates.offer = updates.reporting_type;
    }
    if (!('service_program' in body) && !('sales_package' in body)) {
      const pkg = updates.sales_package ?? body.sales_package;
      updates.service_program = deriveServiceProgram(updates.reporting_type, pkg ?? 'core_offer');
    }
  }

  if ('sales_package' in updates) {
    const rt = updates.reporting_type ?? body.reporting_type;
    updates.service_program = deriveServiceProgram(rt, updates.sales_package);
  }

  // Profile editor sends both columns; partial patches may send only one — keep those aligned.
  const hasEmail = 'email' in body;
  const hasBillingEmail = 'billing_email' in body;
  if (hasEmail && hasBillingEmail) {
    updates.email = body.email === '' || body.email == null ? null : body.email;
    updates.billing_email =
      body.billing_email === '' || body.billing_email == null ? null : body.billing_email;
  } else if (hasEmail || hasBillingEmail) {
    const raw = hasEmail ? body.email : body.billing_email;
    const synced = raw === '' || raw == null ? null : raw;
    updates.email = synced;
    updates.billing_email = synced;
  }
  // Prefer primary_contact_name; mirror to legacy primary_contact for older readers.
  if ('primary_contact_name' in body) {
    updates.primary_contact = updates.primary_contact_name ?? null;
  } else if ('primary_contact' in body) {
    updates.primary_contact_name = updates.primary_contact ?? null;
  }

  // Governance stamp for the per-client KPI benchmark overrides: whenever the bands
  // change, record who/when/why so a per-client bar can't silently rot to green (a
  // >90d staleness flag in the Client Roster reads kpi_benchmarks_updated_at). On reset
  // (kpi_benchmarks = null) the governance fields clear with it.
  if ('kpi_benchmarks' in body) {
    if (updates.kpi_benchmarks == null) {
      updates.kpi_benchmarks_updated_at = null;
      updates.kpi_benchmarks_updated_by = null;
      updates.kpi_benchmarks_note = null;
    } else {
      updates.kpi_benchmarks_updated_at = new Date().toISOString();
      updates.kpi_benchmarks_updated_by = ctx.userId;
      const note = typeof body.kpi_benchmarks_note === 'string' ? body.kpi_benchmarks_note.trim() : '';
      updates.kpi_benchmarks_note = note || null;
    }
  }

  const newLifecycle =
    typeof body.lifecycle_status === 'string' ? body.lifecycle_status : null;
  const statusChangeReason =
    typeof body.status_change_reason === 'string' && body.status_change_reason.trim()
      ? body.status_change_reason.trim()
      : null;
  const statusChangeNote =
    typeof body.status_change_note === 'string' && body.status_change_note.trim()
      ? body.status_change_note.trim()
      : null;

  // Capture prior row before lifecycle validation — profile edits on an already-
  // churned client still include lifecycle_status in the body and must not require
  // a churn reason unless the status is actually changing.
  let previousLifecycle: string | null = null;
  let previousMrr: number | null = null;
  let previousAdsPaused: boolean | null = null;
  const { data: priorRow, error: priorErr } = await ctx.service
    .from('clients')
    .select('lifecycle_status, mrr, is_live, churned_at, ads_paused')
    .eq('id', id)
    .single();
  if (priorErr) return NextResponse.json({ error: priorErr.message }, { status: 500 });
  previousLifecycle = priorRow.lifecycle_status ?? null;
  previousMrr = priorRow.mrr ?? null;
  previousAdsPaused = priorRow.ads_paused === true;

  const lifecycleIsChanging =
    !!newLifecycle && newLifecycle !== previousLifecycle;

  if (lifecycleIsChanging && requiresReasonOnChurn(newLifecycle)) {
    if (!statusChangeReason || !isValidReasonCode(statusChangeReason)) {
      return NextResponse.json(
        { error: 'A churn reason is required when marking a client as churned' },
        { status: 400 },
      );
    }
  }
  if (statusChangeReason && !isValidReasonCode(statusChangeReason)) {
    return NextResponse.json({ error: 'Invalid status_change_reason' }, { status: 400 });
  }

  if ('churned_at' in body) {
    const targetLifecycle =
      typeof updates.lifecycle_status === 'string'
        ? updates.lifecycle_status
        : previousLifecycle;
    if (targetLifecycle !== 'churned') {
      return NextResponse.json(
        { error: 'Churn date can only be set while the client is churned' },
        { status: 400 },
      );
    }
    updates.churned_at = parseClientDatePatch(body.churned_at);
  }

  if (newLifecycle) {
    updates.lifecycle_status = newLifecycle;
    updates.is_live = syncIsLiveWithLifecycle(newLifecycle);
  }

  // Stamp billing pause / resume timestamps when the flag changes.
  if ('billing_paused' in updates) {
    const pausing = updates.billing_paused === true;
    updates.billing_paused_at = pausing ? new Date().toISOString() : null;
    if (!pausing) updates.billing_paused_note = null;
  }

  // Stamp ads pause / resume timestamps when the flag changes.
  if ('ads_paused' in updates) {
    const pausing = updates.ads_paused === true;
    updates.ads_paused_at = pausing ? new Date().toISOString() : null;
    if (!pausing) updates.ads_paused_note = null;
  }

  const relatedCallId =
    typeof body.related_call_id === 'string' && body.related_call_id.trim()
      ? body.related_call_id.trim()
      : null;

  if ('onboarding_clickup_task_id' in updates && updates.onboarding_clickup_task_id) {
    const { data: taskDup, error: taskDupErr } = await ctx.service
      .from('clients')
      .select('id, name')
      .eq('onboarding_clickup_task_id', updates.onboarding_clickup_task_id as string)
      .neq('id', id)
      .maybeSingle();
    if (taskDupErr) return NextResponse.json({ error: taskDupErr.message }, { status: 500 });
    if (taskDup) {
      return NextResponse.json(
        { error: `ClickUp onboarding task ID is already linked to ${taskDup.name}` },
        { status: 409 },
      );
    }
  }

  if ('clickup_task_id' in updates && updates.clickup_task_id) {
    const { data: taskDup, error: taskDupErr } = await ctx.service
      .from('clients')
      .select('id, name')
      .eq('clickup_task_id', updates.clickup_task_id as string)
      .neq('id', id)
      .maybeSingle();
    if (taskDupErr) return NextResponse.json({ error: taskDupErr.message }, { status: 500 });
    if (taskDup) {
      return NextResponse.json(
        { error: `ClickUp task ID is already linked to ${taskDup.name}` },
        { status: 409 },
      );
    }
  }

  if ('name' in updates || 'email' in updates || 'ghl_location_id' in updates || 'primary_contact_name' in updates) {
    const { data: current } = await ctx.service
      .from('clients')
      .select('name, email, ghl_location_id, primary_contact_name')
      .eq('id', id)
      .single();
    if (current) {
      try {
        const conflicts = await findClientConflicts(ctx.service, {
          name: (updates.name as string | undefined) ?? current.name,
          email: (updates.email as string | null | undefined) ?? current.email,
          ghl_location_id:
            (updates.ghl_location_id as string | null | undefined) ?? current.ghl_location_id,
          primary_contact_name:
            (updates.primary_contact_name as string | null | undefined) ?? current.primary_contact_name,
          excludeId: id,
        });
        if (conflicts.blocked) {
          return NextResponse.json(
            { error: formatClientConflictMessage(conflicts.conflicts), conflicts: conflicts.conflicts },
            { status: 409 },
          );
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
  }

  const { data, error } = await ctx.service
    .from('clients')
    .update(updates)
    .eq('id', id)
    .select(FILE_CLIENT_FIELDS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const identityPatch = identityFieldsFromPatch(updates);
  const identityGroup = await loadClientIdentityGroup(ctx.service, id);
  if (identityGroup && Object.keys(identityPatch).length) {
    try {
      await propagateIdentityFields(ctx.service, identityGroup.identity_client_id, identityPatch);
    } catch (e) {
      console.error('[clients] identity propagate failed', e);
    }
  }

  // Enrich the trigger-created history row when lifecycle changes with feedback.
  if (lifecycleIsChanging) {
    const { data: historyRows, error: historyError } = await ctx.service
      .from('client_status_history')
      .select('id')
      .eq('client_id', id)
      .eq('previous_status', previousLifecycle)
      .eq('new_status', newLifecycle)
      .eq('source', 'trigger')
      .order('changed_at', { ascending: false })
      .limit(1);

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    const historyId = historyRows?.[0]?.id;
    if (historyId && (statusChangeReason || statusChangeNote || relatedCallId)) {
      const historyUpdate: Record<string, unknown> = {
        source: 'manual',
        changed_by: ctx.userId,
      };
      if (statusChangeReason) historyUpdate.reason_code = statusChangeReason;
      if (statusChangeNote) historyUpdate.note = statusChangeNote;
      if (relatedCallId) historyUpdate.related_call_id = relatedCallId;

      const { error: enrichError } = await ctx.service
        .from('client_status_history')
        .update(historyUpdate)
        .eq('id', historyId);

      if (enrichError) {
        return NextResponse.json({ error: enrichError.message }, { status: 500 });
      }

      if (relatedCallId) {
        await ctx.service
          .from('client_calls')
          .update({ status_history_id: historyId })
          .eq('id', relatedCallId)
          .eq('client_id', id);
      }
    }
  }

  if (includeRevenue && 'mrr' in updates && updates.mrr !== previousMrr) {
    await ctx.service.from('client_mrr_history').insert({
      client_id: id,
      previous_mrr: previousMrr,
      new_mrr: updates.mrr as number | null,
      changed_by: ctx.userId,
      note: typeof body.mrr_change_note === 'string' ? body.mrr_change_note.trim() || null : null,
    });
  }

  // Timeline note when ads pause flips (appears in Client File activity rail).
  if (
    'ads_paused' in updates
    && updates.ads_paused !== previousAdsPaused
  ) {
    const paused = updates.ads_paused === true;
    const noteText = paused
      ? updates.ads_paused_note
        ? `Ads paused — ${String(updates.ads_paused_note)}`
        : 'Ads paused'
      : 'Ads turned back on';
    const { error: noteErr } = await ctx.service.from('client_notes').insert({
      client_id: id,
      note_type: 'internal',
      body: noteText,
      created_by: ctx.userId,
    });
    if (noteErr) console.error('[clients] ads_paused activity note failed', noteErr);
  }

  const mergedClient = identityGroup
    ? withIdentityProfile(data, identityGroup.identity)
    : data;

  let pending_replay = { replayed: 0, skipped: 0, failed: 0, errors: [] as string[] };
  if ('name' in updates || 'ghl_location_id' in updates) {
    try {
      pending_replay = await replayPendingForClientId(ctx.service, id);
    } catch (e) {
      console.error('[clients] pending replay after patch failed', e);
    }
  }

  return NextResponse.json({
    client: includeRevenue ? mergedClient : redactClientMoneyFields(mergedClient),
    offer: data,
    related_offers: identityGroup?.offers ?? [],
    identity_client_id: identityGroup?.identity_client_id ?? id,
    pending_replay,
  });
}
