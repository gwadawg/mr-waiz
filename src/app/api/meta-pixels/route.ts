import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAutomationsAccess } from '@/lib/api-auth';
import { PIXEL_SELECT, parsePixelWrite, toPublicPixel, type PixelRow } from './pixel-http';

type ClientRoute = { id: string; name: string; meta_pixel_id: string | null };

// GET /api/meta-pixels — pixels without tokens, which clients use each one, and recent sends.
export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAutomationsAccess(ctx);
  if (denied) return denied;

  const [pixelsRes, clientsRes, sendsRes] = await Promise.all([
    ctx.service.from('meta_pixels').select(PIXEL_SELECT).order('name'),
    ctx.service.from('clients').select('id, name, meta_pixel_id').order('name'),
    ctx.service
      .from('meta_capi_sends')
      .select('id, client_id, event_name, status, error, created_at, sent_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  if (pixelsRes.error) return NextResponse.json({ error: pixelsRes.error.message }, { status: 500 });
  if (clientsRes.error) return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });
  if (sendsRes.error) return NextResponse.json({ error: sendsRes.error.message }, { status: 500 });

  const clientRows = (clientsRes.data ?? []) as ClientRoute[];
  const pixels = ((pixelsRes.data ?? []) as PixelRow[]).map(row => ({
    ...toPublicPixel(row),
    client_names: clientRows.filter(client => client.meta_pixel_id === row.id).map(client => client.name),
  }));

  return NextResponse.json({
    pixels,
    clients: clientRows.map(client => ({ id: client.id, name: client.name })),
    sends: sendsRes.data ?? [],
  });
}

// POST /api/meta-pixels — add a shared pixel. Clients choose it on their file.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAutomationsAccess(ctx);
  if (denied) return denied;

  const parsed = parsePixelWrite(await req.json(), { tokenRequired: true });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await ctx.service
    .from('meta_pixels')
    .insert({
      name: parsed.name,
      pixel_id: parsed.pixel_id,
      access_token: parsed.access_token,
      test_event_code: parsed.test_event_code,
      updated_at: now,
    })
    .select(PIXEL_SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ pixel: { ...toPublicPixel(data as PixelRow), client_names: [] } });
}
