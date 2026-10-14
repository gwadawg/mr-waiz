"use client";

import { useCallback, useEffect, useState } from "react";

type ClientOption = { id: string; name: string };

type PixelRow = {
  id: string;
  name: string;
  pixel_id: string;
  client_names: string[];
  has_token: boolean;
  test_event_code: string | null;
};

type SendRow = {
  id: string;
  client_id: string;
  event_name: string;
  status: string;
  error: string | null;
  created_at: string;
};

type Draft = {
  name: string;
  pixel_id: string;
  access_token: string;
  test_event_code: string;
};

const emptyDraft: Draft = {
  name: "",
  pixel_id: "",
  access_token: "",
  test_event_code: "",
};

const inputStyle: React.CSSProperties = {
  background: "#0a1628",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
  borderRadius: "0.5rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

const cardStyle: React.CSSProperties = {
  background: "#0a1628",
  border: "1px solid rgba(255,255,255,0.06)",
};

function statusColor(status: string): string {
  if (status === "sent") return "#34d399";
  if (status === "failed") return "#f87171";
  return "#fbbf24";
}

export default function MetaPixelLibrary() {
  const [pixels, setPixels] = useState<PixelRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback((alive: () => boolean = () => true) => {
    fetch("/api/meta-pixels")
      .then(r => r.json())
      .then(data => {
        if (!alive()) return;
        if (data.error) throw new Error(data.error);
        setPixels(data.pixels ?? []);
        setClients(data.clients ?? []);
        setSends(data.sends ?? []);
        setError("");
      })
      .catch(e => {
        if (alive()) setError(e instanceof Error ? e.message : "Failed to load pixels");
      })
      .finally(() => {
        if (alive()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => !cancelled);
    return () => { cancelled = true; };
  }, [load]);

  function clientLabel(clientId: string): string {
    return clients.find(c => c.id === clientId)?.name ?? "Client";
  }

  function usedBy(names: string[]): string {
    if (names.length === 0) return "None yet";
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
  }

  function startEdit(pixel: PixelRow) {
    setAdding(false);
    setEditingId(pixel.id);
    setDraft({
      name: pixel.name,
      pixel_id: pixel.pixel_id,
      access_token: "",
      test_event_code: pixel.test_event_code ?? "",
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(editingId ? `/api/meta-pixels/${editingId}` : "/api/meta-pixels", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to save pixel");
      return;
    }
    setDraft(emptyDraft);
    setAdding(false);
    setEditingId(null);
    load();
  }

  async function remove(pixel: PixelRow) {
    if (!window.confirm(`Remove the ${pixel.name} pixel? Clients using it will stop sending until you pick another pixel on their file.`)) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/meta-pixels/${pixel.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to remove pixel");
      return;
    }
    if (editingId === pixel.id) {
      setEditingId(null);
      setDraft(emptyDraft);
    }
    load();
  }

  const formOpen = adding || editingId !== null;

  return (
    <section className="rounded-xl p-5 space-y-4" style={cardStyle}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Meta pixels</h2>
          <p className="text-xs mt-1" style={{ color: "#64748b" }}>
            Add the reverse pixel and the DSCR pixel here. On each client file, pick which one that client uses. Qualified, hot, proposal, submitted, and funded events then go to that pixel. Make should send fbclid on the lead webhook. That value stays on the contact and is not shown on lead reports.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={() => { setAdding(true); setEditingId(null); setDraft(emptyDraft); }}
            className="text-xs font-semibold shrink-0"
            style={{ color: "#38bdf8" }}
          >
            Add pixel
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>
      )}

      {formOpen && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs space-y-1" style={{ color: "#94a3b8" }}>
            <span>Name</span>
            <input style={inputStyle} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Reverse pixel" />
          </label>
          <label className="text-xs space-y-1" style={{ color: "#94a3b8" }}>
            <span>Pixel ID</span>
            <input style={inputStyle} value={draft.pixel_id} onChange={e => setDraft({ ...draft, pixel_id: e.target.value })} placeholder="Numeric ID from Events Manager" />
          </label>
          <label className="text-xs space-y-1" style={{ color: "#94a3b8" }}>
            <span>Access token</span>
            <input
              style={inputStyle}
              type="password"
              autoComplete="new-password"
              value={draft.access_token}
              onChange={e => setDraft({ ...draft, access_token: e.target.value })}
              placeholder={editingId ? "Saved. Leave blank to keep it." : "Conversions API token"}
            />
          </label>
          <label className="text-xs space-y-1 sm:col-span-2" style={{ color: "#94a3b8" }}>
            <span>Test event code (optional)</span>
            <input style={inputStyle} value={draft.test_event_code} onChange={e => setDraft({ ...draft, test_event_code: e.target.value })} placeholder="From Events Manager → Test events" />
          </label>
          <div className="flex gap-3 sm:col-span-2">
            <button type="button" onClick={save} disabled={saving} className="text-xs font-semibold" style={{ color: "#34d399" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setEditingId(null); setDraft(emptyDraft); setError(""); }}
              className="text-xs font-semibold"
              style={{ color: "#94a3b8" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs" style={{ color: "#64748b" }}>Loading pixels…</p>
      ) : pixels.length === 0 ? (
        <p className="text-xs" style={{ color: "#64748b" }}>No pixels yet.</p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#0f2040", color: "#64748b" }}>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Used by</th>
                <th className="text-left px-3 py-2 font-medium">Pixel</th>
                <th className="text-left px-3 py-2 font-medium">Token</th>
                <th className="text-right px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pixels.map(pixel => (
                <tr key={pixel.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#cbd5e1" }}>
                  <td className="px-3 py-2">{pixel.name}</td>
                  <td className="px-3 py-2 text-xs" title={pixel.client_names.join(", ")}>{usedBy(pixel.client_names ?? [])}</td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: "#94a3b8" }}>{pixel.pixel_id}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#34d399" }}>{pixel.has_token ? "Saved" : "Missing"}</td>
                  <td className="px-3 py-2 text-right space-x-3">
                    <button type="button" onClick={() => startEdit(pixel)} className="text-xs font-semibold" style={{ color: "#f59e0b" }}>Edit</button>
                    <button type="button" onClick={() => remove(pixel)} className="text-xs font-semibold" style={{ color: "#f87171" }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sends.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "#64748b" }}>Recent sends</p>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#0f2040", color: "#64748b" }}>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                  <th className="text-left px-3 py-2 font-medium">Event</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sends.map(send => (
                  <tr key={send.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#cbd5e1" }}>
                    <td className="px-3 py-2 text-xs" style={{ color: "#94a3b8" }}>{new Date(send.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">{clientLabel(send.client_id)}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: "#94a3b8" }}>{send.event_name}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: statusColor(send.status) }} title={send.error ?? undefined}>
                      {send.status}{send.error ? ` — ${send.error}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
