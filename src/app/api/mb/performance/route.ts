import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbPerformance, parseMbRange, requireMbClientId } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/mb/performance?clientId=&start_date=&end_date= */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const clientId = requireMbClientId(req.nextUrl.searchParams);
    const range = parseMbRange(req.nextUrl.searchParams);
    return mbJson(await getMbPerformance(ctx.service, clientId, range));
  } catch (err) {
    return mbError(err);
  }
}
