import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { listMbClients } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';

/** GET /api/mb/clients?search= */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const search = req.nextUrl.searchParams.get('search') ?? undefined;
    return mbJson(await listMbClients(ctx.service, search));
  } catch (err) {
    return mbError(err);
  }
}
