"use client";

import { useEffect, useState } from "react";
import {
  emptyMediaQaDraft,
  MEDIA_QA_ITEMS,
  QA_FINAL_CONFIRMATION,
  validateMediaQaDraft,
  type MediaQaDraft,
} from "@/lib/qa-form";

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

export default function MediaBuyingQaWizard({
  clientId,
  fallbackName,
  onClose,
  onCompleted,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clientName, setClientName] = useState(fallbackName);
  const [subaccountName, setSubaccountName] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [applies, setApplies] = useState(true);
  const [alreadyComplete, setAlreadyComplete] = useState(false);
  const [lifecycleOk, setLifecycleOk] = useState(true);
  const [draft, setDraft] = useState<MediaQaDraft>(emptyMediaQaDraft());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const res = await fetch(`/api/clients/${clientId}/qa/media_buying`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load Media Buying QA");
        setLoading(false);
        return;
      }
      const licensed = Array.isArray(data.states_licensed)
        ? data.states_licensed.filter((state: unknown) => typeof state === "string" && state.trim())
        : [];
      setClientName(data.client?.name ?? fallbackName);
      setSubaccountName(typeof data.client?.name === "string" ? data.client.name : "");
      setStates(licensed);
      setApplies(data.media_buying_applies !== false);
      setAlreadyComplete(!!data.already_complete);
      setLifecycleOk(data.lifecycle_ok !== false);
      setDraft(emptyMediaQaDraft(
        data.default_completed_by ?? "",
        typeof data.client?.ad_account_url === "string" ? data.client.ad_account_url : "",
      ));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, fallbackName]);

  function setDone(key: string, checked: boolean) {
    setDraft(prev => ({
      ...prev,
      done: { ...prev.done, [key]: checked },
      skipped: { ...prev.skipped, [key]: false },
    }));
    setSaveError(null);
  }

  function setSkipped(key: string, skipped: boolean) {
    setDraft(prev => ({
      ...prev,
      skipped: { ...prev.skipped, [key]: skipped },
      done: skipped ? { ...prev.done, [key]: false } : prev.done,
    }));
    setSaveError(null);
  }

  async function submit() {
    const problem = validateMediaQaDraft(draft);
    if (problem) {
      setSaveError(problem);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/clients/${clientId}/qa/media_buying`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to submit Media Buying QA");
      return;
    }
    onCompleted?.();
    onClose();
  }

  const confirmed = MEDIA_QA_ITEMS.filter(item => draft.done[item.key] === true && draft.skipped[item.key] !== true).length;
  const canSubmit = !validateMediaQaDraft(draft) && !saving && !alreadyComplete && applies;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto py-6 px-4"
      style={{ background: "rgba(2,6,15,0.85)" }}
    >
      <div
        className="w-full rounded-xl overflow-hidden"
        style={{ maxWidth: 680, background: "#060d1a", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="px-6 py-4 flex items-start justify-between gap-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Media Buying QA</h2>
            <p className="text-sm mt-0.5 text-slate-500">{clientName}</p>
            {!loading && !error && lifecycleOk && applies && !alreadyComplete && (
              <p className="text-xs mt-1 text-slate-400">{confirmed} / {MEDIA_QA_ITEMS.length} confirmed</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-400 border border-white/10">
            Close
          </button>
        </div>

        <div className="px-6 py-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-8">Loading...</p>
          ) : error ? (
            <p className="text-sm text-red-400 text-center py-8">{error}</p>
          ) : !lifecycleOk ? (
            <p className="text-sm text-amber-200 rounded-lg px-4 py-3 bg-amber-950/40 border border-amber-500/30">
              Media Buying QA is only available while this client is in onboarding.
            </p>
          ) : alreadyComplete ? (
            <p className="text-sm text-emerald-300 rounded-lg px-4 py-3 bg-emerald-950/40 border border-emerald-500/30">
              Media Buying QA is already complete for this onboarding cycle. A reinstate starts a new cycle.
            </p>
          ) : !applies ? (
            <p className="text-sm text-amber-200 rounded-lg px-4 py-3 bg-amber-950/40 border border-amber-500/30">
              This client has no ad-gen motion. Media Buying QA is skipped, and nothing is stored as No.
            </p>
          ) : (
            <>
              <p className="text-sm rounded-lg px-4 py-3 text-sky-200 bg-sky-950/40 border border-sky-500/30">
                Confirm the ads you just built. A line that does not apply is skipped, not stored as No. Facebook page, UTM, and MAKE are required.
              </p>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Completed by</span>
                <input
                  type="text"
                  value={draft.completed_by_label}
                  onChange={e => setDraft(prev => ({ ...prev, completed_by_label: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={fieldStyle}
                />
              </label>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">1. Ad account link</h3>
                  <span className="text-xs text-sky-300">Saves to the roster</span>
                </div>
                <p className="text-xs text-slate-500">
                  Paste the Ads Manager link. It is stored on the client as the roster Ad account link so the team can open it later.
                </p>
                {draft.ad_account_skipped ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">Skipped. The roster link stays as it is.</p>
                    <button type="button" onClick={() => setDraft(prev => ({ ...prev, ad_account_skipped: false }))} className="text-xs text-slate-300 underline">
                      Put back
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      type="url"
                      value={draft.ad_account_url}
                      onChange={e => setDraft(prev => ({ ...prev, ad_account_url: e.target.value }))}
                      placeholder="https://adsmanager.facebook.com/..."
                      className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                      style={fieldStyle}
                    />
                    <button type="button" onClick={() => setDraft(prev => ({ ...prev, ad_account_skipped: true }))} className="text-xs text-slate-400 whitespace-nowrap">
                      Does not apply
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0a1628" }}>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <h3 className="text-sm font-semibold text-slate-200">Ads checks</h3>
                </div>
                <div className="px-3 py-3 space-y-3">
                  {MEDIA_QA_ITEMS.map(item => {
                    const skipped = draft.skipped[item.key] === true;
                    const done = draft.done[item.key] === true && !skipped;
                    return (
                      <div key={item.key}>
                        {item.groupLabel && (
                          <p className="text-sm font-semibold text-slate-200 pt-2">
                            7. {item.groupLabel}
                          </p>
                        )}
                        <div
                          className="rounded-lg px-3 py-2"
                          style={{
                            background: done ? "rgba(34,197,94,0.08)" : "transparent",
                            border: done ? "1px solid rgba(34,197,94,0.2)" : "1px solid transparent",
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <label className="flex items-start gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={done}
                                disabled={item.required ? false : skipped}
                                onChange={e => setDone(item.key, e.target.checked)}
                                className="mt-1"
                              />
                              <span className="text-sm text-slate-200">
                                {item.number !== "7" ? `${item.number}. ` : ""}{item.label}
                                {item.required && <span className="ml-2 text-xs text-amber-200">Required</span>}
                                <span className="block text-xs mt-0.5 text-slate-500">{item.helpText}</span>
                                {item.key === "states_targeted" && states.length > 0 && (
                                  <span className="block text-xs mt-1 text-slate-400">On file: {states.join(", ")}</span>
                                )}
                                {item.key === "make_subaccount_name" && subaccountName && (
                                  <span className="block text-xs mt-1 text-slate-400">Sub-account name on file: {subaccountName}</span>
                                )}
                              </span>
                            </label>
                            {!item.required && (
                              skipped ? (
                                <button type="button" onClick={() => setSkipped(item.key, false)} className="text-xs text-slate-300 underline whitespace-nowrap">
                                  Put back
                                </button>
                              ) : (
                                <button type="button" onClick={() => setSkipped(item.key, true)} className="text-xs text-slate-500 whitespace-nowrap">
                                  Does not apply
                                </button>
                              )
                            )}
                          </div>
                          {skipped && (
                            <p className="text-xs text-slate-500 mt-1 pl-7">Skipped. Not stored as No.</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Type {QA_FINAL_CONFIRMATION} to submit</span>
                <input
                  type="text"
                  value={draft.final_confirmation}
                  onChange={e => setDraft(prev => ({ ...prev, final_confirmation: e.target.value }))}
                  placeholder={QA_FINAL_CONFIRMATION}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none uppercase"
                  style={fieldStyle}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          {saveError && (
            <p className="text-sm rounded-lg px-4 py-3 text-red-400 bg-red-950/40 border border-red-500/30">{saveError}</p>
          )}
        </div>

        {!loading && !error && lifecycleOk && applies && !alreadyComplete && (
          <div className="px-6 pb-6">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full text-sm font-semibold px-4 py-3 rounded-lg text-white"
              style={{ background: saving || !canSubmit ? "#334155" : "#16a34a" }}
            >
              {saving ? "Submitting..." : "Submit Media QA"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
