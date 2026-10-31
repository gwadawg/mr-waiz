"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KPI_META, type KpiKey } from "@/lib/client-health";
import type { HistoryRow } from "@/lib/kpi-criteria";

type Profile = "RM" | "DSCR" | "CALL_CENTER";

type Band = { critical?: number; below?: number; at?: number; higherIsBetter?: boolean; unit?: string; minDenominator?: number; bands?: Band };

type StockVersion = {
  id: string;
  profileId: Profile;
  effectiveStart: string;
  effectiveEnd: string | null;
  note: string | null;
  bands: Partial<Record<KpiKey, { bands?: Band; higherIsBetter?: boolean; unit?: "pct" | "money"; minDenominator?: number }>>;
  placeholders?: { cpl?: { worst: number; demo: number; best: number }; rates?: { source?: string } } | null;
};

type ClientRow = {
  id: string;
  name: string;
  reporting_type: string | null;
  service_program: string | null;
  qualifies_leads: boolean | null;
};

type Resolved = {
  profile: Profile;
  programUnset: boolean;
  serviceProgram: string | null;
  pool: "qualified" | "all" | null;
  gradedKeys: KpiKey[];
  bands: StockVersion["bands"];
  customKeys: KpiKey[];
  rateLinesShared: boolean;
  costUnapproved: boolean;
  placeholders?: StockVersion["placeholders"];
  stockEffectiveStart: string;
};

type Payload = {
  today: string;
  default_effective_start: string;
  stock: StockVersion[];
  stock_history: Record<Profile, HistoryRow[]>;
  clients: ClientRow[];
  resolved: Resolved | null;
  custom_history: HistoryRow[];
  ignored_keys: KpiKey[];
  error?: string;
};

const PROFILES: { id: Profile; label: string }[] = [
  { id: "RM", label: "RM" },
  { id: "DSCR", label: "DSCR" },
  { id: "CALL_CENTER", label: "Call center" },
];

const SET_RULES: KpiKey[] = ["hand_raise_rate", "show_rate", "lead_to_qualified"];
const MARKET: KpiKey[] = ["cpl", "cpql", "cps"];

const card = {
  background: "#0a1628",
  border: "1px solid rgba(255,255,255,0.06)",
};

function edges(spec: StockVersion["bands"][KpiKey] | undefined) {
  return spec?.bands;
}

function formatEdge(key: KpiKey, value: number | undefined, unit: string | undefined) {
  if (value == null) return "—";
  return unit === "money" ? `$${value}` : `${value}%`;
}

function HistoryList({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs" style={{ color: "#64748b" }}>No closed versions yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map(row => (
        <li key={row.id} className="rounded-lg px-3 py-2" style={{ background: "#07111f" }}>
          <p className="text-xs font-semibold" style={{ color: "#e2e8f0" }}>{row.effectiveLabel}</p>
          <p className="text-[11px] mt-1" style={{ color: "#94a3b8" }}>
            Saved by {row.createdBy ?? "unknown"} · {row.createdAt ? row.createdAt.slice(0, 16).replace("T", " ") : "—"}
            {row.note ? ` · ${row.note}` : ""}
          </p>
          {row.first ? (
            <p className="text-[11px] mt-1" style={{ color: "#64748b" }}>Nothing earlier to compare. This is the full snapshot.</p>
          ) : row.changes.length === 0 ? (
            <p className="text-[11px] mt-1" style={{ color: "#64748b" }}>No band changes versus the previous version.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {row.changes.map(change => (
                <li key={change.key} className="text-[11px]" style={{ color: "#cbd5e1" }}>
                  <span style={{ color: "#38bdf8" }}>{change.layer.replace("_", " ")}</span>{" "}
                  {KPI_META[change.key]?.short ?? change.key}: {change.before} → {change.after}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function BandCell({
  label,
  spec,
  hint,
}: {
  label: string;
  spec: StockVersion["bands"][KpiKey] | undefined;
  hint?: string;
}) {
  const band = edges(spec);
  const unit = spec?.unit;
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "#07111f" }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "#64748b" }}>{label}</p>
      <p className="text-xs mt-1" style={{ color: "#e2e8f0" }}>
        911 {formatEdge(label as KpiKey, band?.critical, unit)} · Below {formatEdge(label as KpiKey, band?.below, unit)} · At {formatEdge(label as KpiKey, band?.at, unit)}
      </p>
      <p className="text-[11px] mt-1" style={{ color: "#64748b" }}>
        Min {spec?.minDenominator ?? "—"}
        {spec?.higherIsBetter === false ? " · lower is better" : " · higher is better"}
        {hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}

export default function CriteriaRoom() {
  const search = useSearchParams();
  const initialClient = search.get("client");
  const [data, setData] = useState<Payload | null>(null);
  const [clientId, setClientId] = useState<string>(initialClient ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile>("RM");

  const load = useCallback(async (id: string) => {
    const params = new URLSearchParams();
    if (id) params.set("client_id", id);
    const res = await fetch(`/api/kpi-criteria?${params}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not load criteria");
      return;
    }
    setData(json);
    setError(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(clientId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clientId, load]);

  const openByProfile = useMemo(() => {
    const map = new Map<Profile, StockVersion>();
    for (const row of data?.stock ?? []) {
      if (row.effectiveEnd == null) map.set(row.profileId, row);
    }
    return map;
  }, [data]);

  async function post(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/kpi-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Save failed");
        return;
      }
      await load(clientId);
    } finally {
      setSaving(false);
    }
  }

  const resolved = data?.resolved ?? null;
  const selected = openByProfile.get(profile);

  return (
    <div className="space-y-6">
      <div className="rounded-xl px-4 py-3 text-xs leading-relaxed" style={{ ...card, border: "1px solid rgba(56,189,248,0.18)", color: "#94a3b8" }}>
        <span style={{ color: "#38bdf8", fontWeight: 600 }}>Criteria.</span>{" "}
        Stock for RM, DSCR, and call center, plus a custom goal for one client. Set rules (hand-raise, show, qual / opt %) change rarely. Market lines (CPL, CPQL, CPConv) are expected to move. A save closes the open version and opens a new one. History is read-only. As judged then is that history.
      </div>
      {error && (
        <p className="text-sm" style={{ color: "#f87171" }} role="alert">{error}</p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {PROFILES.map(item => {
          const open = openByProfile.get(item.id);
          const history = data?.stock_history?.[item.id] ?? [];
          const focused = profile === item.id;
          return (
            <section key={item.id} className="rounded-xl p-4 space-y-3" style={{ ...card, outline: focused ? "1px solid rgba(56,189,248,0.45)" : undefined }}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{item.label}</h2>
                <button type="button" className="text-[11px] font-semibold" style={{ color: "#38bdf8" }} onClick={() => setProfile(item.id)}>
                  {focused ? "History below" : "Show history"}
                </button>
              </div>
              <p className="text-[11px]" style={{ color: "#64748b" }}>Open from {open?.effectiveStart ?? "—"}. {open?.note}</p>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>Set rules · change rarely</p>
                <div className="space-y-2">
                  {(item.id === "CALL_CENTER" ? SET_RULES.filter(key => key !== "lead_to_qualified") : SET_RULES).map(key => (
                    <BandCell
                      key={key}
                      label={key === "lead_to_qualified" ? "Qual % (opt %)" : KPI_META[key].short}
                      spec={open?.bands[key]}
                      hint={item.id === "CALL_CENTER" && key === "hand_raise_rate" ? "3 / 5 / 8 · all leads" : key === "lead_to_qualified" ? "qualified ÷ leads" : undefined}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>Market lines · expected to move</p>
                {item.id === "CALL_CENTER" ? (
                  <p className="text-xs" style={{ color: "#64748b" }}>No CPL, CPQL, or CPConv.</p>
                ) : (
                  <div className="space-y-2">
                    {item.id === "DSCR" && open?.placeholders?.cpl && (
                      <p className="text-[11px]" style={{ color: "#fbbf24" }}>
                        Placeholder — not 911 / Below / At. Worst ${open.placeholders.cpl.worst}, demo ${open.placeholders.cpl.demo}, best ${open.placeholders.cpl.best}.
                        {open.placeholders.rates?.source === "shared_rm" ? " RM rate lines — DSCR rate stock is unset." : ""}
                      </p>
                    )}
                    {MARKET.map(key => (
                      <BandCell key={key} label={KPI_META[key].short} spec={open?.bands[key]} hint={open?.bands[key] ? undefined : "No approved line"} />
                    ))}
                  </div>
                )}
              </div>
              {focused && (
                <StockEditor
                  profile={item.id}
                  open={open}
                  defaultStart={data?.default_effective_start ?? ""}
                  saving={saving}
                  onSave={bands => post({
                    action: "save_stock",
                    profile_id: item.id,
                    effective_start: bands.effective_start,
                    note: bands.note,
                    bands: bands.patch,
                  })}
                />
              )}
              {focused && (
                <div>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: "#e2e8f0" }}>History</h3>
                  <HistoryList rows={history} />
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="rounded-xl p-4 space-y-4" style={card}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs" style={{ color: "#94a3b8" }}>
            This client
            <select
              className="mt-1 block rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "#07111f", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.08)" }}
              value={clientId}
              onChange={e => setClientId(e.target.value)}
            >
              <option value="">Select a client</option>
              {(data?.clients ?? []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        {resolved && (
          <ClientGoals
            resolved={resolved}
            history={data?.custom_history ?? []}
            ignored={data?.ignored_keys ?? []}
            defaultStart={data?.default_effective_start ?? ""}
            saving={saving}
            onUseStock={start => post({ action: "use_stock", client_id: clientId, effective_start: start, note: "Use stock" })}
            onChecklist={start => post({ action: "save_checklist", client_id: clientId, effective_start: start, note: "Forward save of stored goals" })}
            onSave={(start, note, bands) => post({ action: "save_custom", client_id: clientId, effective_start: start, note, bands })}
          />
        )}
      </section>
    </div>
  );
}

function StockEditor({
  profile,
  open,
  defaultStart,
  saving,
  onSave,
}: {
  profile: Profile;
  open: StockVersion | undefined;
  defaultStart: string;
  saving: boolean;
  onSave: (input: { effective_start: string; note: string; patch: Record<string, { critical?: number; below?: number; at?: number }> }) => void;
}) {
  const [start, setStart] = useState(defaultStart);
  const [note, setNote] = useState("");
  const [key, setKey] = useState<KpiKey>(profile === "CALL_CENTER" ? "show_rate" : "cpl");
  const [critical, setCritical] = useState("");
  const [below, setBelow] = useState("");
  const [at, setAt] = useState("");
  const keys = profile === "CALL_CENTER" ? (["hand_raise_rate", "show_rate"] as KpiKey[]) : ([...SET_RULES, ...MARKET] as KpiKey[]);

  return (
    <form
      className="space-y-2"
      onSubmit={e => {
        e.preventDefault();
        const patch: Record<string, { critical?: number; below?: number; at?: number }> = {};
        const next: { critical?: number; below?: number; at?: number } = {};
        if (critical !== "") next.critical = Number(critical);
        if (below !== "") next.below = Number(below);
        if (at !== "") next.at = Number(at);
        patch[key] = next;
        onSave({ effective_start: start, note, patch });
      }}
    >
      <p className="text-[11px]" style={{ color: "#94a3b8" }}>
        Saving closes {open?.effectiveStart ?? "the open version"} on {start || "the new start"}. Previous rows stay read-only.
      </p>
      <div className="flex flex-wrap gap-2">
        <select value={key} onChange={e => setKey(e.target.value as KpiKey)} className="rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }}>
          {keys.map(item => <option key={item} value={item}>{KPI_META[item].short}</option>)}
        </select>
        <input aria-label="911" placeholder="911" value={critical} onChange={e => setCritical(e.target.value)} className="w-16 rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
        <input aria-label="Below" placeholder="Below" value={below} onChange={e => setBelow(e.target.value)} className="w-16 rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
        <input aria-label="At" placeholder="At" value={at} onChange={e => setAt(e.target.value)} className="w-16 rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
      </div>
      <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
        Effective start
        <input type="date" required value={start} onChange={e => setStart(e.target.value)} className="mt-1 block rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
      </label>
      <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
        Note
        <input value={note} onChange={e => setNote(e.target.value)} className="mt-1 block w-full rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
      </label>
      <button type="submit" disabled={saving} className="text-xs font-semibold rounded-lg px-3 py-1.5" style={{ background: "#0ea5e9", color: "#041018" }}>
        {saving ? "Saving…" : "Save new version"}
      </button>
    </form>
  );
}

function ClientGoals({
  resolved,
  history,
  ignored,
  defaultStart,
  saving,
  onUseStock,
  onChecklist,
  onSave,
}: {
  resolved: Resolved;
  history: HistoryRow[];
  ignored: KpiKey[];
  defaultStart: string;
  saving: boolean;
  onUseStock: (start: string) => void;
  onChecklist: (start: string) => void;
  onSave: (start: string, note: string, bands: Record<string, { critical?: number; below?: number; at?: number }>) => void;
}) {
  const [start, setStart] = useState(defaultStart);
  const [note, setNote] = useState("");
  const [key, setKey] = useState<KpiKey | "">(resolved.gradedKeys[0] ?? "");
  const [critical, setCritical] = useState("");
  const [below, setBelow] = useState("");
  const [at, setAt] = useState("");
  const program = resolved.serviceProgram === "lead_gen" ? "Leads Only" : resolved.serviceProgram === "core" ? "Call Center" : "program unset — judged as Call Center service";
  const pool = resolved.pool === "all" ? "all leads" : resolved.pool === "qualified" ? "qualified pool" : "all leads";
  const notJudged = (["lead_to_qualified", "hand_raise_rate", "show_rate", "close_rate", "cpl", "cpql", "cps"] as KpiKey[])
    .filter(item => !resolved.gradedKeys.includes(item));

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "#94a3b8" }}>
        {resolved.profile} · {program} · {pool}
        {resolved.rateLinesShared ? " · RM rate lines — DSCR rate stock is unset." : ""}
        {resolved.costUnapproved ? " · DSCR cost grades stay off until real tiers are saved." : ""}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {resolved.gradedKeys.map(item => (
          <BandCell
            key={item}
            label={KPI_META[item].short}
            spec={resolved.bands[item]}
            hint={resolved.customKeys.includes(item) ? "Custom" : "Stock"}
          />
        ))}
      </div>
      {notJudged.length > 0 && (
        <p className="text-[11px]" style={{ color: "#64748b" }}>
          Not judged: {notJudged.map(item => KPI_META[item].short).join(", ")}. No inputs. Reason: Leads Only, or this account is not qualified-pool, or the profile does not grade the key.
        </p>
      )}
      {ignored.length > 0 && (
        <div className="rounded-lg px-3 py-2" style={{ background: "#07111f" }}>
          <p className="text-xs" style={{ color: "#fbbf24" }}>
            Stored keys the old grader ignored: {ignored.map(item => KPI_META[item]?.short ?? item).join(", ")}. Saving them forward does not rewrite last quarter.
          </p>
          <button type="button" disabled={saving} className="mt-2 text-xs font-semibold" style={{ color: "#38bdf8" }} onClick={() => onChecklist(start)}>
            Save these on a new version from {start}
          </button>
        </div>
      )}
      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault();
          if (!key) return;
          const next: { critical?: number; below?: number; at?: number } = {};
          if (critical !== "") next.critical = Number(critical);
          if (below !== "") next.below = Number(below);
          if (at !== "") next.at = Number(at);
          onSave(start, note, { [key]: next });
        }}
      >
        <div className="flex flex-wrap gap-2">
          <select value={key} onChange={e => setKey(e.target.value as KpiKey)} className="rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }}>
            {resolved.gradedKeys.map(item => <option key={item} value={item}>{KPI_META[item].short}</option>)}
          </select>
          <input aria-label="Custom 911" placeholder="911" value={critical} onChange={e => setCritical(e.target.value)} className="w-16 rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
          <input aria-label="Custom Below" placeholder="Below" value={below} onChange={e => setBelow(e.target.value)} className="w-16 rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
          <input aria-label="Custom At" placeholder="At" value={at} onChange={e => setAt(e.target.value)} className="w-16 rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
        </div>
        <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
          Effective start
          <input type="date" required value={start} onChange={e => setStart(e.target.value)} className="mt-1 block rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
        </label>
        <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
          Note
          <input value={note} onChange={e => setNote(e.target.value)} className="mt-1 block w-full rounded-lg px-2 py-1 text-xs" style={{ background: "#07111f", color: "#e2e8f0" }} />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving || !key} className="text-xs font-semibold rounded-lg px-3 py-1.5" style={{ background: "#0ea5e9", color: "#041018" }}>
            Save custom version
          </button>
          <button type="button" disabled={saving} className="text-xs font-semibold" style={{ color: "#94a3b8" }} onClick={() => onUseStock(start)}>
            Use stock
          </button>
        </div>
      </form>
      <div>
        <h3 className="text-xs font-semibold mb-2" style={{ color: "#e2e8f0" }}>Custom history</h3>
        <HistoryList rows={history} />
      </div>
    </div>
  );
}
