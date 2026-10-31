"use client";

import { useEffect, useRef, useState } from "react";
import {
  emptyQaFormDraft,
  getFirstIncompleteQaItemKey,
  getQaFormConfig,
  isQaChecklistComplete,
  QA_FINAL_CONFIRMATION,
  type QaFormConfig,
  type QaFormDraft,
  type QaLane,
} from "@/lib/qa-form";

type Props = {
  clientId: string;
  lane: QaLane;
  fallbackName: string;
  onClose: () => void;
  onCompleted?: () => void;
};

const fieldStyle = {
  background: "#0f2040",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
};

export default function QaSkeletonWizard({
  clientId,
  lane,
  fallbackName,
  onClose,
  onCompleted,
}: Props) {
  const initialConfig = getQaFormConfig(lane);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clientName, setClientName] = useState(fallbackName);
  const [config, setConfig] = useState<QaFormConfig>(initialConfig);
  const [alreadyComplete, setAlreadyComplete] = useState(false);
  const [lifecycleOk, setLifecycleOk] = useState(true);
  const [draft, setDraft] = useState<QaFormDraft>(emptyQaFormDraft(initialConfig));
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const res = await fetch(`/api/clients/${clientId}/qa/${lane}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load QA form");
        setLoading(false);
        return;
      }
      const loadedConfig = (data.qa_config ?? initialConfig) as QaFormConfig;
      setConfig(loadedConfig);
      setClientName(data.client?.name ?? fallbackName);
      setAlreadyComplete(!!data.already_complete);
      setLifecycleOk(data.lifecycle_ok !== false);
      setDraft(emptyQaFormDraft(loadedConfig, data.default_completed_by ?? ""));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, fallbackName, initialConfig, lane]);

  function patchChecklist(key: string, checked: boolean) {
    setDraft(prev => ({
      ...prev,
      checklist: { ...prev.checklist, [key]: checked },
    }));
    setSaveError(null);
  }

  function scrollToItem(key: string) {
    itemRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submit() {
    if (!isQaChecklistComplete(draft, config)) {
      setSaveError(
        config.requireEveryItem
          ? `Confirm every item, add completed-by, and type ${QA_FINAL_CONFIRMATION}.`
          : `Add completed-by and type ${QA_FINAL_CONFIRMATION}.`,
      );
      const firstIncomplete = getFirstIncompleteQaItemKey(draft, config);
      if (firstIncomplete) scrollToItem(firstIncomplete);
      return;
    }

    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/clients/${clientId}/qa/${lane}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to submit QA");
      return;
    }
    onCompleted?.();
    onClose();
  }

  const confirmed = config.items.filter(item => draft.checklist[item.key] === true).length;
  const canSubmit = isQaChecklistComplete(draft, config) && !saving && !alreadyComplete;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto py-6 px-4"
      style={{ background: "rgba(2,6,15,0.85)" }}
    >
      <div
        className="w-full rounded-xl shadow-2xl overflow-hidden"
        style={{ maxWidth: 620, background: "#060d1a", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="px-6 py-4 flex items-start justify-between gap-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <h2 className="text-lg font-semibold text-slate-200">{config.title}</h2>
            <p className="text-sm mt-0.5 text-slate-500">{clientName} — {config.ownerLabel}</p>
            {!loading && !error && lifecycleOk && !alreadyComplete && (
              <p className="text-xs mt-1 text-slate-400">{confirmed} / {config.items.length} confirmed</p>
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
              {config.shortLabel} is only available while this client is in onboarding. It does not open on live or churned accounts.
            </p>
          ) : alreadyComplete ? (
            <p className="text-sm text-emerald-300 rounded-lg px-4 py-3 bg-emerald-950/40 border border-emerald-500/30">
              {config.shortLabel} is already complete for this onboarding cycle. A reinstate starts a new cycle.
            </p>
          ) : (
            <>
              <p className="text-sm rounded-lg px-4 py-3 text-sky-200 bg-sky-950/40 border border-sky-500/30">
                {config.description}
              </p>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Completed by</span>
                <input
                  type="text"
                  value={draft.completed_by_label}
                  onChange={e => setDraft(prev => ({ ...prev, completed_by_label: e.target.value }))}
                  placeholder="Name or user ID"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={fieldStyle}
                />
              </label>

              <section
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0a1628" }}
              >
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <h3 className="text-sm font-semibold text-slate-200">Skeleton QA Checklist</h3>
                  <span className="text-xs text-slate-500">{confirmed} / {config.items.length}</span>
                </div>
                <div className="px-2 py-2 space-y-1">
                  {config.items.map(item => {
                    const checked = draft.checklist[item.key] === true;
                    return (
                      <div
                        key={item.key}
                        ref={el => { itemRefs.current[item.key] = el; }}
                        className="rounded-lg px-3 py-2"
                        style={{
                          background: checked ? "rgba(34,197,94,0.08)" : "transparent",
                          border: checked ? "1px solid rgba(34,197,94,0.2)" : "1px solid transparent",
                        }}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => patchChecklist(item.key, e.target.checked)}
                            className="mt-1"
                            data-qa-item={item.key}
                          />
                          <span className="text-sm text-slate-200">
                            {item.label}
                            {item.helpText && (
                              <span className="block text-xs mt-0.5 text-slate-500">{item.helpText}</span>
                            )}
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Evidence / links</span>
                <textarea
                  value={draft.evidence}
                  onChange={e => setDraft(prev => ({ ...prev, evidence: e.target.value }))}
                  rows={3}
                  placeholder="Paste links or short evidence for the QA pass..."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={fieldStyle}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Blockers / exceptions</span>
                <textarea
                  value={draft.blockers}
                  onChange={e => setDraft(prev => ({ ...prev, blockers: e.target.value }))}
                  rows={2}
                  placeholder="Leave blank if none. If a real blocker exists, do not submit QA."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={fieldStyle}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">Notes</span>
                <textarea
                  value={draft.notes}
                  onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={fieldStyle}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-400">
                  Type {QA_FINAL_CONFIRMATION} to submit {config.shortLabel}
                </span>
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

        {!loading && !error && lifecycleOk && !alreadyComplete && (
          <div className="px-6 pb-6">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full text-sm font-semibold px-4 py-3 rounded-lg text-white"
              style={{ background: saving || !canSubmit ? "#334155" : "#16a34a" }}
            >
              {saving ? "Submitting..." : `Submit ${config.shortLabel}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

