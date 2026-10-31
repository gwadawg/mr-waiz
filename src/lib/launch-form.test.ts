import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AI_CONTACT_TEST_INBOX_URL,
  AI_CONTACT_TEST_PHONE_DISPLAY,
  emptyLaunchDraft,
  getLaunchItemsForProfile,
  isLaunchChecklistComplete,
  itemsForLaunchResponses,
  launchAdsGateApplies,
  LAUNCH_FINAL_CONFIRMATION,
} from '@/lib/launch-form';

function readyDraft(profile: 'marketing_core' | 'marketing_lead_gen' | 'call_center') {
  const draft = emptyLaunchDraft(profile, '2026-11-01', 'user-1', 'ada@waiz.media', '9495550100');
  draft.recording_url = 'https://example.com/recording';
  draft.final_confirmation = LAUNCH_FINAL_CONFIRMATION;
  if (launchAdsGateApplies(profile)) draft.ads_ready = 'scheduled';
  for (const item of getLaunchItemsForProfile(profile)) {
    draft.checklist[item.key] = true;
    if (item.confirmType === 'type_yes') draft.confirmations[item.key] = 'yes';
  }
  return draft;
}

describe('launch form spot check', () => {
  it('does not ask media-buying creative questions on the live form', () => {
    const labels = getLaunchItemsForProfile('marketing_core').map(item => item.label);
    assert.equal(labels.some(label => /headline|budget|states are being targeted|split test|pixel|privacy policy/i.test(label)), false);
    assert.equal(labels.includes('The ad link opens the live funnel'), true);
  });

  it('locks ad-running accounts until ads are scheduled or published', () => {
    assert.equal(launchAdsGateApplies('marketing_core'), true);
    assert.equal(launchAdsGateApplies('marketing_lead_gen'), true);
    assert.equal(launchAdsGateApplies('call_center'), false);

    const draft = readyDraft('marketing_core');
    assert.equal(isLaunchChecklistComplete(draft, 'marketing_core'), true);
    draft.ads_ready = '';
    assert.equal(isLaunchChecklistComplete(draft, 'marketing_core'), false);

    const dialOnly = readyDraft('call_center');
    assert.equal(isLaunchChecklistComplete(dialOnly, 'call_center'), true);
  });

  it('puts the AI Contact inbox and test number on the booking check', () => {
    const item = getLaunchItemsForProfile('marketing_core').find(row => row.key === 'flow_ai_contact_books');
    assert.ok(item);
    assert.match(item.label, new RegExp(AI_CONTACT_TEST_PHONE_DISPLAY.replace(/[()]/g, '\\$&')));
    assert.equal(item.links?.some(link => link.href === AI_CONTACT_TEST_INBOX_URL), true);
    assert.equal(
      getLaunchItemsForProfile('marketing_lead_gen').some(row => row.key === 'flow_ai_contact_books'),
      false,
    );
  });

  it('still reads an older media-buying submission', () => {
    const items = itemsForLaunchResponses({
      form_profile: 'marketing_core',
      checklist: { mb_budget_set: true, mb_states_targeted: true },
    });
    assert.equal(items.some(item => item.key === 'mb_budget_set'), true);
    assert.equal(items.some(item => item.key === 'flow_ad_opens_funnel'), false);
  });
});
