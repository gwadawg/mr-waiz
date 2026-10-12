/**
 * Lead intake fields read from a `lead` webhook payload (`events.raw`).
 *
 * Shared by both products: loan amount, property value, LTV, state.
 * RM only: B1 age, B2 age.
 * DSCR only: credit score range, property use.
 *
 * The product comes from `clients.reporting_type`, not from which fields are
 * filled in, so a DSCR lead with a blank field still gets the DSCR layout.
 */

export type LeadProduct = 'rm' | 'dscr';

export type PropertyUse = 'primary' | 'investment';

/** `clients.reporting_type` -> lead product. CALL_CENTER, HE, and unknown map to null. */
export function leadProductFor(reportingType: string | null | undefined): LeadProduct | null {
  const t = String(reportingType ?? '').trim().toUpperCase();
  if (t === 'RM') return 'rm';
  if (t === 'DSCR') return 'dscr';
  return null;
}

/** Pull first matching key from webhook `raw` jsonb. Skips null, boolean, and blank strings. */
export function pickRaw(raw: unknown, keys: string[]): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const k of keys) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v == null || typeof v === 'boolean') continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return null;
}

export function formatCurrencyCell(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    const n = Number(t.replace(/[^0-9.-]/g, ''));
    if (!Number.isNaN(n) && t !== '') {
      return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return t;
  }
  return String(v);
}

/** Parse a raw value into a number, or null. */
export function toNumber(v: unknown): number | null {
  if (v == null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const LOAN_AMOUNT_KEYS = [
  'loan_amount',
  'loanAmount',
  'mortgage_amount',
  'mortgageAmount',
  'requested_loan_amount',
];

const PROPERTY_VALUE_KEYS = [
  'property_value',
  'propertyValue',
  'home_value',
  'homeValue',
  'estimated_property_value',
  'property_estimated_value',
];

export function extractLoanAmount(raw: unknown): string | null {
  return formatCurrencyCell(pickRaw(raw, LOAN_AMOUNT_KEYS));
}

export function extractPropertyValue(raw: unknown): string | null {
  return formatCurrencyCell(pickRaw(raw, PROPERTY_VALUE_KEYS));
}

export function loanAmountNumber(raw: unknown): number | null {
  return toNumber(pickRaw(raw, LOAN_AMOUNT_KEYS));
}

export function propertyValueNumber(raw: unknown): number | null {
  return toNumber(pickRaw(raw, PROPERTY_VALUE_KEYS));
}

/** Whole-number LTV percent (loan / value), or null when either side is missing. */
export function extractLtv(raw: unknown): number | null {
  const loan = loanAmountNumber(raw);
  const property = propertyValueNumber(raw);
  if (loan == null || property == null || property <= 0) return null;
  return Math.round((loan / property) * 100);
}

/** Property state, as sent (usually a two-letter code). */
export function extractState(raw: unknown): string | null {
  const v = pickRaw(raw, ['state', 'property_state', 'propertyState']);
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Ages as whole numbers or short labels (e.g. co-borrower not yet collected). */
function formatAgeCell(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return String(Math.trunc(v));
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t.replace(/[^0-9.-]/g, ''));
    if (!Number.isNaN(n) && /^-?\d/.test(t)) return String(Math.trunc(n));
    return t;
  }
  return String(v);
}

export function extractB1Age(raw: unknown): string | null {
  return formatAgeCell(
    pickRaw(raw, [
      'b1_age',
      'b1Age',
      'B1_age',
      'borrower_1_age',
      'borrower1_age',
      'primary_borrower_age',
      'lead_age',
    ]),
  );
}

export function extractB2Age(raw: unknown): string | null {
  return formatAgeCell(
    pickRaw(raw, [
      'b2_age',
      'b2Age',
      'B2_age',
      'borrower_2_age',
      'borrower2_age',
      'spouse_age',
      'co_borrower_age',
      'coborrower_age',
    ]),
  );
}

/**
 * Credit score range, kept as text. GHL sends a bucket such as "700-739",
 * so it is never coerced to a number.
 */
export function extractCreditScoreRange(raw: unknown): string | null {
  const v = pickRaw(raw, [
    'credit_score_range',
    'creditScoreRange',
    'credit_score',
    'creditScore',
    'fico_range',
    'fico_score',
    'fico',
  ]);
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Map a free-text property use to a known bucket, or null when it is neither. */
export function normalizePropertyUse(value: string): PropertyUse | null {
  const t = value.trim().toLowerCase();
  if (!t) return null;
  if (/invest|rental|rent\b|non[-\s]?owner|business/.test(t)) return 'investment';
  if (/primary|owner[-\s]?occup|personal|residen/.test(t)) return 'primary';
  return null;
}

export const PROPERTY_USE_LABELS: Record<PropertyUse, string> = {
  primary: 'Primary',
  investment: 'Investment',
};

/** Site the lead came from (GHL UTM Term). Blank stays empty. */
export function extractUtmTerm(raw: unknown): string | null {
  const v = pickRaw(raw, ['utm_term', 'utmTerm']);
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Label for a known bucket; the original text is kept when it is neither. */
export function extractPropertyUse(raw: unknown): string | null {
  const v = pickRaw(raw, ['property_use', 'propertyUse', 'occupancy', 'occupancy_type']);
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const bucket = normalizePropertyUse(s);
  return bucket ? PROPERTY_USE_LABELS[bucket] : s;
}

export type LeadIntake = {
  loan_amount: string | null;
  property_value: string | null;
  ltv: number | null;
  state: string | null;
  b1_age: string | null;
  b2_age: string | null;
  credit_score_range: string | null;
  property_use: string | null;
  utm_term: string | null;
};

/**
 * Every intake field for one payload. RM ages are only filled for RM (or an
 * unknown product); DSCR fields only for DSCR (or an unknown product).
 */
export function extractLeadIntake(raw: unknown, product: LeadProduct | null): LeadIntake {
  const rm = product !== 'dscr';
  const dscr = product !== 'rm';
  return {
    loan_amount: extractLoanAmount(raw),
    property_value: extractPropertyValue(raw),
    ltv: extractLtv(raw),
    state: extractState(raw),
    b1_age: rm ? extractB1Age(raw) : null,
    b2_age: rm ? extractB2Age(raw) : null,
    credit_score_range: dscr ? extractCreditScoreRange(raw) : null,
    property_use: dscr ? extractPropertyUse(raw) : null,
    utm_term: extractUtmTerm(raw),
  };
}

/** Which product-specific fields a row of this product shows. */
export function intakeFor(product: LeadProduct | null): {
  product: LeadProduct | null;
  shared: ['loan_amount', 'property_value', 'ltv', 'state'];
  rmFields: ['b1_age', 'b2_age'] | [];
  dscrFields: ['credit_score_range', 'property_use'] | [];
} {
  return {
    product,
    shared: ['loan_amount', 'property_value', 'ltv', 'state'],
    rmFields: product === 'dscr' ? [] : ['b1_age', 'b2_age'],
    dscrFields: product === 'rm' ? [] : ['credit_score_range', 'property_use'],
  };
}

/** One-cell borrower summary, e.g. "B1 62 / B2 60" or "FICO 700-739 / Investment". */
export function borrowerSummary(
  intake: Partial<Pick<LeadIntake, 'b1_age' | 'b2_age' | 'credit_score_range' | 'property_use'>>,
  product: LeadProduct | null,
): string | null {
  const parts: string[] = [];
  if (product !== 'dscr') {
    if (intake.b1_age) parts.push(`B1 ${intake.b1_age}`);
    if (intake.b2_age) parts.push(`B2 ${intake.b2_age}`);
  }
  if (product !== 'rm') {
    if (intake.credit_score_range) parts.push(`FICO ${intake.credit_score_range}`);
    if (intake.property_use) parts.push(intake.property_use);
  }
  return parts.length ? parts.join(' / ') : null;
}
