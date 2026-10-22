import { createHash, randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from './supabase';
import { getAuthContext, isAuthError, type AuthContext } from './api-auth';
import { hasPermission } from './permissions';

/** SHA-256 hex of the plaintext Bearer token. */
export function hashMbApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateMbApiToken(): string {
  return `mb_${randomBytes(32).toString('base64url')}`;
}

export function mbJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

/**
 * Auth for /api/mb/* —
 * 1) Authorization: Bearer <mb_…> matched to profiles.mb_api_token_hash
 * 2) else a normal session cookie
 *
 * A CSM token (csm_…) is ignored here and falls through to the session check.
 */
export async function getMbAuthContext(req: Request): Promise<AuthContext | NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith('mb_') && token.length > 20) {
      const hash = hashMbApiToken(token);
      const service = createServiceClient();
      const { data: profile, error } = await service
        .from('profiles')
        .select('id, is_owner, is_admin, allowed_permissions')
        .eq('mb_api_token_hash', hash)
        .maybeSingle();

      if (error) {
        return mbJson({ error: 'Auth lookup failed' }, 500);
      }
      if (!profile) {
        return mbJson({ error: 'Unauthorized' }, 401);
      }

      return {
        userId: profile.id,
        isOwner: profile.is_owner ?? false,
        isAdmin: profile.is_admin ?? false,
        allowedPermissions: (profile.allowed_permissions ?? null) as AuthContext['allowedPermissions'],
        service,
      };
    }
  }

  return getAuthContext();
}

/** Media-buyer seat. Owners pass. client_health alone does not. */
export function requireMbApiAccess(ctx: AuthContext): NextResponse | null {
  const subject = {
    isOwner: ctx.isOwner,
    allowedPermissions: ctx.allowedPermissions,
  };
  if (hasPermission('media_buyer', subject)) return null;
  return mbJson(
    { error: 'Forbidden', detail: 'Needs media_buyer for the media-buyer API' },
    403,
  );
}

export function assertMbAuth(ctx: AuthContext | NextResponse): ctx is AuthContext {
  return !isAuthError(ctx);
}

export async function authorizeMb(req: NextRequest): Promise<AuthContext | NextResponse> {
  const ctx = await getMbAuthContext(req);
  if (!assertMbAuth(ctx)) return ctx;
  const denied = requireMbApiAccess(ctx);
  if (denied) return denied;
  return ctx;
}

export function mbError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Request failed';
  const statusFromErr =
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
      ? err.status
      : null;
  const status =
    statusFromErr ??
    (/required|YYYY-MM-DD|kind must|limit must|offset must/.test(message)
      ? 400
      : /not found/i.test(message)
        ? 404
        : 500);
  return mbJson({ error: message }, status);
}
