import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import { getMbAds, parseMbRange } from '@/lib/mb-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/mb/ads?clientId=&start_date=&end_date=
 * GET /api/mb/ads?library_id=&clientId=&start_date=&end_date=
 * GET /api/mb/ads?ad=&clientId=&start_date=&end_date=
 */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const params = req.nextUrl.searchParams;
    const range = parseMbRange(params);
    const clientId = params.get('clientId')?.trim() || null;
    return mbJson(
      await getMbAds(
        ctx.service,
        { clientId, startDate: range.start_date, endDate: range.end_date },
        {
          libraryId: params.get('library_id')?.trim() || null,
          ad: params.get('ad')?.trim() || null,
          variants: params.get('variants'),
        },
      ),
    );
  } catch (err) {
    return mbError(err);
  }
}
