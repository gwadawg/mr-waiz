/**
 * Client Success SOP catalog — plain-English meaning of each graded KPI.
 * Used by the KPI Standards panel so the tab doubles as an information / playbook
 * surface. `librarySlug` is reserved for future Library SOP deep-links.
 */
import {
  DEFAULT_KPI_BANDS,
  HE_KPI_KEYS,
  KPI_META,
  RM_KPI_KEYS,
  type Bands,
  type ClientKpiBenchmarks,
  type KpiKey,
} from '@/lib/client-health';
import { normalizeOverlay } from '@/lib/kpi-criteria';

export type KpiOwner = 'media_buyer' | 'ccm' | 'client_lo' | 'shared';

export type KpiDefinition = {
  key: KpiKey;
  /** One-line "what this measures". */
  meaning: string;
  /** Formula in plain English. */
  formula: string;
  owner: KpiOwner;
  ownerLabel: string;
  /** Whether teams may override bands per client (costs yes; rates usually no). */
  perClientEditable: boolean;
  /** Short "what to do when red" hints — later replaced/augmented by library links. */
  fixHints: string[];
  /** Future: Library doc slug for the full SOP. Null until linked. */
  librarySlug: string | null;
};

export const COST_KPI_KEYS: KpiKey[] = ['cpl', 'cpql', 'cps'];
export const COST_BAND_KEYS = ['critical', 'below', 'at'] as const;
export type CostBandKey = (typeof COST_BAND_KEYS)[number];

export const RATE_KPI_KEYS: KpiKey[] = [
  'lead_to_qualified',
  'hand_raise_rate',
  'booking_rate',
  'lead_booking_rate',
  'show_rate',
  'close_rate',
  'pickup_rate',
];

export const KPI_DEFINITIONS: Record<KpiKey, KpiDefinition> = {
  cpl: {
    key: 'cpl',
    meaning: 'How much ad spend it takes to generate one new lead.',
    formula: 'Total ad spend ÷ Total leads',
    owner: 'media_buyer',
    ownerLabel: 'Media Buyer',
    perClientEditable: true,
    fixHints: [
      'Tighten audience / geo / age exclusions',
      'Kill or refresh creative with rising CPL',
      'Check landing page load speed and form friction',
    ],
    librarySlug: null,
  },
  cpql: {
    key: 'cpql',
    meaning: 'Cost to get a lead that actually qualifies for the product.',
    formula: 'Total ad spend ÷ Qualified leads',
    owner: 'media_buyer',
    ownerLabel: 'Media Buyer',
    perClientEditable: false,
    fixHints: [
      'Improve lead quality messaging (intent, equity, age)',
      'Align Meta targeting with qualification criteria',
      'Review qualifier tagging lag — CPQL looks worse when tags are late',
    ],
    librarySlug: null,
  },
  cps: {
    key: 'cps',
    meaning:
      'North-star efficiency: cost per unique conversation (show ∪ claimed ∪ live transfer).',
    formula: 'Total ad spend ÷ Unique conversation leads',
    owner: 'shared',
    ownerLabel: 'Shared (Media + CCM)',
    perClientEditable: false,
    fixHints: [
      'If CPL/CPQL are fine but CPConv is high → conversion leak (CCM)',
      'If CPL/CPQL are high → fix upstream cost first (Media)',
      'Credit live transfers — they count as conversations',
    ],
    librarySlug: null,
  },
  lead_to_qualified: {
    key: 'lead_to_qualified',
    meaning: 'Share of new leads that meet qualification criteria.',
    formula: 'Qualified leads ÷ Total leads × 100',
    owner: 'media_buyer',
    ownerLabel: 'Media Buyer (+ tagging ops)',
    perClientEditable: false,
    fixHints: [
      'Tighten ad creative / landing copy to the ICP',
      'Confirm GHL qualification tags are applied consistently',
    ],
    librarySlug: null,
  },
  hand_raise_rate: {
    key: 'hand_raise_rate',
    meaning:
      'Share of qualified leads who raised their hand (booked, claimed, or live-transferred).',
    formula: 'Unique (booked ∪ claimed ∪ LT) ÷ Qualified leads × 100',
    owner: 'ccm',
    ownerLabel: 'CCM / Call center',
    perClientEditable: false,
    fixHints: [
      'Speed-to-lead and dial volume on fresh qualified leads',
      'Script / objection handling for booking and LT',
      'Do not judge booking alone — live transfers count',
    ],
    librarySlug: null,
  },
  booking_rate: {
    key: 'booking_rate',
    meaning:
      'Reference only — unique booked ÷ qualified. Not a Client Success benchmark (use hand-raise; credits LT/claimed and avoids rebook inflation).',
    formula: 'Unique booked leads ÷ Qualified leads × 100',
    owner: 'ccm',
    ownerLabel: 'CCM / Call center',
    perClientEditable: false,
    fixHints: [
      'Prefer hand-raise rate as the conversion benchmark',
      'Do not grade accounts on booking-only when LT/claimed volume exists',
    ],
    librarySlug: null,
  },
  lead_booking_rate: {
    key: 'lead_booking_rate',
    meaning:
      'Reference only — unique booked ÷ total leads (HE). Not graded; HE conversion uses unique hand-raise ÷ total leads.',
    formula: 'Unique booked leads ÷ Total leads × 100',
    owner: 'ccm',
    ownerLabel: 'CCM / Call center',
    perClientEditable: false,
    fixHints: [
      'Prefer unique hand-raise ÷ total leads for HE grading',
    ],
    librarySlug: null,
  },
  show_rate: {
    key: 'show_rate',
    meaning:
      'Show Rate: of unique people we booked, how many eventually spoke to the LO (show, claimed, or live transfer) — recovery-inclusive after no-show/reschedule. Distinct from True Show (slot took-place attendance).',
    formula: 'Unique (booked ∩ show∪claimed∪LT) ÷ Unique booked × 100',
    owner: 'ccm',
    ownerLabel: 'CCM (+ confirmations / rebook)',
    perClientEditable: false,
    fixHints: [
      'Confirmation sequence (SMS / call) before the appointment',
      'No-show rebook path until they speak or close out',
      'Claimed and live transfers count as spoke — not calendar True Show only',
    ],
    librarySlug: null,
  },
  close_rate: {
    key: 'close_rate',
    meaning: 'Share of shows that funded / closed (client LO performance).',
    formula: 'Funded / closed ÷ Shows × 100',
    owner: 'client_lo',
    ownerLabel: 'Client LO (reported, not team-owned)',
    perClientEditable: false,
    fixHints: [
      'Surface for account reviews — usually not a Waiz setter fix',
      'Check lead quality and LO follow-through separately',
    ],
    librarySlug: null,
  },
  pickup_rate: {
    key: 'pickup_rate',
    meaning: 'Share of outbound dials that were answered.',
    formula: 'Pickups ÷ Outbound dials × 100',
    owner: 'ccm',
    ownerLabel: 'CCM / Call center',
    perClientEditable: false,
    fixHints: [
      'Caller ID / number reputation',
      'Time-of-day dialing windows',
    ],
    librarySlug: null,
  },
};

export const OWNER_LABEL: Record<KpiOwner, string> = {
  media_buyer: 'Media Buyer',
  ccm: 'CCM / Call center',
  client_lo: 'Client LO',
  shared: 'Shared',
};

/** KPIs shown in Client Success standards for this reporting type. */
export function kpiKeysForReportingType(isCallCenter: boolean): KpiKey[] {
  return isCallCenter ? HE_KPI_KEYS : RM_KPI_KEYS;
}

/** Resolved bands: client override layered over global defaults. */
export function resolveKpiBands(
  key: KpiKey,
  overrides?: ClientKpiBenchmarks | null,
): Bands {
  const def = DEFAULT_KPI_BANDS[key].bands;
  if (key === 'cpl') return { ...def, ...(overrides?.cpl ?? {}) };
  if (key === 'cpql' || key === 'cps') {
    const derived = deriveCostBenchmarksFromCpl(overrides?.cpl);
    return { ...def, ...(derived?.[key] ?? {}) };
  }
  // Conversion standards are intentionally global for every client.
  return { ...def };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Derive the full cost stack from the only client-specific input: CPL.
 *
 * CPQL   = CPL ÷ lead-to-qualified rate
 * CPConv = CPQL ÷ conversation yield
 *
 * Conversion assumptions are the global rate bands. Conversation yield uses the
 * hand-raise standard because Client Success defines the downstream conversion
 * path as booked ∪ claimed ∪ live transfer. Sparse CPL input inherits the global
 * CPL for that band. No CPL overrides means "use defaults" and returns null.
 */
export function deriveCostBenchmarksFromCpl(
  cplOverrides?: Bands | null,
): ClientKpiBenchmarks | null {
  const customCpl: Bands = {};
  for (const band of COST_BAND_KEYS) {
    const value = cplOverrides?.[band];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      customCpl[band] = value;
    }
  }
  if (Object.keys(customCpl).length === 0) return null;

  const cpl: Bands = {};
  const cpql: Bands = {};
  const cps: Bands = {};

  for (const band of COST_BAND_KEYS) {
    const cplValue = customCpl[band] ?? DEFAULT_KPI_BANDS.cpl.bands[band];
    const qualPct = DEFAULT_KPI_BANDS.lead_to_qualified.bands[band];
    const conversationPct = DEFAULT_KPI_BANDS.hand_raise_rate.bands[band];
    if (cplValue == null || qualPct == null || conversationPct == null) continue;

    const cpqlValue = cplValue / (qualPct / 100);
    cpl[band] = cplValue;
    cpql[band] = roundMoney(cpqlValue);
    cps[band] = roundMoney(cpqlValue / (conversationPct / 100));
  }

  return { cpl, cpql, cps };
}

/**
 * Keep a stored goal key only when this client's profile grades it.
 * Keys the profile does not grade are dropped. Pass the graded set from the
 * open criteria version — an empty list keeps nothing.
 */
export function normalizeClientKpiBenchmarks(
  input: unknown,
  gradedKeys: KpiKey[] = [],
): ClientKpiBenchmarks | null {
  return normalizeOverlay(input, gradedKeys);
}

export function formatBandValue(key: KpiKey, value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const unit = DEFAULT_KPI_BANDS[key].unit;
  if (unit === 'money') return `$${Math.round(value)}`;
  return `${value}%`;
}

export function kpiShortLabel(key: KpiKey): string {
  return KPI_META[key].short;
}

export function kpiFullLabel(key: KpiKey): string {
  return KPI_META[key].label;
}

/** True when any cost (or any) band is overridden for this client. */
export function hasBenchmarkOverrides(
  overrides: ClientKpiBenchmarks | null | undefined,
  keys?: KpiKey[],
): boolean {
  if (!overrides) return false;
  const list = keys ?? (Object.keys(overrides) as KpiKey[]);
  return list.some(k => overrides[k] && Object.keys(overrides[k]!).length > 0);
}
