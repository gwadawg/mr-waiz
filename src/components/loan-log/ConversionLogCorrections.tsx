"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

type Stage = "proposal" | "submitted" | "funded" | "fell_out";
type Kind = "deal" | "event";

type LogRow = {
  id: string;
  kind: Kind;
  stage: Stage;
  lead_name: string;
  lead_phone: string | null;
  occurred_on: string;
  submitted_on: string | null;
  loan_size: number | null;
  commission_amount: number | null;
  transaction_label: string | null;
};

const STAGE_LABEL: Record<Stage, string> = {
  proposal: "Proposal",
  submitted: "Submitted",
  funded: "Funded",
  fell_out: "Fell out",
};

const STAGE_COLOR: Record<Stage, string> = {
  proposal: "#38bdf8",
  submitted: "#f59e0b",
  funded: "#4ade80",
  fell_out: "#94a3b8",
};

function money(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function dateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ConversionLogCorrections({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/conversion-logs`);
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Couldn't load logged conversions.");
      setRows([]);
      return;
    }
    setRows(Array.isArray(data.rows) ? data.rows : []);
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/conversion-logs`)
      .then(async res => {
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Couldn't load logged conversions.");
          setRows([]);
          return;
        }
        setRows(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load logged conversions.");
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const visible = useMemo(() => {
    const list = rows ?? [];
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return list;
    return list.filter(row => {
      if (row.lead_name.toLowerCase().includes(q)) return true;
      const phone = (row.lead_phone ?? "").replace(/\D/g, "");
      return Boolean(digits && phone.includes(digits));
    });
  }, [rows, query]);

  if (forbidden || rows === null) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: "#cbd5e1" }}>
        Logged conversions
      </h3>
      <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
        Correct a proposal, submission, or funded loan this client logged on the events tracker.
        The matching conversion updates with it, and their KPIs follow.
      </p>
      {error && <p className="text-xs mb-2" style={{ color: "#f87171" }}>{error}</p>}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search name or phone"
        className="w-full rounded-lg px-3 py-1.5 text-sm mb-3"
        style={{ background: "#080f1e", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.08)" }}
      />
      {visible.length === 0 ? (
        <p className="text-sm py-4 text-center rounded-lg" style={{ color: "#334155", background: "#080f1e" }}>
          {rows.length === 0 ? "No client-logged conversions yet." : "No logs match that search."}
        </p>
      ) : (
        <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
          {visible.map(row => (
            <LogCard
              key={`${row.kind}:${row.id}`}
              clientId={clientId}
              row={row}
              open={editingId === row.id}
              onOpen={() => {
                setError(null);
                setEditingId(row.id);
              }}
              onClose={() => setEditingId(null)}
              onSaved={async () => {
                setEditingId(null);
                await load();
              }}
              onError={setError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LogCard({
  clientId,
  row,
  open,
  onOpen,
  onClose,
  onSaved,
  onError,
}: {
  clientId: string;
  row: LogRow;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [date, setDate] = useState(row.occurred_on);
  const [loanSize, setLoanSize] = useState(row.loan_size?.toString() ?? "");
  const [commission, setCommission] = useState(row.commission_amount?.toString() ?? "");
  const [label, setLabel] = useState(row.transaction_label ?? "");
  const [pullBack, setPullBack] = useState(false);
  const [busy, setBusy] = useState(false);

  function begin() {
    setDate(row.occurred_on);
    setLoanSize(row.loan_size?.toString() ?? "");
    setCommission(row.commission_amount?.toString() ?? "");
    setLabel(row.transaction_label ?? "");
    setPullBack(false);
    onOpen();
  }

  function togglePullBack(next: boolean) {
    setPullBack(next);
    if (next) setDate(row.submitted_on ?? row.occurred_on);
    else setDate(row.occurred_on);
  }

  async function save() {
    setBusy(true);
    try {
      const body =
        row.kind === "deal"
          ? {
              kind: "deal",
              occurred_on: date,
              loan_size: loanSize,
              commission_amount: pullBack ? "" : commission,
              transaction_label: label,
              pull_back_to_submitted: pullBack,
            }
          : {
              kind: "event",
              occurred_on: date,
              loan_size: loanSize,
            };
      const res = await fetch(`/api/clients/${clientId}/conversion-logs/${row.id}?kind=${row.kind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't update this log.");
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't update this log.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const labelText = `${STAGE_LABEL[row.stage].toLowerCase()} log for ${row.lead_name}`;
    if (!window.confirm(`Remove this ${labelText}? It drops out of their KPIs.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/conversion-logs/${row.id}?kind=${row.kind}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't remove this log.");
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't remove this log.");
    } finally {
      setBusy(false);
    }
  }

  const showCommission = row.kind === "deal" && row.stage === "funded" && !pullBack;
  const dateName = pullBack || row.stage === "submitted" || row.stage === "fell_out"
    ? "Submitted on"
    : row.stage === "funded"
      ? "Funded on"
      : "Date";

  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "#080f1e", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{row.lead_name}</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: STAGE_COLOR[row.stage] }}>
              {STAGE_LABEL[row.stage]}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
            {dateLabel(row.occurred_on)}
            {row.loan_size != null ? ` · ${money(row.loan_size)}` : ""}
            {row.commission_amount != null ? ` · made ${money(row.commission_amount)}` : ""}
            {row.transaction_label ? ` · ${row.transaction_label}` : ""}
            {row.lead_phone ? ` · ${row.lead_phone}` : ""}
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={begin}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold flex-shrink-0"
            style={{ background: "#1e3a5f", color: "#e2e8f0" }}
          >
            Edit
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label={dateName}>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={fieldStyle} />
          </Field>
          <Field label="Loan size">
            <input value={loanSize} onChange={e => setLoanSize(e.target.value)} inputMode="decimal" style={fieldStyle} />
          </Field>
          {showCommission && (
            <Field label="What they made">
              <input value={commission} onChange={e => setCommission(e.target.value)} inputMode="decimal" style={fieldStyle} />
            </Field>
          )}
          {row.kind === "deal" && (
            <Field label="Label">
              <input value={label} onChange={e => setLabel(e.target.value)} style={fieldStyle} />
            </Field>
          )}
          {row.stage === "funded" && row.kind === "deal" && (
            <label className="sm:col-span-2 flex items-start gap-2 text-sm" style={{ color: "#cbd5e1" }}>
              <input
                type="checkbox"
                className="mt-1"
                checked={pullBack}
                onChange={e => togglePullBack(e.target.checked)}
              />
              <span>This was not funded. Mark it submitted instead.</span>
            </label>
          )}
          <div className="sm:col-span-2 flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "#1e3a5f", color: "#e2e8f0" }}
            >
              {busy ? "Saving" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ color: "#94a3b8" }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold ml-auto"
              style={{ color: "#f87171" }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "#475569" }}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const fieldStyle: CSSProperties = {
  width: "100%",
  background: "#0a1628",
  color: "#e2e8f0",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "0.5rem",
  padding: "0.375rem 0.75rem",
  fontSize: "0.875rem",
};
