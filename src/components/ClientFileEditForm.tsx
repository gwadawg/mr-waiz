"use client";

import { useState, type ReactNode } from "react";
import StatesLicensedSelect from "@/components/StatesLicensedSelect";
import TimezoneSelect from "@/components/TimezoneSelect";
import ReportingTypeBadge, { ReportingTypeSelectOptions } from "@/components/ReportingTypeBadge";
import { normalizeReportingType, type ReportingType } from "@/lib/kpi-layouts";
import { getReportingTypeLabel, usesCallCenterKpiLayout } from "@/lib/reporting-types";
import {
  normalizeServiceProgram,
  serviceProgramApplies,
  SERVICE_PROGRAM_OPTIONS,
  type ServiceProgram,
} from "@/lib/service-program";
import { toDateInputValue } from "@/lib/client-dates";
import ClientLeadSourceSelect from "@/components/ClientLeadSourceSelect";
import { normalizeClientLeadSource } from "@/lib/client-lead-source";
import {
  ACCOUNT_SHAPE_LABELS,
  ACCOUNT_SHAPES,
  BRAND_SUBJECT_LABELS,
  BRAND_SUBJECTS,
  type AccountShape,
  type BrandSubject,
} from "@/lib/client-launch-setup";

export type EditableClient = {
  name: string;
  primary_contact_name: string | null;
  primary_contact: string | null;
  email: string | null;
  billing_email: string | null;
  phone: string | null;
  reporting_type: string | null;
  offer?: string | null;
  service_program?: string | null;
  onboarding_clickup_task_id?: string | null;
  clickup_task_id?: string | null;
  source: string | null;
  website: string | null;
  drive_folder_url: string | null;
  funnel_url: string | null;
  virtual_business_card_url?: string | null;
  landing_page_url: string | null;
  brokerage_name: string | null;
  legal_business_name: string | null;
  nmls: string | null;
  city: string | null;
  state: string | null;
  states_licensed: string[] | null;
  timezone: string | null;
  lifecycle_status: string | null;
  is_live: boolean | null;
  billing_type: string | null;
  mrr: number | null;
  billing_day: number | null;
  launch_date: string | null;
  date_signed: string | null;
  contract_term_months: number | null;
  contract_end_date: string | null;
  daily_adspend: number | null;
  performance_terms: string | null;
  churned_at: string | null;
  ghl_location_id?: string | null;
  phone_ghl: string | null;
  phone_live_transfer: string | null;
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
  thank_you_page_url: string | null;
  second_landing_page_url: string | null;
};

type Draft = {
  name: string;
  primary_contact_name: string;
  email: string;
  billing_email: string;
  phone: string;
  reporting_type: ReportingType;
  service_program: ServiceProgram | "";
  onboarding_clickup_task_id: string;
  clickup_task_id: string;
  ghl_location_id: string;
  phone_ghl: string;
  source: string;
  website: string;
  drive_folder_url: string;
  funnel_url: string;
  virtual_business_card_url: string;
  landing_page_url: string;
  brokerage_name: string;
  legal_business_name: string;
  nmls: string;
  city: string;
  state: string;
  states_licensed: string[];
  timezone: string;
  lifecycle_status: string;
  is_live: boolean;
  billing_type: string;
  mrr: string;
  billing_day: string;
  launch_date: string;
  date_signed: string;
  contract_term_months: string;
  contract_end_date: string;
  daily_adspend: string;
  performance_terms: string;
  churned_at: string;
  phone_live_transfer: string;
  live_transfer_approved: boolean;
  appointment_watch: boolean;
  brand_subject: BrandSubject | "";
  account_shape: AccountShape | "";
  team_routing_notes: string;
  qualifies_leads: "" | "yes" | "no";
  qualification_notes: string;
  offer_summary: string;
  facebook_page_name: string;
  instagram_handle: string;
  ad_account_name: string;
  ad_account_url: string;
  thank_you_page_url: string;
  second_landing_page_url: string;
};

const LIFECYCLE_OPTIONS = ["new_account", "onboarding", "active", "paused", "off_boarding", "churned"];

const inputStyle = (missing = false) => ({
  background: "#0f2040",
  border: missing ? "1px solid rgba(245,158,11,0.45)" : "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
});

export function clientToDraft(c: EditableClient): Draft {
  return {
    name: c.name ?? "",
    primary_contact_name: c.primary_contact_name || c.primary_contact || "",
    email: c.email ?? "",
    billing_email: c.billing_email ?? "",
    phone: c.phone ?? "",
    reporting_type: normalizeReportingType(c.reporting_type),
    service_program: normalizeServiceProgram(c.service_program) ?? "",
    onboarding_clickup_task_id: c.onboarding_clickup_task_id ?? c.clickup_task_id ?? "",
    clickup_task_id: c.clickup_task_id ?? "",
    ghl_location_id: c.ghl_location_id ?? "",
    phone_ghl: c.phone_ghl ?? "",
    source: normalizeClientLeadSource(c.source) ?? "",
    website: c.website ?? "",
    drive_folder_url: c.drive_folder_url ?? "",
    funnel_url: c.funnel_url ?? "",
    virtual_business_card_url: c.virtual_business_card_url ?? "",
    landing_page_url: c.landing_page_url ?? "",
    brokerage_name: c.brokerage_name ?? "",
    legal_business_name: c.legal_business_name ?? "",
    nmls: c.nmls ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    states_licensed: c.states_licensed ?? [],
    timezone: c.timezone ?? "",
    lifecycle_status: c.lifecycle_status ?? "active",
    is_live: c.is_live ?? false,
    billing_type: c.billing_type ?? "",
    mrr: c.mrr != null ? String(c.mrr) : "",
    billing_day: c.billing_day != null ? String(c.billing_day) : "",
    launch_date: toDateInputValue(c.launch_date),
    date_signed: toDateInputValue(c.date_signed),
    contract_term_months: c.contract_term_months != null ? String(c.contract_term_months) : "",
    contract_end_date: toDateInputValue(c.contract_end_date),
    daily_adspend: c.daily_adspend != null ? String(c.daily_adspend) : "",
    performance_terms: c.performance_terms ?? "",
    churned_at: toDateInputValue(c.churned_at),
    phone_live_transfer: c.phone_live_transfer ?? "",
    live_transfer_approved: c.live_transfer_approved === true,
    appointment_watch: c.appointment_watch === true,
    brand_subject: c.brand_subject === "client" || c.brand_subject === "company" ? c.brand_subject : "",
    account_shape: c.account_shape === "solo" || c.account_shape === "team" ? c.account_shape : "",
    team_routing_notes: c.team_routing_notes ?? "",
    qualifies_leads: c.qualifies_leads === true ? "yes" : c.qualifies_leads === false ? "no" : "",
    qualification_notes: c.qualification_notes ?? "",
    offer_summary: c.offer_summary ?? "",
    facebook_page_name: c.facebook_page_name ?? "",
    instagram_handle: c.instagram_handle ?? "",
    ad_account_name: c.ad_account_name ?? "",
    ad_account_url: c.ad_account_url ?? "",
    thank_you_page_url: c.thank_you_page_url ?? "",
    second_landing_page_url: c.second_landing_page_url ?? "",
  };
}

export function draftToPatchBody(draft: Draft, canViewRevenue: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    primary_contact_name: draft.primary_contact_name.trim() || null,
    email: draft.email.trim() || null,
    billing_email: draft.billing_email.trim() || null,
    phone: draft.phone.trim() || null,
    reporting_type: draft.reporting_type,
    service_program: serviceProgramApplies(draft.reporting_type)
      ? draft.service_program || null
      : null,
    onboarding_clickup_task_id: draft.onboarding_clickup_task_id.trim() || null,
    ghl_location_id: draft.ghl_location_id.trim() || null,
    phone_ghl: draft.phone_ghl.trim() || null,
    source: normalizeClientLeadSource(draft.source),
    website: draft.website.trim() || null,
    drive_folder_url: draft.drive_folder_url.trim() || null,
    funnel_url: draft.funnel_url.trim() || null,
    virtual_business_card_url: draft.virtual_business_card_url.trim() || null,
    landing_page_url: draft.landing_page_url.trim() || null,
    brokerage_name: draft.brokerage_name.trim() || null,
    legal_business_name: draft.legal_business_name.trim() || null,
    nmls: draft.nmls.trim() || null,
    city: draft.city.trim() || null,
    state: draft.state.trim() || null,
    states_licensed: draft.states_licensed,
    timezone: draft.timezone.trim() || null,
    lifecycle_status: draft.lifecycle_status,
    billing_type: draft.billing_type || null,
    billing_day: draft.billing_day.trim() || null,
    launch_date: draft.launch_date || null,
    date_signed: draft.date_signed || null,
    contract_term_months: draft.contract_term_months.trim() || null,
    contract_end_date: draft.contract_end_date || null,
    performance_terms: draft.performance_terms.trim() || null,
    phone_live_transfer: draft.phone_live_transfer.trim() || null,
    live_transfer_approved: draft.live_transfer_approved,
    appointment_watch: draft.appointment_watch,
    brand_subject: draft.brand_subject || null,
    account_shape: draft.account_shape || null,
    team_routing_notes: draft.account_shape === "team" ? draft.team_routing_notes.trim() || null : null,
    qualifies_leads: draft.qualifies_leads === "yes" ? true : draft.qualifies_leads === "no" ? false : null,
    qualification_notes: draft.qualifies_leads === "yes" ? draft.qualification_notes.trim() || null : null,
    offer_summary: draft.offer_summary.trim() || null,
    facebook_page_name: draft.facebook_page_name.trim() || null,
    instagram_handle: draft.instagram_handle.trim() || null,
    ad_account_name: draft.ad_account_name.trim() || null,
    ad_account_url: draft.ad_account_url.trim() || null,
    thank_you_page_url: draft.thank_you_page_url.trim() || null,
    second_landing_page_url: draft.second_landing_page_url.trim() || null,
  };
  if (draft.lifecycle_status === "churned") {
    body.churned_at = draft.churned_at || null;
  }
  if (canViewRevenue) {
    body.mrr = draft.mrr.trim() || null;
    body.daily_adspend = draft.daily_adspend.trim() || null;
  }
  return body;
}

export function countMissingFields(c: EditableClient | null): number {
  if (!c) return 0;
  const checks = [
    !c.primary_contact_name && !c.primary_contact,
    !c.email && !c.billing_email,
    !c.phone,
    !normalizeClientLeadSource(c.source),
    !c.website,
    !c.brokerage_name,
    !c.nmls,
    !c.state,
    !c.states_licensed?.length,
    !c.timezone,
    !c.launch_date,
    !c.date_signed,
    c.contract_term_months == null,
    !c.billing_type,
    !c.ghl_location_id?.trim(),
  ];
  return checks.filter(Boolean).length;
}

export default function ClientFileEditForm({
  client,
  canViewRevenue,
  saving,
  saveError,
  onSave,
  onRequestOffboard,
}: {
  client: EditableClient;
  canViewRevenue: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: (body: Record<string, unknown>) => void | Promise<void>;
  onRequestOffboard?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => clientToDraft(client));
  const [submitting, setSubmitting] = useState(false);
  const busy = saving || submitting;

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!draft.name.trim()) return;
    if (draft.lifecycle_status === "churned" && client.lifecycle_status !== "churned") {
      onRequestOffboard?.();
      return;
    }
    setSubmitting(true);
    try {
      await onSave(draftToPatchBody(draft, canViewRevenue));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-7">
      {saveError && (
        <p className="text-sm px-3 py-2 rounded-lg" style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          {saveError}
        </p>
      )}

      <Section title="Overview">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          <Field label="Sub-account name *" value={draft.name} onChange={v => patch("name", v)} />
          <Field
            label="GHL location ID"
            value={draft.ghl_location_id}
            onChange={v => patch("ghl_location_id", v)}
            placeholder="Location id or GHL dashboard URL"
            highlightEmpty
            mono
          />
          <Field
            label="Go High Level number"
            value={draft.phone_ghl}
            onChange={v => patch("phone_ghl", v)}
            placeholder="GHL number we prospect with"
            highlightEmpty
          />
          <Field label="Client name" value={draft.primary_contact_name} onChange={v => patch("primary_contact_name", v)} highlightEmpty />
          <Field label="Email" type="email" value={draft.email} onChange={v => patch("email", v)} highlightEmpty />
          <Field label="Billing email" type="email" value={draft.billing_email} onChange={v => patch("billing_email", v)} highlightEmpty />
          <Field label="Phone" value={draft.phone} onChange={v => patch("phone", v)} highlightEmpty />
          <SelectField label="Product" value={draft.reporting_type} onChange={v => {
            const next = normalizeReportingType(v);
            patch("reporting_type", next);
            if (!serviceProgramApplies(next)) patch("service_program", "");
          }}>
            <ReportingTypeSelectOptions />
          </SelectField>
          {serviceProgramApplies(draft.reporting_type) && (
            <SelectField
              label="Fulfillment"
              value={draft.service_program}
              onChange={v => patch("service_program", (normalizeServiceProgram(v) ?? "") as ServiceProgram | "")}
            >
              <option value="">Unset</option>
              {SERVICE_PROGRAM_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </SelectField>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider" style={{ color: !draft.source ? "#f59e0b" : "#475569" }}>
              Lead source{!draft.source ? " · missing" : ""}
            </span>
            <ClientLeadSourceSelect
              value={draft.source}
              disabled={busy}
              highlightEmpty
              onChange={v => patch("source", v)}
            />
          </label>
          <Field
            label="Drive folder URL"
            value={draft.drive_folder_url}
            onChange={v => patch("drive_folder_url", v)}
            placeholder="https://drive.google.com/drive/folders/…"
          />
          <Field label="Company / brand" value={draft.legal_business_name} onChange={v => patch("legal_business_name", v)} />
          <Field label="Brokerage" value={draft.brokerage_name} onChange={v => patch("brokerage_name", v)} highlightEmpty />
          <Field label="NMLS" value={draft.nmls} onChange={v => patch("nmls", v)} highlightEmpty />
          <Field label="City" value={draft.city} onChange={v => patch("city", v)} />
          <Field label="State" value={draft.state} onChange={v => patch("state", v)} highlightEmpty />
          <Field
            label="ClickUp onboarding task ID"
            value={draft.onboarding_clickup_task_id}
            onChange={v => patch("onboarding_clickup_task_id", v)}
            placeholder="e.g. 86abc123"
          />
          <Field
            label="Live transfer phone"
            value={draft.phone_live_transfer}
            onChange={v => patch("phone_live_transfer", v)}
            placeholder="Number for live transfers"
          />
          <label className="flex flex-col gap-1 justify-end">
            <span className="text-xs uppercase tracking-wider" style={{ color: "#475569" }}>
              Accepts live transfers
            </span>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none py-2" style={{ color: "#e2e8f0" }}>
              <input
                type="checkbox"
                checked={draft.live_transfer_approved}
                disabled={busy}
                onChange={e => patch("live_transfer_approved", e.target.checked)}
                className="rounded"
              />
              Yes
            </label>
          </label>
          <label className="flex flex-col gap-1 justify-end">
            <span className="text-xs uppercase tracking-wider" style={{ color: "#475569" }}>
              Appointment Watch
            </span>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none py-2" style={{ color: "#e2e8f0" }}>
              <input
                type="checkbox"
                checked={draft.appointment_watch}
                disabled={busy}
                onChange={e => patch("appointment_watch", e.target.checked)}
                className="rounded"
              />
              Yes — dial appointments & live transfer
            </label>
          </label>
          <label className="flex flex-col gap-1 col-span-2 md:col-span-3">
            <span className="text-xs uppercase tracking-wider" style={{ color: "#475569" }}>
              Offer summary
            </span>
            <textarea
              value={draft.offer_summary}
              disabled={busy}
              onChange={e => patch("offer_summary", e.target.value)}
              rows={2}
              placeholder="Brief description of what this client is advertising (shown in Client Directory)"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
              style={inputStyle()}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider" style={{ color: !draft.states_licensed.length ? "#f59e0b" : "#475569" }}>
              Licensed in{!draft.states_licensed.length ? " · missing" : ""}
            </span>
            <StatesLicensedSelect
              value={draft.states_licensed}
              disabled={busy}
              onChange={codes => patch("states_licensed", codes)}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider" style={{ color: !draft.timezone ? "#f59e0b" : "#475569" }}>
              Timezone{!draft.timezone ? " · missing" : ""}
            </span>
            <TimezoneSelect
              value={draft.timezone}
              disabled={busy}
              highlightEmpty
              onChange={tz => patch("timezone", tz ?? "")}
            />
          </label>
          <SelectField label="Lifecycle" value={draft.lifecycle_status} onChange={v => {
            if (v === "churned" && client.lifecycle_status !== "churned") {
              onRequestOffboard?.();
              return;
            }
            patch("lifecycle_status", v);
          }}>
            {LIFECYCLE_OPTIONS.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </SelectField>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider" style={{ color: "#475569" }}>Reporting</span>
            <span
              className="text-sm font-semibold px-2 py-1.5 rounded-lg w-fit"
              style={
                draft.lifecycle_status === "active"
                  ? { color: "#22c55e", background: "rgba(34,197,94,0.12)" }
                  : { color: "#64748b", background: "rgba(100,116,139,0.12)" }
              }
            >
              {draft.lifecycle_status === "active" ? "Live in dashboards" : "Offline — not in reporting views"}
            </span>
          </label>
        </div>
      </Section>

      <Section title="Account setup">
        <p className="text-xs mb-3" style={{ color: "#64748b" }}>
          Whose name the ads use, and whether this is a team.
          {!usesCallCenterKpiLayout(draft.reporting_type) &&
            " Qualify checked: hand-raise % and conversation % use qualified leads. Unchecked: those rates use every lead."}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          <SelectField
            label="Brand"
            value={draft.brand_subject}
            onChange={v => patch("brand_subject", (v === "client" || v === "company" ? v : "") as BrandSubject | "")}
            highlightEmpty
          >
            <option value="">Unset</option>
            {BRAND_SUBJECTS.map(value => (
              <option key={value} value={value}>{BRAND_SUBJECT_LABELS[value]}</option>
            ))}
          </SelectField>
          <SelectField
            label="Team"
            value={draft.account_shape}
            onChange={v => patch("account_shape", (v === "solo" || v === "team" ? v : "") as AccountShape | "")}
            highlightEmpty
          >
            <option value="">Unset</option>
            {ACCOUNT_SHAPES.map(value => (
              <option key={value} value={value}>{ACCOUNT_SHAPE_LABELS[value]}</option>
            ))}
          </SelectField>
          {!usesCallCenterKpiLayout(draft.reporting_type) && (
            <SelectField
              label="We qualify leads"
              value={draft.qualifies_leads}
              onChange={v => patch("qualifies_leads", v === "yes" || v === "no" ? v : "")}
              highlightEmpty
            >
              <option value="">Unset</option>
              <option value="yes">Yes — dial qualified only</option>
              <option value="no">No — book every lead</option>
            </SelectField>
          )}
          {draft.account_shape === "team" && (
            <Field
              label="Lead routing"
              value={draft.team_routing_notes}
              onChange={v => patch("team_routing_notes", v)}
              placeholder="Who receives each lead, and how it is split."
              highlightEmpty
              wide
              multiline
            />
          )}
          {draft.qualifies_leads === "yes" && !usesCallCenterKpiLayout(draft.reporting_type) && (
            <Field
              label="How we qualify"
              value={draft.qualification_notes}
              onChange={v => patch("qualification_notes", v)}
              placeholder="What counts as a qualified lead for this client."
              highlightEmpty
              wide
              multiline
            />
          )}
        </div>
      </Section>

      <Section title="Billing setup">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          <SelectField label="Billing type" value={draft.billing_type} onChange={v => patch("billing_type", v)} highlightEmpty>
            <option value="">Monthly (default)</option>
            <option value="monthly">Monthly</option>
            <option value="pif">PIF</option>
            <option value="pif_monthly">PIF + Monthly</option>
          </SelectField>
          {canViewRevenue && (
            <>
              <Field label="Monthly $ (base)" type="number" value={draft.mrr} onChange={v => patch("mrr", v)} />
              <Field label="Daily ad spend" type="number" value={draft.daily_adspend} onChange={v => patch("daily_adspend", v)} />
            </>
          )}
          <Field label="Billing day (1–31)" type="number" value={draft.billing_day} onChange={v => patch("billing_day", v)} placeholder="Launch day if blank" />
          <Field label="Launch date" type="date" value={draft.launch_date} onChange={v => patch("launch_date", v)} highlightEmpty />
          <Field label="Date signed" type="date" value={draft.date_signed} onChange={v => patch("date_signed", v)} highlightEmpty />
          <Field label="Contract term (mo)" type="number" value={draft.contract_term_months} onChange={v => patch("contract_term_months", v)} highlightEmpty />
          <Field label="Contract end" type="date" value={draft.contract_end_date} onChange={v => patch("contract_end_date", v)} />
          {draft.lifecycle_status === "churned" && (
            <Field label="Churn date" type="date" value={draft.churned_at} onChange={v => patch("churned_at", v)} />
          )}
        </div>
        <div className="mt-4">
          <Field label="Performance terms" value={draft.performance_terms} onChange={v => patch("performance_terms", v)} wide multiline />
        </div>
        {draft.lifecycle_status === "churned" && !draft.churned_at && (
          <p className="text-xs mt-3" style={{ color: "#f59e0b" }}>No churn date on file — set one above to backfill reporting.</p>
        )}
      </Section>

      <Section title="Media buying">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          <Field label="Facebook page" value={draft.facebook_page_name} onChange={v => patch("facebook_page_name", v)} />
          <Field label="Instagram" value={draft.instagram_handle} onChange={v => patch("instagram_handle", v)} placeholder="@handle" />
          <Field label="Ad account name" value={draft.ad_account_name} onChange={v => patch("ad_account_name", v)} />
          <Field
            label="Ad account link"
            value={draft.ad_account_url}
            onChange={v => patch("ad_account_url", v)}
            placeholder="https://adsmanager.facebook.com/…"
            wide
          />
        </div>
      </Section>

      <Section title="Websites & funnels">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          <Field
            label="Personal website"
            value={draft.website}
            onChange={v => patch("website", v)}
            placeholder="https://…"
            highlightEmpty
            wide
          />
          <Field
            label="Built landing page"
            value={draft.landing_page_url}
            onChange={v => patch("landing_page_url", v)}
            placeholder="Agency-built lander (e.g. homequityhacks)…"
            wide
          />
          <Field
            label="Perspective funnel"
            value={draft.funnel_url}
            onChange={v => patch("funnel_url", v)}
            placeholder="Ads → Perspective entry URL…"
            wide
          />
          <Field
            label="Virtual Business Card"
            value={draft.virtual_business_card_url}
            onChange={v => patch("virtual_business_card_url", v)}
            placeholder="https://loanofficer.me/… (set by Card publish)"
            wide
          />
          <Field
            label="Thank-you page"
            value={draft.thank_you_page_url}
            onChange={v => patch("thank_you_page_url", v)}
            placeholder="https://…"
            wide
          />
        </div>
      </Section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.name.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-lg"
          style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", opacity: busy || !draft.name.trim() ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "#cbd5e1" }}>{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, highlightEmpty, wide, multiline, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  highlightEmpty?: boolean;
  wide?: boolean;
  multiline?: boolean;
  mono?: boolean;
}) {
  const missing = highlightEmpty && !value.trim();
  const cls = `px-2 py-1.5 rounded-lg text-sm outline-none w-full${mono ? " font-mono" : ""}`;
  return (
    <label className={wide ? "col-span-2 md:col-span-3 flex flex-col gap-1" : "flex flex-col gap-1"}>
      <span className="text-xs uppercase tracking-wider" style={{ color: missing ? "#f59e0b" : "#475569" }}>
        {label}{missing ? " · missing" : ""}
      </span>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} placeholder={placeholder} className={cls} style={inputStyle(missing)} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} style={inputStyle(missing)} />
      )}
    </label>
  );
}

function SelectField({
  label, value, onChange, children, highlightEmpty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  highlightEmpty?: boolean;
}) {
  const missing = highlightEmpty && !value;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider" style={{ color: missing ? "#f59e0b" : "#475569" }}>
        {label}{missing ? " · missing" : ""}
      </span>
      <select value={value} onChange={e => onChange(e.target.value)} className="px-2 py-1.5 rounded-lg text-sm outline-none cursor-pointer w-full" style={inputStyle(missing)}>
        {children}
      </select>
    </label>
  );
}
