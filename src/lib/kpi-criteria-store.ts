import {
  seedStockVersions,
  type CriteriaCatalog,
  type CustomVersion,
  type StockVersion,
  type VersionPlaceholders,
} from '@/lib/kpi-criteria';
import type { KpiKey } from '@/lib/client-health';

type DbError = { message: string } | null;

// Supabase query builders are thenable and gain filters after select.
type CriteriaDb = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string) => PromiseLike<{ data: unknown; error: DbError }>;
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: DbError }>;
};

function ymd(value: unknown): string {
  return String(value ?? '').slice(0, 10);
}

function mapStock(row: Record<string, unknown>): StockVersion {
  return {
    id: String(row.id),
    profileId: row.profile_id as StockVersion['profileId'],
    effectiveStart: ymd(row.effective_start),
    effectiveEnd: row.effective_end ? ymd(row.effective_end) : null,
    ruler: row.ruler === 'legacy' ? 'legacy' : 'current',
    bands: (row.bands ?? {}) as StockVersion['bands'],
    placeholders: (row.placeholders ?? null) as VersionPlaceholders,
    note: (row.note as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

function mapCustom(row: Record<string, unknown>): CustomVersion {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    effectiveStart: ymd(row.effective_start),
    effectiveEnd: row.effective_end ? ymd(row.effective_end) : null,
    ruler: row.ruler === 'legacy' ? 'legacy' : 'current',
    bands: (row.bands ?? {}) as CustomVersion['bands'],
    note: (row.note as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

export async function loadCriteriaCatalog(service: CriteriaDb): Promise<CriteriaCatalog> {
  const [stockRes, customRes] = await Promise.all([
    service.from('kpi_stock_versions').select('*').order('effective_start'),
    service.from('kpi_client_goal_versions').select('*').order('effective_start'),
  ]);
  const missing = [stockRes.error?.message, customRes.error?.message]
    .filter(Boolean)
    .join(' ');
  if (/kpi_stock_versions|kpi_client_goal_versions|schema cache|does not exist/i.test(missing)) {
    return { stock: seedStockVersions(new Date().toISOString().slice(0, 10)), custom: [] };
  }
  if (stockRes.error) throw new Error(stockRes.error.message);
  if (customRes.error) throw new Error(customRes.error.message);
  const stock = ((stockRes.data ?? []) as Record<string, unknown>[]).map(mapStock);
  const custom = ((customRes.data ?? []) as Record<string, unknown>[]).map(mapCustom);
  if (stock.length === 0) {
    return { stock: seedStockVersions(new Date().toISOString().slice(0, 10)), custom };
  }
  return { stock, custom };
}

export async function saveStockVersion(
  service: CriteriaDb,
  input: {
    profileId: string;
    effectiveStart: string;
    bands: StockVersion['bands'];
    placeholders: VersionPlaceholders;
    note: string | null;
    createdBy: string | null;
  },
): Promise<string> {
  const { data, error } = await service.rpc('save_kpi_stock_version', {
    p_profile_id: input.profileId,
    p_effective_start: input.effectiveStart,
    p_bands: input.bands,
    p_placeholders: input.placeholders,
    p_note: input.note,
    p_created_by: input.createdBy,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function saveCustomVersion(
  service: CriteriaDb,
  input: {
    clientId: string;
    effectiveStart: string;
    bands: Partial<Record<KpiKey, { critical?: number; below?: number; at?: number }>>;
    note: string | null;
    createdBy: string | null;
  },
): Promise<string> {
  const { data, error } = await service.rpc('save_kpi_client_goal_version', {
    p_client_id: input.clientId,
    p_effective_start: input.effectiveStart,
    p_bands: input.bands,
    p_note: input.note,
    p_created_by: input.createdBy,
  });
  if (error) throw new Error(error.message);
  return String(data);
}
