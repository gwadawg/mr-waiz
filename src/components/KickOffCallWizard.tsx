"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import ReportingTypeBadge, { ServiceProgramBadge } from "@/components/ReportingTypeBadge";
import StatesLicensedSelect from "@/components/StatesLicensedSelect";
import TimezoneSelect from "@/components/TimezoneSelect";
import {
  getOnboardingFormProfile,
} from "@/lib/onboarding-form-profile";
import {
  applyKickoffSavedNarrative,
  CC_KICKOFF_FIELD_LABELS,
  CONTACT_ROLE_OPTIONS,
  countKickoffFieldsOnFile,
  getKickoffConfig,
  isKickoffFieldVisible,
  isKickoffIdentityFieldComplete,
  isKickoffSetupResolved,
  KICKOFF_PM_FIELD_LABELS,
  kickoffDraftFromClient,
  kickoffDraftToBody,
  kickoffFieldHadValue,
  kickoffFieldsMatch,
  kickoffIdentitySlice,
  type KickoffClient,
  type KickoffConfig,
  type KickoffDraft,
} from "@/lib/kickoff";
import type { RelatedOfferSummary } from "@/lib/client-identity";
import {
  getReportingTypeLabel,
  REPORTING_TYPE_META,
  type ReportingType,
} from "@/lib/reporting-types";
import {
  SERVICE_PROGRAM_META,
  serviceProgramApplies,
  type ServiceProgram,
} from "@/lib/service-program";

type Props = {
  clientId: string;
  fallbackName: string;
  onClose: () => void;
  onCompleted?: () => void;
};

function fieldStyle(shareMode: boolean, status: "empty" | "on_file" | "edited" = "empty"): CSSProperties {
  if (status === "edited") {
    return shareMode
      ? { background: "#fffbeb", border: "1px solid #fcd34d", color: "#111827" }
      : { background: "#2a220f", border: "1px solid rgba(245,158,11,0.45)", color: "#e2e8f0" };
  }
  if (shareMode) {
    return {
      background: status === "on_file" ? "#f0fdf4" : "#ffffff",
      border: status === "on_file" ? "1px solid #86efac" : "1px solid #d1d5db",
      color: "#111827",
    };
  }
  return {
    background: status === "on_file" ? "#0f2a1a" : "#0f2040",
    border: status === "on_file" ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.12)",
    color: "#e2e8f0",
  };
}

function labelColor(shareMode: boolean): string {
  return shareMode ? "#374151" : "#475569";
}

function sectionTitleColor(shareMode: boolean): string {
  return shareMode ? "#111827" : "#cbd5e1";
}

function helperColor(shareMode: boolean): string {
  return shareMode ? "#6b7280" : "#64748b";
}

export default function KickOffCallWizard({ clientId, fallbackName, onClose, onCompleted }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareMode, setShareMode] = useState(true);
  const [clientName, setClientName] = useState(fallbackName);
  const [canViewRevenue, setCanViewRevenue] = useState(false);
  const [draft, setDraft] = useState<KickoffDraft | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<KickoffDraft | null>(null);
  const [kickoffComplete, setKickoffComplete] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showVerticalPicker, setShowVerticalPicker] = useState(false);
  const [identityComplete, setIdentityComplete] = useState(false);
  const [relatedOffers, setRelatedOffers] = useState<RelatedOfferSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/clients/${clientId}/kickoff`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load kick-off data");
        setLoading(false);
        return;
      }
      const c = data.client as KickoffClient;
      const recording = data.onboarding_call?.recording_url ?? "";
      const transcript = data.onboarding_call?.transcript ?? "";
      const verticalConfirmed = !!data.vertical_confirmed;
      const nextDraft = applyKickoffSavedNarrative(
        kickoffDraftFromClient(c, recording, verticalConfirmed, transcript),
        data.saved_narrative,
      );
      setClientName(c.name || fallbackName);
      setCanViewRevenue(!!data.can_view_revenue);
      setDraft(nextDraft);
      setInitialSnapshot(nextDraft);
      setKickoffComplete(!!data.kickoff_complete);
      setShowVerticalPicker(!verticalConfirmed);
      setIdentityComplete(!!data.identity_complete || isKickoffIdentityFieldComplete(kickoffIdentitySlice(nextDraft)));
      setRelatedOffers(Array.isArray(data.related_offers) ? data.related_offers : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId, fallbackName]);

  const formProfile = useMemo(
    () => (draft ? getOnboardingFormProfile(draft.reporting_type, draft.service_program) : "marketing_core"),
    [draft],
  );

  const kickoffConfig: KickoffConfig = useMemo(
    () => getKickoffConfig(formProfile, canViewRevenue),
    [formProfile, canViewRevenue],
  );

  function visible(key: Parameters<typeof isKickoffFieldVisible>[0]) {
    return isKickoffFieldVisible(key, formProfile, canViewRevenue);
  }

  function patch<K extends keyof KickoffDraft>(key: K, value: KickoffDraft[K]) {
    setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
    setSaveError(null);
    setSaveNotice(null);
  }

  function selectVertical(vertical: ReportingType) {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        reporting_type: vertical,
        vertical_confirmed: true,
        service_program: serviceProgramApplies(vertical) ? prev.service_program : "",
      };
    });
    setShowVerticalPicker(false);
    setSaveError(null);
  }

  function selectServiceProgram(program: ServiceProgram) {
    patch("service_program", program);
  }

  function fieldStatus(key: keyof KickoffDraft): "empty" | "on_file" | "edited" {
    if (!initialSnapshot || !draft) return "empty";
    const hadValue = kickoffFieldHadValue(initialSnapshot, key);
    if (!hadValue) return "empty";
    return kickoffFieldsMatch(initialSnapshot, draft, key) ? "on_file" : "edited";
  }

  async function submit(saveMode: "progress" | "complete") {
    if (!draft) return;
    if (saveMode === "complete" && !draft.vertical_confirmed) {
      setSaveError("Select client vertical before completing kick-off.");
      return;
    }
    if (saveMode === "complete" && serviceProgramApplies(draft.reporting_type) && !draft.service_program) {
      setSaveError("Select fulfillment (Call Center or Leads Only) before completing.");
      return;
    }
    if (saveMode === "complete" && shareMode) {
      setSaveError("Turn off Share Mode to fill in post-call fields before completing.");
      return;
    }
    if (saveMode === "complete" && !draft.sub_account_name.trim()) {
      setSaveError("GHL sub-account name is required — copy the exact name from GHL.");
      return;
    }
    if (saveMode === "complete" && !draft.ghl_location_id.trim() && !kickoffComplete) {
      setSaveError("Client GHL Location ID is required.");
      return;
    }
    if (saveMode === "complete" && !draft.recording_url.trim() && !kickoffComplete) {
      setSaveError("OB call recording link is required.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const res = await fetch(`/api/clients/${clientId}/kickoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kickoffDraftToBody(draft, canViewRevenue, saveMode)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to save kick-off");
      setSaving(false);
      return;
    }
    const recording = data.onboarding_call?.recording_url ?? draft.recording_url;
    const transcript = data.onboarding_call?.transcript ?? draft.transcript;
    const refreshed = kickoffDraftFromClient(
      data.client as KickoffClient,
      recording,
      !!data.vertical_confirmed,
      transcript,
    );
    setDraft(refreshed);
    setInitialSnapshot(refreshed);
    setKickoffComplete(!!data.kickoff_complete);
    setShowVerticalPicker(!data.vertical_confirmed);
    setIdentityComplete(!!data.identity_complete || isKickoffIdentityFieldComplete(kickoffIdentitySlice(refreshed)));
    setRelatedOffers(Array.isArray(data.related_offers) ? data.related_offers : []);
    setSaving(false);
    if (saveMode === "complete") {
      onCompleted?.();
      onClose();
      return;
    }
    setSaveNotice("Progress saved — fields stay editable if the client wants changes.");
  }

  const onFileCount = initialSnapshot ? countKickoffFieldsOnFile(initialSnapshot) : 0;
  const setupResolved = draft ? isKickoffSetupResolved(draft) : false;

  const shellBg = shareMode ? "#f9fafb" : "#060d1a";
  const headerBg = shareMode ? "#ffffff" : "#0a1628";
  const borderColor = shareMode ? "#e5e7eb" : "rgba(255,255,255,0.08)";
  const titleColor = shareMode ? "#111827" : "#e2e8f0";
  const subtitleColor = shareMode ? "#6b7280" : "#475569";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto py-6 px-4"
      style={{ background: shareMode ? "rgba(249,250,251,0.98)" : "rgba(2,6,15,0.85)" }}
    >
      <div
        className="w-full rounded-xl shadow-2xl overflow-hidden"
        style={{ maxWidth: 640, background: shellBg, border: `1px solid ${borderColor}` }}
      >
        <div
          className="px-6 py-4 flex items-start justify-between gap-4 sticky top-0 z-10"
          style={{ background: headerBg, borderBottom: `1px solid ${borderColor}` }}
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold" style={{ color: titleColor }}>
                Kick-Off Call
              </h2>
              {draft?.vertical_confirmed && (
                <>
                  <ReportingTypeBadge value={draft.reporting_type} size="sm" />
                  {draft.service_program && (
                    <ServiceProgramBadge value={draft.service_program} size="sm" />
                  )}
                </>
              )}
            </div>
            <p className="text-sm mt-0.5" style={{ color: subtitleColor }}>
              {clientName} — review what we have on file, confirm with the client, and edit anything that changed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
            style={{
              color: shareMode ? "#374151" : "#94a3b8",
              background: shareMode ? "#f3f4f6" : "rgba(255,255,255,0.05)",
              border: `1px solid ${borderColor}`,
            }}
          >
            Close
          </button>
        </div>

        <div className="px-6 py-4" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <p className="text-sm font-semibold" style={{ color: titleColor }}>
                Sharing screen with client
              </p>
              <p className="text-xs mt-0.5" style={{ color: subtitleColor }}>
                When on, only client-safe fields are shown. Internal fields stay hidden.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={shareMode}
              onClick={() => setShareMode(v => !v)}
              className="relative inline-flex h-7 w-12 flex-shrink-0 rounded-full transition-colors"
              style={{ background: shareMode ? "#22c55e" : "#334155" }}
            >
              <span
                className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-1"
                style={{ marginLeft: shareMode ? "1.375rem" : "0.25rem" }}
              />
            </button>
          </label>
        </div>

        {loading ? (
          <p className="text-sm py-16 text-center" style={{ color: subtitleColor }}>Loading…</p>
        ) : error ? (
          <p className="text-sm py-16 text-center px-6" style={{ color: "#ef4444" }}>{error}</p>
        ) : draft ? (
          <div className="px-6 py-6 space-y-8">
            <Section title="Service setup" shareMode={shareMode}>
              {(showVerticalPicker || !draft.vertical_confirmed) ? (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: labelColor(shareMode) }}>
                    What type of client is this?
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(["RM", "DSCR", "CALL_CENTER"] as ReportingType[]).map(v => {
                      const meta = REPORTING_TYPE_META[v];
                      const selected = draft.reporting_type === v && draft.vertical_confirmed;
                      return (
                        <button
                          key={v}
                          type="button"
                          disabled={saving}
                          onClick={() => selectVertical(v)}
                          className="text-left px-3 py-3 rounded-lg text-sm transition-colors"
                          style={{
                            color: titleColor,
                            background: selected
                              ? shareMode ? meta.background : meta.background
                              : shareMode ? "#ffffff" : "rgba(255,255,255,0.04)",
                            border: selected
                              ? `2px solid ${meta.color}`
                              : `1px solid ${borderColor}`,
                          }}
                        >
                          <span className="font-semibold block">{meta.shortLabel}</span>
                          <span className="text-xs mt-1 block" style={{ color: subtitleColor }}>
                            {meta.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <ReportingTypeBadge value={draft.reporting_type} size="md" />
                  <span className="text-sm" style={{ color: labelColor(shareMode) }}>
                    {getReportingTypeLabel(draft.reporting_type)}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium underline"
                    style={{ color: shareMode ? "#2563eb" : "#60a5fa" }}
                    onClick={() => setShowVerticalPicker(true)}
                  >
                    Change
                  </button>
                </div>
              )}

              {draft.vertical_confirmed && serviceProgramApplies(draft.reporting_type) && (
                <div className="mt-5 space-y-3">
                  <p className="text-sm font-medium" style={{ color: labelColor(shareMode) }}>
                    What fulfillment are we doing?
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(["core", "lead_gen"] as ServiceProgram[]).map(p => {
                      const meta = SERVICE_PROGRAM_META[p];
                      const selected = draft.service_program === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          disabled={saving}
                          onClick={() => selectServiceProgram(p)}
                          className="text-left px-3 py-3 rounded-lg text-sm transition-colors"
                          style={{
                            color: titleColor,
                            background: selected ? meta.background : shareMode ? "#ffffff" : "rgba(255,255,255,0.04)",
                            border: selected ? `2px solid ${meta.color}` : `1px solid ${borderColor}`,
                          }}
                        >
                          <span className="font-semibold block">{meta.label}</span>
                          <span className="text-xs mt-1 block" style={{ color: subtitleColor }}>
                            {meta.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {draft.vertical_confirmed && draft.reporting_type === "CALL_CENTER" && (
                <p className="text-sm mt-3" style={{ color: subtitleColor }}>
                  Fulfillment package is not applicable for HE clients.
                </p>
              )}
            </Section>

            {!setupResolved && (
              <p className="text-sm rounded-lg px-4 py-3" style={{ color: subtitleColor, background: shareMode ? "#f3f4f6" : "#0f2040", border: `1px solid ${borderColor}` }}>
                Complete service setup above to unlock the rest of the kick-off form.
              </p>
            )}

            {setupResolved && (
              <>
                {onFileCount > 0 && !identityComplete && (
                  <div
                    className="rounded-lg px-4 py-3 text-sm"
                    style={{
                      color: shareMode ? "#166534" : "#86efac",
                      background: shareMode ? "#f0fdf4" : "rgba(34,197,94,0.08)",
                      border: shareMode ? "1px solid #bbf7d0" : "1px solid rgba(34,197,94,0.25)",
                    }}
                  >
                    <strong>{onFileCount} field{onFileCount === 1 ? "" : "s"} pre-filled</strong> from the client record.
                  </div>
                )}

                {identityComplete && (
                  <div
                    className="rounded-lg px-4 py-3 text-sm"
                    style={{
                      color: shareMode ? "#1e40af" : "#93c5fd",
                      background: shareMode ? "#eff6ff" : "rgba(59,130,246,0.08)",
                      border: shareMode ? "1px solid #bfdbfe" : "1px solid rgba(59,130,246,0.25)",
                    }}
                  >
                    <strong>Contact profile already on file</strong>
                    {relatedOffers.length > 1 ? (
                      <> — phone, NMLS, licenses, and timezone are shared across {relatedOffers.length} offers for this client. Update them in the client file if anything changed.</>
                    ) : (
                      <> — phone, NMLS, licenses, and timezone are already saved. Update them in the client file if anything changed.</>
                    )}
                  </div>
                )}

                {!identityComplete && (
                <Section title="Confirm Information" shareMode={shareMode}>
                  <div className="space-y-4">
                    {visible("phone") && (
                      <Field label="Phone" required shareMode={shareMode} status={fieldStatus("phone")} helper="Primary contact number on file.">
                        <input type="tel" value={draft.phone} disabled={saving} onChange={e => patch("phone", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("phone"))} />
                      </Field>
                    )}
                    {visible("contact_role") && (
                      <Field label="What position best describes your role?" shareMode={shareMode} status={fieldStatus("contact_role")}>
                        <select value={draft.contact_role} disabled={saving} onChange={e => patch("contact_role", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none cursor-pointer" style={fieldStyle(shareMode, fieldStatus("contact_role"))}>
                          <option value="">Select…</option>
                          {CONTACT_ROLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </Field>
                    )}
                    {visible("states_licensed") && (
                      <Field label="States Licensed" shareMode={shareMode} status={fieldStatus("states_licensed")}>
                        <StatesLicensedSelect value={draft.states_licensed} disabled={saving} onChange={codes => patch("states_licensed", codes)} className="w-full" />
                      </Field>
                    )}
                    {visible("nmls") && (
                      <Field label="NMLS #" shareMode={shareMode} status={fieldStatus("nmls")}>
                        <input value={draft.nmls} disabled={saving} onChange={e => patch("nmls", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono" style={fieldStyle(shareMode, fieldStatus("nmls"))} />
                      </Field>
                    )}
                    {visible("brokerage_name") && (
                      <Field label="Bank / Broker / Lender Working For" shareMode={shareMode} status={fieldStatus("brokerage_name")} helper="Wherever their license is hung up.">
                        <input value={draft.brokerage_name} disabled={saving} onChange={e => patch("brokerage_name", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("brokerage_name"))} />
                      </Field>
                    )}
                    {visible("timezone") && (
                      <Field label="Current Timezone" shareMode={shareMode} status={fieldStatus("timezone")}>
                        <TimezoneSelect value={draft.timezone} disabled={saving} highlightEmpty onChange={tz => patch("timezone", tz ?? "")} className="w-full px-3 py-2 rounded-lg text-sm" />
                      </Field>
                    )}
                  </div>
                </Section>
                )}

                {(visible("appointment_settings") || visible("daily_adspend") || visible("facebook_page_name") || visible("phone_notifications") || visible("phone_live_transfer")) && (
                  <Section title="Get Information" shareMode={shareMode}>
                    <div className="space-y-4">
                      {visible("appointment_settings") && (
                        <Field label="Appointment Length, Details & Buffer Time" shareMode={shareMode} status={fieldStatus("appointment_settings")} helper="Recommended: 15-min time slots, 30-min calls.">
                          <input value={draft.appointment_settings} disabled={saving} onChange={e => patch("appointment_settings", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("appointment_settings"))} />
                        </Field>
                      )}
                      {visible("daily_adspend") && (
                        <Field label="Daily Adspend" shareMode={shareMode} status={fieldStatus("daily_adspend")} helper="Average starting point is $50–$100/day.">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: helperColor(shareMode) }}>$</span>
                            <input type="number" min={0} value={draft.daily_adspend} disabled={saving} onChange={e => patch("daily_adspend", e.target.value)} className="w-full pl-7 pr-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("daily_adspend"))} />
                          </div>
                        </Field>
                      )}
                      {visible("facebook_page_name") && (
                        <Field label="Facebook Page Name" shareMode={shareMode} status={fieldStatus("facebook_page_name")}>
                          <input value={draft.facebook_page_name} disabled={saving} onChange={e => patch("facebook_page_name", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("facebook_page_name"))} />
                        </Field>
                      )}
                      {visible("phone_notifications") && (
                        <Field label="Notification number" shareMode={shareMode} status={fieldStatus("phone_notifications")} helper="A client number we send notifications to, when that is different from the live transfer number.">
                          <input type="tel" value={draft.phone_notifications} disabled={saving} onChange={e => patch("phone_notifications", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("phone_notifications"))} />
                        </Field>
                      )}
                      {visible("phone_live_transfer") && (
                        <>
                          <Field label="Live transfer number" shareMode={shareMode} status={fieldStatus("phone_live_transfer")} helper="The client's phone. This is the number we call to live-transfer a lead to them.">
                            <input type="tel" value={draft.phone_live_transfer} disabled={saving} onChange={e => patch("phone_live_transfer", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("phone_live_transfer"))} />
                          </Field>
                          <Field label="Live Transfer Approved?" shareMode={shareMode} status={fieldStatus("live_transfer_approved")}>
                            <select value={draft.live_transfer_approved} disabled={saving} onChange={e => patch("live_transfer_approved", e.target.value as KickoffDraft["live_transfer_approved"])} className="w-full px-3 py-2 rounded-lg text-sm outline-none cursor-pointer" style={fieldStyle(shareMode, fieldStatus("live_transfer_approved"))}>
                              <option value="">Select…</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </Field>
                        </>
                      )}
                    </div>
                  </Section>
                )}

                {!shareMode && kickoffConfig.showPmSection && (
                  <Section title="PM / Landing Page" shareMode={shareMode}>
                    <p className="text-xs -mt-2 mb-3" style={{ color: helperColor(shareMode) }}>
                      Saved to Client notes on the client file.
                    </p>
                    <div className="space-y-4">
                      {(Object.keys(KICKOFF_PM_FIELD_LABELS) as (keyof typeof KICKOFF_PM_FIELD_LABELS)[]).map(key => (
                        <Field key={key} label={KICKOFF_PM_FIELD_LABELS[key]} shareMode={shareMode} status={fieldStatus(key)}>
                          {key === "pm_competitor_refs" ? (
                            <input value={draft[key]} disabled={saving} onChange={e => patch(key, e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus(key))} />
                          ) : (
                            <textarea value={draft[key]} disabled={saving} onChange={e => patch(key, e.target.value)} rows={key === "pm_landing_copy" ? 3 : 2} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus(key))} />
                          )}
                        </Field>
                      ))}
                    </div>
                  </Section>
                )}

                {!shareMode && kickoffConfig.showCallCenterSection && (
                  <Section title="Call Center Setup" shareMode={shareMode}>
                    <p className="text-xs -mt-2 mb-3" style={{ color: helperColor(shareMode) }}>
                      Saved to Client notes on the client file.
                    </p>
                    <div className="space-y-4">
                      {(["cc_lead_source", "cc_qualification_criteria", "cc_hp_tag_user", "cc_setter_notes"] as const).map(key => (
                        <Field key={key} label={CC_KICKOFF_FIELD_LABELS[key]} shareMode={shareMode} status={fieldStatus(key)}>
                          <textarea value={draft[key]} disabled={saving} onChange={e => patch(key, e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus(key))} />
                        </Field>
                      ))}
                    </div>
                  </Section>
                )}

                {!shareMode && (
                  <Section title="Post Call" shareMode={shareMode}>
                    <div className="space-y-4">
                      <Field label="GHL sub-account name" required shareMode={shareMode} status={fieldStatus("sub_account_name")} helper="Copy the exact location name from GHL (OK if it matches the LO).">
                        <input value={draft.sub_account_name} disabled={saving} onChange={e => patch("sub_account_name", e.target.value)} placeholder="Exact GHL location name" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("sub_account_name"))} />
                      </Field>
                      <Field label="Client GHL Location ID" required shareMode={shareMode} status={fieldStatus("ghl_location_id")}>
                        <input value={draft.ghl_location_id} disabled={saving} onChange={e => patch("ghl_location_id", e.target.value)} placeholder="GHL subaccount location id" className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono" style={fieldStyle(shareMode, fieldStatus("ghl_location_id"))} />
                      </Field>
                      <Field label="OB Call Recording Link" required shareMode={shareMode} status={fieldStatus("recording_url")}>
                        <input type="url" value={draft.recording_url} disabled={saving} onChange={e => patch("recording_url", e.target.value)} placeholder="https://…" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={fieldStyle(shareMode, fieldStatus("recording_url"))} />
                      </Field>
                      <Field label="OB Call Transcript" shareMode={shareMode} helper="Paste the full call transcript for search and review in Client Calls.">
                        <textarea value={draft.transcript} disabled={saving} onChange={e => patch("transcript", e.target.value)} rows={5} placeholder="Paste call transcript…" className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y" style={fieldStyle(shareMode, fieldStatus("transcript"))} />
                      </Field>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={draft.advance_lifecycle} disabled={saving} onChange={e => patch("advance_lifecycle", e.target.checked)} className="mt-1" />
                        <span className="text-sm" style={{ color: labelColor(shareMode) }}>
                          Move lifecycle from <strong>new account</strong> to <strong>onboarding</strong> when saved
                        </span>
                      </label>
                    </div>
                  </Section>
                )}

                {shareMode && (
                  <p className="text-sm rounded-lg px-4 py-3" style={{ color: subtitleColor, background: shareMode ? "#eff6ff" : "#0f2040", border: `1px solid ${shareMode ? "#bfdbfe" : "rgba(255,255,255,0.08)"}` }}>
                    Post-call fields (GHL Location ID, recording link) appear when Share Mode is off.
                  </p>
                )}
              </>
            )}

            {saveNotice && (
              <p className="text-sm rounded-lg px-4 py-3" style={{ color: "#22c55e", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
                {saveNotice}
              </p>
            )}

            {saveError && (
              <p className="text-sm rounded-lg px-4 py-3" style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                {saveError}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => submit("progress")}
                disabled={saving || !draft.vertical_confirmed}
                className="flex-1 text-sm font-semibold px-4 py-3 rounded-lg"
                style={{
                  color: shareMode ? "#374151" : "#e2e8f0",
                  background: shareMode ? "#ffffff" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${borderColor}`,
                  opacity: saving || !draft.vertical_confirmed ? 0.6 : 1,
                }}
              >
                {saving ? "Saving…" : "Save progress"}
              </button>
              {!shareMode && setupResolved && (
                <button
                  type="button"
                  onClick={() => submit("complete")}
                  disabled={saving}
                  className="flex-1 text-sm font-semibold px-4 py-3 rounded-lg"
                  style={{ color: "#ffffff", background: "#2563eb", opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "Saving…" : kickoffComplete ? "Save changes" : "Complete Kick-Off"}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, shareMode, children }: { title: string; shareMode: boolean; children: ReactNode }) {
  return (
    <section>
      <h3
        className="text-base font-semibold mb-4 pb-2"
        style={{ color: sectionTitleColor(shareMode), borderBottom: `1px solid ${shareMode ? "#e5e7eb" : "rgba(255,255,255,0.06)"}` }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  shareMode,
  status = "empty",
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  shareMode: boolean;
  status?: "empty" | "on_file" | "edited";
  helper?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium" style={{ color: labelColor(shareMode) }}>
        {label}
        {required && <span style={{ color: "#ef4444" }}> *</span>}
        {status === "on_file" && <span className="ml-2 text-xs font-normal" style={{ color: "#22c55e" }}>on file</span>}
        {status === "edited" && <span className="ml-2 text-xs font-normal" style={{ color: "#f59e0b" }}>edited</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {helper && <p className="text-xs mt-1.5" style={{ color: helperColor(shareMode) }}>{helper}</p>}
    </label>
  );
}
