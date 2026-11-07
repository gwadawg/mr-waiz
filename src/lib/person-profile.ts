// One catalog for a loan officer's optional profile.
// The roster, the team invite, and onboarding extra people all read this list.
// Headshot, bio, note, and file are items on it — not a separate form.

import { isKnownUsClientTimezone } from '@/lib/us-timezones';

export const PROFILE_KEYS = ['biography', 'review_url', 'timezone', 'personal_address'] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export type PersonProfile = Partial<Record<ProfileKey, string>>;

export const PLUS_ITEM_KEYS = [
  'headshot',
  'biography',
  'note',
  'file',
  'email',
  'phone',
  'nmls',
  'states_licensed',
  'review_url',
  'personal_address',
  'timezone',
] as const;

export type PlusItemKey = (typeof PLUS_ITEM_KEYS)[number];

export type PlusItem = {
  key: PlusItemKey;
  label: string;
  /** Note and File can be added more than once. Headshot leaves the list once set. */
  repeatable: boolean;
};

export const PLUS_ITEMS: PlusItem[] = [
  { key: 'headshot', label: 'Headshot', repeatable: false },
  { key: 'biography', label: 'Bio', repeatable: false },
  { key: 'note', label: 'Note', repeatable: true },
  { key: 'file', label: 'File', repeatable: true },
  { key: 'email', label: 'Email', repeatable: false },
  { key: 'phone', label: 'Phone', repeatable: false },
  { key: 'nmls', label: 'NMLS', repeatable: false },
  { key: 'states_licensed', label: 'Licensed states', repeatable: false },
  { key: 'review_url', label: 'Review link', repeatable: false },
  { key: 'personal_address', label: 'Personal address', repeatable: false },
  { key: 'timezone', label: 'Timezone', repeatable: false },
];

const PLUS_BY_KEY = new Map(PLUS_ITEMS.map(item => [item.key, item]));

export function plusItem(key: string): PlusItem | null {
  return PLUS_BY_KEY.get(key as PlusItemKey) ?? null;
}

export type PersonFileSummary = {
  id?: string;
  kind: 'headshot' | 'license' | 'other';
  file_name: string;
  public_url?: string | null;
};

/** The bits the plus list needs in order to know what is already on this person. */
export type PersonPlusState = {
  email?: string | null;
  phone?: string | null;
  nmls?: string | null;
  states_licensed?: string[] | null;
  profile?: PersonProfile | null;
  notes?: { id?: string; body: string }[] | null;
  files?: PersonFileSummary[] | null;
};

export function emptyProfile(): PersonProfile {
  return {};
}

export function parsePersonProfile(value: unknown): PersonProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const src = value as Record<string, unknown>;
  const out: PersonProfile = {};
  for (const key of PROFILE_KEYS) {
    const text = typeof src[key] === 'string' ? src[key].trim() : '';
    if (text) out[key] = text;
  }
  return out;
}

export function currentHeadshot(person: PersonPlusState): PersonFileSummary | null {
  const shots = (person.files ?? []).filter(file => file.kind === 'headshot');
  return shots.length ? shots[shots.length - 1] : null;
}

function filledText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function itemIsAttached(person: PersonPlusState, key: PlusItemKey): boolean {
  if (key === 'note' || key === 'file') return false;
  if (key === 'headshot') return currentHeadshot(person) != null;
  if (key === 'email') return filledText(person.email);
  if (key === 'phone') return filledText(person.phone);
  if (key === 'nmls') return filledText(person.nmls);
  if (key === 'states_licensed') return (person.states_licensed ?? []).length > 0;
  return filledText(person.profile?.[key]);
}

/** Plus menu for this person. Repeatable items stay. A set headshot does not. */
export function availablePlusItems(person: PersonPlusState): PlusItem[] {
  return PLUS_ITEMS.filter(item => item.repeatable || !itemIsAttached(person, item.key));
}

/**
 * Co-LO licensed states are required, but they are not an empty field on a new
 * person. Ask when the role is saved if they are still missing.
 */
export function missingRoleRequirement(role: string | null | undefined, person: PersonPlusState): string | null {
  if (role === 'co_lo' && !(person.states_licensed ?? []).length) {
    return 'Add licensed states for this co-LO';
  }
  return null;
}

export function validatePlusText(key: PlusItemKey, value: string): string | null {
  const text = value.trim();
  if (!text) return 'Enter a value or cancel';
  if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return 'Enter a valid email address';
  }
  if (key === 'review_url' && !/^https?:\/\/.+/i.test(text)) {
    return 'Review link must start with http:// or https://';
  }
  if (key === 'timezone' && !isKnownUsClientTimezone(text)) {
    return 'Please select a valid US timezone';
  }
  return null;
}

export function contactRoleRequiresStates(role: string | null | undefined): boolean {
  return role === 'co_lo';
}
