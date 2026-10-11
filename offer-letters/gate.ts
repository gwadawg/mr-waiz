import { OFFER_LETTER_HOSTS, offerLetters } from './registry';

export const PRIVATE_LINK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Private link</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#061A4A;color:#fff;font-family:Georgia,serif;text-align:center;padding:24px">
<p style="max-width:28rem;line-height:1.5;font-size:18px">This offer link is private. Ask Waiz Media for the current link.</p>
</body>
</html>`;

export const PRIVATE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function offerLetterHost(hostHeader: string | null): string {
  if (!hostHeader) return '';
  return hostHeader.split(':')[0]?.toLowerCase() ?? '';
}

export function isOfferLetterHost(hostHeader: string | null): boolean {
  return OFFER_LETTER_HOSTS.has(offerLetterHost(hostHeader));
}

export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `/{slug}/{token}` on the offer host. Anything else is not a sheet. */
export function parseOfferLetterPath(pathname: string): { slug: string; token: string } | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== '') return null;
  let slug = '';
  let token = '';
  try {
    slug = decodeURIComponent(parts[1] ?? '');
    token = decodeURIComponent(parts[2] ?? '');
  } catch {
    return null;
  }
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[a-f0-9]{32}$/.test(token)) return null;
  return { slug, token };
}

export function letterIsOpen(slug: string, token: string): boolean {
  const letter = offerLetters[slug];
  if (!letter) return false;
  return tokensMatch(token, letter.token);
}

export type OfferLetterDecision =
  | { kind: 'ignore' }
  | { kind: 'wall' }
  | { kind: 'serve'; slug: string; token: string };

export function decideOfferLetterRequest(hostHeader: string | null, pathname: string): OfferLetterDecision {
  if (!isOfferLetterHost(hostHeader)) return { kind: 'ignore' };
  const parsed = parseOfferLetterPath(pathname);
  if (!parsed || !letterIsOpen(parsed.slug, parsed.token)) return { kind: 'wall' };
  return { kind: 'serve', slug: parsed.slug, token: parsed.token };
}
