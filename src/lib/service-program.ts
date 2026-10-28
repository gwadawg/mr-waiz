import { normalizeReportingType } from '@/lib/reporting-types';

export const SERVICE_PROGRAMS = ['core', 'lead_gen'] as const;
export type ServiceProgram = (typeof SERVICE_PROGRAMS)[number];

export type ServiceProgramMeta = {
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  background: string;
};

export const SERVICE_PROGRAM_META: Record<ServiceProgram, ServiceProgramMeta> = {
  core: {
    label: 'Call Center',
    shortLabel: 'CC',
    description: 'We generate leads, dial, book appointments, and qualify.',
    color: '#34d399',
    background: 'rgba(52,211,153,0.12)',
  },
  lead_gen: {
    label: 'Leads Only',
    shortLabel: 'Leads',
    description: 'We generate leads only — client handles dial, booking, and qualification.',
    color: '#94a3b8',
    background: 'rgba(148,163,184,0.12)',
  },
};

/**
 * System Type on the kickoff form.
 * Stored codes stay `core` (Call Center) and `lead_gen` (Leads).
 */
export function resolveKickoffServiceProgram(value: unknown): ServiceProgram | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return null;
  if (raw === 'core' || raw === 'call_center' || raw === 'callcenter') return 'core';
  if (raw === 'lead_gen' || raw === 'leads' || raw === 'leads_only' || raw === 'leadgen') return 'lead_gen';
  return normalizeServiceProgram(value);
}

export function normalizeServiceProgram(value: unknown): ServiceProgram | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return null;
  if (raw === 'core' || raw.includes('full')) return 'core';
  if (
    raw === 'lead_gen' ||
    raw === 'leadgen' ||
    raw.includes('lead_gen') ||
    raw.includes('lead gen') ||
    raw.includes('leads_only') ||
    raw.includes('leads only')
  ) {
    return 'lead_gen';
  }
  return null;
}

export function getServiceProgramLabel(value: unknown): string | null {
  const normalized = normalizeServiceProgram(value);
  return normalized ? SERVICE_PROGRAM_META[normalized].label : null;
}

/** Words the kickoff form shows. Stored codes stay core and lead_gen. */
export function kickoffSystemTypeLabel(value: unknown): string | null {
  const program = resolveKickoffServiceProgram(value);
  if (program === 'core') return 'Call Center';
  if (program === 'lead_gen') return 'Leads';
  return null;
}

/** Service program applies to RM and DSCR marketing clients, not Call Center. */
export function serviceProgramApplies(vertical: unknown): boolean {
  const v = normalizeReportingType(vertical);
  return v === 'RM' || v === 'DSCR';
}

export const SERVICE_PROGRAM_OPTIONS = SERVICE_PROGRAMS.map(value => ({
  value,
  ...SERVICE_PROGRAM_META[value],
}));
