"use client";

/**
 * Client Workspace › Compare tab — the flat all-clients scorecard.
 *
 * One sortable row per active client: health pill, volume counts, cost and
 * rate KPIs with period-over-period deltas, a median footer, and CSV export.
 * Reads the existing /api/client-compare endpoint twice (current + previous
 * window) and leaves the legacy Client Compare chart page untouched.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientCompareRow, CompareOfferFilter } from "@/lib/client-compare";
import {
  COMPARE_V2_COLUMNS,
  COMPARE_V2_DELTA_KEYS,
  COMPARE_V2_GRADED_KEYS,
  COMPARE_V2_PRESET_LABELS,
  compareRowsToCsv,
  defaultV2SortDir,
  deltaFor,
  filterV2Rows,
  medianForColumn,
  nextV2SortState,
  previousRange,
  rangeForV2Preset,
  sortV2Rows,
  tableV2ValueFor,
  type CompareTableV2Key,
  type CompareV2Preset,
  type CompareV2SortDir,
} from "@/lib/client-compare-table";
import type { HealthTier } from "@/lib/client-health";
import { getReportingTypeLabel } from "@/lib/kpi-layouts";
import { cachedJsonFetch, peekCachedJson } from "@/lib/client-fetch-cache";
import { todayYmdInCallCenterTz } from "@/lib/time";
import MetricInfoTip from "@/components/kpi/MetricInfoTip";

const STALE_MS = 45_000;
const CACHE_PREFIX = "client-compare-table";

const CARD = {
  background: "#0a1628",
  border: "1px solid rgba(255,255,255,0.06)",
};

const TIER_FILL: Record<HealthTier, string> = {
  critical: "#f87171",
  below: "#fbbf24",
  at: "#34d399",
  above: "#60a5fa",
  insufficient: "#64748b",
};

const TIER_LABEL: Record<HealthTier, string> = {
  critical: "Critical",
  below: "Below",
  at: "At",
  above: "Above",
  insufficient: "N/A",
};

type ColumnFormat = "money" | "pct" | "int" | "text" | "pill";

const COLUMN_META: Record<
  CompareTableV2Key,
  { title: string; format: ColumnFormat; hint?: string; formula?: string }
> = {
  health: { title: "Health", format: "pill", hint: "North-star grade. Paid ads: CPConv grade. Call Center: worst of hand-raise and show rate.", formula: "client-health benchmarks" },
  name: { title: "Client", format: "text" },
  leads: { title: "Leads", format: "int", hint: "New lead events in the window.", formula: "COUNT(lead)" },
  qualified: { title: "Qual", format: "int", hint: "Qualified lead events (manual GHL tags).", formula: "COUNT(lead WHERE qualified)" },
  booked: { title: "Booked", format: "int", hint: "Appointment booked events, including rebooks.", formula: "COUNT(appointment_booked)" },
  conversations: { title: "Convos", format: "int", hint: "Unique leads with show, claimed, or live transfer.", formula: "Unique show ∪ claimed ∪ LT" },
  spend: { title: "Spend", format: "money", hint: "Meta ad spend in the window. Call Center is —.", formula: "SUM(ad spend)" },
  cpl: { title: "CPL", format: "money", hint: "Cost per lead.", formula: "Ad Spend ÷ Total Leads" },
  cpql: { title: "CPQL", format: "money", hint: "Cost per qualified lead.", formula: "Ad Spend ÷ Qualified Leads" },
  hand_raise: { title: "Hand-raise", format: "pct", hint: "Paid ads: ÷ qualified. Call Center: ÷ total leads.", formula: "Unique booked ∪ claimed ∪ LT ÷ Qualified (or Total Leads for CC)" },
  conversation_rate: { title: "Conv %", format: "pct", hint: "Unique conversations per qualified lead.", formula: "Unique Conversations ÷ Qualified Leads" },
  show_rate: { title: "Show %", format: "pct", hint: "Unique booked leads who spoke to the LO.", formula: "Unique (booked ∩ show∪claimed∪LT) ÷ Unique booked" },
  cpconv: { title: "CPConv", format: "money", hint: "Cost per unique conversation.", formula: "Ad Spend ÷ Unique Conversations" },
  dials: { title: "Dials", format: "int", hint: "Outbound dial events in the window.", formula: "COUNT(dial)" },
};

type Bundle = {
  period: { start: string; end: string };
  clients: ClientCompareRow[];
  error?: string;
};

function formatCell(n: number, format: ColumnFormat): string {
  if (format === "pct") return `${n.toFixed(0)}%`;
  if (format === "int") return n.toLocaleString();
  return `$${Math.round(n).toLocaleString()}`;
}

function gradeForColumn(row: ClientCompareRow, key: CompareTableV2Key): HealthTier | null {
  if (!COMPARE_V2_GRADED_KEYS.has(key)) return null;
  if (key === "cpl") return row.grades.cpl ?? null;
  if (key === "cpql") return row.grades.cpql ?? null;
  if (key === "cpconv") return row.grades.cpconv ?? null;
  if (key === "hand_raise") return row.grades.hand_raise ?? null;
  if (key === "show_rate") return row.grades.show_rate ?? null;
  return null;
}

function workspaceHref(clientId: string, start: string, end: string): string {
  const params = new URLSearchParams();
  params.set("view", "client_workspace");
  params.set("tab", "kpis");
  params.set("client", clientId);
  params.set("range", "custom");
  params.set("from", start);
  params.set("to", end);
  return `/dashboard?${params.toString()}`;
}

async function fetchBundle(start: string, end: string): Promise<Bundle> {
  const key = `${CACHE_PREFIX}:${start}:${end}`;
  const qs = new URLSearchParams({ start, end });
  return cachedJsonFetch<Bundle>(key, `/api/client-compare?${qs.toString()}`, {
    staleTime: STALE_MS,
    preferCache: false,
  });
}

export default function ClientCompareTable() {
  const router = useRouter();
  const today = todayYmdInCallCenterTz();

  const [preset, setPreset] = useState<CompareV2Preset>("last_30");
  const [custom, setCustom] = useState<{ start: string; end: string }>({
    start: today,
    end: today,
  });
  const [offer, setOffer] = useState<CompareOfferFilter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<CompareTableV2Key>("health");
  const [sortDir, setSortDir] = useState<CompareV2SortDir>(defaultV2SortDir("health"));

  const { start, end } = rangeForV2Preset(preset, today, preset === "custom" ? custom : undefined);
  const prev = previousRange(start, end);

  const [bundle, setBundle] = useState<Bundle | null>(() =>
    peekCachedJson<Bundle>(`${CACHE_PREFIX}:${start}:${end}`) ?? null,
  );
  const [prevBundle, setPrevBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(!bundle);
  const [error, setError] = useState<string | null>(null);

  const prevStart = prev?.start ?? null;
  const prevEnd = prev?.end ?? null;

  const load = useCallback(async () => {
    try {
      const current = await fetchBundle(start, end);
      if (current.error) {
        setError(current.error);
        return;
      }
      setBundle(current);
      setError(null);
      // Previous window loads after the main table so it never blocks it.
      if (prevStart && prevEnd) {
        try {
          const before = await fetchBundle(prevStart, prevEnd);
          setPrevBundle(before.error ? null : before);
        } catch {
          setPrevBundle(null);
        }
      } else {
        setPrevBundle(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [start, end, prevStart, prevEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => filterV2Rows(bundle?.clients ?? [], offer, query),
    [bundle, offer, query],
  );
  const sorted = useMemo(() => sortV2Rows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  const prevById = useMemo(() => {
    const map = new Map<string, ClientCompareRow>();
    for (const r of prevBundle?.clients ?? []) map.set(r.id, r);
    return map;
  }, [prevBundle]);

  function onSort(clicked: CompareTableV2Key) {
    const next = nextV2SortState(sortKey, sortDir, clicked);
    setSortKey(next.key);
    setSortDir(next.dir);
  }

  function exportCsv() {
    const csv = compareRowsToCsv(sorted);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `client-compare-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !bundle) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-xl" style={{ background: "rgba(148,163,184,0.1)" }} />
        <div className="h-96 animate-pulse rounded-xl" style={{ background: "rgba(148,163,184,0.1)" }} />
      </div>
    );
  }

  const presets: CompareV2Preset[] = [
    "last_7",
    "last_30",
    "last_60",
    "last_90",
    "this_month",
    "last_month",
    "custom",
  ];
  const offers: { id: CompareOfferFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "RM", label: "Reverse" },
    { id: "DSCR", label: "DSCR" },
    { id: "CALL_CENTER", label: "Call Center" },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-xl px-4 py-3 space-y-3" style={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          {presets.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className="rounded-md px-2.5 py-1 text-xs font-semibold"
              style={{
                color: preset === p ? "#e2e8f0" : "#64748b",
                background: preset === p ? "rgba(56,189,248,0.16)" : "transparent",
                border: `1px solid ${preset === p ? "rgba(56,189,248,0.35)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              {COMPARE_V2_PRESET_LABELS[p]}
            </button>
          ))}
          {preset === "custom" && (
            <span className="flex items-center gap-1 text-xs" style={{ color: "#94a3b8" }}>
              <input
                type="date"
                value={start}
                max={today}
                onChange={e => setCustom({ start: e.target.value, end })}
                className="rounded-md px-1.5 py-1 bg-transparent"
                style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" }}
              />
              <span>–</span>
              <input
                type="date"
                value={end}
                max={today}
                onChange={e => setCustom({ start, end: e.target.value })}
                className="rounded-md px-1.5 py-1 bg-transparent"
                style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" }}
              />
            </span>
          )}
          <span className="text-[11px] tabular-nums ml-1" style={{ color: "#475569" }}>
            {start} – {end}
            {prev ? ` · vs ${prev.start} – ${prev.end}` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {offers.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOffer(o.id)}
              className="rounded-md px-2.5 py-1 text-xs font-semibold"
              style={{
                color: offer === o.id ? "#e2e8f0" : "#64748b",
                background: offer === o.id ? "rgba(251,191,36,0.12)" : "transparent",
                border: `1px solid ${offer === o.id ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              {o.label}
            </button>
          ))}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search client…"
            className="rounded-md px-2.5 py-1 text-xs bg-transparent w-44"
            style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" }}
          />
          <span className="text-[11px] tabular-nums" style={{ color: "#64748b" }}>
            {sorted.length} clients
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={sorted.length === 0}
            className="ml-auto rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
            style={{
              color: "#94a3b8",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            Export CSV
          </button>
        </div>
      </section>

      {error && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ ...CARD, color: "#f87171" }}
        >
          <span>{error}</span>
          <button
            type="button"
            className="text-xs underline"
            style={{ color: "#94a3b8" }}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}

      <section className="rounded-xl overflow-hidden" style={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
              All clients
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: "#64748b" }}>
              Click a column to rank. Click a client name to open their workspace.
              Deltas compare against the previous {prev ? "window of the same length" : "window"}.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-[10px]" style={{ color: "#64748b" }}>
            {(Object.keys(TIER_FILL) as HealthTier[]).map(t => (
              <span key={t} className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: TIER_FILL[t] }} />
                {TIER_LABEL[t]}
              </span>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <p className="text-xs px-4 py-12 text-center" style={{ color: "#64748b" }}>
            No clients match this filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  {COMPARE_V2_COLUMNS.map(key => {
                    const meta = COLUMN_META[key];
                    const active = sortKey === key;
                    const alignLeft = key === "name" || key === "health";
                    return (
                      <th
                        key={key}
                        className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                        style={{
                          color: active ? "#e2e8f0" : "#475569",
                          textAlign: alignLeft ? "left" : "right",
                          position: "sticky",
                          top: 0,
                          left: key === "name" ? 0 : undefined,
                          zIndex: key === "name" ? 4 : 3,
                          background: "#0a1628",
                          borderBottom: "1px solid rgba(255,255,255,0.08)",
                          boxShadow: key === "name" ? "4px 0 8px rgba(0,0,0,0.25)" : undefined,
                        }}
                      >
                        <div
                          className="inline-flex items-center gap-1"
                          style={{ justifyContent: alignLeft ? "flex-start" : "flex-end", width: "100%" }}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(key)}
                            className="inline-flex items-center gap-1"
                            style={{ color: "inherit" }}
                          >
                            {meta.title}
                            <span
                              className="inline-block w-2 text-[9px]"
                              style={{ color: active ? "#38bdf8" : "#334155" }}
                            >
                              {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </button>
                          {meta.hint && meta.formula ? (
                            <MetricInfoTip
                              hint={{ definition: meta.hint, source: "Events + Meta spend", formula: meta.formula }}
                            />
                          ) : null}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => (
                  <CompareRow
                    key={row.id}
                    row={row}
                    prev={prevById.get(row.id) ?? null}
                    onOpen={() => router.push(workspaceHref(row.id, start, end))}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  {COMPARE_V2_COLUMNS.map(key => {
                    const median = medianForColumn(sorted, key);
                    const meta = COLUMN_META[key];
                    return (
                      <td
                        key={key}
                        className="px-3 py-2 whitespace-nowrap tabular-nums text-xs"
                        style={{
                          textAlign: key === "name" || key === "health" ? "left" : "right",
                          color: "#94a3b8",
                          background: "#0d1b33",
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                          position: key === "name" ? "sticky" : undefined,
                          left: key === "name" ? 0 : undefined,
                          zIndex: key === "name" ? 1 : undefined,
                          fontWeight: 600,
                        }}
                      >
                        {key === "name"
                          ? "Median"
                          : median == null
                            ? ""
                            : formatCell(median, meta.format)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function CompareRow({
  row,
  prev,
  onOpen,
}: {
  row: ClientCompareRow;
  prev: ClientCompareRow | null;
  onOpen: () => void;
}) {
  return (
    <tr>
      {COMPARE_V2_COLUMNS.map(key => {
        const meta = COLUMN_META[key];
        const isName = key === "name";
        const isHealth = key === "health";
        const grade = gradeForColumn(row, key);
        const raw = tableV2ValueFor(row, key);
        const delta = COMPARE_V2_DELTA_KEYS.has(key) && prev
          ? deltaFor(
              key,
              typeof raw === "number" ? raw : null,
              typeof tableV2ValueFor(prev, key) === "number"
                ? (tableV2ValueFor(prev, key) as number)
                : null,
            )
          : null;

        return (
          <td
            key={key}
            className="px-3 py-2 whitespace-nowrap tabular-nums"
            style={{
              textAlign: isName || isHealth ? "left" : "right",
              color: grade ? TIER_FILL[grade] : isName ? "#e2e8f0" : "#cbd5e1",
              background: "#0a1628",
              position: isName ? "sticky" : undefined,
              left: isName ? 0 : undefined,
              zIndex: isName ? 1 : undefined,
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              boxShadow: isName ? "4px 0 8px rgba(0,0,0,0.25)" : undefined,
              fontWeight: isName ? 500 : 400,
            }}
          >
            {isHealth ? (
              <span
                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  color: TIER_FILL[row.north_star_grade],
                  background: `${TIER_FILL[row.north_star_grade]}1f`,
                  border: `1px solid ${TIER_FILL[row.north_star_grade]}55`,
                }}
              >
                {TIER_LABEL[row.north_star_grade]}
              </span>
            ) : isName ? (
              <button
                type="button"
                onClick={onOpen}
                className="flex items-center gap-2 hover:underline"
                style={{ color: "#e2e8f0" }}
                title="Open client workspace"
              >
                <span>{row.name}</span>
                <span className="text-[10px] font-normal no-underline" style={{ color: "#64748b" }}>
                  {getReportingTypeLabel(row.reporting_type)}
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {typeof raw === "number" ? formatCell(raw, meta.format) : "—"}
                {delta && (
                  <span
                    className="text-[10px]"
                    style={{
                      color:
                        delta.direction === "better"
                          ? "#34d399"
                          : delta.direction === "worse"
                            ? "#f87171"
                            : "#64748b",
                    }}
                    title="vs previous window"
                  >
                    {delta.pct > 0 ? "▲" : delta.pct < 0 ? "▼" : "•"}
                    {Math.abs(delta.pct).toFixed(0)}%
                  </span>
                )}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
