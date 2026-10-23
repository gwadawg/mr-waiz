import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbAdDiagnosis, requireMbClientId } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';
/** Large accounts take about a minute (lead + event loads). */
export const maxDuration = 300;

/**
 * GET /api/mb/ad-diagnosis?clientId=&start_date=&end_date=&mature_days=&qualify_switch=&qualify_before=
 *
 * One client's ads ranked on what their leads became downstream. Defaults to
 * launch date → today. Omit start/end to use that window.
 */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const params = req.nextUrl.searchParams;
    const clientId = requireMbClientId(params);
    const before = params.get('qualify_before')?.trim() || null;
    if (before && before !== 'yes' && before !== 'no') {
      throw new Error('qualify_before must be yes or no');
    }
    const matureRaw = params.get('mature_days')?.trim();
    const matureDays = matureRaw ? Number(matureRaw) : null;
    if (matureRaw && !Number.isFinite(matureDays)) {
      throw new Error('mature_days must be a positive number');
    }

    return mbJson(
      await getMbAdDiagnosis(ctx.service, clientId, {
        startDate: params.get('start_date')?.trim() || null,
        endDate: params.get('end_date')?.trim() || null,
        matureDays,
        qualifySwitch: params.get('qualify_switch')?.trim() || null,
        qualifyBefore: before as 'yes' | 'no' | null,
      }),
    );
  } catch (err) {
    return mbError(err);
  }
}
