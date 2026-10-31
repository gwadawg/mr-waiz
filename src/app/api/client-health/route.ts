import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requirePermission } from '@/lib/api-auth';
import { loadClientHealthBundle } from '@/lib/load-client-health';
import { createTtlCache } from '@/lib/ttl-cache';

const clientHealthCache = createTtlCache<unknown>(45_000);

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requirePermission(ctx, 'client_health');
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');
  const live_only = searchParams.get('live_only') === 'true';
  const lens = searchParams.get('lens') === 'on_todays_criteria' ? 'on_todays_criteria' : 'as_judged_then';

  if (!start_date || !end_date) {
    return NextResponse.json({ error: 'start_date and end_date are required' }, { status: 400 });
  }

  const cacheKey = [start_date, end_date, live_only ? '1' : '0', lens].join('|');
  const cached = clientHealthCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'private, max-age=20' },
    });
  }

  try {
    const bundle = await loadClientHealthBundle(ctx.service, {
      start_date,
      end_date,
      live_only,
      lens,
    });
    clientHealthCache.set(cacheKey, bundle);
    return NextResponse.json(bundle, {
      headers: { 'Cache-Control': 'private, max-age=20' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
