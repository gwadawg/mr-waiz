import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MB_ACTIVITY_SELECT,
  MB_AGENT_SELECT,
  MB_CALL_TYPES,
  MB_CHANGE_LAYERS,
  MB_CHANGE_SELECT,
  MB_CLIENT_SELECT,
  MB_CONTACT_SELECT,
  mbFulfillment,
  mbPackage,
  toMbPerformance,
} from './mb-api';
import type { MetricsResult } from './metrics';

const FORBIDDEN = [
  'mrr',
  'billing_email',
  'billing_type',
  'ghl_location_id',
  'ghl_subaccount_url',
  'base_salary',
  'pay_per_',
  'recording_url',
  'commission',
];

function forbiddenHits(select: string): string[] {
  const lower = select.toLowerCase();
  return FORBIDDEN.filter(key => lower.includes(key));
}

describe('media-buyer brief selects', () => {
  it('keeps money, pay, GHL login, and recordings out of the column lists', () => {
    for (const select of [
      MB_CLIENT_SELECT,
      MB_CONTACT_SELECT,
      MB_AGENT_SELECT,
      MB_ACTIVITY_SELECT,
      MB_CHANGE_SELECT,
    ]) {
      assert.deepEqual(forbiddenHits(select), []);
    }
  });

  it('keeps the client fields the brief promised', () => {
    for (const column of [
      'sales_package',
      'service_program',
      'street_address',
      'drive_folder_url',
      'daily_adspend',
      'ad_account_url',
      'landing_page_url',
      'states_licensed',
    ]) {
      assert.match(MB_CLIENT_SELECT, new RegExp(`\\b${column}\\b`));
    }
    assert.deepEqual([...MB_CALL_TYPES], ['onboarding', 'launch']);
    assert.deepEqual([...MB_CHANGE_LAYERS], ['L1', 'L2']);
  });
});

describe('media-buyer labels', () => {
  it('does not invent a package when the field is blank', () => {
    assert.deepEqual(mbPackage(null), { code: null, label: null });
    assert.deepEqual(mbPackage('  '), { code: null, label: null });
  });

  it('labels the package and the fulfillment flag separately', () => {
    assert.equal(mbPackage('core_offer').label, 'Call Center');
    assert.equal(mbPackage('mid_offer').label, 'Leads Only');
    assert.equal(mbPackage('skool').label, 'Skool');
    assert.equal(mbFulfillment('RM', 'lead_gen').label, 'Leads Only');
    assert.equal(mbFulfillment('CALL_CENTER', null).label, 'HE');
    assert.equal(mbFulfillment('RM', 'core').label, 'Call Center');
  });
});

describe('toMbPerformance', () => {
  it('copies client ad spend and closings, and drops Waiz money', () => {
    const out = toMbPerformance({
      ad_spend: 80,
      new_leads: 4,
      outbound_dials: 12,
      loan_volume: 250000,
      funded_deals: 1,
      commission_total: 9000,
      roas: 100,
      billable_conversations: 3,
    } as MetricsResult);

    assert.equal(out.ad_spend, 80);
    assert.equal(out.leads, 4);
    assert.equal(out.outbound_dials, 12);
    assert.equal(out.loan_volume, 250000);
    assert.equal('commission_total' in out, false);
    assert.equal('roas' in out, false);
    assert.equal('billable_conversations' in out, false);
    assert.equal('mrr' in out, false);
  });
});
