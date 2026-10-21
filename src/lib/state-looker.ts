import { normalizeReportingType } from '@/lib/kpi-layouts';
import { REPORTING_TYPE_META } from '@/lib/reporting-types';
import { normalizeStatesLicensed } from '@/lib/us-states';

export type StateLookerClient = {
  id: string;
  name: string;
  reporting_type: string | null;
  sales_package: string | null;
  states_licensed: string[];
  lifecycle_status: string | null;
  is_live: boolean;
  account_display_name: string | null;
  /** Company / brand (legal business name). Shown separately from brokerage. */
  company_name: string | null;
  brokerage_name: string | null;
  nmls: string | null;
  live_transfer_approved: boolean;
  phone_live_transfer: string | null;
  offer_summary: string | null;
  /** Resolved blurb: custom offer_summary, else vertical default description. */
  offer_blurb: string;
  website: string | null;
  city: string | null;
  state: string | null;
  /** Openable GHL subaccount URL (stored URL or built from location id). */
  ghl_subaccount_url: string | null;
  /** Media buying ops fields */
  facebook_page_name: string | null;
  instagram_handle: string | null;
  ad_account_name: string | null;
  ad_account_url: string | null;
  /** Personal website is `website`; built lander / Perspective / TY below. */
  funnel_url: string | null;
  landing_page_url: string | null;
  thank_you_page_url: string | null;
  second_landing_page_url: string | null;
  /** Operating budget on the client file. Shown on the Media Buying directory. */
  daily_adspend: number | null;
};

export type StateLookerResult = {
  clients: StateLookerClient[];
  by_state: Record<string, string[]>;
  summary: {
    total_clients: number;
    states_covered: number;
  };
  can_view_revenue?: boolean;
};

export type RawStateLookerClientRow = {
  id: string;
  name: string;
  reporting_type: string | null;
  sales_package: string | null;
  states_licensed: string[] | null;
  lifecycle_status: string | null;
  is_live: boolean | null;
  account_group_id: string | null;
  legal_business_name?: string | null;
  brokerage_name?: string | null;
  nmls?: string | null;
  live_transfer_approved?: boolean | null;
  phone_live_transfer?: string | null;
  offer_summary?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  ghl_subaccount_url?: string | null;
  ghl_location_id?: string | null;
  facebook_page_name?: string | null;
  instagram_handle?: string | null;
  ad_account_name?: string | null;
  ad_account_url?: string | null;
  funnel_url?: string | null;
  landing_page_url?: string | null;
  thank_you_page_url?: string | null;
  second_landing_page_url?: string | null;
  daily_adspend?: number | string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const t = typeof value === 'string' ? value.trim() : '';
  return t || null;
}

/** Prefer stored subaccount URL; else build from GHL location id. */
export function resolveGhlSubaccountUrl(
  url: string | null | undefined,
  locationId: string | null | undefined,
): string | null {
  const stored = trimOrNull(url);
  if (stored) {
    if (/^https?:\/\//i.test(stored)) return stored;
    return `https://${stored}`;
  }
  const loc = trimOrNull(locationId);
  if (!loc) return null;
  return `https://app.gohighlevel.com/v2/location/${loc}`;
}

/** Prefer legal business name; fall back to account/LO display name for company. */
export function resolveCompanyName(
  legalBusinessName: string | null | undefined,
  accountDisplayName: string | null | undefined,
): string | null {
  return trimOrNull(legalBusinessName) ?? trimOrNull(accountDisplayName);
}

export function resolveOfferBlurb(
  offerSummary: string | null | undefined,
  reportingType: string | null | undefined,
): string {
  const custom = trimOrNull(offerSummary);
  if (custom) return custom;
  return REPORTING_TYPE_META[normalizeReportingType(reportingType)].description;
}

/** Coerce a client daily_adspend into a finite number, or null when unset. */
export function finiteDailyAdspend(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Sum of daily adspend budgets, plus how many listed clients have none. */
export function rollupDailyAdspend(
  clients: { daily_adspend: number | null }[],
): { total: number; withBudget: number; missing: number } {
  let total = 0;
  let withBudget = 0;
  let missing = 0;
  for (const client of clients) {
    const amount = finiteDailyAdspend(client.daily_adspend);
    if (amount == null) {
      missing += 1;
      continue;
    }
    total += amount;
    withBudget += 1;
  }
  return { total, withBudget, missing };
}

export function buildStateLookerResult(
  rows: RawStateLookerClientRow[],
  accountGroups: Record<string, { display_name: string }>,
): StateLookerResult {
  const clients: StateLookerClient[] = rows.map(row => {
    const account_display_name = row.account_group_id
      ? accountGroups[row.account_group_id]?.display_name ?? null
      : null;
    const company_name = resolveCompanyName(row.legal_business_name, account_display_name);
    const brokerage_name = trimOrNull(row.brokerage_name);
    // Avoid duplicating the same string under Company and Brokerage.
    const brokerageDistinct =
      brokerage_name &&
      company_name &&
      brokerage_name.toLowerCase() === company_name.toLowerCase()
        ? null
        : brokerage_name;

    return {
      id: row.id,
      name: row.name,
      reporting_type: row.reporting_type,
      sales_package: row.sales_package,
      states_licensed: normalizeStatesLicensed(row.states_licensed) ?? [],
      lifecycle_status: row.lifecycle_status,
      is_live: row.is_live === true,
      account_display_name,
      company_name,
      brokerage_name: brokerageDistinct,
      nmls: trimOrNull(row.nmls),
      live_transfer_approved: row.live_transfer_approved === true,
      phone_live_transfer: trimOrNull(row.phone_live_transfer),
      offer_summary: trimOrNull(row.offer_summary),
      offer_blurb: resolveOfferBlurb(row.offer_summary, row.reporting_type),
      website: trimOrNull(row.website),
      city: trimOrNull(row.city),
      state: trimOrNull(row.state),
      ghl_subaccount_url: resolveGhlSubaccountUrl(row.ghl_subaccount_url, row.ghl_location_id),
      facebook_page_name: trimOrNull(row.facebook_page_name),
      instagram_handle: trimOrNull(row.instagram_handle),
      ad_account_name: trimOrNull(row.ad_account_name),
      ad_account_url: trimOrNull(row.ad_account_url),
      funnel_url: trimOrNull(row.funnel_url),
      landing_page_url: trimOrNull(row.landing_page_url),
      thank_you_page_url: trimOrNull(row.thank_you_page_url),
      second_landing_page_url: trimOrNull(row.second_landing_page_url),
      daily_adspend: finiteDailyAdspend(row.daily_adspend),
    };
  });

  const by_state: Record<string, string[]> = {};
  for (const client of clients) {
    for (const code of client.states_licensed) {
      if (!by_state[code]) by_state[code] = [];
      by_state[code].push(client.id);
    }
  }

  for (const code of Object.keys(by_state)) {
    by_state[code].sort();
  }

  const states_covered = Object.keys(by_state).length;

  return {
    clients,
    by_state,
    summary: {
      total_clients: clients.length,
      states_covered,
    },
  };
}
