"use client";

import { Fragment, useEffect, useState } from "react";
import { useUrlParams } from "@/lib/use-url-params";
import type { LeadProduct } from "@/lib/lead-intake";

type LeadCounts = {
  dials: number;
  pickups: number;
  conversations: number;
  appointments_booked: number;
  shows: number;
  no_shows: number;
  lo_bailed: number;
  cancellations: number;
  callbacks: number;
  live_transfers: number;
  claimed: number;
  proposals: number;
  loan_processing: number;
  closed: number;
  proposals_made: number;
  submissions_made: number;
  funded_loans: number;
};

type TimelineItem = {
  id: string;
  event_type: string;
  occurred_at: string;
  scheduled_at: string | null;
  agent_name: string | null;
  duration_seconds: number | null;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  call_status: string | null;
  calendar_name: string | null;
  external_id: string | null;
  calendar_id: string | null;
  stage_booked: string | null;
  recording_url: string | null;
  dq_reason: string | null;
};

type LeadProfile = {
  contact_key: string;
  client_name: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  created_at: string;
  is_qualified: boolean;
  is_hot: boolean;
  is_out_of_state: boolean;
  loan_amount: string | null;
  property_value: string | null;
  ltv: number | null;
  b1_age: string | null;
  b2_age: string | null;
  state?: string | null;
  credit_score_range?: string | null;
  property_use?: string | null;
  utm_term?: string | null;
  product?: LeadProduct | null;
  lead_source: string | null;
  ad_name: string | null;
  has_proposal_made: boolean;
  has_submission_made: boolean;
  has_loan_funded: boolean;
  has_manual_dq?: boolean;
  dq_reason?: string | null;
  ghl_contact_id: string | null;
  ghl_location_id: string | null;
  counts: LeadCounts;
  timeline: TimelineItem[];
};

type UnmappedContact = LeadProfile & {
  first_activity: string;
  last_activity: string;
  event_count: number;
  event_types: Record<string, number>;
};

type MappingSummary = {
  leads_in_period: number;
  unmapped_contacts: number;
  unmapped_events: number;
  unmapped_by_type: Record<string, number>;
};

type TableView = "leads" | "unmapped";

type Props = {
  /** Scope inherited from the workspace filter bar. */
  clientId?: string;
  liveOnly?: boolean;
  startDate: string;
  endDate: string;
};

const EVENT_LABELS: Record<string, string> = {
  lead: "Lead",
  dial: "Dial",
  appointment_booked: "Appt Booked",
  appointment_cancelled: "Cancelled",
  appointment_rescheduled: "Rescheduled",
  show: "Show",
  no_show: "No Show (lead)",
  lo_bailed: "LO bailed",
  callback_booked: "Callback",
  live_transfer: "Live Transfer",
  claimed: "Claimed",
  proposal_sent: "Proposal",
  proposal_made: "Proposal",
  loan_processing: "Submitted",
  submission_made: "Submitted",
  closed: "Funded",
  loan_funded: "Funded",
  lo_audit: "LO audit",
  out_of_state_lead: "Out of State",
  manual_dq: "Disqualified",
};

function fmtDate(iso: string, withTime = true) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function fmtPhone(phone: string | null) {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

function ghlContactUrl(row: Pick<LeadProfile, "ghl_location_id" | "ghl_contact_id">): string | null {
  if (!row.ghl_location_id || !row.ghl_contact_id) return null;
  return `https://app.gohighlevel.com/v2/location/${row.ghl_location_id}/contacts/detail/${row.ghl_contact_id}`;
}

function formatUnmappedTypes(byType: Record<string, number>): string {
  return Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${EVENT_LABELS[type] ?? type}`)
    .join(" · ");
}

function MappingBanner({
  summary,
  view,
  onViewChange,
}: {
  summary: MappingSummary;
  view: TableView;
  onViewChange: (view: TableView) => void;
}) {
  if (summary.unmapped_contacts === 0) return null;

  return (
    <div
      className="rounded-xl px-4 py-3 space-y-3"
      style={{ background: "#422006", border: "1px solid rgba(251, 191, 36, 0.25)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold" style={{ color: "#fde68a" }}>
            Unmapped activity detected
          </p>
          <p className="text-xs leading-relaxed max-w-3xl" style={{ color: "#fcd34d" }}>
            {summary.unmapped_contacts.toLocaleString()} contact
            {summary.unmapped_contacts === 1 ? "" : "s"} had{" "}
            {summary.unmapped_events.toLocaleString()} event
            {summary.unmapped_events === 1 ? "" : "s"} in this range with no matching{" "}
            <code className="text-[11px]">lead</code> event on record. These are excluded from the
            lead count ({summary.leads_in_period.toLocaleString()}) so it matches the dashboard.
          </p>
          {Object.keys(summary.unmapped_by_type).length > 0 && (
            <p className="text-xs" style={{ color: "#fbbf24" }}>
              {formatUnmappedTypes(summary.unmapped_by_type)}
            </p>
          )}
        </div>
        <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: "1px solid rgba(251, 191, 36, 0.3)" }}>
          <button
            type="button"
            onClick={() => onViewChange("leads")}
            className="px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: view === "leads" ? "#f59e0b" : "transparent",
              color: view === "leads" ? "#1c1917" : "#fde68a",
            }}
          >
            Leads ({summary.leads_in_period.toLocaleString()})
          </button>
          <button
            type="button"
            onClick={() => onViewChange("unmapped")}
            className="px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: view === "unmapped" ? "#f59e0b" : "transparent",
              color: view === "unmapped" ? "#1c1917" : "#fde68a",
            }}
          >
            Unmapped ({summary.unmapped_contacts.toLocaleString()})
          </button>
        </div>
      </div>
    </div>
  );
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadLeadsPageCsv(rows: LeadProfile[], page: number) {
  const headers = [
    "Client",
    "Lead ID",
    "Name",
    "Phone",
    "Email",
    "Loan amount",
    "Property value",
    "LTV",
    "State",
    "Product",
    "B1 age",
    "B2 age",
    "Credit score range",
    "Property use",
    "Lead source",
    "Ad",
    "Site",
    "Lead created",
    "Qualified",
    "Hot",
    "Out of state",
    "Dials",
    "Appts booked",
    "Shows",
    "No-shows",
    "LO bailed",
    "Cancelled",
    "Funded",
    "In processing",
    "Callbacks",
    "Claimed",
    "Proposals",
    "Live transfers",
  ];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    const k = row.contact_key;
    const c = row.counts;
    lines.push(
      [
        row.client_name,
        k,
        row.lead_name ?? "",
        row.lead_phone ?? "",
        row.lead_email ?? "",
        row.loan_amount ?? "",
        row.property_value ?? "",
        row.ltv != null ? `${row.ltv}%` : "",
        row.state ?? "",
        row.product ? row.product.toUpperCase() : "",
        row.b1_age ?? "",
        row.b2_age ?? "",
        row.credit_score_range ?? "",
        row.property_use ?? "",
        row.lead_source ?? "",
        row.ad_name ?? "",
        row.utm_term ?? "",
        new Date(row.created_at).toISOString().slice(0, 10),
        row.is_qualified ? "Y" : "",
        row.is_hot ? "Y" : "",
        row.is_out_of_state ? "Y" : "",
        String(c.dials),
        String(c.appointments_booked),
        String(c.shows),
        String(c.no_shows),
        String(c.lo_bailed),
        String(c.cancellations),
        String(c.funded_loans),
        String(c.submissions_made),
        String(c.callbacks),
        String(c.claimed),
        String(c.proposals_made),
        String(c.live_transfers),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `raw-leads-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Flag({ on, label, color }: { on: boolean; label: string; color: string }) {
  if (!on) return null;
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  );
}

function CountPill({ label, value, accent }: { label: string; value: number; accent?: string }) {
  if (value === 0) return null;
  return (
    <span className="text-xs whitespace-nowrap" style={{ color: accent ?? "#94a3b8" }}>
      <span className="font-semibold" style={{ color: accent ?? "#e2e8f0" }}>{value}</span> {label}
    </span>
  );
}

const TIMELINE_APPT_TYPES = new Set([
  "appointment_booked",
  "appointment_cancelled",
  "appointment_rescheduled",
  "show",
  "no_show",
  "lo_bailed",
  "callback_booked",
]);

function TimelineRow({ item }: { item: TimelineItem }) {
  const label = EVENT_LABELS[item.event_type] ?? item.event_type;
  const detail: string[] = [];
  if (item.agent_name) detail.push(item.agent_name);
  if (item.duration_seconds != null) detail.push(`${item.duration_seconds}s`);
  if (item.is_pickup) detail.push("pickup");
  if (item.is_conversation) detail.push("2m+");
  if (item.call_status) detail.push(item.call_status);
  if (item.calendar_name) detail.push(item.calendar_name);
  if (item.stage_booked) detail.push(item.stage_booked);
  if (item.scheduled_at) detail.push(`sched ${fmtDate(item.scheduled_at)}`);
  if (item.event_type === "manual_dq" && item.dq_reason) {
    detail.push(item.dq_reason);
  }
  if (TIMELINE_APPT_TYPES.has(item.event_type) && item.external_id) {
    detail.push(`appt ${item.external_id}`);
  }
  if (TIMELINE_APPT_TYPES.has(item.event_type) && item.calendar_id) {
    detail.push(`cal ${item.calendar_id}`);
  }

  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: "#64748b" }}>
        {fmtDate(item.occurred_at)}
      </td>
      <td className="px-4 py-2 text-xs font-medium whitespace-nowrap" style={{ color: "#f59e0b" }}>
        {label}
      </td>
      <td className="px-4 py-2 text-xs" style={{ color: "#94a3b8" }}>
        {detail.join(" · ") || "—"}
      </td>
      <td className="px-4 py-2 text-xs">
        {item.recording_url ? (
          <a href={item.recording_url} target="_blank" rel="noopener noreferrer" style={{ color: "#f59e0b" }}>
            ▶ Listen
          </a>
        ) : (
          <span style={{ color: "#334155" }}>—</span>
        )}
      </td>
    </tr>
  );
}

export default function LeadProfilesTable({ clientId, liveOnly, startDate, endDate }: Props) {
  const urlParams = useUrlParams();
  const [rows, setRows] = useState<(LeadProfile | UnmappedContact)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [capped, setCapped] = useState(false);
  const [rangeClamped, setRangeClamped] = useState(false);
  const [effectiveStart, setEffectiveStart] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mappingSummary, setMappingSummary] = useState<MappingSummary | null>(null);

  // Table-local filters live in the URL so a narrowed list is linkable.
  const query = urlParams.get("q");
  const conversionFilter = urlParams.get("conv");
  const qualityFilter = urlParams.get("qual");
  const tableView: TableView = urlParams.get("rows") === "unmapped" ? "unmapped" : "leads";
  const pageParam = Number(urlParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const [search, setSearch] = useState(query);

  useEffect(() => { setSearch(query); }, [query]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === query) return;
    const t = setTimeout(() => urlParams.setMany({ q: trimmed, page: null }), 300);
    return () => clearTimeout(t);
  }, [search, query, urlParams]);

  const setPage = (next: number) => urlParams.set("page", next > 1 ? String(next) : null);

  // Rows are re-fetched from scratch, so previously opened detail rows would
  // otherwise stay expanded against different leads.
  useEffect(() => {
    setExpanded(new Set());
  }, [clientId, liveOnly, startDate, endDate, conversionFilter, qualityFilter, query, tableView]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setRows([]);
    setTotal(0);

    const params = new URLSearchParams({ page: String(page), view: tableView });
    if (liveOnly) params.set("live_only", "true");
    else if (clientId) params.set("client_id", clientId);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (conversionFilter && tableView === "leads") params.set("conversion_event", conversionFilter);
    if (qualityFilter && tableView === "leads") params.set("quality", qualityFilter);
    if (query) params.set("search", query);

    fetch(`/api/raw/leads?${params}`, { signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `Request failed (${r.status})`);
        return d;
      })
      .then((d) => {
        if (controller.signal.aborted) return;
        setRows(d.rows ?? []);
        setTotal(d.total ?? 0);
        setCapped(!!d.capped);
        setRangeClamped(!!d.range_clamped);
        setEffectiveStart(d.effective_start_date ?? null);
        setMappingSummary(d.mapping_summary ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load leads");
        setLoading(false);
      });

    return () => controller.abort();
  }, [clientId, liveOnly, page, startDate, endDate, conversionFilter, qualityFilter, query, tableView]);

  function handleViewChange(next: TableView) {
    urlParams.setMany({ rows: next === "unmapped" ? "unmapped" : null, page: null });
  }

  const isUnmappedView = tableView === "unmapped";
  const leadCount = mappingSummary?.leads_in_period ?? (isUnmappedView ? 0 : total);

  const totalPages = Math.ceil(total / 50);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {mappingSummary && (
        <MappingBanner summary={mappingSummary} view={tableView} onViewChange={handleViewChange} />
      )}
      {loadError && (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5" }}
        >
          {loadError}
        </div>
      )}
      {rangeClamped && !loading && (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", color: "#fbbf24" }}
        >
          All Clients + a wide date range is capped to the last 90 days
          {effectiveStart ? ` (from ${effectiveStart})` : ""} for speed. Pick a client to browse the full history.
        </div>
      )}
      {/* Client and date scope come from the workspace filter bar above. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            type="search"
            name="lead-search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search leads by name, phone, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or email…"
            className="pl-9 pr-8 py-2 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
            style={{
              background: "#0f2040",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#e2e8f0",
              minWidth: "16rem",
            }}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#475569" }}>
            ⌕
          </span>
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm leading-none"
              style={{ color: "#64748b" }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <select
          value={conversionFilter}
          onChange={(e) => urlParams.setMany({ conv: e.target.value || null, page: null })}
          disabled={isUnmappedView}
          aria-label="Stage filter"
          className="px-4 py-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-40"
          style={{
            background: "#0f2040",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#e2e8f0",
            minWidth: "12rem",
          }}
        >
          <option value="">All Stages</option>
          <optgroup label="Conversations">
            <option value="conversations">Conversations (claimed / LT / show)</option>
            <option value="claimed">Claimed</option>
            <option value="live_transfer">Live Transfer</option>
            <option value="show">Show</option>
          </optgroup>
          <optgroup label="Pipeline">
            <option value="proposal_made">Has Proposal</option>
            <option value="submission_made">Has Submission</option>
            <option value="loan_funded">Has Funded Loan</option>
            <option value="manual_dq">Disqualified</option>
          </optgroup>
        </select>
        <select
          value={qualityFilter}
          onChange={(e) => urlParams.setMany({ qual: e.target.value || null, page: null })}
          disabled={isUnmappedView}
          aria-label="Lead quality"
          className="px-4 py-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-40"
          style={{
            background: "#0f2040",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#e2e8f0",
            minWidth: "11rem",
          }}
        >
          <option value="">All Qualities</option>
          <option value="qualified">Qualified</option>
          <option value="hot">Hot</option>
          <option value="qualified_hot">Qualified + Hot</option>
        </select>
        <span className="text-sm" style={{ color: "#334155" }} aria-live="polite">
          {loading
            ? "Loading…"
            : isUnmappedView
              ? `${total.toLocaleString()} unmapped contact${total === 1 ? "" : "s"}`
              : `${leadCount.toLocaleString()} leads`}
          {!loading && query && <span style={{ color: "#475569" }}> · searching all dates</span>}
        </span>
        <button
          type="button"
          disabled={loading || rows.length === 0 || isUnmappedView}
          onClick={() => downloadLeadsPageCsv(rows as LeadProfile[], page)}
          className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
          style={{
            background: "#0f2040",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#94a3b8",
          }}
        >
          Download CSV (this page)
        </button>
        {capped && (
          <span className="text-xs px-2 py-1 rounded" style={{ background: "#422006", color: "#fbbf24" }}>
            Large range — narrow dates or client for full history
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed max-w-3xl" style={{ color: "#475569" }}>
        {isUnmappedView
          ? "Contacts with dial, claim, or appointment activity in this range but no lead event on record anywhere. Expand a row to inspect the orphaned events — usually a missing GHL lead webhook or a legacy contact being power-dialed."
          : conversionFilter || qualityFilter
            ? "One row per lead whose stage date falls in the range. A missing earlier stage uses its filled-in date. Conversations include shows, live transfers, claims, and filled-in conversations. Search by name, phone, or email still ignores the date range. Expand a row for the full history."
            : "One row per lead created in the selected date range. The ad is the lead's original ad. Loan amount, property value, LTV, state, site, ages, credit score, and property use are what the lead form sent. A blank cell means that field came in empty. Activity counts stay in the range; expand a row for the full history, including filled-in stages marked Implied. Search by name, phone, or email ignores the date range."}
      </p>

      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <table className="w-full text-sm min-w-[1680px] tabular-nums">
          <thead>
            <tr style={{ background: "#050c18" }}>
              {["", "Client", "Name", "Flags", "Source", "Ad", "Site", "Activity", "Loan amt", "Prop. value", "LTV", "State", "B1 age", "B2 age", "Credit score", "Property use", "Phone", "Email", isUnmappedView ? "Last activity" : "Created", "Contact"].map((h) => (
                <th
                  key={h || "expand"}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={20} className="px-4 py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={20} className="px-4 py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>
                  {isUnmappedView
                    ? "No unmapped activity in this range"
                    : conversionFilter
                      ? "No leads reached this stage in this range"
                      : "No leads in this range"}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const open = expanded.has(row.contact_key);
                const c = row.counts;
                const unmapped = isUnmappedView ? (row as UnmappedContact) : null;
                return (
                  <Fragment key={row.contact_key}>
                    <tr
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.03)",
                        background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
                      }}
                      onClick={() => toggleExpand(row.contact_key)}
                    >
                      <td className="px-4 py-3 text-xs" style={{ color: "#64748b" }}>
                        {open ? "▼" : "▶"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "#94a3b8" }}>
                        {row.client_name}
                        {row.product ? (
                          <span
                            className="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded align-middle"
                            style={{
                              background: row.product === "dscr" ? "#082f49" : "#1e1b4b",
                              color: row.product === "dscr" ? "#7dd3fc" : "#c4b5fd",
                              border: `1px solid ${row.product === "dscr" ? "rgba(125, 211, 252, 0.3)" : "rgba(196, 181, 253, 0.3)"}`,
                            }}
                          >
                            {row.product}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-medium" style={{ color: "#e2e8f0" }}>
                        {row.lead_name ?? "—"}
                        {!isUnmappedView && row.dq_reason ? (
                          <p className="text-[11px] font-normal mt-0.5 max-w-[16rem] truncate" style={{ color: "#fca5a5" }} title={row.dq_reason}>
                            {row.dq_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {isUnmappedView ? (
                            <span
                              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                              style={{ background: "#422006", color: "#fbbf24", border: "1px solid rgba(251, 191, 36, 0.35)" }}
                            >
                              No lead event
                            </span>
                          ) : (
                            <>
                              <Flag on={row.is_qualified} label="Q" color="#22c55e" />
                              <Flag on={row.is_hot} label="Hot" color="#ef4444" />
                              <Flag on={row.is_out_of_state} label="OOS" color="#a78bfa" />
                              <Flag on={row.has_proposal_made} label="Proposal" color="#38bdf8" />
                              <Flag on={row.has_submission_made} label="Submission" color="#f59e0b" />
                              <Flag on={row.has_loan_funded} label="Funded" color="#22c55e" />
                              <Flag on={row.has_manual_dq === true} label="DQ" color="#f87171" />
                            </>
                          )}
                        </div>
                      </td>
                      <td
                        className="px-4 py-2.5 whitespace-nowrap text-xs max-w-[8rem] truncate"
                        style={{ color: "#94a3b8" }}
                        title={row.lead_source ?? undefined}
                      >
                        {row.lead_source ?? "—"}
                      </td>
                      <td
                        className="px-4 py-2.5 text-xs max-w-[14rem] truncate"
                        style={{ color: "#cbd5e1" }}
                        title={row.ad_name ?? undefined}
                      >
                        {row.ad_name ?? "—"}
                      </td>
                      <td
                        className="px-4 py-2.5 text-xs max-w-[10rem] truncate"
                        style={{ color: "#94a3b8" }}
                        title={row.utm_term ?? undefined}
                      >
                        {row.utm_term ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <CountPill label="dials" value={c.dials} />
                          <CountPill label="booked" value={c.appointments_booked} accent="#38bdf8" />
                          <CountPill label="shows" value={c.shows} accent="#22c55e" />
                          <CountPill label="no-shows" value={c.no_shows} accent="#f87171" />
                          <CountPill label="LO bailed" value={c.lo_bailed} accent="#fb923c" />
                          <CountPill label="cancelled" value={c.cancellations} />
                          <CountPill label="funded" value={c.funded_loans} accent="#f59e0b" />
                          <CountPill label="submissions" value={c.submissions_made} />
                          <CountPill label="callbacks" value={c.callbacks} />
                          <CountPill label="claimed" value={c.claimed} accent="#f59e0b" />
                          <CountPill label="proposals" value={c.proposals_made} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.loan_amount ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.property_value ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.ltv != null ? `${row.ltv}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.state ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.b1_age ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.b2_age ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums" style={{ color: "#94a3b8" }}>
                        {row.credit_score_range ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: "#94a3b8" }}>
                        {row.property_use ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "#94a3b8" }}>
                        {fmtPhone(row.lead_phone)}
                      </td>
                      <td
                        className="px-4 py-2.5 whitespace-nowrap text-xs max-w-[10rem] truncate"
                        style={{ color: "#94a3b8" }}
                        title={row.lead_email ?? undefined}
                      >
                        {row.lead_email ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: "#64748b" }}>
                        {isUnmappedView && unmapped
                          ? fmtDate(unmapped.last_activity, false)
                          : fmtDate(row.created_at, false)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-sm" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const url = ghlContactUrl(row);
                          return url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                              style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#60a5fa" }}
                            >
                              Open in GHL ↗
                            </a>
                          ) : (
                            <span className="text-xs" style={{ color: "#334155" }}>—</span>
                          );
                        })()}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={20} className="px-0 py-0" style={{ background: "#070f1a" }}>
                          <table className="w-full">
                            <thead>
                              <tr>
                                {["When", "Event", "Details", "Recording"].map((label) => (
                                  <th
                                    key={label}
                                    className={`${label === "When" ? "px-8" : "px-4"} py-2 text-left text-[10px] uppercase tracking-wider`}
                                    style={{ color: "#334155" }}
                                  >
                                    {label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {row.timeline.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-8 py-4 text-xs" style={{ color: "#334155" }}>
                                    No events
                                  </td>
                                </tr>
                              ) : (
                                row.timeline.map((item) => <TimelineRow key={item.id} item={item} />)
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 transition-colors"
            style={{
              background: "#0f2040",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "#94a3b8",
            }}
          >
            ← Prev
          </button>
          <span className="text-sm" style={{ color: "#334155" }}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 transition-colors"
            style={{
              background: "#0f2040",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "#94a3b8",
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
