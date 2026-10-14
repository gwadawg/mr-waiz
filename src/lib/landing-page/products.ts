/** Landing factories. The client product picks the repo, the site, and the slug rules. */

export const LANDING_PRODUCTS = ["DSCR", "RM"] as const;
export type LandingProduct = (typeof LANDING_PRODUCTS)[number];

export const DSCR_GITHUB_REPO = "gwadawg/dscr-experts";
export const RM_GITHUB_REPO = "gwadawg/rm-website-template";
export const DSCR_SITE_URL = "https://dscrexperts.com";
export const RM_SITE_URL = "https://retirementmortgagexperts.com";
export const LANDING_SCHEMA_VERSION = "2026-10-07";

export const LANDING_THEMES = ["theme-1", "theme-light", "theme-custom"] as const;
export type LandingTheme = (typeof LANDING_THEMES)[number];

export const LANDING_THEME_LABELS: Record<LandingTheme, string> = {
  "theme-1": "Dark",
  "theme-light": "Light",
  "theme-custom": "Dark with your color",
};

export const DEMO_SLUGS = ["demo-lo", "demo-light", "demo-custom"] as const;
export const RM_DEMO_SLUGS = ["demo-specialist", "demo-brand", "demo-company", "demo-evergreen"] as const;

/** Matches scripts/build-clients.mjs RESERVED_SLUGS in dscr-experts. */
export const RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "audits",
  "brand_assets",
  "clients",
  "docs",
  "guides",
  "index",
  "node_modules",
  "privacy",
  "robots",
  "scripts",
  "sitemap",
  "sms-terms",
  "themes",
]);

/** Host paths on retirementmortgagexperts.com. Client folders are not in this set. */
export const RM_RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "audits",
  "brand_assets",
  "clients",
  "compare",
  "docs",
  "faq",
  "for-families",
  "get-started",
  "guides",
  "how-the-process-works",
  "index",
  "mockups",
  "myths",
  "node_modules",
  "privacy",
  "resources",
  "robots",
  "scripts",
  "sitemap",
  "sms-terms",
  "team",
  "texas-consumer-complaint-and-recovery-fund-notice",
  "themes",
  "why-us",
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const DEFAULT_TAGLINE = "DSCR refinance for rental investors";
export const RM_STOCK_HERO =
  "Turn the equity in your home into retirement cash flow — *without selling.*";
export const HERO_HEADLINE_MAX = 80;

const REPOS: Record<LandingProduct, { env: string; fallback: string; site: string }> = {
  DSCR: { env: "LANDING_DSCR_GITHUB_REPO", fallback: DSCR_GITHUB_REPO, site: DSCR_SITE_URL },
  RM: { env: "LANDING_RM_GITHUB_REPO", fallback: RM_GITHUB_REPO, site: RM_SITE_URL },
};

export function landingProductFor(reportingType: string | null | undefined): LandingProduct | null {
  if (reportingType === "DSCR" || reportingType === "RM") return reportingType;
  return null;
}

export function landingRepo(product: LandingProduct): string {
  const profile = REPOS[product];
  return process.env[profile.env]?.trim() || profile.fallback;
}

export function landingSiteUrl(product: LandingProduct): string {
  return REPOS[product].site;
}

export function landingSiteLabel(product: LandingProduct): string {
  return landingSiteUrl(product).replace(/^https:\/\//, "");
}

export function landingPageUrl(product: LandingProduct, slug: string): string {
  return `${landingSiteUrl(product)}/${slug}/`;
}

export function thankYouPageUrl(product: LandingProduct, slug: string): string {
  return `${landingSiteUrl(product)}/${slug}/thank-you`;
}

export function reservedSlugs(product: LandingProduct): ReadonlySet<string> {
  return product === "RM" ? RM_RESERVED_SLUGS : RESERVED_SLUGS;
}

export function demoSlugs(product: LandingProduct): readonly string[] {
  return product === "RM" ? RM_DEMO_SLUGS : DEMO_SLUGS;
}

export function yamlPath(slug: string): string {
  return `clients/${slug}.yaml`;
}

export function headshotPath(slug: string, ext: "png" | "jpg" | "jpeg" | "webp"): string {
  return `brand_assets/clients/${slug}/headshot.${ext}`;
}

export function logoPath(slug: string, ext: "png" | "jpg" | "jpeg" | "webp"): string {
  return `brand_assets/clients/${slug}/logo.${ext}`;
}
