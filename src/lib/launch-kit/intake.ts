/**
 * Launch Kit intake — draft shape, prefill from `clients` + last kit, validation, variant resolution.
 *
 * Kit-only fields live in `client_form_submissions.responses` (form_type = 'launch_kit').
 * Columns the client file already owns are written back via `clientPatchFromDraft`
 * (funnel, CRM, the three phone numbers, and the virtual business card).
 */

import { toDateInputValue } from '@/lib/client-dates';
import { normalizeReportingType } from '@/lib/reporting-types';
import { normalizeServiceProgram } from '@/lib/service-program';
import type { KitDialOwner, KitProduct, KitVariant } from './types';

export const TO_FILL = '[TO FILL]';

/** "What's live" properties, in PDF order. */
export const LAUNCH_KIT_PROPERTIES = [
  {
    key: 'funnel_url',
    label: 'WM Apex Funnel',
    kind: 'url',
    clientColumn: 'funnel_url',
    naAllowed: false,
    hint: 'Landing page our team built for this client.',
  },
  { key: 'crm_url', label: 'CRM', kind: 'url', clientColumn: 'ghl_subaccount_url', naAllowed: false, hint: '' },
  {
    key: 'launch_kit_folder_url',
    label: 'Launch Kit folder',
    kind: 'url',
    clientColumn: null,
    naAllowed: true,
    hint: '',
  },
] as const;

export type LaunchKitPropertyKey = (typeof LAUNCH_KIT_PROPERTIES)[number]['key'];

/**
 * Client-facing review checklist. Prefills from `clients` when that column is filled.
 * Phone numbers and the virtual business card write back on generate. Legal notice and
 * Facebook page stay on the kit snapshot.
 */
export const LAUNCH_KIT_REVIEW_FIELDS = [
  {
    key: 'legal_notice_url',
    label: 'Legal notice',
    kind: 'url' as const,
    optional: false,
    naAllowed: true,
    naLabel: 'Declined / not needed',
    pdfLabel: 'Legal notice (compliance approve)',
    hint: '',
  },
  {
    key: 'phone_prospecting',
    label: 'Go High Level number',
    kind: 'text' as const,
    optional: false,
    naAllowed: true,
    naLabel: 'Not part of this account',
    pdfLabel: 'Go High Level number',
    hint: 'The number we use to text and call leads. This is also the number the client sees when we text them or live-transfer a call. They should save it in their contacts so they know who is calling.',
  },
  {
    key: 'phone_live_transfer',
    label: 'Live transfer number',
    kind: 'text' as const,
    optional: false,
    naAllowed: true,
    naLabel: 'Not part of this account',
    pdfLabel: 'Live transfer number',
    hint: "The client's phone number. This is the number we call to live-transfer a lead to them.",
  },
  {
    key: 'phone_notifications',
    label: 'Notification number',
    kind: 'text' as const,
    optional: true,
    naAllowed: true,
    naLabel: 'Same as live transfer',
    pdfLabel: 'Notification number',
    hint: 'A client number we send notifications to, when that is different from the live transfer number. Leave blank if notifications go to the live transfer number.',
  },
  {
    key: 'virtual_card_url',
    label: 'Virtual business card',
    kind: 'url' as const,
    optional: false,
    naAllowed: true,
    naLabel: 'Not part of this account',
    pdfLabel: 'Virtual business card',
    hint: 'Published loanofficer.me card for this client.',
  },
  {
    key: 'facebook_page',
    label: 'Facebook page',
    kind: 'text' as const,
    optional: false,
    naAllowed: true,
    naLabel: 'Not part of this account',
    pdfLabel: 'Facebook page',
    hint: '',
  },
] as const;

export type LaunchKitReviewKey = (typeof LAUNCH_KIT_REVIEW_FIELDS)[number]['key'];

export type LaunchKitNaKey = LaunchKitPropertyKey | LaunchKitReviewKey;

export type LaunchKitResourceSource = 'resources' | 'library' | 'manual';

export type LaunchKitResource = {
  id?: string;
  source?: LaunchKitResourceSource;
  title: string;
  description: string;
  url: string;
};

export type LaunchKitDraft = {
  product: KitProduct | '';
  dial_owner: KitDialOwner | '';
  contact_first_name: string;
  company_name: string;
  go_live_date: string;
  csm_name: string;
  slack_channel_name: string;
  who_works_leads: string;
  speed_standard: string;
  funnel_url: string;
  crm_url: string;
  launch_kit_folder_url: string;
  /** Kit-snapshot review fields. Client-owned columns prefill from the client file. */
  legal_notice_url: string;
  phone_prospecting: string;
  phone_live_transfer: string;
  phone_notifications: string;
  virtual_card_url: string;
  facebook_page: string;
  /** Client-specific form where qualified/disqualified lead outcomes are logged. */
  lead_logging_form_url: string;
  /** Client-facing resource snapshot for this kit version. */
  resources: LaunchKitResource[];
  /** On-file receipt (kit snapshot). */
  nmls: string;
  states_licensed: string;
  /** Property / review keys the CSM has explicitly marked as not part of this account. */
  property_na: Partial<Record<LaunchKitNaKey, boolean>>;
  notes: string;
};

export type LaunchKitClient = {
  id: string;
  name: string;
  lifecycle_status: string | null;
  primary_contact_name: string | null;
  brokerage_name: string | null;
  legal_business_name: string | null;
  reporting_type: string | null;
  service_program: string | null;
  launch_date: string | null;
  slack_id: string | null;
  funnel_url: string | null;
  ghl_subaccount_url: string | null;
  drive_folder_url: string | null;
  states_licensed: string[] | null;
  ghl_location_id: string | null;
  nmls: string | null;
  phone_ghl: string | null;
  phone_live_transfer: string | null;
  phone_notifications: string | null;
  virtual_business_card_url: string | null;
  facebook_page_name: string | null;
};

export const LAUNCH_KIT_CLIENT_FIELDS =
  'id, name, lifecycle_status, primary_contact_name, brokerage_name, legal_business_name, reporting_type, service_program, launch_date, slack_id, funnel_url, ghl_subaccount_url, drive_folder_url, states_licensed, ghl_location_id, nmls, phone_ghl, phone_live_transfer, phone_notifications, virtual_business_card_url, facebook_page_name';

export function emptyLaunchKitDraft(): LaunchKitDraft {
  return {
    product: '',
    dial_owner: '',
    contact_first_name: '',
    company_name: '',
    go_live_date: '',
    csm_name: '',
    slack_channel_name: '',
    who_works_leads: '',
    speed_standard: '',
    funnel_url: '',
    crm_url: '',
    launch_kit_folder_url: '',
    legal_notice_url: '',
    phone_prospecting: '',
    phone_live_transfer: '',
    phone_notifications: '',
    virtual_card_url: '',
    facebook_page: '',
    lead_logging_form_url: '',
    resources: [],
    nmls: '',
    states_licensed: '',
    property_na: {},
    notes: '',
  };
}

/** Product from `reporting_type`. CALL_CENTER / unknown → '' so the CSM must choose. */
export function productFromReportingType(reportingType: unknown): KitProduct | '' {
  const raw = String(reportingType ?? '').trim();
  if (!raw) return '';
  const v = normalizeReportingType(raw);
  if (v === 'RM') return 'rm';
  if (v === 'DSCR') return 'dscr';
  return '';
}

/** Dial owner from `service_program`. core = Waiz dials/books; lead_gen = client dials. CALL_CENTER → waiz. */
export function dialOwnerFromClient(reportingType: unknown, serviceProgram: unknown): KitDialOwner | '' {
  if (normalizeReportingType(reportingType) === 'CALL_CENTER' && String(reportingType ?? '').trim()) {
    return 'waiz';
  }
  const program = normalizeServiceProgram(serviceProgram);
  if (program === 'core') return 'waiz';
  if (program === 'lead_gen') return 'client';
  return '';
}

export function resolveVariant(draft: Pick<LaunchKitDraft, 'product' | 'dial_owner'>): KitVariant | null {
  if (!draft.product || !draft.dial_owner) return null;
  return { product: draft.product, dialOwner: draft.dial_owner };
}

export function defaultWhoWorksLeads(variant: KitVariant | null, contactFirstName: string): string {
  if (!variant) return '';
  if (variant.dialOwner === 'waiz') {
    return variant.product === 'dscr' ? 'Laura (your AI assistant)' : 'The Waiz call center';
  }
  const name = contactFirstName.trim();
  return name ? `${name} and your team` : 'You and your team';
}

function firstName(full: string | null | undefined): string {
  const t = (full ?? '').trim();
  if (!t) return '';
  return t.split(/\s+/)[0] ?? '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function resourceSource(v: unknown): LaunchKitResourceSource | undefined {
  return v === 'resources' || v === 'library' || v === 'manual' ? v : undefined;
}

function resourcesFromUnknown(v: unknown): LaunchKitResource[] {
  if (!Array.isArray(v)) return [];
  const out: LaunchKitResource[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const title = str(raw.title).trim();
    const description = str(raw.description).trim();
    const url = str(raw.url).trim();
    const id = str(raw.id).trim();
    const source = resourceSource(raw.source);
    if (!title && !description && !url) continue;
    out.push({
      ...(id ? { id } : {}),
      ...(source ? { source } : {}),
      title,
      description,
      url,
    });
  }
  return out;
}

function statesLicensedLabel(states: string[] | null | undefined): string {
  return (states ?? []).map(s => String(s).trim()).filter(Boolean).join(', ');
}

/** Client-file value when it is filled; otherwise the last kit draft. */
function fromClientOrDraft(clientValue: string | null | undefined, draftValue: string): string {
  const fromClient = (clientValue ?? '').trim();
  return fromClient || draftValue.trim();
}

/** Prefill: client-file columns win when filled. Last kit fills only the blanks and kit-only fields. */
export function draftFromClient(
  client: LaunchKitClient,
  lastResponses?: Record<string, unknown> | null,
): LaunchKitDraft {
  const last = lastResponses ? draftFromResponses(lastResponses) : null;
  const base = last ?? emptyLaunchKitDraft();

  const product = productFromReportingType(client.reporting_type) || base.product;
  const dialOwner = dialOwnerFromClient(client.reporting_type, client.service_program) || base.dial_owner;
  const contact = firstName(client.primary_contact_name) || base.contact_first_name;
  const variant = resolveVariant({ product, dial_owner: dialOwner });
  const clientStates = statesLicensedLabel(client.states_licensed);
  const companyFromClient =
    client.brokerage_name?.trim() || client.legal_business_name?.trim() || client.name.trim();

  return {
    ...base,
    product,
    dial_owner: dialOwner,
    contact_first_name: contact,
    company_name: companyFromClient || base.company_name,
    go_live_date: toDateInputValue(client.launch_date) || base.go_live_date.trim(),
    who_works_leads: base.who_works_leads || defaultWhoWorksLeads(variant, contact),
    funnel_url: fromClientOrDraft(client.funnel_url, base.funnel_url),
    crm_url: fromClientOrDraft(client.ghl_subaccount_url, base.crm_url),
    launch_kit_folder_url: base.launch_kit_folder_url || client.drive_folder_url?.trim() || '',
    legal_notice_url: base.legal_notice_url,
    phone_prospecting: fromClientOrDraft(client.phone_ghl, base.phone_prospecting),
    phone_live_transfer: fromClientOrDraft(client.phone_live_transfer, base.phone_live_transfer),
    phone_notifications: fromClientOrDraft(client.phone_notifications, base.phone_notifications),
    virtual_card_url: fromClientOrDraft(client.virtual_business_card_url, base.virtual_card_url),
    facebook_page: fromClientOrDraft(client.facebook_page_name, base.facebook_page),
    nmls: fromClientOrDraft(client.nmls, base.nmls),
    states_licensed: clientStates || base.states_licensed,
  };
}

export function draftFromResponses(responses: Record<string, unknown>): LaunchKitDraft {
  const d = emptyLaunchKitDraft();
  const product = str(responses.product);
  const dialOwner = str(responses.dial_owner);
  d.product = product === 'rm' || product === 'dscr' ? product : '';
  d.dial_owner = dialOwner === 'waiz' || dialOwner === 'client' ? dialOwner : '';
  d.contact_first_name = str(responses.contact_first_name);
  d.company_name = str(responses.company_name);
  d.go_live_date = str(responses.go_live_date);
  d.csm_name = str(responses.csm_name);
  d.slack_channel_name = str(responses.slack_channel_name);
  d.who_works_leads = str(responses.who_works_leads);
  d.speed_standard = str(responses.speed_standard);
  d.notes = str(responses.notes);
  d.nmls = str(responses.nmls);
  d.states_licensed = str(responses.states_licensed);
  d.lead_logging_form_url = str(responses.lead_logging_form_url);
  d.resources = resourcesFromUnknown(responses.resources);
  for (const p of LAUNCH_KIT_PROPERTIES) d[p.key] = str(responses[p.key]);
  for (const p of LAUNCH_KIT_REVIEW_FIELDS) d[p.key] = str(responses[p.key]);
  const na = responses.property_na;
  if (na && typeof na === 'object') {
    for (const p of LAUNCH_KIT_PROPERTIES) {
      if ((na as Record<string, unknown>)[p.key] === true) d.property_na[p.key] = true;
    }
    for (const p of LAUNCH_KIT_REVIEW_FIELDS) {
      if ((na as Record<string, unknown>)[p.key] === true) d.property_na[p.key] = true;
    }
  }
  return d;
}

export const LAUNCH_KIT_NOTE_MARKER = 'Launch Kit';

/** Full kit intake, including links marked N/A and internal notes. */
export function launchKitClientFileNoteSections(draft: LaunchKitDraft): { label: string; value: string }[] {
  const sections: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text) sections.push({ label, value: text });
  };

  add('Product', draft.product === 'rm' ? 'Reverse mortgage' : draft.product === 'dscr' ? 'DSCR' : draft.product);
  add('Who dials', draft.dial_owner === 'waiz' ? 'Waiz' : draft.dial_owner === 'client' ? 'Client' : draft.dial_owner);
  add('Contact', draft.contact_first_name);
  add('Company / DBA', draft.company_name);
  add('Go-live', draft.go_live_date);
  add('CSM', draft.csm_name);
  add('Slack channel', draft.slack_channel_name);
  add('Who works new leads', draft.who_works_leads);
  add('Speed standard', draft.speed_standard);
  for (const property of LAUNCH_KIT_PROPERTIES) {
    add(property.label, draft.property_na[property.key] ? 'N/A' : draft[property.key]);
  }
  for (const field of LAUNCH_KIT_REVIEW_FIELDS) {
    add(field.label, draft.property_na[field.key] ? 'N/A' : draft[field.key]);
  }
  add('Lead logging form', draft.lead_logging_form_url);
  for (const resource of draft.resources) {
    add(`Resource: ${resource.title || 'Untitled resource'}`, resource.url);
  }
  add('NMLS', draft.nmls);
  add('States licensed', draft.states_licensed);
  add('Internal notes', draft.notes);
  return sections;
}

export function draftToResponses(draft: LaunchKitDraft): Record<string, unknown> {
  const naKeys = [
    ...LAUNCH_KIT_PROPERTIES.filter(p => draft.property_na[p.key]).map(p => p.key),
    ...LAUNCH_KIT_REVIEW_FIELDS.filter(p => draft.property_na[p.key]).map(p => p.key),
  ];
  const out: Record<string, unknown> = {
    product: draft.product || null,
    dial_owner: draft.dial_owner || null,
    contact_first_name: draft.contact_first_name.trim(),
    company_name: draft.company_name.trim(),
    go_live_date: draft.go_live_date.trim(),
    csm_name: draft.csm_name.trim(),
    slack_channel_name: draft.slack_channel_name.trim(),
    who_works_leads: draft.who_works_leads.trim(),
    speed_standard: draft.speed_standard.trim(),
    notes: draft.notes.trim(),
    nmls: draft.nmls.trim(),
    states_licensed: draft.states_licensed.trim(),
    lead_logging_form_url: draft.lead_logging_form_url.trim(),
    resources: draft.resources.map(resource => ({
      ...(resource.id?.trim() ? { id: resource.id.trim() } : {}),
      ...(resource.source ? { source: resource.source } : {}),
      title: resource.title.trim(),
      description: resource.description.trim(),
      url: resource.url.trim(),
    })),
    property_na: Object.fromEntries(naKeys.map(k => [k, true])),
  };
  for (const p of LAUNCH_KIT_PROPERTIES) out[p.key] = draft[p.key].trim();
  for (const p of LAUNCH_KIT_REVIEW_FIELDS) out[p.key] = draft[p.key].trim();
  return out;
}

export function parseLaunchKitDraft(body: unknown): LaunchKitDraft {
  if (!body || typeof body !== 'object') return emptyLaunchKitDraft();
  return draftFromResponses(body as Record<string, unknown>);
}

export function isValidHttpUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isPropertyNa(draft: LaunchKitDraft, key: LaunchKitNaKey): boolean {
  return draft.property_na[key] === true;
}

/** Every rule the SOP enforces before a kit may ship. Empty array = OK to generate. */
export function validateForGenerate(draft: LaunchKitDraft): string[] {
  const errors: string[] = [];
  if (!draft.product) errors.push('Choose the product (Reverse mortgage or DSCR).');
  if (!draft.dial_owner) errors.push('Choose who works the leads (Waiz or the client).');
  if (!draft.contact_first_name.trim()) errors.push('Contact first name is required.');
  if (!draft.company_name.trim()) errors.push('Company / DBA is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.go_live_date.trim())) errors.push('Go-live date is required (YYYY-MM-DD).');
  if (!draft.csm_name.trim()) errors.push('CSM name is required.');
  if (!draft.who_works_leads.trim()) errors.push('Who works new leads is required.');
  if (!draft.lead_logging_form_url.trim()) {
    errors.push('Lead logging form URL is required.');
  } else if (draft.lead_logging_form_url.includes(TO_FILL)) {
    errors.push(`Lead logging form still contains ${TO_FILL}.`);
  } else if (!isValidHttpUrl(draft.lead_logging_form_url)) {
    errors.push('Lead logging form must be a full http(s) URL.');
  }

  for (const p of LAUNCH_KIT_PROPERTIES) {
    const value = draft[p.key].trim();
    const na = isPropertyNa(draft, p.key);
    if (na) {
      if (!p.naAllowed) errors.push(`${p.label} cannot be marked N/A.`);
      continue;
    }
    if (!value) {
      errors.push(`${p.label} URL is missing. Fill it or mark N/A — never ship a guessed link.`);
      continue;
    }
    if (value.includes(TO_FILL)) {
      errors.push(`${p.label} still contains ${TO_FILL}.`);
      continue;
    }
    if (!isValidHttpUrl(value)) errors.push(`${p.label} must be a full http(s) URL.`);
  }

  for (const p of LAUNCH_KIT_REVIEW_FIELDS) {
    const value = draft[p.key].trim();
    const na = isPropertyNa(draft, p.key);
    if (na) continue;
    if (p.optional && !value) continue;
    if (!value) {
      errors.push(
        p.kind === 'url'
          ? `${p.label} is missing. Fill it or mark N/A — never ship a guessed link.`
          : `${p.label} is missing. Fill it or mark N/A.`,
      );
      continue;
    }
    if (value.includes(TO_FILL)) {
      errors.push(`${p.label} still contains ${TO_FILL}.`);
      continue;
    }
    if (p.kind === 'url' && !isValidHttpUrl(value)) {
      errors.push(`${p.label} must be a full http(s) URL.`);
    }
  }

  const textFields: Array<[keyof LaunchKitDraft, string]> = [
    ['contact_first_name', 'Contact first name'],
    ['company_name', 'Company / DBA'],
    ['csm_name', 'CSM'],
    ['who_works_leads', 'Who works leads'],
    ['speed_standard', 'Speed standard'],
    ['slack_channel_name', 'Slack channel'],
    ['nmls', 'NMLS'],
    ['states_licensed', 'States licensed'],
  ];
  for (const [key, label] of textFields) {
    const v = draft[key];
    if (typeof v === 'string' && v.includes(TO_FILL)) errors.push(`${label} still contains ${TO_FILL}.`);
  }

  draft.resources.forEach((resource, i) => {
    const label = resource.title.trim() || `Resource ${i + 1}`;
    if (!resource.title.trim()) errors.push(`Resource ${i + 1} title is required.`);
    if (resource.title.includes(TO_FILL)) errors.push(`${label} title still contains ${TO_FILL}.`);
    if (resource.description.includes(TO_FILL)) errors.push(`${label} description still contains ${TO_FILL}.`);
    if (!resource.url.trim()) {
      errors.push(`${label} URL is required.`);
    } else if (resource.url.includes(TO_FILL)) {
      errors.push(`${label} URL still contains ${TO_FILL}.`);
    } else if (!isValidHttpUrl(resource.url)) {
      errors.push(`${label} must be a full http(s) URL.`);
    }
  });

  if (!draft.nmls.trim()) errors.push('NMLS is required for the on-file receipt.');
  if (!draft.states_licensed.trim()) errors.push('States licensed is required for the on-file receipt.');

  return errors;
}

/** Write changed client-owned values back to `clients`. Blank and N/A values are left alone. */
export function clientPatchFromDraft(
  draft: LaunchKitDraft,
  client: Pick<
    LaunchKitClient,
    | 'funnel_url'
    | 'ghl_subaccount_url'
    | 'phone_ghl'
    | 'phone_live_transfer'
    | 'phone_notifications'
    | 'virtual_business_card_url'
  >,
): Record<string, string> {
  const patch: Record<string, string> = {};
  const set = (
    column: string,
    value: string,
    current: string | null | undefined,
    na: boolean,
  ) => {
    const next = value.trim();
    if (!next || na) return;
    if (next !== (current ?? '').trim()) patch[column] = next;
  };
  set('funnel_url', draft.funnel_url, client.funnel_url, isPropertyNa(draft, 'funnel_url'));
  set('ghl_subaccount_url', draft.crm_url, client.ghl_subaccount_url, isPropertyNa(draft, 'crm_url'));
  set('phone_ghl', draft.phone_prospecting, client.phone_ghl, isPropertyNa(draft, 'phone_prospecting'));
  set('phone_live_transfer', draft.phone_live_transfer, client.phone_live_transfer, isPropertyNa(draft, 'phone_live_transfer'));
  set('phone_notifications', draft.phone_notifications, client.phone_notifications, isPropertyNa(draft, 'phone_notifications'));
  set('virtual_business_card_url', draft.virtual_card_url, client.virtual_business_card_url, isPropertyNa(draft, 'virtual_card_url'));
  return patch;
}

export function launchKitSlug(companyName: string, fallback: string): string {
  const base = (companyName.trim() || fallback).toLowerCase();
  const slug = base
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'client';
}

export function launchKitStoragePath(clientId: string, slug: string, version: number): string {
  return `${clientId}/${slug}-launch-kit-v${version}.pdf`;
}

/** Statuses in which the kit action is offered. Regeneration after go-live is allowed. */
export function isLaunchKitLifecycle(status: string | null | undefined): boolean {
  return status === 'new_account' || status === 'onboarding' || status === 'active';
}
