import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyLaunchDraft,
  getLaunchItemsForProfile,
  isLaunchChecklistComplete,
  isLaunchItemSatisfied,
  isSubstantiveLaunchEvidence,
  itemsForLaunchResponses,
  LAUNCH_FINAL_CONFIRMATION,
} from '@/lib/launch-form';

const LIVE_KEYS = [
  'tech_ads_budget',
  'tech_make_scenario',
  'tech_lead_end_to_end',
  'tech_launch_packet_sent',
  'tech_team_updated',
  'tech_funnel_pixel',
] as const;

function readyDraft(profile: 'marketing_core' | 'marketing_lead_gen' | 'call_center' = 'marketing_core') {
  const draft = emptyLaunchDraft(profile, '2026-11-01', 'user-1', 'ada@waiz.media');
  draft.final_confirmation = LAUNCH_FINAL_CONFIRMATION;
  for (const item of getLaunchItemsForProfile(profile)) {
    draft.checklist[item.key] = true;
    draft.confirmations[item.key] = `${item.key} proof`;
  }
  return draft;
}

describe('launch tech spot check', () => {
  it('shows the same six checks on every account', () => {
    for (const profile of ['marketing_core', 'marketing_lead_gen', 'call_center'] as const) {
      const items = getLaunchItemsForProfile(profile);
      assert.deepEqual(items.map(item => item.key), [...LIVE_KEYS]);
      assert.equal(items.every(item => item.confirmType === 'evidence'), true);
    }
  });

  it('does not keep the old media, Bonzo, HP tag, or ClickUp fill-in lines', () => {
    const labels = getLaunchItemsForProfile('marketing_core').map(item => item.label).join('\n');
    assert.equal(/headline|states are being targeted|split test|Bonzo|HP tag|ClickUp onboarding fields/i.test(labels), false);
    assert.equal(labels.includes('Ads are scheduled with the correct budget'), true);
    assert.equal(labels.includes('The funnel pixel is set to the correct event'), true);
  });

  it('rejects a plain yes and accepts a real detail', () => {
    assert.equal(isSubstantiveLaunchEvidence('yes'), false);
    assert.equal(isSubstantiveLaunchEvidence('yes!'), false);
    assert.equal(isSubstantiveLaunchEvidence('LAUNCH'), false);
    assert.equal(isSubstantiveLaunchEvidence('$150/day'), true);

    const draft = readyDraft();
    const item = getLaunchItemsForProfile('marketing_core')[0];
    draft.confirmations[item.key] = 'yes';
    assert.equal(isLaunchItemSatisfied(item, draft), false);
    assert.equal(isLaunchChecklistComplete(draft, 'marketing_core'), false);
    draft.confirmations[item.key] = '$150/day';
    assert.equal(isLaunchItemSatisfied(item, draft), true);
  });

  it('marks complete without a recording, GHL number, or ads gate', () => {
    const draft = readyDraft('call_center');
    draft.recording_url = '';
    draft.phone_ghl = '';
    draft.ads_ready = '';
    assert.equal(isLaunchChecklistComplete(draft, 'call_center'), true);
  });

  it('still reads an older media-buying submission', () => {
    const items = itemsForLaunchResponses({
      form_profile: 'marketing_core',
      checklist: { mb_budget_set: true, mb_states_targeted: true },
    });
    assert.equal(items.some(item => item.key === 'mb_budget_set'), true);
    assert.equal(items.some(item => item.key === 'tech_ads_budget'), false);
  });

  it('still reads the previous ad-flow submission', () => {
    const items = itemsForLaunchResponses({
      form_profile: 'marketing_core',
      ads_ready: 'scheduled',
      checklist: { flow_ad_opens_funnel: true, acct_hp_tag: true },
    });
    assert.equal(items.some(item => item.key === 'flow_ad_opens_funnel'), true);
    assert.equal(items.some(item => item.key === 'acct_hp_tag'), true);
    assert.equal(items.some(item => item.key === 'tech_ads_budget'), false);
  });
});
