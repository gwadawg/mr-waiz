"use client";

import { useEffect, useRef, useState } from "react";
import ReportingTypeBadge, { ServiceProgramBadge } from "@/components/ReportingTypeBadge";
import { ONBOARDING_PROFILE_META } from "@/lib/onboarding-form-profile";
import {
  countSatisfiedInSection,
  countSatisfiedItems,
  emptyLaunchDraft,
  getLaunchItemsForProfile,
  getLaunchSectionsForProfile,
  isLaunchAdsReady,
  isLaunchChecklistComplete,
  isLaunchItemSatisfied,
  isTypedYes,
  launchAdsGateApplies,
  launchAdsReadyLabel,
  launchWalkthroughBlurb,
  LAUNCH_ADS_READY,
  LAUNCH_FINAL_CONFIRMATION,
  type LaunchChecklistItemDef,
  type LaunchFormDraft,
  type LaunchSectionId,
} from "@/lib/launch-form";
import type { OnboardingFormProfile } from "@/lib/onboarding-form-profile";

type AssignableUser = { id: string; email: string };

type ChecklistConfig = {
  profile: OnboardingFormProfile;
  sections: { id: LaunchSectionId; label: string }[];
  items: LaunchChecklistItemDef[];
};

type Props = {
  clientId: string;
  fallbackName: string;
  onClose: () => void;
  onCompleted?: () => void;
};

const fieldStyle = {
  background: "#0f2040",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
};

export default function LaunchChecklistWizard({ clientId, fallbackName, onClose, onCompleted }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clientName, setClientName] = useState(fallbackName);
  const [kickoffComplete, setKickoffComplete] = useState(true);
  const [alreadyLaunched, setAlreadyLaunched] = useState(false);
  const [hasLaunchKit, setHasLaunchKit] = useState(true);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [formProfile, setFormProfile] = useState<OnboardingFormProfile>("marketing_core");
  const [checklistConfig, setChecklistConfig] = useState<ChecklistConfig | null>(null);
  const [clientMeta, setClientMeta] = useState<{ reporting_type?: string; service_program?: string | null }>({});
  const [draft, setDraft] = useState<LaunchFormDraft>(emptyLaunchDraft());
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/clients/${clientId}/launch`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load launch checklist");
        setLoading(false);
        return;
      }
      const profile = (data.form_profile ?? "marketing_core") as OnboardingFormProfile;
      setClientName(data.client?.name ?? fallbackName);
      setKickoffComplete(!!data.kickoff_complete);
      setAlreadyLaunched(!!data.already_launched);
      setHasLaunchKit(data.has_launch_kit !== false);
      setAssignableUsers(data.assignable_users ?? []);
      setFormProfile(profile);
      setChecklistConfig(data.checklist_config ?? null);
      setClientMeta({
        reporting_type: data.client?.reporting_type,
        service_program: data.client?.service_program,
      });
      setDraft(
        emptyLaunchDraft(
          profile,
          data.default_launch_date ?? "",
          data.default_completed_by ?? "",
          data.default_completed_by_label ?? "",
          data.client?.phone_ghl ?? "",
        ),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId, fallbackName]);

  function patchChecklist(key: string, checked: boolean) {
    setDraft(prev => ({
      ...prev,
      checklist: { ...prev.checklist, [key]: checked },
    }));
    setSaveError(null);
  }

  function patchConfirmation(key: string, value: string) {
    setDraft(prev => ({
      ...prev,
      confirmations: { ...prev.confirmations, [key]: value },
      checklist: {
        ...prev.checklist,
        [key]: isTypedYes(value) ? prev.checklist[key] : false,
      },
    }));
    setSaveError(null);
  }

  function handleCompletedByChange(userId: string) {
    const user = assignableUsers.find(u => u.id === userId);
    setDraft(prev => ({
      ...prev,
      completed_by_user_id: userId,
      completed_by_label: user?.email ?? "",
    }));
    setSaveError(null);
  }

  function scrollToItem(key: string) {
    itemRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submit() {
    if (!kickoffComplete) {
      setSaveError("Complete the kick-off call before launching.");
      return;
    }
    if (launchAdsGateApplies(formProfile) && !isLaunchAdsReady(draft.ads_ready)) {
      setSaveError("Ads have to be scheduled or published before this checklist can be filled.");
      return;
    }
    if (!isLaunchChecklistComplete(draft, formProfile)) {
      setSaveError("Confirm every checklist item, add the Go High Level number, add the launch call recording link, select completed-by, and type LAUNCH before going live.");
      const items = getLaunchItemsForProfile(formProfile);
      const firstIncomplete = items.find(item => !isLaunchItemSatisfied(item, draft));
      if (firstIncomplete) scrollToItem(firstIncomplete.key);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/clients/${clientId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to complete launch");
      return;
    }
    onCompleted?.();
    onClose();
  }

  const totalItems = checklistConfig?.items.length ?? getLaunchItemsForProfile(formProfile).length;
  const satisfiedCount = countSatisfiedItems(draft, formProfile);
  const adsGateApplies = launchAdsGateApplies(formProfile);
  const adsReady = isLaunchAdsReady(draft.ads_ready);
  const canSubmit = kickoffComplete && isLaunchChecklistComplete(draft, formProfile) && !saving;
  const sections = checklistConfig?.sections ?? getLaunchSectionsForProfile(formProfile);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto py-6 px-4"
      style={{ background: "rgba(2,6,15,0.85)" }}
    >
      <div
        className="w-full rounded-xl shadow-2xl overflow-hidden"
        style={{ maxWidth: 640, background: "#060d1a", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="px-6 py-4 flex items-start justify-between gap-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-200">Launch Checklist</h2>
              {clientMeta.reporting_type && <ReportingTypeBadge value={clientMeta.reporting_type} size="sm" />}
              {clientMeta.service_program && <ServiceProgramBadge value={clientMeta.service_program} size="sm" />}
            </div>
            <p className="text-sm mt-0.5 text-slate-500">
              {clientName} — {ONBOARDING_PROFILE_META[formProfile].label}
            </p>
            {!loading && !error && !alreadyLaunched && (
              <p className="text-xs mt-1 text-slate-400">{satisfiedCount} / {totalItems} confirmed</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-400 border border-white/10">
            Close
          </button>
        </div>

        <div className="px-6 py-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-8">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-400 text-center py-8">{error}</p>
          ) : alreadyLaunched ? (
            <p className="text-sm text-amber-300 rounded-lg px-4 py-3 bg-amber-950/40 border border-amber-500/30">
              This client already has a completed launch checklist on file.
            </p>
          ) : (
            <>
              {!kickoffComplete && (
                <p className="text-sm text-amber-300 rounded-lg px-4 py-3 bg-amber-950/40 border border-amber-500/30">
                  Kick-off is not complete yet (GHL mapping + OB recording required).
                </p>
              )}
              <p className="text-sm rounded-lg px-4 py-3 text-sky-200 bg-sky-950/40 border border-sky-500/30">
                {launchWalkthroughBlurb(formProfile)}
              </p>

              {adsGateApplies && (
                <fieldset className="rounded-lg px-4 py-3 space-y-2" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0a1628" }}>
                  <legend className="text-sm font-semibold text-slate-200 px-1">Ads</legend>
                  <p className="text-xs text-slate-500">The checklist stays locked until the ads are scheduled or already published.</p>
                  <div className="flex flex-wrap gap-2">
                    {LAUNCH_ADS_READY.map(value => {
                      const selected = draft.ads_ready === value;
                      return (
                        <label
                          key={value}
                          className="text-sm font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                          style={{
                            color: selected ? "#e2e8f0" : "#94a3b8",
                            background: selected ? "rgba(34,197,94,0.16)" : "#0f2040",
                            border: selected ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.12)",
                          }}
                        >
                          <input
                            type="radio"
                            name="ads_ready"
                            value={value}
                            checked={selected}
                            onChange={() => {
                              setDraft(prev => ({ ...prev, ads_ready: value }));
                              setSaveError(null);
                            }}
                            className="sr-only"
                          />
                          {launchAdsReadyLabel(value)}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              {!hasLaunchKit && (
                <p className="text-sm text-sky-300 rounded-lg px-4 py-3 bg-sky-950/40 border border-sky-500/30">
                  No Launch Kit has been generated for this client. The kit is the leave-behind for the Launch Call — open <strong>Kit</strong> from the roster actions to generate it. You can still mark the client live.
                </p>
              )}

              <div className={adsGateApplies && !adsReady ? "space-y-5 opacity-50 pointer-events-none" : "space-y-5"}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-400">Launch date</span>
                  <input
                    type="date"
                    value={draft.launch_date}
                    onChange={e => setDraft(prev => ({ ...prev, launch_date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={fieldStyle}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-400">Completed by</span>
                  <select
                    value={draft.completed_by_user_id}
                    onChange={e => handleCompletedByChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={fieldStyle}
                  >
                    <option value="">Select user…</option>
                    {assignableUsers.map(user => (
                      <option key={user.id} value={user.id}>{user.email}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5 sm:col-span-2">
                  <span className="text-sm font-medium text-slate-400">Go High Level number</span>
                  <input
                    type="tel"
                    value={draft.phone_ghl}
                    onChange={e => setDraft(prev => ({ ...prev, phone_ghl: e.target.value }))}
                    placeholder="Number we prospect this client with"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={fieldStyle}
                  />
                  <p className="text-xs text-slate-500">
                    Saved on the client file and used on the virtual business card — our GHL number, not the LO&apos;s personal phone.
                  </p>
                </label>
              </div>

              {sections.map(section => (
                <SectionBlock
                  key={section.id}
                  sectionId={section.id}
                  label={section.label}
                  profile={formProfile}
                  draft={draft}
                  itemRefs={itemRefs}
                  onPatchChecklist={patchChecklist}
                  onPatchConfirmation={patchConfirmation}
                />
              ))}

              <section
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0a1628" }}
              >
                <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <h3 className="text-sm font-semibold text-slate-200">Launch Call</h3>
                  <p className="text-xs mt-0.5 text-slate-500">Saved to Client Calls history when you go live.</p>
                </div>
                <div className="px-4 py-4 space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-400">Launch call recording link</span>
                    <input
                      type="url"
                      value={draft.recording_url}
                      onChange={e => setDraft(prev => ({ ...prev, recording_url: e.target.value }))}
                      placeholder="https://…"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={fieldStyle}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-400">Launch call transcript</span>
                    <textarea
                      value={draft.transcript}
                      onChange={e => setDraft(prev => ({ ...prev, transcript: e.target.value }))}
                      rows={5}
                      placeholder="Paste call transcript…"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
                      style={fieldStyle}
                    />
                    <p className="text-xs text-slate-500">Paste the full call transcript for search and review in Client Calls.</p>
                  </label>
                </div>
              </section>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Notes (optional)</span>
                <p className="text-xs text-slate-500">Saved to Client notes on the client file.</p>
                <textarea
                  value={draft.notes}
                  onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={fieldStyle}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">
                  Type {LAUNCH_FINAL_CONFIRMATION} to mark this client live
                </span>
                <input
                  type="text"
                  value={draft.final_confirmation}
                  onChange={e => setDraft(prev => ({ ...prev, final_confirmation: e.target.value }))}
                  placeholder={LAUNCH_FINAL_CONFIRMATION}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none uppercase"
                  style={fieldStyle}
                  autoComplete="off"
                />
              </label>
              </div>
            </>
          )}

          {saveError && (
            <p className="text-sm rounded-lg px-4 py-3 text-red-400 bg-red-950/40 border border-red-500/30">{saveError}</p>
          )}
        </div>

        {!loading && !error && !alreadyLaunched && (
          <div className="px-6 pb-6">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full text-sm font-semibold px-4 py-3 rounded-lg text-white"
              style={{ background: saving || !canSubmit ? "#334155" : "#16a34a" }}
            >
              {saving ? "Launching…" : "Mark client LIVE"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionBlock({
  sectionId,
  label,
  profile,
  draft,
  itemRefs,
  onPatchChecklist,
  onPatchConfirmation,
}: {
  sectionId: LaunchSectionId;
  label: string;
  profile: OnboardingFormProfile;
  draft: LaunchFormDraft;
  itemRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onPatchChecklist: (key: string, checked: boolean) => void;
  onPatchConfirmation: (key: string, value: string) => void;
}) {
  const { satisfied, total } = countSatisfiedInSection(sectionId, draft, profile);
  const items = getLaunchItemsForProfile(profile).filter(item => item.section === sectionId);
  if (items.length === 0) return null;

  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0a1628" }}
    >
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="text-sm font-semibold text-slate-200">{label}</h3>
        <span className="text-xs text-slate-500">{satisfied} / {total}</span>
      </div>
      <div className="px-2 py-2 space-y-1">
        {items.map(item => (
          <ChecklistItemRow
            key={item.key}
            item={item}
            draft={draft}
            itemRef={el => { itemRefs.current[item.key] = el; }}
            onPatchChecklist={onPatchChecklist}
            onPatchConfirmation={onPatchConfirmation}
          />
        ))}
      </div>
    </section>
  );
}

function ChecklistItemRow({
  item,
  draft,
  itemRef,
  onPatchChecklist,
  onPatchConfirmation,
}: {
  item: LaunchChecklistItemDef;
  draft: LaunchFormDraft;
  itemRef: (el: HTMLDivElement | null) => void;
  onPatchChecklist: (key: string, checked: boolean) => void;
  onPatchConfirmation: (key: string, value: string) => void;
}) {
  const satisfied = isLaunchItemSatisfied(item, draft);
  const yesTyped = item.confirmType === "type_yes" && isTypedYes(draft.confirmations[item.key] ?? "");
  const checkboxDisabled = item.confirmType === "type_yes" && !yesTyped;

  return (
    <div
      ref={itemRef}
      className="rounded-lg px-3 py-2"
      style={{
        background: satisfied ? "rgba(34,197,94,0.08)" : "transparent",
        border: satisfied ? "1px solid rgba(34,197,94,0.2)" : "1px solid transparent",
      }}
    >
      {item.confirmType === "type_yes" && (
        <div className="mb-2 space-y-1">
          <input
            type="text"
            value={draft.confirmations[item.key] ?? ""}
            onChange={e => onPatchConfirmation(item.key, e.target.value)}
            placeholder='Type "yes" to confirm'
            className="w-full px-2 py-1.5 rounded text-xs outline-none"
            style={fieldStyle}
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">Type yes to confirm you verified this item.</p>
        </div>
      )}
      <label className={`flex items-start gap-3 ${checkboxDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={draft.checklist[item.key]}
          disabled={checkboxDisabled}
          onChange={e => onPatchChecklist(item.key, e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-slate-200">
          {item.label}
          {item.helpText && (
            <span className="block text-xs mt-0.5 text-slate-500">{item.helpText}</span>
          )}
        </span>
      </label>
      {item.links && item.links.length > 0 && (
        <div className="mt-2 ml-7 flex flex-col gap-1">
          {item.links.map(link => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline underline-offset-2"
              style={{ color: "#38bdf8" }}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
