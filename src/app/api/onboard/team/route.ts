import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateContactInput } from '@/lib/client-contacts';
import { missingRoleRequirement, parsePersonProfile } from '@/lib/person-profile';
import { saveSubmittedPerson } from '@/lib/person-store';
import { resolveTeamInvite } from '@/lib/team-invite';

function tokenFromRequest(req: Request, body?: Record<string, unknown>): string | null {
  const { searchParams } = new URL(req.url);
  const fromQuery = searchParams.get('token')?.trim();
  if (fromQuery) return fromQuery;
  if (body && typeof body.token === 'string') return body.token.trim() || null;
  return null;
}

// GET /api/onboard/team?token=… — resolve invite for the public form.
export async function GET(req: Request) {
  const token = tokenFromRequest(req);
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const service = createServiceClient();
  const invite = await resolveTeamInvite(service, token);
  if (!invite) {
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 404 });
  }

  return NextResponse.json({
    client_name: invite.client_name,
    primary_contact_name: invite.primary_contact_name,
  });
}

const FILE_MAX_BYTES = 20 * 1024 * 1024;

async function readTeamSubmission(req: Request): Promise<{
  body: Record<string, unknown>;
  headshot: { fileName: string; contentType: string; bytes: Buffer } | null;
  files: { fileName: string; contentType: string; bytes: Buffer }[];
}> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') throw new Error('Invalid JSON body');
    return { body, headshot: null, files: [] };
  }

  const form = await req.formData();
  const body: Record<string, unknown> = {};
  let headshot: { fileName: string; contentType: string; bytes: Buffer } | null = null;
  const files: { fileName: string; contentType: string; bytes: Buffer }[] = [];

  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      if (!value.size) continue;
      if (value.size > FILE_MAX_BYTES) throw new Error('File is too large (max 20MB)');
      const packed = {
        fileName: value.name || key,
        contentType: value.type || 'application/octet-stream',
        bytes: Buffer.from(await value.arrayBuffer()),
      };
      if (key === 'headshot') headshot = packed;
      else if (key.startsWith('file')) files.push(packed);
      continue;
    }
    if (key === 'states_licensed' || key === 'profile' || key === 'notes') {
      try {
        body[key] = JSON.parse(value);
      } catch {
        body[key] = value;
      }
      continue;
    }
    body[key] = value;
  }
  return { body, headshot, files };
}

// POST /api/onboard/team — public submit; adds one person to client_contacts.
export async function POST(req: Request) {
  let parsed: Awaited<ReturnType<typeof readTeamSubmission>>;
  try {
    parsed = await readTeamSubmission(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { body, headshot, files } = parsed;
  const token = tokenFromRequest(req, body);
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const service = createServiceClient();
  const invite = await resolveTeamInvite(service, token);
  if (!invite) {
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 404 });
  }

  const validated = validateContactInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  if (validated.data.contact_type === 'primary_lo') {
    return NextResponse.json({ error: 'This link adds a teammate, not a second primary loan officer' }, { status: 400 });
  }

  const profile = parsePersonProfile(body.profile ?? validated.data.profile);
  const gap = missingRoleRequirement(validated.data.contact_type, {
    states_licensed: validated.data.states_licensed,
  });
  if (gap) {
    return NextResponse.json({ error: gap }, { status: 400 });
  }

  const notes = Array.isArray(body.notes) ? body.notes.filter((note): note is string => typeof note === 'string') : [];

  try {
    const contact = await saveSubmittedPerson(service, invite.client_id, {
      contact_type: validated.data.contact_type,
      name: validated.data.name,
      email: validated.data.email,
      phone: validated.data.phone,
      nmls: validated.data.nmls,
      states_licensed: validated.data.states_licensed,
      profile,
      notes,
      headshot,
      files,
    }, null);
    return NextResponse.json({
      ok: true,
      contact,
      client_name: invite.client_name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
