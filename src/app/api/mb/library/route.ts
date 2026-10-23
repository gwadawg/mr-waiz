import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbLibrary } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';

/** GET /api/mb/library — ad names, aliases, and copy. No spend and no client. */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    return mbJson(await getMbLibrary(ctx.service));
  } catch (err) {
    return mbError(err);
  }
}
