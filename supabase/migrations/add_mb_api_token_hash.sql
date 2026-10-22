-- Media-buyer Cursor API: user-scoped Bearer token (hashed). Plaintext never stored.
-- Issue via: npx tsx scripts/issue-mb-api-token.ts --email user@…
-- Separate from profiles.csm_api_token_hash. A CSM token cannot call /api/mb.

alter table profiles
  add column if not exists mb_api_token_hash text;

create unique index if not exists profiles_mb_api_token_hash_uidx
  on profiles (mb_api_token_hash)
  where mb_api_token_hash is not null;

comment on column profiles.mb_api_token_hash is
  'SHA-256 hex of media-buyer brief API Bearer token for Cursor; null = no token issued';
