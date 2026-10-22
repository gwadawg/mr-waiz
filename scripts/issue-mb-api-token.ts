/**
 * Issue or revoke a media-buyer brief API Bearer token for a Mr. Waiz user.
 *
 *   npx tsx scripts/issue-mb-api-token.ts --email buyer@example.com
 *   npx tsx scripts/issue-mb-api-token.ts --user-id <uuid>
 *   npx tsx scripts/issue-mb-api-token.ts --email buyer@example.com --revoke
 *
 * Prints the plaintext token once. Store it in the media-buyer kit `.env.local`
 * as MB_API_TOKEN. Requires migration add_mb_api_token_hash.sql applied.
 * Does not touch profiles.csm_api_token_hash.
 */
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '../.env.local');
  const raw = readFileSync(envPath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function generateToken(): string {
  return `mb_${randomBytes(32).toString('base64url')}`;
}

async function resolveUserId(
  service: ReturnType<typeof createClient>,
  email: string | null,
  userId: string | null,
): Promise<string> {
  if (userId) return userId;
  if (!email) throw new Error('Pass --email or --user-id');

  const target = email.toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find(u => (u.email || '').toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  throw new Error(`No auth user with email ${email}`);
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const service = createClient(url, key, { auth: { persistSession: false } });
  const email = arg('--email');
  const userIdArg = arg('--user-id');
  const revoke = hasFlag('--revoke');

  const userId = await resolveUserId(service, email, userIdArg);

  if (revoke) {
    const { error } = await service
      .from('profiles')
      .update({ mb_api_token_hash: null })
      .eq('id', userId);
    if (error) throw error;
    console.log(`Revoked media-buyer API token for user ${userId}`);
    return;
  }

  const token = generateToken();
  const hash = hashToken(token);
  const { error } = await service
    .from('profiles')
    .update({ mb_api_token_hash: hash })
    .eq('id', userId);
  if (error) throw error;

  console.log('Media-buyer API token issued (shown once — store as MB_API_TOKEN):\n');
  console.log(token);
  console.log(`\nuser_id=${userId}`);
  console.log('Grant this user media_buyer only. Do not grant a dashboard login, CEO, billing, payroll, or view_client_revenue.');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
