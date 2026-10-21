import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStateLookerResult,
  finiteDailyAdspend,
  resolveCompanyName,
  resolveGhlSubaccountUrl,
  resolveOfferBlurb,
  rollupDailyAdspend,
} from '@/lib/state-looker';

describe('state-looker directory fields', () => {
  it('resolves company from legal name then account display', () => {
    assert.equal(resolveCompanyName('Acme Brand', 'LO Group'), 'Acme Brand');
    assert.equal(resolveCompanyName(null, 'LO Group'), 'LO Group');
    assert.equal(resolveCompanyName('  ', null), null);
  });

  it('uses custom offer summary when present', () => {
    assert.equal(resolveOfferBlurb('HELOC for investment properties', 'DSCR'), 'HELOC for investment properties');
    assert.match(resolveOfferBlurb(null, 'RM'), /reverse mortgage/i);
  });

  it('resolves GHL subaccount URL from stored url or location id', () => {
    assert.equal(
      resolveGhlSubaccountUrl('https://app.gohighlevel.com/v2/location/abc', null),
      'https://app.gohighlevel.com/v2/location/abc',
    );
    assert.equal(
      resolveGhlSubaccountUrl('app.gohighlevel.com/v2/location/abc', null),
      'https://app.gohighlevel.com/v2/location/abc',
    );
    assert.equal(
      resolveGhlSubaccountUrl(null, 'loc_123'),
      'https://app.gohighlevel.com/v2/location/loc_123',
    );
    assert.equal(resolveGhlSubaccountUrl(null, null), null);
  });

  it('builds team-safe client rows and state index', () => {
    const result = buildStateLookerResult(
      [
        {
          id: 'c1',
          name: 'Acme RM',
          reporting_type: 'RM',
          sales_package: 'core_offer',
          states_licensed: ['TX', 'Texas', 'OK'],
          lifecycle_status: 'active',
          is_live: true,
          account_group_id: 'g1',
          legal_business_name: 'Acme Lending LLC',
          brokerage_name: 'Acme Brokerage',
          nmls: '123456',
          live_transfer_approved: true,
          phone_live_transfer: '555-0100',
          offer_summary: 'Reverse mortgage for seniors',
          website: 'https://acme.example',
          city: 'Austin',
          state: 'TX',
          ghl_location_id: 'loc_c1',
          daily_adspend: '75',
        },
        {
          id: 'c2',
          name: 'Same Co DSCR',
          reporting_type: 'DSCR',
          sales_package: null,
          states_licensed: ['TX'],
          lifecycle_status: 'active',
          is_live: true,
          account_group_id: 'g1',
          legal_business_name: 'Same Name',
          brokerage_name: 'Same Name',
          nmls: null,
          live_transfer_approved: false,
          phone_live_transfer: null,
          offer_summary: null,
          website: null,
          city: null,
          state: 'TX',
          ghl_subaccount_url: 'https://app.gohighlevel.com/v2/location/stored',
        },
      ],
      { g1: { display_name: 'Acme Account' } },
    );

    assert.equal(result.clients.length, 2);
    assert.equal(result.summary.states_covered, 2);
    assert.deepEqual(result.by_state.TX, ['c1', 'c2']);
    assert.deepEqual(result.by_state.OK, ['c1']);

    const c1 = result.clients.find(c => c.id === 'c1')!;
    assert.equal(c1.company_name, 'Acme Lending LLC');
    assert.equal(c1.brokerage_name, 'Acme Brokerage');
    assert.equal(c1.nmls, '123456');
    assert.equal(c1.live_transfer_approved, true);
    assert.equal(c1.phone_live_transfer, '555-0100');
    assert.equal(c1.offer_blurb, 'Reverse mortgage for seniors');
    assert.equal(c1.website, 'https://acme.example');
    assert.equal(c1.city, 'Austin');
    assert.equal(c1.state, 'TX');
    assert.equal(c1.ghl_subaccount_url, 'https://app.gohighlevel.com/v2/location/loc_c1');
    assert.equal(c1.daily_adspend, 75);

    const c2 = result.clients.find(c => c.id === 'c2')!;
    assert.equal(c2.daily_adspend, null);
    assert.equal(c2.company_name, 'Same Name');
    assert.equal(c2.brokerage_name, null, 'duplicate company/brokerage should collapse');
    assert.equal(c2.nmls, null);
    assert.match(c2.offer_blurb, /DSCR/i);
    assert.equal(c2.ghl_subaccount_url, 'https://app.gohighlevel.com/v2/location/stored');
  });
});

describe('daily adspend rollup', () => {
  it('coerces numeric strings and rejects blanks', () => {
    assert.equal(finiteDailyAdspend('120.4'), 120.4);
    assert.equal(finiteDailyAdspend(0), 0);
    assert.equal(finiteDailyAdspend(''), null);
    assert.equal(finiteDailyAdspend('nope'), null);
  });

  it('sums set budgets and counts clients left out', () => {
    assert.deepEqual(
      rollupDailyAdspend([
        { daily_adspend: 100 },
        { daily_adspend: 50 },
        { daily_adspend: null },
        { daily_adspend: 0 },
      ]),
      { total: 150, withBudget: 3, missing: 1 },
    );
  });
});
