"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import PersonPlusEditor, { type PlusDraft } from "@/components/person/PersonPlusEditor";
import {
  BTN_PRIMARY_BG,
  FONT_BODY,
  FONT_DISPLAY,
  SHADOW,
  WAIZ,
  WaizWordmark,
} from "@/components/onboarding/brand";
import {
  ADDITIONAL_CONTACT_TYPE_OPTIONS,
  type ContactType,
} from "@/lib/client-contacts";
import {
  missingRoleRequirement,
  type PersonProfile,
  type PlusItemKey,
} from "@/lib/person-profile";

type Prefetch = {
  client_name: string;
  primary_contact_name: string | null;
};

type Draft = {
  contact_type: ContactType | "";
  name: string;
  email: string;
  phone: string;
  nmls: string;
  states_licensed: string[];
  profile: PersonProfile;
  notes: { body: string }[];
  headshot: File | null;
  files: File[];
};

const EMPTY: Draft = {
  contact_type: "",
  name: "",
  email: "",
  phone: "",
  nmls: "",
  states_licensed: [],
  profile: {},
  notes: [],
  headshot: null,
  files: [],
};

const INPUT = "w-full px-4 py-3 text-sm outline-none rounded-xl border bg-white";

function plusDraft(draft: Draft): PlusDraft {
  return {
    email: draft.email,
    phone: draft.phone,
    nmls: draft.nmls,
    states_licensed: draft.states_licensed,
    profile: draft.profile,
    notes: draft.notes,
    files: [
      ...(draft.headshot
        ? [{ kind: "headshot" as const, file_name: draft.headshot.name, public_url: null }]
        : []),
      ...draft.files.map(file => ({ kind: "other" as const, file_name: file.name, public_url: null })),
    ],
  };
}

export default function TeamInviteForm({ token }: { token: string }) {
  const [prefetch, setPrefetch] = useState<Prefetch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/onboard/team?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Invalid invite link");
        if (!cancelled) setPrefetch(data);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Invalid invite link");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function attach(key: PlusItemKey, value: string | string[] | File) {
    setDraft(current => {
      const next = { ...current, profile: { ...current.profile } };
      if (value instanceof File) {
        if (key === "headshot") next.headshot = value;
        else if (key === "file") next.files = [...current.files, value];
        return next;
      }
      if (key === "states_licensed" && Array.isArray(value)) {
        next.states_licensed = value;
        return next;
      }
      if (typeof value !== "string") return next;
      const text = value.trim();
      if (key === "email") next.email = text;
      else if (key === "phone") next.phone = text;
      else if (key === "nmls") next.nmls = text;
      else if (key === "note") next.notes = [...current.notes, { body: text }];
      else if (key === "biography" || key === "review_url" || key === "timezone" || key === "personal_address") {
        next.profile = { ...current.profile, [key]: text };
      }
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.contact_type || !draft.name.trim() || submitting) return;
    const gap = missingRoleRequirement(draft.contact_type, {
      states_licensed: draft.states_licensed,
    });
    if (gap) {
      setSubmitError(gap);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.set("token", token);
      form.set("contact_type", draft.contact_type);
      form.set("name", draft.name.trim());
      if (draft.email) form.set("email", draft.email);
      if (draft.phone) form.set("phone", draft.phone);
      if (draft.nmls) form.set("nmls", draft.nmls);
      form.set("states_licensed", JSON.stringify(draft.states_licensed));
      form.set("profile", JSON.stringify(draft.profile));
      form.set("notes", JSON.stringify(draft.notes.map(note => note.body)));
      if (draft.headshot) form.set("headshot", draft.headshot);
      draft.files.forEach((file, index) => form.set(`file_${index}`, file));
      const res = await fetch("/api/onboard/team", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Shell>
        <Card>
          <h1 style={titleStyle}>Link not valid</h1>
          <p style={bodyStyle}>{loadError}</p>
          <p style={{ ...bodyStyle, marginTop: "1rem", color: WAIZ.muted }}>
            Ask your Waiz contact for a fresh team invite link.
          </p>
        </Card>
      </Shell>
    );
  }

  if (!prefetch) {
    return (
      <Shell>
        <p style={{ ...bodyStyle, textAlign: "center", color: WAIZ.muted }}>Loading…</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Card>
          <h1 style={titleStyle}>Thanks — you&apos;re added</h1>
          <p style={bodyStyle}>
            Your info is on the <strong>{prefetch.client_name}</strong> account
            {prefetch.primary_contact_name ? ` with ${prefetch.primary_contact_name}` : ""}.
            Your Waiz team can see it in the Client File.
          </p>
        </Card>
      </Shell>
    );
  }

  const canSubmit = Boolean(draft.contact_type && draft.name.trim());

  return (
    <Shell>
      <Card>
        <p style={{ fontFamily: FONT_BODY, fontSize: ".78rem", fontWeight: 500, letterSpacing: ".12em", textTransform: "uppercase", color: WAIZ.accent700, marginBottom: "0.5rem" }}>
          Team member form
        </p>
        <h1 style={titleStyle}>Join {prefetch.client_name}</h1>
        <p style={{ ...bodyStyle, marginBottom: "1.5rem" }}>
          Start with your name and role. Press plus to add a headshot, bio, note, file, or anything else — only on your profile.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span style={labelStyle}>Your role</span>
            <select
              required
              value={draft.contact_type}
              onChange={e => setDraft(d => ({ ...d, contact_type: e.target.value as ContactType | "" }))}
              className={INPUT}
              style={inputStyle}
            >
              <option value="" disabled>Select…</option>
              {ADDITIONAL_CONTACT_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span style={labelStyle}>Full name</span>
            <input
              required
              type="text"
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              className={INPUT}
              style={inputStyle}
              placeholder="Jane Smith"
            />
          </label>
          {draft.contact_type && (
            <PersonPlusEditor
              tone="light"
              role={draft.contact_type}
              draft={plusDraft(draft)}
              disabled={submitting}
              onAttach={attach}
            />
          )}
          {submitError && (
            <p style={{ fontFamily: FONT_BODY, fontSize: ".875rem", color: "#dc2626" }}>{submitError}</p>
          )}
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
            style={{
              fontFamily: FONT_BODY,
              background: BTN_PRIMARY_BG,
              opacity: submitting || !canSubmit ? 0.55 : 1,
              boxShadow: SHADOW,
            }}
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </form>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: WAIZ.soft }}>
      <header className="px-6 sm:px-8 py-5">
        <span style={{ color: WAIZ.navy }}>
          <WaizWordmark height={24} />
        </span>
      </header>
      <div className="flex-1 flex items-start justify-center px-4 pb-16 pt-4">{children}</div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-lg p-6 sm:p-8" style={{ borderRadius: 22, background: WAIZ.white, border: `1px solid ${WAIZ.line}`, boxShadow: SHADOW }}>
      {children}
    </div>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: "1.5rem",
  color: WAIZ.ink,
  marginBottom: "0.5rem",
  lineHeight: 1.25,
};

const bodyStyle: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: ".95rem",
  color: WAIZ.muted,
  lineHeight: 1.55,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontFamily: FONT_BODY,
  fontSize: ".72rem",
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: WAIZ.muted,
  marginBottom: "0.35rem",
};

const inputStyle: CSSProperties = {
  borderColor: WAIZ.line,
  color: WAIZ.ink,
  fontFamily: FONT_BODY,
};
