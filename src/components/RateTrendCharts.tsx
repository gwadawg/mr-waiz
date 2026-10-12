"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KpiTimelineBucket } from "@/lib/metrics";
import { usesCallCenterKpiLayout, type ReportingType } from "@/lib/kpi-layouts";
import type { DialPool } from "@/lib/dial-pool";

type Props = {
  kpiSeries: KpiTimelineBucket[];
  granularity: "day" | "week";
  loading?: boolean;
  error?: string;
  hasDateRange: boolean;
  reportingType?: ReportingType;
  dialPool?: DialPool | null;
};

type RateKey =
  | "net_show_rate"
  | "show_rate"
  | "booked_to_conversation_rate"
  | "lead_to_qual"
  | "hand_raise_rate"
  | "booking_rate"
  | "lead_booking_rate"
  | "conversation_rate"
  | "leads";

type ChartFormat = "pct" | "int";

const CHARTS: {
  key: RateKey;
  title: string;
  subtitle: string;
  color: string;
  format?: ChartFormat;
  heOnly?: boolean;
  rmOnly?: boolean;
}[] = [
  { key: "lead_to_qual", title: "Qualified rate", subtitle: "Qualified Leads ÷ Total Leads", color: "#22c55e", rmOnly: true },
  {
    key: "booked_to_conversation_rate",
    title: "Show rate",
    subtitle: "Unique booked → spoke ÷ unique booked — recovery-inclusive (graded)",
    color: "#34d399",
  },
  {
    key: "show_rate",
    title: "True Show",
    subtitle: "Shows ÷ (Shows + No-shows + LO bailed) — appointments that took place",
    color: "#3b82f6",
  },
  { key: "hand_raise_rate", title: "Hand-raise rate", subtitle: "Unique (Booked ∪ Claimed ∪ LT) ÷ Qualified — conversion benchmark", color: "#f59e0b", rmOnly: true },
  { key: "booking_rate", title: "Booking rate (ref)", subtitle: "Unique booked ÷ Qualified — not graded", color: "#64748b", rmOnly: true },
  { key: "lead_booking_rate", title: "Booking rate (ref)", subtitle: "Unique booked ÷ Total Leads — not graded", color: "#64748b", heOnly: true },
  // HE has no ad spend / CPL — lead volume is the volume signal instead of cost trends.
  { key: "leads", title: "Lead volume", subtitle: "Total leads ingested per period", color: "#38bdf8", format: "int", heOnly: true },
  // ÷ Qualified — only meaningful for RM (HE uses Total Leads denominators).
  { key: "conversation_rate", title: "Conversation rate", subtitle: "Unique (Show ∪ Claimed ∪ LT) ÷ Qualified", color: "#a78bfa", rmOnly: true },
];

function formatDateLabel(date: string, granularity: "day" | "week"): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) +
    (granularity === "week" ? " (wk)" : "")
  );
}

function formatChartValue(value: number, format: ChartFormat): string {
  if (format === "int") return Math.round(value).toLocaleString("en-US");
  return `${value.toFixed(1)}%`;
}

function ChartPanel({
  title,
  subtitle,
  dataKey,
  color,
  format = "pct",
  data,
  granularity,
}: {
  title: string;
  subtitle: string;
  dataKey: RateKey;
  color: string;
  format?: ChartFormat;
  data: KpiTimelineBucket[];
  granularity: "day" | "week";
}) {
  const chartData = data.map(p => ({
    label: formatDateLabel(p.date, granularity),
    value: p[dataKey] as number | null,
  }));
  const hasAnyValue =
    format === "int"
      ? chartData.some(d => d.value != null && d.value > 0)
      : chartData.some(d => d.value != null);

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "linear-gradient(135deg, #0f2040 0%, #0c1a30 100%)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{title}</h3>
        <p className="text-[10px] mt-0.5" style={{ color: "#475569" }}>{subtitle}</p>
      </div>
      {!hasAnyValue ? (
        <p className="text-xs py-12 text-center" style={{ color: "#475569" }}>No data in this range.</p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickFormatter={v => (format === "int" ? `${v}` : `${v}%`)}
                width={format === "int" ? 44 : 40}
                domain={format === "int" ? [0, "auto"] : [0, 100]}
                allowDecimals={format !== "int"}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as { label: string; value: number | null };
                  return (
                    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}>
                      <p className="font-semibold mb-1" style={{ color }}>{point.label}</p>
                      <p>{point.value != null ? formatChartValue(point.value, format) : "—"}</p>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={chartData.length <= 31 ? { r: 3, fill: color } : false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function RateTrendCharts({
  kpiSeries,
  granularity,
  loading = false,
  error = "",
  hasDateRange,
  reportingType = "RM",
  dialPool = null,
}: Props) {
  if (!hasDateRange) {
    return <p className="text-xs" style={{ color: "#475569" }}>Select a date range to view rate trends.</p>;
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3" style={{ color: "#334155" }}>
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm font-medium">Loading rate trends…</span>
      </div>
    );
  }
  if (error) return <p className="text-xs text-red-400">{error}</p>;

  const hasActivity = kpiSeries.some(p => p.booked > 0 || p.leads > 0);

  if (!hasActivity) {
    return (
      <p className="text-xs py-8 text-center rounded-xl" style={{ color: "#475569", background: "#0a1628" }}>
        No appointment or lead activity in this range.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {CHARTS.filter(chart =>
        usesCallCenterKpiLayout(reportingType) ? !chart.rmOnly : !chart.heOnly,
      ).map(chart => (
        <ChartPanel
          key={chart.key}
          title={chart.title}
          subtitle={
            dialPool === "all" && chart.key === "hand_raise_rate"
              ? "Unique (Booked ∪ Claimed ∪ LT) ÷ Total Leads"
              : dialPool === "all" && chart.key === "conversation_rate"
                ? "Unique (Show ∪ Claimed ∪ LT) ÷ Total Leads"
                : chart.subtitle
          }
          dataKey={chart.key}
          color={chart.color}
          format={chart.format}
          data={kpiSeries}
          granularity={granularity}
        />
      ))}
    </div>
  );
}
