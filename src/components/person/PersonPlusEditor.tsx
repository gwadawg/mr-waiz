"use client";

import { useState, type ReactNode } from "react";
import { prepareOnboardingHeadshot } from "@/lib/onboarding-headshot";
import {
  availablePlusItems,
  currentHeadshot,
  missingRoleRequirement,
  validatePlusText,
  type PersonPlusState,
  type PlusItemKey,
} from "@/lib/person-profile";
import { US_CLIENT_TIMEZONES } from "@/lib/us-timezones";
import { US_STATES, formatStatesLicensed } from "@/lib/us-states";

export type PlusDraft = PersonPlusState & {
  notes?: { id?: string; body: string }[] | null;
  files?: { id?: string; kind: "headshot" | "license" | "other"; file_name: string; public_url?: string | null }[] | null;
};

type Tone = "dark" | "light";

const SCALAR_KEYS = new Set<PlusItemKey>([
  "email",
  "phone",
  "nmls",
  "biography",
  "review_url",
  "personal_address",
  "timezone",
  "states_licensed",
]);

function textOf(draft: PlusDraft, key: PlusItemKey): string {
  if (key === "email") return draft.email ?? "";
  if (key === "phone") return draft.phone ?? "";
  if (key === "nmls") return draft.nmls ?? "";
  if (key === "biography" || key === "review_url" || key === "personal_address" || key === "timezone") {
    return draft.profile?.[key] ?? "";
  }
  return "";
}

export default function PersonPlusEditor({
  tone,
  draft,
  role,
  disabled,
  onAttach,
}: {
  tone: Tone;
  draft: PlusDraft;
  role?: string | null;
  disabled?: boolean;
  onAttach: (key: PlusItemKey, value: string | string[] | File) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PlusItemKey | null>(null);
  const [text, setText] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dark = tone === "dark";
  const ink = dark ? "#e2e8f0" : "#1c2434";
  const muted = dark ? "#64748b" : "#667085";
  const line = dark ? "rgba(255,255,255,0.08)" : "#e4e7ec";
  const fieldBg = dark ? "#050c18" : "#fff";
  const roleHint = missingRoleRequirement(role, draft);

  const menu = availablePlusItems(draft);
  const headshot = currentHeadshot(draft);
  const notes = draft.notes ?? [];
  const files = (draft.files ?? []).filter(file => file.kind !== "headshot");

  function begin(key: PlusItemKey) {
    setPending(key);
    setOpen(false);
    setError(null);
    if (key === "states_licensed") setStates(draft.states_licensed ?? []);
    else if (SCALAR_KEYS.has(key)) setText(textOf(draft, key));
    else setText("");
  }

  async function save(key: PlusItemKey, value: string | string[] | File) {
    if (typeof value === "string" && key !== "note" && key !== "file" && key !== "headshot") {
      const problem = validatePlusText(key, value);
      if (problem) {
        setError(problem);
        return;
      }
    }
    if (key === "note" && typeof value === "string" && !value.trim()) {
      setError("Enter a note or cancel");
      return;
    }
    if (key === "states_licensed" && Array.isArray(value) && value.length === 0) {
      setError("Select at least one state");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAttach(key, value);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that");
    } finally {
      setSaving(false);
    }
  }

  const labelStyle = {
    display: "block" as const,
    fontSize: "0.68rem",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: muted,
    marginBottom: "0.25rem",
  };

  const inputStyle = {
    width: "100%",
    background: fieldBg,
    color: ink,
    border: `1px solid ${line}`,
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    fontSize: "0.875rem",
  };

  return (
    <div className="space-y-3">
      {headshot && (
        <Attached label="Headshot" tone={tone}>
          <div className="flex items-center gap-3">
            {headshot.public_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headshot.public_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : null}
            <span style={{ color: ink, fontSize: "0.875rem" }}>{headshot.file_name}</span>
            <label className="text-xs font-semibold cursor-pointer" style={{ color: dark ? "#38bdf8" : "#175cd3" }}>
              Replace
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={disabled || saving}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const prepared = await prepareOnboardingHeadshot(file);
                    await save("headshot", prepared);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not use that photo");
                  }
                }}
              />
            </label>
          </div>
        </Attached>
      )}

      {(["email", "phone", "nmls", "biography", "review_url", "personal_address", "timezone"] as PlusItemKey[])
        .filter(key => textOf(draft, key).trim())
        .map(key => (
          <Attached key={key} label={availableLabel(key)} tone={tone}>
            <p style={{ color: ink, fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{textOf(draft, key)}</p>
          </Attached>
        ))}

      {(draft.states_licensed ?? []).length > 0 && (
        <Attached label="Licensed states" tone={tone}>
          <p style={{ color: ink, fontSize: "0.875rem" }}>{formatStatesLicensed(draft.states_licensed)}</p>
        </Attached>
      )}

      {notes.map((note, index) => (
        <Attached key={note.id ?? `note-${index}`} label="Note" tone={tone}>
          <p style={{ color: ink, fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{note.body}</p>
        </Attached>
      ))}

      {files.map((file, index) => (
        <Attached key={file.id ?? `file-${index}`} label="File" tone={tone}>
          {file.public_url ? (
            <a href={file.public_url} target="_blank" rel="noreferrer" style={{ color: dark ? "#38bdf8" : "#175cd3", fontSize: "0.875rem" }}>
              {file.file_name}
            </a>
          ) : (
            <span style={{ color: ink, fontSize: "0.875rem" }}>{file.file_name}</span>
          )}
        </Attached>
      ))}

      {roleHint && (
        <p className="text-xs" style={{ color: dark ? "#fbbf24" : "#b54708" }}>{roleHint}</p>
      )}

      <div className="relative">
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => {
            setOpen(v => !v);
            setError(null);
          }}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{
            color: dark ? "#38bdf8" : "#175cd3",
            background: dark ? "rgba(56,189,248,0.12)" : "#eff8ff",
            border: `1px solid ${dark ? "rgba(56,189,248,0.25)" : "#b2ddff"}`,
          }}
        >
          + Add
        </button>
        {open && (
          <ul
            className="absolute z-20 mt-1 min-w-52 py-1 rounded-lg shadow-lg"
            style={{ background: fieldBg, border: `1px solid ${line}` }}
          >
            {menu.map(item => (
              <li key={item.key}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm"
                  style={{ color: ink }}
                  onClick={() => begin(item.key)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending && (
        <div className="space-y-2 rounded-lg p-3" style={{ border: `1px solid ${line}` }}>
          <span style={labelStyle}>{availableLabel(pending)}</span>
          {pending === "states_licensed" ? (
            <div className="grid grid-cols-3 gap-1 max-h-40 overflow-y-auto">
              {US_STATES.map(state => (
                <label key={state.code} className="flex items-center gap-1 text-xs" style={{ color: ink }}>
                  <input
                    type="checkbox"
                    checked={states.includes(state.code)}
                    onChange={() =>
                      setStates(current =>
                        current.includes(state.code)
                          ? current.filter(code => code !== state.code)
                          : [...current, state.code],
                      )
                    }
                  />
                  {state.code}
                </label>
              ))}
            </div>
          ) : pending === "timezone" ? (
            <select value={text} onChange={e => setText(e.target.value)} style={inputStyle}>
              <option value="">Select…</option>
              {US_CLIENT_TIMEZONES.map(zone => (
                <option key={zone.value} value={zone.value}>{zone.label}</option>
              ))}
            </select>
          ) : pending === "biography" || pending === "note" || pending === "personal_address" ? (
            <textarea value={text} rows={3} onChange={e => setText(e.target.value)} style={inputStyle} />
          ) : pending === "headshot" || pending === "file" ? (
            <input
              type="file"
              accept={pending === "headshot" ? "image/jpeg,image/png,image/webp,image/gif" : undefined}
              disabled={disabled || saving}
              onChange={async e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const prepared = pending === "headshot" ? await prepareOnboardingHeadshot(file) : file;
                  await save(pending, prepared);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not use that file");
                }
              }}
            />
          ) : (
            <input
              type={pending === "email" ? "email" : pending === "phone" ? "tel" : pending === "review_url" ? "url" : "text"}
              value={text}
              onChange={e => setText(e.target.value)}
              style={inputStyle}
            />
          )}
          {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
          {pending !== "headshot" && pending !== "file" && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={disabled || saving}
                onClick={() => void save(pending, pending === "states_licensed" ? states : text)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                style={{ background: dark ? "#0284c7" : "#175cd3" }}
              >
                {saving ? "Saving…" : "Add"}
              </button>
              <button type="button" className="text-xs font-semibold px-2" style={{ color: muted }} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}
          {(pending === "headshot" || pending === "file") && (
            <button type="button" className="text-xs font-semibold" style={{ color: muted }} onClick={() => setPending(null)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {error && !pending && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
    </div>
  );
}

function availableLabel(key: PlusItemKey): string {
  if (key === "biography") return "Bio";
  if (key === "review_url") return "Review link";
  if (key === "personal_address") return "Personal address";
  if (key === "states_licensed") return "Licensed states";
  if (key === "headshot") return "Headshot";
  if (key === "nmls") return "NMLS";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function Attached({ label, tone, children }: { label: string; tone: Tone; children: ReactNode }) {
  const muted = tone === "dark" ? "#64748b" : "#667085";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: muted }}>{label}</p>
      {children}
    </div>
  );
}
