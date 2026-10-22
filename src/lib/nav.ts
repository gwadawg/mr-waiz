// Shared navigation/tab definitions used by the dashboard and the per-user
// permission editor. Hub views appear in the sidebar; sub-tabs live in-page.

export type HeatmapTab = "show_rate" | "pickup_rate" | "new_leads";
export type DataExplorerTab = "leads" | "dials" | "appointments" | "speed_to_lead" | "meta_ads";
/** Level-1 tabs inside the unified Client Workspace. */
export type ClientWorkspaceTab = "kpis" | "compare" | "dials" | "explorer" | "heatmaps";
export type AcquisitionTab = "appointments" | "credit_queue" | "sales_calls" | "pending_closes" | "log_close" | "call_examples";
export type AcquisitionDataExplorerTab = "leads" | "appointments" | "offers" | "dials" | "closes" | "ads";
export type AcquisitionKpiTab = "overview" | "setters" | "closers" | "costs";
export type AgentsTab = "performance" | "goals" | "credit_queue" | "recordings" | "examples" | "weekly_focus";
export type ClientSuccessTab = "health" | "followups";
/** Seat lenses inside the unified Team Command hub. */
export type TeamDashboardTab = "cs" | "ccm" | "media";

export type HubView =
  | "client_workspace"
  | "acquisition"
  | "acquisition_data_explorer"
  | "acquisition_kpis"
  | "agents"
  | "client_health"
  | "team_dashboard";

export type View =
  | "kpi_simulator"
  | "client_report_builder"
  | "ceo"
  | "ceo_raw"
  | "media_buyer"
  | "ops_overview"
  | "state_looker"
  | "team_dashboard_ccm"
  | "team_dashboard_media"
  | "client_compare"
  // Folded into the Client Workspace hub. Retained so stored permissions,
  // bookmarks and icon maps keep resolving; redirected on the way in.
  | "dashboard"
  | "dial_analytics"
  | "heatmaps"
  | "data_explorer"
  | HubView
  | "resources"
  | "closebot_log"
  | "team_meetings"
  | "account_work"
  | "call_library"
  | "admin_agents"
  | "admin_clients"
  | "admin_billing"
  | "admin_agent_payroll"
  | "admin_share"
  | "admin_users"
  | "admin_offers"
  | "admin_automations"
  | "client_calls"
  | "acquisition_sales_reps"
  | "acquisition_marketing";

/** @deprecated Legacy view keys — URL redirects map these to hub + tab. */
export type LegacyView =
  | "leads"
  | "dials"
  | "appointments"
  | "speed_to_lead"
  | "ad_spend"
  | "meta_ad_insights"
  | "heatmap_show"
  | "heatmap_pickup"
  | "heatmap_leads"
  | "agent_stats"
  | "agent_credit_queue"
  | "agent_scorecards"
  | "recordings"
  | "goals"
  | "acquisition_funnel"
  | "acquisition_team"
  | "acquisition_setter_credit_queue"
  | "acquisition_leads"
  | "acquisition_appointments"
  | "acquisition_offers"
  | "acquisition_ads"
  | "schedule";

export type AnyView = View | LegacyView;

export type NavItem = { view: View; label: string; group: string };

export type HubTabDef<T extends string> = { key: T; label: string };

export const CLIENT_WORKSPACE_TABS: HubTabDef<ClientWorkspaceTab>[] = [
  { key: "kpis", label: "KPIs" },
  { key: "compare", label: "Compare" },
  { key: "dials", label: "Dials" },
  { key: "explorer", label: "Explorer" },
  { key: "heatmaps", label: "Heat Maps" },
];

/**
 * Each Workspace tab keeps the permission of the sidebar entry it absorbed, so
 * merging the views cannot hand anyone access they were not already granted.
 */
export const CLIENT_WORKSPACE_TAB_PERMISSIONS: Record<ClientWorkspaceTab, string> = {
  kpis: "dashboard",
  // Same grant as the standalone Client Compare page — no new access handed out.
  compare: "client_compare",
  dials: "dial_analytics",
  explorer: "data_explorer",
  heatmaps: "heatmaps",
};

export const HEATMAP_TABS: HubTabDef<HeatmapTab>[] = [
  { key: "show_rate", label: "Show Rate" },
  { key: "pickup_rate", label: "Pick Up Rate" },
  { key: "new_leads", label: "New Leads" },
];

export const DATA_EXPLORER_TABS: HubTabDef<DataExplorerTab>[] = [
  { key: "leads", label: "Leads" },
  { key: "dials", label: "Call Log" },
  { key: "appointments", label: "Appointments" },
  { key: "speed_to_lead", label: "Speed to Lead" },
  { key: "meta_ads", label: "Meta Ads" },
];

/**
 * Level-2 tabs, addressed by the `sub` URL param. Workspace tabs absent here
 * have no nested level. `kpis` uses `sub=roi` for Conversions & ROI (`sub=conversions` is still
 * accepted as an alias). Explorer stage filters use `sub=leads&conv=` (legacy
 * `sub=conversions` bookmarks canonicalize to Leads).
 */
export const CLIENT_WORKSPACE_SUBTABS: Partial<Record<ClientWorkspaceTab, HubTabDef<string>[]>> = {
  explorer: DATA_EXPLORER_TABS,
  heatmaps: HEATMAP_TABS,
};

/**
 * Legacy Explorer bookmarks used `sub=conversions` for the same lead list.
 * Stage filters now live on Leads via `conv=`.
 */
export function canonicalizeExplorerSub(
  sub: string | null | undefined,
): string | null | undefined {
  return sub === "conversions" ? "leads" : sub;
}

/** Validate a `sub` value, falling back to the first nested tab. */
export function resolveWorkspaceSubTab(
  tab: ClientWorkspaceTab,
  sub: string | null | undefined,
): string | null {
  const tabs = CLIENT_WORKSPACE_SUBTABS[tab];
  if (!tabs?.length) return null;
  const normalized = tab === "explorer" ? canonicalizeExplorerSub(sub) : sub;
  return tabs.some(t => t.key === normalized) ? (normalized as string) : tabs[0].key;
}

export function isClientWorkspaceTab(tab: string | null | undefined): tab is ClientWorkspaceTab {
  return CLIENT_WORKSPACE_TABS.some(t => t.key === tab);
}

export const ACQUISITION_TABS: HubTabDef<AcquisitionTab>[] = [
  { key: "appointments", label: "Appointments" },
  { key: "sales_calls", label: "Sales Calls" },
  { key: "call_examples", label: "Call Examples" },
  { key: "credit_queue", label: "Credit Queue" },
  { key: "log_close", label: "Log Close" },
  { key: "pending_closes", label: "Pending Closes" },
];

export const ACQUISITION_KPI_TABS: HubTabDef<AcquisitionKpiTab>[] = [
  { key: "overview", label: "Overview" },
  { key: "setters", label: "Setters" },
  { key: "closers", label: "Closers" },
  { key: "costs", label: "Costs" },
];

export const ACQUISITION_DATA_EXPLORER_TABS: HubTabDef<AcquisitionDataExplorerTab>[] = [
  { key: "leads", label: "Leads" },
  { key: "appointments", label: "Appointments" },
  { key: "offers", label: "Offers" },
  { key: "dials", label: "Dials" },
  { key: "closes", label: "Closes" },
  { key: "ads", label: "Ad Spend" },
];

export const AGENTS_TABS: HubTabDef<AgentsTab>[] = [
  { key: "performance", label: "Performance" },
  { key: "goals", label: "Goals" },
  { key: "credit_queue", label: "Credit Queue" },
  { key: "recordings", label: "Recordings" },
  { key: "examples", label: "Examples" },
  { key: "weekly_focus", label: "Weekly Focus" },
];

export const CLIENT_SUCCESS_TABS: HubTabDef<ClientSuccessTab>[] = [
  { key: "health", label: "Health" },
  { key: "followups", label: "Follow-ups" },
];

export const TEAM_DASHBOARD_TABS: HubTabDef<TeamDashboardTab>[] = [
  { key: "cs", label: "CS" },
  { key: "ccm", label: "CCM" },
  { key: "media", label: "Media Buyer" },
];

/**
 * Shared default when no role home — CS (Laura plate) is the relationship / commitment view.
 * Role homes still override via homeSeat (cs / ccm / media per pay_type).
 */
export const TEAM_COMMAND_DEFAULT_SEAT: TeamDashboardTab = "cs";

/**
 * Old standalone team dashboard views → unified hub seat.
 * Kept for deep links, bookmarks, and stored permissions.
 */
export const TEAM_COMMAND_LEGACY_REDIRECTS: Record<string, TeamDashboardTab> = {
  team_dashboard_ccm: "ccm",
  team_dashboard_media: "media",
  ops_overview: "cs",
  // Pre-rename seat key
  ops: "cs",
};

/** Hub view → legacy permission keys that grant access. */
export const HUB_LEGACY_CHILDREN: Record<HubView, string[]> = {
  // Absorbed the four standalone client views plus their own legacy children, so
  // any prior grant still opens the Workspace. Which tabs appear inside it is
  // decided separately by CLIENT_WORKSPACE_TAB_PERMISSIONS.
  client_workspace: [
    "dashboard",
    "dial_analytics",
    "heatmaps",
    "data_explorer",
    "heatmap_show",
    "heatmap_pickup",
    "heatmap_leads",
    "leads",
    "dials",
    "appointments",
    "speed_to_lead",
    "meta_ad_insights",
  ],
  acquisition: [
    "acquisition",
    "acquisition_marketing",
    "acquisition_funnel",
    "acquisition_team",
    "acquisition_setter_credit_queue",
    "acquisition_leads",
    "acquisition_appointments",
    "acquisition_offers",
    "acquisition_ads",
  ],
  acquisition_kpis: [
    "acquisition",
  ],
  acquisition_data_explorer: [
    "acquisition",
    "acquisition_leads",
    "acquisition_appointments",
    "acquisition_offers",
    "acquisition_ads",
  ],
  agents: ["agent_stats", "agent_scorecards", "agent_credit_queue", "recordings", "goals", "schedule"],
  client_health: ["client_health"],
  // Prior three sidebar dashboards now live as seats under Team Command.
  team_dashboard: ["team_dashboard_ccm", "team_dashboard_media", "ops_overview"],
};

/** All legacy keys still honored in stored permissions (soft deprecation). */
export const LEGACY_PERMISSION_KEYS: string[] = [
  ...HUB_LEGACY_CHILDREN.client_workspace,
  "ad_spend",
  ...HUB_LEGACY_CHILDREN.acquisition.filter(k => k !== "acquisition"),
  ...HUB_LEGACY_CHILDREN.agents,
  // Prior Team Dashboard sidebar entries (now seats under team_dashboard).
  ...HUB_LEGACY_CHILDREN.team_dashboard,
];

export type ViewRedirect = { view: View; tab: string; sub?: string };

/**
 * Old flat view keys → hub + tab (+ nested sub-tab). Keyed loosely because the
 * four views folded into the Client Workspace are still real `View` members,
 * not `LegacyView`s.
 */
export const LEGACY_VIEW_REDIRECTS: Record<string, ViewRedirect> = {
  // Sidebar entries absorbed by the Client Workspace.
  dashboard: { view: "client_workspace", tab: "kpis" },
  dial_analytics: { view: "client_workspace", tab: "dials" },
  data_explorer: { view: "client_workspace", tab: "explorer" },
  heatmaps: { view: "client_workspace", tab: "heatmaps" },
  leads: { view: "client_workspace", tab: "explorer", sub: "leads" },
  dials: { view: "client_workspace", tab: "explorer", sub: "dials" },
  appointments: { view: "client_workspace", tab: "explorer", sub: "appointments" },
  speed_to_lead: { view: "client_workspace", tab: "explorer", sub: "speed_to_lead" },
  ad_spend: { view: "client_workspace", tab: "explorer", sub: "meta_ads" },
  meta_ad_insights: { view: "client_workspace", tab: "explorer", sub: "meta_ads" },
  heatmap_show: { view: "client_workspace", tab: "heatmaps", sub: "show_rate" },
  heatmap_pickup: { view: "client_workspace", tab: "heatmaps", sub: "pickup_rate" },
  heatmap_leads: { view: "client_workspace", tab: "heatmaps", sub: "new_leads" },
  agent_stats: { view: "agents", tab: "performance" },
  agent_credit_queue: { view: "agents", tab: "credit_queue" },
  agent_scorecards: { view: "agents", tab: "performance" },
  recordings: { view: "agents", tab: "recordings" },
  goals: { view: "agents", tab: "goals" },
  acquisition_funnel: { view: "acquisition_kpis", tab: "overview" },
  acquisition_team: { view: "acquisition_kpis", tab: "setters" },
  acquisition_setter_credit_queue: { view: "acquisition", tab: "credit_queue" },
  acquisition_leads: { view: "acquisition_data_explorer", tab: "leads" },
  acquisition_appointments: { view: "acquisition_data_explorer", tab: "appointments" },
  acquisition_offers: { view: "acquisition_data_explorer", tab: "offers" },
  acquisition_ads: { view: "acquisition_data_explorer", tab: "ads" },
  schedule: { view: "agents", tab: "weekly_focus" },
};

export const HUB_VIEWS: HubView[] = [
  "client_workspace",
  "acquisition",
  "acquisition_data_explorer",
  "acquisition_kpis",
  "agents",
  "client_health",
  "team_dashboard",
];

export const HUB_TAB_LABELS: Record<HubView, HubTabDef<string>[]> = {
  client_workspace: CLIENT_WORKSPACE_TABS,
  acquisition: ACQUISITION_TABS,
  acquisition_data_explorer: ACQUISITION_DATA_EXPLORER_TABS,
  acquisition_kpis: ACQUISITION_KPI_TABS,
  agents: AGENTS_TABS,
  client_health: CLIENT_SUCCESS_TABS,
  team_dashboard: TEAM_DASHBOARD_TABS,
};

export function isHubView(view: string): view is HubView {
  return (HUB_VIEWS as string[]).includes(view);
}

export function defaultTabForHub(hub: HubView): string {
  return HUB_TAB_LABELS[hub][0].key;
}

export function tabLabelForHub(hub: HubView, tab: string): string | undefined {
  return HUB_TAB_LABELS[hub].find(t => t.key === tab)?.label;
}

// Sidebar group ordering.
export const NAV_GROUPS = [
  "Team Dashboards",
  "Clients",
  "Executive",
  "Acquisition",
  "Team",
  "Admin",
] as const;

export const NAV: NavItem[] = [
  { view: "team_dashboard",     label: "Team Command",          group: "Team Dashboards" },
  { view: "client_workspace",   label: "Client Workspace",      group: "Clients"      },
  { view: "kpi_simulator",      label: "Funnel Simulator",      group: "Clients"      },
  { view: "client_report_builder", label: "Client Reports",     group: "Clients"      },
  { view: "media_buyer",        label: "Ad Performance",        group: "Clients"      },
  { view: "client_health",      label: "Client Success",        group: "Clients"      },
  { view: "client_compare",     label: "Client Compare",        group: "Clients"      },
  { view: "state_looker",       label: "Client Directory",      group: "Clients"      },
  { view: "ceo",                label: "CEO Dashboard",         group: "Executive"    },
  { view: "ceo_raw",            label: "Raw Data",              group: "Executive"    },
  { view: "acquisition_kpis",          label: "Acquisition KPIs",      group: "Acquisition"  },
  { view: "acquisition_marketing",     label: "Marketing",             group: "Acquisition"  },
  { view: "acquisition",               label: "Acquisition",           group: "Acquisition"  },
  { view: "acquisition_data_explorer", label: "Acquisition Data",      group: "Acquisition"  },
  { view: "agents",             label: "Call Center Hub",       group: "Team"         },
  { view: "resources",          label: "Resource Library",      group: "Team"         },
  { view: "closebot_log",       label: "Closebot",              group: "Team"         },
  { view: "team_meetings",      label: "Calendars",             group: "Team"         },
  { view: "account_work",       label: "Account Work",          group: "Team"         },
  { view: "call_library",       label: "Team Calls",            group: "Team"         },
  { view: "admin_agents",       label: "Team Roster",           group: "Admin"        },
  { view: "admin_clients",      label: "Client Roster",         group: "Admin"        },
  { view: "client_calls",       label: "Client Calls",          group: "Admin"        },
  { view: "admin_billing",      label: "Client Billing",        group: "Admin"        },
  { view: "admin_agent_payroll", label: "Team Payroll",         group: "Admin"        },
  { view: "admin_share",        label: "Share Reports",         group: "Admin"        },
  { view: "admin_automations",  label: "Automations",           group: "Admin"        },
  { view: "admin_users",        label: "Users",                 group: "Admin"        },
  { view: "admin_offers",       label: "Offer Catalog",         group: "Admin"        },
  { view: "acquisition_sales_reps", label: "Sales Reps",        group: "Admin"        },
];

export const ALL_VIEWS: View[] = NAV.map(item => item.view);

/** The view a bare `/dashboard` URL lands on. */
export const DEFAULT_VIEW: HubView = "client_workspace";

export function resolveViewFromParams(
  viewParam: string | null,
  tabParam: string | null,
): { view: View; tab: string | null } {
  const resolveHub = (view: HubView, rawTab: string | null): { view: View; tab: string } => {
    const tabs = HUB_TAB_LABELS[view];
    // Soft-map old Ops seat key → CS
    const candidate = rawTab === "ops" && view === "team_dashboard" ? "cs" : rawTab;
    const valid = tabs.some(t => t.key === candidate);
    return { view, tab: valid ? (candidate as string) : defaultTabForHub(view) };
  };

  // No view param is the default workspace — still honor an explicit tab so a
  // sub-tab click that only writes `?tab=` isn't snapped back.
  if (!viewParam) return resolveHub(DEFAULT_VIEW, tabParam);

  // Old Team Dashboards URLs → single Team Command hub + seat tab.
  if (viewParam in TEAM_COMMAND_LEGACY_REDIRECTS) {
    return {
      view: "team_dashboard",
      tab: TEAM_COMMAND_LEGACY_REDIRECTS[viewParam],
    };
  }

  if (viewParam in LEGACY_VIEW_REDIRECTS) {
    const redirect = LEGACY_VIEW_REDIRECTS[viewParam];
    return { view: redirect.view, tab: redirect.tab };
  }

  if (ALL_VIEWS.includes(viewParam as View) || viewParam === "team_dashboard") {
    const view = viewParam as View;
    if (isHubView(view)) return resolveHub(view, tabParam);
    return { view, tab: null };
  }

  return resolveHub(DEFAULT_VIEW, null);
}
