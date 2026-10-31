"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetricsResult } from "@/lib/metrics";
import { formatKpiValue } from "@/lib/kpi-layouts";
import {
  applyWaizPreset,
  decodeSimulatorState,
  defaultSimulatorInputs,
  encodeSimulatorState,
  metricsToSimulatorInputs,
  simulateFunnel,
  solveForTargetFunded,
  TIER_COLORS,
  type CostAnchor,
  type FunnelMode,
  type SimulatorInputs,
  type StockBandSource,
  type WaizPreset,
} from "@/lib/kpi-simulator";
import type { HealthTier, KpiGrade } from "@/lib/client-health";

type SimulatorMode = "prospect" | "from_client";

type Props = {
  metrics: MetricsResult | null;
  metricsLoading: boolean;
  clientLabel?: string;
  clientIsRm: boolean;
  dateRangeLabel: string;
  onViewActuals?: () => void;
  initialEncoded?: string | null;
  onStateChange?: (encoded: string) => void;
};

const MUTED = "#475569";
const AMBER = "#f59e0b";
const GOOD = "#22c55e";

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function TierDot({ tier }: { tier: HealthTier }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: TIER_COLORS[tier] }}
      title={tier}
    />
  );
}

function GradeCard({ grade }: { grade: KpiGrade }) {
  const label =
    grade.key === "close_rate"
      ? "Close Rate (÷ conversations)"
      : grade.label;

  return (
    <div
      className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-2"
      style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <TierDot tier={grade.tier} />
        <span className="text-xs truncate" style={{ color: "#94a3b8" }}>{label}</span>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold tabular-nums" style={{ color: "#e2e8f0" }}>{grade.display}</p>
        <p className="text-[10px]" style={{ color: TIER_COLORS[grade.tier] }}>{grade.tierLabel}</p>
      </div>
    </div>
  );
}

type RateField = {
  key: keyof SimulatorInputs;
  label: string;
  hint: string;
  min?: number;
  max?: number;
  step?: number;
};

type GoalTableKey =
  | "ad_spend"
  | "total_leads"
  | "qualified_leads"
  | "conversations"
  | "proposals_made"
  | "submissions_made"
  | "funded_loans";

type GoalTableRow = {
  label: string;
  key: GoalTableKey;
  fmt: "money" | "int" | "decimal";
};

const CORE_RATE_FIELDS: RateField[] = [
  { key: "lead_to_qual_pct", label: "Lead → Qualified", hint: "Qualified ÷ Total Leads", max: 100 },
  { key: "booking_rate_pct", label: "Booking Rate", hint: "Booked ÷ Qualified", max: 80 },
  { key: "net_show_rate_pct", label: "True Show", hint: "Shows ÷ (Shows + No-Shows + LO bailed)", max: 95 },
  { key: "live_transfer_pct", label: "Live Transfer Rate", hint: "Live transfers ÷ Qualified", max: 30 },
  { key: "claimed_pct", label: "Claimed Rate", hint: "Client-claimed ÷ Qualified", max: 20 },
];

const CONVERSATION_CLOSE_FIELD: RateField = {
  key: "conversation_close_rate_pct",
  label: "Close Rate",
  hint: "Funded deals ÷ Conversations — of people the LO actually spoke with",
  max: 80,
};

const PIPELINE_RATE_FIELDS: RateField[] = [
  { key: "proposal_rate_pct", label: "Proposal Rate", hint: "Proposals ÷ Conversations", max: 100 },
  { key: "submission_rate_pct", label: "Submission Rate", hint: "Submissions ÷ Proposals", max: 100 },
  { key: "funded_rate_pct", label: "Funded Rate", hint: "Funded ÷ Submissions", max: 100 },
];

function FunnelBars({
  counts,
  funnelMode,
}: {
  counts: ReturnType<typeof simulateFunnel>["counts"];
  funnelMode: FunnelMode;
}) {
  const stages =
    funnelMode === "conversation"
      ? [
          { label: "Total Leads", value: counts.total_leads },
          { label: "Qualified", value: counts.qualified_leads },
          { label: "Booked", value: counts.booked_appointments },
          { label: "Conversations", value: counts.conversations },
          { label: "Closes", value: counts.funded_loans },
        ]
      : [
          { label: "Total Leads", value: counts.total_leads },
          { label: "Qualified", value: counts.qualified_leads },
          { label: "Booked", value: counts.booked_appointments },
          { label: "Conversations", value: counts.conversations },
          { label: "Proposals", value: counts.proposals_made },
          { label: "Submissions", value: counts.submissions_made },
          { label: "Funded", value: counts.funded_loans },
        ];

  const top = stages[0]?.value ?? 0;

  return (
    <div className="space-y-2">
      {stages.map((stage, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const widthPct = top > 0 ? Math.max((stage.value / top) * 100, stage.value > 0 ? 4 : 0) : 0;
        const stepPct = prev != null && prev > 0 ? (stage.value / prev) * 100 : null;
        const isLast = i === stages.length - 1;
        return (
          <div key={stage.label} className="flex items-center gap-3">
            <span className="text-[11px] w-24 flex-shrink-0 truncate" style={{ color: "#64748b" }}>
              {stage.label}
            </span>
            <div className="flex-1 h-7 rounded-md relative overflow-hidden" style={{ background: "#0a1628" }}>
              <div
                className="h-full rounded-md flex items-center px-2"
                style={{
                  width: `${widthPct}%`,
                  background: isLast
                    ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                    : "linear-gradient(90deg, #1d4ed8, #3b82f6)",
                }}
              >
                <span className="text-xs font-semibold tabular-nums" style={{ color: "#f1f5f9" }}>
                  {stage.value < 10 ? stage.value.toFixed(1) : Math.round(stage.value).toLocaleString()}
                </span>
              </div>
            </div>
            <span className="text-[11px] w-14 flex-shrink-0 text-right tabular-nums" style={{ color: stepPct != null ? "#94a3b8" : "#334155" }}>
              {stepPct != null ? `${stepPct.toFixed(1)}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  prefix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#64748b" }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          min={0}
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          onChange={e => onChange(Number(e.target.value) || 0)}
          className={`w-full py-2 rounded-lg text-sm font-medium outline-none tabular-nums ${prefix ? "pl-7 pr-3" : "px-3"}`}
          style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
        />
      </div>
      {hint && <p className="text-[10px] mt-1" style={{ color: MUTED }}>{hint}</p>}
    </div>
  );
}

function RateSlider({
  field,
  value,
  onChange,
}: {
  field: RateField;
  value: number;
  onChange: (v: number) => void;
}) {
  const max = field.max ?? 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>{field.label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={max}
            step={0.1}
            value={Math.round(value * 10) / 10}
            onChange={e => onChange(Math.min(max, Math.max(0, Number(e.target.value) || 0)))}
            className="w-16 py-0.5 px-1.5 rounded text-xs text-right tabular-nums outline-none"
            style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" }}
          />
          <span className="text-[10px]" style={{ color: MUTED }}>%</span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={field.step ?? 0.5}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-amber-500"
      />
      <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>{field.hint}</p>
    </div>
  );
}

export default function FunnelSimulatorView({
  metrics,
  metricsLoading,
  clientLabel,
  clientIsRm,
  dateRangeLabel,
  onViewActuals,
  initialEncoded,
  onStateChange,
}: Props) {
  const [mode, setMode] = useState<SimulatorMode>("prospect");
  const [preset, setPreset] = useState<WaizPreset | "custom">("at_kpi");
  const [inputs, setInputs] = useState<SimulatorInputs>(() => {
    if (initialEncoded) {
      const decoded = decodeSimulatorState(initialEncoded);
      if (decoded) return decoded;
    }
    return defaultSimulatorInputs();
  });
  const [targetFunded, setTargetFunded] = useState(3);
  const [copied, setCopied] = useState(false);
  const [rmStock, setRmStock] = useState<StockBandSource | undefined>(undefined);
  const stockApplied = useRef(Boolean(initialEncoded));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/kpi-criteria")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const stock = (data.stock ?? []) as Array<{
          profileId?: string;
          effectiveEnd?: string | null;
          bands?: StockBandSource;
        }>;
        const open = stock.find(row => row.profileId === "RM" && row.effectiveEnd == null);
        if (!open?.bands) return;
        setRmStock(open.bands);
        if (!stockApplied.current) {
          stockApplied.current = true;
          setInputs(prev => ({ ...applyWaizPreset("at_kpi", open.bands), funnel_mode: prev.funnel_mode }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((partial: Partial<SimulatorInputs>) => {
    setPreset("custom");
    setInputs(prev => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    if (mode === "from_client" && metrics && clientIsRm) {
      setInputs(metricsToSimulatorInputs(metrics));
      setPreset("custom");
    }
  }, [mode, metrics, clientIsRm]);

  useEffect(() => {
    onStateChange?.(encodeSimulatorState(inputs));
  }, [inputs, onStateChange]);

  const result = useMemo(() => simulateFunnel(inputs), [inputs]);
  const goal = useMemo(
    () => (targetFunded > 0 ? solveForTargetFunded(targetFunded, inputs, result) : null),
    [targetFunded, inputs, result],
  );

  const isConversationMode = inputs.funnel_mode === "conversation";

  const rateFields = useMemo(() => {
    if (isConversationMode) {
      return [...CORE_RATE_FIELDS, CONVERSATION_CLOSE_FIELD];
    }
    return [...CORE_RATE_FIELDS, ...PIPELINE_RATE_FIELDS];
  }, [isConversationMode]);

  const goalTableRows = useMemo((): GoalTableRow[] => {
    const base: GoalTableRow[] = [
      { label: "Ad spend", key: "ad_spend", fmt: "money" },
      { label: "Leads", key: "total_leads", fmt: "int" },
      { label: "Qualified", key: "qualified_leads", fmt: "int" },
      { label: "Conversations", key: "conversations", fmt: "int" },
    ];
    if (!isConversationMode) {
      base.push(
        { label: "Proposals", key: "proposals_made", fmt: "int" },
        { label: "Submissions", key: "submissions_made", fmt: "int" },
      );
    }
    base.push({
      label: isConversationMode ? "Closes" : "Funded",
      key: "funded_loans",
      fmt: "decimal",
    });
    return base;
  }, [isConversationMode]);

  const stageCosts = useMemo(() => {
    const rows = [
      { label: "CPL", value: result.costs.cpl },
      { label: "CPQL", value: result.costs.cpql },
      { label: "CP Appointment", value: result.costs.cp_appt },
    ];
    if (!isConversationMode) {
      rows.push(
        { label: "CP Proposal", value: result.costs.cp_proposal },
        { label: "CP Submission", value: result.costs.cp_submission },
      );
    }
    rows.push({
      label: isConversationMode ? "Cost per Close" : "Cost per Funded",
      value: result.costs.cp_funded,
    });
    return rows;
  }, [isConversationMode, result.costs]);

  const applyPreset = (p: WaizPreset) => {
    setPreset(p);
    stockApplied.current = true;
    setInputs(prev => ({ ...applyWaizPreset(p, rmStock), funnel_mode: prev.funnel_mode }));
    setMode("prospect");
  };

  const reset = () => {
    setPreset("at_kpi");
    stockApplied.current = true;
    setInputs({ ...applyWaizPreset("at_kpi", rmStock), funnel_mode: "conversation" });
    setMode("prospect");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const canLoadClient = clientIsRm && !!metrics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-lg p-0.5"
          style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {(["prospect", "from_client"] as SimulatorMode[]).map(m => (
            <button
              key={m}
              type="button"
              disabled={m === "from_client" && !canLoadClient}
              onClick={() => setMode(m)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40"
              style={
                mode === m
                  ? { background: "rgba(245,158,11,0.2)", color: AMBER }
                  : { color: "#64748b" }
              }
            >
              {m === "prospect" ? "Prospect" : "From client"}
            </button>
          ))}
        </div>

        <select
          value={inputs.funnel_mode}
          onChange={e => patch({ funnel_mode: e.target.value as FunnelMode })}
          className="py-1.5 px-2.5 rounded-lg text-xs font-semibold outline-none cursor-pointer"
          style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.12)", color: "#cbd5e1" }}
        >
          <option value="conversation">Conversation close (simple)</option>
          <option value="pipeline">Full pipeline (proposal → funded)</option>
        </select>

        <div className="flex flex-wrap gap-1.5">
          {(["at_kpi", "below", "above"] as WaizPreset[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
              style={
                preset === p
                  ? { background: "rgba(59,130,246,0.2)", color: "#60a5fa" }
                  : { background: "#0a1628", color: "#64748b", border: "1px solid rgba(255,255,255,0.06)" }
              }
            >
              {p === "at_kpi" ? "At KPI" : p === "below" ? "Below KPI" : "Above KPI"}
            </button>
          ))}
          {preset === "custom" && (
            <span className="px-2.5 py-1 text-[11px] font-medium" style={{ color: MUTED }}>Custom</span>
          )}
        </div>

        <div className="ml-auto flex gap-2">
          <button type="button" onClick={reset} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ color: "#64748b", border: "1px solid rgba(255,255,255,0.08)" }}>
            Reset
          </button>
          <button type="button" onClick={copyLink} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: AMBER, border: "1px solid rgba(245,158,11,0.3)" }}>
            {copied ? "Copied!" : "Copy link"}
          </button>
          {onViewActuals && canLoadClient && (
            <button type="button" onClick={onViewActuals} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
              View actuals →
            </button>
          )}
        </div>
      </div>

      {mode === "from_client" && (
        <div className="rounded-lg px-4 py-3 text-xs" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#93c5fd" }}>
          {metricsLoading ? (
            "Loading client metrics…"
          ) : canLoadClient ? (
            <>Loaded from <strong>{clientLabel}</strong> · {dateRangeLabel} — tweak any assumption below.</>
          ) : (
            "Select a single RM client to load their metrics."
          )}
        </div>
      )}

      {isConversationMode && (
        <p className="text-xs max-w-3xl leading-relaxed" style={{ color: MUTED }}>
          Simple mode: model how many people the LO speaks with and what % close. Close rate is always{" "}
          <strong style={{ color: "#94a3b8" }}>funded deals ÷ conversations</strong> — not proposals or submissions.
          Switch to full pipeline if you need proposal/submission breakdown.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Cost anchor</h3>
            <div className="flex gap-2">
              {(["spend_cpl", "spend_leads"] as CostAnchor[]).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => patch({ cost_anchor: a })}
                  className="flex-1 py-1.5 rounded-md text-[11px] font-semibold"
                  style={
                    inputs.cost_anchor === a
                      ? { background: "rgba(245,158,11,0.15)", color: AMBER }
                      : { background: "#0f2040", color: "#64748b" }
                  }
                >
                  {a === "spend_cpl" ? "Spend + CPL" : "Spend + Leads"}
                </button>
              ))}
            </div>
            <NumberInput label="Monthly ad spend" prefix="$" value={inputs.ad_spend} onChange={v => patch({ ad_spend: v })} />
            {inputs.cost_anchor === "spend_cpl" ? (
              <NumberInput label="Cost per lead (CPL)" prefix="$" value={inputs.cpl} onChange={v => patch({ cpl: v })} hint={`→ ${Math.round(result.counts.total_leads).toLocaleString()} leads`} />
            ) : (
              <NumberInput label="Total leads" value={inputs.total_leads} onChange={v => patch({ total_leads: v })} hint={`→ CPL ${formatKpiValue(result.costs.cpl, "money")}`} />
            )}
            <NumberInput label="Avg commission / close" prefix="$" value={inputs.avg_commission} onChange={v => patch({ avg_commission: v })} hint="Enables revenue & ROAS estimates." />
          </div>

          <div className="rounded-xl p-5 space-y-4 max-h-[520px] overflow-y-auto" style={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-sm font-semibold sticky top-0 pb-2" style={{ color: "#e2e8f0", background: "#0a1424" }}>
              {isConversationMode ? "Waiz funnel + close rate" : "Waiz funnel + LO pipeline"}
            </h3>
            {rateFields.map(f => (
              <RateSlider key={f.key} field={f} value={inputs[f.key] as number} onChange={v => patch({ [f.key]: v })} />
            ))}
          </div>
        </div>

        <div className="xl:col-span-5 space-y-4">
          <div className="rounded-xl p-5" style={{ background: "linear-gradient(135deg, #0f2040 0%, #0c1a30 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "#e2e8f0" }}>Live funnel</h3>
            <p className="text-[10px] mb-4" style={{ color: MUTED }}>
              {isConversationMode
                ? "Lead → conversation → close. Right column = step conversion."
                : "Lead → funded with full LO pipeline. Right column = step conversion."}
            </p>
            <FunnelBars counts={result.counts} funnelMode={inputs.funnel_mode} />
          </div>

          <div className="rounded-xl p-5" style={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "#e2e8f0" }}>What counts as a conversation</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Shows", value: result.counts.shows },
                { label: "Live transfers", value: result.counts.live_transfers },
                { label: "Claimed", value: result.counts.claimed },
              ].map(row => (
                <div key={row.label} className="rounded-lg py-3" style={{ background: "#0f2040" }}>
                  <p className="text-lg font-bold tabular-nums" style={{ color: "#e2e8f0" }}>
                    {row.value < 10 ? row.value.toFixed(1) : Math.round(row.value)}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>{row.label}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-3 leading-relaxed" style={{ color: MUTED }}>
              {Math.round(result.counts.conversations * 10) / 10} conversations at {pct(result.rates.conversation_rate_pct)} of qualified leads.
              {isConversationMode && (
                <> Close rate: {pct(result.rates.close_rate_from_conversations_pct)} → {result.counts.funded_loans.toFixed(1)} closes.</>
              )}
            </p>
          </div>

          <div className="rounded-xl p-5 space-y-4" style={{ background: "linear-gradient(135deg, #0f2040 0%, #0c1a30 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Goal back-solve</h3>
            <p className="text-[10px]" style={{ color: MUTED }}>
              At held rates, what spend and volume do you need to hit your target?
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium whitespace-nowrap" style={{ color: "#94a3b8" }}>
                Target {isConversationMode ? "closes" : "funded"} / month
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={targetFunded}
                onChange={e => setTargetFunded(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 py-1.5 px-2 rounded-lg text-sm font-bold tabular-nums outline-none"
                style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.12)", color: AMBER }}
              />
            </div>

            {goal && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: MUTED }}>
                        <th className="text-left py-1.5 font-medium">Metric</th>
                        <th className="text-right py-1.5 font-medium">Current</th>
                        <th className="text-right py-1.5 font-medium">Required</th>
                        <th className="text-right py-1.5 font-medium">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goalTableRows.map(row => {
                        const cur = row.key === "ad_spend" ? goal.current.ad_spend : goal.current[row.key];
                        const req = row.key === "ad_spend" ? goal.required.ad_spend : goal.required[row.key];
                        const gap = row.key === "ad_spend" ? goal.gaps.ad_spend : goal.gaps[row.key];
                        return (
                          <tr key={row.label} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                            <td className="py-2" style={{ color: "#94a3b8" }}>{row.label}</td>
                            <td className="py-2 text-right tabular-nums" style={{ color: "#64748b" }}>{formatKpiValue(cur, row.fmt)}</td>
                            <td className="py-2 text-right tabular-nums font-semibold" style={{ color: "#e2e8f0" }}>{formatKpiValue(req, row.fmt)}</td>
                            <td className="py-2 text-right tabular-nums font-semibold" style={{ color: gap > 0 ? AMBER : gap < 0 ? GOOD : MUTED }}>
                              {gap > 0 ? "+" : ""}{formatKpiValue(gap, row.fmt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {goal.fastest_lever && (
                  <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <span style={{ color: GOOD }}>Fastest lever: </span>
                    <span style={{ color: "#e2e8f0" }}>
                      Improve <strong>{goal.fastest_lever.label}</strong> to At-KPI →{" "}
                      {goal.fastest_lever.current_funded.toFixed(1)} → {goal.fastest_lever.improved_funded.toFixed(1)}{" "}
                      {isConversationMode ? "closes" : "funded"} (+{goal.fastest_lever.delta.toFixed(1)})
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="xl:col-span-3 space-y-4">
          <div className="rounded-xl p-5 space-y-3" style={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Headline outcomes</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: isConversationMode ? "Closes" : "Funded", value: formatKpiValue(result.counts.funded_loans, "decimal"), accent: true },
                { label: "Conversations", value: formatKpiValue(result.counts.conversations, "decimal") },
                { label: "CPConv", value: formatKpiValue(result.costs.cp_conversation, "money") },
                { label: isConversationMode ? "Cost / Close" : "CP Funded", value: formatKpiValue(result.costs.cp_funded, "money") },
                {
                  label: "ROAS",
                  value: result.roas != null ? `${result.roas.toFixed(2)}×` : "—",
                  accent: result.roas != null && result.roas >= 1,
                },
                {
                  label: "Close rate",
                  value: pct(result.rates.close_rate_from_conversations_pct),
                },
              ].map(card => (
                <div key={card.label} className="rounded-lg p-3" style={{ background: "#0f2040" }}>
                  <p className="text-[10px]" style={{ color: MUTED }}>{card.label}</p>
                  <p className="text-lg font-bold tabular-nums mt-0.5" style={{ color: card.accent ? AMBER : "#e2e8f0" }}>
                    {card.value}
                  </p>
                </div>
              ))}
            </div>
            {result.revenue > 0 && (
              <p className="text-xs" style={{ color: "#94a3b8" }}>
                Est. revenue: <span className="font-semibold" style={{ color: GOOD }}>{formatKpiValue(result.revenue, "money")}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: MUTED }}>KPI tiers</h3>
            {result.grades.map(g => (
              <GradeCard key={g.key} grade={g} />
            ))}
          </div>

          <div className="rounded-xl p-4 text-[11px] leading-relaxed space-y-2" style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)", color: MUTED }}>
            <p className="font-semibold" style={{ color: "#94a3b8" }}>CPConv cross-check</p>
            <p>CPConv = Spend ÷ Conversations = {formatKpiValue(result.costs.cp_conversation, "money")}</p>
            <p>CPQL ÷ CY = {formatKpiValue(result.costs.cpql, "money")} ÷ {result.rates.conversation_yield.toFixed(3)} ={" "}
              {result.cpconv_cross_check != null ? formatKpiValue(result.cpconv_cross_check, "money") : "—"}
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: MUTED }}>Stage costs</h3>
            {stageCosts.map(row => (
              <div key={row.label} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ background: "#0a1628" }}>
                <span style={{ color: "#94a3b8" }}>{row.label}</span>
                <span className="font-semibold tabular-nums" style={{ color: "#e2e8f0" }}>{formatKpiValue(row.value, "money")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
