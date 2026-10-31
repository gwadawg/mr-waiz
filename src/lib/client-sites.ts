/** Shared labels + helpers for client website / funnel URLs. */

export type ClientSiteKey = 'personal' | 'landing' | 'perspective' | 'thank_you';

export const CLIENT_SITE_DEFS: {
  key: ClientSiteKey;
  label: string;
  short: string;
}[] = [
  { key: 'personal', label: 'Personal website', short: 'Personal' },
  { key: 'landing', label: 'Perspective funnel link', short: 'Landing' },
  { key: 'perspective', label: 'WM Apex Funnel', short: 'Apex' },
  { key: 'thank_you', label: 'Thank-you page', short: 'TY' },
];

export type ClientSiteUrls = {
  website?: string | null;
  landing_page_url?: string | null;
  funnel_url?: string | null;
  thank_you_page_url?: string | null;
};

export function siteUrlForKey(key: ClientSiteKey, urls: ClientSiteUrls): string | null {
  const raw =
    key === 'personal'
      ? urls.website
      : key === 'landing'
        ? urls.landing_page_url
        : key === 'perspective'
          ? urls.funnel_url
          : urls.thank_you_page_url;
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t || null;
}

export function hrefForSiteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export function clientSiteEntries(urls: ClientSiteUrls): {
  key: ClientSiteKey;
  label: string;
  short: string;
  url: string | null;
}[] {
  return CLIENT_SITE_DEFS.map(d => ({
    ...d,
    url: siteUrlForKey(d.key, urls),
  }));
}
