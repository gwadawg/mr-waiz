import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { listConversionLogs } from '@/lib/conversion-log-store';

function requireOwner(isOwner: boolean): NextResponse | null {
  if (isOwner) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireOwner(ctx.isOwner);
  if (denied) return denied;

  const { id } = await params;
  try {
    const rows = await listConversionLogs(ctx.service, id);
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[conversion-logs]', err);
    return NextResponse.json({ error: "Couldn't load logged conversions." }, { status: 500 });
  }
}
