import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withBrandFavicon } from '@/lib/brand-favicon';
import { letterIsOpen, PRIVATE_HEADERS, PRIVATE_LINK_HTML } from '../../../../../offer-letters/gate';
import { offerLetters } from '../../../../../offer-letters/registry';

export const dynamic = 'force-dynamic';

function wall(request: Request) {
  const html = withBrandFavicon(
    PRIVATE_LINK_HTML,
    request.headers.get('x-forwarded-host'),
    request.headers.get('host'),
  );
  return new Response(html, { status: 404, headers: PRIVATE_HEADERS });
}

function withPrivacyHead(html: string): string {
  const tags =
    '<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="no-referrer">';
  if (html.includes('<head>')) return html.replace('<head>', `<head>\n${tags}\n`);
  return tags + html;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; token: string }> },
) {
  const { slug, token } = await params;
  const letter = offerLetters[slug];
  if (!letter || !letterIsOpen(slug, token)) return wall(request);
  const sheetsDir = path.join(process.cwd(), 'offer-letters', 'sheets');
  const filePath = path.resolve(sheetsDir, letter.file);
  if (!filePath.startsWith(sheetsDir + path.sep)) return wall(request);

  let html: string;
  try {
    html = await readFile(filePath, 'utf8');
  } catch {
    return wall(request);
  }

  html = withBrandFavicon(
    withPrivacyHead(html),
    request.headers.get('x-forwarded-host'),
    request.headers.get('host'),
  );

  return new Response(html, {
    status: 200,
    headers: PRIVATE_HEADERS,
  });
}
