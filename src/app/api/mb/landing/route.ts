import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbLanding, requireMbClientId } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';

/** GET /api/mb/landing?clientId= — read-only page copy and URLs. */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const clientId = requireMbClientId(req.nextUrl.searchParams);
    return mbJson(await getMbLanding(ctx.service, clientId));
  } catch (err) {
    return mbError(err);
  }
}
