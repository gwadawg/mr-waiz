/** Launch-setup facts on the client file. Kickoff will write these later. */

export const BRAND_SUBJECTS = ['client', 'company'] as const;
export type BrandSubject = (typeof BRAND_SUBJECTS)[number];

export const ACCOUNT_SHAPES = ['solo', 'team'] as const;
export type AccountShape = (typeof ACCOUNT_SHAPES)[number];

export const BRAND_SUBJECT_LABELS: Record<BrandSubject, string> = {
  client: 'Client name',
  company: 'Company',
};

export const ACCOUNT_SHAPE_LABELS: Record<AccountShape, string> = {
  solo: 'Solo',
  team: 'Team',
};

export function brandSubjectLabel(value: string | null | undefined): string | null {
  if (value === 'client' || value === 'company') return BRAND_SUBJECT_LABELS[value];
  return null;
}

export function accountShapeLabel(value: string | null | undefined): string | null {
  if (value === 'solo' || value === 'team') return ACCOUNT_SHAPE_LABELS[value];
  return null;
}

export function qualifiesLeadsLabel(value: boolean | null | undefined): string | null {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return null;
}

/** null = unset. 'invalid' = reject the write. */
export function normalizeBrandSubject(raw: unknown): BrandSubject | null | 'invalid' {
  if (raw === '' || raw == null) return null;
  if (raw === 'client' || raw === 'company') return raw;
  return 'invalid';
}

export function normalizeAccountShape(raw: unknown): AccountShape | null | 'invalid' {
  if (raw === '' || raw == null) return null;
  if (raw === 'solo' || raw === 'team') return raw;
  return 'invalid';
}

export function parseQualifiesLeads(raw: unknown): boolean | null | 'invalid' {
  if (raw === '' || raw == null) return null;
  if (raw === true || raw === 'yes' || raw === 'true') return true;
  if (raw === false || raw === 'no' || raw === 'false') return false;
  return 'invalid';
}
