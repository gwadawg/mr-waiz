"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { lifecycleStatusLabel } from "@/lib/client-feedback";
import {
  SUGGESTED_TEAM_CHANNEL_SLUGS,
  type ClientChannelRow,
  type NotificationAutomationRow,
  type SlackChannelRow,
} from "@/lib/slack-channels";
import { BUILT_IN_AUTOMATIONS } from "@/lib/built-in-automations";
import MetaPixelLibrary from "@/components/MetaPixelLibrary";

type TeamChannelDraft = {
  slug: string;
  label: string;
  channel_id: string;
  description: string;
};

const emptyTeamDraft: TeamChannelDraft = {
  slug: "",
  label: "",
  channel_id: "",
  description: "",
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

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-5 space-y-4" style={cardStyle}>
      <div>
        <h2 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{title}</h2>
        {description && (
          <p className="text-xs mt-1" style={{ color: "#64748b" }}>{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export default function AutomationsManager() {
  const [teamChannels, setTeamChannels] = useState<SlackChannelRow[]>([]);
  const [clientChannels, setClientChannels] = useState<ClientChannelRow[]>([]);
  const [automations, setAutomations] = useState<NotificationAutomationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [addingTeam, setAddingTeam] = useState(false);
  const [newTeam, setNewTeam] = useState<TeamChannelDraft>(emptyTeamDraft);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<TeamChannelDraft>(emptyTeamDraft);

  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editClientSlackId, setEditClientSlackId] = useState("");
  const [clientFilter, setClientFilter] = useState<"all" | "missing">("all");
  const [slackConfigured, setSlackConfigured] = useState(false);
  const [opsChannelSlug, setOpsChannelSlug] = useState("ops_alerts");
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/slack/channels").then(r => r.json()),
      fetch("/api/slack/client-channels").then(r => r.json()),
      fetch("/api/slack/automations").then(r => r.json()),
      fetch("/api/slack/status").then(r => r.json()),
    ])
      .then(([teamRes, clientRes, autoRes, statusRes]) => {
        if (teamRes.error) throw new Error(teamRes.error);
        if (clientRes.error) throw new Error(clientRes.error);
        if (autoRes.error) throw new Error(autoRes.error);
        setTeamChannels(teamRes.channels ?? []);
        setClientChannels(clientRes.clients ?? []);
        setAutomations(autoRes.automations ?? []);
        setSlackConfigured(!!statusRes.configured);
        if (statusRes.ops_channel_slug) setOpsChannelSlug(statusRes.ops_channel_slug);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const missingClientCount = useMemo(
    () => clientChannels.filter(c => !c.slack_id).length,
    [clientChannels],
  );

  const filteredClients = useMemo(() => {
    if (clientFilter === "missing") return clientChannels.filter(c => !c.slack_id);
    return clientChannels;
  }, [clientChannels, clientFilter]);

  const usedSlugs = useMemo(() => new Set(teamChannels.map(c => c.slug)), [teamChannels]);

  async function handleAddTeam() {
    if (!newTeam.slug.trim() || !newTeam.label.trim() || !newTeam.channel_id.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/slack/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTeam),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to add team channel"); return; }
    setNewTeam(emptyTeamDraft);
    setAddingTeam(false);
    load();
  }

  function startEditTeam(channel: SlackChannelRow) {
    setEditingTeamId(channel.id);
    setEditTeam({
      slug: channel.slug,
      label: channel.label,
      channel_id: channel.channel_id,
      description: channel.description ?? "",
    });
  }

  async function handleUpdateTeam(id: string) {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/slack/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editTeam),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to update team channel"); return; }
    setEditingTeamId(null);
    load();
  }

  async function handleToggleTeamActive(channel: SlackChannelRow) {
    setSaving(true);
    const res = await fetch(`/api/slack/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !channel.is_active }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to update channel");
      return;
    }
    load();
  }

  async function handleDeleteTeam(id: string, label: string) {
    if (!confirm(`Remove team channel "${label}"?`)) return;
    const res = await fetch(`/api/slack/channels/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to delete channel");
      return;
    }
    load();
  }

  function startEditClient(row: ClientChannelRow) {
    setEditingClientId(row.client_id);
    setEditClientSlackId(row.slack_id ?? "");
  }

  async function handleUpdateClient(clientId: string) {
    setSaving(true);
    setError("");
    const res = await fetch("/api/slack/client-channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, slack_id: editClientSlackId.trim() || null }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to update client channel"); return; }
    setEditingClientId(null);
    load();
  }

  function applySuggestedSlug(slug: string) {
    setNewTeam(prev => ({
      ...prev,
      slug,
      label: prev.label || `#${slug.replace(/_/g, "-")}`,
    }));
  }

  async function handleTestMessage(key: string, channelId: string, label: string) {
    setTestingKey(key);
    setError("");
    setTestSuccess("");
    const res = await fetch("/api/slack/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        text: `✅ Test message from Mr. Waiz — ${label}`,
      }),
    });
    const data = await res.json();
    setTestingKey(null);
    if (!res.ok) {
      setError(data.error ?? "Failed to send test message");
      return;
    }
    setTestSuccess(`Test message sent to ${label}`);
    setTimeout(() => setTestSuccess(""), 4000);
  }

  if (loading) {
    return <div className="py-8 text-center text-sm" style={{ color: "#334155" }}>Loading…</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "#e2e8f0" }}>Automations</h1>
        <p className="text-sm mt-1" style={{ color: "#64748b" }}>
          Store Slack channel IDs and send messages directly from Mr. Waiz (no Make required when the bot is configured).
        </p>
      </div>

      {slackConfigured ? (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" }}>
          Slack bot connected — Mr. Waiz can post directly. Internal alerts use team channel slug <span className="font-mono">{opsChannelSlug}</span>.
        </div>
      ) : (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
          Set <span className="font-mono">SLACK_BOT_TOKEN</span> in your environment to send messages directly. See <span className="font-mono">docs/SLACK_BOT.md</span> for bot setup (create app → add <span className="font-mono">chat:write</span> scope → invite bot to private channels).
        </div>
      )}

      {testSuccess && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" }}>
          {testSuccess}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
          {error}
        </div>
      )}

      <MetaPixelLibrary />

      <SectionCard
        title="Team channels"
        description="Internal workspace channels (ops alerts, billing, setters, etc.). Reference by slug in future automations."
      >
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_TEAM_CHANNEL_SLUGS.filter(s => !usedSlugs.has(s)).map(slug => (
            <button
              key={slug}
              type="button"
              onClick={() => { setAddingTeam(true); applySuggestedSlug(slug); }}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}
            >
              + {slug}
            </button>
          ))}
        </div>

        {!addingTeam ? (
          <button
            type="button"
            onClick={() => setAddingTeam(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: "#f59e0b", color: "#fff" }}
          >
            Add team channel
          </button>
        ) : (
          <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid rgba(245,158,11,0.25)" }}>
            <p className="text-sm font-semibold" style={{ color: "#f59e0b" }}>New team channel</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>Slug</label>
                <input style={inputStyle} placeholder="ops_alerts" value={newTeam.slug} onChange={e => setNewTeam(s => ({ ...s, slug: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>Label</label>
                <input style={inputStyle} placeholder="#ops-alerts" value={newTeam.label} onChange={e => setNewTeam(s => ({ ...s, label: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>Channel ID</label>
                <input style={inputStyle} placeholder="C01234567 or G01234567" value={newTeam.channel_id} onChange={e => setNewTeam(s => ({ ...s, channel_id: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>Description (optional)</label>
                <input style={inputStyle} placeholder="Ops team alerts" value={newTeam.description} onChange={e => setNewTeam(s => ({ ...s, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleAddTeam} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: "#f59e0b", color: "#fff", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => { setAddingTeam(false); setNewTeam(emptyTeamDraft); }} className="px-4 py-2 rounded-lg text-sm" style={{ color: "#94a3b8" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {teamChannels.length === 0 ? (
          <p className="text-sm" style={{ color: "#475569" }}>No team channels yet.</p>
        ) : (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#0f2040", color: "#64748b" }}>
                  <th className="text-left px-3 py-2 font-medium">Label</th>
                  <th className="text-left px-3 py-2 font-medium">Slug</th>
                  <th className="text-left px-3 py-2 font-medium">Channel ID</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Description</th>
                  <th className="text-left px-3 py-2 font-medium">Active</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teamChannels.map(channel => (
                  <tr key={channel.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#cbd5e1" }}>
                    {editingTeamId === channel.id ? (
                      <>
                        <td className="px-3 py-2"><input style={inputStyle} value={editTeam.label} onChange={e => setEditTeam(s => ({ ...s, label: e.target.value }))} /></td>
                        <td className="px-3 py-2"><input style={inputStyle} value={editTeam.slug} onChange={e => setEditTeam(s => ({ ...s, slug: e.target.value }))} /></td>
                        <td className="px-3 py-2"><input style={inputStyle} value={editTeam.channel_id} onChange={e => setEditTeam(s => ({ ...s, channel_id: e.target.value }))} /></td>
                        <td className="px-3 py-2 hidden md:table-cell"><input style={inputStyle} value={editTeam.description} onChange={e => setEditTeam(s => ({ ...s, description: e.target.value }))} /></td>
                        <td className="px-3 py-2">—</td>
                        <td className="px-3 py-2 text-right space-x-2">
                          <button type="button" onClick={() => handleUpdateTeam(channel.id)} disabled={saving} className="text-xs font-semibold" style={{ color: "#f59e0b" }}>Save</button>
                          <button type="button" onClick={() => setEditingTeamId(null)} className="text-xs" style={{ color: "#64748b" }}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium" style={{ color: "#e2e8f0" }}>{channel.label}</td>
                        <td className="px-3 py-2 font-mono text-xs" style={{ color: "#94a3b8" }}>{channel.slug}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => copyText(channel.channel_id)} className="font-mono text-xs hover:underline" style={{ color: "#38bdf8" }} title="Copy channel ID">
                            {channel.channel_id}
                          </button>
                        </td>
                        <td className="px-3 py-2 hidden md:table-cell text-xs" style={{ color: "#64748b" }}>{channel.description ?? "—"}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => handleToggleTeamActive(channel)} disabled={saving} className="text-xs px-2 py-0.5 rounded" style={{ background: channel.is_active ? "rgba(52,211,153,0.15)" : "rgba(100,116,139,0.2)", color: channel.is_active ? "#34d399" : "#94a3b8" }}>
                            {channel.is_active ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right space-x-2">
                          {slackConfigured && channel.is_active && (
                            <button
                              type="button"
                              onClick={() => handleTestMessage(`team-${channel.id}`, channel.channel_id, channel.label)}
                              disabled={!!testingKey}
                              className="text-xs font-semibold"
                              style={{ color: "#38bdf8" }}
                            >
                              {testingKey === `team-${channel.id}` ? "Sending…" : "Test"}
                            </button>
                          )}
                          <button type="button" onClick={() => startEditTeam(channel)} className="text-xs font-semibold" style={{ color: "#f59e0b" }}>Edit</button>
                          <button type="button" onClick={() => handleDeleteTeam(channel.id, channel.label)} className="text-xs" style={{ color: "#f87171" }}>Delete</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Client channels"
        description={`Per-client Slack channels (stored on clients.slack_id). ${missingClientCount > 0 ? `${missingClientCount} client(s) missing a channel ID.` : "All clients have a channel ID."}`}
      >
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => setClientFilter("all")}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{ background: clientFilter === "all" ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)", color: clientFilter === "all" ? "#fbbf24" : "#94a3b8" }}
          >
            All ({clientChannels.length})
          </button>
          <button
            type="button"
            onClick={() => setClientFilter("missing")}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{ background: clientFilter === "missing" ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)", color: clientFilter === "missing" ? "#f87171" : "#94a3b8" }}
          >
            Missing ID ({missingClientCount})
          </button>
        </div>

        {filteredClients.length === 0 ? (
          <p className="text-sm" style={{ color: "#475569" }}>No clients match this filter.</p>
        ) : (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#0f2040", color: "#64748b" }}>
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Channel ID</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map(row => {
                  const missing = !row.slack_id;
                  return (
                    <tr
                      key={row.client_id}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.04)",
                        color: "#cbd5e1",
                        background: missing ? "rgba(239,68,68,0.04)" : undefined,
                      }}
                    >
                      <td className="px-3 py-2 font-medium" style={{ color: "#e2e8f0" }}>{row.client_name}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: "#94a3b8" }}>{lifecycleStatusLabel(row.lifecycle_status)}</td>
                      <td className="px-3 py-2">
                        {editingClientId === row.client_id ? (
                          <input
                            style={inputStyle}
                            placeholder="C01234567 or G01234567"
                            value={editClientSlackId}
                            onChange={e => setEditClientSlackId(e.target.value)}
                          />
                        ) : row.slack_id ? (
                          <button type="button" onClick={() => copyText(row.slack_id!)} className="font-mono text-xs hover:underline" style={{ color: "#38bdf8" }} title="Copy channel ID">
                            {row.slack_id}
                          </button>
                        ) : (
                          <span className="text-xs" style={{ color: "#f87171" }}>Not set</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right space-x-2">
                        {editingClientId === row.client_id ? (
                          <>
                            <button type="button" onClick={() => handleUpdateClient(row.client_id)} disabled={saving} className="text-xs font-semibold" style={{ color: "#f59e0b" }}>Save</button>
                            <button type="button" onClick={() => setEditingClientId(null)} className="text-xs" style={{ color: "#64748b" }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            {slackConfigured && row.slack_id && (
                              <button
                                type="button"
                                onClick={() => handleTestMessage(`client-${row.client_id}`, row.slack_id!, row.client_name)}
                                disabled={!!testingKey}
                                className="text-xs font-semibold"
                                style={{ color: "#38bdf8" }}
                              >
                                {testingKey === `client-${row.client_id}` ? "Sending…" : "Test"}
                              </button>
                            )}
                            <button type="button" onClick={() => startEditClient(row)} className="text-xs font-semibold" style={{ color: "#f59e0b" }}>Edit</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Automations"
        description="Built-in workflows run on form events and scheduled checks (e.g. CPL threshold). Wire team channel slugs below so Slack delivery works."
      >
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#0f2040", color: "#64748b" }}>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Event</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {BUILT_IN_AUTOMATIONS.map(auto => (
                <tr key={auto.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#cbd5e1" }}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium" style={{ color: "#e2e8f0" }}>{auto.name}</div>
                    <div className="text-xs mt-1" style={{ color: "#64748b" }}>{auto.trigger}</div>
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs" style={{ color: "#94a3b8" }}>{auto.event_key}</td>
                  <td className="px-3 py-2 align-top">
                    <ul className="text-xs space-y-1" style={{ color: "#94a3b8" }}>
                      {auto.actions.map(action => (
                        <li key={action}>• {action}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2 align-top text-xs" style={{ color: "#34d399" }}>Active</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {automations.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-medium mb-2" style={{ color: "#64748b" }}>Configurable Slack automations (phase 2)</p>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#0f2040", color: "#64748b" }}>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-left px-3 py-2 font-medium">Event</th>
                    <th className="text-left px-3 py-2 font-medium">Target</th>
                    <th className="text-left px-3 py-2 font-medium">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.map(auto => (
                    <tr key={auto.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#cbd5e1" }}>
                      <td className="px-3 py-2">{auto.name}</td>
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: "#94a3b8" }}>{auto.event_key}</td>
                      <td className="px-3 py-2 text-xs">{auto.target_type}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: auto.is_enabled ? "#34d399" : "#64748b" }}>
                        {auto.is_enabled ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
