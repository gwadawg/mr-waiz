import { normalizeReportingType, usesCallCenterKpiLayout } from '@/lib/reporting-types';

/**
 * Lead pool for hand-raise % and conversation % on paid-ads clients.
 * Call center keeps its own formulas, so this returns null there.
 * Checked (`qualifies_leads`) = qualified leads. Unchecked = every lead.
 * Unset follows the product default: reverse checked, DSCR unchecked.
 */
export type DialPool = 'qualified' | 'all';

export function defaultQualifiesLeads(reportingType: unknown): boolean | null {
  if (usesCallCenterKpiLayout(reportingType)) return null;
  return normalizeReportingType(reportingType) === 'DSCR' ? false : true;
}

export function dialPoolForClient(
  reportingType: unknown,
  qualifiesLeads: boolean | null | undefined,
): DialPool | null {
  if (usesCallCenterKpiLayout(reportingType)) return null;
  if (qualifiesLeads === true) return 'qualified';
  if (qualifiesLeads === false) return 'all';
  return defaultQualifiesLeads(reportingType) === false ? 'all' : 'qualified';
}

type PoolMetrics = {
  hand_raise_rate: number;
  conversation_rate: number;
  unique_hand_raises: number;
  unique_conversations: number;
  new_leads: number;
};

/** Rewrite the two rates when this client books every lead. Other metrics stay put. */
export function withDialPoolRates<T extends PoolMetrics>(metrics: T, pool: DialPool | null): T {
  if (pool !== 'all') return metrics;
  const leads = metrics.new_leads;
  return {
    ...metrics,
    hand_raise_rate: leads > 0 ? (metrics.unique_hand_raises / leads) * 100 : 0,
    conversation_rate: leads > 0 ? (metrics.unique_conversations / leads) * 100 : 0,
  };
}

export function dialPoolRate(
  numerator: number,
  qualified: number,
  leads: number,
  pool: DialPool | null,
): number | null {
  const denom = pool === 'all' ? leads : qualified;
  return denom > 0 ? (numerator / denom) * 100 : null;
}

const HAND_RAISE_ALL_LEADS =
  'Unique leads with booked, claimed, or live transfer ÷ Total Leads. One lead counted once. This client is booked on every lead.';
const CONVERSATION_ALL_LEADS =
  'Unique leads with show, claimed, or live transfer ÷ Total Leads. This client is booked on every lead.';

export function hintForDialPool(
  metric: string,
  hint: string | undefined,
  pool: DialPool | null | undefined,
): string | undefined {
  if (pool !== 'all') return hint;
  if (metric === 'hand_raise_rate') return HAND_RAISE_ALL_LEADS;
  if (metric === 'conversation_rate') return CONVERSATION_ALL_LEADS;
  return hint;
}
