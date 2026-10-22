import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbCalls, requireMbClientId } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';

/** GET /api/mb/calls?clientId= — onboarding and launch calls only. */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const clientId = requireMbClientId(req.nextUrl.searchParams);
    return mbJson(await getMbCalls(ctx.service, clientId));
  } catch (err) {
    return mbError(err);
  }
}
