import { groupLandingSites, type LandingSiteRow } from '@/lib/landing-page/sites';

/**
 * Apex funnel URL from a published landing page: `{site}/{slug}/`.
 * That same string is what landing publish writes onto `clients.landing_page_url`.
 * This helper only reads it. It does not write `funnel_url` or any new column.
 */
export function creativeApexFunnelLink(
  rows: LandingSiteRow[],
  landingPageUrl?: string | null,
): string | null {
  const sites = groupLandingSites(rows).filter(site => site.landingPageUrl);
  if (sites.length === 0) return null;
  const current = (landingPageUrl ?? '').trim().replace(/\/+$/, '');
  const match = current
    ? sites.find(site => site.landingPageUrl!.trim().replace(/\/+$/, '') === current)
    : undefined;
  return (match ?? sites[0]).landingPageUrl;
}
