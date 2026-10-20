import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMarkedClientNote } from '@/lib/client-form-notes';
import { emptyChurnDraft, churnClientFileNoteSections } from '@/lib/churn-form';
import {
  applyKickoffSavedNarrative,
  isKickoffIncomplete,
  kickoffClientFileNote,
  kickoffDraftFromClient,
  kickoffNarrativeFromResponses,
  type KickoffClient,
} from '@/lib/kickoff';
import { onboardingOverflowNoteSections, type OnboardingFormInput } from '@/lib/onboarding-form';

const client: KickoffClient = {
  id: 'c1',
  name: 'Russell Tunick',
  lifecycle_status: 'onboarding',
  primary_contact_name: 'Russell Tunick',
  phone: '555',
  contact_role: 'Loan Officer',
  states_licensed: ['FL'],
  nmls: '1',
  brokerage_name: 'Go Rascal',
  timezone: 'America/New_York',
  appointment_settings: null,
  daily_adspend: null,
  facebook_page_name: null,
  phone_notifications: null,
  phone_live_transfer: null,
  live_transfer_approved: null,
  ghl_location_id: null,
  reporting_type: 'RM',
  service_program: 'core',
  offer: 'RM',
};

function overflowInput(patch: Partial<OnboardingFormInput> = {}): OnboardingFormInput {
  return {
    form_variant: 'core',
    first_name: 'Russ',
    last_name: 'Tunick',
    account_management: 'solo',
    ob_role: 'mlo',
    email: 'russ@example.com',
    phone: '555',
    nmls: '1',
    states_licensed: ['FL'],
    brokerage_name: 'Go Rascal',
    legal_business_name: '',
    website: '',
    company_nmls: '',
    company_address: { street: '', city: '', state: '', zip: '' },
    company_states_licensed: [],
    biography: 'Bio on the profile',
    review_url: null,
    street_address: '1 Main',
    city: 'Miami',
    state: 'FL',
    zip_code: '33101',
    timezone: 'America/New_York',
    performance_unit: null,
    crm_choice: null,
    additional_members: [],
    ...patch,
  };
}

describe('client form notes', () => {
  it('formats filled sections under a marker and drops blanks', () => {
    const body = formatMarkedClientNote('Kick-off — Brand & landing notes', [
      { label: 'Landing page copy notes', value: 'REMEMBER ITS ATI REVERSE' },
      { label: 'Competitor references', value: '   ' },
      { label: 'Brand colors / asset links', value: 'https://russelltunick.com/about-russ/' },
    ]);
    assert.equal(
      body,
      [
        'Kick-off — Brand & landing notes',
        'Landing page copy notes\nREMEMBER ITS ATI REVERSE',
        'Brand colors / asset links\nhttps://russelltunick.com/about-russ/',
      ].join('\n\n'),
    );
  });

  it('returns null when every section is blank', () => {
    assert.equal(formatMarkedClientNote('Marker', [{ label: 'Notes', value: '  ' }]), null);
  });

  it('builds a kickoff brand note and reloads it onto an empty draft', () => {
    const draft = kickoffDraftFromClient(client);
    draft.pm_landing_copy = 'REMEMBER ITS ATI REVERSE';
    draft.pm_brand_assets = 'Copy the colors from his site.';
    const note = kickoffClientFileNote('marketing_core', draft);
    assert.ok(note);
    assert.match(note.body, /REMEMBER ITS ATI REVERSE/);
    assert.match(note.body, /Phone\n555/);
    assert.match(note.body, /GHL sub-account name\nRussell Tunick/);
    assert.doesNotMatch(note.body, /Competitor references/);
    draft.transcript = 'Full call transcript that belongs on the call record.';
    const withTranscript = kickoffClientFileNote('marketing_core', draft);
    assert.ok(withTranscript);
    assert.doesNotMatch(withTranscript.body, /Full call transcript/);
    assert.doesNotMatch(withTranscript.body, /OB call transcript/);

    const saved = kickoffNarrativeFromResponses({
      pm_landing_copy: 'REMEMBER ITS ATI REVERSE',
      pm_competitor_refs: null,
    });
    const reloaded = applyKickoffSavedNarrative(kickoffDraftFromClient(client), saved);
    assert.equal(reloaded.pm_landing_copy, 'REMEMBER ITS ATI REVERSE');
    assert.equal(reloaded.pm_competitor_refs, '');
  });

  it('clears later kick-off blocks once the form is filed', () => {
    const onboarding = {
      lifecycle_status: 'onboarding',
      name: 'Jon Meer',
      primary_contact_name: 'Jon Meer',
      ghl_location_id: 'loc_1',
    };
    assert.equal(isKickoffIncomplete(onboarding, null), true);
    assert.equal(isKickoffIncomplete(onboarding, null, true), false);
    assert.equal(isKickoffIncomplete(onboarding, { recording_url: 'https://fathom.video/share/x' }, false), false);
    assert.equal(isKickoffIncomplete({ ...onboarding, lifecycle_status: 'active' }, null), false);
  });

  it('keeps onboarding overflow that has no client column', () => {
    const sections = onboardingOverflowNoteSections(overflowInput({
      company_nmls: '999',
      review_url: 'https://reviews.example/russ',
      company_address: { street: '9 Oak', city: 'Tampa', state: 'FL', zip: '33602' },
    }));
    const labels = sections.map(section => section.label);
    assert.ok(labels.includes('Company NMLS'));
    assert.ok(labels.includes('Review link'));
    assert.ok(labels.includes('Company address'));
    assert.equal(labels.includes('Company licensed states'), false);
    assert.equal(sections.some(section => section.value.includes('Bio on the profile')), true);
  });

  it('keeps churn feedback and internal notes for the client file', () => {
    const draft = emptyChurnDraft('2026-09-28');
    draft.reason_code = 'pricing_cost';
    draft.client_feedback = 'Too expensive for the volume.';
    draft.internal_notes = 'Offer a pause next time.';
    const labels = churnClientFileNoteSections(draft).map(section => section.label);
    assert.ok(labels.includes('Reason'));
    assert.ok(labels.includes('Client feedback'));
    assert.ok(labels.includes('Internal notes'));
    assert.ok(labels.includes('Effective date'));
  });
});
