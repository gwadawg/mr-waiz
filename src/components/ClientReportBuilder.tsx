"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ClientSelect, { type ClientOption } from "@/components/ClientSelect";
import DateRangeFilter from "@/components/DateRangeFilter";
import ClientReportSheet from "@/components/ClientReportSheet";
import {
  DEFAULT_REPORT_TITLE,
  getClientReportDefaults,
  getFilteredClientReportSections,
  supportsCostTrends,
  type ClientReportChartFlags,
} from "@/lib/client-report-defaults";
import { getDateRange, type DatePreset } from "@/lib/date-presets";
import {
  getKpiSections,
  normalizeReportingType,
  type ReportingType,
} from "@/lib/kpi-layouts";
import type {
  CostTrendPoint,
  KpiTimelineBucket,
  MetricsResult,
} from "@/lib/metrics";
import type { ClientReportItemized } from "@/lib/client-report-itemized";
import type { DialPool } from "@/lib/dial-pool";

type Client = ClientOption & { reporting_type?: ReportingType };

type Props = {
  clients: Client[];
};

export default function ClientReportBuilder({ clients }: Props) {
  const [clientId, setClientId] = useState("");
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [title, setTitle] = useState(DEFAULT_REPORT_TITLE);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<keyof MetricsResult>>(new Set());
  const [charts, setCharts] = useState<ClientReportChartFlags>({
    showQuality: true,
    funnel: true,
    rateTrends: true,
    costTrends: false,
    itemizedWork: false,
    itemizedLeads: false,
  });

  const [metrics, setMetrics] = useState<MetricsResult | null>(null);
  const [dialPool, setDialPool] = useState<DialPool | null>(null);
  const [kpiSeries, setKpiSeries] = useState<KpiTimelineBucket[]>([]);
  const [costSeries, setCostSeries] = useState<CostTrendPoint[]>([]);
  const [trendsGranularity, setTrendsGranularity] = useState<"day" | "week">("day");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [itemized, setItemized] = useState<ClientReportItemized | null>(null);
  const [itemizedLoading, setItemizedLoading] = useState(false);
  const [itemizedError, setItemizedError] = useState("");

  const selectedClient = useMemo(
    () => clients.find(c => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const reportingType = useMemo(
    () => normalizeReportingType(selectedClient?.reporting_type),
    [selectedClient],
  );

  const catalogSections = useMemo(
    () => (selectedClient ? getKpiSections(reportingType) : []),
    [selectedClient, reportingType],
  );

  const filteredSections = useMemo(
    () =>
      selectedClient
        ? getFilteredClientReportSections(reportingType, selectedMetrics)
        : [],
    [selectedClient, reportingType, selectedMetrics],
  );

  const showCostCharts = supportsCostTrends(reportingType);

  const range = useMemo(() => {
    if (preset === "custom") return { start: customStart, end: customEnd };
    return getDateRange(preset);
  }, [preset, customStart, customEnd]);

  const hasDateRange = Boolean(range.start && range.end);
  const rangeLabel =
    range.start && range.end
      ? `${formatDisplayDate(range.start)} – ${formatDisplayDate(range.end)}`
      : preset === "all_time"
        ? "All time"
        : "Select a date range";

  const applyDefaults = useCallback((type: ReportingType) => {
    const defaults = getClientReportDefaults(type);
    setSelectedMetrics(new Set(defaults.metrics));
    setCharts({ ...defaults.charts });
  }, []);

  // Apply client-safe defaults when client (and thus reporting type) changes.
  useEffect(() => {
    if (!selectedClient) {
      setSelectedMetrics(new Set());
      return;
    }
    applyDefaults(reportingType);
  }, [selectedClient?.id, reportingType, applyDefaults, selectedClient]);

  // Fetch metrics when client + range ready.
  useEffect(() => {
    if (!clientId) {
      setMetrics(null);
      setDialPool(null);
      setKpiSeries([]);
      setCostSeries([]);
      setError("");
      return;
    }
    if (preset === "custom" && (!range.start || !range.end || range.start > range.end)) {
      setMetrics(null);
      setError("Enter a valid custom date range.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ client_id: clientId });
    if (range.start) params.set("start_date", range.start);
    if (range.end) params.set("end_date", range.end);
    if (hasDateRange) params.set("include_trends", "1");

    fetch(`/api/metrics?${params}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load metrics (${r.status})`);
        }
        return r.json();
      })
      .then((d: MetricsResult & {
        dial_pool?: DialPool | null;
        trends?: {
          granularity?: "day" | "week";
          kpiSeries?: KpiTimelineBucket[];
          series?: CostTrendPoint[];
        };
        kpiSeries?: KpiTimelineBucket[];
        series?: CostTrendPoint[];
        granularity?: "day" | "week";
      }) => {
        if (cancelled) return;
        const { trends, dial_pool, kpiSeries: flatSeries, series: flatSeriesCost, granularity: flatGranularity, ...metricFields } = d;
        setMetrics(metricFields);
        setDialPool(dial_pool ?? null);
        setKpiSeries(trends?.kpiSeries ?? flatSeries ?? []);
        setCostSeries(trends?.series ?? flatSeriesCost ?? []);
        setTrendsGranularity(trends?.granularity ?? flatGranularity ?? "day");
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMetrics(null);
        setDialPool(null);
        setKpiSeries([]);
        setCostSeries([]);
        setError(err instanceof Error ? err.message : "Failed to load metrics");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, range.start, range.end, hasDateRange, preset]);

  // Itemized work / leads lists when toggled on.
  useEffect(() => {
    const wantWork = charts.itemizedWork;
    const wantLeads = charts.itemizedLeads;
    if (!clientId || (!wantWork && !wantLeads)) {
      setItemized(null);
      setItemizedError("");
      setItemizedLoading(false);
      return;
    }
    if (!hasDateRange || !range.start || !range.end) {
      setItemized(null);
      setItemizedError("Itemized lists need a date range with a start and end date.");
      setItemizedLoading(false);
      return;
    }
    if (preset === "custom" && range.start > range.end) {
      setItemized(null);
      setItemizedError("Enter a valid custom date range.");
      return;
    }

    let cancelled = false;
    setItemizedLoading(true);
    setItemizedError("");

    const params = new URLSearchParams({
      client_id: clientId,
      start_date: range.start,
      end_date: range.end,
    });
    if (wantWork) params.set("include_work", "1");
    if (wantLeads) params.set("include_leads", "1");

    fetch(`/api/client-report/itemized?${params}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Failed to load itemized data (${r.status})`);
        return body as ClientReportItemized;
      })
      .then(data => {
        if (cancelled) return;
        setItemized(data);
        setItemizedLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItemized(null);
        setItemizedError(err instanceof Error ? err.message : "Failed to load itemized data");
        setItemizedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    range.start,
    range.end,
    hasDateRange,
    preset,
    charts.itemizedWork,
    charts.itemizedLeads,
  ]);

  function toggleMetric(key: keyof MetricsResult) {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setSectionAll(sectionTitle: string, on: boolean) {
    const section = catalogSections.find(s => s.title === sectionTitle);
    if (!section) return;
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      for (const card of section.cards) {
        if (on) next.add(card.metric);
        else next.delete(card.metric);
      }
      return next;
    });
  }

  function handleDownloadPdf() {
    if (!selectedClient || !metrics) return;
    window.print();
  }

  const canPrint = Boolean(selectedClient && metrics && !loading);

  return (
    <div className="client-report-builder flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-8rem)]">
      {/* Builder chrome — hidden when printing */}
      <aside
        className="client-report-builder-panel report-print-hide w-full lg:w-80 xl:w-96 flex-shrink-0 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto border-b lg:border-b-0 lg:border-r"
        style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0a1220" }}
      >
        <div className="p-4 space-y-5 relative z-10">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "#f1f5f9" }}>
              Client report builder
            </h2>
            <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "#64748b" }}>
              Pick a client, date range, and what to include. Download as PDF to send.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
              Client
            </label>
            <ClientSelect
              value={clientId}
              onChange={v => {
                // ClientSelect includes All/Live when includeLive — we only want real clients.
                if (v === "" || v === "__live__") {
                  setClientId("");
                  return;
                }
                setClientId(v);
              }}
              clients={clients}
              includeLive={false}
              className="w-full"
            />
            {!clientId && (
              <p className="text-[11px]" style={{ color: "#64748b" }}>
                Select one client to build a sheet.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
              Date range
            </label>
            <DateRangeFilter
              preset={preset}
              customStart={customStart}
              customEnd={customEnd}
              onPresetChange={setPreset}
              onCustomStartChange={setCustomStart}
              onCustomEndChange={setCustomEnd}
              variant="inline"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
              Report title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={DEFAULT_REPORT_TITLE}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "#0f2040",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#e2e8f0",
              }}
            />
          </div>

          {selectedClient && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
                    KPIs
                  </label>
                  <button
                    type="button"
                    onClick={() => applyDefaults(reportingType)}
                    className="text-[11px] font-medium"
                    style={{ color: "#f59e0b" }}
                  >
                    Reset defaults
                  </button>
                </div>

                {catalogSections.map(section => {
                  const allOn = section.cards.every(c => selectedMetrics.has(c.metric));
                  const someOn = section.cards.some(c => selectedMetrics.has(c.metric));
                  return (
                    <div
                      key={section.title}
                      className="rounded-lg p-3"
                      style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>
                          {section.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSectionAll(section.title, !allOn)}
                          className="text-[10px] font-medium"
                          style={{ color: someOn ? "#94a3b8" : "#64748b" }}
                        >
                          {allOn ? "None" : "All"}
                        </button>
                      </div>
                      <ul className="space-y-1.5">
                        {section.cards.map(card => {
                          const checked = selectedMetrics.has(card.metric);
                          return (
                            <li key={card.metric}>
                              <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleMetric(card.metric)}
                                  className="rounded border-slate-600"
                                />
                                <span
                                  className="text-[12px]"
                                  style={{ color: checked ? "#e2e8f0" : "#64748b" }}
                                >
                                  {card.label}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
                  Charts
                </label>
                <div
                  className="rounded-lg p-3 space-y-2"
                  style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <ChartToggle
                    label="Appointment outcomes"
                    checked={charts.showQuality}
                    onChange={v => setCharts(c => ({ ...c, showQuality: v }))}
                  />
                  <ChartToggle
                    label="Conversion funnel"
                    checked={charts.funnel}
                    onChange={v => setCharts(c => ({ ...c, funnel: v }))}
                  />
                  <ChartToggle
                    label="Rate trends"
                    checked={charts.rateTrends}
                    onChange={v => setCharts(c => ({ ...c, rateTrends: v }))}
                    disabled={!hasDateRange}
                    hint={!hasDateRange ? "Needs a finite date range" : undefined}
                  />
                  {showCostCharts && (
                    <ChartToggle
                      label="Cost trends"
                      checked={charts.costTrends}
                      onChange={v => setCharts(c => ({ ...c, costTrends: v }))}
                      disabled={!hasDateRange}
                      hint={!hasDateRange ? "Needs a finite date range" : undefined}
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
                  Itemized lists
                </label>
                <div
                  className="rounded-lg p-3 space-y-2"
                  style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <ChartToggle
                    label="Appointments & outcomes"
                    checked={charts.itemizedWork}
                    onChange={v => setCharts(c => ({ ...c, itemizedWork: v }))}
                    disabled={!hasDateRange}
                    hint={
                      !hasDateRange
                        ? "Needs a date range"
                        : "Booked (with status), showed, no-showed, LO bailed, live transfers, claimed — with dates"
                    }
                  />
                  <ChartToggle
                    label="All leads"
                    checked={charts.itemizedLeads}
                    onChange={v => setCharts(c => ({ ...c, itemizedLeads: v }))}
                    disabled={!hasDateRange}
                    hint={
                      !hasDateRange
                        ? "Needs a date range"
                        : "Every lead in the period with received date, phone, source"
                    }
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!canPrint}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: "#f59e0b", color: "#0f172a" }}
            >
              Download PDF
            </button>
            <p className="text-[10px] leading-relaxed" style={{ color: "#475569" }}>
              Opens your browser print dialog — choose “Save as PDF”.
            </p>
          </div>
        </div>
      </aside>

      {/* Preview */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ background: "#1a2332" }}>
        <div className="report-print-hide px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-xs font-medium" style={{ color: "#64748b" }}>
            Preview
          </p>
          {loading && (
            <span className="text-xs" style={{ color: "#94a3b8" }}>Loading…</span>
          )}
          {itemizedLoading && !loading && (
            <span className="text-xs" style={{ color: "#94a3b8" }}>Loading lists…</span>
          )}
          {error && !loading && (
            <span className="text-xs text-red-400">{error}</span>
          )}
          {itemizedError && !itemizedLoading && !error && (
            <span className="text-xs text-red-400">{itemizedError}</span>
          )}
        </div>

        <div className="client-report-preview-wrap p-4 md:p-8 max-w-4xl mx-auto">
          {!selectedClient ? (
            <div
              className="report-print-hide rounded-xl p-12 text-center"
              style={{ background: "#0f2040", border: "1px dashed rgba(255,255,255,0.1)" }}
            >
              <p className="text-sm" style={{ color: "#64748b" }}>
                Select a client to preview the report sheet.
              </p>
            </div>
          ) : loading && !metrics ? (
            <div className="report-print-hide flex items-center justify-center py-24 gap-3" style={{ color: "#475569" }}>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Loading metrics…</span>
            </div>
          ) : metrics ? (
            <div
              className="client-report-print-root rounded-xl shadow-2xl overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 25px 50px rgba(6,26,74,0.25)" }}
            >
              <div className="p-0">
                <ClientReportSheet
                  clientName={selectedClient.name}
                  title={title.trim() || DEFAULT_REPORT_TITLE}
                  rangeLabel={rangeLabel}
                  metrics={metrics}
                  sections={filteredSections}
                  charts={charts}
                  reportingType={reportingType}
                  dialPool={dialPool}
                  showCostCharts={showCostCharts}
                  kpiSeries={kpiSeries}
                  costSeries={costSeries}
                  trendsGranularity={trendsGranularity}
                  hasDateRange={hasDateRange}
                  trendsLoading={loading}
                  trendsError={error}
                  itemized={itemized}
                  itemizedLoading={itemizedLoading}
                  itemizedError={itemizedError}
                />
              </div>
            </div>
          ) : (
            <div className="report-print-hide rounded-xl p-12 text-center" style={{ background: "#0f2040" }}>
              <p className="text-sm text-red-400">{error || "No data for this range."}</p>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: letter;
            margin: 0.5in;
          }

          body {
            background: #fff !important;
          }

          /* Isolate sheet: hide app chrome, show only the printable sheet */
          body * {
            visibility: hidden !important;
          }

          .client-report-print-root,
          .client-report-print-root * {
            visibility: visible !important;
          }

          .client-report-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
            background: #fff !important;
          }

          .client-report-print-root > div {
            padding: 0 !important;
          }

          .client-report-sheet {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .client-report-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Preserve navy brand blocks in PDF output */
          .client-report-banner {
            background: #0E2F73 !important;
            color: rgba(255, 255, 255, 0.9) !important;
          }

          .client-report-hero {
            background: #061A4A !important;
          }

          .client-report-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .client-report-block table {
            break-inside: auto;
          }

          .client-report-block tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .client-report-charts {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .client-report-header {
            break-after: avoid;
          }

          /* Recharts needs fixed height in print */
          .client-report-charts .recharts-responsive-container,
          .client-report-charts .recharts-wrapper {
            max-width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}

function ChartToggle({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className={`flex items-start gap-2 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 rounded border-slate-600"
      />
      <span>
        <span className="text-[12px] block" style={{ color: "#e2e8f0" }}>
          {label}
        </span>
        {hint && (
          <span className="text-[10px] block" style={{ color: "#64748b" }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function formatDisplayDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
