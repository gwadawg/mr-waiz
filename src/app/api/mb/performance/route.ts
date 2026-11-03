import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import {
  getMbLaunchDate,
  getMbPerformance,
  getMbPortfolio,
  parseMbSpendRange,
  resolveMbPerformanceRange,
} from '@/lib/mb-api';
import { todayYmdInCallCenterTz } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/mb/performance?clientId=&start_date=&end_date=
 * GET /api/mb/performance?preset=last_week|all_time|...
 *
 * With clientId, one client's KPIs. Presets work, including since_launch.
 * No preset and no dates is the last 30 days.
 * Without clientId, every client's full KPI set for one shared window.
 */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const params = req.nextUrl.searchParams;
    const clientId = params.get('clientId')?.trim() || '';
    if (clientId) {
      const today = todayYmdInCallCenterTz();
      const launch =
        params.get('preset')?.trim() === 'since_launch'
          ? await getMbLaunchDate(ctx.service, clientId)
          : null;
      const range = resolveMbPerformanceRange(params, today, launch);
      return mbJson(await getMbPerformance(ctx.service, clientId, range));
    }
    const range = parseMbSpendRange(params, todayYmdInCallCenterTz());
    const report = await getMbPortfolio(ctx.service, range);
    const preset = params.get('start_date')?.trim() ? null : params.get('preset')?.trim() || 'last_week';
    return mbJson({ ...report, preset });
  } catch (err) {
    return mbError(err);
  }
}
