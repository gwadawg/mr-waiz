"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReportingTypeBadge from "@/components/ReportingTypeBadge";
import ClientSitesCell from "@/components/ClientSitesCell";
import { lifecycleStatusLabel } from "@/lib/client-feedback";
import { normalizeReportingType, type ReportingType } from "@/lib/kpi-layouts";
import { REPORTING_TYPE_META, REPORTING_TYPES } from "@/lib/reporting-types";
import { rollupDailyAdspend, type StateLookerClient, type StateLookerResult } from "@/lib/state-looker";
import { US_STATES } from "@/lib/us-states";

type LifecycleFilter = "active" | "all";
type TabKey = "directory" | "media_buying" | "state_lookup";

const TABS: { key: TabKey; label: string }[] = [
  { key: "directory", label: "All clients" },
  { key: "media_buying", label: "Media Buying" },
  { key: "state_lookup", label: "State lookup" },
];

function passesFilters(
  client: StateLookerClient,
  lifecycleFilter: LifecycleFilter,
  offerFilter: ReportingType | "all",
  liveOnly: boolean,
  liveTransferOnly: boolean,
  clientQuery: string,
): boolean {
  if (lifecycleFilter === "active" && client.lifecycle_status !== "active") return false;
  if (offerFilter !== "all" && normalizeReportingType(client.reporting_type) !== offerFilter) return false;
  if (liveOnly && !client.is_live) return false;
  if (liveTransferOnly && !client.live_transfer_approved) return false;
  const q = clientQuery.trim().toLowerCase();
  if (q) {
    const haystack = [
      client.name,
      client.account_display_name,
      client.company_name,
      client.brokerage_name,
      client.nmls,
      client.city,
      client.state,
      client.offer_blurb,
      client.website,
      client.phone_live_transfer,
      client.facebook_page_name,
      client.instagram_handle,
      client.ad_account_name,
      client.website,
      client.landing_page_url,
      client.funnel_url,
      ...client.states_licensed,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function formatLocation(client: StateLookerClient): string {
  if (client.city && client.state) return `${client.city}, ${client.state}`;
  return client.city || client.state || "—";
}

function websiteHref(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function stateLabel(code: string): string {
  return US_STATES.find(s => s.code === code)?.name ?? code;
}

function StatesDropdown({
  codes,
  highlight,
  open,
  onToggle,
}: {
  codes: string[];
  highlight?: string;
  open: boolean;
  onToggle: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPos(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 200;
    const left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < 220 ? Math.max(8, rect.top - 8 - Math.min(224, codes.length * 28 + 8)) : rect.bottom + 4;
    setMenuPos({ top, left: Math.max(8, left) });
  }, [open, codes.length]);

  if (!codes.length) {
    return <span style={{ color: "#475569" }}>—</span>;
  }

  const label =
    codes.length === 1
      ? codes[0]
      : highlight && codes.includes(highlight)
        ? `${highlight} · ${codes.length}`
        : `${codes.length} states`;

  return (
    <div className="relative" data-states-dropdown>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md whitespace-nowrap transition-colors"
        style={{
          color: open ? "#e2e8f0" : "#94a3b8",
          background: open ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${open ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)"}`,
        }}
        aria-expanded={open}
      >
        {label}
        <span style={{ color: "#64748b", fontSize: 9 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && menuPos && (
        <div
          data-states-dropdown
          className="fixed z-50 min-w-[180px] max-h-56 overflow-y-auto rounded-lg py-1 shadow-xl"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            background: "#0f2040",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {codes.map(code => (
            <div
              key={code}
              className="px-3 py-1.5 text-xs flex items-center justify-between gap-3"
              style={{
                color: code === highlight ? "#fbbf24" : "#cbd5e1",
                background: code === highlight ? "rgba(251,191,36,0.08)" : undefined,
              }}
            >
              <span className="font-semibold">{code}</span>
              <span style={{ color: "#64748b" }}>{stateLabel(code)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCell({ client }: { client: StateLookerClient }) {
  if (!client.company_name && !client.brokerage_name) {
    return <span style={{ color: "#334155" }}>—</span>;
  }

  const title = [client.company_name, client.brokerage_name ? `Brokerage: ${client.brokerage_name}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="block truncate text-xs max-w-[160px]" style={{ color: "#e2e8f0" }} title={title}>
      {client.company_name ?? client.brokerage_name}
      {client.company_name && client.brokerage_name ? (
        <span style={{ color: "#64748b" }}> · {client.brokerage_name}</span>
      ) : null}
    </span>
  );
}

function LiveTransferBadge({ approved }: { approved: boolean }) {
  return (
    <span
      className="inline-flex text-[11px] font-semibold px-1.5 py-0.5 rounded"
      style={{
        color: approved ? "#34d399" : "#64748b",
        background: approved ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.04)",
      }}
    >
      {approved ? "Yes" : "No"}
    </span>
  );
}

function groupClientsByOffer(clients: StateLookerClient[]): {
  type: ReportingType;
  clients: StateLookerClient[];
}[] {
  const buckets = new Map<ReportingType, StateLookerClient[]>();
  for (const type of REPORTING_TYPES) buckets.set(type, []);

  for (const client of clients) {
    const type = normalizeReportingType(client.reporting_type);
    buckets.get(type)!.push(client);
  }

  return REPORTING_TYPES
    .map(type => ({
      type,
      clients: [...(buckets.get(type) ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter(group => group.clients.length > 0);
}

function ClientDirectoryTable({
  clients,
  selectedState,
  emptyMessage,
  groupByOffer = false,
}: {
  clients: StateLookerClient[];
  selectedState?: string;
  emptyMessage: string;
  groupByOffer?: boolean;
}) {
  const [openStatesId, setOpenStatesId] = useState<string | null>(null);

  useEffect(() => {
    if (!openStatesId) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-states-dropdown]")) return;
      setOpenStatesId(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openStatesId]);

  const groups = useMemo(() => {
    if (!groupByOffer) {
      return [{ type: null as ReportingType | null, clients: [...clients].sort((a, b) => a.name.localeCompare(b.name)) }];
    }
    return groupClientsByOffer(clients).map(g => ({ type: g.type as ReportingType | null, clients: g.clients }));
  }, [clients, groupByOffer]);

  if (!clients.length) {
    return (
      <div
        className="rounded-xl px-6 py-16 text-center text-sm"
        style={{ border: "1px solid rgba(255,255,255,0.06)", color: "#64748b" }}
      >
        {emptyMessage}
      </div>
    );
  }

  const headers = [
    { key: "client", label: "Client" },
    { key: "company", label: "Company" },
    { key: "nmls", label: "NMLS #" },
    { key: "lt", label: "Live transfers" },
    { key: "offer", label: "Offer" },
    { key: "website", label: "Personal website" },
    { key: "location", label: "Location" },
    { key: "phone", label: "LT phone" },
    { key: "states", label: "Licensed states" },
    { key: "ghl", label: "GHL" },
  ];
  const colCount = headers.length;

  function renderClientRow(client: StateLookerClient, isLast: boolean) {
    return (
      <tr
        key={client.id}
        className="transition-colors hover:bg-white/[0.02]"
        style={{
          borderBottom: isLast ? undefined : "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <td className="px-3 py-1.5 align-middle">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="font-medium text-sm truncate"
              style={{ color: "#f1f5f9" }}
              title={
                client.account_display_name &&
                client.account_display_name !== client.company_name
                  ? `${client.name} · ${client.account_display_name}`
                  : client.name
              }
            >
              {client.name}
            </span>
            {!groupByOffer && <ReportingTypeBadge value={client.reporting_type} />}
            {client.lifecycle_status !== "active" && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                style={{ color: "#fbbf24", background: "rgba(251,191,36,0.1)" }}
              >
                {lifecycleStatusLabel(client.lifecycle_status)}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-1.5 align-middle">
          <CompanyCell client={client} />
        </td>
        <td className="px-3 py-1.5 align-middle whitespace-nowrap text-xs font-mono" style={{ color: client.nmls ? "#e2e8f0" : "#334155" }}>
          {client.nmls || "—"}
        </td>
        <td className="px-3 py-1.5 align-middle whitespace-nowrap">
          <LiveTransferBadge approved={client.live_transfer_approved} />
        </td>
        <td className="px-3 py-1.5 align-middle">
          <span
            className="block text-xs truncate"
            style={{ color: "#cbd5e1" }}
            title={client.offer_blurb}
          >
            {client.offer_blurb}
          </span>
        </td>
        <td className="px-3 py-1.5 align-middle">
          {client.website ? (
            <a
              href={websiteHref(client.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs truncate underline-offset-2 hover:underline"
              style={{ color: "#38bdf8" }}
              title={client.website}
            >
              {client.website.replace(/^https?:\/\//i, "")}
            </a>
          ) : (
            <span style={{ color: "#334155" }}>—</span>
          )}
        </td>
        <td className="px-3 py-1.5 align-middle whitespace-nowrap text-xs truncate" style={{ color: "#94a3b8" }}>
          {formatLocation(client)}
        </td>
        <td className="px-3 py-1.5 align-middle whitespace-nowrap text-xs">
          {client.phone_live_transfer ? (
            <a
              href={`tel:${client.phone_live_transfer}`}
              className="truncate block"
              style={{
                color: client.live_transfer_approved ? "#e2e8f0" : "#64748b",
              }}
              title={
                client.live_transfer_approved
                  ? client.phone_live_transfer
                  : "Live transfers not approved for this client"
              }
            >
              {client.phone_live_transfer}
            </a>
          ) : (
            <span style={{ color: "#334155" }}>—</span>
          )}
        </td>
        <td className="px-3 py-1.5 align-middle">
          <StatesDropdown
            codes={client.states_licensed}
            highlight={selectedState}
            open={openStatesId === client.id}
            onToggle={() =>
              setOpenStatesId(prev => (prev === client.id ? null : client.id))
            }
          />
        </td>
        <td className="px-3 py-1.5 align-middle whitespace-nowrap">
          {client.ghl_subaccount_url ? (
            <a
              href={client.ghl_subaccount_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
              style={{ color: "#38bdf8" }}
              title="Open GHL subaccount"
            >
              Open
              <span aria-hidden style={{ fontSize: 10 }}>↗</span>
            </a>
          ) : (
            <span style={{ color: "#334155" }}>—</span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse table-fixed min-w-[1120px]">
          <colgroup>
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {headers.map(h => (
                <th
                  key={h.key}
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-left"
                  style={{ color: "#64748b", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => {
              const meta = group.type ? REPORTING_TYPE_META[group.type] : null;
              return (
                <Fragment key={group.type ?? "all"}>
                  {groupByOffer && meta && (
                    <tr>
                      <td
                        colSpan={colCount}
                        className="px-3 py-2"
                        style={{
                          background: meta.background,
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <ReportingTypeBadge value={group.type} />
                          <span className="text-xs font-semibold" style={{ color: meta.color }}>
                            {meta.label}
                          </span>
                          <span className="text-[11px]" style={{ color: "#64748b" }}>
                            {group.clients.length} client{group.clients.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {group.clients.map((client, idx) =>
                    renderClientRow(client, idx === group.clients.length - 1),
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MediaLinkCell({
  href,
  label,
  title,
}: {
  href: string | null;
  label: string;
  title?: string | null;
}) {
  if (!href) {
    return <span style={{ color: "#334155" }}>—</span>;
  }
  const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-xs truncate underline-offset-2 hover:underline"
      style={{ color: "#38bdf8" }}
      title={title || href}
    >
      {label}
    </a>
  );
}

function formatDailyAdspend(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return `$${Math.round(amount).toLocaleString()}/day`;
}

function MediaBuyingTable({
  clients,
  emptyMessage,
  selectedState,
}: {
  clients: StateLookerClient[];
  emptyMessage: string;
  selectedState?: string | null;
}) {
  const [openStatesId, setOpenStatesId] = useState<string | null>(null);
  const rollup = useMemo(() => rollupDailyAdspend(clients), [clients]);

  // Sheet-aligned media ops + compact Sites group for the four web URLs.
  const headers = [
    { key: "client", label: "Client" },
    { key: "offer", label: "Offer" },
    { key: "page", label: "Facebook page" },
    { key: "ig", label: "Instagram" },
    { key: "ad_name", label: "Ad account name" },
    { key: "ad_link", label: "Ad account link" },
    { key: "spend", label: "Daily adspend" },
    { key: "broker", label: "Company / broker" },
    { key: "nmls", label: "Company NMLS" },
    { key: "states", label: "States" },
    { key: "sites", label: "Sites" },
  ];

  if (clients.length === 0) {
    return (
      <div
        className="rounded-xl px-6 py-10 text-sm text-center"
        style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#64748b" }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[1400px]">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {headers.map(h => (
                <th
                  key={h.key}
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-left"
                  style={{ color: "#64748b", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((client, idx) => (
              <tr
                key={client.id}
                className="transition-colors hover:bg-white/[0.02]"
                style={{
                  borderBottom: idx === clients.length - 1 ? undefined : "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <td className="px-3 py-1.5 align-middle">
                  <span
                    className="font-medium text-sm truncate block max-w-[12rem]"
                    style={{ color: "#f1f5f9" }}
                    title={client.name}
                  >
                    {client.name}
                  </span>
                </td>
                <td className="px-3 py-1.5 align-middle whitespace-nowrap">
                  <ReportingTypeBadge value={client.reporting_type} />
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <span
                    className="block text-xs truncate max-w-[12rem]"
                    style={{ color: client.facebook_page_name ? "#cbd5e1" : "#334155" }}
                    title={client.facebook_page_name ?? undefined}
                  >
                    {client.facebook_page_name || "—"}
                  </span>
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <span
                    className="block text-xs truncate max-w-[8rem]"
                    style={{ color: client.instagram_handle ? "#cbd5e1" : "#334155" }}
                    title={client.instagram_handle ?? undefined}
                  >
                    {client.instagram_handle || "—"}
                  </span>
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <span
                    className="block text-xs truncate max-w-[10rem]"
                    style={{ color: client.ad_account_name ? "#cbd5e1" : "#334155" }}
                    title={client.ad_account_name ?? undefined}
                  >
                    {client.ad_account_name || "—"}
                  </span>
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <MediaLinkCell
                    href={client.ad_account_url}
                    label={client.ad_account_url ? "Open ↗" : "—"}
                    title={client.ad_account_url}
                  />
                </td>
                <td
                  className="px-3 py-1.5 align-middle whitespace-nowrap text-xs"
                  style={{ color: client.daily_adspend != null ? "#cbd5e1" : "#334155" }}
                >
                  {client.daily_adspend != null ? (
                    formatDailyAdspend(client.daily_adspend)
                  ) : client.lifecycle_status === "active" ? (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ color: "#fbbf24", background: "rgba(251,191,36,0.14)" }}
                      title="No daily adspend on file, so this client is left out of the rollup"
                    >
                      Not set
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <span
                    className="block text-xs truncate max-w-[10rem]"
                    style={{ color: client.brokerage_name ? "#cbd5e1" : "#334155" }}
                    title={client.brokerage_name ?? undefined}
                  >
                    {client.brokerage_name || "—"}
                  </span>
                </td>
                <td
                  className="px-3 py-1.5 align-middle whitespace-nowrap text-xs font-mono"
                  style={{ color: client.nmls ? "#e2e8f0" : "#334155" }}
                >
                  {client.nmls || "—"}
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <StatesDropdown
                    codes={client.states_licensed}
                    highlight={selectedState ?? undefined}
                    open={openStatesId === client.id}
                    onToggle={() =>
                      setOpenStatesId(prev => (prev === client.id ? null : client.id))
                    }
                  />
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <ClientSitesCell
                    urls={{
                      website: client.website,
                      landing_page_url: client.landing_page_url,
                      funnel_url: client.funnel_url,
                      thank_you_page_url: client.thank_you_page_url,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              <td
                colSpan={6}
                className="px-3 py-2 text-xs"
                style={{ color: "#94a3b8", borderTop: "1px solid rgba(255,255,255,0.08)" }}
              >
                Rolled up across {clients.length} client{clients.length === 1 ? "" : "s"}
                {rollup.missing > 0
                  ? ` · ${rollup.missing} ${rollup.missing === 1 ? "has" : "have"} no budget`
                  : ""}
              </td>
              <td
                className="px-3 py-2 whitespace-nowrap text-xs font-semibold"
                style={{ color: "#e2e8f0", borderTop: "1px solid rgba(255,255,255,0.08)" }}
                title="Sum of each listed client's daily adspend"
              >
                {formatDailyAdspend(rollup.total)}
              </td>
              <td colSpan={4} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors"
      style={{
        color: active ? "#e2e8f0" : "#64748b",
        background: active ? "rgba(255,255,255,0.07)" : "transparent",
        border: `1px solid ${active ? "rgba(255,255,255,0.14)" : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}

function DirectoryFilters({
  clientQuery,
  setClientQuery,
  lifecycleFilter,
  setLifecycleFilter,
  offerFilter,
  setOfferFilter,
  liveOnly,
  setLiveOnly,
  liveTransferOnly,
  setLiveTransferOnly,
  filteredClients,
}: {
  clientQuery: string;
  setClientQuery: (v: string) => void;
  lifecycleFilter: LifecycleFilter;
  setLifecycleFilter: (v: LifecycleFilter) => void;
  offerFilter: ReportingType | "all";
  setOfferFilter: (v: ReportingType | "all") => void;
  liveOnly: boolean;
  setLiveOnly: (v: boolean) => void;
  liveTransferOnly: boolean;
  setLiveTransferOnly: (v: boolean) => void;
  filteredClients: StateLookerClient[];
}) {
  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-col gap-3"
      style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
    >
      <input
        type="search"
        value={clientQuery}
        onChange={e => setClientQuery(e.target.value)}
        placeholder="Search clients, company, city, phone…"
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{
          background: "#0f2040",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "#e2e8f0",
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>
          Status
        </span>
        <FilterChip active={lifecycleFilter === "active"} onClick={() => setLifecycleFilter("active")}>
          Active only
        </FilterChip>
        <FilterChip active={lifecycleFilter === "all"} onClick={() => setLifecycleFilter("all")}>
          All
        </FilterChip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>
          Offer
        </span>
        <FilterChip active={offerFilter === "all"} onClick={() => setOfferFilter("all")}>
          All verticals
        </FilterChip>
        {REPORTING_TYPES.map(type => {
          const active = offerFilter === type;
          const meta = REPORTING_TYPE_META[type];
          const count = filteredClients.filter(
            c => normalizeReportingType(c.reporting_type) === type,
          ).length;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setOfferFilter(type)}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5"
              style={{
                color: active ? meta.color : "#64748b",
                background: active ? meta.background : "transparent",
                border: `1px solid ${active ? `${meta.color}55` : "transparent"}`,
              }}
              title={meta.description}
            >
              {meta.shortLabel}
              <span style={{ color: active ? meta.color : "#475569" }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "#94a3b8" }}>
          <input
            type="checkbox"
            checked={liveOnly}
            onChange={e => setLiveOnly(e.target.checked)}
            className="rounded"
          />
          Live clients only
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "#94a3b8" }}>
          <input
            type="checkbox"
            checked={liveTransferOnly}
            onChange={e => setLiveTransferOnly(e.target.checked)}
            className="rounded"
          />
          Accepts live transfers
        </label>
      </div>
    </div>
  );
}

export default function StateLooker() {
  const [data, setData] = useState<StateLookerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("directory");
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [stateQuery, setStateQuery] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("active");
  const [offerFilter, setOfferFilter] = useState<ReportingType | "all">("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [liveTransferOnly, setLiveTransferOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/state-looker")
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<StateLookerResult>;
      })
      .then(result => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load client directory");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clientById = useMemo(() => {
    const map = new Map<string, StateLookerClient>();
    for (const client of data?.clients ?? []) map.set(client.id, client);
    return map;
  }, [data]);

  const filteredClients = useMemo(() => {
    return (data?.clients ?? []).filter(c =>
      passesFilters(c, lifecycleFilter, offerFilter, liveOnly, liveTransferOnly, clientQuery),
    );
  }, [data, lifecycleFilter, offerFilter, liveOnly, liveTransferOnly, clientQuery]);

  const filteredIds = useMemo(() => new Set(filteredClients.map(c => c.id)), [filteredClients]);

  const stateRows = useMemo(() => {
    const q = stateQuery.trim().toLowerCase();
    return US_STATES.map(state => {
      const ids = (data?.by_state[state.code] ?? []).filter(id => filteredIds.has(id));
      return { ...state, count: ids.length, clientIds: ids };
    }).filter(state => {
      if (!q) return true;
      return state.name.toLowerCase().includes(q) || state.code.toLowerCase().includes(q);
    });
  }, [data, filteredIds, stateQuery]);

  const selectedStateMeta = selectedState
    ? US_STATES.find(s => s.code === selectedState)
    : undefined;

  const selectedClients = useMemo(() => {
    if (!selectedState) return [];
    const ids = data?.by_state[selectedState] ?? [];
    return ids
      .map(id => clientById.get(id))
      .filter((c): c is StateLookerClient =>
        !!c && passesFilters(c, lifecycleFilter, offerFilter, liveOnly, liveTransferOnly, clientQuery),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedState, data, clientById, lifecycleFilter, offerFilter, liveOnly, liveTransferOnly, clientQuery]);

  const directoryClients = useMemo(() => {
    return [...filteredClients].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredClients]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: "#64748b" }}>
        Loading client directory…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl px-6 py-8 text-sm text-center"
        style={{ border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "#e2e8f0" }}>
          Client directory
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>
          {tab === "media_buying"
            ? "Meta pages, ad accounts, daily adspend, landers, and licensed states for media buying — no billing emails or confidential CRM fields."
            : tab === "state_lookup"
              ? "Find which clients are licensed in each state."
              : "Company, offer, website, location, and live-transfer details for the team — no billing or confidential CRM fields."}
        </p>
      </div>

      <div className="flex items-center gap-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {TABS.map(t => {
          const active = tab === t.key;
          const count =
            t.key === "state_lookup"
              ? data?.summary.states_covered ?? 0
              : directoryClients.length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="px-4 py-2.5 text-sm font-semibold -mb-px transition-colors flex items-center gap-2"
              style={{
                color: active ? "#e2e8f0" : "#64748b",
                borderBottom: `2px solid ${active ? "#38bdf8" : "transparent"}`,
              }}
            >
              {t.label}
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{
                  color: active ? "#94a3b8" : "#475569",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <DirectoryFilters
        clientQuery={clientQuery}
        setClientQuery={setClientQuery}
        lifecycleFilter={lifecycleFilter}
        setLifecycleFilter={setLifecycleFilter}
        offerFilter={offerFilter}
        setOfferFilter={setOfferFilter}
        liveOnly={liveOnly}
        setLiveOnly={setLiveOnly}
        liveTransferOnly={liveTransferOnly}
        setLiveTransferOnly={setLiveTransferOnly}
        filteredClients={filteredClients}
      />

      {tab === "directory" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "#64748b" }}>
            {directoryClients.length} client{directoryClients.length === 1 ? "" : "s"}
            {lifecycleFilter === "active" ? " · active only" : ""}
          </p>
          <ClientDirectoryTable
            clients={directoryClients}
            emptyMessage="No clients match the current filters."
            groupByOffer
          />
        </div>
      ) : tab === "media_buying" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "#64748b" }}>
            {directoryClients.length} client{directoryClients.length === 1 ? "" : "s"}
            {lifecycleFilter === "active" ? " · active only" : ""}
            {" · media buying"}
          </p>
          <MediaBuyingTable
            clients={directoryClients}
            emptyMessage="No clients match the current filters."
          />
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div
            className="w-full lg:w-72 shrink-0 flex flex-col rounded-xl overflow-hidden max-h-[420px] lg:max-h-[calc(100vh-220px)] lg:sticky lg:top-0"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="px-3 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <input
                type="search"
                value={stateQuery}
                onChange={e => setStateQuery(e.target.value)}
                placeholder="Search states…"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: "#0f2040",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#e2e8f0",
                }}
              />
              <p className="mt-2 text-[11px]" style={{ color: "#64748b" }}>
                {data?.summary.states_covered ?? 0} states covered · {filteredClients.length} clients
              </p>
            </div>
            <div className="overflow-y-auto flex-1">
              {stateRows.map(state => {
                const active = selectedState === state.code;
                const dimmed = state.count === 0;
                return (
                  <button
                    key={state.code}
                    type="button"
                    onClick={() => setSelectedState(state.code)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: active ? "rgba(56,189,248,0.1)" : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      opacity: dimmed ? 0.45 : 1,
                    }}
                  >
                    <span className="text-sm truncate" style={{ color: active ? "#38bdf8" : "#e2e8f0" }}>
                      <span className="font-semibold mr-2" style={{ color: active ? "#7dd3fc" : "#64748b" }}>
                        {state.code}
                      </span>
                      {state.name}
                    </span>
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        color: state.count > 0 ? "#34d399" : "#475569",
                        background: state.count > 0 ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.04)",
                      }}
                    >
                      {state.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3 w-full">
            {selectedState ? (
              <>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: "#e2e8f0" }}>
                    {selectedStateMeta?.name ?? selectedState}
                  </h2>
                  <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>
                    {selectedClients.length} client{selectedClients.length === 1 ? "" : "s"} licensed in{" "}
                    {selectedStateMeta?.code ?? selectedState}
                  </p>
                </div>
                <ClientDirectoryTable
                  clients={selectedClients}
                  selectedState={selectedState}
                  emptyMessage={`No clients licensed in ${selectedStateMeta?.name ?? selectedState} with the current filters.`}
                  groupByOffer
                />
              </>
            ) : (
              <div
                className="rounded-xl px-6 py-16 text-center text-sm flex-1 flex items-center justify-center"
                style={{ border: "1px solid rgba(255,255,255,0.06)", color: "#64748b" }}
              >
                Select a state to see which clients are licensed there.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
