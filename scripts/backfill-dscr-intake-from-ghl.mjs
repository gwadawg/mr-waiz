/**
 * Backfill Credit Score Range and Property Use onto historical DSCR `lead`
 * events by reading each contact's custom fields from GHL.
 *
 * Writes only `events.raw.credit_score_range` / `events.raw.property_use`
 * (merged into the existing raw). Never overwrites a value already present.
 * Dry run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/backfill-dscr-intake-from-ghl.mjs --client "Client Name" --token-env GHL_PIT_CLIENT [--apply] [--limit 50]
 *
 *   --client      clients.name (must have reporting_type = DSCR)
 *   --token-env   .env.local variable holding that sub-account's PIT
 *   --limit       max lead events to look at (default: all)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabaseRequest, fetchAll } from './lib/supabase-rest.mjs';
import { createGhlClient, ghlCustomField } from './lib/ghl-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes('--apply');
const CLIENT = arg('--client');
const TOKEN_ENV = arg('--token-env');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity;

if (!CLIENT || !TOKEN_ENV) {
  console.error('Usage: --client "Client Name" --token-env GHL_PIT_VAR [--apply] [--limit N]');
  process.exit(1);
}

const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

const clients = await fetchAll(
  `/rest/v1/clients?select=id,name,reporting_type,ghl_location_id&name=eq.${encodeURIComponent(CLIENT)}`,
);
const client = clients[0];
if (!client) throw new Error(`No client named "${CLIENT}"`);
if (String(client.reporting_type).toUpperCase() !== 'DSCR') {
  throw new Error(`${client.name} is ${client.reporting_type}, not DSCR. Refusing to run.`);
}
if (!client.ghl_location_id) throw new Error(`${client.name} has no ghl_location_id`);

const ghl = createGhlClient(env[TOKEN_ENV]);
const events = await fetchAll(
  `/rest/v1/events?select=id,ghl_contact_id,raw&client_id=eq.${client.id}&event_type=eq.lead&ghl_contact_id=not.is.null&order=occurred_at.desc`,
);

let looked = 0;
let wouldWrite = 0;
let written = 0;
let noData = 0;
let failed = 0;

for (const ev of events) {
  if (looked >= LIMIT) break;
  const raw = ev.raw && typeof ev.raw === 'object' && !Array.isArray(ev.raw) ? ev.raw : {};
  const needFico = blank(raw.credit_score_range);
  const needUse = blank(raw.property_use);
  if (!needFico && !needUse) continue;
  if (String(ev.ghl_contact_id).startsWith('ldr:')) continue;
  looked++;

  let contact;
  try {
    const res = await ghl.getContact(ev.ghl_contact_id, client.ghl_location_id);
    contact = res?.contact ?? res;
  } catch (e) {
    failed++;
    console.warn(`  ${ev.ghl_contact_id}: ${e.message}`);
    continue;
  }

  const patch = {};
  if (needFico) {
    const v = ghlCustomField(contact, 'credit score range', 'credit score', 'fico');
    if (v) patch.credit_score_range = v;
  }
  if (needUse) {
    const v = ghlCustomField(contact, 'property use', 'occupancy');
    if (v) patch.property_use = v;
  }
  if (Object.keys(patch).length === 0) {
    noData++;
    continue;
  }

  wouldWrite++;
  if (!APPLY) {
    console.log(`  [dry] ${ev.id} ${JSON.stringify(patch)}`);
    continue;
  }
  const { status, data } = await supabaseRequest(
    'PATCH',
    `/rest/v1/events?id=eq.${ev.id}`,
    { raw: { ...raw, ...patch } },
    { Prefer: 'return=minimal' },
  );
  if (status >= 300) {
    failed++;
    console.warn(`  ${ev.id}: PATCH ${status} ${data}`);
  } else {
    written++;
  }
}

console.log(
  `${APPLY ? 'APPLIED' : 'DRY RUN'} ${client.name}: looked ${looked}, ` +
    `${APPLY ? `wrote ${written}` : `would write ${wouldWrite}`}, ` +
    `no GHL data ${noData}, failed ${failed}`,
);
