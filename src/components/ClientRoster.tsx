"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import ClientFile from "@/components/ClientFile";
import AddClientOfferModal from "@/components/AddClientOfferModal";
import ModalCloseButton from "@/components/ModalCloseButton";
import KickOffCallWizard from "@/components/KickOffCallWizard";
import LaunchChecklistWizard from "@/components/LaunchChecklistWizard";
import LaunchKitWizard from "@/components/LaunchKitWizard";
import QaSkeletonWizard from "@/components/QaSkeletonWizard";
import VirtualCardWizard from "@/components/VirtualCardWizard";
import { isLaunchKitLifecycle } from "@/lib/launch-kit/intake";
import ChurnOffboardingWizard from "@/components/ChurnOffboardingWizard";
import PendingEventsPanel from "@/components/PendingEventsPanel";
import PendingFormSubmissionsPanel from "@/components/PendingFormSubmissionsPanel";
import FormSubmissionsTab from "@/components/FormSubmissionsTab";
import ViewHub from "@/components/nav/ViewHub";
import Link from "next/link";
import { churnFormHref, isChurnOffboardEligible, reinstateFormHref } from "@/lib/internal-forms";
import { FormProgressStrip } from "@/components/ClientFormsSection";
import LifecycleStatusSelect from "@/components/LifecycleStatusSelect";
import AdsPausedControl from "@/components/AdsPausedControl";
import ClientSitesCell from "@/components/ClientSitesCell";
import StatusChangeModal from "@/components/StatusChangeModal";
import { requiresLifecycleFeedback } from "@/lib/client-feedback";
import { isKickoffIncomplete, isKickoffLifecycle } from "@/lib/kickoff";
import { syncIsLiveWithLifecycle } from "@/lib/lifecycle-sync";
import { clientNeedsGhlMapping } from "@/lib/client-ghl-mapping";
import { DEFAULT_REPORTING_TYPE, normalizeReportingType, usesCallCenterKpiLayout, type ReportingType } from "@/lib/kpi-layouts";
import { dialPoolForClient } from "@/lib/dial-pool";
import ClientLeadSourceSelect from "@/components/ClientLeadSourceSelect";
import { REPORTING_TYPE_META, REPORTING_TYPES } from "@/lib/reporting-types";
import { normalizeSalesPackage } from "@/lib/offer-catalog";
import ReportingTypeBadge, { ReportingTypeSelectOptions, SalesPackageBadge } from "@/components/ReportingTypeBadge";
import { isQaLifecycle, type QaLane } from "@/lib/qa-form";
import { type ClientKpiBenchmarks } from "@/lib/client-health";
import {
  countRosterAccounts,
  groupClientsIntoAccounts,
  rosterAccountDisplayName,
  type RosterAccountGroup,
} from "@/lib/roster-account-groups";
import { countSecondaryRosterFilters, offerVisibleForStatusFilter } from "@/lib/roster-media-view";
import { timezoneLabel } from "@/lib/us-timezones";
import RosterStatesCell from "@/components/RosterStatesCell";

type DataSummary = {
  events: number;
  client_billings: number;
  client_calls: number;
  client_notes: number;
  total_rows: number;
};

type Client = {
  id: string;
  name: string;
  is_live?: boolean;
  reporting_type?: ReportingType;
  service_program?: string | null;
  sales_package?: string | null;
  lifecycle_status?: string | null;
  mrr?: number | null;
  daily_adspend?: number | null;
  appointment_watch?: boolean | null;
  qualifies_leads?: boolean | null;
  ads_paused?: boolean | null;
  ads_paused_at?: string | null;
  ads_paused_note?: string | null;
  billing_type?: string | null;
  billing_day?: number | null;
  launch_date?: string | null;
  date_signed?: string | null;
  churned_at?: string | null;
  contract_term_months?: number | null;
  contract_end_date?: string | null;
  performance_terms?: string | null;
  billing_email?: string | null;
  email?: string | null;
  primary_contact?: string | null;
  primary_contact_name?: string | null;
  states_licensed?: string[] | null;
  timezone?: string | null;
  drive_folder_url?: string | null;
  facebook_page_name?: string | null;
  website?: string | null;
  funnel_url?: string | null;
  virtual_business_card_url?: string | null;
  virtual_card_slug?: string | null;
  landing_page_url?: string | null;
  instagram_handle?: string | null;
  ad_account_name?: string | null;
  ad_account_url?: string | null;
  thank_you_page_url?: string | null;
  second_landing_page_url?: string | null;
  kpi_benchmarks?: ClientKpiBenchmarks | null;
  kpi_benchmarks_updated_at?: string | null;
  kpi_benchmarks_updated_by?: string | null;
  kpi_benchmarks_note?: string | null;
  onboarding_clickup_task_id?: string | null;
  clickup_task_id?: string | null;
  ghl_location_id?: string | null;
  account_group_id?: string | null;
  account_display_name?: string | null;
  account_primary_email?: string | null;
  engagement_kind?: string | null;
  total_paid?: number;
  form_progress?: Partial<Record<"new_client" | "onboarding" | "kickoff" | "tech_qa" | "marketing_qa" | "creative" | "launch_kit" | "virtual_card" | "launch", boolean>>;
  next_cs_call?: {
    scheduled_at: string;
    call_type: "onboarding" | "launch" | "checkin" | null;
  } | null;
};

/** Compact "3d ago" / "2mo ago" relative label. */
function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const ROSTER_SECTIONS = [
  { key: "onboarding", label: "Onboarding", statuses: ["new_account", "onboarding"] },
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "paused", label: "Paused / Off-boarding", statuses: ["paused", "off_boarding"] },
  { key: "churned", label: "Churned", statuses: ["churned"] },
] as const;

type SectionKey = (typeof ROSTER_SECTIONS)[number]["key"];

/** Lifecycle accent per section — gives each zone a recognizable color anchor. */
const SECTION_ACCENT: Record<SectionKey, string> = {
  onboarding: "#38bdf8",
  active: "#22c55e",
  paused: "#f59e0b",
  churned: "#64748b",
};

/** Optional middle columns, swapped per role-based view preset. */
type ColumnKey =
  | "stage"
  | "tenure"
  | "adspend"
  | "watch"
  | "qualify"
  | "ads"
  | "launch"
  | "cs_call"
  | "drive"
  | "states"
  | "page"
  | "tz"
  | "product"
  | "ad_account"
  | "sites"
  | "instagram";

type RosterView = "full" | "cs" | "media";

const ROSTER_VIEWS: { key: RosterView; label: string }[] = [
  { key: "full", label: "Full" },
  { key: "cs", label: "Client Success" },
  { key: "media", label: "Media Buying" },
];

const VIEW_COLUMNS: Record<RosterView, ColumnKey[]> = {
  full: ["stage", "tenure", "cs_call", "adspend", "qualify", "watch"],
  cs: ["stage", "tenure", "cs_call", "qualify", "watch"],
  media: ["drive", "states", "page", "instagram", "ad_account", "sites", "tz", "product", "qualify", "adspend", "ads"],
};

function moneyShort(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

const COLUMN_DEFS: Record<ColumnKey, { header: string; revenueOnly?: boolean; render: (c: Client) => ReactNode }> = {
  stage: {
    header: "Stage",
    render: c => <FormProgressStrip progress={c.form_progress} />,
  },
  tenure: {
    header: "Tenure",
    render: c => {
      const t = tenureLabel(c);
      return <span className="text-xs whitespace-nowrap" style={{ color: t.muted ? "#64748b" : "#cbd5e1" }} title={t.title}>{t.text}</span>;
    },
  },
  adspend: {
    header: "Ad spend",
    revenueOnly: true,
    render: c => {
      const empty = c.daily_adspend == null;
      const active = (c.lifecycle_status ?? "") === "active";
      if (empty && active) {
        return (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ color: "#fbbf24", background: "rgba(251,191,36,0.14)" }}
            title="Set a daily adspend budget so pacing works on Media Buyer Command"
          >
            Set budget
          </span>
        );
      }
      return (
        <span
          className="text-xs whitespace-nowrap"
          style={{ color: c.daily_adspend != null ? "#cbd5e1" : "#334155" }}
        >
          {c.daily_adspend != null ? `${moneyShort(c.daily_adspend)}/day` : "—"}
        </span>
      );
    },
  },
  qualify: {
    header: "Qualify",
    render: () => null,
  },
  watch: {
    header: "Appt watch",
    render: c => {
      if (c.appointment_watch === true) {
        return (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ color: "#4ade80", background: "rgba(74,222,128,0.12)" }}
            title="Dial appointments and live transfer"
          >
            Yes
          </span>
        );
      }
      if (c.appointment_watch === false) {
        return (
          <span className="text-xs" style={{ color: "#64748b" }} title="Do not run appointment watch">
            No
          </span>
        );
      }
      return <span className="text-xs" style={{ color: "#334155" }}>—</span>;
    },
  },
  ads: {
    header: "Ads",
    // Rendered specially in ClientRow so toggle can update roster state.
    render: c => (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={c.ads_paused ? { color: "#f59e0b", background: "rgba(245,158,11,0.12)" } : { color: "#64748b" }}>
        {c.ads_paused ? "Paused" : "On"}
      </span>
    ),
  },
  launch: {
    header: "Launch",
    render: c => <span className="text-xs whitespace-nowrap" style={{ color: c.launch_date ? "#cbd5e1" : "#334155" }}>{c.launch_date ? formatDate(c.launch_date) : "—"}</span>,
  },
  cs_call: {
    header: "Next CS",
    render: c => {
      const next = c.next_cs_call;
      if (!next?.scheduled_at) {
        return <span className="text-xs" style={{ color: "#334155" }}>—</span>;
      }
      const d = new Date(next.scheduled_at);
      const when = Number.isFinite(d.getTime())
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : next.scheduled_at.slice(0, 10);
      const type =
        next.call_type === "onboarding"
          ? "OB"
          : next.call_type === "launch"
            ? "Launch"
            : next.call_type === "checkin"
              ? "CI"
              : "CS";
      return (
        <span
          className="text-xs whitespace-nowrap"
          style={{ color: "#cbd5e1" }}
          title={d.toLocaleString()}
        >
          {when} · {type}
        </span>
      );
    },
  },
  drive: {
    header: "Drive",
    render: () => null, // ClientRow renders the link
  },
  states: {
    header: "States",
    render: c => <RosterStatesCell codes={c.states_licensed} />,
  },
  page: {
    header: "Page",
    render: c => {
      const name = c.facebook_page_name?.trim();
      if (!name) {
        return <span className="text-xs" style={{ color: "#334155" }}>—</span>;
      }
      return (
        <span
          className="text-xs truncate max-w-[10rem] inline-block align-bottom"
          style={{ color: "#cbd5e1" }}
          title={name}
        >
          {name}
        </span>
      );
    },
  },
  tz: {
    header: "TZ",
    render: c => {
      const label = timezoneLabel(c.timezone);
      const muted = !c.timezone;
      return (
        <span
          className="text-xs whitespace-nowrap"
          style={{ color: muted ? "#334155" : "#cbd5e1" }}
          title={c.timezone ?? undefined}
        >
          {label}
        </span>
      );
    },
  },
  product: {
    header: "Product",
    render: c => (
      <span className="flex items-center gap-1.5 min-w-0">
        <ReportingTypeBadge value={c.reporting_type} />
        <SalesPackageBadge value={c.sales_package} />
      </span>
    ),
  },
  ad_account: {
    header: "Ad account",
    render: () => null, // ClientRow renders the link
  },
  sites: {
    header: "Sites",
    render: () => null, // ClientRow renders ClientSitesCell
  },
  instagram: {
    header: "IG",
    render: c => {
      const handle = c.instagram_handle?.trim();
      if (!handle) return <span className="text-xs" style={{ color: "#334155" }}>—</span>;
      return (
        <span className="text-xs truncate max-w-[8rem] inline-block align-bottom" style={{ color: "#cbd5e1" }} title={handle}>
          {handle}
        </span>
      );
    },
  },
};

/** Columns for a view, dropping revenue-only ones when the user can't see revenue. */
function resolveColumns(view: RosterView, showRevenue: boolean): ColumnKey[] {
  return VIEW_COLUMNS[view].filter(k => showRevenue || !COLUMN_DEFS[k].revenueOnly);
}

/** Whole calendar months elapsed since an ISO date (date-only safe). */
function monthsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Tenure cell content: how long a client has been with us, framed by where
 * they are. Live clients show the month-of-engagement they're in; others show
 * how long they've sat in their current phase.
 */
function tenureLabel(c: Client): { text: string; title: string; muted: boolean } {
  const status = c.lifecycle_status ?? "active";
  if (status === "churned") {
    return { text: `Churned ${relativeAge(c.churned_at)}`, title: `Churned ${formatDate(c.churned_at)}`, muted: true };
  }
  const live = status === "active";
  const monthsLive = monthsSince(c.launch_date);
  if (live && monthsLive != null) {
    return {
      text: `Mo ${monthsLive + 1} live`,
      title: `Live since ${formatDate(c.launch_date)} · ${monthsLive} full month${monthsLive === 1 ? "" : "s"}`,
      muted: false,
    };
  }
  if (c.date_signed) {
    return { text: `Signed ${relativeAge(c.date_signed)}`, title: `Signed ${formatDate(c.date_signed)}`, muted: true };
  }
  return { text: "—", title: "No launch or signed date on file", muted: true };
}

function RosterColumnHead({ columns }: { columns: ColumnKey[] }) {
  const headers = ["Client", "Status", ...columns.map(k => COLUMN_DEFS[k].header), ""];
  return (
    <thead>
      <tr style={{ background: "#0a1628" }}>
        {headers.map((h, i) => (
          <th
            key={i}
            className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${i === headers.length - 1 ? "text-right" : "text-left"}`}
            style={{
              color: "#475569",
              background: "#0a1628",
              boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function RosterSectionRow({
  label,
  count,
  accent,
  colSpan,
}: {
  label: string;
  count: number;
  accent: string;
  colSpan: number;
}) {
  return (
    <tr style={{ background: "#080f1e" }}>
      <td
        colSpan={colSpan}
        className="px-3 py-2 border-t border-white/[0.08]"
        style={{ background: "#080f1e" }}
      >
        <span className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
          <span className="text-sm font-semibold" style={{ color: "#cbd5e1" }}>{label}</span>
          <span
            className="text-xs font-semibold px-1.5 py-0.5 rounded-md"
            style={{ color: accent, background: `${accent}1a` }}
          >
            {count}
          </span>
        </span>
      </td>
    </tr>
  );
}

function clientSectionKey(c: Client): SectionKey {
  const status = c.lifecycle_status ?? "active";
  for (const section of ROSTER_SECTIONS) {
    if ((section.statuses as readonly string[]).includes(status)) return section.key;
  }
  return "active";
}

const LIFECYCLE_PRIORITY: Record<string, number> = {
  active: 5,
  onboarding: 4,
  new_account: 3,
  paused: 2,
  off_boarding: 1,
  churned: 0,
};

function accountSectionKey(group: RosterAccountGroup): SectionKey {
  let bestPri = -1;
  let best: SectionKey = "active";
  for (const c of group.offers) {
    const section = clientSectionKey(c as Client);
    const pri = LIFECYCLE_PRIORITY[c.lifecycle_status ?? "active"] ?? 0;
    if (pri > bestPri) {
      bestPri = pri;
      best = section;
    }
  }
  return best;
}

function groupAccountsBySection(groups: RosterAccountGroup[]): Record<SectionKey, RosterAccountGroup[]> {
  const result = Object.fromEntries(ROSTER_SECTIONS.map(s => [s.key, [] as RosterAccountGroup[]])) as Record<
    SectionKey,
    RosterAccountGroup[]
  >;
  for (const g of groups) {
    result[accountSectionKey(g)].push(g);
  }
  for (const section of ROSTER_SECTIONS) {
    result[section.key].sort((a, b) =>
      rosterAccountDisplayName(a).localeCompare(rosterAccountDisplayName(b), undefined, { sensitivity: "base" }),
    );
  }
  return result;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const datePart = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fieldStyle() {
  return { background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" } as const;
}

/** Searchable haystack for a client row. */
function clientMatchesQuery(c: Client, q: string): boolean {
  if (!q) return true;
  const hay = [
    c.name,
    c.primary_contact_name,
    c.primary_contact,
    c.account_display_name,
    c.onboarding_clickup_task_id,
    c.clickup_task_id,
    ...(c.states_licensed ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider" style={{ color: "#475569" }}>{label}</span>
      {children}
    </label>
  );
}

export default function ClientRoster({ canViewRevenue: initialCanViewRevenue = false }: { canViewRevenue?: boolean }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<{ id: string; name: string; summary: DataSummary } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [fileFor, setFileFor] = useState<{
    id: string;
    name: string;
    scrollToNotes?: boolean;
    scrollToCalls?: boolean;
    openCheckinForm?: boolean;
    openKickoff?: boolean;
    openAddOffer?: boolean;
  } | null>(null);
  const [addOfferFor, setAddOfferFor] = useState<{
    originClientId: string;
    accountDisplayName: string;
    existingReportingTypes: string[];
    accountGroupId?: string;
  } | null>(null);
  const [kickoffFor, setKickoffFor] = useState<{ id: string; name: string } | null>(null);
  const [launchFor, setLaunchFor] = useState<{ id: string; name: string } | null>(null);
  const [qaFor, setQaFor] = useState<{ id: string; name: string; lane: QaLane } | null>(null);
  const [launchKitFor, setLaunchKitFor] = useState<{ id: string; name: string } | null>(null);
  const [virtualCardFor, setVirtualCardFor] = useState<{ id: string; name: string } | null>(null);
  const [offboardFor, setOffboardFor] = useState<{ id: string; name: string } | null>(null);
  const [showRevenue, setShowRevenue] = useState(initialCanViewRevenue);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SectionKey | "all">("all");
  const [offerFilter, setOfferFilter] = useState<ReportingType | "all">("all");
  const [packageFilter, setPackageFilter] = useState<"all" | "core_offer" | "mid_offer" | "skool" | "unset">("all");
  const [adsFilter, setAdsFilter] = useState<"all" | "on" | "paused">("all");
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [statusChange, setStatusChange] = useState<{ clientId: string; clientName: string; targetStatus: string } | null>(null);
  const [rosterView, setRosterView] = useState<RosterView>(() => {
    if (typeof window === "undefined") return "full";
    const saved = window.localStorage.getItem("rosterView");
    return saved === "cs" || saved === "media" ? saved : "full";
  });
  const [filtersOpen, setFiltersOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("rosterFiltersOpen") === "1";
  });
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(() => new Set());
  const [sectionTab, setSectionTab] = useState<"clients" | "forms">(() => {
    if (typeof window === "undefined") return "clients";
    return window.localStorage.getItem("rosterSectionTab") === "forms" ? "forms" : "clients";
  });
  const [unmappedCount, setUnmappedCount] = useState(0);

  function changeSectionTab(tab: "clients" | "forms") {
    setSectionTab(tab);
    window.localStorage.setItem("rosterSectionTab", tab);
  }

  async function refreshUnmappedCount() {
    const res = await fetch("/api/form-submissions/pending");
    const d = await res.json().catch(() => ({}));
    if (res.ok) setUnmappedCount(d.total ?? 0);
  }

  useEffect(() => {
    refreshUnmappedCount();
  }, []);

  async function attachNextCsCalls(loaded: Client[]): Promise<Client[]> {
    const clickupIds = [
      ...new Set(
        loaded
          .map(c => c.onboarding_clickup_task_id || c.clickup_task_id)
          .filter((id): id is string => !!id),
      ),
    ];
    if (clickupIds.length === 0) return loaded;
    try {
      const csRes = await fetch(
        `/api/cs-appointments?scope=next_by_clickup&onboarding_clickup_task_ids=${encodeURIComponent(clickupIds.join(","))}`,
      );
      const csData = await csRes.json().catch(() => ({}));
      const nextMap = (csData.next_by_clickup ?? {}) as Record<
        string,
        { scheduled_at: string; call_type: "onboarding" | "launch" | "checkin" | null }
      >;
      return loaded.map(c => ({
        ...c,
        next_cs_call: (c.onboarding_clickup_task_id || c.clickup_task_id)
          ? nextMap[c.onboarding_clickup_task_id || c.clickup_task_id || ""] ?? null
          : null,
      }));
    } catch {
      return loaded;
    }
  }

  useEffect(() => {
    fetch("/api/clients?detail=1")
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setLoadError(d.error ?? "Failed to load clients");
          setClients([]);
          setLoading(false);
          return;
        }
        setLoadError(null);
        const loaded: Client[] = d.clients ?? [];
        if (typeof d.can_view_revenue === "boolean") setShowRevenue(d.can_view_revenue);
        else if (typeof d.can_view_total_paid === "boolean") setShowRevenue(d.can_view_total_paid);
        setClients(await attachNextCsCalls(loaded));
        setLoading(false);
      });
  }, []);

  function changeRosterView(v: RosterView) {
    setRosterView(v);
    window.localStorage.setItem("rosterView", v);
  }

  function changeFiltersOpen(open: boolean) {
    setFiltersOpen(open);
    window.localStorage.setItem("rosterFiltersOpen", open ? "1" : "0");
  }

  const secondaryFilterCount = countSecondaryRosterFilters({
    offer: offerFilter,
    package: packageFilter,
    ads: adsFilter,
  });

  const columns = resolveColumns(rosterView, showRevenue);
  const colSpan = columns.length + 3;

  async function reload() {
    const res = await fetch("/api/clients?detail=1");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadError(d.error ?? "Failed to load clients");
      setClients([]);
      return;
    }
    setLoadError(null);
    setClients(await attachNextCsCalls(d.clients ?? []));
    if (typeof d.can_view_revenue === "boolean") setShowRevenue(d.can_view_revenue);
    else if (typeof d.can_view_total_paid === "boolean") setShowRevenue(d.can_view_total_paid);
    void refreshUnmappedCount();
  }

  async function patchClient(id: string, body: Record<string, unknown>) {
    setBusy(id);
    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Failed to update client");
    }
    await reload();
    setBusy(null);
  }

  function requestStatusChange(client: Client, target: string) {
    if (target === (client.lifecycle_status ?? "active")) return;
    if (target === "churned") {
      setOffboardFor({ id: client.id, name: client.name });
      return;
    }
    if (requiresLifecycleFeedback(target)) {
      setStatusChange({ clientId: client.id, clientName: client.name, targetStatus: target });
      return;
    }
    // Direct transition — is_live is derived server-side from lifecycle.
    patchClient(client.id, { lifecycle_status: target });
  }

  async function confirmStatusChange(reason: string | null, note: string) {
    if (!statusChange) return;
    const { clientId, targetStatus } = statusChange;
    await patchClient(clientId, {
      lifecycle_status: targetStatus,
      status_change_reason: reason,
      status_change_note: note || undefined,
    });
    setStatusChange(null);
  }

  async function createClient(body: Record<string, unknown>) {
    setBusy("create");
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(d.error ?? "Failed to create client");
      setBusy(null);
      return;
    }
    if (d.client) {
      await reload();
      setShowAdd(false);
    }
    setBusy(null);
  }

  async function askDelete(client: Client) {
    setConfirmDelete(client.id);
    setDeleteSummary(null);
    setMergeTargetId("");
    const res = await fetch(`/api/clients/${client.id}/data-summary`);
    const d = await res.json().catch(() => ({}));
    if (d.summary) {
      setDeleteSummary({ id: client.id, name: client.name, summary: d.summary });
    }
  }

  function cancelDelete() {
    setConfirmDelete(null);
    setDeleteSummary(null);
    setMergeTargetId("");
  }

  async function handleMerge(sourceId: string) {
    if (!mergeTargetId) {
      alert("Choose the client file to keep before merging.");
      return;
    }
    setBusy(sourceId);
    const res = await fetch("/api/clients/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, target_id: mergeTargetId }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(d.error ?? "Merge failed");
      setBusy(null);
      return;
    }
    cancelDelete();
    await reload();
    setBusy(null);
  }

  async function handleDelete(id: string) {
    setBusy(id);
    const res = await fetch("/api/clients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Failed to remove client");
      setBusy(null);
      return;
    }
    setClients(prev => prev.filter(x => x.id !== id));
    cancelDelete();
    setBusy(null);
  }

  if (loading) return <p className="text-sm py-8 text-center" style={{ color: "#334155" }}>Loading…</p>;

  const q = query.trim().toLowerCase();
  const matched = clients.filter(c => {
    if (!offerVisibleForStatusFilter(c.lifecycle_status, statusFilter)) return false;
    if (offerFilter !== "all" && normalizeReportingType(c.reporting_type) !== offerFilter) return false;
    if (packageFilter === "core_offer" && normalizeSalesPackage(c.sales_package) !== "core_offer") return false;
    if (packageFilter === "mid_offer" && normalizeSalesPackage(c.sales_package) !== "mid_offer") return false;
    if (packageFilter === "skool" && normalizeSalesPackage(c.sales_package) !== "skool") return false;
    if (packageFilter === "unset" && c.sales_package) return false;
    if (adsFilter === "paused" && !c.ads_paused) return false;
    if (adsFilter === "on" && c.ads_paused) return false;
    if (!q) return true;
    return clientMatchesQuery(c, q);
  });
  const grouped = groupAccountsBySection(groupClientsIntoAccounts(matched));
  // All chip excludes offboarded/churned; section chips keep full counts so tabs stay discoverable.
  const accountTotal = countRosterAccounts(
    clients.filter(c => offerVisibleForStatusFilter(c.lifecycle_status, "all")),
  );
  const counts = groupAccountsBySection(groupClientsIntoAccounts(clients));
  const isFiltering = q.length > 0 || statusFilter !== "all" || offerFilter !== "all" || packageFilter !== "all" || adsFilter !== "all";
  const adsPausedCount = clients.filter(c => c.ads_paused).length;
  const visibleSections = ROSTER_SECTIONS.filter(s => statusFilter === "all" || s.key === statusFilter);
  const matchTotal = visibleSections.reduce((n, s) => n + grouped[s.key].length, 0);

  function toggleAccountExpanded(accountGroupId: string) {
    setCollapsedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(accountGroupId)) next.delete(accountGroupId);
      else next.add(accountGroupId);
      return next;
    });
  }

  function openClientFile(
    id: string,
    name: string,
    opts?: {
      openKickoff?: boolean;
      openAddOffer?: boolean;
      scrollToNotes?: boolean;
      scrollToCalls?: boolean;
      openCheckinForm?: boolean;
    },
  ) {
    setFileFor({ id, name, ...opts });
  }

  function openAddOfferModal(ctx: {
    originClientId: string;
    accountDisplayName: string;
    existingReportingTypes: string[];
    accountGroupId?: string;
  }) {
    setAddOfferFor(ctx);
  }

  async function handleOfferCreated(id: string, name: string, accountGroupId?: string) {
    setAddOfferFor(null);
    if (accountGroupId) {
      setCollapsedAccounts(prev => {
        const next = new Set(prev);
        next.delete(accountGroupId);
        return next;
      });
    }
    await reload();
    openClientFile(id, name, { openKickoff: true });
  }

  function renderClientRow(
    c: Client,
    opts: {
      key: string;
      striped: boolean;
      variant: "standalone" | "subaccount";
    },
  ) {
    return (
      <ClientRow
        key={opts.key}
        client={c}
        variant={opts.variant}
        allClients={clients}
        columns={columns}
        colSpan={colSpan}
        striped={opts.striped}
        busy={busy === c.id}
        confirmingDelete={confirmDelete === c.id}
        deleteSummary={confirmDelete === c.id ? deleteSummary : null}
        mergeTargetId={mergeTargetId}
        onMergeTargetChange={setMergeTargetId}
        actionsOpen={actionsFor === c.id}
        onToggleActions={() => setActionsFor(prev => (prev === c.id ? null : c.id))}
        onRequestStatusChange={target => requestStatusChange(c, target)}
        onPatch={patchClient}
        onAdsUpdated={(id, next) =>
          setClients(prev => prev.map(x => (x.id === id ? { ...x, ...next } : x)))
        }
        onOpenFile={() => openClientFile(c.id, c.name)}
        onOpenKickoff={() => setKickoffFor({ id: c.id, name: c.name })}
        onOpenLaunch={() => setLaunchFor({ id: c.id, name: c.name })}
        onOpenTechQa={() => setQaFor({ id: c.id, name: c.name, lane: "tech_setup" })}
        onOpenMediaQa={() => setQaFor({ id: c.id, name: c.name, lane: "media_buying" })}
        onOpenCreativeQa={() => setQaFor({ id: c.id, name: c.name, lane: "creative" })}
        onOpenLaunchKit={() => setLaunchKitFor({ id: c.id, name: c.name })}
        onOpenVirtualCard={() => setVirtualCardFor({ id: c.id, name: c.name })}
        onOpenOffboard={() => setOffboardFor({ id: c.id, name: c.name })}
        onOpenNotes={() => openClientFile(c.id, c.name, { scrollToNotes: true })}
        onOpenCalls={() => openClientFile(c.id, c.name, { scrollToCalls: true })}
        onLogCheckin={() => openClientFile(c.id, c.name, { scrollToCalls: true, openCheckinForm: true })}
        onAddOffer={() =>
          openAddOfferModal({
            originClientId: c.id,
            accountDisplayName:
              c.account_display_name || c.primary_contact_name || c.primary_contact || c.name,
            existingReportingTypes: c.reporting_type ? [c.reporting_type] : [],
            accountGroupId: c.account_group_id ?? undefined,
          })
        }
        onAskDelete={() => askDelete(c)}
        onCancelDelete={cancelDelete}
        onMerge={() => handleMerge(c.id)}
        onDelete={() => handleDelete(c.id)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-6 md:pt-8">
      <div className="shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Client Roster</h2>
          <div className="relative">
            <button
              onClick={() => setShowInfo(s => !s)}
              className="w-5 h-5 rounded-full text-xs font-semibold flex items-center justify-center"
              style={{ color: showInfo ? "#e2e8f0" : "#64748b", background: showInfo ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid rgba(255,255,255,0.12)" }}
              title="How the roster works"
              aria-label="How the roster works"
            >
              i
            </button>
            {showInfo && (
              <div
                className="absolute left-0 top-7 z-30 w-80 rounded-xl p-4 text-xs leading-relaxed shadow-xl"
                style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8" }}
              >
                <p>One row per <strong style={{ color: "#cbd5e1" }}>client (LO)</strong>. Accounts with multiple GHL subaccounts expand to show each offer below. The <strong style={{ color: "#cbd5e1" }}>sub-account name</strong> must match the GHL location name — that is how leads map in.</p>
                <p className="mt-2">Only <strong style={{ color: "#cbd5e1" }}>Active</strong> (launched) clients feed dashboard reporting and the &ldquo;Live Clients&rdquo; filter. Open a subaccount&rsquo;s file for billing, kick-off, and GHL mapping per offer.</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={reinstateFormHref()}
            className="text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap"
            style={{ color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)" }}
          >
            Client reinstate
          </Link>
          <Link
            href={churnFormHref()}
            className="text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap"
            style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            Churn offboarding
          </Link>
          {sectionTab === "clients" && (
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap"
              style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}
            >
              + Add client
            </button>
          )}
        </div>
      </div>

      <ViewHub
        tabs={[
          { key: "clients", label: "Clients" },
          {
            key: "forms",
            label: unmappedCount > 0 ? `Form submissions (${unmappedCount})` : "Form submissions",
          },
        ]}
        activeTab={sectionTab}
        onTabChange={key => changeSectionTab(key as "clients" | "forms")}
      >
        {sectionTab === "forms" ? (
          <FormSubmissionsTab
            onOpenClient={(id, name) => openClientFile(id, name)}
            onResolved={() => {
              void reload();
              void refreshUnmappedCount();
            }}
          />
        ) : (
          <div className="flex flex-col gap-6">
      <div className="empty:hidden"><PendingFormSubmissionsPanel onResolved={reload} /></div>

      <div className="empty:hidden"><PendingEventsPanel onReplayed={reload} /></div>

      {loadError && (
        <div className="rounded-xl px-4 py-3 text-sm text-red-400 bg-red-950/40 border border-red-500/30">
          Could not load clients: {loadError}
        </div>
      )}

      {clients.length === 0 ? (
        <div className="rounded-xl px-4 py-8 text-center text-sm" style={{ border: "1px solid rgba(255,255,255,0.06)", color: "#334155" }}>
          {loadError ? "Client list unavailable." : "No clients yet. Add one above."}
        </div>
      ) : (
        <div style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div
            className="sticky top-0 z-30 -mx-6 md:-mx-8 px-6 md:px-8"
            style={{
              background: "#080f1e",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              className="flex flex-col"
              style={{ background: "#0a1628" }}
            >
          <div
            className="flex items-center gap-3 flex-wrap px-3 py-2.5"
          >
            <div className="relative flex-1 min-w-[14rem]">
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "#475569" }}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by client, sub-account, state, or ClickUp ID…"
                className="w-full pl-9 pr-8 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm leading-none"
                  style={{ color: "#64748b" }}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "#64748b" }}>
                Status
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {([{ key: "all", label: "All" }, ...ROSTER_SECTIONS] as const).map(opt => {
                  const isAll = opt.key === "all";
                  const count = isAll ? accountTotal : counts[opt.key as SectionKey].length;
                  const active = statusFilter === opt.key;
                  const accent = isAll ? "#94a3b8" : SECTION_ACCENT[opt.key as SectionKey];
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setStatusFilter(opt.key as SectionKey | "all")}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5"
                      style={{
                        color: active ? "#e2e8f0" : "#64748b",
                        background: active ? "rgba(255,255,255,0.07)" : "transparent",
                        border: `1px solid ${active ? "rgba(255,255,255,0.14)" : "transparent"}`,
                      }}
                    >
                      {!isAll && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
                      {opt.label}
                      <span style={{ color: active ? accent : "#475569" }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "#64748b" }}>
                View
              </span>
              <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.1)" }} title="Choose which columns are most relevant to your role">
                {ROSTER_VIEWS.map(v => {
                  const active = rosterView === v.key;
                  return (
                    <button
                      key={v.key}
                      onClick={() => changeRosterView(v.key)}
                      className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-colors"
                      style={{
                        color: active ? "#e2e8f0" : "#64748b",
                        background: active ? "rgba(56,189,248,0.14)" : "transparent",
                      }}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "#64748b" }}>
                Refine
              </span>
              <button
                type="button"
                onClick={() => changeFiltersOpen(!filtersOpen)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap flex items-center gap-1.5"
                style={{
                  color: secondaryFilterCount > 0 || filtersOpen ? "#93c5fd" : "#64748b",
                  background: filtersOpen ? "rgba(59,130,246,0.12)" : "transparent",
                  border: `1px solid ${
                    secondaryFilterCount > 0 || filtersOpen
                      ? "rgba(59,130,246,0.45)"
                      : "rgba(255,255,255,0.12)"
                  }`,
                }}
                aria-expanded={filtersOpen}
              >
                Filters
                {secondaryFilterCount > 0 && (
                  <span
                    className="text-[10px] font-semibold px-1.5 rounded-full"
                    style={{ background: "#2563eb", color: "#fff" }}
                  >
                    {secondaryFilterCount}
                  </span>
                )}
                <span aria-hidden>{filtersOpen ? "▴" : "▾"}</span>
              </button>
            </div>
          </div>

          {filtersOpen && (
            <div
              className="flex flex-wrap items-end gap-4 px-3 pb-2.5"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex flex-col gap-1 pt-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "#64748b" }}>
                  Vertical
                </span>
                <div className="flex items-center gap-1 flex-wrap" title="Filter by client vertical">
                  <button
                    onClick={() => setOfferFilter("all")}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                    style={{
                      color: offerFilter === "all" ? "#e2e8f0" : "#64748b",
                      background: offerFilter === "all" ? "rgba(255,255,255,0.07)" : "transparent",
                      border: `1px solid ${offerFilter === "all" ? "rgba(255,255,255,0.14)" : "transparent"}`,
                    }}
                  >
                    All verticals
                  </button>
                  {REPORTING_TYPES.map(type => {
                    const active = offerFilter === type;
                    const meta = REPORTING_TYPE_META[type];
                    const count = countRosterAccounts(
                      clients.filter(c => normalizeReportingType(c.reporting_type) === type),
                    );
                    return (
                      <button
                        key={type}
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
              </div>
              <div className="flex flex-col gap-1 pt-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "#64748b" }}>
                  Package
                </span>
                <div className="flex items-center gap-1 flex-wrap" title="Filter by sales package">
                  {([
                    { key: "all", label: "All packages" },
                    { key: "core_offer", label: "Call Center" },
                    { key: "mid_offer", label: "Leads Only" },
                    { key: "skool", label: "Skool" },
                    { key: "unset", label: "Unset" },
                  ] as const).map(opt => {
                    const active = packageFilter === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setPackageFilter(opt.key)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                        style={{
                          color: active ? "#e2e8f0" : "#64748b",
                          background: active ? "rgba(255,255,255,0.07)" : "transparent",
                          border: `1px solid ${active ? "rgba(255,255,255,0.14)" : "transparent"}`,
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-1 pt-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "#64748b" }}>
                  Ads
                </span>
                <div className="flex items-center gap-1 flex-wrap" title="Filter by whether Meta/ads spend is on or paused">
                  {([
                    { key: "all", label: "All ads", count: clients.length },
                    { key: "on", label: "Ads on", count: clients.length - adsPausedCount },
                    { key: "paused", label: "Ads paused", count: adsPausedCount },
                  ] as const).map(opt => {
                    const active = adsFilter === opt.key;
                    const accent = opt.key === "paused" ? "#f59e0b" : opt.key === "on" ? "#34d399" : "#94a3b8";
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setAdsFilter(opt.key)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5"
                        style={{
                          color: active ? "#e2e8f0" : "#64748b",
                          background: active ? "rgba(255,255,255,0.07)" : "transparent",
                          border: `1px solid ${active ? "rgba(255,255,255,0.14)" : "transparent"}`,
                        }}
                      >
                        {opt.key !== "all" && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                        )}
                        {opt.label}
                        <span style={{ color: active ? accent : "#475569" }}>{opt.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {secondaryFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOfferFilter("all");
                    setPackageFilter("all");
                    setAdsFilter("all");
                  }}
                  className="text-xs font-medium px-2 py-1.5 rounded-lg self-end mb-0.5"
                  style={{ color: "#94a3b8" }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {isFiltering && (
            <p className="text-xs px-3 py-1.5" style={{ color: "#475569", background: "#080f1e" }}>
              {matchTotal === 0
                ? "No clients match your filters."
                : `Showing ${matchTotal} ${matchTotal === 1 ? "client" : "clients"}${q ? ` matching “${query.trim()}”` : ""}.`}
            </p>
          )}
            </div>
          </div>

          <div style={{ background: "#080f1e" }}>
            <table className="text-sm w-full min-w-[720px] border-separate border-spacing-0">
              <RosterColumnHead columns={columns} />
              <tbody>
                {visibleSections.map(section => {
                  const sectionAccounts = grouped[section.key];
                  if (isFiltering && sectionAccounts.length === 0) return null;
                  const accent = SECTION_ACCENT[section.key];
                  return (
                    <Fragment key={section.key}>
                      <RosterSectionRow
                        label={section.label}
                        count={sectionAccounts.length}
                        accent={accent}
                        colSpan={colSpan}
                      />
                      {sectionAccounts.length === 0 ? (
                        <tr className="bg-[#080f1e]">
                          <td colSpan={colSpan} className="px-4 py-6 text-center text-sm" style={{ color: "#334155" }}>
                            No clients in this group
                          </td>
                        </tr>
                      ) : (
                        sectionAccounts.map((group, i) => {
                          if (group.offers.length === 1) {
                            return renderClientRow(group.offers[0] as Client, {
                              key: group.offers[0].id,
                              striped: i % 2 === 0,
                              variant: "standalone",
                            });
                          }
                          const expanded = isFiltering || !collapsedAccounts.has(group.accountGroupId);
                          const combinedMrr = showRevenue
                            ? group.offers.reduce((sum, o) => sum + (typeof o.mrr === "number" ? o.mrr : 0), 0)
                            : null;
                          return (
                            <Fragment key={group.accountGroupId}>
                              <AccountGroupHeaderRow
                                group={group}
                                expanded={expanded}
                                striped={i % 2 === 0}
                                colSpan={colSpan}
                                showRevenue={showRevenue}
                                combinedMrr={combinedMrr}
                                onToggle={() => toggleAccountExpanded(group.accountGroupId)}
                                onOpenPrimary={() => {
                                  const primary = group.offers[0] as Client;
                                  openClientFile(primary.id, primary.name);
                                }}
                                onAddOffer={() => {
                                  const primary = group.offers[0] as Client;
                                  openAddOfferModal({
                                    originClientId: primary.id,
                                    accountDisplayName: rosterAccountDisplayName(group),
                                    existingReportingTypes: group.offers
                                      .map(o => o.reporting_type)
                                      .filter(Boolean) as string[],
                                    accountGroupId: group.accountGroupId,
                                  });
                                }}
                              />
                              {expanded &&
                                group.offers.map((c, j) =>
                                  renderClientRow(c as Client, {
                                    key: c.id,
                                    striped: j % 2 === 0,
                                    variant: "subaccount",
                                  }),
                                )}
                            </Fragment>
                          );
                        })
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
          </div>
        )}
      </ViewHub>

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
          style={{ background: "rgba(2,6,15,0.6)" }}
        >
          <div className="w-full max-w-3xl relative">
            <div className="absolute top-3 right-3 z-10">
              <ModalCloseButton onClose={() => setShowAdd(false)} />
            </div>
            <AddClientForm busy={busy} showRevenue={showRevenue} onCreate={createClient} onCancel={() => setShowAdd(false)} />
          </div>
        </div>
      )}

      <StatusChangeModal
        open={!!statusChange}
        clientName={statusChange?.clientName ?? ""}
        targetStatus={statusChange?.targetStatus ?? "paused"}
        saving={!!statusChange && busy === statusChange.clientId}
        onConfirm={confirmStatusChange}
        onCancel={() => setStatusChange(null)}
      />

      {kickoffFor && (
        <KickOffCallWizard
          clientId={kickoffFor.id}
          fallbackName={kickoffFor.name}
          onClose={() => setKickoffFor(null)}
          onCompleted={reload}
        />
      )}

      {launchFor && (
        <LaunchChecklistWizard
          clientId={launchFor.id}
          fallbackName={launchFor.name}
          onClose={() => setLaunchFor(null)}
          onCompleted={reload}
        />
      )}

      {qaFor && (
        <QaSkeletonWizard
          clientId={qaFor.id}
          lane={qaFor.lane}
          fallbackName={qaFor.name}
          onClose={() => setQaFor(null)}
          onCompleted={reload}
        />
      )}

      {launchKitFor && (
        <LaunchKitWizard
          clientId={launchKitFor.id}
          fallbackName={launchKitFor.name}
          onClose={() => setLaunchKitFor(null)}
          onGenerated={reload}
        />
      )}

      {virtualCardFor && (
        <VirtualCardWizard
          clientId={virtualCardFor.id}
          fallbackName={virtualCardFor.name}
          onClose={() => setVirtualCardFor(null)}
          onPublished={reload}
        />
      )}

      {offboardFor && (
        <ChurnOffboardingWizard
          clientId={offboardFor.id}
          fallbackName={offboardFor.name}
          onClose={() => setOffboardFor(null)}
          onCompleted={reload}
        />
      )}

      {addOfferFor && (
        <AddClientOfferModal
          originClientId={addOfferFor.originClientId}
          accountDisplayName={addOfferFor.accountDisplayName}
          existingReportingTypes={addOfferFor.existingReportingTypes}
          canViewRevenue={showRevenue}
          onClose={() => setAddOfferFor(null)}
          onCreated={({ id, name }) => void handleOfferCreated(id, name, addOfferFor.accountGroupId)}
        />
      )}

      {fileFor && (
        <ClientFile
          key={`${fileFor.id}-${fileFor.openCheckinForm ? "checkin" : fileFor.scrollToCalls ? "calls" : fileFor.scrollToNotes ? "notes" : "file"}-${fileFor.openKickoff ? "kickoff" : ""}-${fileFor.openAddOffer ? "addoffer" : ""}`}
          clientId={fileFor.id}
          fallbackName={fileFor.name}
          scrollToNotes={fileFor.scrollToNotes}
          scrollToCalls={fileFor.scrollToCalls}
          openCheckinForm={fileFor.openCheckinForm}
          openKickoff={fileFor.openKickoff}
          openAddOffer={fileFor.openAddOffer}
          onClose={() => setFileFor(null)}
          onUpdated={reload}
          onSwitchClient={(id, name) => openClientFile(id, name)}
          onOfferCreated={(id, name) => void handleOfferCreated(id, name, clients.find(c => c.id === fileFor.id)?.account_group_id ?? undefined)}
        />
      )}
    </div>
  );
}

function QualifyToggle({
  client,
  disabled,
  onPatch,
}: {
  client: Client;
  disabled: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  if (usesCallCenterKpiLayout(client.reporting_type)) {
    return (
      <span className="text-xs" style={{ color: "#334155" }} title="Call center rates stay on their own formulas">
        —
      </span>
    );
  }
  const on = dialPoolForClient(client.reporting_type, client.qualifies_leads) === "qualified";
  return (
    <label
      className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer"
      style={{ color: on ? "#4ade80" : "#94a3b8" }}
      title={
        on
          ? "On: we only dial and book qualified leads. Hand-raise % and conversation % use qualified leads."
          : "Off: we book every lead. Hand-raise % and conversation % use total leads."
      }
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={() => onPatch(client.id, { qualifies_leads: !on })}
        className="accent-emerald-400"
      />
      {on ? "On" : "Off"}
    </label>
  );
}

function AccountGroupHeaderRow({
  group,
  expanded,
  striped,
  colSpan,
  showRevenue,
  combinedMrr,
  onToggle,
  onOpenPrimary,
  onAddOffer,
}: {
  group: RosterAccountGroup;
  expanded: boolean;
  striped: boolean;
  colSpan: number;
  showRevenue: boolean;
  combinedMrr: number | null;
  onToggle: () => void;
  onOpenPrimary: () => void;
  onAddOffer: () => void;
}) {
  const name = rosterAccountDisplayName(group);
  const offerTypes = [...new Set(group.offers.map(o => normalizeReportingType(o.reporting_type)))];
  const rowBg = striped ? "bg-[#0b1424]" : "bg-[#080f1e]";

  return (
    <tr className={`${rowBg} border-t border-white/[0.05]`} style={{ background: striped ? "#0b1424" : "#080f1e" }}>
      <td colSpan={colSpan - 1} className="px-3 py-2.5 align-middle">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={onToggle}
            className="text-xs font-semibold w-6 h-6 rounded flex items-center justify-center shrink-0"
            style={{ color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
            aria-expanded={expanded}
            title={expanded ? "Collapse subaccounts" : "Expand subaccounts"}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span className="text-sm font-semibold truncate" style={{ color: "#e2e8f0" }} title={name}>
            {name}
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
            style={{ color: "#38bdf8", background: "rgba(56,189,248,0.12)" }}
          >
            {group.offers.length} subaccounts
          </span>
          {offerTypes.map(rt => (
            <ReportingTypeBadge key={rt} value={rt} size="sm" />
          ))}
          {group.primaryEmail && (
            <span className="text-xs truncate" style={{ color: "#64748b" }}>{group.primaryEmail}</span>
          )}
          {showRevenue && combinedMrr != null && combinedMrr > 0 && (
            <span className="text-xs" style={{ color: "#94a3b8" }}>{moneyShort(combinedMrr)} MRR total</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={onAddOffer}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}
            title="Add another offer / subaccount"
          >
            + Offer
          </button>
          <button
            type="button"
            onClick={onOpenPrimary}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{ color: "#38bdf8", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)" }}
            title="Open client file"
          >
            Open
          </button>
        </span>
      </td>
    </tr>
  );
}

function ClientRow({
  client, allClients, striped, busy, confirmingDelete, deleteSummary, mergeTargetId, onMergeTargetChange,   columns, colSpan, actionsOpen, onToggleActions, onRequestStatusChange, onPatch, onAdsUpdated, onOpenFile, onOpenKickoff, onOpenLaunch, onOpenTechQa, onOpenMediaQa, onOpenCreativeQa, onOpenLaunchKit, onOpenVirtualCard, onOpenOffboard, onOpenNotes, onOpenCalls, onLogCheckin, onAddOffer, onAskDelete, onCancelDelete, onMerge, onDelete, variant = "standalone",
}: {
  client: Client;
  allClients: Client[];
  columns: ColumnKey[];
  colSpan: number;
  striped: boolean;
  variant?: "standalone" | "subaccount";
  busy: boolean;
  confirmingDelete: boolean;
  deleteSummary: { id: string; name: string; summary: DataSummary } | null;
  mergeTargetId: string;
  onMergeTargetChange: (id: string) => void;
  actionsOpen: boolean;
  onToggleActions: () => void;
  onRequestStatusChange: (target: string) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onAdsUpdated: (id: string, next: { ads_paused?: boolean | null; ads_paused_at?: string | null; ads_paused_note?: string | null }) => void;
  onOpenFile: () => void;
  onOpenKickoff: () => void;
  onOpenLaunch: () => void;
  onOpenTechQa: () => void;
  onOpenMediaQa: () => void;
  onOpenCreativeQa: () => void;
  onOpenLaunchKit: () => void;
  onOpenVirtualCard: () => void;
  onOpenOffboard: () => void;
  onOpenNotes: () => void;
  onOpenCalls: () => void;
  onLogCheckin: () => void;
  onAddOffer: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const c = client;
  const isSubaccount = variant === "subaccount";
  const rowBg = striped ? "bg-[#0b1424]" : "bg-[#080f1e]";
  const cell = `px-3 py-2.5 align-middle${isSubaccount ? " pl-10" : ""}`;
  const clientName = c.primary_contact_name ?? c.primary_contact ?? "";
  const usesCustomGoal = !!c.kpi_benchmarks?.cpl && Object.keys(c.kpi_benchmarks.cpl).length > 0;
  const kickoffPending = isKickoffIncomplete(c, null, !!c.form_progress?.kickoff);
  const needsGhlMapping = clientNeedsGhlMapping(c);
  const showKickoffAction = isKickoffLifecycle(c.lifecycle_status) || kickoffPending;
  const showLaunchAction = c.lifecycle_status === "onboarding" || c.lifecycle_status === "new_account";
  const showQaAction = isQaLifecycle(c.lifecycle_status);
  const showLaunchKitAction = isLaunchKitLifecycle(c.lifecycle_status);
  const techQaDone = !!c.form_progress?.tech_qa;
  const mediaQaDone = !!c.form_progress?.marketing_qa;
  const creativeQaDone = !!c.form_progress?.creative;
  const launchKitDone = !!c.form_progress?.launch_kit;
  const virtualCardDone = !!c.virtual_business_card_url || !!c.form_progress?.virtual_card;
  const showOffboardAction = isChurnOffboardEligible(c.lifecycle_status);
  const showReinstateAction = c.lifecycle_status === "churned";

  const status = c.lifecycle_status ?? "active";
  const derivedLive = syncIsLiveWithLifecycle(status);
  const drift = derivedLive !== undefined && c.is_live !== undefined && derivedLive !== c.is_live;

  return (
    <>
    <tr className={`${rowBg} border-t border-white/[0.05] transition-colors hover:bg-[#0f1c30]`} style={isSubaccount ? { background: "#060d1a" } : undefined}>
      <td className={cell}>
        <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex items-center gap-2 min-w-0">
            {isSubaccount && (
              <span className="text-[10px] uppercase tracking-wide shrink-0" style={{ color: "#475569" }}>↳</span>
            )}
            <ReportingTypeBadge value={c.reporting_type} />
            <SalesPackageBadge value={c.sales_package} />
            {isSubaccount ? (
              <span className="text-sm font-medium truncate max-w-[16rem]" style={{ color: "#e2e8f0" }} title={`GHL sub-account: ${c.name ?? "—"}`}>
                {c.name || "—"}
              </span>
            ) : (
              <span className="text-sm font-medium truncate max-w-[16rem]" style={{ color: clientName ? "#e2e8f0" : "#475569" }} title={clientName || "No client name set"}>
                {clientName || "Unnamed client"}
              </span>
            )}
            {needsGhlMapping && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}
                title="GHL not linked yet — open Kick-off and set the exact location name + Location ID"
              >
                Map GHL
              </span>
            )}
          </span>
          {!isSubaccount && (
            <span className="text-xs truncate max-w-[18rem]" style={{ color: "#64748b" }} title={`GHL sub-account: ${c.name ?? "—"}`}>
              {c.name || "—"}
            </span>
          )}
          {isSubaccount && c.engagement_kind && c.engagement_kind !== "initial" && (
            <span className="text-[10px] uppercase tracking-wide" style={{ color: "#64748b" }}>
              {c.engagement_kind === "cross_sell" ? "Cross-sell" : "Upsell"}
            </span>
          )}
        </div>
      </td>
      <td className={cell}>
        <span className="flex items-center gap-1.5">
          <LifecycleStatusSelect value={status} disabled={busy} onRequestChange={onRequestStatusChange} />
          {kickoffPending && (
            <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#f59e0b" }} title="Kick-off call incomplete" />
          )}
          {drift && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
              style={{ color: c.is_live ? "#22c55e" : "#ef4444", background: c.is_live ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }}
              title={`Dashboard status manually overridden to ${c.is_live ? "Live" : "Offline"}, which differs from this lifecycle stage`}
            >
              {c.is_live ? "Live*" : "Offline*"}
            </span>
          )}
        </span>
      </td>
      {columns.map(key => (
        <td key={key} className={cell}>
          {key === "qualify" ? (
            <QualifyToggle client={c} disabled={busy} onPatch={onPatch} />
          ) : key === "ads" ? (
            <AdsPausedControl
              clientId={c.id}
              adsPaused={!!c.ads_paused}
              adsPausedNote={c.ads_paused_note}
              variant="row"
              disabled={busy}
              onUpdated={next => onAdsUpdated(c.id, next)}
            />
          ) : key === "drive" ? (
            c.drive_folder_url ? (
              <a
                href={c.drive_folder_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-xs font-medium whitespace-nowrap"
                style={{ color: "#38bdf8" }}
                title="Open Drive folder"
              >
                Drive ↗
              </a>
            ) : (
              <span className="text-xs" style={{ color: "#334155" }}>—</span>
            )
          ) : key === "ad_account" ? (
            c.ad_account_url ? (
              <a
                href={c.ad_account_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-xs font-medium truncate max-w-[9rem] inline-block align-bottom"
                style={{ color: "#38bdf8" }}
                title={c.ad_account_name?.trim() || c.ad_account_url}
              >
                {c.ad_account_name?.trim() || "Ads Manager"} ↗
              </a>
            ) : c.ad_account_name?.trim() ? (
              <span className="text-xs truncate max-w-[9rem] inline-block" style={{ color: "#cbd5e1" }} title={c.ad_account_name}>
                {c.ad_account_name}
              </span>
            ) : (
              <span className="text-xs" style={{ color: "#334155" }}>—</span>
            )
          ) : key === "sites" ? (
            <ClientSitesCell
              stopRowClick
              urls={{
                website: c.website,
                landing_page_url: c.landing_page_url,
                funnel_url: c.funnel_url,
                thank_you_page_url: c.thank_you_page_url,
              }}
            />
          ) : (
            COLUMN_DEFS[key].render(c)
          )}
        </td>
      ))}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {confirmingDelete ? (
          <div className="flex flex-col items-end gap-2 max-w-md ml-auto">
            {deleteSummary && deleteSummary.summary.total_rows > 0 && (
              <p className="text-xs text-right leading-relaxed" style={{ color: deleteSummary.summary.events > 0 ? "#f87171" : "#f59e0b" }}>
                {deleteSummary.summary.events > 0
                  ? `This row has ${deleteSummary.summary.events.toLocaleString()} lead/dial events. Removing it permanently deletes all reporting data.`
                  : `This row has ${deleteSummary.summary.total_rows.toLocaleString()} related records (billing, calls, notes).`}
                {" "}To combine duplicates, merge into the file you want to keep instead.
              </p>
            )}
            {deleteSummary && deleteSummary.summary.total_rows > 0 && (
              <label className="flex flex-col items-end gap-1 w-full">
                <span className="text-xs" style={{ color: "#64748b" }}>Merge into client file to keep</span>
                <select
                  value={mergeTargetId}
                  onChange={e => onMergeTargetChange(e.target.value)}
                  className="px-2 py-1 rounded-lg text-xs outline-none w-full max-w-xs"
                  style={fieldStyle()}
                >
                  <option value="">Select client…</option>
                  {allClients
                    .filter(x => x.id !== client.id)
                    .map(x => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                </select>
              </label>
            )}
            <span className="flex items-center justify-end gap-2 flex-wrap">
              {deleteSummary && deleteSummary.summary.total_rows > 0 && (
                <button
                  onClick={onMerge}
                  disabled={busy || !mergeTargetId}
                  className="text-xs font-semibold px-2 py-1 rounded"
                  style={{ color: "#22c55e", background: "rgba(34,197,94,0.12)" }}
                >
                  Merge
                </button>
              )}
              <button onClick={onDelete} disabled={busy} className="text-xs font-semibold px-2 py-1 rounded" style={{ color: "#ef4444", background: "rgba(239,68,68,0.12)" }}>Delete anyway</button>
              <button onClick={onCancelDelete} className="text-xs" style={{ color: "#475569" }}>Cancel</button>
            </span>
          </div>
        ) : (
          <span className="flex items-center justify-end gap-2">
            <button
              onClick={onOpenFile}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors"
              style={{ color: "#38bdf8", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)" }}
              title="Open this client's file"
            >
              Open
            </button>
            <button
              onClick={onToggleActions}
              className="text-sm font-semibold px-2 py-1 rounded-lg leading-none transition-colors"
              style={{
                color: actionsOpen ? "#e2e8f0" : "#64748b",
                background: actionsOpen ? "rgba(255,255,255,0.08)" : "transparent",
                border: `1px solid ${actionsOpen ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)"}`,
              }}
              title="More actions"
              aria-label="More actions"
              aria-expanded={actionsOpen}
            >
              ⋯
            </button>
          </span>
        )}
      </td>
    </tr>
    {actionsOpen && !confirmingDelete && (
      <tr style={{ background: "#050c18" }}>
        <td colSpan={colSpan} className="px-4 py-3 border-t border-white/[0.04]">
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
            {showKickoffAction && (
              <ActionButton onClick={onOpenKickoff} color={kickoffPending ? "#f59e0b" : "#22c55e"} title={kickoffPending ? "Kick-off call incomplete" : "Open kick-off call wizard"}>
                Kick-off{kickoffPending ? " ⚠" : ""}
              </ActionButton>
            )}
            {showLaunchKitAction && (
              <ActionButton
                onClick={onOpenLaunchKit}
                color={launchKitDone ? "#4FA3FF" : kickoffPending ? "#64748b" : "#4FA3FF"}
                title={launchKitDone ? "Launch Kit on file — view, regenerate, or send" : kickoffPending ? "Launch Kit — complete kick-off first" : "Generate the client Launch Kit PDF"}
              >
                Kit{launchKitDone ? " ✓" : ""}
              </ActionButton>
            )}
            <ActionButton
              onClick={onOpenVirtualCard}
              color={virtualCardDone ? "#a78bfa" : "#c4b5fd"}
              title={
                virtualCardDone
                  ? `Virtual Business Card live${c.virtual_business_card_url ? `: ${c.virtual_business_card_url}` : ""}`
                  : "Publish virtual business card on loanofficer.me"
              }
            >
              Card{virtualCardDone ? " ✓" : ""}
            </ActionButton>
            {showLaunchAction && (
              <ActionButton onClick={onOpenLaunch} color="#34d399" title="Launch checklist — mark client live">Launch</ActionButton>
            )}
            {showQaAction && (
              <>
                <ActionButton
                  onClick={onOpenTechQa}
                  color={techQaDone ? "#22c55e" : "#60a5fa"}
                  title="Tech Setup QA skeleton — writes Tech QA complete to ClickUp"
                >
                  Tech QA{techQaDone ? " ✓" : ""}
                </ActionButton>
                <ActionButton
                  onClick={onOpenMediaQa}
                  color={mediaQaDone ? "#22c55e" : "#fb923c"}
                  title="Media Buying QA skeleton — writes Marketing QA complete to ClickUp"
                >
                  Media QA{mediaQaDone ? " ✓" : ""}
                </ActionButton>
                <ActionButton
                  onClick={onOpenCreativeQa}
                  color={creativeQaDone ? "#22c55e" : "#e879f9"}
                  title="Creative QA — drive upload, NMLS fine line, and offer copy. Separate from Media Buying QA."
                >
                  Creative QA{creativeQaDone ? " ✓" : ""}
                </ActionButton>
              </>
            )}
            {showOffboardAction && (
              <ActionButton onClick={onOpenOffboard} color="#f87171" title="Open churn offboarding form">Offboard</ActionButton>
            )}
            {showReinstateAction && (
              <Link
                href={reinstateFormHref(c.id)}
                className="text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ color: "#4ade80" }}
                title="Open client reinstate form"
              >
                Reinstate
              </Link>
            )}
            <ActionButton onClick={onAddOffer} color="#22c55e" title="Add another product offer / GHL subaccount">
              + Offer
            </ActionButton>
            <span className="inline-block w-px h-4" style={{ background: "rgba(255,255,255,0.1)" }} aria-hidden />
            <ActionButton onClick={onLogCheckin} color="#38bdf8" title="Log a client check-in call">Check-in</ActionButton>
            <ActionButton onClick={onOpenCalls} color="#f59e0b" title="Add or view account calls">Calls</ActionButton>
            <ActionButton onClick={onOpenNotes} color="#a78bfa" title="Add or view client notes">Notes</ActionButton>
            <Link
              href={`/dashboard?view=client_health&tab=criteria&client=${c.id}`}
              className="text-xs font-semibold"
              style={{ color: usesCustomGoal ? "#38bdf8" : "#94a3b8" }}
              title={usesCustomGoal ? "Open custom goal on Criteria" : "Open Criteria"}
            >
              {usesCustomGoal ? "Criteria ●" : "Criteria"}
            </Link>
            {(c.onboarding_clickup_task_id || c.clickup_task_id) && (
              <a
                href={`https://app.clickup.com/t/${c.onboarding_clickup_task_id || c.clickup_task_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold transition-colors hover:underline"
                style={{ color: "#38bdf8" }}
                title="Open ClickUp Client Hub task"
              >
                ClickUp ↗
              </a>
            )}
            <span className="ml-auto">
              <button onClick={onAskDelete} className="text-xs font-medium text-slate-500 hover:text-red-400 transition-colors">Remove client</button>
            </span>
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

/** Compact text action used inside a row's expandable actions tray. */
function ActionButton({ onClick, color, title, children }: { onClick: () => void; color: string; title?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="text-xs font-semibold transition-opacity hover:opacity-80"
      style={{ color }}
    >
      {children}
    </button>
  );
}

function AddClientForm({
  busy, showRevenue, onCreate, onCancel,
}: {
  busy: string | null;
  showRevenue: boolean;
  onCreate: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [email, setEmail] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [reportingType, setReportingType] = useState<ReportingType>(DEFAULT_REPORTING_TYPE);
  const [lifecycle, setLifecycle] = useState("onboarding");
  const [billingType, setBillingType] = useState("");
  const [mrr, setMrr] = useState("");
  const [billingDay, setBillingDay] = useState("");
  const [launchDate, setLaunchDate] = useState("");
  const [dateSigned, setDateSigned] = useState("");
  const [contractTerm, setContractTerm] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [performanceTerms, setPerformanceTerms] = useState("");
  const [leadSource, setLeadSource] = useState("");

  const isBusy = busy === "create";
  const blocked = !!duplicateWarning;
  const disabled = isBusy || !name.trim() || blocked;

  useEffect(() => {
    if (!name.trim() && !clientName.trim() && !email.trim()) {
      setDuplicateWarning(null);
      return;
    }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (name.trim()) params.set("name", name.trim());
      if (clientName.trim()) params.set("primary_contact_name", clientName.trim());
      if (email.trim()) params.set("email", email.trim());
      const res = await fetch(`/api/clients/check-duplicate?${params}`);
      const d = await res.json().catch(() => ({}));
      setDuplicateWarning(d.blocked ? (d.message as string) : null);
    }, 350);
    return () => clearTimeout(timer);
  }, [name, clientName, email]);

  function submit() {
    onCreate({
      name: name.trim(),
      primary_contact_name: clientName,
      email,
      reporting_type: reportingType,
      lifecycle_status: lifecycle,
      billing_type: billingType,
      ...(showRevenue ? { mrr } : {}),
      billing_day: billingDay,
      launch_date: launchDate,
      date_signed: dateSigned,
      contract_term_months: contractTerm,
      contract_end_date: contractEnd,
      performance_terms: performanceTerms,
      source: leadSource || null,
    });
  }

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: "#0a1628", border: "1px solid rgba(34,197,94,0.2)" }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Add a new client</h3>
          <p className="text-xs mt-1 max-w-2xl" style={{ color: "#64748b" }}>
            Only use this if the client is not already in the roster from the New Client Form. If they signed up through the form, open their existing file and set the GHL sub-account name during kick-off.
          </p>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0"
            style={{ color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            Close ✕
          </button>
        )}
      </div>
      {duplicateWarning && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)" }}>
          {duplicateWarning}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Sub-account name (GHL)">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ken Adler's Office" className="px-2 py-1.5 rounded-lg text-sm outline-none w-full" style={fieldStyle()} />
        </Field>
        <Field label="Client name">
          <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. James Boisdenghein" className="px-2 py-1.5 rounded-lg text-sm outline-none w-full" style={fieldStyle()} />
        </Field>
        <Field label="Email">
          <input value={email} onChange={e => setEmail(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none w-full" style={fieldStyle()} />
        </Field>
        <Field label="Client vertical">
          <select value={reportingType} onChange={e => setReportingType(normalizeReportingType(e.target.value))} className="px-2 py-1.5 rounded-lg text-sm outline-none cursor-pointer" style={fieldStyle()}>
            <ReportingTypeSelectOptions />
          </select>
        </Field>
        <Field label="Lifecycle">
          <select value={lifecycle} onChange={e => setLifecycle(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none cursor-pointer" style={fieldStyle()}>
            <option value="onboarding">Onboarding</option>
            <option value="active">Active</option>
            <option value="new_account">New account</option>
          </select>
        </Field>
        <Field label="Lead source">
          <ClientLeadSourceSelect value={leadSource} onChange={setLeadSource} />
        </Field>
        <Field label="Billing type">
          <select value={billingType} onChange={e => setBillingType(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none cursor-pointer" style={fieldStyle()}>
            <option value="">Monthly (default)</option>
            <option value="monthly">Monthly</option>
            <option value="pif">PIF</option>
            <option value="pif_monthly">PIF + Monthly</option>
          </select>
        </Field>
        {showRevenue && (
          <Field label="Monthly $ (base)"><input type="number" value={mrr} onChange={e => setMrr(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none" style={fieldStyle()} /></Field>
        )}
        <Field label="Billing day (1-31)"><input type="number" min={1} max={31} value={billingDay} onChange={e => setBillingDay(e.target.value)} placeholder="defaults to launch day" className="px-2 py-1.5 rounded-lg text-sm outline-none" style={fieldStyle()} /></Field>
        <Field label="Launch date (billing anchor)"><input type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none" style={fieldStyle()} /></Field>
        <Field label="Date signed"><input type="date" value={dateSigned} onChange={e => setDateSigned(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none" style={fieldStyle()} /></Field>
        <Field label="Contract term (months)"><input type="number" value={contractTerm} onChange={e => setContractTerm(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none" style={fieldStyle()} /></Field>
        <Field label="Contract end"><input type="date" value={contractEnd} onChange={e => setContractEnd(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none" style={fieldStyle()} /></Field>
        <div className="col-span-2 md:col-span-4">
          <Field label="Performance terms (how perf pricing is calculated)"><input value={performanceTerms} onChange={e => setPerformanceTerms(e.target.value)} placeholder="e.g. $X per booked appointment over 20/mo" className="px-2 py-1.5 rounded-lg text-sm outline-none w-full" style={fieldStyle()} /></Field>
        </div>
      </div>
      <button onClick={submit} disabled={disabled} className="text-xs font-semibold px-4 py-2 rounded-lg" style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", opacity: disabled ? 0.5 : 1 }}>
        {isBusy ? "Creating…" : "Create client"}
      </button>
    </div>
  );
}
