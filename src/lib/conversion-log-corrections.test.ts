import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversionLogRows,
  planContactEventSync,
  planDealWrite,
  planRemoval,
  type CorrectionDeal,
  type CorrectionEvent,
} from './conversion-log-corrections';

function deal(partial: Partial<CorrectionDeal> & Pick<CorrectionDeal, 'id' | 'stage'>): CorrectionDeal {
  return {
    submitted_at: '2026-08-01T12:00:00.000Z',
    funded_at: partial.stage === 'funded' ? '2026-08-14T12:00:00.000Z' : null,
    fell_out_at: null,
    loan_size: 350000,
    commission_amount: partial.stage === 'funded' ? 8000 : null,
    transaction_label: null,
    ghl_contact_id: 'contact-1',
    source: 'loan_log_form',
    lead_name: 'Ada',
    lead_phone: '5551112222',
    ...partial,
  };
}

function event(
  partial: Partial<CorrectionEvent> & Pick<CorrectionEvent, 'id' | 'event_type'>,
): CorrectionEvent {
  return {
    ghl_contact_id: 'contact-1',
    occurred_at: '2026-08-14T12:00:00.000Z',
    source: 'loan_log_form',
    loan_size: 350000,
    lead_name: 'Ada',
    lead_phone: '5551112222',
    ...partial,
  };
}

describe('planDealWrite', () => {
  it('moves a same-day funded file onto the new date', () => {
    const current = deal({
      id: 'd1',
      stage: 'funded',
      submitted_at: '2026-08-14T12:00:00.000Z',
      funded_at: '2026-08-14T12:00:00.000Z',
    });
    const write = planDealWrite(current, [], {
      occurredOn: '2026-08-20',
      loanSize: 360000,
      commissionAmount: 9000,
      transactionLabel: 'cash-out',
      pullBackToSubmitted: false,
    });
    assert.equal('error' in write, false);
    if ('error' in write) return;
    assert.equal(write.stage, 'funded');
    assert.equal(write.funded_at, '2026-08-20T12:00:00.000Z');
    assert.equal(write.submitted_at, '2026-08-20T12:00:00.000Z');
    assert.equal(write.loan_size, 360000);
    assert.equal(write.transaction_label, 'cash-out');
  });

  it('keeps the earlier submission date when only the funded date changes', () => {
    const current = deal({ id: 'd1', stage: 'funded' });
    const write = planDealWrite(current, [], {
      occurredOn: '2026-08-21',
      loanSize: 350000,
      commissionAmount: 8000,
      transactionLabel: null,
      pullBackToSubmitted: false,
    });
    assert.equal('error' in write, false);
    if ('error' in write) return;
    assert.equal(write.submitted_at, '2026-08-01T12:00:00.000Z');
    assert.equal(write.funded_at, '2026-08-21T12:00:00.000Z');
  });

  it('pulls a funded file back to submitted and drops the commission', () => {
    const current = deal({ id: 'd1', stage: 'funded' });
    const write = planDealWrite(current, [], {
      occurredOn: '2026-08-01',
      loanSize: 350000,
      commissionAmount: 8000,
      transactionLabel: null,
      pullBackToSubmitted: true,
    });
    assert.equal('error' in write, false);
    if ('error' in write) return;
    assert.equal(write.stage, 'submitted');
    assert.equal(write.funded_at, null);
    assert.equal(write.commission_amount, null);
    assert.equal(write.submitted_at, '2026-08-01T12:00:00.000Z');
  });

  it('rejects a second file with the same size and label on the same day', () => {
    const current = deal({ id: 'd1', stage: 'funded', loan_size: 200000 });
    const other = deal({ id: 'd2', stage: 'funded' });
    const write = planDealWrite(current, [other], {
      occurredOn: '2026-08-14',
      loanSize: 350000,
      commissionAmount: null,
      transactionLabel: null,
      pullBackToSubmitted: false,
    });
    assert.equal('error' in write, true);
  });
});

describe('planContactEventSync', () => {
  it('drops the tracker funded event when the last funded file is gone', () => {
    const plan = planContactEventSync({
      contactId: 'contact-1',
      deals: [deal({ id: 'd1', stage: 'submitted', funded_at: null })],
      events: [event({ id: 'e-fund', event_type: 'loan_funded' })],
    });
    assert.deepEqual(plan.deleteIds, ['e-fund']);
    assert.deepEqual(plan.updates, []);
  });

  it('keeps the funded event on the earliest remaining file', () => {
    const plan = planContactEventSync({
      contactId: 'contact-1',
      deals: [
        deal({ id: 'early', stage: 'funded', funded_at: '2026-06-01T12:00:00.000Z', loan_size: 100000 }),
        deal({ id: 'late', stage: 'funded', funded_at: '2026-08-14T12:00:00.000Z' }),
      ],
      events: [event({ id: 'e-fund', event_type: 'loan_funded', occurred_at: '2026-08-14T12:00:00.000Z' })],
    });
    assert.deepEqual(plan.deleteIds, []);
    assert.equal(plan.updates[0]?.occurred_at, '2026-06-01T12:00:00.000Z');
    assert.equal(plan.updates[0]?.loan_size, 100000);
  });

  it('leaves a webhook funded event in place', () => {
    const plan = planContactEventSync({
      contactId: 'contact-1',
      deals: [],
      events: [event({ id: 'e-fund', event_type: 'loan_funded', source: 'webhook' })],
    });
    assert.deepEqual(plan.deleteIds, []);
  });
});

describe('planRemoval', () => {
  it('removes the file, its funded event, and a tracker-only lead', () => {
    const ids = planRemoval({
      contactId: 'contact-1',
      removedDealId: 'd1',
      removedEventId: null,
      deals: [deal({ id: 'd1', stage: 'funded', submitted_at: '2026-08-14T12:00:00.000Z', funded_at: '2026-08-14T12:00:00.000Z' })],
      events: [
        event({ id: 'e-fund', event_type: 'loan_funded' }),
        event({ id: 'e-lead', event_type: 'lead', occurred_at: '2026-08-14T12:00:00.000Z', loan_size: null }),
      ],
    });
    assert.deepEqual(ids.sort(), ['e-fund', 'e-lead']);
  });

  it('keeps the lead when the person still has a dial', () => {
    const ids = planRemoval({
      contactId: 'contact-1',
      removedDealId: 'd1',
      removedEventId: null,
      deals: [deal({ id: 'd1', stage: 'submitted', funded_at: null })],
      events: [
        event({ id: 'e-sub', event_type: 'submission_made' }),
        event({ id: 'e-lead', event_type: 'lead', loan_size: null }),
        event({ id: 'e-dial', event_type: 'dial', source: null, loan_size: null }),
      ],
    });
    assert.deepEqual(ids, ['e-sub']);
  });
});

describe('buildConversionLogRows', () => {
  it('lists the file and a separate proposal, and hides the event the file already covers', () => {
    const rows = buildConversionLogRows(
      [deal({ id: 'd1', stage: 'funded' })],
      [
        event({ id: 'e-fund', event_type: 'loan_funded' }),
        event({ id: 'e-prop', event_type: 'proposal_made', occurred_at: '2026-07-20T12:00:00.000Z' }),
      ],
    );
    assert.deepEqual(
      rows.map(row => `${row.kind}:${row.stage}:${row.id}`),
      ['deal:funded:d1', 'event:proposal:e-prop'],
    );
  });

  it('lists a funded event that has no file', () => {
    const rows = buildConversionLogRows(
      [],
      [event({ id: 'e-fund', event_type: 'loan_funded' })],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, 'event');
    assert.equal(rows[0]?.stage, 'funded');
  });
});
