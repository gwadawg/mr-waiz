"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import CheckinCallSummary from "@/components/CheckinCallSummary";
import ClientCallFormFields from "@/components/ClientCallFormFields";
import {
  defaultCallDraft,
  callDraftToApiBody,
  rowToCallDraft,
  validateCallDraft,
  type ClientCallDraft,
} from "@/lib/client-call-draft";
import {
  CALL_DISPOSITION_OPTIONS,
  callTypeLabel,
  dispositionLabel,
} from "@/lib/client-calls";
import {
  callLogHasDisplayContent,
  type StoredCallLogForm,
} from "@/lib/call-log-form";
import {
  LIFECYCLE_REASON_OPTIONS,
  NOTE_TYPE_OPTIONS,
  lifecycleStatusLabel,
  noteTypeLabel,
  reasonLabel,
} from "@/lib/client-feedback";
import ReportingTypeBadge, { ServiceProgramBadge } from "@/components/ReportingTypeBadge";
import { getReportingTypeLabel, usesCallCenterKpiLayout } from "@/lib/reporting-types";
import { getServiceProgramLabel } from "@/lib/service-program";
import { clientLeadSourceLabel } from "@/lib/client-lead-source";
import {
  accountShapeLabel,
  brandSubjectLabel,
  qualifiesLeadsLabel,
} from "@/lib/client-launch-setup";
import { formatStatesLicensed } from "@/lib/us-states";
import { timezoneLabel } from "@/lib/us-timezones";
import ClientContactsSection from "@/components/ClientContactsSection";
import ClientFileEditForm, { countMissingFields } from "@/components/ClientFileEditForm";
import { toDateInputValue } from "@/lib/client-dates";
import LifecycleStatusSelect from "@/components/LifecycleStatusSelect";
import AdsPausedControl from "@/components/AdsPausedControl";
import ClientFormsSection, { type FormSubmissionSummary } from "@/components/ClientFormsSection";
import LoanLogLinkSection from "@/components/loan-log/LoanLogLinkSection";
import KickOffCallWizard from "@/components/KickOffCallWizard";
import LaunchChecklistWizard from "@/components/LaunchChecklistWizard";
import LaunchKitWizard from "@/components/LaunchKitWizard";
import QaSkeletonWizard from "@/components/QaSkeletonWizard";
import VirtualCardWizard from "@/components/VirtualCardWizard";

const LandingPageForm = dynamic(
  () => import("@/components/landing-page/LandingPageForm"),
  { ssr: false },
);
import ChurnOffboardingWizard from "@/components/ChurnOffboardingWizard";
import { reinstateFormHref } from "@/lib/internal-forms";
import Link from "next/link";
import StatusChangeModal from "@/components/StatusChangeModal";
import ClientInterventionHistory from "@/components/ClientInterventionHistory";
import AccountWeekPlansClientHistory from "@/components/AccountWeekPlansClientHistory";
import ClientAccountOffersPanel from "@/components/ClientAccountOffersPanel";
import { requiresLifecycleFeedback } from "@/lib/client-feedback";
import { isKickoffIncomplete, isKickoffLifecycle } from "@/lib/kickoff";
import { cycleKickoffFiled } from "@/lib/reinstate-progress";
import { isLaunchKitLifecycle } from "@/lib/launch-kit/intake";
import type { ClientContact } from "@/lib/client-contacts";
import { csCallTypeLabel, type CsCallType } from "@/lib/cs-appointments";
import { isQaLifecycle, type QaLane } from "@/lib/qa-form";

// The client "file": a single place to oversee everything about one client.
// Profile, billing history, lifecycle transitions, and ongoing notes.

type FileBilling = {
  id: string;
  billed_on: string;
  due_date: string | null;
  amount: number;
  base_amount: number | null;
  performance_amount: number | null;
  late_fee: number | null;
  discount: number | null;
  passthrough_amount: number | null;
  amount_paid: number | null;
  status: string;
  paid_on: string | null;
  method: string | null;
  note: string | null;
  revenue_type: string | null;
  revenue_segment: string | null;
  lead_source: string | null;
  term_months: number | null;
  processing_fee: number | null;
  stripe_invoice_id?: string | null;
  stripe_payment_intent_id?: string | null;
  is_first_payment?: boolean | null;
  is_extension?: boolean | null;
  created_at: string;
};

type FileClient = {
  id: string;
  name: string;
  is_live: boolean | null;
  reporting_type: string | null;
  offer?: string | null;
  service_program?: string | null;
  lifecycle_status: string | null;
  client_stage: string | null;
  mrr: number | null;
  billing_type: string | null;
  billing_day: number | null;
  launch_date: string | null;
  date_signed: string | null;
  contract_end_date: string | null;
  contract_term_months: number | null;
  daily_adspend: number | null;
  ads_paused?: boolean | null;
  ads_paused_at?: string | null;
  ads_paused_note?: string | null;
  performance_terms: string | null;
  billing_email: string | null;
  primary_contact: string | null;
  primary_contact_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  website: string | null;
  drive_folder_url: string | null;
  funnel_url: string | null;
  virtual_business_card_url?: string | null;
  virtual_card_slug?: string | null;
  landing_page_url: string | null;
  brokerage_name: string | null;
  legal_business_name: string | null;
  nmls: string | null;
  city: string | null;
  state: string | null;
  states_licensed: string[] | null;
  timezone: string | null;
  ghl_location_id: string | null;
  phone_ghl: string | null;
  phone_live_transfer: string | null;
  phone_notifications: string | null;
  live_transfer_approved: boolean | null;
  appointment_watch: boolean | null;
  brand_subject?: string | null;
  account_shape?: string | null;
  team_routing_notes?: string | null;
  qualifies_leads?: boolean | null;
  qualification_notes?: string | null;
  offer_summary: string | null;
  facebook_page_name: string | null;
  instagram_handle: string | null;
  ad_account_name: string | null;
  ad_account_url: string | null;
  meta_pixel_id?: string | null;
  thank_you_page_url: string | null;
  second_landing_page_url: string | null;
  onboarding_clickup_task_id?: string | null;
  clickup_task_id?: string | null;
  created_at: string | null;
  churned_at: string | null;
  reinstated_at: string | null;
  welcome_back_token?: string | null;
};

type StatusHistoryEntry = {
  id: string;
  previous_status: string | null;
  new_status: string;
  reason_code: string | null;
  note: string | null;
  mrr_at_change: number | null;
  changed_at: string;
  source: string | null;
};

type ClientCall = {
  id: string;
  client_id?: string;
  call_type: string;
  called_at: string;
  recording_url: string | null;
  transcript: string | null;
  notes: string | null;
  attendees: string | null;
  checkin_form: StoredCallLogForm | null;
  duration_seconds: number | null;
  disposition: string | null;
  follow_up_due_at: string | null;
  created_by_label?: string | null;
  offer_label?: string | null;
  updated_at: string;
};

type ClientNote = {
  id: string;
  client_id?: string;
  note_type: string;
  reason_code: string | null;
  body: string;
  created_at: string;
  created_by_label?: string | null;
  updated_at?: string | null;
  offer_label?: string | null;
};

type ActivityRow = {
  source_id: string;
  activity_type: string;
  occurred_at: string;
  subtype: string | null;
  summary: string | null;
  source_table: string;
};

/** Legacy tab keys — mapped into account/offer tabs for deep links. */
type LegacyTabKey = "overview" | "records" | "activity" | "cs_calls" | "touchpoints" | "billing";

type AccountTabKey = "client" | "calls" | "contacts";
type OfferTabKey = "operations" | "records" | "cs" | "billing";

const ACCOUNT_TABS: { key: AccountTabKey; label: string }[] = [
  { key: "client", label: "Client" },
  { key: "calls", label: "Calls & notes" },
  { key: "contacts", label: "Contacts" },
];

const OFFER_TABS: { key: OfferTabKey; label: string }[] = [
  { key: "operations", label: "Operations" },
  { key: "records", label: "Forms & history" },
  { key: "cs", label: "CS & touchpoints" },
  { key: "billing", label: "Billing" },
];

function resolveInitialTabs(
  legacy: LegacyTabKey | undefined,
  opts: { scrollToCalls?: boolean; scrollToNotes?: boolean; openKickoff?: boolean },
): { account: AccountTabKey; offer: OfferTabKey } {
  if (legacy === "billing") return { account: "client", offer: "billing" };
  if (legacy === "records") return { account: "client", offer: "records" };
  if (legacy === "cs_calls" || legacy === "touchpoints") return { account: "client", offer: "cs" };
  if (legacy === "activity" || opts.scrollToCalls || opts.scrollToNotes) {
    return { account: "calls", offer: "operations" };
  }
  if (opts.openKickoff) return { account: "client", offer: "operations" };
  if (legacy === "overview") return { account: "client", offer: "operations" };
  return { account: "client", offer: "operations" };
}

const ACTIVITY_STYLE: Record<string, { color: string; bg: string }> = {
  lifecycle: { color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  call: { color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  note: { color: "#f472b6", bg: "rgba(244,114,182,0.12)" },
  action: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  billing: { color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  touchpoint: { color: "#2dd4bf", bg: "rgba(45,212,191,0.12)" },
  commitment: { color: "#f472b6", bg: "rgba(244,114,182,0.12)" },
  plan: { color: "#a3e635", bg: "rgba(163,230,53,0.12)" },
  task: { color: "#a3e635", bg: "rgba(163,230,53,0.12)" },
  health: { color: "#fb923c", bg: "rgba(251,146,60,0.12)" },
  mrr: { color: "#34d399", bg: "rgba(52,211,153,0.12)" },
};

const ACTION_SUBTYPE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  finding: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)", label: "Finding" },
  cadence: { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Cadence" },
  bet: { color: "#60a5fa", bg: "rgba(96,165,250,0.12)", label: "Bet" },
};

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  paid: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  partial: { color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  pending: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  overdue: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  failed: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  refunded: { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

const REVENUE_TYPE_LABEL: Record<string, string> = {
  mrr: "Retainer",
  pif: "PIF",
  performance: "Performance",
  passthrough: "Passthrough",
  upsell: "Upsell",
  one_off: "One-off",
};

const fieldStyle = {
  background: "#050c18",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
  borderRadius: "0.5rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.8125rem",
  outline: "none",
  width: "100%",
} as const;

function money(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const REINSTATE_BADGE_ACTIVE_MS = 90 * 24 * 60 * 60 * 1000;

function shouldShowReinstateBadge(
  reinstatedAt: string | null | undefined,
  lifecycle: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!reinstatedAt) return false;
  if (lifecycle === "onboarding" || lifecycle === "new_account") return true;
  if (lifecycle === "active") {
    const t = Date.parse(reinstatedAt);
    if (Number.isNaN(t)) return true;
    return now - t <= REINSTATE_BADGE_ACTIVE_MS;
  }
  return false;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ClientFile({
  clientId,
  fallbackName,
  onClose,
  onUpdated,
  onSwitchClient,
  onOfferCreated,
  scrollToNotes = false,
  scrollToCalls = false,
  openCheckinForm = false,
  openKickoff = false,
  openAddOffer = false,
  initialTab,
}: {
  clientId: string;
  fallbackName: string;
  onClose: () => void;
  onUpdated?: () => void;
  onSwitchClient?: (id: string, name: string) => void;
  onOfferCreated?: (id: string, name: string) => void;
  scrollToNotes?: boolean;
  scrollToCalls?: boolean;
  openCheckinForm?: boolean;
  openKickoff?: boolean;
  openAddOffer?: boolean;
  /** Open a specific tab (legacy deep links — mapped to account/offer tabs). */
  initialTab?: LegacyTabKey;
}) {
  const [client, setClient] = useState<FileClient | null>(null);
  const [pixelOptions, setPixelOptions] = useState<{ id: string; name: string }[]>([]);
  const [welcomeBackUrl, setWelcomeBackUrl] = useState<string | null>(null);
  const [welcomeBackCopied, setWelcomeBackCopied] = useState(false);
  const [billings, setBillings] = useState<FileBilling[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [formSubmissions, setFormSubmissions] = useState<FormSubmissionSummary[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [calls, setCalls] = useState<ClientCall[]>([]);
  const [identityClientId, setIdentityClientId] = useState<string>(clientId);
  const [accountDisplayName, setAccountDisplayName] = useState<string | null>(null);
  const [canViewRevenue, setCanViewRevenue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteType, setNoteType] = useState("general");
  const [noteReason, setNoteReason] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [callDraft, setCallDraft] = useState<ClientCallDraft>(() => defaultCallDraft(clientId, "checkin"));
  const [savingCall, setSavingCall] = useState(false);
  const [callDuration, setCallDuration] = useState("");
  const [callDisposition, setCallDisposition] = useState("");
  const [callFollowUp, setCallFollowUp] = useState("");
  // Deep links from the roster (logged via a remount key) decide the initial
  // tab + open composer, so no post-mount effect is needed.
  const initialTabs = resolveInitialTabs(initialTab, { scrollToCalls, scrollToNotes, openKickoff });
  const [accountTab, setAccountTab] = useState<AccountTabKey>(initialTabs.account);
  const [offerTab, setOfferTab] = useState<OfferTabKey>(initialTabs.offer);
  const [showCallComposer, setShowCallComposer] = useState(() => scrollToCalls || openCheckinForm);
  const [showNoteComposer, setShowNoteComposer] = useState(() => scrollToNotes);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteType, setEditNoteType] = useState("general");
  const [editNoteReason, setEditNoteReason] = useState("");
  const [editNoteBody, setEditNoteBody] = useState("");
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [expandedCallIds, setExpandedCallIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [statusChange, setStatusChange] = useState<{ targetStatus: string; pendingBody: Record<string, unknown> } | null>(null);
  const [showKickoff, setShowKickoff] = useState(openKickoff);
  const [showLaunch, setShowLaunch] = useState(false);
  const [showQaLane, setShowQaLane] = useState<QaLane | null>(null);
  const [showLaunchKit, setShowLaunchKit] = useState(false);
  const [showVirtualCard, setShowVirtualCard] = useState(false);
  const [showLanding, setShowLanding] = useState(false);
  const [showOffboard, setShowOffboard] = useState(false);
  const [offerRow, setOfferRow] = useState<{ name: string; reporting_type: string | null } | null>(null);
  const [csAppointments, setCsAppointments] = useState<
    Array<{
      id: string;
      scheduled_at: string;
      status: string;
      call_type: CsCallType | null;
      calendar_name: string | null;
    }>
  >([]);
  const [touchpointsOpen, setTouchpointsOpen] = useState<
    Array<{
      id: string;
      touchpoint_type: string;
      status: string;
      due_at: string;
      slack_snippet: string | null;
    }>
  >([]);
  const [touchpointsHistory, setTouchpointsHistory] = useState<
    Array<{
      id: string;
      touchpoint_type: string;
      status: string;
      due_at: string;
      completed_at: string | null;
      slack_snippet: string | null;
    }>
  >([]);
  const [touchpointLabels, setTouchpointLabels] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      fetch(`/api/clients/${clientId}`).then(r => r.json()),
      fetch(`/api/clients/${clientId}/activity?limit=80`).then(r => r.json()),
      fetch(`/api/clients/${clientId}/relationship`).then(r => r.json()),
    ])
      .then(async ([d, activityRes, relationshipRes]) => {
        if (d.error) {
          setError(d.error);
          setPixelOptions([]);
          setWelcomeBackUrl(null);
          setCsAppointments([]);
          setTouchpointsOpen([]);
          setTouchpointsHistory([]);
        } else {
          setClient(d.client ?? null);
          setPixelOptions(Array.isArray(d.pixel_options) ? d.pixel_options : []);
          setWelcomeBackUrl(
            typeof d.welcome_back_url === "string" && d.welcome_back_url.trim()
              ? d.welcome_back_url.trim()
              : null,
          );
          setOfferRow(d.offer ? { name: d.offer.name, reporting_type: d.offer.reporting_type ?? null } : null);
          setBillings(d.billings ?? []);
          setStatusHistory(d.status_history ?? []);
          setFormSubmissions(d.form_submissions ?? []);
          if (typeof d.can_view_revenue === "boolean") setCanViewRevenue(d.can_view_revenue);
          if (d.identity_client_id) setIdentityClientId(d.identity_client_id);
          setError(null);

          if (!relationshipRes.error) {
            setIdentityClientId(relationshipRes.identity_client_id ?? d.identity_client_id ?? clientId);
            setAccountDisplayName(relationshipRes.account_display_name ?? null);
            setCalls(relationshipRes.calls ?? []);
            setNotes(relationshipRes.notes ?? []);
            setContacts(relationshipRes.contacts ?? []);
          } else {
            setNotes(d.notes ?? []);
            setContacts(d.contacts ?? []);
            setCalls(d.calls ?? []);
          }

          const clickupId = (
            (d.client?.onboarding_clickup_task_id as string | null | undefined)?.trim() ||
            (d.client?.clickup_task_id as string | null | undefined)?.trim()
          );
          if (clickupId) {
            try {
              const csRes = await fetch(
                `/api/cs-appointments?onboarding_clickup_task_id=${encodeURIComponent(clickupId)}&history=1`,
              );
              const csData = await csRes.json().catch(() => ({}));
              setCsAppointments(csRes.ok ? (csData.appointments ?? []) : []);
            } catch {
              setCsAppointments([]);
            }
          } else {
            setCsAppointments([]);
          }

          try {
            const tpRes = await fetch(`/api/clients/${clientId}/touchpoints`);
            const tpData = await tpRes.json().catch(() => ({}));
            if (tpRes.ok) {
              setTouchpointsOpen(tpData.open ?? []);
              setTouchpointsHistory(tpData.history ?? []);
              setTouchpointLabels(tpData.labels ?? {});
            } else {
              setTouchpointsOpen([]);
              setTouchpointsHistory([]);
            }
          } catch {
            setTouchpointsOpen([]);
            setTouchpointsHistory([]);
          }
        }
        setActivities(activityRes.activities ?? []);
        setLoading(false);
      })
      .catch(e => {
        setError(String(e));
        setLoading(false);
      });
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) { setEditing(false); setSaveError(null); }
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  const summary = useMemo(() => {
    let collected = 0, retainer = 0, performance = 0, passthrough = 0;
    let lastPaidOn: string | null = null;
    for (const b of billings) {
      collected += Number(b.amount_paid) || 0;
      retainer += Number(b.base_amount) || 0;
      performance += Number(b.performance_amount) || 0;
      passthrough += Number(b.passthrough_amount) || 0;
      if (b.paid_on && (!lastPaidOn || b.paid_on > lastPaidOn)) lastPaidOn = b.paid_on;
    }
    return { collected, retainer, performance, passthrough, count: billings.length, lastPaidOn };
  }, [billings]);

  useEffect(() => {
    setCallDraft(defaultCallDraft(identityClientId, "checkin"));
  }, [identityClientId]);

  async function submitCall() {
    const validationError = validateCallDraft(callDraft, false);
    if (validationError) {
      alert(validationError);
      return;
    }

    setSavingCall(true);
    const res = await fetch(`/api/clients/${identityClientId}/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...callDraftToApiBody(callDraft),
        duration_seconds: callDuration.trim() ? Number(callDuration) : undefined,
        disposition: callDisposition || undefined,
        follow_up_due_at: callFollowUp ? new Date(callFollowUp).toISOString() : undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error ?? "Failed to save call");
      setSavingCall(false);
      return;
    }
    setCallDraft(defaultCallDraft(identityClientId, "checkin"));
    setCallDuration("");
    setCallDisposition("");
    setCallFollowUp("");
    setShowCallComposer(false);
    await load();
    onUpdated?.();
    setSavingCall(false);
  }

  async function saveCallEdit(
    call: ClientCall,
    form: {
      draft: ClientCallDraft;
      duration_seconds: string;
      disposition: string;
      follow_up_due_at: string;
    },
  ) {
    const validationError = validateCallDraft(form.draft, false);
    if (validationError) {
      alert(validationError);
      return false;
    }

    const callClientId = call.client_id ?? identityClientId;
    const res = await fetch(`/api/clients/${callClientId}/calls/${call.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...callDraftToApiBody(form.draft),
        duration_seconds: form.duration_seconds.trim() ? Number(form.duration_seconds) : null,
        disposition: form.disposition || null,
        follow_up_due_at: form.follow_up_due_at ? new Date(form.follow_up_due_at).toISOString() : null,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error ?? "Failed to update call");
      return false;
    }
    setEditingCallId(null);
    await load();
    onUpdated?.();
    return true;
  }

  async function deleteCall(call: ClientCall) {
    if (!confirm("Remove this call from the client file? (Soft-delete — can be restored from DB.)")) return;
    const callClientId = call.client_id ?? identityClientId;
    const res = await fetch(`/api/clients/${callClientId}/calls/${call.id}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error ?? "Failed to remove call");
      return;
    }
    await load();
    onUpdated?.();
  }

  function startNoteEdit(note: ClientNote) {
    setEditingNoteId(note.id);
    setEditNoteType(note.note_type);
    setEditNoteReason(note.reason_code ?? "");
    setEditNoteBody(note.body);
  }

  async function saveNoteEdit(noteId: string) {
    const body = editNoteBody.trim();
    if (!body) return;
    setSavingNoteEdit(true);
    const noteClientId = notes.find(n => n.id === noteId)?.client_id ?? identityClientId;
    const res = await fetch(`/api/clients/${noteClientId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body,
        note_type: editNoteType,
        reason_code: editNoteReason || null,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error ?? "Failed to update note");
      setSavingNoteEdit(false);
      return;
    }
    setEditingNoteId(null);
    await load();
    onUpdated?.();
    setSavingNoteEdit(false);
  }

  async function deleteNote(noteId: string) {
    if (!confirm("Remove this note?")) return;
    const noteClientId = notes.find(n => n.id === noteId)?.client_id ?? identityClientId;
    const res = await fetch(`/api/clients/${noteClientId}/notes/${noteId}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error ?? "Failed to remove note");
      return;
    }
    await load();
    onUpdated?.();
  }

  function toggleCallExpanded(id: string) {
    setExpandedCallIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitNote() {
    const body = noteBody.trim();
    if (!body) return;
    setSavingNote(true);
    const res = await fetch(`/api/clients/${identityClientId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note_type: noteType,
        reason_code: noteReason || undefined,
        body,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error ?? "Failed to save note");
      setSavingNote(false);
      return;
    }
    setNoteBody("");
    setNoteReason("");
    setNoteType("general");
    setShowNoteComposer(false);
    await load();
    onUpdated?.();
    setSavingNote(false);
  }

  async function commitProfileSave(body: Record<string, unknown>) {
    setSavingProfile(true);
    setSaveError(null);
    const res = await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(typeof d.error === "string" ? d.error : "Save failed");
      setSavingProfile(false);
      return false;
    }
    if (d.client) setClient(d.client);
    setEditing(false);
    setStatusChange(null);
    await load();
    onUpdated?.();
    setSavingProfile(false);
    return true;
  }

  async function saveProfile(body: Record<string, unknown>) {
    if (!body.name) {
      setSaveError("Sub-account name is required.");
      return;
    }
    const newLifecycle = typeof body.lifecycle_status === "string" ? body.lifecycle_status : null;
    const currentLifecycle = client?.lifecycle_status ?? null;
    if (newLifecycle === "churned" && newLifecycle !== currentLifecycle) {
      setEditing(false);
      setShowOffboard(true);
      return;
    }
    if (
      newLifecycle &&
      newLifecycle !== currentLifecycle &&
      requiresLifecycleFeedback(newLifecycle)
    ) {
      setStatusChange({ targetStatus: newLifecycle, pendingBody: body });
      return;
    }
    await commitProfileSave(body);
  }

  async function confirmLifecycleChange(reason: string | null, note: string) {
    if (!statusChange) return;
    const body = {
      ...statusChange.pendingBody,
      status_change_reason: reason,
      status_change_note: note || undefined,
    };
    await commitProfileSave(body);
  }

  const offerName = client?.name ?? fallbackName;
  const accountName =
    accountDisplayName ||
    client?.primary_contact_name ||
    client?.primary_contact ||
    offerName;
  const lifecycle = client?.lifecycle_status ?? "—";
  const missingCount = countMissingFields(client);
  const onboardingCall = calls.find(c => c.call_type === "onboarding") ?? null;
  const kickoffPending = client
    ? isKickoffIncomplete(client, onboardingCall, cycleKickoffFiled(formSubmissions))
    : false;
  const latestReinstate = formSubmissions.find(s => s.form_type === "reinstate") ?? null;
  const techQaDone = formSubmissions.some(s => s.form_type === "tech_qa" && s.status === "applied");
  const mediaQaDone = formSubmissions.some(s => s.form_type === "marketing_qa" && s.status === "applied");
  const welcomeBackObDone = !!(
    latestReinstate &&
    formSubmissions.some(
      s => s.form_type === "reinstate_onboarding" && s.submitted_at >= latestReinstate.submitted_at,
    )
  );
  const showReinstateBadge = shouldShowReinstateBadge(client?.reinstated_at, client?.lifecycle_status);
  const showWelcomeBackLink =
    !!welcomeBackUrl && showReinstateBadge && !!latestReinstate && !welcomeBackObDone;

  async function copyWelcomeBackUrl() {
    if (!welcomeBackUrl) return;
    try {
      await navigator.clipboard.writeText(welcomeBackUrl);
      setWelcomeBackCopied(true);
      window.setTimeout(() => setWelcomeBackCopied(false), 2000);
    } catch {
      setSaveError("Could not copy welcome-back link — select it and copy manually.");
    }
  }

  return (
    <>
    {showKickoff && (
      <KickOffCallWizard
        clientId={clientId}
        fallbackName={offerName}
        onClose={() => setShowKickoff(false)}
        onCompleted={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    {showLaunch && (
      <LaunchChecklistWizard
        clientId={clientId}
        fallbackName={offerName}
        onClose={() => setShowLaunch(false)}
        onCompleted={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    {showQaLane && (
      <QaSkeletonWizard
        clientId={clientId}
        lane={showQaLane}
        fallbackName={offerName}
        onClose={() => setShowQaLane(null)}
        onCompleted={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    {showLaunchKit && (
      <LaunchKitWizard
        clientId={clientId}
        fallbackName={offerName}
        onClose={() => setShowLaunchKit(false)}
        onGenerated={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    {showVirtualCard && (
      <VirtualCardWizard
        clientId={clientId}
        fallbackName={offerName}
        onClose={() => setShowVirtualCard(false)}
        onPublished={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    {showLanding && (
      <LandingPageForm
        clientId={clientId}
        fallbackName={offerName}
        onClose={() => setShowLanding(false)}
        onPublished={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    {showOffboard && (
      <ChurnOffboardingWizard
        clientId={clientId}
        fallbackName={offerName}
        onClose={() => setShowOffboard(false)}
        onCompleted={() => {
          load();
          onUpdated?.();
        }}
      />
    )}
    <StatusChangeModal
      open={!!statusChange}
      clientName={offerName}
      targetStatus={statusChange?.targetStatus ?? "paused"}
      saving={savingProfile}
      onConfirm={confirmLifecycleChange}
      onCancel={() => setStatusChange(null)}
    />
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(2,6,15,0.6)" }} onClick={editing ? undefined : onClose}>
      <div
        className="h-full w-full overflow-y-auto"
        style={{ maxWidth: 760, background: "#060d1a", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-6 py-4 flex items-start justify-between gap-4" style={{ background: "#0a1628", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold" style={{ color: "#e2e8f0" }}>{accountName}</h2>
              {client?.reporting_type && <ReportingTypeBadge value={client.reporting_type} size="md" />}
              {client?.service_program && <ServiceProgramBadge value={client.service_program} size="md" />}
              {client && !editing ? (
                <LifecycleStatusSelect
                  value={client.lifecycle_status}
                  disabled={savingProfile}
                  onRequestChange={target => saveProfile({ name: client.name, lifecycle_status: target })}
                />
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: "#cbd5e1", background: "rgba(148,163,184,0.12)" }}>{lifecycle}</span>
              )}
              {client && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={client.lifecycle_status === "active" ? { color: "#22c55e", background: "rgba(34,197,94,0.12)" } : { color: "#ef4444", background: "rgba(239,68,68,0.12)" }}>
                  {client.lifecycle_status === "active" ? "Live" : "Offline"}
                </span>
              )}
              {showReinstateBadge && (
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-semibold"
                  title={client?.reinstated_at ? `Reinstated ${formatDateTime(client.reinstated_at)}` : "Reinstated"}
                  style={{ color: "#c4b5fd", background: "rgba(167,139,250,0.14)" }}
                >
                  Reinstate
                </span>
              )}
              {showReinstateBadge && latestReinstate && (
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-semibold"
                  style={
                    welcomeBackObDone
                      ? { color: "#86efac", background: "rgba(34,197,94,0.12)" }
                      : { color: "#fbbf24", background: "rgba(251,191,36,0.12)" }
                  }
                >
                  {welcomeBackObDone ? "Welcome-back OB done" : "Welcome-back OB pending"}
                </span>
              )}
              {client && !editing && (
                <AdsPausedControl
                  clientId={clientId}
                  adsPaused={!!client.ads_paused}
                  adsPausedNote={client.ads_paused_note}
                  disabled={savingProfile}
                  onUpdated={next =>
                    setClient(prev => (prev ? { ...prev, ...next } : prev))
                  }
                />
              )}
              {client && editing && client.ads_paused && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}>
                  Ads paused
                </span>
              )}
              {!editing && missingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}>
                  {missingCount} field{missingCount === 1 ? "" : "s"} missing
                </span>
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: "#64748b" }}>
              {editing
                ? "Editing profile & billing setup"
                : (
                  <>
                    <span style={{ color: "#94a3b8" }}>Offer:</span>{" "}
                    <span style={{ color: "#cbd5e1" }}>{offerName}</span>
                    <span style={{ color: "#475569" }}> · lifecycle & billing are per subaccount</span>
                  </>
                )}
            </p>
            {showWelcomeBackLink && (
              <div
                className="mt-3 rounded-lg px-3 py-3 space-y-2"
                style={{
                  background: "rgba(251,191,36,0.08)",
                  border: "1px solid rgba(251,191,36,0.3)",
                }}
              >
                <p className="text-xs font-semibold" style={{ color: "#fbbf24" }}>
                  Welcome-back OB link — send to client
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={welcomeBackUrl}
                    onFocus={e => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[11px] font-mono outline-none"
                    style={{
                      background: "rgba(15,23,42,0.65)",
                      color: "#e2e8f0",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void copyWelcomeBackUrl()}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{ background: "#1e3a5f", color: "#e2e8f0" }}
                  >
                    {welcomeBackCopied ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={welcomeBackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{
                      color: "#fbbf24",
                      background: "rgba(251,191,36,0.12)",
                      border: "1px solid rgba(251,191,36,0.3)",
                    }}
                  >
                    Open
                  </a>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!loading && !error && client && !editing && (
              <>
                {isLaunchKitLifecycle(client.lifecycle_status) && (
                  <button
                    type="button"
                    onClick={() => setShowLaunchKit(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                    style={{ color: "#4FA3FF", background: "rgba(79,163,255,0.1)", border: "1px solid rgba(79,163,255,0.25)" }}
                    title="Generate or download the client Launch Kit PDF"
                  >
                    Kit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowVirtualCard(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{
                    color: "#c4b5fd",
                    background: "rgba(167,139,250,0.12)",
                    border: "1px solid rgba(167,139,250,0.3)",
                  }}
                  title={
                    client.virtual_business_card_url
                      ? `Virtual Business Card: ${client.virtual_business_card_url}`
                      : "Publish virtual business card on loanofficer.me"
                  }
                >
                  Card{client.virtual_business_card_url ? " ✓" : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLanding(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{
                    color: "#7dd3fc",
                    background: "rgba(125,211,252,0.12)",
                    border: "1px solid rgba(125,211,252,0.3)",
                  }}
                  title={
                    client.landing_page_url
                      ? `Primary landing page: ${client.landing_page_url}`
                      : "Publish a DSCR, reverse, or HomeSafe landing page"
                  }
                >
                  Landing{client.landing_page_url ? " ✓" : ""}
                </button>
                {(client.lifecycle_status === "onboarding" || client.lifecycle_status === "new_account") && (
                  <button
                    type="button"
                    onClick={() => setShowLaunch(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                    style={{ color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)" }}
                    title="Launch checklist — mark client live"
                  >
                    Launch
                  </button>
                )}
                {client.lifecycle_status !== "churned" && (
                  <button
                    type="button"
                    onClick={() => setShowOffboard(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                    style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
                  >
                    Offboard
                  </button>
                )}
                {client.lifecycle_status === "churned" && (
                  <Link
                    href={reinstateFormHref(client.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                    style={{ color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)" }}
                    title="Open client reinstate form"
                  >
                    Reinstate
                  </Link>
                )}
                <button
                  onClick={() => { setEditing(true); setSaveError(null); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{ color: "#38bdf8", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)" }}
                >
                  Edit
                </button>
              </>
            )}
            {editing && (
              <button
                onClick={() => { setEditing(false); setSaveError(null); }}
                disabled={savingProfile}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                style={{ color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", opacity: savingProfile ? 0.5 : 1 }}
              >
                Cancel edit
              </button>
            )}
            <button onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap" style={{ color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
              Close ✕
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm py-12 text-center" style={{ color: "#334155" }}>Loading file…</p>
        ) : error ? (
          <p className="text-sm py-12 text-center" style={{ color: "#ef4444" }}>{error}</p>
        ) : editing && client ? (
          <div className="px-6 py-5">
            <ClientFileEditForm
              key={`${client.id}-${client.churned_at ?? ""}-${client.launch_date ?? ""}-${client.date_signed ?? ""}-${client.onboarding_clickup_task_id ?? client.clickup_task_id ?? ""}-${client.billing_email ?? ""}-${client.offer ?? ""}-${client.ghl_location_id ?? ""}-${client.meta_pixel_id ?? ""}`}
              client={client}
              pixelOptions={pixelOptions}
              canViewRevenue={canViewRevenue}
              saving={savingProfile}
              saveError={saveError}
              onSave={saveProfile}
              onRequestOffboard={() => {
                setEditing(false);
                setShowOffboard(true);
              }}
            />
          </div>
        ) : (
          <div className="px-6 py-5 space-y-7">
            <div className="flex items-center gap-1 border-b border-white/[0.08]">
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-2" style={{ color: "#475569" }}>Client</span>
              {ACCOUNT_TABS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setAccountTab(t.key)}
                  className="px-3 py-2 text-sm font-semibold -mb-px transition-colors"
                  style={{
                    color: accountTab === t.key ? "#e2e8f0" : "#64748b",
                    borderBottom: `2px solid ${accountTab === t.key ? "#38bdf8" : "transparent"}`,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {accountTab === "client" && (
            <div className="space-y-7">
            <Section title="Client profile">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Shared across all offers for this loan officer. Edits here update every linked offer row.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Detail label="Client name" value={client?.primary_contact_name || client?.primary_contact} missing={!client?.primary_contact_name && !client?.primary_contact} />
                <Detail label="Email" value={client?.email} missing={!client?.email} />
                <Detail label="Billing email" value={client?.billing_email} missing={!client?.billing_email} />
                <Detail label="Phone" value={client?.phone} missing={!client?.phone} />
                <Detail label="Lead source" value={clientLeadSourceLabel(client?.source)} missing={!client?.source} />
                <Detail label="Company / brand" value={client?.legal_business_name} missing={!client?.legal_business_name} />
                <Detail label="Brokerage" value={client?.brokerage_name} missing={!client?.brokerage_name} />
                <Detail label="NMLS" value={client?.nmls} missing={!client?.nmls} />
                <Detail
                  label="Location"
                  value={[client?.city, client?.state].filter(Boolean).join(", ") || null}
                  missing={!client?.city && !client?.state}
                />
                <Detail label="Licensed in" value={formatStatesLicensed(client?.states_licensed)} wide missing={!client?.states_licensed?.length} />
                <Detail label="Timezone" value={timezoneLabel(client?.timezone)} missing={!client?.timezone} />
              </div>
            </Section>
            </div>
            )}

            {accountTab === "contacts" && (
            <div className="space-y-7">
            <Section title={`Contacts (${contacts.length + 1})`}>
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Team members and the primary LO — shared across all offers for this client.
              </p>
              <ClientContactsSection
                clientId={identityClientId}
                primary={{
                  primary_contact_name: client?.primary_contact_name ?? null,
                  primary_contact: client?.primary_contact ?? null,
                  email: client?.email ?? null,
                  billing_email: client?.billing_email ?? null,
                  phone: client?.phone ?? null,
                  nmls: client?.nmls ?? null,
                  states_licensed: client?.states_licensed ?? null,
                }}
                contacts={contacts}
                onReload={() => { void load(); }}
                onEditProfile={() => setEditing(true)}
              />
            </Section>
            </div>
            )}

            {accountTab === "calls" && (
            <div className="space-y-7">
            <p className="text-xs" style={{ color: "#64748b" }}>
              Relationship history with this loan officer — aggregated across all offers. New calls and notes are saved to the primary client record.
            </p>
            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "#cbd5e1" }}>
                  Client calls ({calls.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCallComposer(s => !s)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{ color: "#38bdf8", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)" }}
                >
                  {showCallComposer ? "Cancel" : "+ Log call"}
                </button>
              </div>

              {showCallComposer && (
              <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}>
                <ClientCallFormFields draft={callDraft} onChange={setCallDraft} disabled={savingCall} />
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Duration (sec)</span>
                    <input type="number" min={0} value={callDuration} disabled={savingCall} onChange={e => setCallDuration(e.target.value)} className="mt-1" style={fieldStyle} />
                  </label>
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Disposition</span>
                    <select value={callDisposition} disabled={savingCall} onChange={e => setCallDisposition(e.target.value)} className="mt-1 cursor-pointer" style={fieldStyle}>
                      <option value="">None</option>
                      {CALL_DISPOSITION_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Follow-up due</span>
                    <input type="datetime-local" value={callFollowUp} disabled={savingCall} onChange={e => setCallFollowUp(e.target.value)} className="mt-1" style={fieldStyle} />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={submitCall}
                  disabled={savingCall}
                  className="text-xs font-semibold px-3 py-2 rounded-lg"
                  style={{
                    color: callDraft.call_type === "checkin" ? "#38bdf8" : "#f59e0b",
                    background: callDraft.call_type === "checkin" ? "rgba(56,189,248,0.12)" : "rgba(245,158,11,0.12)",
                    border: callDraft.call_type === "checkin" ? "1px solid rgba(56,189,248,0.25)" : "1px solid rgba(245,158,11,0.25)",
                    opacity: savingCall ? 0.5 : 1,
                  }}
                >
                  {savingCall ? "Saving…" : "Save call"}
                </button>
              </div>
              )}

              {calls.length === 0 ? (
                <p className="text-sm py-4 text-center rounded-lg" style={{ color: "#334155", background: "#080f1e" }}>No account calls logged yet.</p>
              ) : (
                <div className="space-y-2">
                  {calls.map(call => (
                    <ClientCallCard
                      key={call.id}
                      call={call}
                      expanded={expandedCallIds.has(call.id)}
                      editing={editingCallId === call.id}
                      onToggleExpand={() => toggleCallExpanded(call.id)}
                      onStartEdit={() => setEditingCallId(call.id)}
                      onCancelEdit={() => setEditingCallId(null)}
                      onSave={form => saveCallEdit(call, form)}
                      onDelete={() => deleteCall(call)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "#cbd5e1" }}>
                  Client notes ({notes.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowNoteComposer(s => !s)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{ color: "#a78bfa", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)" }}
                >
                  {showNoteComposer ? "Cancel" : "+ Add note"}
                </button>
              </div>

              {showNoteComposer && (
              <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Type</span>
                    <select value={noteType} disabled={savingNote} onChange={e => setNoteType(e.target.value)} className="mt-1 cursor-pointer" style={fieldStyle}>
                      {NOTE_TYPE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Related reason (optional)</span>
                    <select value={noteReason} disabled={savingNote} onChange={e => setNoteReason(e.target.value)} className="mt-1 cursor-pointer" style={fieldStyle}>
                      <option value="">None</option>
                      {LIFECYCLE_REASON_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Note</span>
                  <textarea
                    value={noteBody}
                    disabled={savingNote}
                    onChange={e => setNoteBody(e.target.value)}
                    rows={3}
                    placeholder="Wins, concerns, call summaries, context for future analysis…"
                    className="mt-1 resize-y"
                    style={fieldStyle}
                  />
                </label>
                <button
                  type="button"
                  onClick={submitNote}
                  disabled={savingNote || !noteBody.trim()}
                  className="text-xs font-semibold px-3 py-2 rounded-lg"
                  style={{
                    color: "#a78bfa",
                    background: "rgba(167,139,250,0.12)",
                    border: "1px solid rgba(167,139,250,0.25)",
                    opacity: savingNote || !noteBody.trim() ? 0.5 : 1,
                  }}
                >
                  {savingNote ? "Saving…" : "Add note"}
                </button>
              </div>
              )}

              {notes.length === 0 ? (
                <p className="text-sm py-4 text-center rounded-lg" style={{ color: "#334155", background: "#080f1e" }}>No notes yet.</p>
              ) : (
                <div className="space-y-2">
                  {notes.map(n => (
                    editingNoteId === n.id ? (
                      <div
                        key={n.id}
                        className="rounded-lg px-4 py-3 space-y-3"
                        style={{ background: "#080f1e", border: "1px solid rgba(167,139,250,0.2)" }}
                      >
                        <div className="grid grid-cols-2 gap-3">
                          <select value={editNoteType} disabled={savingNoteEdit} onChange={e => setEditNoteType(e.target.value)} className="cursor-pointer" style={fieldStyle}>
                            {NOTE_TYPE_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <select value={editNoteReason} disabled={savingNoteEdit} onChange={e => setEditNoteReason(e.target.value)} className="cursor-pointer" style={fieldStyle}>
                            <option value="">No reason</option>
                            {LIFECYCLE_REASON_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <textarea value={editNoteBody} disabled={savingNoteEdit} onChange={e => setEditNoteBody(e.target.value)} rows={3} className="resize-y" style={fieldStyle} />
                        <div className="flex gap-2">
                          <button type="button" disabled={savingNoteEdit} onClick={() => saveNoteEdit(n.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ color: "#a78bfa", background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)" }}>
                            {savingNoteEdit ? "Saving…" : "Save"}
                          </button>
                          <button type="button" disabled={savingNoteEdit} onClick={() => setEditingNoteId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={n.id}
                        className="rounded-lg px-4 py-3"
                        style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#a78bfa" }}>
                            {noteTypeLabel(n.note_type)}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: "#475569" }}>
                              {formatDateTime(n.created_at)}
                              {n.created_by_label ? ` · ${n.created_by_label}` : ""}
                              {n.updated_at && n.updated_at !== n.created_at ? " (edited)" : ""}
                            </span>
                            <button type="button" onClick={() => startNoteEdit(n)} className="text-xs font-semibold" style={{ color: "#a78bfa" }}>Edit</button>
                            <button type="button" onClick={() => deleteNote(n.id)} className="text-xs font-semibold" style={{ color: "#64748b" }}>Remove</button>
                          </div>
                        </div>
                        {n.reason_code && (
                          <p className="text-xs mt-1" style={{ color: "#64748b" }}>{reasonLabel(n.reason_code)}</p>
                        )}
                        <p className="text-sm mt-1.5 whitespace-pre-wrap" style={{ color: "#cbd5e1" }}>{n.body}</p>
                      </div>
                    )
                  ))}
                </div>
              )}
            </section>
            </div>
            )}

            <ClientAccountOffersPanel
              clientId={clientId}
              canViewRevenue={canViewRevenue}
              defaultShowAdd={openAddOffer}
              onSwitchClient={(id, siblingName) => {
                if (onSwitchClient) onSwitchClient(id, siblingName);
              }}
              onOfferAdded={(id, siblingName) => {
                if (onOfferCreated) onOfferCreated(id, siblingName);
                else {
                  onSwitchClient?.(id, siblingName);
                  setShowKickoff(true);
                }
                onUpdated?.();
              }}
            />

            <div className="flex items-center gap-1 border-b border-white/[0.08] pt-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-2" style={{ color: "#475569" }}>Offer</span>
              {OFFER_TABS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setOfferTab(t.key)}
                  className="px-3 py-2 text-sm font-semibold -mb-px transition-colors"
                  style={{
                    color: offerTab === t.key ? "#e2e8f0" : "#64748b",
                    borderBottom: `2px solid ${offerTab === t.key ? "#f59e0b" : "transparent"}`,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {offerTab === "operations" && (
            <div className="space-y-7">
            {(kickoffPending || isKickoffLifecycle(client?.lifecycle_status)) && (
              <div
                className="rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
                style={{
                  background: kickoffPending ? "rgba(245,158,11,0.08)" : "rgba(34,197,94,0.08)",
                  border: kickoffPending ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(34,197,94,0.25)",
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: kickoffPending ? "#f59e0b" : "#22c55e" }}>
                    {kickoffPending ? "Kick-off call incomplete" : "Kick-off call wizard"}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                    {kickoffPending
                      ? "Run the kick-off wizard to confirm client details and save the GHL location ID + recording."
                      : "Open the kick-off wizard to review or update onboarding details with the client."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKickoff(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{
                    color: kickoffPending ? "#f59e0b" : "#22c55e",
                    background: kickoffPending ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)",
                    border: kickoffPending ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(34,197,94,0.3)",
                  }}
                >
                  Open kick-off
                </button>
              </div>
            )}

            {isLaunchKitLifecycle(client?.lifecycle_status) && (
              <div
                className="rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
                style={{
                  background: "rgba(79,163,255,0.08)",
                  border: "1px solid rgba(79,163,255,0.25)",
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#4FA3FF" }}>
                    Client Launch Kit
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                    {kickoffPending
                      ? "Finish kick-off first, then generate the branded Launch Kit PDF for the Launch Call."
                      : "Fill the kit intake and generate the branded PDF — download it here or send the link to the client Slack channel."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLaunchKit(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                  style={{
                    color: "#4FA3FF",
                    background: "rgba(79,163,255,0.12)",
                    border: "1px solid rgba(79,163,255,0.3)",
                  }}
                >
                  Open Launch Kit
                </button>
              </div>
            )}

            {isQaLifecycle(client?.lifecycle_status) && (
            <div className="space-y-3">
            <div
              className="rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
              style={{
                background: "rgba(96,165,250,0.08)",
                border: "1px solid rgba(96,165,250,0.25)",
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: techQaDone ? "#22c55e" : "#93c5fd" }}>
                  Tech Setup QA{techQaDone ? " complete" : ""}
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                  Skeleton QA gate for A2P, GHL, routing, phone, and Closebot readiness. Submitting writes Tech QA complete to ClickUp.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQaLane("tech_setup")}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                style={{
                  color: techQaDone ? "#22c55e" : "#93c5fd",
                  background: techQaDone ? "rgba(34,197,94,0.12)" : "rgba(96,165,250,0.12)",
                  border: techQaDone ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(96,165,250,0.3)",
                }}
              >
                Open Tech QA{techQaDone ? " ✓" : ""}
              </button>
            </div>

            <div
              className="rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
              style={{
                background: "rgba(251,146,60,0.08)",
                border: "1px solid rgba(251,146,60,0.25)",
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: mediaQaDone ? "#22c55e" : "#fb923c" }}>
                  Media Buying QA{mediaQaDone ? " complete" : ""}
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                  Skeleton QA gate for ad access, funnel, campaign setup, creative, and launch-readiness. Submitting writes Marketing QA complete to ClickUp.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQaLane("media_buying")}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                style={{
                  color: mediaQaDone ? "#22c55e" : "#fb923c",
                  background: mediaQaDone ? "rgba(34,197,94,0.12)" : "rgba(251,146,60,0.12)",
                  border: mediaQaDone ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(251,146,60,0.3)",
                }}
              >
                Open Media QA{mediaQaDone ? " ✓" : ""}
              </button>
            </div>
            </div>
            )}

            <div
              className="rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
              style={{
                background: "rgba(167,139,250,0.08)",
                border: "1px solid rgba(167,139,250,0.25)",
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: "#c4b5fd" }}>
                  Virtual Business Card
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                  {client?.virtual_business_card_url
                    ? `Live at ${client.virtual_business_card_url}`
                    : "Publish a loanofficer.me card + /learn page for nurture (Call / Text / Save / Book)."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowVirtualCard(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                style={{
                  color: "#c4b5fd",
                  background: "rgba(167,139,250,0.12)",
                  border: "1px solid rgba(167,139,250,0.3)",
                }}
              >
                {client?.virtual_business_card_url ? "Edit card" : "Open Card"}
              </button>
            </div>

            {client && (
            <div
              className="rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
              style={{
                background: "rgba(125,211,252,0.08)",
                border: "1px solid rgba(125,211,252,0.25)",
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: "#7dd3fc" }}>
                  Landing pages
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                  {client.landing_page_url
                    ? `Primary page: ${client.landing_page_url}`
                    : "Choose DSCR, reverse, or HomeSafe, then publish. Add another page when you want a second URL to test."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLanding(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                style={{
                  color: "#7dd3fc",
                  background: "rgba(125,211,252,0.12)",
                  border: "1px solid rgba(125,211,252,0.3)",
                }}
              >
                {client.landing_page_url ? "Landing pages" : "Open Landing"}
              </button>
            </div>
            )}

            <Section title="This offer / subaccount">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                GHL subaccount settings for this offer. Lifecycle and ads controls are in the header above.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Detail label="GHL sub-account name" value={offerRow?.name ?? client?.name} />
                <Detail
                  label="GHL location ID"
                  value={client?.ghl_location_id ? (
                    <span className="font-mono text-sm">{client.ghl_location_id}</span>
                  ) : null}
                  missing={!client?.ghl_location_id}
                />
                <Detail
                  label="Go High Level number"
                  value={client?.phone_ghl}
                  missing={!client?.phone_ghl}
                  hint="The number we use to text and call leads. The client sees this when we text them or live-transfer a call. They should save it in their contacts."
                />
                <Detail
                  label="Accepts live transfers"
                  value={client?.live_transfer_approved === true ? "Yes" : client?.live_transfer_approved === false ? "No" : null}
                  missing={client?.live_transfer_approved == null}
                />
                <Detail
                  label="Appointment Watch"
                  value={client?.appointment_watch === true ? "Yes" : client?.appointment_watch === false ? "No" : null}
                  missing={client?.appointment_watch == null}
                />
                <Detail
                  label="Live transfer number"
                  value={client?.phone_live_transfer}
                  missing={!client?.phone_live_transfer}
                  hint="The client's phone. This is the number we call to live-transfer a lead to them."
                />
                <Detail
                  label="Notification number"
                  value={client?.phone_notifications}
                  hint="A client number we send notifications to, when it is different from the live transfer number."
                />
                <Detail
                  label="Drive folder"
                  value={client?.drive_folder_url ? (
                    <a
                      href={client.drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80"
                      style={{ color: "#38bdf8" }}
                    >
                      Open in Drive
                    </a>
                  ) : null}
                  missing={!client?.drive_folder_url}
                />
                <Detail label="Offer summary" value={client?.offer_summary} wide missing={!client?.offer_summary} />
                <Detail
                  label="Client vertical"
                  value={client?.reporting_type ? (
                    <span className="inline-flex items-center gap-2">
                      <ReportingTypeBadge value={client.reporting_type} size="md" />
                      <span>{getReportingTypeLabel(client.reporting_type)}</span>
                    </span>
                  ) : null}
                  missing={!client?.reporting_type}
                />
                <Detail
                  label="Fulfillment"
                  value={client?.service_program ? (
                    <span className="inline-flex items-center gap-2">
                      <ServiceProgramBadge value={client.service_program} size="md" />
                      <span>{getServiceProgramLabel(client.service_program)}</span>
                    </span>
                  ) : "—"}
                />
                <Detail
                  label="Offer"
                  value={client?.offer ? (
                    <span className="inline-flex items-center gap-2">
                      <ReportingTypeBadge value={client.offer} size="md" />
                      <span>{getReportingTypeLabel(client.offer)}</span>
                    </span>
                  ) : null}
                />
                <Detail
                  label="ClickUp onboarding task"
                  value={(client?.onboarding_clickup_task_id || client?.clickup_task_id) ? (
                    <a
                      href={`https://app.clickup.com/t/${client.onboarding_clickup_task_id || client.clickup_task_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:underline"
                    >
                      {client.onboarding_clickup_task_id || client.clickup_task_id} ↗
                    </a>
                  ) : null}
                />
              </div>
            </Section>

            <Section title="Account setup">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Whose name the ads use, and whether this is a team.
                {!usesCallCenterKpiLayout(client?.reporting_type) &&
                  " Qualify checked: hand-raise % and conversation % use qualified leads. Unchecked: those rates use every lead."}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Detail
                  label="Brand"
                  value={brandSubjectLabel(client?.brand_subject)}
                  missing={!brandSubjectLabel(client?.brand_subject)}
                />
                <Detail
                  label="Team"
                  value={accountShapeLabel(client?.account_shape)}
                  missing={!accountShapeLabel(client?.account_shape)}
                />
                {!usesCallCenterKpiLayout(client?.reporting_type) && (
                  <Detail
                    label="We qualify leads"
                    value={qualifiesLeadsLabel(client?.qualifies_leads)}
                    missing={qualifiesLeadsLabel(client?.qualifies_leads) == null}
                  />
                )}
                {client?.account_shape === "team" && (
                  <Detail
                    label="Lead routing"
                    value={client.team_routing_notes ? (
                      <span className="whitespace-pre-wrap">{client.team_routing_notes}</span>
                    ) : null}
                    missing={!client.team_routing_notes?.trim()}
                    wide
                  />
                )}
                {client?.qualifies_leads === true && !usesCallCenterKpiLayout(client?.reporting_type) && (
                  <Detail
                    label="How we qualify"
                    value={client.qualification_notes ? (
                      <span className="whitespace-pre-wrap">{client.qualification_notes}</span>
                    ) : null}
                    missing={!client.qualification_notes?.trim()}
                    wide
                  />
                )}
              </div>
            </Section>

            <Section title="Media buying">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Meta page, ad account, and the pixel this client’s conversions are sent to.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Detail
                  label="Meta pixel"
                  value={pixelOptions.find(pixel => pixel.id === client?.meta_pixel_id)?.name ?? "Not set"}
                />
                <Detail label="Facebook page" value={client?.facebook_page_name} missing={!client?.facebook_page_name} />
                <Detail label="Instagram" value={client?.instagram_handle} missing={!client?.instagram_handle} />
                <Detail label="Ad account name" value={client?.ad_account_name} missing={!client?.ad_account_name} />
                <Detail
                  label="Ad account"
                  value={client?.ad_account_url ? (
                    <a
                      href={client.ad_account_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80"
                      style={{ color: "#38bdf8" }}
                    >
                      Open Ads Manager
                    </a>
                  ) : null}
                  missing={!client?.ad_account_url}
                />
                {canViewRevenue && <Detail label="Daily ad spend" value={money(client?.daily_adspend)} />}
              </div>
            </Section>

            <Section title="Websites & funnels">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Personal site, agency-built lander, WM Apex Funnel, and thank-you page.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Detail
                  label="Personal website"
                  value={client?.website ? (
                    <a
                      href={/^https?:\/\//i.test(client.website) ? client.website : `https://${client.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80 break-all"
                      style={{ color: "#38bdf8" }}
                    >
                      {client.website}
                    </a>
                  ) : null}
                  missing={!client?.website}
                  wide
                />
                <Detail
                  label="Built landing page"
                  value={client?.landing_page_url ? (
                    <a
                      href={/^https?:\/\//i.test(client.landing_page_url) ? client.landing_page_url : `https://${client.landing_page_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80 break-all"
                      style={{ color: "#38bdf8" }}
                    >
                      {client.landing_page_url}
                    </a>
                  ) : null}
                  missing={!client?.landing_page_url}
                  wide
                />
                <Detail
                  label="WM Apex Funnel"
                  value={client?.funnel_url ? (
                    <a
                      href={/^https?:\/\//i.test(client.funnel_url) ? client.funnel_url : `https://${client.funnel_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80 break-all"
                      style={{ color: "#38bdf8" }}
                    >
                      {client.funnel_url}
                    </a>
                  ) : null}
                  missing={!client?.funnel_url}
                  wide
                />
                <Detail
                  label="Virtual Business Card"
                  value={client?.virtual_business_card_url ? (
                    <a
                      href={client.virtual_business_card_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80 break-all"
                      style={{ color: "#c4b5fd" }}
                    >
                      {client.virtual_business_card_url}
                    </a>
                  ) : null}
                  missing={!client?.virtual_business_card_url}
                  wide
                />
                <Detail
                  label="Thank-you page"
                  value={client?.thank_you_page_url ? (
                    <a
                      href={/^https?:\/\//i.test(client.thank_you_page_url) ? client.thank_you_page_url : `https://${client.thank_you_page_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80 break-all"
                      style={{ color: "#38bdf8" }}
                    >
                      {client.thank_you_page_url}
                    </a>
                  ) : null}
                  missing={!client?.thank_you_page_url}
                  wide
                />
              </div>
            </Section>

            <Section title="Work log">
              <ClientInterventionHistory clientId={clientId} compact />
            </Section>

            <Section title="Account work (week plans)">
              <AccountWeekPlansClientHistory clientId={clientId} compact />
            </Section>

            <Section title="Subaccount timeline">
              {activities.length === 0 ? (
                <p className="text-sm py-4 text-center rounded-lg" style={{ color: "#334155", background: "#080f1e" }}>
                  No activity yet for this subaccount — lifecycle changes, interventions, and billings appear here.
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {activities.map(a => {
                    const subtypeStyle =
                      a.activity_type === "action" && a.subtype
                        ? ACTION_SUBTYPE_STYLE[a.subtype]
                        : null;
                    const style = subtypeStyle ?? ACTIVITY_STYLE[a.activity_type] ?? { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
                    const label = subtypeStyle?.label ?? a.activity_type;
                    return (
                      <div
                        key={`${a.source_table}-${a.source_id}-${a.occurred_at}`}
                        className="rounded-lg px-3 py-2.5 flex gap-3 items-start"
                        style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <span
                          className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                          style={{ color: style.color, background: style.bg }}
                        >
                          {label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs" style={{ color: "#64748b" }}>{formatDateTime(a.occurred_at)}</p>
                          <p className="text-sm mt-0.5 break-words" style={{ color: "#cbd5e1" }}>{a.summary ?? "—"}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
            </div>
            )}

            {offerTab === "records" && (
            <div className="space-y-7">
            <Section title="Loan log form">
              <LoanLogLinkSection clientId={clientId} />
            </Section>
            <Section title={`Onboarding forms (${formSubmissions.length})`}>
              <ClientFormsSection
                submissions={formSubmissions}
                clientId={clientId}
                onResponsesUpdated={(id, responses) => {
                  setFormSubmissions(prev => prev.map(s => (s.id === id ? { ...s, responses } : s)));
                }}
              />
            </Section>

            <Section title={`Success interventions`}>
              <ClientInterventionHistory clientId={clientId} />
            </Section>

            <Section title="Account work (week plans)">
              <AccountWeekPlansClientHistory clientId={clientId} />
            </Section>

            <Section title={`Lifecycle history (${statusHistory.length})`}>
              {statusHistory.length === 0 ? (
                <p className="text-sm py-4 text-center rounded-lg" style={{ color: "#334155", background: "#080f1e" }}>No lifecycle transitions recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {statusHistory.map(h => (
                    <div
                      key={h.id}
                      className="rounded-lg px-4 py-3"
                      style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>
                          {lifecycleStatusLabel(h.previous_status)} → {lifecycleStatusLabel(h.new_status)}
                        </p>
                        <span className="text-xs whitespace-nowrap" style={{ color: "#475569" }}>{formatDateTime(h.changed_at)}</span>
                      </div>
                      {h.reason_code && (
                        <p className="text-xs mt-1.5 font-semibold" style={{ color: "#f59e0b" }}>
                          Reason: {reasonLabel(h.reason_code)}
                        </p>
                      )}
                      {h.note && (
                        <p className="text-sm mt-1.5" style={{ color: "#94a3b8" }}>{h.note}</p>
                      )}
                      {canViewRevenue && h.mrr_at_change != null && (
                        <p className="text-xs mt-1" style={{ color: "#475569" }}>MRR at change: {money(h.mrr_at_change)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
            </div>
            )}

            {offerTab === "cs" && (
            <div className="space-y-7">
              <Section title="CS call history">
                <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                  Onboarding, launch, and check-in appointments from Client Success calendars
                  {(client?.onboarding_clickup_task_id || client?.clickup_task_id) ? "" : " — add a ClickUp onboarding task ID to sync these"}.
                </p>
                {!(client?.onboarding_clickup_task_id || client?.clickup_task_id) ? (
                  <p className="text-sm py-6 text-center" style={{ color: "#334155" }}>
                    No ClickUp onboarding task ID on this client — CS appointments map by that task ID.
                  </p>
                ) : csAppointments.length === 0 ? (
                  <p className="text-sm py-6 text-center" style={{ color: "#334155" }}>
                    No CS appointments recorded yet for this ClickUp ID.
                  </p>
                ) : (
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "#0a1628" }}>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>When</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>Type</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>Status</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>Calendar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csAppointments.map(a => {
                          const d = new Date(a.scheduled_at);
                          const when = Number.isFinite(d.getTime())
                            ? d.toLocaleString(undefined, {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : a.scheduled_at;
                          const isUpcoming =
                            a.status === "scheduled" &&
                            Number.isFinite(d.getTime()) &&
                            d.getTime() >= Date.now();
                          return (
                            <tr
                              key={a.id}
                              className="border-t"
                              style={{ borderColor: "rgba(255,255,255,0.04)" }}
                            >
                              <td className="px-3 py-2.5 tabular-nums whitespace-nowrap" style={{ color: isUpcoming ? "#e2e8f0" : "#94a3b8" }}>
                                {when}
                              </td>
                              <td className="px-3 py-2.5" style={{ color: "#cbd5e1" }}>
                                {csCallTypeLabel(a.call_type)}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md capitalize"
                                  style={{
                                    color: isUpcoming ? "#38bdf8" : "#94a3b8",
                                    background: isUpcoming ? "rgba(56,189,248,0.12)" : "rgba(148,163,184,0.1)",
                                  }}
                                >
                                  {a.status.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-3 py-2.5" style={{ color: "#64748b" }}>
                                {a.calendar_name ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
              <Section title="Open follow-ups">
                <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                  Slack touchpoints due for this subaccount. Clear them from Client Success → Follow-ups.
                </p>
                {touchpointsOpen.length === 0 ? (
                  <p className="text-sm py-6 text-center" style={{ color: "#334155" }}>
                    No open touchpoints.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {touchpointsOpen.map(t => (
                      <li
                        key={t.id}
                        className="rounded-lg px-3 py-2 text-sm"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <span style={{ color: "#e2e8f0" }}>
                          {touchpointLabels[t.touchpoint_type] ?? t.touchpoint_type}
                        </span>
                        <span className="ml-2 text-xs" style={{ color: "#64748b" }}>
                          due {new Date(t.due_at).toLocaleDateString()}
                          {t.status === "snoozed" ? " · snoozed" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="History">
                {touchpointsHistory.length === 0 ? (
                  <p className="text-sm py-6 text-center" style={{ color: "#334155" }}>
                    No completed touchpoints yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {touchpointsHistory.map(t => (
                      <li
                        key={t.id}
                        className="rounded-lg px-3 py-2 text-sm"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <div className="flex justify-between gap-2">
                          <span style={{ color: "#e2e8f0" }}>
                            {touchpointLabels[t.touchpoint_type] ?? t.touchpoint_type}
                          </span>
                          <span className="text-xs" style={{ color: "#64748b" }}>
                            {t.status}
                            {t.completed_at
                              ? ` · ${new Date(t.completed_at).toLocaleDateString()}`
                              : ""}
                          </span>
                        </div>
                        {t.slack_snippet && (
                          <p
                            className="text-xs mt-1.5 whitespace-pre-wrap line-clamp-3"
                            style={{ color: "#94a3b8" }}
                          >
                            {t.slack_snippet}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            )}

            {offerTab === "billing" && (
            <div className="space-y-7">
            <Section title="Billing setup">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Contract and billing terms for this offer / subaccount only.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Detail label="Billing type" value={billingTypeLabel(client?.billing_type)} missing={!client?.billing_type} />
                {canViewRevenue && <Detail label="Monthly $ (base)" value={money(client?.mrr)} />}
                <Detail label="Billing day" value={client?.billing_day ? `Day ${client.billing_day}` : "launch day"} />
                <Detail label="Launch date" value={client?.launch_date} missing={!client?.launch_date} />
                <Detail label="Date signed" value={client?.date_signed} missing={!client?.date_signed} />
                <Detail label="Reinstated" value={client?.reinstated_at ? toDateInputValue(client.reinstated_at) || client.reinstated_at : null} />
                <Detail label="Contract term" value={client?.contract_term_months ? `${client.contract_term_months} mo` : null} missing={client?.contract_term_months == null} />
                <Detail label="Contract end" value={client?.contract_end_date} />
                {canViewRevenue && <Detail label="Daily ad spend" value={money(client?.daily_adspend)} />}
                <Detail label="Churned" value={client?.churned_at ? toDateInputValue(client.churned_at) || client.churned_at : null} />
              </div>
              {client?.performance_terms && (
                <div className="mt-4">
                  <Detail label="Performance terms" value={client.performance_terms} wide />
                </div>
              )}
            </Section>
            <Section title={`Billing history (${summary.count})`}>
              {canViewRevenue && (
                <div className="flex gap-3 flex-wrap mb-4">
                  <Chip label="Total collected" value={money(summary.collected)} color="#38bdf8" />
                  <Chip label="Retainer" value={money(summary.retainer)} color="#22c55e" />
                  <Chip label="Performance" value={money(summary.performance)} color="#a78bfa" />
                  {summary.passthrough > 0 && <Chip label="Passthrough" value={money(summary.passthrough)} color="#64748b" />}
                  <Chip label="Last payment" value={summary.lastPaidOn ?? "—"} color="#cbd5e1" />
                </div>
              )}

              {billings.length === 0 ? (
                <p className="text-sm py-6 text-center" style={{ color: "#334155" }}>No billings logged for this client yet.</p>
              ) : (
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "#0a1628" }}>
                        {(canViewRevenue
                          ? ["Date", "Type", "Cash", "Amount", "Fee", "Status", "Method / Stripe"]
                          : ["Date", "Type", "Status", "Method / Stripe"]
                        ).map((h, i) => (
                          <th key={i} className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#334155" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {billings.map((b, i) => {
                        const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending;
                        const isPassthrough = b.revenue_type === "passthrough";
                        const cash = isPassthrough ? Number(b.passthrough_amount) || 0 : Number(b.amount_paid) || 0;
                        const typeLabel = b.revenue_type ? REVENUE_TYPE_LABEL[b.revenue_type] ?? b.revenue_type : "—";
                        const seg = b.revenue_segment === "front_end" ? "new" : b.revenue_segment === "back_end" ? "recurring" : null;
                        const fee = Number(b.processing_fee) || 0;
                        return (
                          <tr key={b.id} style={{ background: i % 2 === 0 ? "#080f1e" : "#060d1a", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                            <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#cbd5e1" }}>
                              {b.paid_on ?? b.billed_on}
                              {b.note && <div className="text-xs mt-0.5" style={{ color: "#334155" }}>{b.note}</div>}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span style={{ color: "#e2e8f0" }}>{typeLabel}</span>
                              {seg && <span className="ml-1.5 text-xs" style={{ color: "#475569" }}>· {seg}</span>}
                              {b.is_extension && (
                                <span className="ml-1.5 text-xs font-semibold" style={{ color: "#a78bfa" }}>extension</span>
                              )}
                              {b.is_first_payment && (
                                <span className="ml-1.5 text-xs font-semibold" style={{ color: "#f59e0b" }}>first</span>
                              )}
                              {b.term_months != null && b.term_months > 0 && (
                                <span className="ml-1.5 text-xs" style={{ color: "#64748b" }}>{b.term_months} mo</span>
                              )}
                              {b.lead_source && <div className="text-xs mt-0.5" style={{ color: "#475569" }}>{b.lead_source}</div>}
                            </td>
                            {canViewRevenue && (
                              <>
                                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: isPassthrough ? "#64748b" : "#38bdf8" }}>{money(cash)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#e2e8f0" }}>{money(b.amount)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: fee > 0 ? "#f59e0b" : "#475569" }}>
                                  {fee > 0 ? money(fee) : "—"}
                                </td>
                              </>
                            )}
                            <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: st.color, background: st.bg }}>{b.status}</span></td>
                            <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#94a3b8" }}>
                              {b.method ?? "—"}
                              {b.stripe_invoice_id && (
                                <div className="text-xs mt-0.5 font-mono" style={{ color: "#475569" }}>{b.stripe_invoice_id}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!canViewRevenue && billings.length > 0 && (
                <p className="text-xs mt-3" style={{ color: "#475569" }}>Dollar amounts are hidden. Ask the account owner to grant &ldquo;View client revenue &amp; billing totals&rdquo; if you need them.</p>
              )}
            </Section>
            </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function billingTypeLabel(t: string | null | undefined): string {
  if (!t) return "Monthly (default)";
  if (t === "pif") return "PIF";
  if (t === "pif_monthly") return "PIF + Monthly";
  return "Monthly";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "#cbd5e1" }}>{title}</h3>
      {children}
    </section>
  );
}

function Detail({ label, value, wide, missing, hint }: { label: string; value: ReactNode; wide?: boolean; missing?: boolean; hint?: string }) {
  const display = value === null || value === undefined || value === "" || value === "—" ? "—" : value;
  return (
    <div className={wide ? "col-span-2 md:col-span-3" : undefined}>
      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: missing ? "#f59e0b" : "#475569" }}>{label}{missing ? " · missing" : ""}</p>
      <p className="text-sm" style={{ color: display === "—" ? "#334155" : "#e2e8f0" }}>{display}</p>
      {hint && <p className="text-xs mt-1" style={{ color: "#64748b" }}>{hint}</p>}
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="text-xs uppercase tracking-wider" style={{ color: "#475569" }}>{label}</p>
      <p className="text-base font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function ClientCallCard({
  call,
  expanded,
  editing,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  call: ClientCall;
  expanded: boolean;
  editing: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (form: {
    draft: ClientCallDraft;
    duration_seconds: string;
    disposition: string;
    follow_up_due_at: string;
  }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ClientCallDraft>(() => rowToCallDraft(call));
  const [durationSeconds, setDurationSeconds] = useState(
    call.duration_seconds != null ? String(call.duration_seconds) : "",
  );
  const [disposition, setDisposition] = useState(call.disposition ?? "");
  const [followUpDue, setFollowUpDue] = useState(
    call.follow_up_due_at ? toDatetimeLocal(call.follow_up_due_at) : "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setDraft(rowToCallDraft(call));
      setDurationSeconds(call.duration_seconds != null ? String(call.duration_seconds) : "");
      setDisposition(call.disposition ?? "");
      setFollowUpDue(call.follow_up_due_at ? toDatetimeLocal(call.follow_up_due_at) : "");
    }
  }, [editing, call]);

  async function handleSave() {
    setSaving(true);
    await onSave({
      draft,
      duration_seconds: durationSeconds,
      disposition,
      follow_up_due_at: followUpDue,
    });
    setSaving(false);
  }

  const hasDetails = !!(call.transcript || call.notes || call.attendees);

  if (editing) {
    return (
      <div className="rounded-lg px-4 py-3 space-y-3" style={{ background: "#080f1e", border: "1px solid rgba(245,158,11,0.2)" }}>
        <ClientCallFormFields draft={draft} onChange={setDraft} disabled={saving} />
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Duration (sec)</span>
            <input type="number" min={0} value={durationSeconds} disabled={saving} onChange={e => setDurationSeconds(e.target.value)} className="mt-1" style={fieldStyle} />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Disposition</span>
            <select value={disposition} disabled={saving} onChange={e => setDisposition(e.target.value)} className="mt-1 cursor-pointer" style={fieldStyle}>
              <option value="">None</option>
              {CALL_DISPOSITION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Follow-up due</span>
            <input type="datetime-local" value={followUpDue} disabled={saving} onChange={e => setFollowUpDue(e.target.value)} className="mt-1" style={fieldStyle} />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancelEdit}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg px-4 py-3" style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#f59e0b" }}>
            {callTypeLabel(call.call_type)}
          </span>
          {call.recording_url && (
            <a
              href={call.recording_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold"
              style={{ color: "#38bdf8" }}
            >
              Recording ↗
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs whitespace-nowrap" style={{ color: "#475569" }}>
            {formatDateTime(call.called_at)}
            {call.created_by_label ? ` · ${call.created_by_label}` : ""}
          </span>
          <button type="button" onClick={onStartEdit} className="text-xs font-semibold" style={{ color: "#a78bfa" }}>Edit</button>
          <button type="button" onClick={onDelete} className="text-xs font-semibold" style={{ color: "#64748b" }}>Remove</button>
        </div>
      </div>
      {(call.duration_seconds != null || call.disposition || call.follow_up_due_at) && (
        <p className="text-xs mt-1.5 flex flex-wrap gap-x-3" style={{ color: "#64748b" }}>
          {call.duration_seconds != null && <span>{call.duration_seconds}s</span>}
          {call.disposition && <span>{dispositionLabel(call.disposition)}</span>}
          {call.follow_up_due_at && <span>Follow-up {formatDateTime(call.follow_up_due_at)}</span>}
        </p>
      )}
      {call.attendees && (
        <p className="text-xs mt-1.5" style={{ color: "#64748b" }}>Attendees: {call.attendees}</p>
      )}
      {call.checkin_form && callLogHasDisplayContent(call.checkin_form) && (
        <CheckinCallSummary form={call.checkin_form} />
      )}
      {call.notes && (
        <p className="text-sm mt-1.5 whitespace-pre-wrap" style={{ color: "#cbd5e1" }}>{call.notes}</p>
      )}
      {call.transcript && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-xs font-semibold"
            style={{ color: "#64748b" }}
          >
            {expanded ? "Hide transcript" : "Show transcript"}
          </button>
          {expanded && (
            <p className="text-sm mt-1.5 whitespace-pre-wrap max-h-64 overflow-y-auto" style={{ color: "#94a3b8" }}>
              {call.transcript}
            </p>
          )}
          {!expanded && hasDetails && !call.notes && (
            <p className="text-xs mt-1 truncate" style={{ color: "#475569" }}>
              {call.transcript.slice(0, 140)}{call.transcript.length > 140 ? "…" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
