"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useState, type ComponentType } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ClientSelect from "./ClientSelect";
import { type SparkMap } from "./kpi/KpiSections";
import type { CostTrendPoint, KpiTimelineBucket, MetricsResult } from "@/lib/metrics";
import type { DialPool } from "@/lib/dial-pool";
import {
  DEFAULT_REPORTING_TYPE,
  normalizeReportingType,
  type ReportingType,
} from "@/lib/kpi-layouts";
import {
  NAV,
  NAV_GROUPS,
  LEGACY_VIEW_REDIRECTS,
  CLIENT_WORKSPACE_TABS,
  CLIENT_WORKSPACE_TAB_PERMISSIONS,
  isClientWorkspaceTab,
  defaultTabForHub,
  isHubView,
  tabLabelForHub,
  HUB_TAB_LABELS,
  type View,
  type HubView,
  type ClientWorkspaceTab,
  type AcquisitionTab,
  type AcquisitionDataExplorerTab,
  type AcquisitionKpiTab,
  type AgentsTab,
  type ClientSuccessTab,
  type TeamDashboardTab,
  TEAM_COMMAND_LEGACY_REDIRECTS,
  TEAM_COMMAND_DEFAULT_SEAT,
  resolveViewFromParams,
} from "@/lib/nav";
import { hasPermission, canViewClientRevenue, canAccessAutomations, type AllowedPermissions } from "@/lib/permissions";
import DateRangeFilter from "./DateRangeFilter";
import GlassPane from "./ui/GlassPane";
import ClientWorkspaceHub from "./client-workspace/ClientWorkspaceHub";
import {
  isSingleClientId,
  LIVE_SCOPE,
  useDashboardFilters,
  type DashboardClient,
} from "@/lib/use-dashboard-filters";
import { cachedJsonFetch, peekCachedJson } from "@/lib/client-fetch-cache";
import { hasTeamCommandPermission } from "@/lib/team-dashboards/access";
import {
  conversionExplorerNav,
  type ExplorerConv,
} from "@/lib/conversion-explorer";

function TabLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 gap-3 text-[var(--color-ws-text-ghost)]">
      <svg className="ws-spinner w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function lazyTab<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  label?: string,
) {
  return dynamic(loader, {
    loading: () => <TabLoading label={label} />,
  });
}

const AgentAdmin = lazyTab(() => import("./AgentAdmin"));
const OfferCatalogManager = lazyTab(() => import("./OfferCatalogManager"));
const ClientCallsBrowser = lazyTab(() => import("./ClientCallsBrowser"));
const AcquisitionHub = lazyTab(() => import("./hubs/AcquisitionHub"));
const AcquisitionKpiHub = lazyTab(() => import("./hubs/AcquisitionKpiHub"));
const AcquisitionDataExplorerHub = lazyTab(() => import("./hubs/AcquisitionDataExplorerHub"));
const AgentsHub = lazyTab(() => import("./hubs/AgentsHub"));
const ClientSuccessHub = lazyTab(() => import("./hubs/ClientSuccessHub"));
const ClientCompareDashboard = lazyTab(() => import("./ClientCompareDashboard"));
const ClientRoster = lazyTab(() => import("./ClientRoster"));
const BillingManager = lazyTab(() => import("./BillingManager"));
const AgentPayrollReport = lazyTab(() => import("./AgentPayrollReport"));
const UserManager = lazyTab(() => import("./UserManager"));
const FunnelSimulatorHub = lazyTab(() => import("./FunnelSimulatorHub"));
const ClientReportBuilder = lazyTab(() => import("./ClientReportBuilder"));
const TeamCommandDashboard = lazyTab(
  () => import("./team-dashboards/TeamCommandDashboard"),
  "Loading team command…",
);
const StateLooker = lazyTab(() => import("./StateLooker"));
const MediaBuyer = lazyTab(() => import("./MediaBuyer"));
const AcquisitionMarketing = lazyTab(() => import("./AcquisitionMarketing"));
const CeoDashboard = lazyTab(() => import("./CeoDashboard"));
const AcquisitionSalesReps = lazyTab(() => import("./AcquisitionSalesReps"));
const ResourcesLibrary = lazyTab(() => import("./ResourcesLibrary"), "Loading library…");
const ClosebotHub = lazyTab(() => import("./ClosebotHub"), "Loading Closebot…");
const CallLibrary = lazyTab(() => import("./CallLibrary"));
const TeamMeetings = lazyTab(() => import("./TeamMeetings"));
const AccountWeekPlansHub = lazyTab(() => import("./AccountWeekPlansHub"));
const AutomationsManager = lazyTab(() => import("./AutomationsManager"));
const DataChatPanel = dynamic(() => import("./DataChatPanel"), {
  loading: () => null,
  ssr: false,
});

type TrendsPayload = {
  granularity: "day" | "week";
  kpiSeries: KpiTimelineBucket[];
  series: CostTrendPoint[];
};

type Client = DashboardClient;

function DataChatLauncher(props: {
  startDate: string;
  endDate: string;
  clients: Client[];
  selectedClientId: string;
}) {
  const [ready, setReady] = useState(false);
  if (!ready) {
    return (
      <button
        type="button"
        onClick={() => setReady(true)}
        className="fixed bottom-5 right-5 z-40 min-h-11 rounded-pill px-4 text-sm font-semibold ws-glass ws-focus-ring text-[var(--color-ws-label)] active:scale-[0.98] transition-transform duration-med ease-ws"
        aria-label="Open data chat"
      >
        Data Chat
      </button>
    );
  }
  return <DataChatPanel {...props} defaultOpen />;
}

const LEGACY_VIEW_KEYS = new Set(Object.keys(LEGACY_VIEW_REDIRECTS));

function parseUrlView(searchParams: URLSearchParams): { view: View; tab: string | null } {
  const viewParam = searchParams.get("view");
  const tabParam = searchParams.get("tab");

  if (viewParam && LEGACY_VIEW_KEYS.has(viewParam)) {
    return resolveViewFromParams(viewParam, tabParam);
  }

  return resolveViewFromParams(viewParam, tabParam);
}

const NAV_ICONS: Record<View, string> = {
  // Panelled layout — the workspace holds several lenses on one client.
  client_workspace: "M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M4 9.5h16 M10 20V9.5",
  dashboard:     "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  kpi_simulator: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  client_report_builder: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  ceo:           "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  ceo_raw:       "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  dial_analytics:   "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  media_buyer:      "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
  client_health:    "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  client_compare:   "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  team_dashboard:   "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
  // Legacy keys retained for Record<View, string> completeness (redirected → team_dashboard).
  ops_overview:     "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
  team_dashboard_ccm: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2",
  team_dashboard_media: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z",
  heatmaps:      "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  data_explorer: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  state_looker:  "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
  acquisition_kpis: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  acquisition_marketing: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
  acquisition:   "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  acquisition_data_explorer: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  agents:        "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  resources:        "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  closebot_log:     "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  team_meetings:    "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  account_work:     "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  call_library:     "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z",
  admin_agents:     "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  admin_clients:    "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  admin_billing:    "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  admin_agent_payroll: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  admin_share:      "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z",
  admin_automations: "M13 10V3L4 14h7v7l9-11h-7z",
  admin_users:      "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  admin_offers:     "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  client_calls:     "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  acquisition_sales_reps:"M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
};

const DEFAULT_COLLAPSED_GROUPS = new Set<string>(["Admin"]);

const RAIL_STORAGE_KEY = "mw.workspace.rail";

/** `?rail=` wins for shared links; otherwise remember the last choice. */
function resolveInitialRailOpen(params: URLSearchParams): boolean {
  const fromUrl = params.get("rail");
  if (fromUrl === "1") return true;
  if (fromUrl === "0") return false;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Map the KPI timeline buckets onto the metric keys their cards use, for sparklines. */
function buildSparkMap(series: KpiTimelineBucket[]): SparkMap {
  if (!series.length) return {};
  return {
    new_leads: series.map(b => b.leads),
    qualified_leads: series.map(b => b.qualified_leads),
    qualified_rate: series.map(b => b.lead_to_qual),
    booked_appointments: series.map(b => b.booked),
    shows: series.map(b => b.shows),
    no_shows: series.map(b => b.no_shows),
    show_pct: series.map(b => b.show_rate),
    net_show_pct: series.map(b => b.net_show_rate),
    booked_to_conversation_rate: series.map(b => b.booked_to_conversation_rate),
    appt_booking_rate: series.map(b => b.booking_rate),
    hand_raise_rate: series.map(b => b.hand_raise_rate),
    lead_booking_rate: series.map(b => b.lead_booking_rate),
    conversation_rate: series.map(b => b.conversation_rate),
    ad_spend: series.map(b => b.spend),
    cpl: series.map(b => b.cpl),
    cp_qualified: series.map(b => b.cpql),
    cp_conversation: series.map(b => b.cpconv),
  };
}

/** Equal-length window immediately before [start, end]. Returns null for unbounded ranges. */
function previousRange(start: string, end: string): { start: string; end: string } | null {
  if (!start || !end) return null;
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  const lengthDays = Math.floor((endMs - startMs) / 86400000) + 1;
  const prevEnd = new Date(startMs - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (lengthDays - 1) * 86400000);
  return { start: ymd(prevStart), end: ymd(prevEnd) };
}

function getDashboardScopeClients(clients: Client[], selectedClientId: string): Client[] {
  if (selectedClientId === LIVE_SCOPE) return clients.filter(c => c.is_live !== false);
  if (selectedClientId) return clients.filter(c => c.id === selectedClientId);
  return clients;
}

function resolveDashboardReportingType(clients: Client[], selectedClientId: string): ReportingType {
  const scopedClients = getDashboardScopeClients(clients, selectedClientId);
  const reportingTypes = new Set(scopedClients.map(c => normalizeReportingType(c.reporting_type)));
  return reportingTypes.size === 1 ? Array.from(reportingTypes)[0] : DEFAULT_REPORTING_TYPE;
}

type ClientWithToken = Client & { share_token?: string };

function ShareReports({ clients }: { clients: Client[] }) {
  const [enriched, setEnriched] = useState<ClientWithToken[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => setEnriched(d.clients ?? []));
  }, []);

  function getUrl(token: string) {
    return `${window.location.origin}/report/${token}`;
  }

  function handleCopy(token: string) {
    navigator.clipboard.writeText(getUrl(token));
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Share Reports</h2>
        <p className="text-sm mt-0.5" style={{ color: "#475569" }}>
          Each client has a unique read-only report link — no login required
        </p>
      </div>
      <div className="space-y-3">
        {(enriched.length ? enriched : clients).map((c: ClientWithToken) => (
          <div key={c.id} className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{c.name}</p>
              {c.share_token && (
                <p className="text-xs mt-0.5 font-mono truncate max-w-xs" style={{ color: "#334155" }}>
                  {getUrl(c.share_token)}
                </p>
              )}
            </div>
            {c.share_token && (
              <button onClick={() => handleCopy(c.share_token!)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors"
                style={copied === c.share_token
                  ? { background: "rgba(52,211,153,0.15)", color: "#34d399" }
                  : { background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                {copied === c.share_token ? "✓ Copied!" : "Copy Link"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type DashboardViewProps = {
  isOwner?: boolean;
  isAdmin?: boolean;
  allowedPermissions?: AllowedPermissions;
  /** Role home when URL has no view — e.g. CCM → team_dashboard */
  homeView?: View | null;
  /** Role default seat inside Team Command (ccm | media | ops). */
  homeSeat?: TeamDashboardTab | null;
  /** Server-prefetched client list so the dropdown is ready on first paint. */
  initialClients?: Client[];
};

export default function DashboardView({
  isOwner = false,
  isAdmin = false,
  allowedPermissions = null,
  homeView = null,
  homeSeat = null,
  initialClients = [],
}: DashboardViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const canSee = (v: View) => {
    if (v === "client_calls") {
      return (
        hasPermission("client_calls", { isOwner, allowedPermissions })
        || hasPermission("admin_clients", { isOwner, allowedPermissions })
        || hasPermission("admin_billing", { isOwner, allowedPermissions })
      );
    }
    if (v === "admin_automations") {
      return canAccessAutomations({ isOwner, allowedPermissions });
    }
    // Unified Team Command — legacy seat keys grant access via permission aliases.
    if (v === "team_dashboard") {
      if (isOwner || isAdmin || homeView === "team_dashboard") return true;
      return hasTeamCommandPermission({ isOwner, allowedPermissions });
    }
    // Legacy view keys still resolve via URL redirects; keep permission symmetry.
    if (
      v === "team_dashboard_ccm" ||
      v === "team_dashboard_media" ||
      v === "ops_overview"
    ) {
      return canSee("team_dashboard");
    }
    return hasPermission(v, { isOwner, allowedPermissions });
  };
  const canViewRevenue = canViewClientRevenue({ isOwner, allowedPermissions });
  const visibleNav = NAV.filter(item => canSee(item.view));
  // Prefer non–Team Dashboards for fallback so leadership isn't forced onto CCM home.
  const firstVisibleView: View | undefined =
    visibleNav.find(item => item.group !== "Team Dashboards")?.view ?? visibleNav[0]?.view;

  const resolveAllowedView = (requested: View): View => {
    if (requested in TEAM_COMMAND_LEGACY_REDIRECTS) {
      return canSee("team_dashboard") ? "team_dashboard" : firstVisibleView ?? "team_dashboard";
    }
    if (canSee(requested)) return requested;
    return firstVisibleView ?? requested;
  };

  const resolveInitialView = (): View => {
    const viewParam = searchParams.get("view");
    if (!viewParam && homeView && canSee(homeView)) {
      return homeView;
    }
    const parsed = parseUrlView(searchParams);
    return resolveAllowedView(parsed.view);
  };

  const resolveInitialHubTab = (): string | null => {
    const viewParam = searchParams.get("view");
    if (!viewParam && homeView === "team_dashboard" && homeSeat) {
      return homeSeat;
    }
    const parsed = parseUrlView(searchParams);
    if (parsed.view === "team_dashboard" || (!viewParam && homeView === "team_dashboard")) {
      if (parsed.tab && HUB_TAB_LABELS.team_dashboard.some(t => t.key === parsed.tab)) {
        return parsed.tab;
      }
      return homeSeat ?? TEAM_COMMAND_DEFAULT_SEAT;
    }
    return parsed.tab;
  };

  const [view, setView] = useState<View>(() => resolveInitialView());
  const [hubTab, setHubTab] = useState<string | null>(() => resolveInitialHubTab());
  const [clients, setClients] = useState<Client[]>(initialClients);
  const filters = useDashboardFilters(clients);
  const {
    clientId: selectedClientId,
    offerScope,
    preset,
    customStart,
    customEnd,
    compare,
    dateStart,
    dateEnd,
    dateRangeLabel,
    sinceLaunchAvailable,
  } = filters;
  const [metrics, setMetrics] = useState<MetricsResult | null>(null);
  const [dialPool, setDialPool] = useState<DialPool | null>(null);
  const [prevMetrics, setPrevMetrics] = useState<MetricsResult | null>(null);
  const [sparkMap, setSparkMap] = useState<SparkMap | null>(null);
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [overduePending, setOverduePending] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED_GROUPS));
  const [workspaceSub, setWorkspaceSub] = useState<string | null>(() => searchParams.get("sub"));
  const [railOpen, setRailOpen] = useState<boolean>(() => resolveInitialRailOpen(searchParams));

  const goToView = (next: View, tab?: string | null) => {
    let target = resolveAllowedView(next);
    let nextTab = tab;

    // Normalize old Team Dashboard routes into the hub + seat tab.
    if (next in TEAM_COMMAND_LEGACY_REDIRECTS) {
      target = "team_dashboard";
      nextTab = TEAM_COMMAND_LEGACY_REDIRECTS[next];
    }

    setView(target);
    setSidebarOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", target);
    if (isHubView(target)) {
      const hub = target as HubView;
      const tabs = HUB_TAB_LABELS[hub];
      const candidate = nextTab ?? hubTab;
      const resolvedTab =
        candidate && tabs.some(t => t.key === candidate)
          ? candidate
          : hub === "team_dashboard"
            ? homeSeat ?? TEAM_COMMAND_DEFAULT_SEAT
            : defaultTabForHub(hub);
      setHubTab(resolvedTab);
      params.set("tab", resolvedTab);
    } else {
      setHubTab(null);
      params.delete("tab");
    }
    // Leaving a view abandons its nested selection.
    setWorkspaceSub(null);
    params.delete("sub");
    params.delete("appointment_id");
    params.delete("call_id");
    // Media Buyer owns these; a stale folder must not leak into another view.
    params.delete("mb");
    params.delete("folder");
    params.delete("sort");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setHubTabAndUrl = (tab: string) => {
    setHubTab(tab);
    setWorkspaceSub(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.set("tab", tab);
    // A stale nested selection from the previous tab would resolve to that
    // tab's default anyway; clearing it keeps the URL honest.
    params.delete("sub");
    // Tab-bar navigation is not a deep link — drop stale highlight targets so
    // revisiting Appointments / Sales Calls does not re-scroll to an old row.
    params.delete("appointment_id");
    params.delete("call_id");
    // Hub tab change resets Explorer to its default (Leads); drop stage +
    // table-local filters so they do not leak into the next tab.
    params.delete("conv");
    params.delete("q");
    params.delete("page");
    params.delete("status");
    params.delete("rows");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setWorkspaceSubAndUrl = (sub: string | null) => {
    // Legacy Explorer bookmarks used sub=conversions for the lead list.
    const canonical =
      hubTab === "explorer" && sub === "conversions" ? "leads" : sub;
    setWorkspaceSub(canonical);
    const params = new URLSearchParams(searchParams.toString());
    if (canonical) params.set("sub", canonical);
    else params.delete("sub");
    // Table-local filters must not leak across Explorer datasets.
    params.delete("q");
    params.delete("page");
    params.delete("status");
    params.delete("rows");
    // Stage filter belongs on Explorer → Leads only.
    if (!(hubTab === "explorer" && canonical === "leads")) {
      params.delete("conv");
    }
    params.delete("appointment_id");
    params.delete("call_id");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Non-persistent storage just means the rail resets next session.
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("rail", next ? "1" : "0");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Role homes: sync URL when landing with no view param.
  useEffect(() => {
    const viewParam = searchParams.get("view");
    if (viewParam || !homeView || !canSee(homeView)) return;
    if (view === homeView) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", homeView);
      if (homeView === "team_dashboard") {
        params.set("tab", homeSeat ?? TEAM_COMMAND_DEFAULT_SEAT);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const viewParam = searchParams.get("view");
    if (viewParam && LEGACY_VIEW_KEYS.has(viewParam)) {
      const redirect = LEGACY_VIEW_REDIRECTS[viewParam];
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", redirect.view);
      params.set("tab", redirect.tab);
      if (redirect.sub) params.set("sub", redirect.sub);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      return;
    }
    // Soft-redirect old Team Dashboard URLs to the unified hub.
    if (viewParam && viewParam in TEAM_COMMAND_LEGACY_REDIRECTS) {
      const seat = TEAM_COMMAND_LEGACY_REDIRECTS[viewParam];
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", "team_dashboard");
      params.set("tab", seat);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      return;
    }
    if (!viewParam && homeView && canSee(homeView)) {
      setView(current => (current === homeView ? current : homeView));
      if (homeView === "team_dashboard") {
        setHubTab(homeSeat ?? TEAM_COMMAND_DEFAULT_SEAT);
      } else {
        setHubTab(null);
      }
      return;
    }
    const parsed = parseUrlView(searchParams);
    const fromUrl = resolveAllowedView(parsed.view);
    setView(current => (current === fromUrl ? current : fromUrl));
    setHubTab(parsed.tab);
    {
      const rawSub = searchParams.get("sub");
      // Rewrite legacy Explorer ?sub=conversions bookmarks to Leads (keep conv=).
      if (parsed.tab === "explorer" && rawSub === "conversions") {
        const params = new URLSearchParams(searchParams.toString());
        params.set("sub", "leads");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        setWorkspaceSub("leads");
      } else {
        setWorkspaceSub(rawSub);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (initialClients.length) return;
    fetch("/api/clients").then(r => r.json()).then(d => setClients(d.clients ?? []));
  }, [initialClients.length]);

  const appendDashboardMetricsParams = (params: URLSearchParams) => {
    if (selectedClientId === LIVE_SCOPE) params.set("live_only", "true");
    else if (selectedClientId) params.set("client_id", selectedClientId);
    else if (offerScope) params.set("reporting_type", offerScope);
  };

  const applyTrendsPayload = (d: {
    error?: unknown;
    granularity?: string;
    kpiSeries?: KpiTimelineBucket[];
    series?: CostTrendPoint[];
  } | null) => {
    if (!d || d.error) {
      setTrendsError(
        d && typeof d.error === "string" ? d.error : "Failed to load trends",
      );
      setTrends(null);
      setSparkMap(null);
      return;
    }
    const kpiSeries = (d.kpiSeries ?? []) as KpiTimelineBucket[];
    setTrendsError("");
    setTrends({
      granularity: d.granularity === "week" ? "week" : "day",
      kpiSeries,
      series: (d.series ?? []) as CostTrendPoint[],
    });
    setSparkMap(buildSparkMap(kpiSeries));
  };

  // Single round-trip for KPIs + trends on the workspace (one events pull
  // server-side). KPI simulator still hits metrics only, so it skips trends.
  // Client cache keeps tab revisits warm.
  const wantsMetrics = view === "client_workspace" || view === "kpi_simulator";
  useEffect(() => {
    if (!wantsMetrics) return;

    const start = dateStart;
    const end = dateEnd;
    const wantTrends = view === "client_workspace" && Boolean(start && end);
    const params = new URLSearchParams();
    appendDashboardMetricsParams(params);
    if (start) params.set("start_date", start);
    if (end) params.set("end_date", end);
    if (wantTrends) params.set("include_trends", "1");

    const cacheKey = `metrics|${params.toString()}`;
    const url = `/api/metrics?${params}`;
    type Bundle = MetricsResult & {
      trends?: TrendsPayload | null;
      dial_pool?: DialPool | null;
      error?: string;
    };

    const paint = (d: Bundle) => {
      if (d.error) {
        setTrendsError(d.error);
        setMetrics(null);
        setDialPool(null);
        return;
      }
      setTrendsError("");
      const { trends: bundledTrends, dial_pool: nextPool, error: _ignored, ...rest } = d;
      setDialPool(nextPool ?? null);
      setMetrics(rest as MetricsResult);
      if (wantTrends) {
        applyTrendsPayload(bundledTrends ?? null);
      }
    };

    const peek = peekCachedJson<Bundle>(cacheKey);
    if (peek && !peek.error) {
      paint(peek);
      setMetricsLoading(false);
      setTrendsLoading(false);
    } else {
      setMetricsLoading(true);
      if (wantTrends) {
        setTrendsLoading(true);
        setTrendsError("");
      }
    }

    if (!wantTrends) {
      setSparkMap(null);
      setTrends(null);
      setTrendsError("");
      setTrendsLoading(false);
    }

    const ac = new AbortController();
    cachedJsonFetch<Bundle>(cacheKey, url, { signal: ac.signal, preferCache: true })
      .then(d => {
        if (ac.signal.aborted) return;
        paint(d);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setTrendsError("Failed to load metrics");
        setMetrics(null);
        setDialPool(null);
        if (wantTrends) {
          setTrends(null);
          setSparkMap(null);
        }
      })
      .finally(() => {
        if (ac.signal.aborted) return;
        setMetricsLoading(false);
        setTrendsLoading(false);
      });

    return () => ac.abort();
  }, [view, selectedClientId, offerScope, dateStart, dateEnd]);

  // Previous-period comparison: fetch the equal-length window immediately before
  // the current range so each KPI card can show a vs-prev delta.
  useEffect(() => {
    if (view !== "client_workspace" || !compare || preset === "all_time" || preset === "since_launch") {
      setPrevMetrics(null);
      return;
    }
    const prev = previousRange(dateStart, dateEnd);
    if (!prev) {
      setPrevMetrics(null);
      return;
    }
    const params = new URLSearchParams();
    appendDashboardMetricsParams(params);
    params.set("start_date", prev.start);
    params.set("end_date", prev.end);
    const cacheKey = `metrics|${params.toString()}`;
    const peek = peekCachedJson<MetricsResult>(cacheKey);
    if (peek && !("error" in peek && peek.error)) setPrevMetrics(peek);

    const ac = new AbortController();
    cachedJsonFetch<MetricsResult>(cacheKey, `/api/metrics?${params}`, {
      signal: ac.signal,
      preferCache: true,
    })
      .then(d => {
        if (!ac.signal.aborted) setPrevMetrics(d);
      })
      .catch(() => {
        if (!ac.signal.aborted) setPrevMetrics(null);
      });
    return () => ac.abort();
  }, [view, compare, selectedClientId, offerScope, preset, dateStart, dateEnd]);

  // Past-due, un-dispositioned appointment backlog. Deliberately keyed only on
  // the client selection (not the date preset) so it stays a running total.
  useEffect(() => {
    if (view !== "client_workspace") return;
    const params = new URLSearchParams();
    if (selectedClientId === LIVE_SCOPE) params.set("live_only", "true");
    else if (selectedClientId) params.set("client_id", selectedClientId);
    const cacheKey = `overdue|${params.toString()}`;
    const peek = peekCachedJson<{ count?: number }>(cacheKey);
    if (peek && typeof peek.count === "number") setOverduePending(peek.count);
    else setOverduePending(null);

    const ac = new AbortController();
    cachedJsonFetch<{ count?: number }>(cacheKey, `/api/metrics/overdue-appointments?${params}`, {
      signal: ac.signal,
      preferCache: true,
      staleTime: 60_000,
    })
      .then(d => {
        if (!ac.signal.aborted) setOverduePending(typeof d.count === "number" ? d.count : null);
      })
      .catch(() => {
        if (!ac.signal.aborted) setOverduePending(null);
      });
    return () => ac.abort();
  }, [view, selectedClientId]);

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const isAcquisition = view === "acquisition";
  const isAcquisitionDataExplorer = view === "acquisition_data_explorer";
  const isAgents = view === "agents";
  // The Client Workspace owns its own sticky filter bar, so it opts out of the
  // header controls rather than showing the range picker twice.
  const showDateFilters =
    view === "kpi_simulator"
    || isAcquisition
    || isAcquisitionDataExplorer
    || isAgents
    || view === "media_buyer"
    || view === "acquisition_marketing"
    || view === "client_calls"
    || view === "call_library";

  const navItem = NAV.find(n => n.view === view);
  const hubTabLabel = isHubView(view) && hubTab ? tabLabelForHub(view, hubTab) : null;

  const workspaceTab: ClientWorkspaceTab = isClientWorkspaceTab(hubTab) ? hubTab : "kpis";
  const allowedWorkspaceTabs = CLIENT_WORKSPACE_TABS.map(t => t.key).filter(key =>
    hasPermission(CLIENT_WORKSPACE_TAB_PERMISSIONS[key], { isOwner, allowedPermissions }),
  );

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };
  const groups = NAV_GROUPS.filter(group => visibleNav.some(n => n.group === group));
  const dashboardScopeClients = getDashboardScopeClients(clients, selectedClientId);
  const dashboardReportingType = resolveDashboardReportingType(clients, selectedClientId);
  const dashboardHasMixedReportingTypes =
    new Set(dashboardScopeClients.map(c => normalizeReportingType(c.reporting_type))).size > 1;
  const dashboardClientLabel =
    selectedClientId === LIVE_SCOPE
      ? "Live clients"
      : selectedClientId
        ? clients.find(c => c.id === selectedClientId)?.name
        : "All clients";
  const simulatorClientIsRm =
    dashboardReportingType === "RM"
    && isSingleClientId(selectedClientId)
    && !dashboardHasMixedReportingTypes;

  const updateSimulatorUrl = useCallback((encoded: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "kpi_simulator");
    params.set("sim", encoded);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, pathname, router]);

  const updateRoiUrl = useCallback((encoded: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "kpi_simulator");
    params.set("simTab", "lead_source_roi");
    params.set("roi", encoded);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, pathname, router]);

  const updateSimTabUrl = useCallback((tab: "funnel" | "lead_source_roi") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "kpi_simulator");
    params.set("simTab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, pathname, router]);

  const goToConversionsActuals = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "client_workspace");
    params.set("tab", "kpis");
    params.set("sub", "roi");
    params.delete("sim");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setView("client_workspace");
    setHubTab("kpis");
    setWorkspaceSub("roi");
    setSidebarOpen(false);
  }, [searchParams, pathname, router]);

  const goToConversionLeads = useCallback((stage: ExplorerConv) => {
    const nav = conversionExplorerNav(stage);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nav.view);
    params.set("tab", nav.tab);
    params.set("sub", nav.sub);
    params.set("conv", nav.conv);
    // Drop stale table filters so KPI drill-down uses date/client/live only.
    params.delete("sim");
    params.delete("q");
    params.delete("rows");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setView(nav.view);
    setHubTab(nav.tab);
    setWorkspaceSub(nav.sub);
    setSidebarOpen(false);
  }, [searchParams, pathname, router]);

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--color-ws-base)]">

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <GlassPane
        as="aside"
        className={`
          fixed top-0 left-0 h-full w-60 z-30 flex flex-col overflow-hidden border-r
          transition-transform duration-slow ease-ws
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 md:static md:z-auto
        `}
      >

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--color-ws-hairline)]">
          <div className="w-8 h-8 rounded-control flex items-center justify-center flex-shrink-0 overflow-hidden bg-white">
            <Image
              src="/mr-waiz-logo.png"
              alt="Mr. Waiz logo"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-[var(--color-ws-label)]">Mr. Waiz</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="ws-sidebar-scroll flex-1 overflow-y-auto py-5 px-3 space-y-4">
          {groups.map(group => {
            const items = visibleNav.filter(n => n.group === group);
            const collapsed = collapsedGroups.has(group);
            return (
              <div key={group}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center justify-between px-3 min-h-11 mb-1 ws-focus-ring rounded-control"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ws-text-ghost)]">
                    {group}
                  </p>
                  <span
                    className="text-[10px] text-[var(--color-ws-text-ghost)] transition-transform duration-slow ease-ws"
                    style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                  >
                    ▾
                  </span>
                </button>
                {!collapsed && items.map(item => {
                  const active = view === item.view;
                  return (
                    <button
                      key={item.view}
                      type="button"
                      onClick={() => goToView(item.view)}
                      className={[
                        "w-full text-left px-3 min-h-11 rounded-control text-sm font-medium flex items-center gap-3 mb-0.5",
                        "transition-[background-color,color,transform] duration-med ease-ws active:scale-[0.98] ws-focus-ring",
                        active
                          ? "bg-[var(--color-ws-accent-wash)] text-[var(--color-ws-accent)]"
                          : "text-[var(--color-ws-quaternary)] hover:text-[var(--color-ws-tertiary)] hover:bg-white/[0.04]",
                      ].join(" ")}
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={NAV_ICONS[item.view]} />
                      </svg>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-[var(--color-ws-hairline)]">
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full text-left px-3 min-h-11 rounded-control text-sm font-medium flex items-center gap-3 text-[var(--color-ws-text-ghost)] hover:text-[var(--color-ws-quaternary)] hover:bg-white/[0.04] transition-colors duration-med ease-ws ws-focus-ring"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </GlassPane>

      {/* Main */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">

        {/* Header */}
        <GlassPane as="header" className="flex items-center gap-3 px-6 min-h-14 py-2 flex-wrap border-b">

          <button
            className="md:hidden mr-1 min-h-11 min-w-11 inline-flex items-center justify-center rounded-control text-[var(--color-ws-quaternary)] hover:text-[var(--color-ws-tertiary)] ws-focus-ring"
            onClick={() => setSidebarOpen(true)}
            aria-label="Show sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <h1 className="text-base font-semibold mr-auto text-[var(--color-ws-secondary)]">
            {navItem?.group
              ? <span className="text-[var(--color-ws-text-ghost)]">{navItem.group} / </span>
              : null}
            {navItem?.label ?? "Dashboard"}
            {hubTabLabel ? <span className="text-[var(--color-ws-text-ghost)]"> / {hubTabLabel}</span> : null}
          </h1>

          {showDateFilters && !view.startsWith("admin_") && (
            <>
              {(view === "kpi_simulator" || view === "media_buyer") && (
                <ClientSelect value={selectedClientId} onChange={filters.setClientId} clients={clients} />
              )}

              <DateRangeFilter
                preset={preset}
                customStart={customStart}
                customEnd={customEnd}
                onPresetChange={filters.setPreset}
                onCustomStartChange={filters.setCustomStart}
                onCustomEndChange={filters.setCustomEnd}
                includeSinceLaunch={sinceLaunchAvailable}
              />
            </>
          )}
        </GlassPane>

        {/* Content */}
        <main
          className={`flex-1 min-h-0 flex flex-col bg-[var(--color-ws-base)] ${
            view === "admin_billing"
              ? "overflow-hidden p-6 md:p-8"
              : view === "admin_clients"
                ? "overflow-auto px-6 md:px-8 pb-6 md:pb-8 pt-0"
                : view === "client_report_builder"
                  ? "overflow-hidden p-0"
                : "overflow-auto p-6 md:p-8"
          }`}
        >

          {!firstVisibleView && (
            <div className="flex items-center justify-center py-24">
              <div className="text-center max-w-sm">
                <p className="text-sm font-medium" style={{ color: "#94a3b8" }}>No access</p>
                <p className="text-xs mt-1" style={{ color: "#475569" }}>
                  You don&apos;t have permission to view any tabs yet. Ask an admin to grant you access.
                </p>
              </div>
            </div>
          )}

          {/* ── Client Workspace: KPIs, Dials, Explorer and Heat Maps on one scope ── */}
          {firstVisibleView && view === "client_workspace" && (
            <ClientWorkspaceHub
              tab={workspaceTab}
              sub={workspaceSub}
              onTabChange={setHubTabAndUrl}
              onSubChange={setWorkspaceSubAndUrl}
              allowedTabs={allowedWorkspaceTabs}
              filters={filters}
              clients={clients}
              railOpen={railOpen}
              onToggleRail={toggleRail}
              kpi={{
                metrics,
                dialPool,
                prevMetrics,
                metricsLoading,
                sparkMap,
                trends,
                trendsLoading,
                trendsError,
                reportingType: dashboardReportingType,
                hasMixedReportingTypes: dashboardHasMixedReportingTypes,
                clientLabel: dashboardClientLabel,
                overduePending,
              }}
              canOpenExplorer={allowedWorkspaceTabs.includes("explorer")}
              onOpenConversionLeads={goToConversionLeads}
            />
          )}

          {/* ── Acquisition KPI hub (new) ── */}
          {view === "acquisition_kpis" && hubTab && (
            <AcquisitionKpiHub
              tab={hubTab as AcquisitionKpiTab}
              onTabChange={setHubTabAndUrl}
              startDate={dateStart}
              endDate={dateEnd}
              isOwner={isOwner}
              preset={preset}
              customStart={customStart}
              customEnd={customEnd}
              onPresetChange={filters.setPreset}
              onCustomStartChange={filters.setCustomStart}
              onCustomEndChange={filters.setCustomEnd}
            />
          )}

          {/* ── Acquisition hub ── */}
          {view === "acquisition" && hubTab && (
            <AcquisitionHub
              tab={hubTab as AcquisitionTab}
              onTabChange={setHubTabAndUrl}
              startDate={dateStart}
              endDate={dateEnd}
              canManage={isOwner || isAdmin}
            />
          )}

          {view === "acquisition_data_explorer" && hubTab && (
            <AcquisitionDataExplorerHub
              tab={hubTab as AcquisitionDataExplorerTab}
              onTabChange={setHubTabAndUrl}
              startDate={dateStart}
              endDate={dateEnd}
            />
          )}

          {/* ── Agents hub ── */}
          {view === "agents" && hubTab && (
            <AgentsHub
              tab={hubTab as AgentsTab}
              onTabChange={setHubTabAndUrl}
              clients={clients}
              preset={preset}
              startDate={dateStart}
              endDate={dateEnd}
              canManage={isOwner || isAdmin}
            />
          )}

          {view === "media_buyer" && (
            <MediaBuyer
              startDate={dateStart}
              endDate={dateEnd}
              clientId={filters.singleClientId}
            />
          )}

          {view === "acquisition_marketing" && (
            <AcquisitionMarketing startDate={dateStart} endDate={dateEnd} />
          )}

          {view === "client_calls" && (
            <ClientCallsBrowser clients={clients} startDate={dateStart} endDate={dateEnd} />
          )}

          {view === "acquisition_sales_reps" && <AcquisitionSalesReps />}

          {view === "resources" && (
            <Suspense fallback={<p className="text-sm text-slate-500 py-12">Loading library…</p>}>
              <ResourcesLibrary canManage={isOwner || isAdmin} />
            </Suspense>
          )}

          {view === "closebot_log" && (
            <Suspense fallback={<p className="text-sm text-slate-500 py-12">Loading Closebot…</p>}>
              <ClosebotHub
                canWrite={
                  isOwner
                  || isAdmin
                  || hasPermission("closebot_log", { isOwner, allowedPermissions })
                }
              />
            </Suspense>
          )}

          {view === "team_meetings" && (
            <TeamMeetings from={dateStart} to={dateEnd} />
          )}

          {view === "account_work" && <AccountWeekPlansHub />}

          {view === "call_library" && (
            <CallLibrary canManage={isOwner || isAdmin} startDate={dateStart} endDate={dateEnd} />
          )}

          {view === "client_health" && (
            <ClientSuccessHub
              tab={
                hubTab && HUB_TAB_LABELS.client_health.some(t => t.key === hubTab)
                  ? (hubTab as ClientSuccessTab)
                  : "health"
              }
              onTabChange={setHubTabAndUrl}
            />
          )}

          {view === "client_compare" && <ClientCompareDashboard />}

          {view === "team_dashboard" && (
            <TeamCommandDashboard
              seat={
                hubTab && HUB_TAB_LABELS.team_dashboard.some(t => t.key === hubTab)
                  ? (hubTab as TeamDashboardTab)
                  : homeSeat ?? TEAM_COMMAND_DEFAULT_SEAT
              }
              homeSeat={homeSeat}
              onSeatChange={(tab: TeamDashboardTab) => setHubTabAndUrl(tab)}
              onNavigate={(next: string, tab?: string) => goToView(next as View, tab)}
            />
          )}

          {view === "state_looker" && <StateLooker />}

          {firstVisibleView && view === "kpi_simulator" && (
            <FunnelSimulatorHub
              metrics={metrics}
              metricsLoading={metricsLoading}
              clientLabel={dashboardClientLabel}
              clientIsRm={simulatorClientIsRm}
              dateRangeLabel={dateRangeLabel}
              onViewActuals={simulatorClientIsRm ? goToConversionsActuals : undefined}
              initialFunnelEncoded={searchParams.get("sim")}
              onFunnelStateChange={updateSimulatorUrl}
              initialRoiEncoded={searchParams.get("roi")}
              onRoiStateChange={updateRoiUrl}
              initialTab={
                searchParams.get("simTab") === "lead_source_roi"
                  ? "lead_source_roi"
                  : "funnel"
              }
              onTabChange={updateSimTabUrl}
            />
          )}

          {view === "client_report_builder" && (
            <ClientReportBuilder clients={clients} />
          )}

          {view === "ceo" && <CeoDashboard canViewRevenue={canViewRevenue} mode="dashboard" />}
          {view === "ceo_raw" && <CeoDashboard canViewRevenue={canViewRevenue} mode="raw" />}

          {/* ── Admin ── */}
          {view === "admin_agents"  && <AgentAdmin />}
          {view === "admin_clients" && (
              <ClientRoster canViewRevenue={canViewRevenue} />
          )}
          {view === "admin_billing" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-auto">
              <BillingManager canViewRevenue={canViewRevenue} />
            </div>
          )}
          {view === "admin_agent_payroll" && (
            <AgentPayrollReport
              onGoToCreditQueue={() => goToView("agents", "credit_queue")}
              onGoToAcquisitionCreditQueue={() => goToView("acquisition", "credit_queue")}
            />
          )}
          {view === "admin_share"   && <ShareReports clients={clients} />}
          {view === "admin_automations" && <AutomationsManager />}
          {view === "admin_users"   && <UserManager />}
          {view === "admin_offers"  && <OfferCatalogManager />}

        </main>
      </div>

      <DataChatLauncher
        startDate={dateStart}
        endDate={dateEnd}
        clients={clients}
        selectedClientId={selectedClientId}
      />
    </div>
  );
}
