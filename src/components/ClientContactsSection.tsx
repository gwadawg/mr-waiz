"use client";

import { useState } from "react";
import PersonPlusEditor, { type PlusDraft } from "@/components/person/PersonPlusEditor";
import {
  ADDITIONAL_CONTACT_TYPE_OPTIONS,
  contactTypeLabel,
  type ClientContact,
  type ContactType,
} from "@/lib/client-contacts";
import { type PlusItemKey } from "@/lib/person-profile";

type AddDraft = {
  contact_type: ContactType;
  name: string;
};

const EMPTY_ADD: AddDraft = { contact_type: "loa", name: "" };

const TYPE_STYLE: Record<ContactType, { color: string; bg: string }> = {
  primary_lo: { color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  loa: { color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  co_lo: { color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  other: { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

function draftOf(contact: ClientContact): PlusDraft {
  return {
    email: contact.email,
    phone: contact.phone,
    nmls: contact.nmls,
    states_licensed: contact.states_licensed,
    profile: contact.profile ?? {},
    notes: contact.person_notes ?? [],
    files: contact.person_files ?? [],
  };
}

export default function ClientContactsSection({
  clientId,
  contacts,
  onReload,
}: {
  clientId: string;
  contacts: ClientContact[];
  onReload: () => void;
}) {
  const [add, setAdd] = useState<AddDraft>({ ...EMPTY_ADD });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const ordered = [...contacts].sort((a, b) => {
    if (a.contact_type === "primary_lo") return -1;
    if (b.contact_type === "primary_lo") return 1;
    return 0;
  });

  async function fetchInviteLink(rotate = false): Promise<string | null> {
    setInviteBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/team-invite`, {
        method: rotate ? "POST" : "GET",
        headers: rotate ? { "Content-Type": "application/json" } : undefined,
        body: rotate ? JSON.stringify({ rotate: true }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get invite link");
      setInviteUrl(data.url);
      return data.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get invite link");
      return null;
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    const url = inviteUrl ?? (await fetchInviteLink(false));
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      setError("Could not copy — select the link and copy manually");
    }
  }

  async function rotateInviteLink() {
    if (!window.confirm("Rotate this link? The old link will stop working.")) return;
    const url = await fetchInviteLink(true);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      /* url is shown below for manual copy */
    }
  }

  async function submitAdd() {
    if (!add.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_type: add.contact_type, name: add.name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add person");
      setAdd({ ...EMPTY_ADD });
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add person");
    } finally {
      setSaving(false);
    }
  }

  async function attach(contactId: string, key: PlusItemKey, value: string | string[] | File) {
    const form = new FormData();
    form.set("key", key);
    if (value instanceof File) form.set("file", value);
    else if (Array.isArray(value)) form.set("value", JSON.stringify(value));
    else form.set("value", value);
    const res = await fetch(`/api/clients/${clientId}/contacts/${contactId}/items`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not add that");
    onReload();
  }

  async function removeContact(contactId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this account?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts/${contactId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove contact");
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove contact");
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg px-4 py-3 space-y-2"
        style={{ background: "#080f1e", border: "1px solid rgba(56,189,248,0.15)" }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>
              Team invite link
            </p>
            <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
              Same profile as this page. They start with a name and role, then add only what you need — including a headshot.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap">
            <button
              type="button"
              onClick={copyInviteLink}
              disabled={inviteBusy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{
                color: "#38bdf8",
                background: "rgba(56,189,248,0.12)",
                border: "1px solid rgba(56,189,248,0.25)",
                opacity: inviteBusy ? 0.5 : 1,
              }}
            >
              {inviteBusy ? "…" : inviteCopied ? "Copied!" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={rotateInviteLink}
              disabled={inviteBusy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ color: "#64748b", opacity: inviteBusy ? 0.5 : 1 }}
            >
              Rotate
            </button>
          </div>
        </div>
        {inviteUrl && (
          <p className="text-xs font-mono break-all px-2 py-1.5 rounded" style={{ color: "#64748b", background: "#050c18" }}>
            {inviteUrl}
          </p>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm py-3 text-center rounded-lg" style={{ color: "#334155", background: "#080f1e" }}>
          No people on this account yet.
        </p>
      ) : (
        <div className="space-y-2">
          {ordered.map(contact => {
            const style = TYPE_STYLE[contact.contact_type] ?? TYPE_STYLE.other;
            return (
              <div
                key={contact.id}
                className="rounded-lg px-4 py-3 space-y-3"
                style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: style.color, background: style.bg }}
                    >
                      {contactTypeLabel(contact.contact_type)}
                    </span>
                    <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{contact.name}</p>
                  </div>
                  {contact.contact_type !== "primary_lo" && (
                    <button
                      type="button"
                      onClick={() => removeContact(contact.id, contact.name)}
                      className="text-xs font-semibold px-2 py-1 rounded"
                      style={{ color: "#f87171" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <PersonPlusEditor
                  tone="dark"
                  role={contact.contact_type}
                  draft={draftOf(contact)}
                  onAttach={(key, value) => attach(contact.id, key, value)}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg p-4 space-y-3" style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>Add a person</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Role</span>
            <select
              value={add.contact_type}
              disabled={saving}
              onChange={e => setAdd(d => ({ ...d, contact_type: e.target.value as ContactType }))}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: "#050c18", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
            >
              {ADDITIONAL_CONTACT_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "#475569" }}>Name</span>
            <input
              type="text"
              value={add.name}
              disabled={saving}
              onChange={e => setAdd(d => ({ ...d, name: e.target.value }))}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: "#050c18", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
              placeholder="Full name"
            />
          </label>
        </div>
        {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
        <button
          type="button"
          onClick={submitAdd}
          disabled={saving || !add.name.trim()}
          className="text-xs font-semibold px-3 py-2 rounded-lg"
          style={{
            color: "#38bdf8",
            background: "rgba(56,189,248,0.12)",
            border: "1px solid rgba(56,189,248,0.25)",
            opacity: saving || !add.name.trim() ? 0.5 : 1,
          }}
        >
          {saving ? "Saving…" : "Add person"}
        </button>
      </div>
    </div>
  );
}
