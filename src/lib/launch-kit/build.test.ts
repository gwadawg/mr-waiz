import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLaunchKitBlocks, EXPECTED_H1_ORDER, flattenBlockText, formatLongDate } from './build';
import {
  clientPatchFromDraft,
  dialOwnerFromClient,
  draftFromClient,
  draftFromResponses,
  draftToResponses,
  emptyLaunchKitDraft,
  launchKitSlug,
  launchKitStoragePath,
  productFromReportingType,
  resolveVariant,
  TO_FILL,
  validateForGenerate,
  type LaunchKitClient,
  type LaunchKitDraft,
} from './intake';
import type { KitVariant } from './types';

const client: LaunchKitClient = {
  id: 'c1',
  name: 'Hale Capital Lending',
  lifecycle_status: 'onboarding',
  primary_contact_name: 'Jordan Hale',
  brokerage_name: 'Hale Capital Lending',
  legal_business_name: null,
  reporting_type: 'RM',
  service_program: 'lead_gen',
  launch_date: '2026-09-15',
  slack_id: 'C0123456789',
  funnel_url: 'https://example.com/hale-rm',
  ghl_subaccount_url: 'https://example.com/crm/hale',
  drive_folder_url: 'https://drive.google.com/drive/folders/hale',
  states_licensed: ['FL'],
  ghl_location_id: 'loc_1',
  nmls: '1987654',
  phone_ghl: '+1 (555) 010-2000',
  phone_live_transfer: '+1 (555) 010-2001',
  phone_notifications: '+1 (555) 010-2002',
  virtual_business_card_url: 'https://loanofficer.me/jordan-hale',
  facebook_page_name: 'Hale Capital Lending',
};

function completeDraft(overrides: Partial<LaunchKitDraft> = {}): LaunchKitDraft {
  return {
    ...emptyLaunchKitDraft(),
    product: 'rm',
    dial_owner: 'client',
    contact_first_name: 'Jordan',
    company_name: 'Hale Capital Lending',
    go_live_date: '2026-09-15',
    csm_name: 'Laura',
    slack_channel_name: 'hale-capital',
    who_works_leads: 'Jordan + VA',
    speed_standard: '',
    funnel_url: 'https://example.com/hale-rm',
    crm_url: 'https://example.com/crm/hale',
    launch_kit_folder_url: 'https://drive.google.com/drive/folders/hale-kit',
    legal_notice_url: 'https://halecapital.example/legal',
    phone_prospecting: '+1 (555) 010-2000',
    phone_live_transfer: '+1 (555) 010-2001',
    virtual_card_url: 'https://loanofficer.me/jordan-hale',
    facebook_page: 'Hale Capital Lending',
    lead_logging_form_url: 'https://forms.example.com/hale-leads',
    nmls: '1987654',
    states_licensed: 'FL',
    ...overrides,
  };
}

const VARIANTS: KitVariant[] = [
  { product: 'rm', dialOwner: 'client' },
  { product: 'rm', dialOwner: 'waiz' },
  { product: 'dscr', dialOwner: 'client' },
  { product: 'dscr', dialOwner: 'waiz' },
];

/** Internal-only vocabulary that must never reach a client PDF. */
const FORBIDDEN = [
  'A-Z',
  'Andromeda',
  'Mr. Waiz',
  'docs/',
  'SOP',
  'internal-fulfillment',
  'CPL target',
  'kickoff form',
  'QA checklist',
  '$',
];

describe('variant resolution', () => {
  it('maps reporting_type to product; CALL_CENTER / blank require a choice', () => {
    assert.equal(productFromReportingType('RM'), 'rm');
    assert.equal(productFromReportingType('Reverse Mortgage'), 'rm');
    assert.equal(productFromReportingType('DSCR'), 'dscr');
    assert.equal(productFromReportingType('CALL_CENTER'), '');
    assert.equal(productFromReportingType('HE'), '');
    assert.equal(productFromReportingType(null), '');
  });

  it('maps service_program to dial owner; core = Waiz, lead_gen = client, CALL_CENTER = Waiz', () => {
    assert.equal(dialOwnerFromClient('RM', 'core'), 'waiz');
    assert.equal(dialOwnerFromClient('DSCR', 'lead_gen'), 'client');
    assert.equal(dialOwnerFromClient('CALL_CENTER', null), 'waiz');
    assert.equal(dialOwnerFromClient('RM', null), '');
  });

  it('resolveVariant returns null until both axes are chosen', () => {
    assert.equal(resolveVariant({ product: 'rm', dial_owner: '' }), null);
    assert.deepEqual(resolveVariant({ product: 'dscr', dial_owner: 'waiz' }), { product: 'dscr', dialOwner: 'waiz' });
  });
});

describe('prefill', () => {
  it('prefills from clients columns and derives first name', () => {
    const d = draftFromClient(client);
    assert.equal(d.product, 'rm');
    assert.equal(d.dial_owner, 'client');
    assert.equal(d.contact_first_name, 'Jordan');
    assert.equal(d.company_name, 'Hale Capital Lending');
    assert.equal(d.go_live_date, '2026-09-15');
    assert.equal(d.funnel_url, 'https://example.com/hale-rm');
    assert.equal(d.crm_url, 'https://example.com/crm/hale');
    assert.equal(d.launch_kit_folder_url, 'https://drive.google.com/drive/folders/hale');
    assert.equal(d.who_works_leads, 'Jordan and your team');
    assert.equal(d.phone_prospecting, '+1 (555) 010-2000');
    assert.equal(d.phone_live_transfer, '+1 (555) 010-2001');
    assert.equal(d.phone_notifications, '+1 (555) 010-2002');
    assert.equal(d.virtual_card_url, 'https://loanofficer.me/jordan-hale');
    assert.equal(d.facebook_page, 'Hale Capital Lending');
    assert.equal(d.nmls, '1987654');
    assert.equal(d.states_licensed, 'FL');
  });

  it('normalizes a timestamp go-live date from the client file', () => {
    const d = draftFromClient({ ...client, launch_date: '2026-09-15T12:00:00.000Z' });
    assert.equal(d.go_live_date, '2026-09-15');
  });

  it('client file wins for owned columns; last kit fills only kit-only blanks', () => {
    const last = draftToResponses(
      completeDraft({
        csm_name: 'Sam',
        funnel_url: 'https://old.example.com',
        launch_kit_folder_url: 'https://kit',
        facebook_page: 'Kit Facebook Name',
        nmls: '999',
        phone_prospecting: '+1 old',
        virtual_card_url: 'https://loanofficer.me/old',
        states_licensed: 'TX',
        contact_first_name: 'KitName',
        company_name: 'Kit Company',
      }),
    );
    const d = draftFromClient(client, last);
    assert.equal(d.csm_name, 'Sam');
    assert.equal(d.funnel_url, 'https://example.com/hale-rm');
    assert.equal(d.launch_kit_folder_url, 'https://kit');
    assert.equal(d.facebook_page, 'Hale Capital Lending');
    assert.equal(d.nmls, '1987654');
    assert.equal(d.phone_prospecting, '+1 (555) 010-2000');
    assert.equal(d.virtual_card_url, 'https://loanofficer.me/jordan-hale');
    assert.equal(d.states_licensed, 'FL');
    assert.equal(d.contact_first_name, 'Jordan');
    assert.equal(d.company_name, 'Hale Capital Lending');
  });

  it('falls back to the last kit when the client column is empty', () => {
    const last = draftToResponses(completeDraft({
      phone_notifications: '+1 draft-notify',
      legal_notice_url: 'https://kit.example/legal',
    }));
    const d = draftFromClient({ ...client, phone_notifications: null }, last);
    assert.equal(d.phone_notifications, '+1 draft-notify');
    assert.equal(d.legal_notice_url, 'https://kit.example/legal');
  });

  it('responses round-trip', () => {
    const d = completeDraft({ property_na: { legal_notice_url: true }, legal_notice_url: '' });
    const back = draftFromResponses(draftToResponses(d));
    assert.deepEqual(back, d);
  });
});

describe('validateForGenerate', () => {
  it('accepts a complete draft', () => {
    assert.deepEqual(validateForGenerate(completeDraft()), []);
  });

  it('rejects missing URLs unless marked N/A', () => {
    const errs = validateForGenerate(completeDraft({ launch_kit_folder_url: '' }));
    assert.ok(errs.some(e => e.startsWith('Launch Kit folder URL is missing')));
    assert.deepEqual(
      validateForGenerate(completeDraft({ launch_kit_folder_url: '', property_na: { launch_kit_folder_url: true } })),
      [],
    );
  });

  it('funnel and CRM can never be N/A', () => {
    const errs = validateForGenerate(completeDraft({ property_na: { funnel_url: true, crm_url: true } }));
    assert.ok(errs.some(e => e.includes('WM Apex Funnel cannot be marked N/A')));
    assert.ok(errs.some(e => e.includes('CRM cannot be marked N/A')));
  });

  it('rejects missing review fields unless marked N/A, and allows a blank notification number', () => {
    const errs = validateForGenerate(completeDraft({ legal_notice_url: '' }));
    assert.ok(errs.some(e => e.startsWith('Legal notice is missing')));
    assert.deepEqual(
      validateForGenerate(completeDraft({ legal_notice_url: '', property_na: { legal_notice_url: true } })),
      [],
    );
    assert.deepEqual(validateForGenerate(completeDraft({ phone_notifications: '' })), []);
  });

  it('requires NMLS and states licensed for the receipt', () => {
    const errs = validateForGenerate(completeDraft({ nmls: '', states_licensed: '' }));
    assert.ok(errs.some(e => e.startsWith('NMLS is required')));
    assert.ok(errs.some(e => e.startsWith('States licensed is required')));
  });

  it('requires the lead logging form URL', () => {
    const missing = validateForGenerate(completeDraft({ lead_logging_form_url: '' }));
    assert.ok(missing.some(e => e.startsWith('Lead logging form URL is required')));
    const invalid = validateForGenerate(completeDraft({ lead_logging_form_url: 'forms.example.com/hale' }));
    assert.ok(invalid.some(e => e.startsWith('Lead logging form must be a full http(s) URL')));
  });

  it('validates selected resource rows', () => {
    const errs = validateForGenerate(completeDraft({
      resources: [{ source: 'manual', title: '', description: 'Use this first', url: 'drive.google.com/file' }],
    }));
    assert.ok(errs.some(e => e.startsWith('Resource 1 title is required')));
    assert.ok(errs.some(e => e.includes('must be a full http(s) URL')));
  });

  it('rejects [TO FILL] anywhere and non-http URLs', () => {
    const errs = validateForGenerate(completeDraft({ slack_channel_name: TO_FILL, funnel_url: 'notaurl' }));
    assert.ok(errs.some(e => e.includes(`Slack channel still contains ${TO_FILL}`)));
    assert.ok(errs.some(e => e.includes('WM Apex Funnel must be a full http(s) URL')));
  });

  it('requires both axes and the operator fields', () => {
    const errs = validateForGenerate({ ...emptyLaunchKitDraft() });
    assert.ok(errs.some(e => e.startsWith('Choose the product')));
    assert.ok(errs.some(e => e.startsWith('Choose who works')));
    assert.ok(errs.some(e => e.startsWith('CSM name')));
  });
});

describe('buildLaunchKitBlocks', () => {
  for (const variant of VARIANTS) {
    it(`${variant.product}/${variant.dialOwner}: fixed section order, no internal copy, no placeholders`, () => {
      const draft = completeDraft({ product: variant.product, dial_owner: variant.dialOwner });
      const { blocks, cover } = buildLaunchKitBlocks(draft, { version: 1, clientName: client.name });
      const h1s = blocks.filter(b => b.type === 'h1').map(b => ('text' in b ? b.text : ''));
      assert.equal(h1s.length, EXPECTED_H1_ORDER.length);
      assert.ok(h1s[0].startsWith(EXPECTED_H1_ORDER[0]), `welcome heading: ${h1s[0]}`);
      assert.deepEqual(h1s.slice(1), [...EXPECTED_H1_ORDER.slice(1)]);

      const text = flattenBlockText(blocks).join('\n');
      for (const word of FORBIDDEN) {
        assert.equal(text.includes(word), false, `forbidden "${word}" leaked in ${variant.product}/${variant.dialOwner}`);
      }
      assert.equal(text.includes(TO_FILL), false);
      assert.equal(cover.productLabel, variant.product === 'rm' ? 'Reverse mortgage' : 'DSCR');
      assert.equal(cover.goLiveLabel, '15 September 2026');
      assert.equal(cover.welcomeName, 'Jordan');
      assert.equal(cover.subtitle, 'Hale Capital Lending');
    });
  }

  it('includes Please review and On file sections', () => {
    const { blocks, cover } = buildLaunchKitBlocks(completeDraft(), { version: 1, clientName: client.name });
    const text = flattenBlockText(blocks).join('\n');
    assert.ok(text.includes('Please review'));
    assert.ok(text.includes('On file with us'));
    assert.ok(text.includes('Legal notice (compliance approve)'));
    assert.ok(text.includes('Go High Level number'));
    assert.ok(text.includes('Live transfer number'));
    assert.ok(text.includes('Save the Go High Level number in your contacts'));
    assert.ok(text.includes('Virtual business card'));
    assert.equal(text.includes('Notification number'), false);
    assert.equal(text.includes('Market'), false);
    assert.equal(text.includes('Training (Skool)'), false);
    assert.equal(text.includes('Perspective'), false);
    assert.ok(text.includes('Lead logging form'));
    assert.ok(text.includes('https://forms.example.com/hale-leads'));
    assert.ok(text.includes('https://loanofficer.me/jordan-hale'));
    assert.ok(text.includes('1987654'));
    assert.ok(text.includes('States licensed'));
    assert.equal(cover.welcomeName, 'Jordan');
  });

  it('shows declined label when legal notice is marked N/A', () => {
    const { blocks } = buildLaunchKitBlocks(
      completeDraft({ legal_notice_url: '', property_na: { legal_notice_url: true } }),
      { version: 1, clientName: client.name },
    );
    const text = flattenBlockText(blocks).join('\n');
    assert.ok(text.includes('Declined / not part of this account'));
  });

  it('lists a filled notification number and omits it when blank', () => {
    const filled = flattenBlockText(
      buildLaunchKitBlocks(completeDraft({ phone_notifications: '+1 (555) 010-2002' }), { version: 1, clientName: 'x' }).blocks,
    ).join('\n');
    assert.ok(filled.includes('Notification number'));
    assert.ok(filled.includes('+1 (555) 010-2002'));
    const blank = flattenBlockText(
      buildLaunchKitBlocks(completeDraft({ phone_notifications: '' }), { version: 1, clientName: 'x' }).blocks,
    ).join('\n');
    assert.equal(blank.includes('Notification number'), false);
  });

  it('client-dials variants list the Drive playbook folder; waiz-dials variants do not', () => {
    const clientKit = buildLaunchKitBlocks(completeDraft({ product: 'dscr', dial_owner: 'client' }), { version: 1, clientName: 'x' });
    const waizKit = buildLaunchKitBlocks(completeDraft({ product: 'dscr', dial_owner: 'waiz' }), { version: 1, clientName: 'x' });
    const clientText = flattenBlockText(clientKit.blocks).join('\n');
    const waizText = flattenBlockText(waizKit.blocks).join('\n');
    assert.ok(clientText.includes('DSCR-Prospecting-Playbook.pdf'));
    assert.ok(clientText.includes('DSCR-Cash-Out-Drip.md'));
    assert.ok(clientText.includes('05-Playbooks'));
    assert.equal(waizText.includes('DSCR-Prospecting-Playbook.pdf'), false);
    assert.equal(waizText.includes('05-Playbooks'), false);
    assert.ok(waizText.includes('owns SMS and booking'));
  });

  it('uses selected resource links when provided', () => {
    const { blocks } = buildLaunchKitBlocks(
      completeDraft({
        resources: [
          {
            id: 'resource-1',
            source: 'resources',
            title: 'Reverse Mortgage Ads Playbook',
            description: 'How the ads are meant to feel',
            url: 'https://drive.google.com/file/d/playbook',
          },
        ],
      }),
      { version: 1, clientName: 'x' },
    );
    const text = flattenBlockText(blocks).join('\n');
    assert.ok(text.includes('Reverse Mortgage Ads Playbook - How the ads are meant to feel'));
    assert.ok(text.includes('How the ads are meant to feel'));
    assert.ok(text.includes('https://drive.google.com/file/d/playbook'));
    assert.equal(text.includes('Your CSM will share the playbooks'), false);
    assert.equal(text.includes('Lead Nurture Playbook (Waiz Meta Stack)'), false);
  });

  it('names no internal playbook when no client resource is selected', () => {
    const text = flattenBlockText(buildLaunchKitBlocks(completeDraft(), { version: 1, clientName: 'x' }).blocks).join('\n');
    assert.ok(text.includes('Your CSM will share the playbooks that apply to this account.'));
    assert.equal(text.includes('Lead Nurture Playbook (Waiz Meta Stack)'), false);
    assert.equal(text.includes('BAMFAM Playbook'), false);
  });

  it('drafts render blanks as [TO FILL] and skip N/A properties', () => {
    const draft = completeDraft({ csm_name: '', launch_kit_folder_url: '', property_na: { launch_kit_folder_url: true } });
    const { blocks } = buildLaunchKitBlocks(draft, { version: 2, clientName: 'x' });
    const text = flattenBlockText(blocks).join('\n');
    assert.ok(text.includes(TO_FILL));
    assert.equal(text.includes('Launch Kit folder'), false);
    assert.equal(text.includes('Training (Skool)'), false);
  });

  it('speed standard is only stated when sold', () => {
    const none = flattenBlockText(buildLaunchKitBlocks(completeDraft(), { version: 1, clientName: 'x' }).blocks).join('\n');
    assert.ok(none.includes('We never invent a number in this kit'));
    const sold = flattenBlockText(
      buildLaunchKitBlocks(completeDraft({ speed_standard: 'call within 5 minutes during business hours' }), { version: 1, clientName: 'x' }).blocks,
    ).join('\n');
    assert.ok(sold.includes('as agreed on your kickoff: call within 5 minutes'));
  });

  it('go-live renders with weekday in the at-a-glance table', () => {
    const text = flattenBlockText(buildLaunchKitBlocks(completeDraft(), { version: 1, clientName: 'x' }).blocks).join('\n');
    assert.ok(text.includes('Tuesday, 15 September 2026'));
    assert.ok(text.includes('#hale-capital'));
  });
});

describe('helpers', () => {
  it('client patch writes changed funnel, CRM, phones, and virtual card', () => {
    assert.deepEqual(clientPatchFromDraft(completeDraft(), client), {});
    assert.deepEqual(
      clientPatchFromDraft(completeDraft({ funnel_url: 'https://new.example.com' }), client),
      { funnel_url: 'https://new.example.com' },
    );
    assert.deepEqual(
      clientPatchFromDraft(
        completeDraft({
          facebook_page: 'Changed Page',
          nmls: '000',
          phone_prospecting: '+1 999',
          phone_notifications: '+1 888',
          virtual_card_url: 'https://loanofficer.me/new',
        }),
        client,
      ),
      {
        phone_ghl: '+1 999',
        phone_notifications: '+1 888',
        virtual_business_card_url: 'https://loanofficer.me/new',
      },
    );
  });

  it('slug + storage path', () => {
    assert.equal(launchKitSlug('Hale Capital Lending', 'x'), 'hale-capital-lending');
    assert.equal(launchKitSlug('  ', 'Fallback & Co'), 'fallback-and-co');
    assert.equal(launchKitStoragePath('c1', 'hale', 3), 'c1/hale-launch-kit-v3.pdf');
  });

  it('formatLongDate', () => {
    assert.equal(formatLongDate('2026-09-15'), '15 September 2026');
    assert.equal(formatLongDate(''), TO_FILL);
  });
});
