import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import { CLIENT_CALL_FIELDS } from '@/lib/client-calls';
import { dedupePeople, loadPeople } from '@/lib/person-store';
import {
  resolveAccountIdentityClientId,
  resolveAccountMemberIds,
} from '@/lib/account-identity-sync';
import { loadClientIdentityGroup } from '@/lib/client-identity';
import { resolveUserLabels } from '@/lib/user-resolver';
import { getSiblingClients } from '@/lib/client-account-groups';

const CLIENT_NOTES_FIELDS =
  'id, client_id, note_type, reason_code, body, created_at, created_by, updated_at, related_call_id';

type ClientLabel = { id: string; name: string; reporting_type: string | null };

function labelForClient(labels: Map<string, ClientLabel>, clientId: string): string | null {
  const row = labels.get(clientId);
  if (!row) return null;
  return row.reporting_type ?? row.name;
}

// GET /api/clients/[id]/relationship — account-level calls, notes, and contacts
// aggregated across all linked offers for the same LO.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id } = await params;

  const [memberIds, identityGroup, siblings] = await Promise.all([
    resolveAccountMemberIds(ctx.service, id),
    loadClientIdentityGroup(ctx.service, id),
    getSiblingClients(ctx.service, id),
  ]);

  const identityClientId = identityGroup?.identity_client_id ?? id;
  const mergedIdentity = identityGroup?.identity;

  const labelSource =
    siblings.length > 0
      ? siblings
      : (
          await ctx.service
            .from('clients')
            .select('id, name, reporting_type')
            .in('id', memberIds)
        ).data ?? [];

  const labelRows: ClientLabel[] = labelSource.map(
    (s: { id: string; name: string; reporting_type: string | null }) => ({
      id: s.id,
      name: s.name,
      reporting_type: s.reporting_type,
    }),
  );

  const labelMap = new Map(labelRows.map(r => [r.id, r]));

  const [callsRes, notesRes] = await Promise.all([
    ctx.service
      .from('client_calls')
      .select(CLIENT_CALL_FIELDS)
      .in('client_id', memberIds)
      .is('deleted_at', null)
      .order('called_at', { ascending: false }),
    ctx.service
      .from('client_notes')
      .select(CLIENT_NOTES_FIELDS)
      .in('client_id', memberIds)
      .is('contact_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  if (callsRes.error) return NextResponse.json({ error: callsRes.error.message }, { status: 500 });
  if (notesRes.error) return NextResponse.json({ error: notesRes.error.message }, { status: 500 });

  let contacts;
  try {
    contacts = dedupePeople(await loadPeople(ctx.service, memberIds, identityClientId));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const authorIds = [
    ...(callsRes.data ?? []).map((c: { created_by?: string | null }) => c.created_by),
    ...(notesRes.data ?? []).map((n: { created_by?: string | null }) => n.created_by),
  ];
  const authorLabels = await resolveUserLabels(ctx.service, authorIds);

  const calls = (callsRes.data ?? []).map((c: { client_id: string; created_by?: string | null }) => ({
    ...c,
    offer_label: labelForClient(labelMap, c.client_id),
    created_by_label: c.created_by ? authorLabels[c.created_by] ?? null : null,
  }));

  const notes = (notesRes.data ?? []).map((n: { client_id: string; created_by?: string | null }) => ({
    ...n,
    offer_label: labelForClient(labelMap, n.client_id),
    created_by_label: n.created_by ? authorLabels[n.created_by] ?? null : null,
  }));

  const { data: identityRow } = mergedIdentity
    ? { data: mergedIdentity }
    : await ctx.service
        .from('clients')
        .select('primary_contact_name, primary_contact, name')
        .eq('id', identityClientId)
        .maybeSingle();

  return NextResponse.json({
    identity_client_id: identityClientId,
    member_client_ids: memberIds,
    account_display_name:
      identityRow?.primary_contact_name ??
      identityRow?.primary_contact ??
      identityRow?.name ??
      null,
    calls,
    notes,
    contacts,
  });
}
