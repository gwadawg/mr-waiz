import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import { DEFAULT_KPI_BANDS, type KpiKey } from '@/lib/client-health';
import {
  applyStockEdit,
  costIdentityError,
  pickCostDriver,
  placeholdersAfterStockEdit,
  retainCostDriver,
  customHistory,
  ignoredStoredKeys,
  normalizeOverlay,
  profileFor,
  resolveClientCriteria,
  stockHistory,
  type CostDriver,
  type CostTriple,
  type CriteriaClient,
  type StockVersion,
} from '@/lib/kpi-criteria';
import { loadCriteriaCatalog, saveCustomVersion, saveStockVersion } from '@/lib/kpi-criteria-store';
import type { ClientKpiBenchmarks } from '@/lib/client-health';

const READ = ['client_health', 'admin_clients'] as const;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowUtc(): string {
  const ms = Date.parse(`${todayUtc()}T00:00:00.000Z`) + 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, [...READ]);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');
  const catalog = await loadCriteriaCatalog(ctx.service);
  const { data: clients, error } = await ctx.service
    .from('clients')
    .select('id, name, reporting_type, service_program, qualifies_leads, kpi_benchmarks')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (clients ?? []) as Array<{
    id: string;
    name: string;
    reporting_type: string | null;
    service_program: string | null;
    qualifies_leads: boolean | null;
    kpi_benchmarks: ClientKpiBenchmarks | null;
  }>;

  const selected = clientId ? rows.find(c => c.id === clientId) ?? null : null;
  const criteriaClient: CriteriaClient | null = selected
    ? {
        id: selected.id,
        reportingType: selected.reporting_type,
        serviceProgram: selected.service_program,
        qualifiesLeads: selected.qualifies_leads,
      }
    : null;
  const resolved = criteriaClient
    ? resolveClientCriteria(criteriaClient, todayUtc(), catalog)
    : null;
  const openCustom = catalog.custom.find(v => v.clientId === clientId && v.effectiveEnd == null) ?? null;

  return NextResponse.json({
    today: todayUtc(),
    default_effective_start: tomorrowUtc(),
    stock: catalog.stock,
    stock_history: {
      RM: stockHistory(catalog.stock, 'RM'),
      DSCR: stockHistory(catalog.stock, 'DSCR'),
      CALL_CENTER: stockHistory(catalog.stock, 'CALL_CENTER'),
    },
    clients: rows.map(c => ({
      id: c.id,
      name: c.name,
      reporting_type: c.reporting_type,
      service_program: c.service_program,
      qualifies_leads: c.qualifies_leads,
    })),
    client: selected,
    resolved,
    custom_history: clientId ? customHistory(catalog.custom, clientId) : [],
    ignored_keys: ignoredStoredKeys(selected?.kpi_benchmarks, openCustom?.bands ?? null),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, [...READ]);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const effectiveStart = typeof body.effective_start === 'string' ? body.effective_start : '';
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const today = todayUtc();
  if (!effectiveStart) return NextResponse.json({ error: 'Effective start is required' }, { status: 400 });
  if (effectiveStart < today) {
    return NextResponse.json({ error: 'Effective start cannot be before today' }, { status: 400 });
  }

  const catalog = await loadCriteriaCatalog(ctx.service);

  try {
    if (body.action === 'save_stock') {
      const profileId = body.profile_id as StockVersion['profileId'];
      if (profileId !== 'RM' && profileId !== 'DSCR' && profileId !== 'CALL_CENTER') {
        return NextResponse.json({ error: 'Unknown stock profile' }, { status: 400 });
      }
      const open = catalog.stock.find(v => v.profileId === profileId && v.effectiveEnd == null);
      if (!open) return NextResponse.json({ error: 'No open stock version' }, { status: 409 });
      const revisingUpcoming = open.effectiveStart === effectiveStart && open.effectiveStart > today;
      if (!revisingUpcoming && catalog.stock.some(v => v.profileId === profileId && v.effectiveStart === effectiveStart)) {
        return NextResponse.json({ error: 'That start date is already a version. Pick a later date.' }, { status: 409 });
      }
      if (!revisingUpcoming && effectiveStart <= open.effectiveStart) {
        return NextResponse.json(
          { error: `Pick a date after ${open.effectiveStart} so days already covered keep their standards.` },
          { status: 409 },
        );
      }
      const patch = body.bands ?? {};
      const merged = applyStockEdit(open.bands, patch);
      const settled = settleStockCosts(merged, patch, body.cost_driver);
      if (settled.error) return NextResponse.json({ error: settled.error }, { status: 400 });
      await saveStockVersion(ctx.service, {
        profileId,
        effectiveStart,
        bands: settled.bands,
        placeholders: placeholdersAfterStockEdit(open.placeholders, patch, settled.bands),
        note,
        createdBy: ctx.userId,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'save_custom' || body.action === 'use_stock' || body.action === 'save_checklist') {
      const clientId = typeof body.client_id === 'string' ? body.client_id : '';
      if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
      const { data: client, error } = await ctx.service
        .from('clients')
        .select('id, reporting_type, service_program, qualifies_leads, kpi_benchmarks')
        .eq('id', clientId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      const resolved = resolveClientCriteria(
        {
          id: clientId,
          reportingType: client.reporting_type,
          serviceProgram: client.service_program,
          qualifiesLeads: client.qualifies_leads,
        },
        today,
        catalog,
      );
      const graded = resolved?.gradedKeys ?? [];
      const open = catalog.custom.find(v => v.clientId === clientId && v.effectiveEnd == null);
      const revisingUpcoming = !!open && open.effectiveStart === effectiveStart && open.effectiveStart > today;
      if (!revisingUpcoming && catalog.custom.some(v => v.clientId === clientId && v.effectiveStart === effectiveStart)) {
        return NextResponse.json({ error: 'That start date is already a version. Pick a later date.' }, { status: 409 });
      }
      if (open && !revisingUpcoming && effectiveStart <= open.effectiveStart) {
        return NextResponse.json(
          { error: `Pick a date after ${open.effectiveStart} so days already covered keep their standards.` },
          { status: 409 },
        );
      }
      let bands: Partial<Record<KpiKey, { critical?: number; below?: number; at?: number }>> = {};
      if (body.action === 'use_stock') {
        bands = {};
      } else if (body.action === 'save_checklist') {
        const stored = (client.kpi_benchmarks ?? {}) as ClientKpiBenchmarks;
        const kept = normalizeOverlay({ ...(open?.bands ?? {}), ...stored }, graded) ?? {};
        bands = kept;
      } else {
        const merged = { ...(open?.bands ?? {}), ...(body.bands ?? {}) };
        bands = normalizeOverlay(merged, graded) ?? {};
      }
      if (body.action !== 'use_stock') {
        const stockOpen = catalog.stock.find(v => v.profileId === profileFor(client.reporting_type) && v.effectiveEnd == null);
        const settled = settleCustomCosts(bands, stockOpen?.bands, body.cost_driver, resolved?.pool ?? null);
        if (settled.error) return NextResponse.json({ error: settled.error }, { status: 400 });
        bands = settled.bands;
      }
      await saveCustomVersion(ctx.service, {
        clientId,
        effectiveStart,
        bands,
        note,
        createdBy: ctx.userId,
      });
      return NextResponse.json({ ok: true, profile: profileFor(client.reporting_type) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Save failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

const COST_KEYS = ['cpl', 'cpql', 'cps'] as const;

function asDriver(value: unknown): CostDriver | null {
  return value === 'cpl' || value === 'cpql' || value === 'cps' ? value : null;
}

function rateTriple(bands: { critical?: number; below?: number; at?: number } | undefined, fallback: CostTriple): CostTriple {
  return bands ?? fallback;
}

function settleStockCosts(
  merged: StockVersion['bands'],
  patch: Partial<Record<string, CostTriple>>,
  requested: unknown,
): { bands: StockVersion['bands']; error?: string } {
  const patchKeys = COST_KEYS.filter(key => patch[key] && approvedTriple(patch[key]));
  const requestedDriver = asDriver(requested);
  const driver = (requestedDriver && approvedTriple(merged[requestedDriver]?.bands) ? requestedDriver : null)
    ?? (patchKeys.includes('cpl') ? 'cpl' : patchKeys.includes('cpql') ? 'cpql' : patchKeys.includes('cps') ? 'cps' : pickCostDriver(null, merged));
  if (patchKeys.length > 1) {
    const issue = costIdentityError(
      { cpl: patch.cpl, cpql: patch.cpql, cps: patch.cps },
      {
        qual: rateTriple(merged.lead_to_qualified?.bands, DEFAULT_KPI_BANDS.lead_to_qualified.bands),
        hand: rateTriple(merged.hand_raise_rate?.bands, DEFAULT_KPI_BANDS.hand_raise_rate.bands),
        yieldBands: rateTriple(merged.lead_booking_rate?.bands, DEFAULT_KPI_BANDS.lead_booking_rate.bands),
      },
    );
    if (issue) return { bands: merged, error: issue };
  }
  return { bands: retainCostDriver(merged, driver) };
}

function settleCustomCosts(
  bands: Partial<Record<KpiKey, CostTriple>>,
  stock: StockVersion['bands'] | undefined,
  requested: unknown,
  pool: 'qualified' | 'all' | null,
): { bands: Partial<Record<KpiKey, CostTriple>>; error?: string } {
  const present = COST_KEYS.filter(key => approvedTriple(bands[key]));
  const requestedDriver = asDriver(requested);
  const driver = (requestedDriver && approvedTriple(bands[requestedDriver]) ? requestedDriver : null)
    ?? (present.includes('cpl') ? 'cpl' : present.includes('cpql') ? 'cpql' : present.includes('cps') ? 'cps' : null);
  if (present.length > 1) {
    const qual = bands.lead_to_qualified ?? stock?.lead_to_qualified?.bands ?? DEFAULT_KPI_BANDS.lead_to_qualified.bands;
    const hand = pool === 'all'
      ? (bands.hand_raise_rate ?? stock?.lead_booking_rate?.bands ?? DEFAULT_KPI_BANDS.lead_booking_rate.bands)
      : (bands.hand_raise_rate ?? stock?.hand_raise_rate?.bands ?? DEFAULT_KPI_BANDS.hand_raise_rate.bands);
    const issue = costIdentityError(
      { cpl: bands.cpl, cpql: bands.cpql, cps: bands.cps },
      {
        qual,
        hand,
        yieldBands: stock?.lead_booking_rate?.bands ?? DEFAULT_KPI_BANDS.lead_booking_rate.bands,
      },
    );
    if (issue) return { bands, error: issue };
  }
  return { bands: retainCostDriver(bands, driver) };
}

function approvedTriple(bands: CostTriple | null | undefined): boolean {
  return !!bands && [bands.critical, bands.below, bands.at].every(n => typeof n === 'number' && Number.isFinite(n));
}
