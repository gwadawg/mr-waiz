/** Tab icon for the dashboard and offer-sheet hosts only. */
const BRAND_FAVICON_HOSTS = new Set([
  "os.waizmedia.net",
  "offerletter.waizmedia.net",
  "offersheet.waizmedia.net",
]);

export const BRAND_FAVICON_PATH = "/brand/waiz-mark.png";

export const BRAND_FAVICON_TAG =
  '<link rel="icon" href="/brand/waiz-mark.png" type="image/png" sizes="192x192">';

export function hostnameFromHeader(value: string | null | undefined): string {
  const first = value?.split(",")[0]?.trim() ?? "";
  return first.split(":")[0]?.toLowerCase() ?? "";
}

/** True when either proxy host header is the dashboard or an offer-sheet host. */
export function showsBrandFavicon(
  forwardedHost: string | null | undefined,
  host: string | null | undefined,
): boolean {
  return [forwardedHost, host].some((value) => BRAND_FAVICON_HOSTS.has(hostnameFromHeader(value)));
}

/** Insert the tab icon into a raw HTML document when the request host should show it. */
export function withBrandFavicon(
  html: string,
  forwardedHost: string | null | undefined,
  host: string | null | undefined,
): string {
  if (!showsBrandFavicon(forwardedHost, host) || html.includes(BRAND_FAVICON_PATH)) return html;
  if (html.includes("<head>")) return html.replace("<head>", `<head>\n${BRAND_FAVICON_TAG}\n`);
  return `${BRAND_FAVICON_TAG}\n${html}`;
}
