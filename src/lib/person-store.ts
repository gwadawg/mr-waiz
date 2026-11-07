// Read and write a person on client_contacts: sparse create, one plus item at a
// time, notes on client_notes, files in storage. The primary loan officer is
// the same record and writes core facts back onto the linked client rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CLIENT_CONTACT_FIELDS,
  type ClientContact,
  type ContactType,
  type PersonFileRow,
  type PersonNoteRow,
} from '@/lib/client-contacts';
import { propagateIdentityFields, type ClientIdentityField } from '@/lib/client-identity';
import {
  currentHeadshot,
  parsePersonProfile,
  validatePlusText,
  type PersonProfile,
  type PlusItemKey,
} from '@/lib/person-profile';
import { normalizeStatesLicensed } from '@/lib/us-states';

export const PERSON_FILE_BUCKET = 'client-person-files';
const HEADSHOT_BUCKET = 'client-headshots';
const SIGNED_URL_TTL_SEC = 60 * 60;

const HEADSHOT_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

type ClientPersonSource = {
  id: string;
  name: string;
  primary_contact_name: string | null;
  primary_contact: string | null;
  email: string | null;
  phone: string | null;
  nmls: string | null;
  states_licensed: string[] | null;
  biography: string | null;
  timezone: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  headshot_url: string | null;
};

function asContact(row: Record<string, unknown>): ClientContact {
  return {
    ...(row as unknown as ClientContact),
    profile: parsePersonProfile(row.profile),
    person_notes: [],
    person_files: [],
  };
}

export async function ensurePrimaryPerson(
  service: SupabaseClient,
  clientId: string,
): Promise<void> {
  const { data: existing, error: existingErr } = await service
    .from('client_contacts')
    .select('id')
    .eq('client_id', clientId)
    .eq('contact_type', 'primary_lo')
    .limit(1);
  if (existingErr) throw new Error(existingErr.message);
  if (existing && existing.length > 0) return;

  const { data: client, error } = await service
    .from('clients')
    .select(
      'id, name, primary_contact_name, primary_contact, email, phone, nmls, states_licensed, biography, timezone, street_address, city, state, zip_code, headshot_url',
    )
    .eq('id', clientId)
    .single();
  if (error || !client) return;

  const source = client as ClientPersonSource;
  const name =
    source.primary_contact_name?.trim() ||
    source.primary_contact?.trim() ||
    source.name?.trim();
  if (!name) return;

  const profile: PersonProfile = {};
  if (source.biography?.trim()) profile.biography = source.biography.trim();
  if (source.timezone?.trim()) profile.timezone = source.timezone.trim();
  const address = [source.street_address, source.city, source.state, source.zip_code]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(', ');
  if (address) profile.personal_address = address;

  const { data: inserted, error: insertErr } = await service
    .from('client_contacts')
    .insert({
      client_id: clientId,
      contact_type: 'primary_lo',
      name,
      email: source.email?.trim() || null,
      phone: source.phone?.trim() || null,
      nmls: source.nmls?.trim() || null,
      states_licensed: source.states_licensed?.length ? source.states_licensed : null,
      profile,
      notes: null,
      sort_order: -1,
    })
    .select('id')
    .single();
  if (insertErr) {
    if (/duplicate|unique/i.test(insertErr.message)) return;
    throw new Error(insertErr.message);
  }

  const headshot = source.headshot_url?.trim();
  if (headshot && inserted?.id) {
    const { error: fileErr } = await service.from('client_contact_files').insert({
      contact_id: inserted.id,
      kind: 'headshot',
      file_name: 'headshot',
      content_type: null,
      storage_path: headshot,
      public_url: headshot,
    });
    if (fileErr) throw new Error(fileErr.message);
  }
}

async function signFile(
  service: SupabaseClient,
  row: PersonFileRow & { storage_path: string },
): Promise<PersonFileRow> {
  if (row.public_url || row.kind === 'headshot') {
    return {
      id: row.id,
      kind: row.kind,
      file_name: row.file_name,
      content_type: row.content_type,
      public_url: row.public_url,
      created_at: row.created_at,
    };
  }
  const { data, error } = await service.storage
    .from(PERSON_FILE_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SEC);
  return {
    id: row.id,
    kind: row.kind,
    file_name: row.file_name,
    content_type: row.content_type,
    public_url: error ? null : data?.signedUrl ?? null,
    created_at: row.created_at,
  };
}

export async function loadPeople(
  service: SupabaseClient,
  clientIds: string[],
  identityClientId: string,
): Promise<ClientContact[]> {
  if (!clientIds.length) return [];
  await ensurePrimaryPerson(service, identityClientId);

  const { data, error } = await service
    .from('client_contacts')
    .select(CLIENT_CONTACT_FIELDS)
    .in('client_id', clientIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const people = ((data ?? []) as unknown as Record<string, unknown>[]).map(asContact);
  if (!people.length) return [];

  const ids = people.map(person => person.id);
  const [notesRes, filesRes] = await Promise.all([
    service
      .from('client_notes')
      .select('id, contact_id, body, created_at')
      .in('contact_id', ids)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    service
      .from('client_contact_files')
      .select('id, contact_id, kind, file_name, content_type, storage_path, public_url, created_at')
      .in('contact_id', ids)
      .order('created_at', { ascending: true }),
  ]);
  if (notesRes.error) throw new Error(notesRes.error.message);
  if (filesRes.error) throw new Error(filesRes.error.message);

  const notesByContact = new Map<string, PersonNoteRow[]>();
  for (const note of notesRes.data ?? []) {
    const contactId = note.contact_id as string;
    const list = notesByContact.get(contactId) ?? [];
    list.push({ id: note.id as string, body: note.body as string, created_at: note.created_at as string });
    notesByContact.set(contactId, list);
  }

  const filesByContact = new Map<string, (PersonFileRow & { storage_path: string })[]>();
  for (const file of filesRes.data ?? []) {
    const contactId = file.contact_id as string;
    const list = filesByContact.get(contactId) ?? [];
    const row: PersonFileRow & { storage_path: string } = {
      id: file.id as string,
      kind: file.kind as PersonFileRow['kind'],
      file_name: file.file_name as string,
      content_type: (file.content_type as string | null) ?? null,
      public_url: (file.public_url as string | null) ?? null,
      created_at: file.created_at as string,
      storage_path: file.storage_path as string,
    };
    list.push(row);
    filesByContact.set(contactId, list);
  }

  for (const person of people) {
    person.person_notes = notesByContact.get(person.id) ?? [];
    const files = filesByContact.get(person.id) ?? [];
    person.person_files = await Promise.all(
      files.map(file => signFile(service, file)),
    );
  }
  return people;
}

export function dedupePeople(people: ClientContact[]): ClientContact[] {
  const seen = new Set<string>();
  return people.filter(person => {
    const key = [
      person.contact_type,
      person.name.trim().toLowerCase(),
      (person.email ?? '').trim().toLowerCase(),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function syncPrimaryToClients(service: SupabaseClient, person: ClientContact): Promise<void> {
  if (person.contact_type !== 'primary_lo') return;
  const patch: Partial<Record<ClientIdentityField, unknown>> = {};
  if (person.name.trim()) {
    patch.primary_contact_name = person.name.trim();
    patch.primary_contact = person.name.trim();
  }
  if (person.email?.trim()) patch.email = person.email.trim();
  if (person.phone?.trim()) patch.phone = person.phone.trim();
  if (person.nmls?.trim()) patch.nmls = person.nmls.trim();
  if (person.states_licensed?.length) patch.states_licensed = person.states_licensed;
  const profile = parsePersonProfile(person.profile);
  if (profile.biography) patch.biography = profile.biography;
  if (profile.timezone) patch.timezone = profile.timezone;
  if (profile.personal_address) patch.street_address = profile.personal_address;
  const headshot = currentHeadshot({ files: person.person_files });
  if (headshot?.public_url) {
    const { error } = await service
      .from('clients')
      .update({ headshot_url: headshot.public_url })
      .or(`id.eq.${person.client_id},identity_client_id.eq.${person.client_id}`);
    if (error) throw new Error(error.message);
  }
  await propagateIdentityFields(service, person.client_id, patch);
}

async function reloadPerson(
  service: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<ClientContact> {
  const people = await loadPeople(service, [clientId], clientId);
  const person = people.find(row => row.id === contactId);
  if (!person) throw new Error('Person not found');
  return person;
}

export async function createPerson(
  service: SupabaseClient,
  clientId: string,
  input: { contact_type: ContactType; name: string },
  userId: string | null,
): Promise<ClientContact> {
  if (input.contact_type === 'primary_lo') {
    await ensurePrimaryPerson(service, clientId);
    const people = await loadPeople(service, [clientId], clientId);
    const primary = people.find(person => person.contact_type === 'primary_lo');
    if (!primary) throw new Error('Could not create the primary loan officer');
    return primary;
  }

  const { data, error } = await service
    .from('client_contacts')
    .insert({
      client_id: clientId,
      contact_type: input.contact_type,
      name: input.name.trim(),
      email: null,
      phone: null,
      nmls: null,
      states_licensed: null,
      notes: null,
      profile: {},
      sort_order: 0,
      created_by: userId,
    })
    .select(CLIENT_CONTACT_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  const person = asContact(data as unknown as Record<string, unknown>);
  person.person_notes = [];
  person.person_files = [];
  return person;
}

function extensionOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'bin';
  return ext.replace(/[^a-z0-9]/g, '') || 'bin';
}

async function storeFile(
  service: SupabaseClient,
  person: ClientContact,
  kind: 'headshot' | 'other',
  file: { fileName: string; contentType: string; bytes: Buffer },
  userId: string | null,
): Promise<void> {
  const ext = extensionOf(file.fileName);
  if (kind === 'headshot' && !HEADSHOT_EXT.has(ext)) {
    throw new Error('Headshot must be JPG, PNG, WEBP, or GIF');
  }
  const path = kind === 'headshot'
    ? `people/${person.id}/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`
    : `${person.client_id}/${person.id}/${crypto.randomUUID()}.${ext}`;
  const bucket = kind === 'headshot' ? HEADSHOT_BUCKET : PERSON_FILE_BUCKET;
  const { error } = await service.storage.from(bucket).upload(path, file.bytes, {
    contentType: file.contentType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(error.message);

  let publicUrl: string | null = null;
  if (kind === 'headshot') {
    const { data } = service.storage.from(bucket).getPublicUrl(path);
    publicUrl = data.publicUrl;
  }

  const { error: insertErr } = await service.from('client_contact_files').insert({
    contact_id: person.id,
    kind,
    file_name: file.fileName || (kind === 'headshot' ? 'headshot' : 'file'),
    content_type: file.contentType || null,
    storage_path: path,
    public_url: publicUrl,
    created_by: userId,
  });
  if (insertErr) throw new Error(insertErr.message);
}

export async function attachPersonItem(
  service: SupabaseClient,
  clientId: string,
  contactId: string,
  item: { key: PlusItemKey; value?: string | string[] | null; file?: { fileName: string; contentType: string; bytes: Buffer } | null },
  userId: string | null,
): Promise<ClientContact> {
  const { data: existing, error } = await service
    .from('client_contacts')
    .select(CLIENT_CONTACT_FIELDS)
    .eq('id', contactId)
    .eq('client_id', clientId)
    .single();
  if (error || !existing) throw new Error(error?.message || 'Person not found');
  const person = asContact(existing as unknown as Record<string, unknown>);

  if (item.key === 'note') {
    const body = typeof item.value === 'string' ? item.value.trim() : '';
    if (!body) throw new Error('Enter a note or cancel');
    const { error: noteErr } = await service.from('client_notes').insert({
      client_id: clientId,
      contact_id: contactId,
      note_type: 'general',
      body,
      created_by: userId,
    });
    if (noteErr) throw new Error(noteErr.message);
  } else if (item.key === 'headshot' || item.key === 'file') {
    if (!item.file || !item.file.bytes.length) throw new Error('Choose a file');
    await storeFile(service, person, item.key === 'headshot' ? 'headshot' : 'other', item.file, userId);
  } else if (item.key === 'states_licensed') {
    const states = normalizeStatesLicensed(item.value);
    const { error: upErr } = await service
      .from('client_contacts')
      .update({
        states_licensed: states,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', contactId);
    if (upErr) throw new Error(upErr.message);
  } else {
    const text = typeof item.value === 'string' ? item.value : '';
    const problem = validatePlusText(item.key, text);
    if (problem) throw new Error(problem);
    const trimmed = text.trim();
    if (item.key === 'email' || item.key === 'phone' || item.key === 'nmls') {
      const { error: upErr } = await service
        .from('client_contacts')
        .update({
          [item.key]: trimmed,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('id', contactId);
      if (upErr) throw new Error(upErr.message);
    } else {
      const profile = { ...parsePersonProfile(person.profile), [item.key]: trimmed };
      const { error: upErr } = await service
        .from('client_contacts')
        .update({
          profile,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('id', contactId);
      if (upErr) throw new Error(upErr.message);
    }
  }

  const reloaded = await reloadPerson(service, clientId, contactId);
  await syncPrimaryToClients(service, reloaded);
  return reloaded;
}

export async function saveSubmittedPerson(
  service: SupabaseClient,
  clientId: string,
  input: {
    contact_type: ContactType;
    name: string;
    email?: string | null;
    phone?: string | null;
    nmls?: string | null;
    states_licensed?: string[] | null;
    profile?: PersonProfile | null;
    notes?: string[] | null;
    headshot?: { fileName: string; contentType: string; bytes: Buffer } | null;
    headshotUrl?: string | null;
    files?: { fileName: string; contentType: string; bytes: Buffer }[] | null;
    attachments?: {
      kind: 'headshot' | 'other';
      file_name: string;
      content_type: string | null;
      storage_path: string;
      public_url: string | null;
    }[] | null;
  },
  userId: string | null,
): Promise<ClientContact> {
  const profile = parsePersonProfile(input.profile ?? {});
  const row = {
    contact_type: input.contact_type,
    name: input.name.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    nmls: input.nmls?.trim() || null,
    states_licensed: input.states_licensed?.length ? input.states_licensed : null,
    profile,
    updated_at: new Date().toISOString(),
  };

  let person: ClientContact;
  if (input.contact_type === 'primary_lo') {
    await ensurePrimaryPerson(service, clientId);
    const { data: existing } = await service
      .from('client_contacts')
      .select('id')
      .eq('client_id', clientId)
      .eq('contact_type', 'primary_lo')
      .limit(1);
    const existingId = existing?.[0]?.id as string | undefined;
    if (existingId) {
      const current = await reloadPerson(service, clientId, existingId);
      const patch: Record<string, unknown> = {
        name: row.name || current.name,
        profile: { ...parsePersonProfile(current.profile), ...profile },
        updated_at: row.updated_at,
      };
      if (row.email) patch.email = row.email;
      if (row.phone) patch.phone = row.phone;
      if (row.nmls) patch.nmls = row.nmls;
      if (row.states_licensed) patch.states_licensed = row.states_licensed;
      const { error: upErr } = await service.from('client_contacts').update(patch).eq('id', existingId);
      if (upErr) throw new Error(upErr.message);
      person = current;
    } else {
      const { data, error } = await service
        .from('client_contacts')
        .insert({ ...row, client_id: clientId, notes: null, sort_order: -1, created_by: userId })
        .select(CLIENT_CONTACT_FIELDS)
        .single();
      if (error) throw new Error(error.message);
      person = asContact(data as unknown as Record<string, unknown>);
    }
  } else {
    const { data, error } = await service
      .from('client_contacts')
      .insert({ ...row, client_id: clientId, notes: null, sort_order: 0, created_by: userId })
      .select(CLIENT_CONTACT_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    person = asContact(data as unknown as Record<string, unknown>);
  }

  for (const note of input.notes ?? []) {
    const body = note.trim();
    if (!body) continue;
    const { error: noteErr } = await service.from('client_notes').insert({
      client_id: clientId,
      contact_id: person.id,
      note_type: 'general',
      body,
      created_by: userId,
    });
    if (noteErr) throw new Error(noteErr.message);
  }

  if (input.headshot?.bytes.length) {
    await storeFile(service, person, 'headshot', input.headshot, userId);
  } else if (input.headshotUrl?.trim()) {
    const { error: fileErr } = await service.from('client_contact_files').insert({
      contact_id: person.id,
      kind: 'headshot',
      file_name: 'headshot',
      content_type: null,
      storage_path: input.headshotUrl.trim(),
      public_url: input.headshotUrl.trim(),
      created_by: userId,
    });
    if (fileErr) throw new Error(fileErr.message);
  }
  for (const attachment of input.attachments ?? []) {
    const { error: fileErr } = await service.from('client_contact_files').insert({
      contact_id: person.id,
      kind: attachment.kind,
      file_name: attachment.file_name,
      content_type: attachment.content_type,
      storage_path: attachment.storage_path,
      public_url: attachment.public_url,
      created_by: userId,
    });
    if (fileErr) throw new Error(fileErr.message);
  }
  for (const file of input.files ?? []) {
    if (!file.bytes.length) continue;
    await storeFile(service, person, 'other', file, userId);
  }

  const reloaded = await reloadPerson(service, clientId, person.id);
  await syncPrimaryToClients(service, reloaded);
  return reloaded;
}

export async function uploadLoosePersonFile(
  service: SupabaseClient,
  kind: 'headshot' | 'other',
  file: File,
): Promise<{
  kind: 'headshot' | 'other';
  file_name: string;
  content_type: string | null;
  storage_path: string;
  public_url: string | null;
}> {
  const ext = extensionOf(file.name);
  if (kind === 'headshot' && !HEADSHOT_EXT.has(ext)) {
    throw new Error('Headshot must be JPG, PNG, WEBP, or GIF');
  }
  const path = `intake/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const bucket = kind === 'headshot' ? HEADSHOT_BUCKET : PERSON_FILE_BUCKET;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await service.storage.from(bucket).upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const publicUrl = kind === 'headshot'
    ? service.storage.from(bucket).getPublicUrl(path).data.publicUrl
    : null;
  return {
    kind,
    file_name: file.name || (kind === 'headshot' ? 'headshot' : 'file'),
    content_type: file.type || null,
    storage_path: path,
    public_url: publicUrl,
  };
}

export async function syncPersonColumns(
  service: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<void> {
  const person = await reloadPerson(service, clientId, contactId);
  await syncPrimaryToClients(service, person);
}
