import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { letterIsOpen, PRIVATE_HEADERS, PRIVATE_LINK_HTML } from '../../../../../offer-letters/gate';
import { offerLetters } from '../../../../../offer-letters/registry';

export const dynamic = 'force-dynamic';

function wall() {
  return new Response(PRIVATE_LINK_HTML, { status: 404, headers: PRIVATE_HEADERS });
}

function withPrivacyHead(html: string): string {
  const tags =
    '<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="no-referrer">';
  if (html.includes('<head>')) return html.replace('<head>', `<head>\n${tags}\n`);
  return tags + html;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; token: string }> },
) {
  const { slug, token } = await params;
  if (!letterIsOpen(slug, token)) return wall();

  const letter = offerLetters[slug];
  const sheetsDir = path.join(process.cwd(), 'offer-letters', 'sheets');
  const filePath = path.resolve(sheetsDir, letter.file);
  if (!filePath.startsWith(sheetsDir + path.sep)) return wall();

  let html: string;
  try {
    html = await readFile(filePath, 'utf8');
  } catch {
    return wall();
  }

  return new Response(withPrivacyHead(html), {
    status: 200,
    headers: PRIVATE_HEADERS,
  });
}
