import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  latestReinstateCutoffIso,
  mapCycleProgress,
  isLaunchBlockingForCycle,
  cycleKickoffFiled,
} from '@/lib/reinstate-progress';

describe('reinstate-progress', () => {
  it('uses reinstate as Sign and reinstate_onboarding as OB after cutoff', () => {
    const cutoff = '2026-09-01T00:00:00.000Z';
    const progress = mapCycleProgress(
      [
        { form_type: 'new_client', submitted_at: '2025-01-01T00:00:00.000Z', status: 'applied' },
        { form_type: 'onboarding', submitted_at: '2025-01-02T00:00:00.000Z', status: 'applied' },
        { form_type: 'kickoff', submitted_at: '2025-01-03T00:00:00.000Z', status: 'applied' },
        { form_type: 'launch', submitted_at: '2025-01-04T00:00:00.000Z', status: 'applied' },
        { form_type: 'reinstate', submitted_at: cutoff, status: 'applied' },
        { form_type: 'reinstate_onboarding', submitted_at: '2026-09-02T00:00:00.000Z', status: 'applied' },
      ],
      cutoff,
    );
    assert.equal(progress.new_client, true); // reinstate maps to Sign
    assert.equal(progress.onboarding, true); // welcome-back maps to OB
    // unset cycle steps stay undefined on Partial<Record<...>> (falsy = incomplete)
    assert.equal(progress.kickoff, undefined);
    assert.equal(progress.launch, undefined);
    assert.equal(cycleKickoffFiled([
      { form_type: 'kickoff', submitted_at: '2025-01-03T00:00:00.000Z', status: 'applied' },
      { form_type: 'reinstate', submitted_at: cutoff, status: 'applied' },
    ]), false);
  });

  it('treats a kick-off filed after reinstate as the current cycle', () => {
    const cutoff = '2026-09-01T00:00:00.000Z';
    assert.equal(cycleKickoffFiled([
      { form_type: 'kickoff', submitted_at: '2025-01-03T00:00:00.000Z', status: 'applied' },
      { form_type: 'reinstate', submitted_at: cutoff, status: 'applied' },
      { form_type: 'kickoff', submitted_at: '2026-09-03T00:00:00.000Z', status: 'applied' },
    ]), true);
  });

  it('does not block launch on pre-reinstate launch rows', () => {
    const cutoff = '2026-09-01T00:00:00.000Z';
    assert.equal(
      isLaunchBlockingForCycle(
        [{ form_type: 'launch', submitted_at: '2025-01-04T00:00:00.000Z', status: 'applied' }],
        cutoff,
      ),
      false,
    );
    assert.equal(
      isLaunchBlockingForCycle(
        [
          { form_type: 'launch', submitted_at: '2025-01-04T00:00:00.000Z', status: 'applied' },
          { form_type: 'launch', submitted_at: '2026-09-03T00:00:00.000Z', status: 'applied' },
        ],
        cutoff,
      ),
      true,
    );
  });

  it('latestReinstateCutoffIso returns newest reinstate', () => {
    assert.equal(
      latestReinstateCutoffIso([
        { form_type: 'reinstate', submitted_at: '2026-08-01T00:00:00.000Z' },
        { form_type: 'reinstate', submitted_at: '2026-09-01T00:00:00.000Z' },
      ]),
      '2026-09-01T00:00:00.000Z',
    );
    assert.equal(latestReinstateCutoffIso([]), null);
  });
});
