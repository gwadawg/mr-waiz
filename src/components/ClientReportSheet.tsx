"use client";

import type { ReactNode } from "react";
import type {
  ClientReportItemized,
  ClientReportLeadRow,
  ClientReportWorkBundle,
  ClientReportWorkRow,
} from "@/lib/client-report-itemized";
import type { MetricsResult, KpiTimelineBucket, CostTrendPoint } from "@/lib/metrics";
import type { DialPool } from "@/lib/dial-pool";
import {
  formatKpiValue,
  type KpiSectionDefinition,
  type ReportingType,
} from "@/lib/kpi-layouts";
import type { ClientReportChartFlags } from "@/lib/client-report-defaults";
import { WAIZ } from "@/lib/waiz-brand";
import RateTrendCharts from "@/components/RateTrendCharts";
import CostTrendCharts from "@/components/CostTrendCharts";

/** Faces live in src/styles/fonts.css — never call next/font here. */
const barlow = { className: "font-report-display" };
const plex = { className: "font-report-body" };

type Props = {
  clientName: string;
  title: string;
  rangeLabel: string;
  generatedAt?: string;
  metrics: MetricsResult;
  sections: KpiSectionDefinition[];
  charts: ClientReportChartFlags;
  reportingType: ReportingType;
  dialPool?: DialPool | null;
  showCostCharts: boolean;
  kpiSeries?: KpiTimelineBucket[];
  costSeries?: CostTrendPoint[];
  trendsGranularity?: "day" | "week";
  hasDateRange: boolean;
  trendsLoading?: boolean;
  trendsError?: string;
  itemized?: ClientReportItemized | null;
  itemizedLoading?: boolean;
  itemizedError?: string;
};

const STATUS_LABEL: Record<string, string> = {
  show: "Showed",
  no_show: "No showed",
  lo_bailed: "LO bailed",
  live_transfer: "Live transfer",
  appointment_cancelled: "Cancelled",
  appointment_rescheduled: "Rescheduled",
  pending: "Pending",
  claimed: "Claimed",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCardValue(
  card: KpiSectionDefinition["cards"][number],
  metrics: MetricsResult,
): string {
  const primary = formatKpiValue(metrics[card.metric], card.format);
  if (!card.secondaryMetric) return primary;
  const secondary = formatKpiValue(metrics[card.secondaryMetric], card.format);
  return `${primary} / ${secondary}`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase mb-2"
      style={{ color: WAIZ.accent, letterSpacing: "0.18em" }}
    >
      {children}
    </p>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { color: string; bg: string }> = {
    show: { color: WAIZ.navy, bg: "rgba(124,255,122,0.28)" },
    no_show: { color: "#9B1C1C", bg: "#FEE2E2" },
    lo_bailed: { color: WAIZ.navy, bg: "rgba(245,200,66,0.25)" },
    live_transfer: { color: WAIZ.navy, bg: "rgba(79,163,255,0.22)" },
    appointment_cancelled: { color: WAIZ.mid, bg: WAIZ.light },
    appointment_rescheduled: { color: WAIZ.royal, bg: "rgba(79,163,255,0.12)" },
    pending: { color: WAIZ.navy, bg: "rgba(245,200,66,0.2)" },
    claimed: { color: WAIZ.royal, bg: "rgba(14,47,115,0.1)" },
  };
  const s = colors[status] ?? { color: WAIZ.mid, bg: WAIZ.light };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-semibold"
      style={{ color: s.color, background: s.bg }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function WorkTable({
  title,
  rows,
  empty,
  showStatus = false,
}: {
  title: string;
  rows: ClientReportWorkRow[];
  empty: string;
  showStatus?: boolean;
}) {
  return (
    <section className="client-report-block space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className={`${barlow.className} text-base font-bold uppercase tracking-wide`}
          style={{ color: WAIZ.navy }}
        >
          {title}
        </h3>
        <span className="text-xs font-semibold tabular-nums" style={{ color: WAIZ.mid }}>
          {rows.length}
        </span>
      </div>
      <div className="overflow-hidden" style={{ border: `1px solid ${WAIZ.divider}` }}>
        <table className="w-full text-sm client-report-table">
          <thead>
            <tr style={{ background: WAIZ.navy }}>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: WAIZ.white }}>
                Date
              </th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: WAIZ.white }}>
                Lead
              </th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: WAIZ.white }}>
                Phone
              </th>
              {showStatus && (
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: WAIZ.white }}>
                  Status
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showStatus ? 4 : 3}
                  className="px-3 py-6 text-center text-xs"
                  style={{ color: WAIZ.mid, background: WAIZ.white }}
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row.id}
                  style={{
                    background: i % 2 === 0 ? WAIZ.white : WAIZ.light,
                    borderTop: `1px solid ${WAIZ.divider}`,
                  }}
                >
                  <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap" style={{ color: WAIZ.mid }}>
                    {formatDateTime(row.date)}
                  </td>
                  <td className="px-3 py-2 font-medium" style={{ color: WAIZ.navy }}>
                    {row.lead_name || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: WAIZ.mid }}>
                    {row.lead_phone || "—"}
                  </td>
                  {showStatus && (
                    <td className="px-3 py-2">
                      <StatusPill status={row.status} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeadsTable({ rows }: { rows: ClientReportLeadRow[] }) {
  return (
    <section className="client-report-block space-y-2 mt-8">
      <SectionLabel>Lead roster</SectionLabel>
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className={`${barlow.className} text-xl font-bold uppercase tracking-wide`}
          style={{ color: WAIZ.navy }}
        >
          All leads
        </h2>
        <span className="text-xs font-semibold tabular-nums" style={{ color: WAIZ.mid }}>
          {rows.length}
        </span>
      </div>
      <p className="text-[12px] mb-2" style={{ color: WAIZ.mid }}>
        Every new lead recorded in this period, with date received.
      </p>
      <div className="overflow-hidden" style={{ border: `1px solid ${WAIZ.divider}` }}>
        <table className="w-full text-sm client-report-table">
          <thead>
            <tr style={{ background: WAIZ.navy }}>
              {["Date", "Lead", "Phone", "Source", "Flags"].map(h => (
                <th
                  key={h}
                  className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: WAIZ.white }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs" style={{ color: WAIZ.mid, background: WAIZ.white }}>
                  No leads in this range.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row.id}
                  style={{
                    background: i % 2 === 0 ? WAIZ.white : WAIZ.light,
                    borderTop: `1px solid ${WAIZ.divider}`,
                  }}
                >
                  <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap" style={{ color: WAIZ.mid }}>
                    {formatDateTime(row.date)}
                  </td>
                  <td className="px-3 py-2 font-medium" style={{ color: WAIZ.navy }}>
                    {row.lead_name || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: WAIZ.mid }}>
                    {row.lead_phone || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: WAIZ.mid }}>
                    {row.lead_source || "—"}
                  </td>
                  <td className="px-3 py-2 text-[10px] font-medium" style={{ color: WAIZ.royal }}>
                    {[row.is_qualified ? "Qualified" : null, row.is_hot ? "Hot" : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ItemizedWorkSection({ work }: { work: ClientReportWorkBundle }) {
  const { summary } = work;
  return (
    <section className="client-report-block mt-8 space-y-6">
      <div>
        <SectionLabel>Detail</SectionLabel>
        <h2
          className={`${barlow.className} text-xl font-bold uppercase tracking-wide`}
          style={{ color: WAIZ.navy }}
        >
          Itemized appointments & outcomes
        </h2>
        <p className="text-[12px] mt-1" style={{ color: WAIZ.mid }}>
          Booked leads with status, plus shows, no-shows, LO bails, live transfers, and claimed — with dates.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { label: "Booked", value: `${summary.unique_booked} / ${summary.booked}`, sub: "unique / total" },
          { label: "Showed", value: String(summary.shows) },
          { label: "No showed", value: String(summary.no_shows) },
          { label: "LO bailed", value: String(summary.lo_bailed) },
          { label: "Live transfers", value: String(summary.live_transfers) },
          { label: "Claimed", value: String(summary.claimed) },
        ].map(card => (
          <div
            key={card.label}
            className="px-3 py-3"
            style={{
              background: WAIZ.navy,
              borderRadius: 4,
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: WAIZ.accent }}>
              {card.label}
            </p>
            <p
              className={`${barlow.className} text-xl font-extrabold tabular-nums mt-0.5`}
              style={{ color: WAIZ.white }}
            >
              {card.value}
            </p>
            {card.sub && (
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                {card.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <WorkTable
          title="Booked appointments"
          rows={work.booked}
          empty="No appointments booked in this range."
          showStatus
        />
        <WorkTable title="Showed" rows={work.shows} empty="No shows in this range." />
        <WorkTable title="No showed" rows={work.no_shows} empty="No lead no-shows in this range." />
        <WorkTable title="LO bailed" rows={work.lo_bailed} empty="No LO bails in this range." />
        <WorkTable
          title="Live transfers"
          rows={work.live_transfers}
          empty="No live transfers in this range."
        />
        <WorkTable title="Claimed" rows={work.claimed} empty="No claimed leads in this range." />
      </div>
    </section>
  );
}

function LightShowQuality({ metrics }: { metrics: MetricsResult }) {
  const segments = [
    { key: "shows", label: "Showed", value: metrics.shows, color: WAIZ.green },
    { key: "no_shows", label: "No-showed", value: metrics.no_shows, color: "#EF4444" },
    { key: "lo_bailed", label: "LO bailed", value: metrics.lo_bailed, color: WAIZ.gold },
    { key: "cancelled", label: "Cancelled", value: metrics.appointment_cancelled, color: WAIZ.mid },
    { key: "rescheduled", label: "Rescheduled", value: metrics.appointment_rescheduled, color: WAIZ.accent },
    { key: "pending", label: "Pending", value: metrics.appts_to_take_place, color: WAIZ.royal },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div
      className="client-report-block p-5"
      style={{
        background: WAIZ.white,
        border: `1px solid ${WAIZ.divider}`,
        borderLeft: `3px solid ${WAIZ.navy}`,
      }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className={`${barlow.className} text-base font-bold uppercase tracking-wide`} style={{ color: WAIZ.navy }}>
          Appointment outcomes
        </h3>
        <span className="text-xs tabular-nums font-medium" style={{ color: WAIZ.mid }}>{total} booked</span>
      </div>
      <p className="text-[12px] mb-4" style={{ color: WAIZ.mid }}>
        Where every booked appointment ended up. True Show uses Showed ÷ (Showed + No-showed + LO bailed).
      </p>
      {total === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: WAIZ.mid }}>No appointments in this range.</p>
      ) : (
        <>
          <div className="flex w-full h-3 overflow-hidden" style={{ background: WAIZ.light, borderRadius: 2 }}>
            {segments.map(s =>
              s.value > 0 ? (
                <div
                  key={s.key}
                  style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                  title={`${s.label}: ${s.value}`}
                />
              ) : null,
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            {segments.map(s => (
              <div key={s.key} className="flex items-start gap-2">
                <span className="mt-1 w-2.5 h-2.5 flex-shrink-0" style={{ background: s.color, borderRadius: 1 }} />
                <div className="min-w-0">
                  <p className="text-[11px] truncate" style={{ color: WAIZ.mid }}>{s.label}</p>
                  <p className="text-sm font-semibold tabular-nums" style={{ color: WAIZ.navy }}>
                    {s.value}
                    <span className="text-[10px] font-normal ml-1" style={{ color: WAIZ.mid }}>
                      {((s.value / total) * 100).toFixed(0)}%
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LightFunnel({ metrics }: { metrics: MetricsResult }) {
  const stages = [
    { label: "Total Leads", value: metrics.new_leads },
    { label: "Qualified", value: metrics.qualified_leads },
    { label: "Booked", value: metrics.booked_appointments },
    { label: "Shows", value: metrics.shows },
    { label: "Proposals", value: metrics.proposals_made },
    { label: "Submissions", value: metrics.submissions_made },
    { label: "Funded", value: metrics.funded_loans },
  ];
  const top = stages[0]?.value ?? 0;

  function stepPct(part: number, whole: number): string {
    if (whole <= 0) return "—";
    return `${((part / whole) * 100).toFixed(1)}%`;
  }

  return (
    <div
      className="client-report-block p-5"
      style={{
        background: WAIZ.white,
        border: `1px solid ${WAIZ.divider}`,
        borderLeft: `3px solid ${WAIZ.navy}`,
      }}
    >
      <h3 className={`${barlow.className} text-base font-bold uppercase tracking-wide mb-1`} style={{ color: WAIZ.navy }}>
        Conversion funnel
      </h3>
      <p className="text-[12px] mb-4" style={{ color: WAIZ.mid }}>
        Lead → funded. Right column is step conversion from the stage above.
      </p>
      {top === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: WAIZ.mid }}>No leads in this range.</p>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, i) => {
            const prev = i > 0 ? stages[i - 1].value : null;
            const widthPct = top > 0 ? Math.max((stage.value / top) * 100, stage.value > 0 ? 4 : 0) : 0;
            const isLast = i === stages.length - 1;
            return (
              <div key={stage.label} className="flex items-center gap-3">
                <span className="text-[11px] w-20 flex-shrink-0 truncate font-medium" style={{ color: WAIZ.mid }}>
                  {stage.label}
                </span>
                <div className="flex-1 h-7 relative overflow-hidden" style={{ background: WAIZ.light, borderRadius: 2 }}>
                  <div
                    className="h-full flex items-center px-2"
                    style={{
                      width: `${widthPct}%`,
                      background: isLast
                        ? `linear-gradient(90deg, ${WAIZ.gold}, #E8A820)`
                        : `linear-gradient(90deg, ${WAIZ.navy}, ${WAIZ.accent})`,
                      borderRadius: 2,
                    }}
                  >
                    <span className="text-xs font-semibold tabular-nums" style={{ color: WAIZ.white }}>
                      {stage.value}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] w-14 flex-shrink-0 text-right tabular-nums font-medium" style={{ color: WAIZ.mid }}>
                  {prev != null ? stepPct(stage.value, prev) : "100%"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Client-clean performance sheet — Waiz Media branded document for preview & print/PDF.
 */
export default function ClientReportSheet({
  clientName,
  title,
  rangeLabel,
  generatedAt,
  metrics,
  sections,
  charts,
  reportingType,
  dialPool = null,
  showCostCharts,
  kpiSeries = [],
  costSeries = [],
  trendsGranularity = "day",
  hasDateRange,
  trendsLoading = false,
  trendsError = "",
  itemized = null,
  itemizedLoading = false,
  itemizedError = "",
}: Props) {
  const generatedLabel =
    generatedAt ??
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const wantsItemized = charts.itemizedWork || charts.itemizedLeads;

  return (
    <article
      className={`client-report-sheet ${plex.className}`}
      style={{ background: WAIZ.white, color: WAIZ.dark }}
    >
      {/* Prepared strip */}
      <div
        className="client-report-banner text-center px-4 py-2 text-[11px] font-medium"
        style={{
          background: WAIZ.royal,
          color: "rgba(255,255,255,0.9)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        Prepared by <strong style={{ color: WAIZ.white, fontWeight: 600 }}>{WAIZ.brandName}</strong>
        {" · "}
        {generatedLabel}
      </div>

      {/* Navy hero */}
      <header
        className="client-report-hero client-report-header relative overflow-hidden px-6 sm:px-8 py-8 sm:py-10"
        style={{ background: WAIZ.navy }}
      >
        <div
          className="pointer-events-none absolute"
          style={{
            top: -80,
            right: -80,
            width: 280,
            height: 280,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(79,163,255,0.18) 0%, transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative z-[1]">
          <p
            className="text-[11px] font-semibold uppercase mb-3"
            style={{ color: WAIZ.accent, letterSpacing: "0.22em" }}
          >
            {title || "Performance Report"}
          </p>
          <h1
            className={`${barlow.className} text-3xl sm:text-4xl font-extrabold uppercase tracking-wide leading-none mb-3`}
            style={{ color: WAIZ.white }}
          >
            {clientName}
          </h1>
          <p className="text-sm font-light mb-5" style={{ color: "rgba(255,255,255,0.72)" }}>
            Performance summary for the selected period
          </p>
          <div
            className="flex flex-wrap gap-6 pt-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: WAIZ.accent, letterSpacing: "0.14em" }}>
                Period
              </p>
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.92)" }}>
                {rangeLabel}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: WAIZ.accent, letterSpacing: "0.14em" }}>
                Prepared
              </p>
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.92)" }}>
                {generatedLabel}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="px-6 sm:px-8 py-8" style={{ background: WAIZ.white }}>
        {sections.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: WAIZ.mid }}>
            No KPIs selected. Choose metrics in the builder panel.
          </p>
        ) : (
          <div className="space-y-8">
            {sections.map(section => (
              <section key={section.title} className="client-report-block">
                <SectionLabel>{section.title}</SectionLabel>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {section.cards.map(card => (
                    <div
                      key={`${section.title}-${card.label}`}
                      className="p-4"
                      style={{
                        background: card.accent ? "rgba(245,200,66,0.1)" : WAIZ.light,
                        border: `1px solid ${card.accent ? WAIZ.gold : WAIZ.divider}`,
                        borderLeft: `3px solid ${card.accent ? WAIZ.gold : WAIZ.navy}`,
                        borderRadius: 2,
                      }}
                    >
                      <p className="text-[11px] font-medium" style={{ color: WAIZ.mid }}>
                        {card.label}
                      </p>
                      <p
                        className={`${barlow.className} text-2xl font-extrabold tabular-nums mt-1 leading-none`}
                        style={{ color: WAIZ.navy }}
                      >
                        {formatCardValue(card, metrics)}
                      </p>
                      {card.valueCaption && (
                        <p className="text-[10px] mt-1.5 uppercase tracking-wide font-medium" style={{ color: WAIZ.mid }}>
                          {card.valueCaption}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {(charts.showQuality || charts.funnel) && (
          <div className="mt-8 space-y-4">
            <SectionLabel>Visuals</SectionLabel>
            {charts.showQuality && <LightShowQuality metrics={metrics} />}
            {charts.funnel && <LightFunnel metrics={metrics} />}
          </div>
        )}

        {charts.rateTrends && (
          <section className="client-report-block mt-8">
            <SectionLabel>Trends</SectionLabel>
            <h2
              className={`${barlow.className} text-xl font-bold uppercase tracking-wide mb-3`}
              style={{ color: WAIZ.navy }}
            >
              Rate trends
            </h2>
            <div
              className="client-report-charts p-4"
              style={{ border: `1px solid ${WAIZ.divider}`, background: WAIZ.light, borderRadius: 2 }}
            >
              <RateTrendCharts
                kpiSeries={kpiSeries}
                granularity={trendsGranularity}
                loading={trendsLoading}
                error={trendsError}
                hasDateRange={hasDateRange}
                reportingType={reportingType}
                dialPool={dialPool}
              />
            </div>
          </section>
        )}

        {showCostCharts && charts.costTrends && (
          <section className="client-report-block mt-8">
            <SectionLabel>Trends</SectionLabel>
            <h2
              className={`${barlow.className} text-xl font-bold uppercase tracking-wide mb-3`}
              style={{ color: WAIZ.navy }}
            >
              Cost trends
            </h2>
            <div
              className="client-report-charts p-4"
              style={{ border: `1px solid ${WAIZ.divider}`, background: WAIZ.light, borderRadius: 2 }}
            >
              <CostTrendCharts
                series={costSeries}
                granularity={trendsGranularity}
                loading={trendsLoading}
                error={trendsError}
                hasDateRange={hasDateRange}
              />
            </div>
          </section>
        )}

        {wantsItemized && (
          <>
            {itemizedLoading && !itemized && (
              <p className="mt-8 text-sm text-center" style={{ color: WAIZ.mid }}>
                Loading itemized lists…
              </p>
            )}
            {itemizedError && !itemizedLoading && (
              <p className="mt-8 text-sm text-center" style={{ color: "#b91c1c" }}>
                {itemizedError}
              </p>
            )}
            {itemized?.work && charts.itemizedWork && <ItemizedWorkSection work={itemized.work} />}
            {itemized?.leads && charts.itemizedLeads && <LeadsTable rows={itemized.leads} />}
          </>
        )}

        <footer
          className="mt-10 pt-5 text-center"
          style={{ borderTop: `1px solid ${WAIZ.divider}` }}
        >
          <p className="text-[11px] leading-relaxed" style={{ color: WAIZ.mid }}>
            Figures for the selected period · Prepared by {WAIZ.brandName} · {generatedLabel}
          </p>
        </footer>
      </div>
    </article>
  );
}
