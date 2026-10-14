import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAutomationsAccess } from '@/lib/api-auth';
import { PIXEL_SELECT, parsePixelWrite, toPublicPixel, type PixelRow } from '../pixel-http';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAutomationsAccess(ctx);
  if (denied) return denied;

  const { id } = await params;
  const parsed = parsePixelWrite(await req.json(), { tokenRequired: false });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updates: Record<string, unknown> = {
    name: parsed.name,
    pixel_id: parsed.pixel_id,
    test_event_code: parsed.test_event_code,
    updated_at: new Date().toISOString(),
  };
  if (parsed.access_token) updates.access_token = parsed.access_token;

  const { data, error } = await ctx.service
    .from('meta_pixels')
    .update(updates)
    .eq('id', id)
    .select(PIXEL_SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Pixel not found.' }, { status: 404 });

  const { data: clients, error: clientsError } = await ctx.service
    .from('clients')
    .select('name')
    .eq('meta_pixel_id', id)
    .order('name');
  if (clientsError) return NextResponse.json({ error: clientsError.message }, { status: 500 });

  return NextResponse.json({
    pixel: {
      ...toPublicPixel(data as PixelRow),
      client_names: ((clients ?? []) as { name: string }[]).map(client => client.name),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAutomationsAccess(ctx);
  if (denied) return denied;

  const { id } = await params;
  const { error } = await ctx.service.from('meta_pixels').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
