import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import {
  CLIENT_CONTACT_FIELDS,
  validateContactInput,
} from '@/lib/client-contacts';
import { ensurePrimaryPerson, loadPeople } from '@/lib/person-store';

// GET /api/clients/[id]/contacts — list additional contacts for a client.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id: clientId } = await params;

  try {
    const contacts = await loadPeople(ctx.service, [clientId], clientId);
    return NextResponse.json({ contacts });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/clients/[id]/contacts — add an additional contact.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id: clientId } = await params;
  const body = await req.json();
  const validated = validateContactInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { data: client, error: clientError } = await ctx.service
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single();

  if (clientError) {
    const status = clientError.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: clientError.message }, { status });
  }
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  if (validated.data.contact_type === 'primary_lo') {
    try {
      await ensurePrimaryPerson(ctx.service, clientId);
      const contacts = await loadPeople(ctx.service, [clientId], clientId);
      const primary = contacts.find(person => person.contact_type === 'primary_lo');
      if (!primary) {
        return NextResponse.json({ error: 'Could not create the primary loan officer' }, { status: 500 });
      }
      return NextResponse.json({ contact: primary });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const sortOrder =
    typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)
      ? Math.trunc(body.sort_order)
      : 0;

  const { data, error } = await ctx.service
    .from('client_contacts')
    .insert({
      client_id: clientId,
      contact_type: validated.data.contact_type,
      name: validated.data.name,
      email: validated.data.email,
      phone: validated.data.phone,
      nmls: validated.data.nmls,
      states_licensed: validated.data.states_licensed,
      notes: validated.data.notes,
      profile: validated.data.profile,
      sort_order: sortOrder,
      created_by: ctx.userId,
    })
    .select(CLIENT_CONTACT_FIELDS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    contact: { ...data, profile: validated.data.profile, person_notes: [], person_files: [] },
  });
}
