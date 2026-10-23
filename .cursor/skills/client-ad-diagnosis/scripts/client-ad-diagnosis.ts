/**
 * CLI for the client-ad-diagnosis skill.
 *
 *   npx tsx .cursor/skills/client-ad-diagnosis/scripts/client-ad-diagnosis.ts --client "Brian Thomas"
 *   ... --client <uuid> --start 2026-01-01 --end 2026-10-23
 *   ... --qualify-switch 2026-06-01 --qualify-before no
 *   ... --self-test
 *
 * Media buyers should use GET /api/mb/ad-diagnosis from wm-mb-kit instead.
 */
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  runClientAdDiagnosis,
  runClientAdDiagnosisSelfTest,
} from '../../../../src/lib/client-ad-diagnosis.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../../..');

function loadEnv(): Record<string, string> {
  return readFileSync(resolve(REPO, '.env.local'), 'utf-8')
    .split('\n')
    .filter((line) => line && !line.trim().startsWith('#'))
    .reduce((acc: Record<string, string>, line) => {
      const i = line.indexOf('=');
      if (i < 0) return acc;
      acc[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      return acc;
    }, {});
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runClientAdDiagnosisSelfTest();
    return;
  }

  const clientArg = arg('client');
  if (!clientArg) throw new Error('Pass --client "<name or id>"');

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');

  const before = arg('qualify-before');
  if (before && before !== 'yes' && before !== 'no') {
    throw new Error('--qualify-before must be yes or no');
  }

  const service = createClient(url, key, { auth: { persistSession: false } });
  const payload = await runClientAdDiagnosis(service, {
    client: clientArg,
    start: arg('start'),
    end: arg('end'),
    matureDays: arg('mature-days') ? Number(arg('mature-days')) : undefined,
    qualifySwitch: arg('qualify-switch'),
    qualifyBefore: before as 'yes' | 'no' | undefined,
    verbose: process.argv.includes('--verbose'),
  });

  const slug = payload.client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = resolve(tmpdir(), `client-ad-diagnosis_${slug}_${payload.window.end}.json`);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);

  const graded = payload.ads.filter((a: { evidence: { tier: string } }) => a.evidence.tier !== 'thin');
  console.log(`Wrote ${file}`);
  console.log(
    `${payload.client.name} · ${payload.client.product} · ${payload.client.tenure_days ?? '?'} days live` +
      `${payload.provisional ? ' (provisional)' : ''} · ${payload.window.start}..${payload.window.end} · ` +
      `back end on leads ≤ ${payload.window.backend_cutoff}`,
  );
  console.log(
    `${payload.ads.length} ads · ${graded.length} graded · spend $${payload.client_totals.paid.front.spend ?? 0} · ` +
      `leads ${payload.data_quality.leads_in_window} (${payload.data_quality.leads_without_ad} without ad) · ` +
      `rank stage ${payload.rank_stage ?? 'none'}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
