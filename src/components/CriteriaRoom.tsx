"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_KPI_BANDS, KPI_META, type KpiKey } from "@/lib/client-health";
import { criteriaStartBounds, type HistoryRow } from "@/lib/kpi-criteria";

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
  customEffectiveStart?: string | null;
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

function startBounds(openStart: string | null | undefined, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return { min: "", suggested: "", revisingUpcoming: false };
  }
  return criteriaStartBounds(openStart, today);
}

function startHelp(
  bounds: { suggested: string; revisingUpcoming: boolean },
  start: string,
): string {
  if (bounds.revisingUpcoming && start === bounds.suggested) {
    return `These standards start ${start} and have not been used yet. Saving updates that date in place. You can change them again later.`;
  }
  const when = start || "the date you pick";
  return `This update applies from ${when}. Days before that keep the standards already in force. You can change the numbers again later.`;
}

function edges(spec: StockVersion["bands"][KpiKey] | undefined) {
  return spec?.bands;
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

type EdgeDraft = { critical: string; below: string; at: string };
type EdgePatch = { critical?: number; below?: number; at?: number };

const inputStyle = {
  background: "#07111f",
  color: "#e2e8f0",
  border: "1px solid rgba(255,255,255,0.12)",
};

function draftFromSpec(spec: StockVersion["bands"][KpiKey] | undefined): EdgeDraft {
  const band = edges(spec);
  return {
    critical: band?.critical == null ? "" : String(band.critical),
    below: band?.below == null ? "" : String(band.below),
    at: band?.at == null ? "" : String(band.at),
  };
}

function draftsFor(keys: KpiKey[], bands: StockVersion["bands"] | undefined): Record<string, EdgeDraft> {
  const out: Record<string, EdgeDraft> = {};
  for (const key of keys) out[key] = draftFromSpec(bands?.[key]);
  return out;
}

function patchFromDrafts(
  keys: KpiKey[],
  drafts: Record<string, EdgeDraft>,
  bands: StockVersion["bands"] | undefined,
): { patch: Record<string, EdgePatch>; error?: string } {
  const patch: Record<string, EdgePatch> = {};
  for (const key of keys) {
    const draft = drafts[key] ?? { critical: "", below: "", at: "" };
    const original = draftFromSpec(bands?.[key]);
    const unchanged = (["critical", "below", "at"] as const).every(edge => draft[edge].trim() === original[edge]);
    if (unchanged) continue;
    const filled = (["critical", "below", "at"] as const).filter(edge => draft[edge].trim() !== "");
    if (filled.length < 3) {
      return { patch: {}, error: `${KPI_META[key].short} needs 911, Below, and At together.` };
    }
    const next: EdgePatch = {};
    for (const edge of ["critical", "below", "at"] as const) {
      const value = Number(draft[edge]);
      if (!Number.isFinite(value) || value < 0) {
        return { patch: {}, error: `${KPI_META[key].short} tiers must be numbers.` };
      }
      next[edge] = value;
    }
    patch[key] = next;
  }
  return { patch };
}

function BandFields({
  kpi,
  label,
  spec,
  hint,
  draft,
  onChange,
}: {
  kpi: KpiKey;
  label: string;
  spec: StockVersion["bands"][KpiKey] | undefined;
  hint?: string;
  draft: EdgeDraft;
  onChange: (edge: keyof EdgeDraft, value: string) => void;
}) {
  const unit = spec?.unit ?? DEFAULT_KPI_BANDS[kpi].unit;
  const higher = spec?.higherIsBetter ?? DEFAULT_KPI_BANDS[kpi].higherIsBetter;
  return (
    <fieldset className="rounded-lg px-3 py-2" style={{ background: "#07111f", border: "1px solid rgba(255,255,255,0.04)" }}>
      <legend className="text-[10px] uppercase tracking-wide px-1" style={{ color: "#64748b" }}>{label}</legend>
      <div className="grid grid-cols-3 gap-2 mt-1">
        {(["critical", "below", "at"] as const).map(edge => (
          <label key={edge} className="block text-[10px]" style={{ color: "#94a3b8" }}>
            {edge === "critical" ? "911" : edge === "below" ? "Below" : "At"}
            <input
              aria-label={`${label} ${edge === "critical" ? "911" : edge === "below" ? "Below" : "At"}`}
              inputMode="decimal"
              value={draft[edge]}
              placeholder={unit === "money" ? "$" : "%"}
              onChange={e => onChange(edge, e.target.value)}
              className="mt-1 w-full rounded-md px-2 py-1 text-xs tabular-nums focus:outline focus:outline-1 focus:outline-[#38bdf8]"
              style={inputStyle}
              data-kpi={kpi}
            />
          </label>
        ))}
      </div>
      <p className="text-[11px] mt-1" style={{ color: "#64748b" }}>
        {higher ? "Higher is better" : "Lower is better"}
        {hint ? ` · ${hint}` : ""}
      </p>
    </fieldset>
  );
}

export default function CriteriaRoom() {
  const search = useSearchParams();
  const initialClient = search.get("client");
  const [data, setData] = useState<Payload | null>(null);
  const [clientId, setClientId] = useState<string>(initialClient ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<Profile | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="rounded-xl px-4 py-3 text-xs leading-relaxed" style={{ ...card, border: "1px solid rgba(56,189,248,0.18)", color: "#94a3b8" }}>
        <span style={{ color: "#38bdf8", fontWeight: 600 }}>Criteria.</span>{" "}
        Stock for RM, DSCR, and call center, plus a custom goal for one client. Change the numbers whenever you need to. Each update applies from the date you pick. Days before that keep the standards already in force. History is read-only.
      </div>
      {error && (
        <p className="text-sm" style={{ color: "#f87171" }} role="alert">{error}</p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {PROFILES.map(item => {
          const open = openByProfile.get(item.id);
          const history = data?.stock_history?.[item.id] ?? [];
          return (
            <StockColumn
              key={`${item.id}-${open?.id ?? "empty"}-${open?.effectiveStart ?? ""}`}
              profile={item.id}
              label={item.label}
              open={open}
              history={history}
              showHistory={historyFor === item.id}
              onToggleHistory={() => setHistoryFor(current => (current === item.id ? null : item.id))}
              today={data?.today ?? ""}
              saving={saving}
              onSave={bands => post({
                action: "save_stock",
                profile_id: item.id,
                effective_start: bands.effective_start,
                note: bands.note,
                bands: bands.patch,
              })}
            />
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
            key={`${clientId}-${resolved.stockEffectiveStart}-${resolved.customEffectiveStart ?? "stock"}`}
            resolved={resolved}
            history={data?.custom_history ?? []}
            ignored={data?.ignored_keys ?? []}
            today={data?.today ?? ""}
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

function StockColumn({
  profile,
  label,
  open,
  history,
  showHistory,
  onToggleHistory,
  today,
  saving,
  onSave,
}: {
  profile: Profile;
  label: string;
  open: StockVersion | undefined;
  history: HistoryRow[];
  showHistory: boolean;
  onToggleHistory: () => void;
  today: string;
  saving: boolean;
  onSave: (input: { effective_start: string; note: string; patch: Record<string, EdgePatch> }) => void;
}) {
  const setRules = profile === "CALL_CENTER" ? SET_RULES.filter(key => key !== "lead_to_qualified") : SET_RULES;
  const market = profile === "CALL_CENTER" ? [] : MARKET;
  const keys = [...setRules, ...market];
  const bounds = startBounds(open?.effectiveStart, today);
  const [drafts, setDrafts] = useState(() => draftsFor(keys, open?.bands));
  const [start, setStart] = useState(bounds.suggested);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const costsOpen = ["critical", "below", "at"].every(
    edge => open?.bands.cpl?.bands?.[edge as "critical" | "below" | "at"] == null,
  );

  function setEdge(key: KpiKey, edge: keyof EdgeDraft, value: string) {
    setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] ?? { critical: "", below: "", at: "" }), [edge]: value } }));
  }

  function hintFor(key: KpiKey): string | undefined {
    if (profile === "CALL_CENTER" && key === "hand_raise_rate") return "3 / 5 / 8 · all leads";
    if (key === "lead_to_qualified") return "qualified ÷ leads";
    if (profile === "DSCR" && market.includes(key) && costsOpen) return "Empty until you save real tiers";
    return undefined;
  }

  return (
    <section className="rounded-xl p-4 space-y-3" style={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{label}</h2>
        <button type="button" className="text-[11px] font-semibold" style={{ color: "#38bdf8" }} onClick={onToggleHistory}>
          {showHistory ? "Hide history" : "Show history"}
        </button>
      </div>
      <p className="text-[11px]" style={{ color: "#64748b" }}>Open from {open?.effectiveStart ?? "—"}. {open?.note}</p>
      <form
        className="space-y-3"
        onSubmit={e => {
          e.preventDefault();
          const built = patchFromDrafts(keys, drafts, open?.bands);
          if (built.error) {
            setLocalError(built.error);
            return;
          }
          if (Object.keys(built.patch).length === 0) {
            setLocalError("Change a 911, Below, or At line before saving.");
            return;
          }
          if (!start) {
            setLocalError("Effective start is required.");
            return;
          }
          setLocalError(null);
          onSave({ effective_start: start, note, patch: built.patch });
        }}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>Set rules · change rarely</p>
          {profile === "DSCR" && open?.placeholders?.rates?.source === "shared_rm" && (
            <p className="text-[11px] mb-2" style={{ color: "#fbbf24" }}>
              RM rate lines — DSCR rate stock is unset. Edit a line and save to make it DSCR’s own.
            </p>
          )}
          <div className="space-y-2">
            {setRules.map(key => (
              <BandFields
                key={key}
                kpi={key}
                label={key === "lead_to_qualified" ? "Qual % (opt %)" : KPI_META[key].short}
                spec={open?.bands[key]}
                hint={hintFor(key)}
                draft={drafts[key] ?? { critical: "", below: "", at: "" }}
                onChange={(edge, value) => setEdge(key, edge, value)}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>Market lines · expected to move</p>
          {profile === "CALL_CENTER" ? (
            <p className="text-xs" style={{ color: "#64748b" }}>No CPL, CPQL, or CPConv.</p>
          ) : (
            <div className="space-y-2">
              {profile === "DSCR" && open?.placeholders?.cpl && costsOpen && (
                <p className="text-[11px]" style={{ color: "#fbbf24" }}>
                  Cost tiers are off. The ${open.placeholders.cpl.worst} / ${open.placeholders.cpl.demo} / ${open.placeholders.cpl.best} figures are a placeholder, not 911 / Below / At. Type real tiers below. Saving all three on CPL turns DSCR cost grading on.
                </p>
              )}
              {market.map(key => (
                <BandFields
                  key={key}
                  kpi={key}
                  label={KPI_META[key].short}
                  spec={open?.bands[key]}
                  hint={hintFor(key)}
                  draft={drafts[key] ?? { critical: "", below: "", at: "" }}
                  onChange={(edge, value) => setEdge(key, edge, value)}
                />
              ))}
            </div>
          )}
        </div>
        <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
          Effective start
          <input
            type="date"
            required
            min={bounds.min || undefined}
            value={start}
            onChange={e => setStart(e.target.value)}
            className="mt-1 block rounded-lg px-2 py-1 text-xs focus:outline focus:outline-1 focus:outline-[#38bdf8]"
            style={inputStyle}
          />
        </label>
        <p className="text-[11px]" style={{ color: "#64748b" }}>
          {startHelp(bounds, start)}
        </p>
        <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
          Note
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            className="mt-1 block w-full rounded-lg px-2 py-1 text-xs focus:outline focus:outline-1 focus:outline-[#38bdf8]"
            style={inputStyle}
          />
        </label>
        {localError && <p className="text-xs" style={{ color: "#f87171" }} role="alert">{localError}</p>}
        <button type="submit" disabled={saving} className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50" style={{ background: "#0ea5e9", color: "#041018" }}>
          {saving ? "Saving…" : start === bounds.suggested && bounds.revisingUpcoming ? "Update upcoming standards" : "Update standards"}
        </button>
      </form>
      {showHistory && (
        <div>
          <h3 className="text-xs font-semibold mb-2" style={{ color: "#e2e8f0" }}>History</h3>
          <HistoryList rows={history} />
        </div>
      )}
    </section>
  );
}

function ClientGoals({
  resolved,
  history,
  ignored,
  today,
  saving,
  onUseStock,
  onChecklist,
  onSave,
}: {
  resolved: Resolved;
  history: HistoryRow[];
  ignored: KpiKey[];
  today: string;
  saving: boolean;
  onUseStock: (start: string) => void;
  onChecklist: (start: string) => void;
  onSave: (start: string, note: string, bands: Record<string, EdgePatch>) => void;
}) {
  const bounds = startBounds(resolved.customEffectiveStart, today);
  const [start, setStart] = useState(bounds.suggested);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState(() => draftsFor(resolved.gradedKeys, resolved.bands));
  const [localError, setLocalError] = useState<string | null>(null);
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
            Save these from {start || "the start date"}
          </button>
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={e => {
          e.preventDefault();
          const built = patchFromDrafts(resolved.gradedKeys, drafts, resolved.bands);
          if (built.error) {
            setLocalError(built.error);
            return;
          }
          if (Object.keys(built.patch).length === 0) {
            setLocalError("Change a 911, Below, or At line before saving.");
            return;
          }
          setLocalError(null);
          onSave(start, note, built.patch);
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {resolved.gradedKeys.map(item => (
            <BandFields
              key={item}
              kpi={item}
              label={KPI_META[item].short}
              spec={resolved.bands[item]}
              hint={resolved.customKeys.includes(item) ? "Custom" : "Stock"}
              draft={drafts[item] ?? { critical: "", below: "", at: "" }}
              onChange={(edge, value) => setDrafts(prev => ({
                ...prev,
                [item]: { ...(prev[item] ?? { critical: "", below: "", at: "" }), [edge]: value },
              }))}
            />
          ))}
        </div>
        <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
          Effective start
          <input
            type="date"
            required
            min={bounds.min || undefined}
            value={start}
            onChange={e => setStart(e.target.value)}
            className="mt-1 block rounded-lg px-2 py-1 text-xs focus:outline focus:outline-1 focus:outline-[#38bdf8]"
            style={inputStyle}
          />
        </label>
        <p className="text-[11px]" style={{ color: "#64748b" }}>
          {startHelp(bounds, start)}
        </p>
        <label className="block text-[11px]" style={{ color: "#94a3b8" }}>
          Note
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            className="mt-1 block w-full rounded-lg px-2 py-1 text-xs focus:outline focus:outline-1 focus:outline-[#38bdf8]"
            style={inputStyle}
          />
        </label>
        {localError && <p className="text-xs" style={{ color: "#f87171" }} role="alert">{localError}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50" style={{ background: "#0ea5e9", color: "#041018" }}>
            {saving ? "Saving…" : start === bounds.suggested && bounds.revisingUpcoming ? "Update upcoming goals" : "Update this client"}
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
