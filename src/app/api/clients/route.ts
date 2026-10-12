import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requirePermission, requireAnyPermission } from '@/lib/api-auth';
import { normalizeReportingType } from '@/lib/kpi-layouts';
import { defaultQualifiesLeads } from '@/lib/dial-pool';
import { normalizeServiceProgram } from '@/lib/service-program';
import { normalizeStatesLicensed } from '@/lib/us-states';
import { canViewClientRevenue, redactClientMoneyFields } from '@/lib/client-revenue-access';
import { findClientConflicts, formatClientConflictMessage } from '@/lib/client-duplicate-check';
import { findIdentityClientForNewOffer } from '@/lib/client-identity';
import { replayPendingForClientId } from '@/lib/pending-events';
import { getFormProgressForClients } from '@/lib/form-submissions';
import { syncIsLiveWithLifecycle } from '@/lib/lifecycle-sync';
import { normalizeClientLeadSource } from '@/lib/client-lead-source';
import { ensureAccountGroupForNewClient } from '@/lib/client-account-groups';

const DETAIL_FIELDS =
  'id, name, is_live, reporting_type, service_program, sales_package, offer, share_token, created_at, lifecycle_status, mrr, daily_adspend, ads_paused, ads_paused_at, ads_paused_note, billing_type, billing_day, launch_date, date_signed, churned_at, contract_term_months, contract_end_date, performance_terms, email, billing_email, primary_contact, primary_contact_name, states_licensed, timezone, drive_folder_url, facebook_page_name, website, funnel_url, virtual_business_card_url, virtual_card_slug, landing_page_url, instagram_handle, ad_account_name, ad_account_url, thank_you_page_url, second_landing_page_url, kpi_benchmarks, kpi_benchmarks_updated_at, kpi_benchmarks_updated_by, kpi_benchmarks_note, onboarding_clickup_task_id, clickup_task_id, ghl_location_id, account_group_id, engagement_kind, appointment_watch, qualifies_leads';

// GET is intentionally open to any authenticated user: the client list powers
// the global client-filter dropdown on nearly every tab, so it is a shared
// lookup rather than admin-only data. Mutations below are gated to the admin tab.
//
// ?detail=1 returns the full client record plus a computed total_paid, for the
// Client Roster manager; that richer shape is gated to the admin tabs.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const detail = new URL(req.url).searchParams.get('detail');
  if (!detail) {
    const { data, error } = await ctx.service
      .from('clients')
      .select('id, name, is_live, reporting_type, share_token, created_at, launch_date, date_signed, lifecycle_status, churned_at, states_licensed, ads_paused, ads_paused_at, ads_paused_note')
      .order('name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ clients: data });
  }

  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);

  const clientsRes = await ctx.service.from('clients').select(DETAIL_FIELDS).order('name');
  if (clientsRes.error) return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });

  const paidByClient = new Map<string, number>();
  if (includeRevenue) {
    const paidRes = await ctx.service.from('client_billings').select('client_id, amount_paid');
    if (paidRes.error) return NextResponse.json({ error: paidRes.error.message }, { status: 500 });
    for (const b of paidRes.data ?? []) {
      paidByClient.set(b.client_id, (paidByClient.get(b.client_id) ?? 0) + (Number(b.amount_paid) || 0));
    }
  }

  const clients = (clientsRes.data ?? []).map(c => {
    const row = includeRevenue ? c : redactClientMoneyFields(c);
    return {
      ...row,
      ...(includeRevenue ? { total_paid: paidByClient.get(c.id) ?? 0 } : {}),
    };
  });

  const clientIds = (clientsRes.data ?? []).map(c => c.id);
  let formProgress: Record<string, Partial<Record<string, boolean>>> = {};
  try {
    formProgress = await getFormProgressForClients(ctx.service, clientIds);
  } catch (e) {
    console.error('[clients] form progress fetch failed', e);
  }

  const clientsWithProgress = clients.map(c => ({
    ...c,
    form_progress: formProgress[c.id] ?? {},
  }));

  const groupIds = [...new Set((clientsRes.data ?? []).map(c => c.account_group_id).filter(Boolean))] as string[];
  let accountGroups: Record<string, { id: string; display_name: string; primary_email: string | null }> = {};
  if (groupIds.length) {
    const { data: groups, error: groupsErr } = await ctx.service
      .from('client_account_groups')
      .select('id, display_name, primary_email')
      .in('id', groupIds);
    if (groupsErr) return NextResponse.json({ error: groupsErr.message }, { status: 500 });
    accountGroups = Object.fromEntries((groups ?? []).map(g => [g.id, g]));
  }

  const clientsEnriched = clientsWithProgress.map(c => ({
    ...c,
    account_display_name: c.account_group_id
      ? accountGroups[c.account_group_id as string]?.display_name ?? null
      : null,
    account_primary_email: c.account_group_id
      ? accountGroups[c.account_group_id as string]?.primary_email ?? null
      : null,
  }));

  return NextResponse.json({
    clients: clientsEnriched,
    account_groups: accountGroups,
    can_view_revenue: includeRevenue,
    can_view_total_paid: includeRevenue,
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  // Allowed from the Client Roster (admin_clients) and the billing onboarding
  // flow (admin_billing).
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);

  const body = await req.json();
  const { name, reporting_type } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const insert: Record<string, unknown> = {
    name: name.trim(),
    reporting_type: normalizeReportingType(reporting_type),
    offer: normalizeReportingType(reporting_type),
  };
  insert.qualifies_leads = defaultQualifiesLeads(insert.reporting_type);
  if ('service_program' in body) {
    insert.service_program = normalizeServiceProgram(body.service_program);
  }
  const numericFields = new Set(['mrr', 'contract_term_months', 'daily_adspend', 'billing_day']);
  const revenueFields = new Set(['mrr', 'daily_adspend']);
  const optional = [
    'is_live', 'lifecycle_status', 'mrr', 'billing_type', 'billing_day', 'launch_date',
    'date_signed', 'contract_end_date', 'contract_term_months', 'daily_adspend',
    'performance_terms', 'email', 'billing_email', 'primary_contact', 'primary_contact_name', 'states_licensed', 'timezone', 'source',
    'website', 'brokerage_name', 'nmls', 'phone', 'identity_client_id',
  ] as const;
  for (const k of optional) {
    if (!(k in body)) continue;
    if (!includeRevenue && revenueFields.has(k)) continue;
    if (k === 'states_licensed') {
      insert[k] = normalizeStatesLicensed(body[k]);
      continue;
    }
    if (numericFields.has(k)) insert[k] = body[k] === '' || body[k] === null ? null : Number(body[k]);
    else if (k === 'source') insert[k] = normalizeClientLeadSource(body[k]);
    else insert[k] = body[k] === '' ? null : body[k];
  }
  const lifecycle = (insert.lifecycle_status as string) ?? 'new_account';
  insert.is_live = syncIsLiveWithLifecycle(lifecycle);
  // email and billing_email are kept in sync.
  if ('email' in insert || 'billing_email' in insert) {
    const synced = (insert.email ?? insert.billing_email ?? null) as string | null;
    insert.email = synced;
    insert.billing_email = synced;
  }

  const linkedIdentityClientId =
    typeof body.identity_client_id === 'string' && body.identity_client_id.trim()
      ? body.identity_client_id.trim()
      : await findIdentityClientForNewOffer(ctx.service, {
          nmls: (insert.nmls as string | null) ?? null,
          email: (insert.email as string | null) ?? null,
          phone: (insert.phone as string | null) ?? null,
          primary_contact_name: (insert.primary_contact_name as string | null) ?? null,
        });
  if (linkedIdentityClientId) {
    insert.identity_client_id = linkedIdentityClientId;
  }

  try {
    const conflicts = await findClientConflicts(ctx.service, {
      name: insert.name as string,
      email: (insert.email as string | null) ?? null,
      primary_contact_name: (insert.primary_contact_name as string | null) ?? null,
      ghl_location_id: (insert.ghl_location_id as string | null) ?? null,
      linkedIdentityClientId,
    });
    if (conflicts.blocked) {
      return NextResponse.json(
        { error: formatClientConflictMessage(conflicts.conflicts), conflicts: conflicts.conflicts },
        { status: 409 },
      );
    }

    const accountLink = await ensureAccountGroupForNewClient(ctx.service, {
      name: insert.name as string,
      primary_contact_name: (insert.primary_contact_name as string | null) ?? null,
      primary_contact: (insert.primary_contact as string | null) ?? null,
      email: (insert.email as string | null) ?? null,
      account_group_id: body.account_group_id ?? null,
      origin_client_id: body.origin_client_id ?? null,
      engagement_kind: body.engagement_kind,
      reporting_type: normalizeReportingType(insert.reporting_type),
    });
    insert.account_group_id = accountLink.account_group_id;
    insert.engagement_kind = accountLink.engagement_kind;
    if (accountLink.origin_client_id) insert.origin_client_id = accountLink.origin_client_id;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await ctx.service
    .from('clients')
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let pending_replay = { replayed: 0, skipped: 0, failed: 0, errors: [] as string[] };
  try {
    pending_replay = await replayPendingForClientId(ctx.service, data.id);
  } catch (e) {
    console.error('[clients] pending replay after create failed', e);
  }

  return NextResponse.json({ client: data, pending_replay });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requirePermission(ctx, 'admin_clients');
  if (denied) return denied;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service.from('clients').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
