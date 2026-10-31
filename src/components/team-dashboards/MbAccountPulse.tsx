"use client";

import { useMemo, useState } from "react";
import {
  PULSE_FLAG_META,
  needsPulseAttention,
  type MbAccountPulse,
  type MbPulseFlag,
  type MbPulseRow,
} from "@/lib/team-dashboards/media";
import { LEADING_WINDOW_DAYS, type SuccessMetricKey } from "@/lib/client-health";
import type { BetCategoryId } from "@/lib/client-work-log";
import { invalidateCachedJson } from "@/lib/client-fetch-cache";
import WorkLogComposer from "@/components/WorkLogComposer";

const TIER_COLOR: Record<string, string> = {
  critical: "var(--color-ws-negative)",
  below: "var(--color-ws-accent)",
  at: "var(--color-ws-info)",
  above: "var(--color-ws-positive)",
  insufficient: "var(--color-ws-text-dim)",
};

const TONE_COLOR: Record<"red" | "amber" | "muted", { color: string; bg: string }> = {
  red: { color: "var(--color-ws-negative)", bg: "rgba(248,113,113,0.14)" },
  amber: { color: "var(--color-ws-accent)", bg: "var(--color-ws-accent-wash)" },
  muted: { color: "var(--color-ws-text-muted)", bg: "rgba(148,163,184,0.12)" },
};

type Filter = "attention" | "red" | "all" | "paused";

type LogTarget = {
  clientId: string;
  clientName: string;
  reportingType: string;
  defaultLayer: string;
  defaultSuccessMetric: SuccessMetricKey;
  defaultTitle: string;
  defaultBetCategory: BetCategoryId | "";
};

function money(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function signedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  return `${r > 0 ? "+" : ""}${r}%`;
}

function workspaceHref(clientId: string): string {
  const p = new URLSearchParams({ view: "client_workspace", tab: "kpis", client: clientId });
  return `/dashboard?${p.toString()}`;
}

function adPerfHref(clientId: string): string {
  const p = new URLSearchParams({ view: "media_buyer", mb: "command", client: clientId });
  return `/dashboard?${p.toString()}`;
}

function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = Math.floor(ms / 86400000);
  return d <= 0 ? "today" : `${d}d`;
}

/** Map pulse flags → work-log prefill for Log change. */
export function logDefaultsFromFlags(row: MbPulseRow): Omit<LogTarget, "clientId" | "clientName" | "reportingType"> {
  const flags = new Set(row.flags);
  if (flags.has("low_optin")) {
    return {
      defaultLayer: "L2",
      defaultSuccessMetric: "optin_rate",
      defaultTitle: "Landing / opt-in fix",
      defaultBetCategory: "landing_optin",
    };
  }
  if (flags.has("fatigue")) {
    return {
      defaultLayer: "L1",
      defaultSuccessMetric: "cpl",
      defaultTitle: "Creative rotation",
      defaultBetCategory: "new_creatives",
    };
  }
  if (flags.has("no_delivery") || flags.has("under_pacing") || flags.has("over_pacing")) {
    return {
      defaultLayer: "L1",
      defaultSuccessMetric: "cpl",
      defaultTitle: "Delivery / pacing fix",
      defaultBetCategory: "budget_allocation",
    };
  }
  if (flags.has("cpl_spike") || flags.has("no_leads")) {
    return {
      defaultLayer: "L1",
      defaultSuccessMetric: "cpl",
      defaultTitle: "CPL intervention",
      defaultBetCategory: "audience_targeting",
    };
  }
  return {
    defaultLayer: "L1",
    defaultSuccessMetric: "cpl",
    defaultTitle: "",
    defaultBetCategory: "",
  };
}

type Props = {
  pulse: MbAccountPulse | null;
  error?: string;
  fatigueError?: string;
  filter?: Filter;
  onFilterChange?: (f: Filter) => void;
  onLogged?: () => void;
  sectionId?: string;
};

export default function MbAccountPulse({
  pulse,
  error,
  fatigueError,
  filter: controlledFilter,
  onFilterChange,
  onLogged,
  sectionId = "mbc-pulse",
}: Props) {
  const [internalFilter, setInternalFilter] = useState<Filter>("attention");
  const filter = controlledFilter ?? internalFilter;
  const setFilter = (f: Filter) => {
    onFilterChange?.(f);
    if (controlledFilter == null) setInternalFilter(f);
  };
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);

  const rows = useMemo(() => {
    if (!pulse) return [];
    const ads = pulse.rows.filter(r => r.is_ads_client);
    if (filter === "paused") return ads.filter(r => r.ads_paused);
    if (filter === "attention") return ads.filter(needsPulseAttention);
    if (filter === "red") {
      return ads.filter(
        r => !r.ads_paused && (r.mb_tier === "critical" || r.mb_tier === "below"),
      );
    }
    return ads;
  }, [pulse, filter]);

  if (!pulse) {
    return (
      <section
        id={sectionId}
        className="mbc-panel rounded-[var(--radius-card)] border p-5"
        style={{
          borderColor: "var(--color-ws-hairline)",
          background: "var(--color-ws-panel)",
        }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--color-ws-text-muted)" }}
        >
          Account pulse
        </h2>
        <p className="text-xs mt-3" style={{ color: "var(--color-ws-negative)" }}>
          {error ?? "Pulse unavailable."}
        </p>
      </section>
    );
  }

  const t = pulse.totals;
  const pacingTotal = t.budget_daily > 0 ? (t.spend_7d_avg / t.budget_daily) * 100 : null;
  const attentionCount = pulse.rows.filter(r => r.is_ads_client && needsPulseAttention(r)).length;
  const redCount = pulse.rows.filter(
    r => r.is_ads_client && !r.ads_paused && (r.mb_tier === "critical" || r.mb_tier === "below"),
  ).length;

  return (
    <section
      id={sectionId}
      className="mbc-panel rounded-[var(--radius-card)] border p-5"
      style={{
        borderColor: pulse.sync_stale
          ? "color-mix(in srgb, var(--color-ws-negative) 45%, transparent)"
          : "var(--color-ws-hairline)",
        background: "var(--color-ws-panel)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2
          className="text-xs font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--color-ws-text-muted)" }}
        >
          Account pulse
          <span
            className="ml-2 normal-case tracking-normal font-normal"
            style={{ color: "var(--color-ws-text-faint)" }}
          >
            Delivery · pacing · CPL · opt-in
          </span>
        </h2>
        <div className="flex items-center gap-1 text-[11px]">
          {(
            [
              ["attention", `Attention (${attentionCount})`],
              ["red", `Red KPI (${redCount})`],
              ["all", `All (${t.ads_clients})`],
              ["paused", `Paused (${t.paused})`],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="rounded-md px-2 py-1 transition-colors"
              style={{
                color:
                  filter === key
                    ? "var(--color-ws-text-loud)"
                    : "var(--color-ws-text-dim)",
                background:
                  filter === key ? "rgba(148,163,184,0.15)" : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {pulse.sync_stale ? (
        <div
          className="rounded-md border px-3 py-2 mb-4 text-xs"
          style={{
            borderColor: "color-mix(in srgb, var(--color-ws-negative) 40%, transparent)",
            background: "rgba(127,29,29,0.2)",
            color: "#fca5a5",
          }}
        >
          <strong style={{ color: "var(--color-ws-negative)" }}>Meta sync stale.</strong>{" "}
          {pulse.sync_watermark
            ? `Last insight date is ${pulse.sync_watermark} (${pulse.sync_age_days}d old). Check Make before reading spend.`
            : "No Meta insight rows in the last 14 days."}
        </div>
      ) : (
        <div className="text-[11px] mb-4" style={{ color: "var(--color-ws-text-faint)" }}>
          Meta through{" "}
          <span className="font-data" style={{ color: "var(--color-ws-text-muted)" }}>
            {pulse.sync_watermark}
          </span>
          {pulse.sync_age_days != null && pulse.sync_age_days > 0
            ? ` (${pulse.sync_age_days}d ago)`
            : ""}
          {" · "}7d spend {pulse.window.start} → {pulse.window.end}
          {" · "}health leading (leads, CPL, tier) is {LEADING_WINDOW_DAYS}d
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Mini label="Daily budget (active)" value={money(t.budget_daily)} />
        <Mini
          label={`Spent ${pulse.sync_watermark ?? "latest"}`}
          value={money(t.spend_latest)}
          sub={
            pacingTotal != null
              ? `7d avg ${money(t.spend_7d_avg)} · ${pct(pacingTotal)} of budget`
              : `7d avg ${money(t.spend_7d_avg)}`
          }
          accent={
            pacingTotal == null
              ? undefined
              : pacingTotal < 70 || pacingTotal > 130
                ? "var(--color-ws-accent)"
                : undefined
          }
        />
        <Mini
          label="No delivery"
          value={String(t.no_delivery)}
          accent={t.no_delivery > 0 ? "var(--color-ws-negative)" : "var(--color-ws-positive)"}
          sub={t.no_delivery > 0 ? "Budget set, $0 spent" : "All accounts spending"}
        />
        <Mini
          label="CPL spikes (7d vs prior)"
          value={String(t.cpl_spikes)}
          accent={t.cpl_spikes > 0 ? "var(--color-ws-negative)" : "var(--color-ws-positive)"}
        />
      </div>

      {rows.length === 0 ? (
        <p
          className="text-sm py-6"
          style={{
            color: filter === "attention" ? "var(--color-ws-positive)" : "var(--color-ws-text-dim)",
          }}
        >
          {filter === "attention"
            ? "Every live ads account is delivering on pace."
            : filter === "red"
              ? "No red-KPI ads accounts."
              : filter === "paused"
                ? "No accounts paused."
                : "No live ads accounts."}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs" style={{ minWidth: 980 }}>
            <thead className="sticky top-0 z-[1]" style={{ background: "var(--color-ws-panel)" }}>
              <tr
                className="text-[10px] uppercase tracking-wider"
                style={{ color: "var(--color-ws-text-faint)" }}
              >
                <Th align="left">Client</Th>
                <Th align="left">Flags</Th>
                <Th>Budget/d</Th>
                <Th>Spent</Th>
                <Th>7d avg</Th>
                <Th>Pacing</Th>
                <Th>Leads</Th>
                <Th>CPL</Th>
                <Th>vs prior</Th>
                <Th>Opt-in</Th>
                <Th>Top ad %</Th>
                <Th>Tier</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <PulseRow
                  key={r.client_id}
                  row={r}
                  onLog={() => {
                    const d = logDefaultsFromFlags(r);
                    setLogTarget({
                      clientId: r.client_id,
                      clientName: r.client_name,
                      reportingType: r.reporting_type,
                      ...d,
                    });
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(error || fatigueError) && (
        <p className="text-xs mt-3" style={{ color: "var(--color-ws-negative)" }}>
          {error ? `Pulse: ${error}` : null}
          {error && fatigueError ? " · " : null}
          {fatigueError ? `Fatigue: ${fatigueError}` : null}
        </p>
      )}

      {logTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(5,12,24,0.72)" }}
          onClick={() => setLogTarget(null)}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[var(--radius-sheet)] border p-5"
            style={{
              background: "var(--color-ws-panel)",
              borderColor: "var(--color-ws-hairline)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3
                  className="text-sm font-semibold"
                  style={{ color: "var(--color-ws-text-loud)" }}
                >
                  Log change · {logTarget.clientName}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--color-ws-text-dim)" }}>
                  Prefills as a bet so progress shows in Changes in flight.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogTarget(null)}
                className="text-xs"
                style={{ color: "var(--color-ws-text-dim)" }}
              >
                Close
              </button>
            </div>
            <WorkLogComposer
              clientId={logTarget.clientId}
              reportingType={logTarget.reportingType}
              defaultWorkType="bet"
              defaultLayer={logTarget.defaultLayer}
              defaultSuccessMetric={logTarget.defaultSuccessMetric}
              defaultTitle={logTarget.defaultTitle}
              defaultBetCategory={logTarget.defaultBetCategory}
              onCancel={() => setLogTarget(null)}
              onSaved={() => {
                setLogTarget(null);
                invalidateCachedJson("team-command-media");
                onLogged?.();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function PulseRow({ row, onLog }: { row: MbPulseRow; onLog: () => void }) {
  const pacingColor =
    row.pacing_pct == null
      ? "var(--color-ws-text-dim)"
      : row.pacing_pct < 70 || row.pacing_pct > 130
        ? "var(--color-ws-accent)"
        : "var(--color-ws-text)";
  const cplDeltaColor =
    row.cpl_delta_pct == null
      ? "var(--color-ws-text-dim)"
      : row.cpl_delta_pct > 25
        ? "var(--color-ws-negative)"
        : row.cpl_delta_pct < -10
          ? "var(--color-ws-positive)"
          : "var(--color-ws-text-muted)";
  const tierColor = TIER_COLOR[row.mb_tier] ?? TIER_COLOR.insufficient;
  const visibleFlags: MbPulseFlag[] = row.flags.filter(f => f !== "paused");
  const shown = visibleFlags.slice(0, 2);
  const extra = visibleFlags.length - shown.length;

  return (
    <tr
      className="group border-t transition-colors hover:bg-white/[0.02]"
      style={{
        borderColor: "var(--color-ws-hairline-soft)",
        opacity: row.ads_paused ? 0.55 : 1,
      }}
    >
      <td className="py-2.5 px-2">
        <a
          href={workspaceHref(row.client_id)}
          className="font-medium hover:underline"
          style={{ color: "var(--color-ws-text)" }}
        >
          {row.client_name}
        </a>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--color-ws-text-faint)" }}>
          {row.reporting_type}
          {row.ads_paused
            ? ` · paused ${daysAgo(row.ads_paused_at)}${row.ads_paused_note ? ` — ${row.ads_paused_note}` : ""}`
            : row.last_spend_date && row.days_since_spend != null && row.days_since_spend > 1
              ? ` · last spend ${row.last_spend_date}`
              : ""}
        </div>
      </td>
      <td className="py-2.5 px-2">
        <div className="flex flex-wrap gap-1">
          {row.ads_paused && <FlagChip flag="paused" />}
          {shown.map(f => (
            <FlagChip key={f} flag={f} href={f === "fatigue" ? adPerfHref(row.client_id) : undefined} />
          ))}
          {extra > 0 && (
            <span className="text-[10px]" style={{ color: "var(--color-ws-text-faint)" }}>
              +{extra}
            </span>
          )}
          {!row.ads_paused && visibleFlags.length === 0 && (
            <span style={{ color: "var(--color-ws-positive)" }}>OK</span>
          )}
        </div>
      </td>
      <Td>{money(row.budget_daily)}</Td>
      <Td color={row.flags.includes("no_delivery") ? "var(--color-ws-negative)" : undefined}>
        {money(row.spend_latest)}
      </Td>
      <Td>{money(row.spend_7d_avg)}</Td>
      <Td color={pacingColor}>{pct(row.pacing_pct)}</Td>
      <Td color={row.flags.includes("no_leads") ? "var(--color-ws-negative)" : undefined}>
        {row.leads_7d ?? "—"}
        {row.qualified_7d != null && row.leads_7d ? (
          <span style={{ color: "var(--color-ws-text-faint)" }}> / {row.qualified_7d}q</span>
        ) : null}
      </Td>
      <Td>{money(row.cpl_7d)}</Td>
      <Td color={cplDeltaColor}>{signedPct(row.cpl_delta_pct)}</Td>
      <Td color={row.flags.includes("low_optin") ? "var(--color-ws-accent)" : undefined}>
        {pct(row.optin_pct_7d)}
      </Td>
      <Td color={row.flags.includes("fatigue") ? "var(--color-ws-accent)" : undefined}>
        {row.fatigue?.top_ad_share != null ? pct(row.fatigue.top_ad_share) : "—"}
      </Td>
      <td className="py-2.5 px-2 text-right">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: tierColor, background: `${tierColor}18` }}
        >
          {row.mb_tier === "insufficient" ? "n/a" : row.mb_tier}
        </span>
      </td>
      <td className="py-2.5 px-2 text-right whitespace-nowrap">
        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex gap-2">
          <button
            type="button"
            onClick={onLog}
            className="text-[11px] hover:underline"
            style={{ color: "var(--color-ws-info)" }}
          >
            Log change
          </button>
          <a
            href={workspaceHref(row.client_id)}
            className="text-[11px] hover:underline"
            style={{ color: "var(--color-ws-text-dim)" }}
          >
            Open
          </a>
        </span>
      </td>
    </tr>
  );
}

function FlagChip({ flag, href }: { flag: MbPulseFlag; href?: string }) {
  const meta = PULSE_FLAG_META[flag];
  const tone = TONE_COLOR[meta.tone];
  const className =
    "text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap";
  const style = { color: tone.color, background: tone.bg };
  if (href) {
    return (
      <a href={href} className={className} style={style}>
        {meta.label}
      </a>
    );
  }
  return (
    <span className={className} style={style}>
      {meta.label}
    </span>
  );
}

function Th({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`py-2 px-2 font-semibold ${align === "left" ? "text-left" : "text-right"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <td
      className="py-2.5 px-2 text-right font-data tabular-nums"
      style={{ color: color ?? "var(--color-ws-text-secondary, #cbd5e1)" }}
    >
      {children}
    </td>
  );
}

function Mini({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--color-ws-text-dim)" }}
      >
        {label}
      </div>
      <div
        className="text-lg font-semibold font-data tabular-nums mt-0.5"
        style={{ color: accent ?? "var(--color-ws-text-loud)" }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: "var(--color-ws-text-faint)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
