const PIXEL_ID_RE = /^[0-9]{5,32}$/;

export const PIXEL_SELECT = 'id, name, pixel_id, test_event_code, updated_at';

type PixelBody = {
  name?: unknown;
  pixel_id?: unknown;
  pixelId?: unknown;
  access_token?: unknown;
  accessToken?: unknown;
  test_event_code?: unknown;
  testEventCode?: unknown;
};

export type PixelWrite = {
  name: string;
  pixel_id: string;
  access_token: string | null;
  test_event_code: string | null;
};

export function parsePixelWrite(body: PixelBody, options: { tokenRequired: boolean }): PixelWrite | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const pixelId = String(body.pixel_id ?? body.pixelId ?? '').trim();
  const tokenRaw = body.access_token ?? body.accessToken;
  const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
  const testRaw = body.test_event_code ?? body.testEventCode;
  const testCode = typeof testRaw === 'string' ? testRaw.trim() : '';

  if (!name || name.length > 120) return { error: 'Name is required (120 characters max).' };
  if (!PIXEL_ID_RE.test(pixelId)) return { error: 'Pixel ID must be the numeric ID from Events Manager.' };
  if (options.tokenRequired && token.length < 20) return { error: 'Paste the Conversions API access token.' };
  if (!options.tokenRequired && token && token.length < 20) return { error: 'That access token is too short.' };
  if (testCode && !/^[A-Za-z0-9_-]{1,64}$/.test(testCode)) {
    return { error: 'Test event code should be the code from Events Manager, or left blank.' };
  }

  return {
    name,
    pixel_id: pixelId,
    access_token: token || null,
    test_event_code: testCode || null,
  };
}

export type PixelRow = {
  id: string;
  name: string;
  pixel_id: string;
  test_event_code: string | null;
  updated_at: string;
};

export function toPublicPixel(row: PixelRow) {
  return {
    id: row.id,
    name: row.name,
    pixel_id: row.pixel_id,
    has_token: true,
    test_event_code: row.test_event_code,
    updated_at: row.updated_at,
  };
}
