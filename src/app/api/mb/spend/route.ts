import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbClientSpend, parseMbSpendRange } from '@/lib/mb-api';
import { todayYmdInCallCenterTz } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/mb/spend
 * GET /api/mb/spend?preset=last_week
 * GET /api/mb/spend?start_date=&end_date=
 *
 * One response: every client's Meta ad spend. Default window is last week.
 * Does not accept a clientId. Other KPIs stay on the one-client routes.
 */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const params = req.nextUrl.searchParams;
    const range = parseMbSpendRange(params, todayYmdInCallCenterTz());
    const report = await getMbClientSpend(ctx.service, range);
    const preset = params.get('start_date')?.trim() ? null : 'last_week';
    return mbJson({ ...report, preset });
  } catch (err) {
    return mbError(err);
  }
}
