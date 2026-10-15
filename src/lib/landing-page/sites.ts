import { landingPageUrl, thankYouPageUrl, type LandingProduct } from "./products";
import { fieldsFromResponses, productFromResponses, publishMetaFromResponses } from "./responses";

/** Rows saved before pages had their own id share this key for one client. */
export const LEGACY_SITE_ID = "legacy";

const SITE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LandingSiteRow = {
  id: string;
  client_id: string | null;
  status: string;
  submitted_at: string;
  responses: Record<string, unknown> | null;
};

export type LandingSiteSummary = {
  siteId: string;
  product: LandingProduct;
  slug: string;
  label: string;
  status: "draft" | "submitted" | "applied";
  hasDraft: boolean;
  landingPageUrl: string | null;
  thankYouPageUrl: string | null;
  locked: boolean;
  prUrl: string | null;
};

export function rowsMatchSite(
  row: { client_id: string | null; responses: Record<string, unknown> | null },
  clientId: string,
  siteId: string,
): boolean {
  return row.client_id === clientId && siteIdFromResponses(row.responses) === siteId;
}

export function isSiteId(value: string): boolean {
  return value === LEGACY_SITE_ID || SITE_UUID.test(value);
}

export function siteIdFromResponses(
  responses: Record<string, unknown> | null | undefined,
): string {
  const id = responses?.site_id;
  if (typeof id === "string" && SITE_UUID.test(id)) return id;
  return LEGACY_SITE_ID;
}

export function landingLabel(slug: string): string {
  const match = slug.match(/-(\d+)$/);
  if (match) return `Landing ${Number(match[1])}`;
  if (slug) return slug;
  return "Landing";
}

export function shouldWritePrimaryUrl(current: string | null | undefined, next: string): boolean {
  const existing = (current ?? "").trim().replace(/\/+$/, "");
  if (!existing) return true;
  return existing === next.trim().replace(/\/+$/, "");
}

function newest(rows: LandingSiteRow[]): LandingSiteRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
}

function sortKey(slug: string): number {
  const match = slug.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/** One card per page. A second site id never folds into the first. */
export function groupLandingSites(rows: LandingSiteRow[]): LandingSiteSummary[] {
  const groups = new Map<string, LandingSiteRow[]>();
  for (const row of rows) {
    if (row.status !== "draft" && row.status !== "submitted" && row.status !== "applied") continue;
    const key = siteIdFromResponses(row.responses);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const sites: LandingSiteSummary[] = [];
  for (const [siteId, group] of groups) {
    const submitted = newest(group.filter(row => row.status === "submitted"));
    const applied = newest(group.filter(row => row.status === "applied"));
    const current = submitted ?? newest(group);
    if (!current) continue;
    const product = productFromResponses(current.responses);
    const slug = fieldsFromResponses(current.responses)?.slug ?? "";
    const liveSource = applied ?? null;
    const liveSlug = liveSource ? fieldsFromResponses(liveSource.responses)?.slug ?? "" : "";
    const liveProduct = liveSource ? productFromResponses(liveSource.responses) : product;
    const hasDraft = group.some(row => row.status === "draft");
    const status = submitted ? "submitted" : hasDraft ? "draft" : "applied";
    sites.push({
      siteId,
      product,
      slug,
      label: landingLabel(slug),
      status,
      hasDraft,
      landingPageUrl: liveSlug ? landingPageUrl(liveProduct, liveSlug) : null,
      thankYouPageUrl: liveSlug ? thankYouPageUrl(liveProduct, liveSlug) : null,
      locked: Boolean(submitted),
      prUrl: submitted ? publishMetaFromResponses(submitted.responses).pr_url : null,
    });
  }

  return sites.sort((a, b) => {
    if (a.product !== b.product) return a.product.localeCompare(b.product);
    return sortKey(a.slug) - sortKey(b.slug) || a.slug.localeCompare(b.slug);
  });
}
