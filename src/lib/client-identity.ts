import type { SupabaseClient } from '@supabase/supabase-js';
import { clientsLikelySameClient } from '@/lib/client-ghl-mapping';

/** Profile fields shared across all offers for the same LO / business. */
export const CLIENT_IDENTITY_FIELDS = [
  'primary_contact_name',
  'primary_contact',
  'email',
  'billing_email',
  'phone',
  'source',
  'website',
  'brokerage_name',
  'nmls',
  'state',
  'city',
  'zip_code',
  'street_address',
  'states_licensed',
  'timezone',
  'contact_role',
  'biography',
  'legal_business_name',
  'business_type',
] as const;

export type ClientIdentityField = (typeof CLIENT_IDENTITY_FIELDS)[number];

/** Kick-off "Confirm Information" fields — sourced from identity when linked. */
export const KICKOFF_IDENTITY_FIELD_KEYS = [
  'contact_role',
  'states_licensed',
  'nmls',
  'brokerage_name',
  'timezone',
] as const;

export type KickoffIdentityFieldKey = (typeof KICKOFF_IDENTITY_FIELD_KEYS)[number];

export type ClientIdentityRow = {
  id: string;
  name: string;
  identity_client_id?: string | null;
  account_group_id?: string | null;
  engagement_kind?: string | null;
  created_at?: string;
  reporting_type?: string | null;
  offer?: string | null;
  lifecycle_status?: string | null;
  primary_contact_name?: string | null;
  primary_contact?: string | null;
  email?: string | null;
  billing_email?: string | null;
  phone?: string | null;
  source?: string | null;
  website?: string | null;
  brokerage_name?: string | null;
  nmls?: string | null;
  state?: string | null;
  city?: string | null;
  zip_code?: string | null;
  street_address?: string | null;
  states_licensed?: string[] | null;
  timezone?: string | null;
  contact_role?: string | null;
  biography?: string | null;
  legal_business_name?: string | null;
  business_type?: string | null;
};

export type RelatedOfferSummary = {
  id: string;
  name: string;
  reporting_type: string | null;
  offer: string | null;
  lifecycle_status: string | null;
  is_current: boolean;
};

export type ClientIdentityGroup = {
  identity_client_id: string;
  identity: ClientIdentityRow;
  offers: RelatedOfferSummary[];
};

const IDENTITY_SELECT = [
  'id',
  'name',
  'identity_client_id',
  'account_group_id',
  'engagement_kind',
  'created_at',
  'reporting_type',
  'offer',
  'lifecycle_status',
  ...CLIENT_IDENTITY_FIELDS,
].join(', ');

/** Fields loaded when resolving members of a multi-offer account. */
export const ACCOUNT_MEMBER_SELECT = IDENTITY_SELECT;

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s || null;
}

function phoneLast10(phone: string | null | undefined): string | null {
  const digits = trimOrNull(phone)?.replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  return digits.slice(-10);
}

function normalizePersonName(name: string | null | undefined): string | null {
  const base = trimOrNull(name);
  if (!base) return null;
  return base
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clientsMatchIdentity(a: ClientIdentityRow, b: ClientIdentityRow): boolean {
  const nmlsA = trimOrNull(a.nmls);
  const nmlsB = trimOrNull(b.nmls);
  if (nmlsA && nmlsB && nmlsA === nmlsB) return true;

  const emailA = trimOrNull(a.email)?.toLowerCase();
  const emailB = trimOrNull(b.email)?.toLowerCase();
  if (emailA && emailB && emailA === emailB) return true;

  const phoneA = phoneLast10(a.phone);
  const phoneB = phoneLast10(b.phone);
  if (phoneA && phoneB && phoneA === phoneB) return true;

  const personA = normalizePersonName(trimOrNull(a.primary_contact_name) ?? trimOrNull(a.primary_contact));
  const personB = normalizePersonName(trimOrNull(b.primary_contact_name) ?? trimOrNull(b.primary_contact));
  if (personA && personB && personA === personB) return true;

  const nameA = normalizePersonName(a.name);
  const nameB = normalizePersonName(b.name);
  if (personA && nameB && (personA === nameB || clientsLikelySameClient(personA, nameB))) return true;
  if (personB && nameA && (personB === nameA || clientsLikelySameClient(personB, nameA))) return true;

  if (personA && b.name && clientsLikelySameClient(personA, b.name)) return true;
  if (personB && a.name && clientsLikelySameClient(personB, a.name)) return true;
  if (nameA && nameB && clientsLikelySameClient(nameA, nameB)) return true;

  return false;
}

function fieldHasValue(key: ClientIdentityField, row: ClientIdentityRow): boolean {
  const v = row[key];
  if (Array.isArray(v)) return v.length > 0;
  return v != null && String(v).trim().length > 0;
}

export function resolveIdentityClientId(client: Pick<ClientIdentityRow, 'id' | 'identity_client_id'>): string {
  return client.identity_client_id ?? client.id;
}

export function countIdentityFields(row: ClientIdentityRow): number {
  return CLIENT_IDENTITY_FIELDS.filter(k => fieldHasValue(k, row)).length;
}

/** Merge identity fields from source into target (target wins when already set). */
export function mergeIdentityFields<T extends ClientIdentityRow>(target: T, source: ClientIdentityRow): T {
  const merged = { ...target };
  for (const key of CLIENT_IDENTITY_FIELDS) {
    if (fieldHasValue(key, merged)) continue;
    const v = source[key];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (merged as Record<string, unknown>)[key] = v;
  }
  return merged;
}

export function pickIdentitySource(clients: ClientIdentityRow[]): ClientIdentityRow {
  return [...clients].sort((a, b) => countIdentityFields(b) - countIdentityFields(a))[0];
}

/**
 * Build one profile from every linked offer row — each field comes from whichever
 * row has it filled. Never overwrites a populated value with an empty one.
 */
export function mergeIdentityFromMembers(members: ClientIdentityRow[]): ClientIdentityRow | null {
  if (!members.length) return null;
  let merged: ClientIdentityRow = { ...pickIdentitySource(members) };
  for (const member of members) {
    merged = mergeIdentityFields(merged, member);
  }
  return merged;
}

/**
 * Canonical row id for identity links and account-level calls/notes.
 * Prefers the offer with the most profile data filled; ties break to initial, then oldest.
 */
export function pickAccountIdentityRootId(
  siblings: ClientIdentityRow[],
): string | null {
  if (!siblings.length) return null;
  const ranked = [...siblings].sort((a, b) => {
    const fieldDelta = countIdentityFields(b) - countIdentityFields(a);
    if (fieldDelta !== 0) return fieldDelta;
    const aInitial = a.engagement_kind === 'initial' ? 0 : 1;
    const bInitial = b.engagement_kind === 'initial' ? 0 : 1;
    if (aInitial !== bInitial) return aInitial - bInitial;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
  return resolveIdentityClientId(ranked[0]);
}

export function identityFieldsFromPatch(
  patch: Record<string, unknown>,
): Partial<Record<ClientIdentityField, unknown>> {
  const out: Partial<Record<ClientIdentityField, unknown>> = {};
  for (const key of CLIENT_IDENTITY_FIELDS) {
    if (key in patch) out[key] = patch[key];
  }
  return out;
}

export function isKickoffIdentityFieldComplete(
  draft: Record<KickoffIdentityFieldKey, unknown>,
): boolean {
  for (const key of KICKOFF_IDENTITY_FIELD_KEYS) {
    const v = draft[key];
    if (key === 'states_licensed') {
      if (!Array.isArray(v) || v.length === 0) return false;
      continue;
    }
    if (typeof v !== 'string' || !v.trim()) return false;
  }
  return true;
}

export async function loadClientIdentityGroup(
  service: SupabaseClient,
  clientId: string,
): Promise<ClientIdentityGroup | null> {
  const { data: current, error } = await service
    .from('clients')
    .select(ACCOUNT_MEMBER_SELECT)
    .eq('id', clientId)
    .single();
  if (error || !current) return null;

  const row = current as unknown as ClientIdentityRow;
  const memberIds = new Set<string>([row.id]);

  if (row.account_group_id) {
    const { data: groupSiblings, error: groupErr } = await service
      .from('clients')
      .select('id')
      .eq('account_group_id', row.account_group_id);
    if (groupErr) throw new Error(groupErr.message);
    for (const sibling of groupSiblings ?? []) memberIds.add(sibling.id as string);
  }

  const identityId = resolveIdentityClientId(row);
  const { data: linked, error: linkErr } = await service
    .from('clients')
    .select('id')
    .or(`id.eq.${identityId},identity_client_id.eq.${identityId}`);
  if (linkErr) throw new Error(linkErr.message);
  for (const linkedRow of linked ?? []) memberIds.add(linkedRow.id as string);

  const { data: memberRows, error: membersErr } = await service
    .from('clients')
    .select(ACCOUNT_MEMBER_SELECT)
    .in('id', [...memberIds]);
  if (membersErr) throw new Error(membersErr.message);

  const members = (memberRows ?? []) as unknown as ClientIdentityRow[];
  const mergedIdentity = mergeIdentityFromMembers(members) ?? row;
  const identityRootId = pickAccountIdentityRootId(members) ?? identityId;

  const offers: RelatedOfferSummary[] = members
    .map(c => ({
      id: c.id,
      name: c.name,
      reporting_type: c.reporting_type ?? null,
      offer: c.offer ?? null,
      lifecycle_status: c.lifecycle_status ?? null,
      is_current: c.id === clientId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    identity_client_id: identityRootId,
    identity: mergedIdentity,
    offers,
  };
}

export async function findIdentityClientForNewOffer(
  service: SupabaseClient,
  input: {
    nmls?: string | null;
    email?: string | null;
    phone?: string | null;
    primary_contact_name?: string | null;
    excludeId?: string | null;
  },
): Promise<string | null> {
  const probe: ClientIdentityRow = {
    id: 'probe',
    name: '',
    nmls: input.nmls ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    primary_contact_name: input.primary_contact_name ?? null,
  };

  const { data: candidates, error } = await service
    .from('clients')
    .select(IDENTITY_SELECT);
  if (error) throw new Error(error.message);

  let best: ClientIdentityRow | null = null;
  let bestScore = 0;

  for (const c of (candidates ?? []) as unknown as ClientIdentityRow[]) {
    if (input.excludeId && c.id === input.excludeId) continue;
    if (!clientsMatchIdentity(probe, c)) continue;
    const score = countIdentityFields(c);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }

  if (!best) return null;
  return resolveIdentityClientId(best);
}

export async function propagateIdentityFields(
  service: SupabaseClient,
  identityClientId: string,
  patch: Partial<Record<ClientIdentityField, unknown>>,
): Promise<void> {
  if (!Object.keys(patch).length) return;

  const { data: members, error: loadErr } = await service
    .from('clients')
    .select('id')
    .or(`id.eq.${identityClientId},identity_client_id.eq.${identityClientId}`);
  if (loadErr) throw new Error(loadErr.message);

  const ids = (members ?? []).map(r => r.id as string);
  if (!ids.length) return;

  for (const id of ids) {
    const { error } = await service.from('clients').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }
}

/** Apply shared identity onto an offer row for reads (kickoff prefill, client file display). */
export function withIdentityProfile<T extends ClientIdentityRow>(
  offerRow: T,
  identity: ClientIdentityRow,
): T {
  return mergeIdentityFields({ ...offerRow }, identity);
}
