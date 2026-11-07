import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission } from '@/lib/api-auth';
import { attachPersonItem } from '@/lib/person-store';
import { plusItem, type PlusItemKey } from '@/lib/person-profile';

const FILE_MAX_BYTES = 20 * 1024 * 1024;

async function readItem(req: Request): Promise<{
  key: PlusItemKey;
  value: string | string[] | null;
  file: { fileName: string; contentType: string; bytes: Buffer } | null;
}> {
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const key = String(form.get('key') ?? '');
    const item = plusItem(key);
    if (!item) throw new Error('Unknown profile item');
    const uploaded = form.get('file');
    if (uploaded instanceof File && uploaded.size > 0) {
      if (uploaded.size > FILE_MAX_BYTES) throw new Error('File is too large (max 20MB)');
      return {
        key: item.key,
        value: null,
        file: {
          fileName: uploaded.name || item.label,
          contentType: uploaded.type || 'application/octet-stream',
          bytes: Buffer.from(await uploaded.arrayBuffer()),
        },
      };
    }
    const raw = form.get('value');
    if (item.key === 'states_licensed' && typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return { key: item.key, value: Array.isArray(parsed) ? parsed.map(String) : [], file: null };
      } catch {
        return { key: item.key, value: [], file: null };
      }
    }
    return { key: item.key, value: typeof raw === 'string' ? raw : null, file: null };
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new Error('Invalid JSON body');
  const key = typeof body.key === 'string' ? body.key : '';
  const item = plusItem(key);
  if (!item) throw new Error('Unknown profile item');
  if (item.key === 'states_licensed') {
    return { key: item.key, value: Array.isArray(body.value) ? body.value.map(String) : [], file: null };
  }
  return {
    key: item.key,
    value: typeof body.value === 'string' ? body.value : null,
    file: null,
  };
}

// POST one chosen item onto this person. Headshot and File are multipart.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, ['admin_clients', 'admin_billing']);
  if (denied) return denied;

  const { id: clientId, contactId } = await params;
  try {
    const item = await readItem(req);
    const contact = await attachPersonItem(ctx.service, clientId, contactId, item, ctx.userId);
    return NextResponse.json({ contact });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
