import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import type { KpiKey } from '@/lib/client-health';
import {
  applyStockEdit,
  customHistory,
  ignoredStoredKeys,
  normalizeOverlay,
  profileFor,
  resolveClientCriteria,
  stockHistory,
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
      if (catalog.stock.some(v => v.profileId === profileId && v.effectiveStart === effectiveStart)) {
        return NextResponse.json({ error: 'That start date is already a version. Pick a later date.' }, { status: 409 });
      }
      const bands = applyStockEdit(open.bands, body.bands ?? {});
      await saveStockVersion(ctx.service, {
        profileId,
        effectiveStart,
        bands,
        placeholders: open.placeholders,
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
      if (catalog.custom.some(v => v.clientId === clientId && v.effectiveStart === effectiveStart)) {
        return NextResponse.json({ error: 'That start date is already a version. Pick a later date.' }, { status: 409 });
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
