import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { parseDealEditBody, parseEventEditBody } from '@/lib/conversion-log-corrections';
import { removeConversionLog, updateDealLog, updateEventLog } from '@/lib/conversion-log-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOwner(isOwner: boolean): NextResponse | null {
  if (isOwner) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function kindFrom(url: string, body: unknown): 'deal' | 'event' | null {
  const queryKind = new URL(url).searchParams.get('kind');
  const bodyKind =
    body && typeof body === 'object' ? (body as { kind?: unknown }).kind : undefined;
  const kind = queryKind ?? bodyKind;
  if (kind === 'deal' || kind === 'event') return kind;
  return null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; logId: string }> },
) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireOwner(ctx.isOwner);
  if (denied) return denied;

  const { id, logId } = await params;
  if (!UUID.test(logId)) {
    return NextResponse.json({ error: 'That log was not found.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const kind = kindFrom(req.url, body);
  if (!kind) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });

  try {
    if (kind === 'deal') {
      const parsed = parseDealEditBody(body);
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const result = await updateDealLog(ctx.service, id, logId, parsed);
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    } else {
      const parsed = parseEventEditBody(body);
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const result = await updateEventLog(ctx.service, id, logId, parsed);
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[conversion-logs]', err);
    return NextResponse.json({ error: "Couldn't update this log." }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; logId: string }> },
) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireOwner(ctx.isOwner);
  if (denied) return denied;

  const { id, logId } = await params;
  if (!UUID.test(logId)) {
    return NextResponse.json({ error: 'That log was not found.' }, { status: 404 });
  }
  const kind = kindFrom(req.url, null);
  if (!kind) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });

  try {
    const result = await removeConversionLog(ctx.service, id, kind, logId);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[conversion-logs]', err);
    return NextResponse.json({ error: "Couldn't remove this log." }, { status: 500 });
  }
}
