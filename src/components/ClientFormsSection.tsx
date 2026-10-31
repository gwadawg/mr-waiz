"use client";

import { useState } from "react";
import { FORM_TYPE_LABELS, type FormType } from "@/lib/form-submissions";
import { ONBOARDING_FIELD_LABELS } from "@/lib/onboarding-form";
import {
  CS_REINSTATE_CHECKLIST,
  readCsChecklist,
} from "@/lib/reinstate-form";
import {
  formatLaunchItemStatus,
  getLaunchItemsForProfile,
  getLaunchSectionsForProfile,
  launchResponsesToDraft,
  profileFromLaunchResponses,
} from "@/lib/launch-form";
import { CC_KICKOFF_FIELD_LABELS } from "@/lib/kickoff";
import { getReportingTypeLabel } from "@/lib/reporting-types";
import { getServiceProgramLabel } from "@/lib/service-program";
import { formatStatesLicensed } from "@/lib/us-states";
import { getQaFormConfig, type QaLane } from "@/lib/qa-form";

export type FormSubmissionSummary = {
  id: string;
  form_type: FormType;
  status: string;
  submitted_by: string | null;
  submitted_at: string;
  responses: Record<string, unknown>;
  applied_patch?: Record<string, unknown> | null;
};

const PM_LABELS: Record<string, string> = {
  pm_landing_copy: "Landing page copy",
  pm_brand_assets: "Brand colors / assets",
  pm_compliance_notes: "Compliance disclaimers",
  pm_competitor_refs: "Competitor references",
  pm_funnel_requirements: "Funnel requirements",
};

const KICKOFF_META_LABELS: Record<string, string> = {
  reporting_type: "Client vertical",
  service_program: "Fulfillment",
  form_profile: "Form profile",
  vertical_confirmed: "Vertical confirmed",
};

function formatValue(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (key === "states_licensed" && Array.isArray(value)) {
    return formatStatesLicensed(value as string[]) || "—";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanizeLaunchResponses(responses: Record<string, unknown>): { label: string; value: string; section?: string }[] {
  const profile = profileFromLaunchResponses(responses);
  const draft = launchResponsesToDraft(responses, profile);
  const rows: { label: string; value: string; section?: string }[] = [];

  if (responses.reporting_type) {
    rows.push({ label: "Client vertical", value: getReportingTypeLabel(responses.reporting_type) });
  }
  if (responses.service_program) {
    rows.push({ label: "Fulfillment", value: getServiceProgramLabel(responses.service_program) ?? String(responses.service_program) });
  }
  if (responses.completed_by_label) {
    rows.push({ label: "Completed by", value: String(responses.completed_by_label) });
  }
  if (responses.launch_date) {
    rows.push({ label: "Launch date", value: String(responses.launch_date) });
  }
  if (responses.recording_url) {
    rows.push({ label: "Launch call recording", value: String(responses.recording_url) });
  }
  if (responses.transcript) {
    rows.push({ label: "Launch call transcript", value: String(responses.transcript) });
  }

  for (const section of getLaunchSectionsForProfile(profile)) {
    rows.push({ label: section.label, value: "", section: section.label });
    const items = getLaunchItemsForProfile(profile).filter(item => item.section === section.id);
    for (const item of items) {
      const status = formatLaunchItemStatus(item, draft);
      const value =
        status === "confirmed_typed_yes"
          ? "✓ Confirmed (typed yes)"
          : status === "confirmed"
            ? "✓ Confirmed"
            : "—";
      rows.push({ label: item.label, value, section: section.label });
    }
  }

  if (responses.notes) rows.push({ label: "Notes", value: String(responses.notes) });
  return rows;
}

const LAUNCH_KIT_LABELS: Record<string, string> = {
  version: "Version",
  template_version: "Template",
  product: "Product",
  dial_owner: "Who works leads",
  contact_first_name: "Contact",
  company_name: "Company / DBA",
  go_live_date: "Go-live",
  csm_name: "CSM",
  who_works_leads: "Who works leads (copy)",
  speed_standard: "Speed standard",
  market: "Market",
  slack_channel_name: "Slack channel",
  funnel_url: "WM Apex Funnel",
  crm_url: "CRM",
  calendar_url: "Calendar",
  ads_url: "Meta ads",
  skool_url: "Skool / training",
  launch_kit_folder_url: "Launch Kit folder",
  website_url: "Website",
  legal_notice_url: "Legal notice",
  phone_prospecting: "Go High Level number",
  phone_live_transfer: "Live transfer number",
  phone_notifications: "Notification number",
  virtual_card_url: "Virtual business card",
  facebook_page: "Facebook page",
  nmls: "NMLS",
  states_licensed: "States licensed",
  sent_to_client_at: "Sent to client",
  notes: "Internal notes",
};

function humanizeLaunchKitResponses(responses: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const na = (responses.property_na ?? {}) as Record<string, unknown>;
  for (const [k, label] of Object.entries(LAUNCH_KIT_LABELS)) {
    if (na[k] === true) {
      rows.push({ label, value: "N/A" });
      continue;
    }
    const v = responses[k];
    if (v == null || v === "") continue;
    if (k === "product") rows.push({ label, value: v === "rm" ? "Reverse mortgage" : v === "dscr" ? "DSCR" : String(v) });
    else if (k === "dial_owner") rows.push({ label, value: v === "waiz" ? "Waiz" : v === "client" ? "Client" : String(v) });
    else if (k === "sent_to_client_at") rows.push({ label, value: new Date(String(v)).toLocaleString() });
    else rows.push({ label, value: formatValue(k, v) });
  }
  return rows;
}

const REINSTATE_FIELD_LABELS: Record<string, string> = {
  engagement: "Engagement",
  offer: "Offer",
  reporting_type: "Vertical",
  sales_package: "Package",
  mrr: "MRR",
  closed_at: "Signed",
  closer_name: "Closer",
  cash_collected: "Cash collected",
  contract_term_months: "Term (months)",
  contract_end_date: "Contract end",
  ghl_reuse: "Reuse GHL",
  leave_billing_paused: "Leave billing paused",
  leave_ads_paused: "Leave ads paused",
  internal_notes: "Internal notes",
};

function humanizeReinstateResponses(responses: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const [k, label] of Object.entries(REINSTATE_FIELD_LABELS)) {
    const v = responses[k];
    if (v == null || v === "") continue;
    if (k === "engagement") {
      rows.push({
        label,
        value: v === "same_file" ? "Same file" : v === "new_offer" ? "New offer" : String(v),
      });
      continue;
    }
    rows.push({ label, value: formatValue(k, v) });
  }
  return rows;
}

function humanizeQaResponses(formType: FormType, responses: Record<string, unknown>): { label: string; value: string; section?: string }[] {
  const lane =
    responses.qa_lane === "tech_setup" || responses.qa_lane === "media_buying" || responses.qa_lane === "creative"
      ? responses.qa_lane
      : formType === "tech_qa"
        ? "tech_setup"
        : formType === "creative"
          ? "creative"
          : "media_buying";
  const config = getQaFormConfig(lane as QaLane);
  const checklist = responses.checklist && typeof responses.checklist === "object"
    ? responses.checklist as Record<string, unknown>
    : {};
  const rows: { label: string; value: string; section?: string }[] = [
    { label: "Skeleton", value: formatValue("skeleton_version", responses.skeleton_version) },
    { label: "Completed by", value: formatValue("completed_by_label", responses.completed_by_label) },
    { label: "Checklist", value: "", section: "Checklist" },
  ];
  for (const item of config.items) {
    const confirmed = checklist[item.key] === true;
    if (config.omitUnchecked && !confirmed) continue;
    rows.push({
      label: item.label,
      value: confirmed ? "✓ Confirmed" : "—",
      section: "Checklist",
    });
  }
  if (responses.evidence) rows.push({ label: "Evidence", value: String(responses.evidence) });
  if (responses.blockers) rows.push({ label: "Blockers / exceptions", value: String(responses.blockers) });
  if (responses.notes) rows.push({ label: "Notes", value: String(responses.notes) });
  return rows;
}

function humanizeResponses(formType: FormType, responses: Record<string, unknown>): { label: string; value: string; section?: string }[] {
  if (formType === "launch") {
    return humanizeLaunchResponses(responses);
  }

  if (formType === "tech_qa" || formType === "marketing_qa" || formType === "creative") {
    return humanizeQaResponses(formType, responses);
  }

  if (formType === "launch_kit") {
    return humanizeLaunchKitResponses(responses);
  }

  if (formType === "kickoff") {
    const rows: { label: string; value: string }[] = [];
    if (responses.reporting_type) {
      rows.push({ label: KICKOFF_META_LABELS.reporting_type, value: getReportingTypeLabel(responses.reporting_type) });
    }
    if (responses.service_program) {
      rows.push({
        label: KICKOFF_META_LABELS.service_program,
        value: getServiceProgramLabel(responses.service_program) ?? String(responses.service_program),
      });
    }
    for (const [k, label] of Object.entries(PM_LABELS)) {
      if (responses[k]) rows.push({ label, value: formatValue(k, responses[k]) });
    }
    for (const [k, label] of Object.entries(CC_KICKOFF_FIELD_LABELS)) {
      if (responses[k]) rows.push({ label, value: formatValue(k, responses[k]) });
    }
    return rows;
  }

  if (formType === "onboarding" || formType === "reinstate_onboarding") {
    return Object.entries(ONBOARDING_FIELD_LABELS)
      .filter(([k]) => responses[k] != null && responses[k] !== "")
      .map(([k, label]) => ({ label, value: formatValue(k, responses[k]) }));
  }

  if (formType === "reinstate") {
    return humanizeReinstateResponses(responses);
  }

  return Object.entries(responses)
    .filter(([k]) => k !== "cs_checklist")
    .slice(0, 12)
    .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: formatValue(k, v) }));
}

function launchKitDownloadHref(clientId: string | undefined, s: FormSubmissionSummary): string | null {
  if (s.form_type !== "launch_kit" || s.status !== "applied" || !clientId) return null;
  if (typeof s.responses?.storage_path !== "string") return null;
  return `/api/clients/${clientId}/launch-kit/download?submission=${s.id}`;
}

function ReinstateCsChecklist({
  submissionId,
  responses,
  onUpdated,
}: {
  submissionId: string;
  responses: Record<string, unknown>;
  onUpdated?: (next: Record<string, unknown>) => void;
}) {
  const [checklist, setChecklist] = useState(() => readCsChecklist(responses));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: string, value: boolean) {
    const prev = checklist;
    setChecklist({ ...checklist, [key]: value });
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch(`/api/form-submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cs_checklist: { [key]: value } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChecklist(prev);
        setError(typeof data.error === "string" ? data.error : "Failed to save checklist");
        return;
      }
      const saved = data.responses as Record<string, unknown> | undefined;
      if (saved) {
        setChecklist(readCsChecklist(saved));
        onUpdated?.(saved);
      }
    } catch (e) {
      setChecklist(prev);
      setError(e instanceof Error ? e.message : "Failed to save checklist");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="pt-3 space-y-2" onClick={e => e.stopPropagation()}>
      <p className="text-xs font-semibold" style={{ color: "#94a3b8" }}>CS checklist</p>
      {CS_REINSTATE_CHECKLIST.map(item => (
        <label key={item.key} className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={!!checklist[item.key]}
            disabled={savingKey === item.key}
            onChange={e => toggle(item.key, e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-violet-400"
          />
          <span style={{ color: checklist[item.key] ? "#86efac" : "#cbd5e1" }}>{item.label}</span>
        </label>
      ))}
      {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
    </div>
  );
}

export default function ClientFormsSection({
  submissions,
  alwaysExpanded = false,
  clientId,
  onResponsesUpdated,
}: {
  submissions: FormSubmissionSummary[];
  alwaysExpanded?: boolean;
  /** Enables the Download link on Launch Kit rows. */
  clientId?: string;
  onResponsesUpdated?: (submissionId: string, responses: Record<string, unknown>) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (submissions.length === 0) {
    return (
      <p className="text-sm" style={{ color: "#64748b" }}>
        No form submissions on file yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {submissions.map(s => {
        const isOpen = alwaysExpanded || expanded === s.id;
        const rows = humanizeResponses(s.form_type, s.responses ?? {});
        const kitHref = launchKitDownloadHref(clientId, s);
        const checklist =
          s.form_type === "reinstate" ? (
            <ReinstateCsChecklist
              submissionId={s.id}
              responses={s.responses ?? {}}
              onUpdated={next => onResponsesUpdated?.(s.id, next)}
            />
          ) : null;
        if (alwaysExpanded) {
          return (
            <div key={s.id} className="space-y-2">
              {kitHref && (
                <a href={kitHref} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-semibold underline" style={{ color: "#4FA3FF" }}>
                  Download Launch Kit PDF
                </a>
              )}
              {rows.map(row => (
                row.value === "" && row.section ? (
                  <p key={row.label} className="text-xs font-semibold pt-3" style={{ color: "#94a3b8" }}>
                    {row.label}
                  </p>
                ) : (
                  <div key={`${row.section ?? ""}-${row.label}`} className="flex gap-3 text-xs pt-2">
                    <span className="w-36 flex-shrink-0" style={{ color: "#64748b" }}>{row.label}</span>
                    <span style={{ color: "#cbd5e1" }}>{row.value}</span>
                  </div>
                )
              ))}
              {checklist}
            </div>
          );
        }
        return (
          <div
            key={s.id}
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.06)", background: "#0a1628" }}
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : s.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>
                  {FORM_TYPE_LABELS[s.form_type] ?? s.form_type}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                  {new Date(s.submitted_at).toLocaleString()}
                  {s.form_type === "launch" && s.responses?.completed_by_label
                    ? ` · ${String(s.responses.completed_by_label)}`
                    : s.submitted_by
                      ? ` · ${s.submitted_by}`
                      : ""}
                  {s.status ? ` · ${s.status}` : ""}
                </p>
              </div>
              <span className="text-xs" style={{ color: "#94a3b8" }}>{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-2 border-t border-white/5">
                {kitHref && (
                  <a href={kitHref} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-semibold underline pt-3" style={{ color: "#4FA3FF" }}>
                    Download Launch Kit PDF
                  </a>
                )}
                {rows.map(row => (
                  row.value === "" && row.section ? (
                    <p key={row.label} className="text-xs font-semibold pt-3" style={{ color: "#94a3b8" }}>
                      {row.label}
                    </p>
                  ) : (
                    <div key={`${row.section ?? ""}-${row.label}`} className="flex gap-3 text-xs pt-2">
                      <span className="w-36 flex-shrink-0" style={{ color: "#64748b" }}>{row.label}</span>
                      <span style={{ color: "#cbd5e1" }}>{row.value}</span>
                    </div>
                  )
                ))}
                {checklist}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PROGRESS_STEPS: { key: FormType; label: string; full: string }[] = [
  { key: "new_client", label: "Sign", full: "Signed" },
  { key: "onboarding", label: "OB", full: "Onboarding" },
  { key: "kickoff", label: "KO", full: "Kick-off" },
  { key: "launch_kit", label: "Kit", full: "Launch Kit" },
  { key: "launch", label: "Live", full: "Launched" },
];

/**
 * Process-stage cards (Sign → OB → KO → Kit → Live). Each step reads as a discrete
 * card that fills green once the matching form exists, giving an at-a-glance
 * read of where a client sits in the onboarding process.
 */
export function FormProgressStrip({ progress }: { progress?: Partial<Record<FormType, boolean>> }) {
  return (
    <span className="inline-flex items-center gap-1">
      {PROGRESS_STEPS.map(({ key, label, full }) => {
        const done = !!progress?.[key];
        return (
          <span
            key={key}
            title={`${full} ${done ? "complete" : "pending"}`}
            className="inline-flex items-center justify-center min-w-[2.1rem] px-1.5 py-1 rounded-md text-[10px] font-semibold tracking-wide"
            style={{
              color: done ? "#86efac" : "#475569",
              background: done ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.03)",
              border: done ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}
