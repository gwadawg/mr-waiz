"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FOCUS_STYLES,
  KPI_META,
  TIER_LABEL,
  type ClientHealthSnapshot,
  type ClientKpiBenchmarks,
  type ConstraintGuidance,
  type FocusResult,
  type FunnelLayer,
  type HealthTier,
  type KpiKey,
  type RecentLeading,
} from "@/lib/client-health";
import {
  DEPT_LENS_LABEL,
  deptStatusFromSnapshot,
  type DeptLens,
} from "@/lib/dept-health";
import { usesCallCenterKpiLayout } from "@/lib/kpi-layouts";
import { callTypeLabel } from "@/lib/client-calls";
import { noteTypeLabel, reasonLabel } from "@/lib/client-feedback";
import ClientActionLog from "./ClientActionLog";
import ClientTimelineChart from "./ClientTimelineChart";
import ClientAiDiagnosis from "./ClientAiDiagnosis";
import PeriodComparison from "./PeriodComparison";

type MaturityInfo = {
  days: number;
  matured_through: string;
  clamped: boolean;
  empty: boolean;
  leading_window_days?: number;
  leading_start?: string;
  leading_end?: string;
  recent_window_days: number;
  recent_start: string;
  recent_end: string;
};

type Props = {
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string;
  /** Active department lens from the list — role badges when not overview. */
  lens?: DeptLens;
  onBack: () => void;
  onOpenClientFile?: () => void;
};

type CrmNote = { note_type: string; body: string; created_at: string; reason_code?: string | null };
type CrmCall = { call_type: string; called_at: string; notes?: string | null };
type HealthSnapshotRow = {
  id: string;
  period_start: string;
  period_end: string;
  worst_tier: string;
  constraint_label: string | null;
  created_at: string;
};

type DetailResponse = {
  client_id: string;
  client_name: string;
  is_live: boolean;
  reporting_type?: string;
  period: { start: string; end: string };
  prior_period: { start: string; end: string } | null;
  current: ClientHealthSnapshot;
  prior: ClientHealthSnapshot | null;
  recent?: RecentLeading | null;
  recent_prior?: RecentLeading | null;
  focus?: FocusResult;
  maturity?: MaturityInfo | null;
  trend: "improved" | "worsened" | "stable" | "new" | "insufficient";
  guidance: ConstraintGuidance;
  kpi_benchmarks?: ClientKpiBenchmarks | null;
  kpi_benchmarks_updated_at?: string | null;
  kpi_benchmarks_note?: string | null;
};

const TIER_STYLES: Record<HealthTier, { bg: string; text: string; border: string }> = {
  critical: { bg: "rgba(239,68,68,0.18)", text: "#f87171", border: "rgba(239,68,68,0.4)" },
  below: { bg: "rgba(245,158,11,0.15)", text: "#fbbf24", border: "rgba(245,158,11,0.35)" },
  at: { bg: "rgba(52,211,153,0.12)", text: "#34d399", border: "rgba(52,211,153,0.3)" },
  above: { bg: "rgba(59,130,246,0.15)", text: "#60a5fa", border: "rgba(59,130,246,0.35)" },
  insufficient: { bg: "rgba(100,116,139,0.12)", text: "#64748b", border: "rgba(100,116,139,0.25)" },
};

const LAYER_GROUPS: { layer: FunnelLayer; label: string; keys: KpiKey[] }[] = [
  { layer: "L1", label: "L1 — Ads", keys: ["cpl", "cpql"] },
  { layer: "L2", label: "L2 — Landing", keys: ["lead_to_qualified"] },
  { layer: "L3", label: "L3 — Call center", keys: ["hand_raise_rate"] },
  { layer: "L4", label: "L4 — Client / LO", keys: ["show_rate", "close_rate"] },
];

const HE_LAYER_GROUPS: { layer: FunnelLayer; label: string; keys: KpiKey[] }[] = [
  { layer: "L3", label: "L3 — Call center", keys: ["hand_raise_rate"] },
  { layer: "L4", label: "L4 — Client / LO", keys: ["show_rate"] },
];

function TierBadge({ tier }: { tier: HealthTier }) {
  const s = TIER_STYLES[tier];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

const cardStyle = {
  background: "#0a1628",
  border: "1px solid rgba(255,255,255,0.06)",
} as React.CSSProperties;

export default function ClientHealthDetail({
  clientId,
  clientName,
  startDate,
  endDate,
  lens = "overview",
  onBack,
  onOpenClientFile,
}: Props) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logReloadKey, setLogReloadKey] = useState(0);
  const [crmNotes, setCrmNotes] = useState<CrmNote[]>([]);
  const [crmCalls, setCrmCalls] = useState<CrmCall[]>([]);
  const [snapshots, setSnapshots] = useState<HealthSnapshotRow[]>([]);

  const load = useCallback(() => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
    fetch(`/api/client-health/${clientId}?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load client diagnosis.");
        setLoading(false);
      });
  }, [clientId, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/context`)
      .then(r => r.json())
      .then(d => {
        if (d.context) {
          setCrmNotes((d.context.notes ?? []).slice(0, 5) as CrmNote[]);
          setCrmCalls((d.context.calls ?? []).slice(0, 5) as CrmCall[]);
        }
      })
      .catch(() => {});
    fetch(`/api/client-health/${clientId}/snapshots?limit=8`)
      .then(r => r.json())
      .then(d => setSnapshots(d.snapshots ?? []))
      .catch(() => {});
  }, [clientId]);

  return (
    <div className="space-y-6 max-w-[1100px]">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "#94a3b8" }}
      >
        <span aria-hidden>←</span> Back to all clients
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-24" style={{ color: "#334155" }}>
          <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">Loading {clientName}…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-6 text-sm" style={{ ...cardStyle, color: "#f87171" }}>
          {error}
        </div>
      ) : data ? (
        (() => {
          const isHe = usesCallCenterKpiLayout(data.reporting_type);
          const roleStatus =
            lens === "overview"
              ? null
              : deptStatusFromSnapshot(data.current, data.recent ?? null, lens, isHe);
          const mediaLayers = new Set<FunnelLayer>(["L1", "L2"]);
          const ccmLayers = new Set<FunnelLayer>(["L3", "L4"]);
          const baseGroups = isHe ? HE_LAYER_GROUPS : LAYER_GROUPS;
          const layerGroups =
            lens === "media_buyer"
              ? [
                  ...baseGroups.filter(g => mediaLayers.has(g.layer)),
                  ...baseGroups.filter(g => !mediaLayers.has(g.layer)),
                ]
              : lens === "ccm"
                ? [
                    ...baseGroups.filter(g => ccmLayers.has(g.layer)),
                    ...baseGroups.filter(g => !ccmLayers.has(g.layer)),
                  ]
                : baseGroups;
          const m = data.current.metrics;

          return (
        <>
          {/* Header */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>
                  {data.client_name}
                  {isHe && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                      HE
                    </span>
                  )}
                </h2>
                <p className="text-xs mt-1" style={{ color: "#475569" }}>
                  Baseline: {data.period.start} → {data.period.end}
                  {data.prior_period ? ` · vs ${data.prior_period.start} → ${data.prior_period.end}` : ""}
                  {data.maturity?.leading_start && data.maturity?.leading_end ? (
                    <> · Leading: {data.maturity.leading_start} → {data.maturity.leading_end}</>
                  ) : null}
                </p>
                <p className="text-[11px] mt-1" style={{ color: "#38bdf8" }}>
                  Baseline ends ~{data.maturity?.days ?? 3}d before today (matured cohorts). Leading KPIs use the calendar-last {data.maturity?.leading_window_days ?? data.maturity?.recent_window_days ?? 5} days through today.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {onOpenClientFile && (
                  <button
                    type="button"
                    onClick={onOpenClientFile}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ color: "#38bdf8", background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" }}
                  >
                    Open client file
                  </button>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#64748b" }}>
                      Account
                    </span>
                    <TierBadge tier={data.current.worst_tier} />
                  </div>
                  {roleStatus != null && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#64748b" }}>
                        {DEPT_LENS_LABEL[lens]}
                      </span>
                      <TierBadge tier={roleStatus} />
                    </div>
                  )}
                  {lens === "overview" && data.focus && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
                      style={{
                        background: FOCUS_STYLES[data.focus.focus].bg,
                        color: FOCUS_STYLES[data.focus.focus].text,
                        border: `1px solid ${FOCUS_STYLES[data.focus.focus].border}`,
                      }}
                    >
                      {data.focus.label}
                    </span>
                  )}
                </div>
                {roleStatus != null && (
                  <p className="text-[10px] max-w-xs text-right" style={{ color: "#475569" }}>
                    Account = north star (CPConv). {DEPT_LENS_LABEL[lens]} = your lane only — do not treat Account 911 as your scorecard.
                  </p>
                )}
              </div>
            </div>

            {data.recent ? (
              <div className="mt-3 rounded-lg px-3 py-2" style={{ background: "#050c18", border: "1px solid rgba(56,189,248,0.18)" }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#38bdf8" }}>
                  Leading {data.recent.window_days}d · {data.recent.start} → {data.recent.end} (calendar · through today)
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                  <span>{data.recent.leads} leads</span>
                  <span>{data.recent.dials} dials</span>
                  {isHe ? (
                    <span>{data.recent.hand_raise_rate.toFixed(1)}% hand-raise (÷ leads)</span>
                  ) : (
                    <>
                      <span>{data.recent.lead_to_qualified_pct.toFixed(0)}% lead→qual</span>
                      <span>{data.recent.hand_raise_rate.toFixed(0)}% hand-raise</span>
                      <span>
                        CPL {Math.round(data.recent.cpl)} · CPQL {Math.round(data.recent.cpql)}
                      </span>
                      <span>{data.recent.conversations} conversations</span>
                    </>
                  )}
                  <span style={{ color: data.recent.momentum === "improving" ? "#34d399" : data.recent.momentum === "slipping" ? "#f87171" : "#64748b" }}>
                    momentum: {data.recent.momentum}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {(isHe
                ? [
                    { label: "Outbound dials", value: String(m.outbound_dials) },
                    {
                      label: "Hand-raise (unique ÷ leads)",
                      value: `${m.lead_hand_raise_rate.toFixed(1)}%`,
                    },
                    { label: "Show rate", value: `${m.booked_to_conversation_rate.toFixed(0)}%` },
                    {
                      label: "Spoke / unique booked",
                      value: `${m.unique_booked_converted} / ${m.unique_booked_appointments}`,
                    },
                    { label: "True Show", value: `${m.show_pct.toFixed(0)}%` },
                    { label: "Pickup rate", value: `${m.pickup_pct.toFixed(0)}%` },
                    { label: "Leads / hand-raises", value: `${m.new_leads} / ${m.unique_hand_raises}` },
                  ]
                : [
                    { label: "CPConv (cost / conv)", value: money(data.current.cpconv) },
                    { label: "Hand-raise rate", value: `${m.hand_raise_rate.toFixed(0)}%` },
                    {
                      label: "Show rate",
                      value: `${m.booked_to_conversation_rate.toFixed(0)}%`,
                    },
                    {
                      label: "Spoke / unique booked",
                      value: `${m.unique_booked_converted} / ${m.unique_booked_appointments}`,
                    },
                    { label: "True Show", value: `${m.show_pct.toFixed(0)}%` },
                    { label: "CPQL", value: money(data.current.cpql) },
                    { label: "Leads / convs", value: `${m.new_leads} / ${m.unique_conversations}` },
                  ]
              ).map(s => (
                <div key={s.label} className="rounded-lg px-3 py-2" style={{ background: "#050c18" }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#475569" }}>
                    {s.label}
                  </p>
                  <p className="text-lg font-bold mt-0.5 tabular-nums" style={{ color: "#e2e8f0" }}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-2" style={{ color: "#334155" }}>
              Cards above = baseline ({data.period.start} → {data.period.end}), not the leading strip.
            </p>
          </div>

          <PeriodComparison
            current={data.current}
            prior={data.prior}
            recent={data.recent ?? null}
            recentPrior={data.recent_prior ?? null}
            reportingType={data.reporting_type}
            verdictLabel={`${data.period.start} → ${data.period.end}`}
            priorVerdictLabel={
              data.prior_period
                ? `${data.prior_period.start} → ${data.prior_period.end}`
                : "Prior period"
            }
          />

          {/* What's wrong / what to do */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: TIER_STYLES[data.current.worst_tier].text }}
              />
              <h3 className="text-base font-semibold" style={{ color: "#e2e8f0" }}>
                Biggest fallout: {data.guidance.headline}
              </h3>
            </div>
            <p className="text-[10px] mb-2" style={{ color: "#475569" }}>
              Based on baseline {data.period.start} → {data.period.end}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "#94a3b8" }}>
              {data.guidance.whatsWrong}
            </p>

            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>
                What to do
              </p>
              <ol className="space-y-2">
                {data.guidance.fixSteps.map((step, i) => (
                  <li
                    key={i}
                    className="rounded-lg px-3 py-2.5 text-sm"
                    style={{ background: "#050c18", border: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}
                      >
                        {step.owner}
                      </span>
                      {step.timebox && (
                        <span className="text-[10px]" style={{ color: "#64748b" }}>
                          {step.timebox}
                        </span>
                      )}
                    </div>
                    <p style={{ color: "#cbd5e1" }}>{step.action}</p>
                    {step.successMetric && (
                      <p className="text-xs mt-1" style={{ color: "#34d399" }}>
                        Success: {step.successMetric}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {data.guidance.doNotDo.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>
                  Do not
                </p>
                <ul className="space-y-1">
                  {data.guidance.doNotDo.map((d, i) => (
                    <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: "#fb7185" }}>
                      <span aria-hidden>✕</span> {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[10px] mt-4" style={{ color: "#334155" }}>
              {data.guidance.cpconvMath}. {data.guidance.crossCheck}
            </p>
          </div>

          {/* Layer scorecard */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <h3 className="text-base font-semibold mb-1" style={{ color: "#e2e8f0" }}>
              Layer scorecard
              {lens !== "overview" && (
                <span className="ml-2 text-xs font-normal" style={{ color: "#64748b" }}>
                  ({DEPT_LENS_LABEL[lens]} layers first)
                </span>
              )}
            </h3>
            <p className="text-[10px] mb-3" style={{ color: "#475569" }}>
              Graded on baseline {data.period.start} → {data.period.end}
              {data.prior_period
                ? ` · compared vs prior ${data.prior_period.start} → ${data.prior_period.end}`
                : ""}
            </p>
            <div className="space-y-3">
              {layerGroups.map(group => {
                const isPrimary =
                  lens === "overview" ||
                  (lens === "media_buyer" && mediaLayers.has(group.layer)) ||
                  (lens === "ccm" && ccmLayers.has(group.layer));
                return (
                <div key={group.layer} style={{ opacity: isPrimary ? 1 : 0.45 }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#475569" }}>
                    {group.label}
                    {!isPrimary ? " · other lane" : ""}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {group.keys.map(key => {
                      const g = data.current.grades.find(x => x.key === key);
                      if (!g) return null;
                      return (
                        <div
                          key={key}
                          className="rounded-lg px-3 py-2"
                          style={{
                            background: "#050c18",
                            border: isPrimary
                              ? "1px solid rgba(56,189,248,0.22)"
                              : "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "#475569" }}>
                            {KPI_META[key].short}
                          </p>
                          <p className="text-sm font-semibold tabular-nums mb-1" style={{ color: "#e2e8f0" }}>
                            {g.display}
                          </p>
                          <TierBadge tier={g.tier} />
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl px-5 py-4 flex items-center justify-between gap-3" style={cardStyle}>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Custom goals</h3>
              <p className="text-xs mt-1" style={{ color: "#64748b" }}>
                Stock and custom goals are versioned on Criteria. This file does not save a second bar.
              </p>
            </div>
            <Link
              href={`/dashboard?view=client_health&tab=criteria&client=${clientId}`}
              className="text-xs font-semibold px-3 py-2 rounded-lg shrink-0"
              style={{ color: "#38bdf8", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)" }}
            >
              Open Criteria →
            </Link>
          </div>

          {/* CRM context */}
          {(crmNotes.length > 0 || crmCalls.length > 0) && (
            <div className="rounded-xl p-5" style={cardStyle}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-base font-semibold" style={{ color: "#e2e8f0" }}>
                  Account context
                </h3>
                {onOpenClientFile && (
                  <button type="button" onClick={onOpenClientFile} className="text-xs font-semibold" style={{ color: "#38bdf8" }}>
                    View full file →
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>Recent notes</p>
                  {crmNotes.length === 0 ? (
                    <p className="text-xs" style={{ color: "#334155" }}>No notes yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {crmNotes.map((n, i) => (
                        <div key={i} className="rounded-lg px-3 py-2" style={{ background: "#050c18" }}>
                          <p className="text-[10px] uppercase tracking-wide" style={{ color: "#a78bfa" }}>{noteTypeLabel(n.note_type)}</p>
                          <p className="text-xs mt-1 line-clamp-3 whitespace-pre-wrap" style={{ color: "#94a3b8" }}>{n.body}</p>
                          {n.reason_code && <p className="text-[10px] mt-1" style={{ color: "#64748b" }}>{reasonLabel(n.reason_code)}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>Recent calls</p>
                  {crmCalls.length === 0 ? (
                    <p className="text-xs" style={{ color: "#334155" }}>No calls logged.</p>
                  ) : (
                    <div className="space-y-2">
                      {crmCalls.map((c, i) => (
                        <div key={i} className="rounded-lg px-3 py-2" style={{ background: "#050c18" }}>
                          <p className="text-[10px] uppercase tracking-wide" style={{ color: "#f59e0b" }}>{callTypeLabel(c.call_type)}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: "#64748b" }}>{c.called_at.slice(0, 10)}</p>
                          {c.notes && <p className="text-xs mt-1 line-clamp-2" style={{ color: "#94a3b8" }}>{c.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Frozen health snapshots */}
          {snapshots.length > 0 && (
            <div className="rounded-xl p-5" style={cardStyle}>
              <h3 className="text-base font-semibold mb-3" style={{ color: "#e2e8f0" }}>
                Health snapshot history
              </h3>
              <div className="space-y-2">
                {snapshots.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: "#050c18" }}>
                    <div>
                      <p className="text-xs" style={{ color: "#cbd5e1" }}>
                        {s.period_start} → {s.period_end}
                      </p>
                      {s.constraint_label && (
                        <p className="text-[10px] mt-0.5" style={{ color: "#64748b" }}>{s.constraint_label}</p>
                      )}
                    </div>
                    <TierBadge tier={s.worst_tier as HealthTier} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI diagnosis */}
          <ClientAiDiagnosis
            clientId={data.client_id}
            endDate={data.period.end}
            defaultLayer={data.guidance.layer}
            onSavedAction={() => setLogReloadKey(k => k + 1)}
          />

          {/* Timeline & drop-off detection */}
          <ClientTimelineChart clientId={data.client_id} />

          {/* Work log */}
          <ClientActionLog
            clientId={data.client_id}
            snapshot={data.current}
            defaultLayer={data.guidance.layer}
            defaultConstraintLabel={data.current.constraint_label}
            periodStart={data.period.start}
            periodEnd={data.period.end}
            reportingType={data.reporting_type}
            defaultReviewDays={7}
            reloadKey={logReloadKey}
          />
        </>
          );
        })()
      ) : null}
    </div>
  );
}

function money(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}
