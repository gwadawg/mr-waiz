import { NextRequest } from 'next/server';
import { authorizeMb, assertMbAuth, mbError, mbJson } from '@/lib/mb-auth';
import {
  getMbActivity,
  parseMbActivityKind,
  parseMbLimit,
  parseMbOffset,
  parseMbRange,
  requireMbClientId,
} from '@/lib/mb-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/mb/activity?clientId=&kind=leads|dials|appointments|closes&start_date=&end_date=&limit=&offset= */
export async function GET(req: NextRequest) {
  const ctx = await authorizeMb(req);
  if (!assertMbAuth(ctx)) return ctx;

  try {
    const params = req.nextUrl.searchParams;
    const clientId = requireMbClientId(params);
    const range = parseMbRange(params);
    const kind = parseMbActivityKind(params.get('kind'));
    const limit = parseMbLimit(params.get('limit'));
    const offset = parseMbOffset(params.get('offset'));
    return mbJson(await getMbActivity(ctx.service, clientId, range, kind, limit, offset));
  } catch (err) {
    return mbError(err);
  }
}
