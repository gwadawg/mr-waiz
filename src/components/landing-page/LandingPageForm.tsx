"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { reviewHeroHeadline } from "@/lib/landing-page/intake";
import {
  LANDING_PRODUCT_LABELS,
  LANDING_PRODUCTS,
  LANDING_THEME_LABELS,
  LANDING_THEMES,
  asLandingProduct,
  isEquityLanding,
  landingPageUrl as publicPageUrl,
  landingSiteLabel,
  type LandingProduct,
  type LandingTheme,
} from "@/lib/landing-page/products";
import type { LandingSiteSummary } from "@/lib/landing-page/sites";
import { assetFileId } from "@/lib/landing-page/assets";
import type { BrandType, Colorway, LandingDraft, LandingPublishMeta } from "@/lib/landing-page/types";

type Props = {
  clientId: string;
  fallbackName: string;
  onClose: () => void;
  onPublished?: () => void;
};

type LoadResponse = {
  siteId: string;
  product: LandingProduct;
  draft: LandingDraft;
  locked: boolean;
  hasApplied: boolean;
  slugLocked: boolean;
  publish: LandingPublishMeta;
  landingPageUrl: string | null;
  thankYouPageUrl: string | null;
  headshotUrl: string | null;
  logoUrl: string | null;
};

type Screen = "list" | "offer" | "edit";

async function fetchLandingList(clientId: string) {
  const res = await fetch(`/api/clients/${clientId}/landing-page`);
  const json = (await res.json()) as {
    sites?: LandingSiteSummary[];
    error?: string;
    headshotUrl?: string | null;
    logoUrl?: string | null;
  };
  if (!res.ok) throw new Error(json.error || "Could not load landing pages");
  return json;
}

function AssetSlot({
  label,
  hint,
  empty,
  url,
  disabled,
  contain,
  onPick,
}: {
  label: string;
  hint: string;
  empty: string;
  url: string | null;
  disabled: boolean;
  contain?: boolean;
  onPick: (file: File) => void;
}) {
  const id = assetFileId(url);
  return (
    <div className="rounded-lg border border-white/10 px-3 py-3">
      <p className="text-xs font-semibold text-slate-200">{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>
      {url && id ? (
        <div className="mt-3 flex items-center gap-3">
          <img
            src={url}
            alt=""
            className={`h-16 w-16 rounded-md bg-black/30 ${contain ? "object-contain" : "object-cover"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{label} ID</p>
            <p className="truncate font-mono text-xs text-slate-200" title={id}>
              {id}
            </p>
            <label className="mt-2 inline-block text-[11px] text-slate-400">
              Replace
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                disabled={disabled}
                className="mt-1 block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onPick(file);
                }}
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-amber-200">{empty}</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            disabled={disabled}
            className="mt-2 block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onPick(file);
            }}
          />
        </div>
      )}
    </div>
  );
}

const fieldStyle = {
  background: "#0f2040",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
};

const panelStyle = { border: "1px solid rgba(255,255,255,0.08)", background: "#0a1628" };

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function LandingPageForm({ clientId, fallbackName, onClose, onPublished }: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<Screen>("list");
  const [sites, setSites] = useState<LandingSiteSummary[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [product, setProduct] = useState<LandingProduct>("DSCR");
  const [draft, setDraft] = useState<LandingDraft | null>(null);
  const [locked, setLocked] = useState(false);
  const [hasApplied, setHasApplied] = useState(false);
  const [slugLocked, setSlugLocked] = useState(false);
  const [publish, setPublish] = useState<LandingPublishMeta | null>(null);
  const [landingPageUrl, setLandingPageUrl] = useState<string | null>(null);
  const [thankYouPageUrl, setThankYouPageUrl] = useState<string | null>(null);
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  function applyPayload(json: LoadResponse) {
    setSiteId(json.siteId);
    setProduct(asLandingProduct(json.product));
    setDraft(json.draft);
    setLocked(json.locked);
    setHasApplied(json.hasApplied);
    setSlugLocked(json.slugLocked);
    setPublish(json.publish);
    setLandingPageUrl(json.landingPageUrl);
    setThankYouPageUrl(json.thankYouPageUrl);
    setHeadshotUrl(json.headshotUrl ?? null);
    setLogoUrl(json.logoUrl ?? null);
    setScreen("edit");
  }

  function rememberList(json: Awaited<ReturnType<typeof fetchLandingList>>) {
    const next = json.sites ?? [];
    setSites(next);
    if (json.headshotUrl !== undefined) setHeadshotUrl(json.headshotUrl ?? null);
    if (json.logoUrl !== undefined) setLogoUrl(json.logoUrl ?? null);
    return next;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchLandingList(clientId);
        if (cancelled) return;
        const next = json.sites ?? [];
        setSites(next);
        if (json.headshotUrl !== undefined) setHeadshotUrl(json.headshotUrl ?? null);
        if (json.logoUrl !== undefined) setLogoUrl(json.logoUrl ?? null);
        if (next.length === 0) setScreen("offer");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  function patch(partial: Partial<LandingDraft>) {
    setDraft(current => (current ? { ...current, ...partial } : current));
  }

  function toggleNotice(notice: "texas" | "illinois", on: boolean) {
    setDraft(current => {
      if (!current) return current;
      const has = current.stateNotices.includes(notice);
      const stateNotices = on
        ? has
          ? current.stateNotices
          : [...current.stateNotices, notice]
        : current.stateNotices.filter(item => item !== notice);
      return { ...current, stateNotices };
    });
  }

  async function uploadAsset(kind: "headshot" | "logo", file: File) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      if (siteId) body.set("siteId", siteId);
      const res = await fetch(`/api/clients/${clientId}/landing-page`, {
        method: "POST",
        body,
      });
      const json = (await res.json()) as { error?: string; headshotUrl?: string; logoUrl?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed");
      if (json.headshotUrl) setHeadshotUrl(json.headshotUrl);
      if (json.logoUrl) setLogoUrl(json.logoUrl);
      setNotice(kind === "logo" ? "Logo saved on the client" : "Headshot saved on the client");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function post(action: "save" | "publish" | "check") {
    if ((!draft || !siteId) && action !== "check") return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/landing-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draft, siteId }),
      });
      const json = (await res.json()) as {
        error?: string;
        draft?: LandingDraft;
        locked?: boolean;
        publish?: LandingPublishMeta;
        pr_url?: string;
        result?: string;
        siteId?: string;
        primary?: boolean;
        landingPageUrl?: string | null;
        thankYouPageUrl?: string | null;
      };
      if (!res.ok) throw new Error(json.error || "Request failed");
      if (json.siteId) setSiteId(json.siteId);
      if (json.draft) setDraft(json.draft);
      if (json.publish) setPublish(json.publish);
      if (json.locked) setLocked(true);
      if (json.landingPageUrl !== undefined) setLandingPageUrl(json.landingPageUrl ?? null);
      if (json.thankYouPageUrl !== undefined) setThankYouPageUrl(json.thankYouPageUrl ?? null);
      if (action === "save") setNotice("Draft saved");
      if (action === "publish") {
        setNotice("Pull request opened");
        onPublished?.();
      }
      if (action === "check") {
        if (json.result === "applied") {
          setLocked(false);
          setHasApplied(true);
          setSlugLocked(true);
          setNotice(
            json.primary
              ? "Live page saved on the client."
              : "This page is live. The other landing page was left as it is.",
          );
          onPublished?.();
        } else {
          setNotice("The page is not live yet. Check again after the Vercel build finishes.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function startPage(nextProduct: LandingProduct) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/landing-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", product: nextProduct }),
      });
      const json = (await res.json()) as LoadResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not start the landing page");
      applyPayload(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the landing page");
    } finally {
      setBusy(false);
    }
  }

  async function openSite(nextSiteId: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/landing-page?site=${encodeURIComponent(nextSiteId)}`);
      const json = (await res.json()) as LoadResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not open that landing page");
      applyPayload(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that landing page");
    } finally {
      setBusy(false);
    }
  }

  async function backToPages() {
    setDraft(null);
    setNotice(null);
    setError(null);
    setLoading(true);
    try {
      const next = rememberList(await fetchLandingList(clientId));
      setScreen(next.length === 0 ? "offer" : "list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load");
      setScreen("list");
    } finally {
      setLoading(false);
    }
  }

  function portal(node: ReactNode) {
    if (!mounted || typeof document === "undefined") return null;
    return createPortal(node, document.body);
  }

  if (loading || (error && screen !== "offer" && screen !== "list" && !draft)) {
    return portal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
        <div className="max-w-md rounded-xl p-6" style={panelStyle}>
          <p className="text-sm text-slate-300">{error || "Loading landing pages…"}</p>
          <button type="button" className="mt-4 text-sm text-slate-300 underline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>,
    );
  }

  if (screen !== "edit" || !draft) {
    return portal(
      <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6">
        <div className="my-2 w-full max-w-lg rounded-2xl shadow-2xl" style={panelStyle}>
          <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Landing pages</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">{fallbackName}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              Close
            </button>
          </header>
          <div className="space-y-4 px-5 py-5">
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            {screen === "offer" ? (
              <>
                <p className="text-sm text-slate-300">Which offer is this page for?</p>
                <div className="grid gap-3">
                  {LANDING_PRODUCTS.map(choice => (
                    <button
                      key={choice}
                      type="button"
                      disabled={busy}
                      onClick={() => void startPage(choice)}
                      className="rounded-xl px-4 py-3 text-left"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <p className="text-sm font-semibold text-slate-100">{LANDING_PRODUCT_LABELS[choice]}</p>
                      <p className="mt-1 text-xs text-slate-400">{landingSiteLabel(choice)}</p>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="text-sm text-slate-400 underline"
                  onClick={() => {
                    if (sites.length === 0) onClose();
                    else {
                      setError(null);
                      setScreen("list");
                    }
                  }}
                >
                  {sites.length === 0 ? "Close" : "Back to pages"}
                </button>
              </>
            ) : (
              <>
                {sites.map(site => (
                  <div
                    key={site.siteId}
                    className="flex items-start justify-between gap-3 rounded-xl px-4 py-3"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">
                        {site.label}
                        <span className="ml-2 text-xs font-normal text-slate-400">{LANDING_PRODUCT_LABELS[site.product]}</span>
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {site.landingPageUrl ?? (site.slug ? publicPageUrl(site.product, site.slug) : "Draft")}
                        {site.locked ? " · publish open" : site.landingPageUrl ? "" : " · draft"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openSite(site.siteId)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                    >
                      Edit
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setScreen("offer");
                  }}
                  className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-slate-950"
                  style={{ background: "#34d399" }}
                >
                  Add new landing page
                </button>
              </>
            )}
          </div>
        </div>
      </div>,
    );
  }

  const inputClass = "w-full rounded-md px-3 py-2 text-sm outline-none";
  const disabled = locked || busy;
  const equity = isEquityLanding(product);
  const showAccent = !equity && (draft.theme === "theme-custom" || draft.theme === "theme-light");
  const hero = equity ? reviewHeroHeadline(draft.heroHeadline, product === "HS" ? "many" : "one") : null;
  const site = landingSiteLabel(product);

  return portal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6">
      <div className="my-2 w-full max-w-3xl rounded-2xl shadow-2xl" style={panelStyle}>
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <button type="button" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 underline" onClick={() => void backToPages()}>
              All landing pages
            </button>
            <h2 className="mt-1 text-lg font-semibold text-slate-100">
              {fallbackName}
              <span className="ml-2 text-sm font-normal text-slate-400">{LANDING_PRODUCT_LABELS[product]}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            Close
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          {locked && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
              <p>A publish is open for this page. It stays read-only until that pull request merges or closes. Other pages can still be edited.</p>
              {publish?.pr_url ? (
                <a className="mt-2 inline-block underline" href={publish.pr_url} target="_blank" rel="noreferrer">
                  Open pull request
                </a>
              ) : null}
              {publish?.merged ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void post("check")}
                  className="mt-3 block rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold"
                >
                  Check live page
                </button>
              ) : null}
              {publish?.error ? <p className="mt-2 text-xs text-amber-200">{publish.error}</p> : null}
            </div>
          )}

          {landingPageUrl ? (
            <p className="text-xs text-slate-400">
              Live:{" "}
              <a className="text-slate-200 underline" href={landingPageUrl} target="_blank" rel="noreferrer">
                {landingPageUrl}
              </a>
              {thankYouPageUrl ? ` · ${thankYouPageUrl}` : ""}
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Publishes to {draft.slug ? publicPageUrl(product, draft.slug) : site}. A pull request opens for review.
            </p>
          )}

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}

          <section className="grid gap-4 sm:grid-cols-2">
            {equity ? (
              <>
                <Field label="Brand">
                  <select
                    className={inputClass}
                    style={fieldStyle}
                    disabled={disabled}
                    value={draft.brandType}
                    onChange={e => patch({ brandType: e.target.value as BrandType })}
                  >
                    <option value="individual">Loan officer</option>
                    <option value="company">Company</option>
                  </select>
                </Field>
                <Field label="Colorway">
                  <select
                    className={inputClass}
                    style={fieldStyle}
                    disabled={disabled}
                    value={draft.colorway}
                    onChange={e => {
                      const colorway = e.target.value as Colorway;
                      patch(
                        colorway === "stock"
                          ? { colorway, ink: "", action: "", mark: "", cream: "" }
                          : { colorway },
                      );
                    }}
                  >
                    <option value="stock">Stock navy and cream</option>
                    <option value="custom">Your colors</option>
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Template">
                <select
                  className={inputClass}
                  style={fieldStyle}
                  disabled={disabled}
                  value={draft.theme}
                  onChange={e => {
                    const theme = e.target.value as LandingTheme;
                    patch(theme === "theme-1" ? { theme, accent: "" } : { theme });
                  }}
                >
                  {LANDING_THEMES.map(theme => (
                    <option key={theme} value={theme}>
                      {LANDING_THEME_LABELS[theme]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {showAccent ? (
              <Field label={draft.theme === "theme-custom" ? "Color (required)" : "Color (optional)"}>
                <input
                  className={inputClass}
                  style={fieldStyle}
                  disabled={disabled}
                  value={draft.accent}
                  placeholder="#1B4D3E"
                  onChange={e => patch({ accent: e.target.value })}
                />
              </Field>
            ) : null}
            {equity && draft.colorway === "custom" ? (
              <>
                <Field label="Ink (required)">
                  <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.ink} placeholder="#1B3A2F" onChange={e => patch({ ink: e.target.value })} />
                </Field>
                <Field label="Action (required)">
                  <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.action} placeholder="#2F6B4F" onChange={e => patch({ action: e.target.value })} />
                </Field>
                <Field label="Mark (optional)">
                  <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.mark} placeholder="#C4A35A" onChange={e => patch({ mark: e.target.value })} />
                </Field>
                <Field label="Cream (optional)">
                  <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.cream} placeholder="#F4F1EA" onChange={e => patch({ cream: e.target.value })} />
                </Field>
              </>
            ) : null}
            <Field label="Slug">
              <input
                className={inputClass}
                style={fieldStyle}
                disabled={disabled || slugLocked}
                value={draft.slug}
                onChange={e => patch({ slug: e.target.value.toLowerCase() })}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {slugLocked
                  ? "This URL is live. Add a new page to get the next number."
                  : "The number keeps this page on its own URL. It locks once the page is live."}
              </p>
            </Field>
            <Field label="Quiz URL">
              <input
                className={inputClass}
                style={fieldStyle}
                disabled={disabled}
                value={draft.applyUrl}
                placeholder="https://"
                onChange={e => patch({ applyUrl: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                The designated quiz page in Perspective for this offer.
              </p>
            </Field>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Public name">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.name} onChange={e => patch({ name: e.target.value })} />
            </Field>
            {equity && draft.brandType === "company" ? null : (
              <Field label="First name">
                <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.firstName} onChange={e => patch({ firstName: e.target.value })} />
              </Field>
            )}
            <Field label="Title">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.title} onChange={e => patch({ title: e.target.value })} />
            </Field>
            <Field label={equity && draft.brandType === "company" ? "Parent company (optional)" : "Company"}>
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.company} onChange={e => patch({ company: e.target.value })} />
            </Field>
            {equity && draft.brandType === "company" ? (
              <Field label="Legal name (optional)">
                <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.legalName} onChange={e => patch({ legalName: e.target.value })} />
              </Field>
            ) : null}
            <Field label="Tagline">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.tagline} onChange={e => patch({ tagline: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.phone} onChange={e => patch({ phone: e.target.value })} />
              <p className="mt-1 text-[11px] text-slate-500">
                The client&apos;s GHL number — the one leads and texting use.
              </p>
            </Field>
            <Field label="Email">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.email} onChange={e => patch({ email: e.target.value })} />
            </Field>
            {equity ? null : (
              <Field label="Booking URL">
                <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.bookingUrl} placeholder="Optional" onChange={e => patch({ bookingUrl: e.target.value })} />
                <p className="mt-1 text-[11px] text-slate-500">
                  GHL calendar link for Self-Scheduled Consultation.
                </p>
              </Field>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Street">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.street} onChange={e => patch({ street: e.target.value })} />
            </Field>
            <Field label="City">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.city} onChange={e => patch({ city: e.target.value })} />
            </Field>
            <Field label="State">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.region} onChange={e => patch({ region: e.target.value })} />
            </Field>
            <Field label="ZIP">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.postalCode} onChange={e => patch({ postalCode: e.target.value })} />
            </Field>
            {equity && draft.brandType === "company" ? null : (
              <Field label="Individual NMLS">
                <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.nmlsIndividual} onChange={e => patch({ nmlsIndividual: e.target.value })} />
              </Field>
            )}
            <Field label="Company NMLS">
              <input className={inputClass} style={fieldStyle} disabled={disabled} value={draft.nmlsCompany} onChange={e => patch({ nmlsCompany: e.target.value })} />
            </Field>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <AssetSlot
              label="Headshot"
              hint="4:5 portrait, about 1200×1500. PNG, JPG, or WEBP, 4MB or smaller. Face in the upper half."
              empty="No headshot on this client. Upload one before publishing."
              url={headshotUrl}
              disabled={disabled}
              onPick={file => void uploadAsset("headshot", file)}
            />
            <AssetSlot
              label="Logo"
              hint="Optional company mark. Transparent PNG works best, about 800×200. Replaces the name in the page header and footer."
              empty="No logo on this client. Upload one if this page should show a mark."
              url={logoUrl}
              contain
              disabled={disabled}
              onPick={file => void uploadAsset("logo", file)}
            />
          </section>

          {equity ? (
            <Field label={`Hero line${hero ? ` (${hero.length}/80)` : ""}`}>
              <textarea
                className={`${inputClass} min-h-20`}
                style={fieldStyle}
                disabled={disabled}
                value={draft.heroHeadline}
                onChange={e => patch({ heroHeadline: e.target.value })}
              />
              {hero?.error ? <p className="mt-1 text-xs text-rose-300">{hero.error}</p> : (
                <p className="mt-1 text-[11px] text-slate-500">
                  {product === "HS"
                    ? "Asterisks are not counted. Wrap a phrase in *asterisks* for the accent. Several phrases are allowed."
                    : "Asterisks are not counted. One *phrase* is the italic accent."}
                </p>
              )}
            </Field>
          ) : (
            <Field label="Bio">
              <textarea
                className={`${inputClass} min-h-20`}
                style={fieldStyle}
                disabled={disabled}
                value={draft.bio}
                onChange={e => patch({ bio: e.target.value })}
              />
            </Field>
          )}

          {product === "HS" ? (
            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum age">
                <input
                  className={inputClass}
                  style={fieldStyle}
                  disabled={disabled}
                  value={draft.fitAge}
                  inputMode="numeric"
                  onChange={e => patch({ fitAge: e.target.value })}
                />
              </Field>
              <Field label="Minimum credit score">
                <input
                  className={inputClass}
                  style={fieldStyle}
                  disabled={disabled}
                  value={draft.fitCredit}
                  inputMode="numeric"
                  placeholder="Blank shows fair credit considered"
                  onChange={e => patch({ fitCredit: e.target.value })}
                />
              </Field>
            </section>
          ) : null}

          <section className="flex flex-wrap gap-4 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={draft.smsStatus === "ready"}
                onChange={e => patch({ smsStatus: e.target.checked ? "ready" : "pending" })}
              />
              Texting approved
            </label>
            {equity ? null : (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={disabled || !hasApplied}
                  checked={draft.preview || !hasApplied}
                  onChange={e => patch({ preview: e.target.checked })}
                />
                Hide from search
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={draft.stateNotices.includes("texas")}
                onChange={e => toggleNotice("texas", e.target.checked)}
              />
              Texas notice
            </label>
            {equity ? null : (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={draft.stateNotices.includes("illinois")}
                  onChange={e => toggleNotice("illinois", e.target.checked)}
                />
                Illinois notice
              </label>
            )}
          </section>
          {!equity && !hasApplied ? (
            <p className="text-xs text-slate-500">The first publish stays out of search. Turn indexing on with a later publish.</p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void post("save")}
            className="rounded-lg px-3 py-2 text-sm text-slate-200"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void post("publish")}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-950"
            style={{ background: "#34d399" }}
          >
            Publish
          </button>
        </footer>
      </div>
    </div>
  );
}
