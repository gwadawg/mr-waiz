import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requirePermission } from '@/lib/api-auth';
import { parseIdList } from '@/lib/client-compare';
import { loadClientCompareBundle } from '@/lib/load-client-compare';
import { createTtlCache } from '@/lib/ttl-cache';

const cache = createTtlCache<unknown>(45_000);

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requirePermission(ctx, 'client_compare');
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start') ?? searchParams.get('start_date');
  const end = searchParams.get('end') ?? searchParams.get('end_date');
  const extraIds = parseIdList(searchParams.get('ids'));

  if (!start || !end) {
    return NextResponse.json({ error: 'start and end are required' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: 'start and end must be YYYY-MM-DD' }, { status: 400 });
  }

  const lens = searchParams.get('lens') === 'on_todays_criteria' ? 'on_todays_criteria' : 'as_judged_then';
  const cacheKey = [start, end, extraIds.slice().sort().join(','), lens].join('|');
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'private, max-age=20' },
    });
  }

  try {
    const bundle = await loadClientCompareBundle(ctx.service, {
      start,
      end,
      extraIds,
      lens,
    });
    cache.set(cacheKey, bundle);
    return NextResponse.json(bundle, {
      headers: { 'Cache-Control': 'private, max-age=20' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
