import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import {
  loadMetricsBundle,
  metricsCacheHeaders,
} from '@/lib/load-metrics-bundle';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  // Shared by the Dashboard and the Goal Tracker (progress vs. targets).
  const denied = requireAnyPermission(ctx, ['dashboard', 'agents']);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  const live_only = searchParams.get('live_only') === 'true';
  const reporting_type = searchParams.get('reporting_type');
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');
  const include_trends = searchParams.get('include_trends') === '1';
  const granularity = searchParams.get('granularity');

  const { data, error } = await loadMetricsBundle(
    ctx.service,
    { client_id, live_only, reporting_type, start_date, end_date },
    { includeTrends: include_trends, granularity },
  );

  if (error || !data) {
    return NextResponse.json({ error: error ?? 'Metrics load failed' }, { status: 500 });
  }

  // Backward-compatible flat metrics payload; optional nested trends for dashboard.
  if (include_trends) {
    return NextResponse.json(
      {
        ...data.metrics,
        dial_pool: data.dial_pool,
        trends: data.trends,
        ...(data.warnings?.length ? { warnings: data.warnings } : {}),
      },
      { headers: metricsCacheHeaders() },
    );
  }

  return NextResponse.json(
    {
      ...data.metrics,
      dial_pool: data.dial_pool,
      ...(data.warnings?.length ? { warnings: data.warnings } : {}),
    },
    { headers: metricsCacheHeaders() },
  );
}
