import type { LandingProduct } from "./products";

type VercelRedirect = {
  source: string;
  destination: string;
  permanent?: boolean;
};

type VercelConfig = {
  redirects?: VercelRedirect[];
  [key: string]: unknown;
};

/** Paths Vercel reads before build — YAML-only PRs leave these stale. */
export function redirectManifestPath(product: LandingProduct): string {
  return product === "DSCR"
    ? "scripts/generated-factory-redirects.json"
    : "scripts/generated-redirects.json";
}

export function applyRedirectSources(slug: string): string[] {
  return [`/${slug}/apply`, `/${slug}/apply.html`];
}

/** Upsert this slug's quiz redirects; leave every other route alone. */
export function patchVercelApplyRedirects(
  raw: string,
  slug: string,
  applyUrl: string,
): string {
  const vercel = JSON.parse(raw) as VercelConfig;
  const drop = new Set(applyRedirectSources(slug));
  const keep = (vercel.redirects ?? []).filter(row => !drop.has(row.source));
  vercel.redirects = [
    ...keep,
    ...[...drop].map(source => ({
      source,
      destination: applyUrl,
      permanent: false,
    })),
  ];
  return `${JSON.stringify(vercel, null, 2)}\n`;
}

export function patchRedirectManifest(
  raw: string | null,
  slug: string,
  applyUrl: string,
): string {
  const map =
    raw && raw.trim()
      ? (JSON.parse(raw) as Record<string, string>)
      : ({} as Record<string, string>);
  for (const source of applyRedirectSources(slug)) {
    map[source] = applyUrl;
  }
  return `${JSON.stringify(map, null, 2)}\n`;
}
