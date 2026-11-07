// People on a client account. The primary loan officer is a row here too
// (contact_type primary_lo). Optional facts live in profile, not extra columns.

import { parsePersonProfile, type PersonFileSummary, type PersonProfile } from '@/lib/person-profile';
import { normalizeStatesLicensed } from '@/lib/us-states';

export const CONTACT_TYPE_CODES = ['primary_lo', 'loa', 'co_lo', 'other'] as const;
export type ContactType = (typeof CONTACT_TYPE_CODES)[number];

export const CONTACT_TYPE_OPTIONS: { value: ContactType; label: string }[] = [
  { value: 'primary_lo', label: 'Primary loan officer' },
  { value: 'loa', label: 'LOA / Assistant' },
  { value: 'co_lo', label: 'Co-LO / Partner LO' },
  { value: 'other', label: 'Other' },
];

/** Roles a teammate can pick when adding someone. The primary row is created for the account. */
export const ADDITIONAL_CONTACT_TYPE_OPTIONS = CONTACT_TYPE_OPTIONS.filter(o => o.value !== 'primary_lo');

export type PersonNoteRow = {
  id: string;
  body: string;
  created_at: string;
};

export type PersonFileRow = PersonFileSummary & {
  id: string;
  content_type?: string | null;
  created_at?: string;
};

export type ClientContact = {
  id: string;
  client_id: string;
  contact_type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  nmls: string | null;
  states_licensed: string[] | null;
  notes: string | null;
  profile: PersonProfile;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  person_notes?: PersonNoteRow[];
  person_files?: PersonFileRow[];
};

export const CLIENT_CONTACT_FIELDS =
  'id, client_id, contact_type, name, email, phone, nmls, states_licensed, notes, profile, sort_order, created_at, updated_at, created_by, updated_by';

export function isValidContactType(value: unknown): value is ContactType {
  return typeof value === 'string' && (CONTACT_TYPE_CODES as readonly string[]).includes(value);
}

export function contactTypeLabel(type: string | null | undefined): string {
  const found = CONTACT_TYPE_OPTIONS.find(o => o.value === type);
  return found?.label ?? type ?? '—';
}

export function contactRequiresLicensedStates(type: string | null | undefined): boolean {
  return type === 'co_lo';
}

export type ContactInput = {
  contact_type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  nmls: string | null;
  states_licensed: string[] | null;
  notes: string | null;
  profile: PersonProfile;
};

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function validateContactInput(
  body: Record<string, unknown>,
): { ok: true; data: ContactInput } | { ok: false; error: string } {
  if (!isValidContactType(body.contact_type)) {
    return { ok: false, error: 'Invalid contact_type' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'name is required' };
  }

  // States are a plus item. A co-LO can be created without them; the profile
  // asks for them when that role is saved if they are still missing.
  const states_licensed = normalizeStatesLicensed(body.states_licensed);

  return {
    ok: true,
    data: {
      contact_type: body.contact_type,
      name,
      email: optionalText(body.email),
      phone: optionalText(body.phone),
      nmls: optionalText(body.nmls),
      states_licensed,
      notes: optionalText(body.notes),
      profile: parsePersonProfile(body.profile),
    },
  };
}

export function validateContactPatch(
  body: Record<string, unknown>,
): { ok: true; updates: Partial<ContactInput> } | { ok: false; error: string } {
  const updates: Partial<ContactInput> = {};

  if ('contact_type' in body) {
    if (!isValidContactType(body.contact_type)) {
      return { ok: false, error: 'Invalid contact_type' };
    }
    updates.contact_type = body.contact_type;
  }

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { ok: false, error: 'name cannot be empty' };
    updates.name = name;
  }

  if ('email' in body) updates.email = optionalText(body.email);
  if ('phone' in body) updates.phone = optionalText(body.phone);
  if ('nmls' in body) updates.nmls = optionalText(body.nmls);
  if ('notes' in body) updates.notes = optionalText(body.notes);
  if ('profile' in body) updates.profile = parsePersonProfile(body.profile);
  if ('states_licensed' in body) {
    updates.states_licensed = normalizeStatesLicensed(body.states_licensed);
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'No fields to update' };
  }

  return { ok: true, updates };
}
