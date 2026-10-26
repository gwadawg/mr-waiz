import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbPortfolio, parseMbSpendRange } from '@/lib/mb-api';
import { todayYmdInCallCenterTz } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/mb/spend
 * GET /api/mb/spend?preset=last_week|all_time|...
 * GET /api/mb/spend?start_date=&end_date=
 *
 * Alias of the all-client KPI report. Same body as GET /api/mb/performance
 * with no clientId: every client's metrics for the window, not spend alone.
 */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const params = req.nextUrl.searchParams;
    const range = parseMbSpendRange(params, todayYmdInCallCenterTz());
    const report = await getMbPortfolio(ctx.service, range);
    const preset = params.get('start_date')?.trim() ? null : params.get('preset')?.trim() || 'last_week';
    return mbJson({ ...report, preset });
  } catch (err) {
    return mbError(err);
  }
}
