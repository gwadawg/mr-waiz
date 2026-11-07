import { validateContactInput, type ContactType } from '@/lib/client-contacts';
import { parsePersonProfile, type PersonProfile } from '@/lib/person-profile';
import {
  normalizeEmailForMatch,
  normalizePhoneForMatch,
} from '@/lib/form-submissions';
import {
  ACCOUNT_MANAGEMENT_OPTIONS,
  CRM_CHOICE_OPTIONS,
  PERFORMANCE_UNIT_OPTIONS,
  type AccountManagement,
  type CompanyAddress,
  type CrmChoice,
  type MemberDraft,
  type ObRole,
  type OnboardingFormVariant,
  type PerformanceUnit,
} from '@/lib/onboarding-steps';
import { formatStatesLicensed, normalizeStatesLicensed } from '@/lib/us-states';
import { isKnownUsClientTimezone } from '@/lib/us-timezones';

export type OnboardingMemberInput = {
  contact_type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  nmls: string | null;
  states_licensed: string[] | null;
  profile: PersonProfile;
  notes: string[];
  attachments?: {
    kind: 'headshot' | 'other';
    file_name: string;
    content_type: string | null;
    storage_path: string;
    public_url: string | null;
  }[];
};

export type OnboardingFormInput = {
  form_variant: OnboardingFormVariant;
  first_name: string | null;
  last_name: string | null;
  account_management: AccountManagement;
  ob_role: ObRole;
  email: string;
  phone: string;
  nmls: string;
  states_licensed: string[];
  brokerage_name: string;
  legal_business_name: string;
  website: string;
  company_nmls: string;
  company_address: CompanyAddress;
  company_states_licensed: string[];
  biography: string;
  review_url: string | null;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  timezone: string;
  performance_unit: PerformanceUnit | null;
  crm_choice: CrmChoice | null;
  headshot_url?: string | null;
  person_notes?: string[];
  primary_attachments?: OnboardingMemberInput['attachments'];
  additional_members: OnboardingMemberInput[];
};

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parseCompanyAddress(body: Record<string, unknown>): CompanyAddress {
  if (body.company_address && typeof body.company_address === 'object' && !Array.isArray(body.company_address)) {
    const a = body.company_address as Record<string, unknown>;
    return {
      street: trim(a.street),
      city: trim(a.city),
      state: trim(a.state).toUpperCase().slice(0, 2),
      zip: trim(a.zip),
    };
  }
  return {
    street: trim(body.company_street),
    city: trim(body.company_city),
    state: trim(body.company_state).toUpperCase().slice(0, 2),
    zip: trim(body.company_zip),
  };
}

function parseMembers(body: Record<string, unknown>): OnboardingMemberInput[] {
  let raw: unknown = body.additional_members;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const members: OnboardingMemberInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid team member at position ${i + 1}`);
    }
    const record = item as Record<string, unknown>;
    const validated = validateContactInput(record);
    if (!validated.ok) {
      throw new Error(`Team member ${i + 1}: ${validated.error}`);
    }
    const notes = Array.isArray(record.notes)
      ? record.notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      : [];
    const attachments = Array.isArray(record.attachments)
      ? record.attachments.filter(item => item && typeof item === 'object') as OnboardingMemberInput['attachments']
      : [];
    members.push({
      ...validated.data,
      profile: parsePersonProfile(record.profile ?? validated.data.profile),
      notes,
      attachments,
    });
  }
  return members;
}

function parseObRole(body: Record<string, unknown>): ObRole {
  const role = trim(body.ob_role);
  if (role === 'mlo' || role === 'owner') return role;
  throw new Error('Role is required (mlo or owner)');
}

function parseAccountManagement(body: Record<string, unknown>): AccountManagement {
  const v = trim(body.account_management);
  if (v === 'solo' || v === 'internal_team' || v === 'assistant' || v === 'partner') return v;
  throw new Error('Account management style is required');
}

function parseFormVariant(body: Record<string, unknown>): OnboardingFormVariant {
  const v = trim(body.form_variant);
  if (v === 'dscr_performance') return 'dscr_performance';
  return 'core';
}

function parsePerformanceUnit(body: Record<string, unknown>, variant: OnboardingFormVariant): PerformanceUnit | null {
  const raw = trim(body.performance_unit).toLowerCase();
  if (raw === 'leads' || raw === 'conversations') return raw;
  if (variant === 'dscr_performance') {
    throw new Error('Please choose Leads or Conversations');
  }
  return null;
}

function parseCrmChoice(
  body: Record<string, unknown>,
  variant: OnboardingFormVariant,
  unit: PerformanceUnit | null,
): CrmChoice | null {
  const raw = trim(body.crm_choice).toLowerCase();
  if (raw === 'waiz' || raw === 'client') return raw;
  if (variant === 'dscr_performance' && unit === 'leads') {
    throw new Error('Please choose whose CRM you will use');
  }
  return null;
}

export function parseOnboardingFormFields(body: Record<string, unknown>): OnboardingFormInput {
  const form_variant = parseFormVariant(body);
  const account_management = parseAccountManagement(body);
  const ob_role = parseObRole(body);
  const email = trim(body.email);
  const phone = trim(body.phone);
  if (!email && !phone) {
    throw new Error('Email or phone is required so we can match your account');
  }
  if (!email) throw new Error('Email is required');
  if (!phone) throw new Error('Phone is required');

  const first_name = trim(body.first_name) || null;
  const last_name = trim(body.last_name) || null;
  if (form_variant === 'dscr_performance') {
    if (!first_name) throw new Error('First name is required');
    if (!last_name) throw new Error('Last name is required');
  }

  const performance_unit = parsePerformanceUnit(body, form_variant);
  const crm_choice = parseCrmChoice(body, form_variant, performance_unit);

  const nmls = trim(body.nmls);
  const states_licensed = normalizeStatesLicensed(body.states_licensed) ?? [];
  const city = trim(body.city);
  const state = trim(body.state).toUpperCase().slice(0, 2);

  const timezone = trim(body.timezone);
  if (timezone && !isKnownUsClientTimezone(timezone)) {
    throw new Error('Please select a valid US timezone');
  }

  const biography = trim(body.biography);
  const review_url = trim(body.review_url) || null;
  if (review_url && !/^https?:\/\/.+/i.test(review_url)) {
    throw new Error('Review URL must start with http:// or https://');
  }

  let brokerage_name = trim(body.brokerage_name);
  let legal_business_name = trim(body.legal_business_name);
  let website = trim(body.website);
  let company_nmls = trim(body.company_nmls);
  const company_address = parseCompanyAddress(body);
  let company_states_licensed = normalizeStatesLicensed(body.company_states_licensed) ?? [];

  if (ob_role === 'mlo') {
    if (!brokerage_name) throw new Error('Company name is required');
  } else {
    const company_name = trim(body.company_name) || legal_business_name || brokerage_name;
    if (!company_name) throw new Error('Company name is required');
    brokerage_name = company_name;
    legal_business_name = company_name;
    if (!website) throw new Error('Company website is required');
    if (!company_nmls) throw new Error('Company NMLS is required');
    if (!company_address.street || !company_address.city || !company_address.state || !company_address.zip) {
      throw new Error('Full company address is required');
    }
    if (!company_states_licensed.length) {
      throw new Error('At least one company licensed state is required');
    }
  }

  const additional_members = parseMembers(body);
  const person_notes = Array.isArray(body.person_notes)
    ? body.person_notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
    : [];

  return {
    form_variant,
    first_name,
    last_name,
    account_management,
    ob_role,
    email,
    phone,
    nmls,
    states_licensed,
    brokerage_name,
    legal_business_name,
    website: ob_role === 'owner' ? website : '',
    company_nmls: ob_role === 'owner' ? company_nmls : '',
    company_address: ob_role === 'owner' ? company_address : { street: '', city: '', state: '', zip: '' },
    company_states_licensed: ob_role === 'owner' ? company_states_licensed : [],
    biography,
    review_url,
    street_address: trim(body.street_address),
    city,
    state,
    zip_code: trim(body.zip_code),
    timezone,
    performance_unit,
    crm_choice,
    headshot_url: trim(body.headshot_url) || null,
    person_notes,
    additional_members,
  };
}

export function obRoleToContactRole(ob_role: ObRole): string {
  return ob_role === 'owner' ? 'Broker Owner' : 'MLO';
}

export function primaryContactNameFromInput(input: OnboardingFormInput): string | null {
  const name = [input.first_name, input.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

export function onboardingToClientPatch(input: OnboardingFormInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    email: input.email,
    billing_email: input.email,
    phone: input.phone,
    contact_role: obRoleToContactRole(input.ob_role),
  };
  if (input.nmls) patch.nmls = input.nmls;
  if (input.states_licensed.length) patch.states_licensed = input.states_licensed;
  if (input.biography) patch.biography = input.biography;
  if (input.street_address) patch.street_address = input.street_address;
  if (input.city) patch.city = input.city;
  if (input.state) patch.state = input.state;
  if (input.zip_code) patch.zip_code = input.zip_code;
  if (input.timezone) patch.timezone = input.timezone;

  const fullName = primaryContactNameFromInput(input);
  if (fullName) {
    patch.primary_contact_name = fullName;
    patch.primary_contact = fullName;
  }

  if (input.brokerage_name) patch.brokerage_name = input.brokerage_name;
  if (input.legal_business_name) patch.legal_business_name = input.legal_business_name;
  if (input.website) patch.website = input.website;
  if (input.headshot_url) patch.headshot_url = input.headshot_url;

  return patch;
}

export function onboardingResponsesFromInput(input: OnboardingFormInput): Record<string, unknown> {
  return {
    form_variant: input.form_variant,
    first_name: input.first_name,
    last_name: input.last_name,
    account_management: input.account_management,
    ob_role: input.ob_role,
    email: input.email,
    phone: input.phone,
    nmls: input.nmls,
    states_licensed: input.states_licensed,
    brokerage_name: input.brokerage_name,
    legal_business_name: input.legal_business_name,
    website: input.website || null,
    company_nmls: input.company_nmls || null,
    company_address: input.ob_role === 'owner' ? input.company_address : null,
    company_states_licensed: input.company_states_licensed.length ? input.company_states_licensed : null,
    biography: input.biography,
    review_url: input.review_url,
    street_address: input.street_address,
    city: input.city,
    state: input.state,
    zip_code: input.zip_code,
    timezone: input.timezone,
    performance_unit: input.performance_unit,
    crm_choice: input.crm_choice,
    headshot_url: input.headshot_url ?? null,
    additional_members: input.additional_members,
    match_email: normalizeEmailForMatch(input.email),
    match_phone: normalizePhoneForMatch(input.phone),
  };
}

export const ONBOARDING_OVERFLOW_NOTE_MARKER = 'Onboarding';
const PREVIOUS_ONBOARDING_NOTE_MARKER = 'Onboarding — Extra details';

export { PREVIOUS_ONBOARDING_NOTE_MARKER };

function formatCompanyAddress(address: CompanyAddress): string {
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [address.street, cityLine].filter(Boolean).join('\n');
}

/** Full onboarding submission for Client notes. */
export function onboardingOverflowNoteSections(
  input: OnboardingFormInput,
): { label: string; value: string }[] {
  const sections: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text && text !== '—') sections.push({ label, value: text });
  };

  add('Form', input.form_variant === 'dscr_performance' ? 'DSCR performance' : 'Core');
  const management = ACCOUNT_MANAGEMENT_OPTIONS.find(option => option.value === input.account_management);
  add('Account management', management?.label);
  add('Role', input.ob_role === 'owner' ? 'Owner of brokerage / lender' : input.ob_role === 'mlo' ? 'MLO' : input.ob_role);
  add('Brokerage', input.brokerage_name);
  add('Legal business name', input.legal_business_name);
  add('Website', input.website);
  add('Company NMLS', input.company_nmls);
  add('Company address', formatCompanyAddress(input.company_address));
  if (input.company_states_licensed.length) {
    add('Company licensed states', formatStatesLicensed(input.company_states_licensed));
  }
  const unit = PERFORMANCE_UNIT_OPTIONS.find(option => option.value === input.performance_unit);
  add('Leads or Conversations', unit?.label);
  const crm = CRM_CHOICE_OPTIONS.find(option => option.value === input.crm_choice);
  add('CRM', crm?.label);
  if (input.additional_members.length) {
    add(
      'Team members',
      input.additional_members
        .map(member =>
          [member.name, member.contact_type, member.email, member.phone, member.nmls, member.states_licensed?.join(', ')]
            .filter(Boolean)
            .join(' · '),
        )
        .join('\n'),
    );
  }
  return sections;
}

export const ONBOARDING_FIELD_LABELS: Record<string, string> = {
  form_variant: 'Form variant',
  first_name: 'First name',
  last_name: 'Last name',
  account_management: 'Account management',
  ob_role: 'Role',
  email: 'Email',
  phone: 'Phone',
  nmls: 'NMLS',
  states_licensed: 'States licensed',
  brokerage_name: 'Brokerage / lender',
  legal_business_name: 'Legal business name',
  website: 'Company website',
  company_nmls: 'Company NMLS',
  company_address: 'Company address',
  company_states_licensed: 'Company licensed states',
  biography: 'Bio',
  review_url: 'Review link',
  street_address: 'Street address',
  city: 'City',
  state: 'State',
  zip_code: 'ZIP code',
  timezone: 'Timezone',
  performance_unit: 'Leads or Conversations',
  crm_choice: 'CRM',
  headshot_url: 'Headshot',
  additional_members: 'Team members',
};

/** Build multipart body fields from wizard draft for API submit. */
export function draftToSubmitBody(
  draft: {
    first_name: string;
    last_name: string;
    account_management: string;
    ob_role: string;
    brokerage_name: string;
    company_name: string;
    website: string;
    company_nmls: string;
    company_address: CompanyAddress;
    company_states_licensed: string[];
    nmls: string;
    phone: string;
    email: string;
    states_licensed: string[];
    street_address: string;
    city: string;
    state: string;
    zip_code: string;
    timezone: string;
    performance_unit: string;
    crm_choice: string;
    review_url: string;
    biography: string;
    person_notes?: string[];
    additional_members: MemberDraft[];
  },
  formVariant: OnboardingFormVariant = 'core',
): Record<string, string> {
  const members = draft.additional_members
    .filter(m => m.contact_type && m.name.trim())
    .map(m => ({
      contact_type: m.contact_type,
      name: m.name.trim(),
      email: m.email.trim() || null,
      phone: m.phone.trim() || null,
      nmls: m.nmls.trim() || null,
      states_licensed: m.states_licensed.length ? m.states_licensed : null,
      profile: {
        ...(m.biography.trim() ? { biography: m.biography.trim() } : {}),
        ...(m.review_url.trim() ? { review_url: m.review_url.trim() } : {}),
        ...(m.timezone.trim() ? { timezone: m.timezone.trim() } : {}),
        ...(m.personal_address.trim() ? { personal_address: m.personal_address.trim() } : {}),
      },
      notes: m.notes.map(note => note.trim()).filter(Boolean),
    }));

  return {
    form_variant: formVariant,
    first_name: draft.first_name,
    last_name: draft.last_name,
    account_management: draft.account_management,
    ob_role: draft.ob_role,
    brokerage_name: draft.brokerage_name,
    company_name: draft.company_name,
    legal_business_name: draft.company_name,
    website: draft.website,
    company_nmls: draft.company_nmls,
    company_street: draft.company_address.street,
    company_city: draft.company_address.city,
    company_state: draft.company_address.state,
    company_zip: draft.company_address.zip,
    company_states_licensed: JSON.stringify(draft.company_states_licensed),
    nmls: draft.nmls,
    phone: draft.phone,
    email: draft.email,
    states_licensed: JSON.stringify(draft.states_licensed),
    street_address: draft.street_address,
    city: draft.city,
    state: draft.state,
    zip_code: draft.zip_code,
    timezone: draft.timezone,
    performance_unit: draft.performance_unit,
    crm_choice: draft.crm_choice,
    review_url: draft.review_url,
    biography: draft.biography,
    person_notes: JSON.stringify(draft.person_notes ?? []),
    additional_members: JSON.stringify(members),
  };
}
