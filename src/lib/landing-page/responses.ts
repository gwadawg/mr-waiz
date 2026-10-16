import { asLandingProduct, isEquityLanding, landingRepo, LANDING_SCHEMA_VERSION, type LandingProduct } from "./products";
import { parseLandingDraft } from "./intake";
import type { LandingDraft, LandingPublishMeta } from "./types";

export function emptyPublish(): LandingPublishMeta {
  return { pr_url: null, pr_number: null, head_sha: null, merged: false, error: null };
}

export function productFromResponses(
  responses: Record<string, unknown> | null | undefined,
): LandingProduct {
  return asLandingProduct(responses?.product);
}

export function templateRepoFromResponses(
  responses: Record<string, unknown> | null | undefined,
): string {
  const stored = responses?.template_repo;
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  return landingRepo(productFromResponses(responses));
}

export function toLandingResponses(
  draft: LandingDraft,
  publish: LandingPublishMeta = emptyPublish(),
  site: { siteId?: string | null; product?: LandingProduct } = {},
) {
  const product = asLandingProduct(site.product);
  const body: Record<string, unknown> = {
    schema_version: LANDING_SCHEMA_VERSION,
    product,
    template_repo: landingRepo(product),
    template_id: isEquityLanding(product) ? "theme-1" : draft.theme,
    fields: draft,
    publish,
  };
  if (site.siteId) body.site_id = site.siteId;
  return body;
}

export function fieldsFromResponses(responses: Record<string, unknown> | null | undefined): LandingDraft | null {
  if (!responses || typeof responses.fields !== "object" || responses.fields === null) return null;
  return parseLandingDraft(responses.fields);
}

export function publishMetaFromResponses(
  responses: Record<string, unknown> | null | undefined,
): LandingPublishMeta {
  const raw = responses?.publish;
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    pr_url: typeof p.pr_url === "string" ? p.pr_url : null,
    pr_number: typeof p.pr_number === "number" ? p.pr_number : null,
    head_sha: typeof p.head_sha === "string" ? p.head_sha : null,
    merged: p.merged === true,
    error: typeof p.error === "string" ? p.error : null,
  };
}
