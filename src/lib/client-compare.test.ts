import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  barsForChart,
  compareRowFromMetrics,
  costHistoryFromDailySeries,
  costMapPoints,
  defaultSortDir,
  isDefaultRosterClient,
  mapMedians,
  medianOf,
  nextSortState,
  parseTableSortKey,
  pivotCostHistory,
  rangeForComparePreset,
  rateMapPoints,
  rosterIdsForOffer,
  showPendingCaveat,
  sortCompareRows,
  visibleChartKeys,
  type ClientCompareRow,
} from './client-compare';
import { calculateMetrics, type EventRow, type SpendRow } from './metrics';
import type { ReportingType } from './kpi-layouts';

function lead(id: string, qualified = true): EventRow {
  return {
    client_id: 'c1',
    event_type: 'lead',
    ghl_contact_id: id,
    occurred_at: '2026-07-01T12:00:00.000Z',
    is_qualified: qualified,
    is_pickup: null,
    is_conversation: null,
    speed_to_lead_seconds: null,
  };
}

function evt(type: string, id: string): EventRow {
  return {
    client_id: 'c1',
    event_type: type,
    ghl_contact_id: id,
    occurred_at: '2026-07-02T12:00:00.000Z',
    is_pickup: null,
    is_conversation: null,
    speed_to_lead_seconds: null,
  };
}

function row(
  reporting_type: ReportingType,
  events: EventRow[],
  spend: SpendRow[],
  extras: Partial<{ id: string; name: string; lifecycle_status: string | null; billing_paused: boolean }> = {},
): ClientCompareRow {
  return compareRowFromMetrics({
    id: extras.id ?? 'c1',
    name: extras.name ?? 'Acme',
    reporting_type,
    lifecycle_status: extras.lifecycle_status,
    billing_paused: extras.billing_paused,
    metrics: calculateMetrics(events, spend),
  });
}

const fiveLeads = ['a', 'b', 'c', 'd', 'e'].map(id => lead(id));

describe('client-compare roster', () => {
  it('excludes churned and billing-paused from the default roster', () => {
    assert.equal(isDefaultRosterClient({ lifecycle_status: 'active' }), true);
    assert.equal(isDefaultRosterClient({ lifecycle_status: 'onboarding' }), true);
    assert.equal(isDefaultRosterClient({ lifecycle_status: 'churned' }), false);
    assert.equal(isDefaultRosterClient({ lifecycle_status: 'active', billing_paused: true }), false);
  });

  it('offer reset lists default-roster ids for that product', () => {
    const rm = row('RM', fiveLeads, [{ amount: 100 }], { id: 'rm1', name: 'RM One' });
    const dscr = row('DSCR', fiveLeads, [{ amount: 100 }], { id: 'd1', name: 'DSCR One' });
    const churned = compareRowFromMetrics({
      id: 'old',
      name: 'Gone',
      reporting_type: 'RM',
      lifecycle_status: 'churned',
      metrics: calculateMetrics(fiveLeads, [{ amount: 50 }]),
    });
    assert.deepEqual(rosterIdsForOffer([rm, dscr, churned], 'RM'), ['rm1']);
    assert.deepEqual(rosterIdsForOffer([rm, dscr, churned], 'all').sort(), ['d1', 'rm1']);
  });
});

describe('client-compare null vs zero', () => {
  it('turns empty-denominator costs into null, not $0', () => {
    const paid = row('RM', [], []);
    assert.equal(paid.cpl, null);
    assert.equal(paid.cpql, null);
    assert.equal(paid.cpconv, null);
    assert.equal(paid.hand_raise, null);
    assert.equal(paid.show_rate, null);
    assert.equal(paid.conversation_rate, null);
    assert.equal(paid.dials_per_qualified, null);
    assert.equal(paid.dials, 0);
    assert.equal(paid.spend, 0);
  });

  it('plots $0 spend with leads as a real number', () => {
    const paid = row('RM', fiveLeads, []);
    assert.equal(paid.spend, 0);
    assert.equal(paid.cpl, 0);
    assert.equal(paid.leads, 5);
  });

  it('omits null spend from cost charts but keeps $0 spend', () => {
    const zeroSpend = row('RM', fiveLeads, [], { id: 'z', name: 'Zero' });
    const cc = row('CALL_CENTER', fiveLeads, [], { id: 'cc', name: 'CC' });
    const spendBars = barsForChart([zeroSpend, cc], 'spend');
    assert.equal(spendBars.length, 1);
    assert.equal(spendBars[0].id, 'z');
    assert.equal(spendBars[0].value, 0);
  });
});

describe('client-compare Call Center', () => {
  it('never receives spend / CPL / CPQL / CPConv', () => {
    const cc = row('CALL_CENTER', [...fiveLeads, evt('appointment_booked', 'a'), evt('show', 'a')], [
      { amount: 999 },
    ]);
    assert.equal(cc.is_call_center, true);
    assert.equal(cc.spend, null);
    assert.equal(cc.cpl, null);
    assert.equal(cc.cpql, null);
    assert.equal(cc.cpconv, null);
    assert.ok(cc.hand_raise != null);
  });

  it('hides cost charts when the set is Call Center only', () => {
    const cc = row('CALL_CENTER', fiveLeads, [], { id: 'cc' });
    const keys = visibleChartKeys([cc]);
    assert.equal(keys.includes('cpl'), false);
    assert.equal(keys.includes('booked'), true);
  });

  it('excludes Call Center from mixed-set cost charts', () => {
    const rm = row('RM', fiveLeads, [{ amount: 200 }], { id: 'rm' });
    const cc = row('CALL_CENTER', fiveLeads, [], { id: 'cc' });
    const keys = visibleChartKeys([rm, cc]);
    assert.equal(keys.includes('cpl'), true);
    assert.equal(keys.includes('booked'), false);
    assert.deepEqual(
      barsForChart([rm, cc], 'cpl').map(b => b.id),
      ['rm'],
    );
  });
});

describe('client-compare maps', () => {
  it('cost map only includes numeric CPConv and hand-raise', () => {
    const events = [
      ...fiveLeads,
      evt('appointment_booked', 'a'),
      evt('show', 'a'),
      evt('appointment_booked', 'b'),
      evt('show', 'b'),
      evt('appointment_booked', 'c'),
      evt('claimed', 'c'),
    ];
    const paid = row('RM', events, [{ amount: 300 }], { id: 'rm' });
    const noConv = row('RM', fiveLeads, [{ amount: 300 }], { id: 'empty' });
    const cc = row('CALL_CENTER', events, [], { id: 'cc' });
    const points = costMapPoints([paid, noConv, cc]);
    assert.deepEqual(points.map(p => p.id), ['rm']);
    assert.equal(points[0].x, paid.cpconv);
    assert.equal(points[0].y, paid.hand_raise);
  });

  it('rate map requires both numeric hand-raise and Show Rate', () => {
    const noBook = row('RM', fiveLeads, [{ amount: 10 }], { id: 'nb' });
    const booked = row(
      'RM',
      [...fiveLeads, evt('appointment_booked', 'a'), evt('show', 'a')],
      [{ amount: 10 }],
      { id: 'bk' },
    );
    const points = rateMapPoints([noBook, booked]);
    assert.deepEqual(points.map(p => p.id), ['bk']);
  });

  it('median ignores hollow / low-volume points', () => {
    const loud = row(
      'RM',
      [
        ...fiveLeads,
        ...['a', 'b', 'c', 'd', 'e'].flatMap(id => [evt('appointment_booked', id), evt('show', id)]),
      ],
      [{ amount: 500 }],
      { id: 'loud' },
    );
    const quiet = row('RM', [lead('x'), evt('appointment_booked', 'x'), evt('show', 'x')], [{ amount: 10 }], {
      id: 'quiet',
    });
    const points = costMapPoints([loud, quiet]);
    assert.equal(points.length, 2);
    const quietPt = points.find(p => p.id === 'quiet');
    assert.equal(quietPt?.hollow, true);
    const med = mapMedians(points);
    assert.equal(med.x, loud.cpconv);
    assert.equal(med.y, loud.hand_raise);
  });
});

describe('client-compare grades', () => {
  it('grades CPConv against global bands, not a second table', () => {
    const events = [
      ...fiveLeads,
      ...['a', 'b', 'c', 'd', 'e'].map(id => evt('show', id)),
    ];
    const expensive = row('RM', events, [{ amount: 2000 }]);
    assert.equal(expensive.cpconv, 400);
    assert.equal(expensive.grades.cpconv, 'critical');
    assert.equal(expensive.north_star_grade, 'critical');
  });
});

describe('client-compare median and dates', () => {
  it('medianOf uses the midpoint of the sorted visible values', () => {
    assert.equal(medianOf([3, 1, 2]), 2);
    assert.equal(medianOf([1, 2, 3, 4]), 2.5);
    assert.equal(medianOf([]), null);
  });

  it('shows the pending-appointment caveat on windows of 14 days or less', () => {
    assert.equal(showPendingCaveat('2026-08-01', '2026-08-14'), true);
    assert.equal(showPendingCaveat('2026-08-01', '2026-08-15'), false);
  });

  it('last_30 range ends on today and starts 30 days earlier', () => {
    const r = rangeForComparePreset('last_30', '2026-08-18');
    assert.equal(r.end, '2026-08-18');
    assert.equal(r.start, '2026-07-19');
  });
});

describe('client-compare cost history', () => {
  it('omits Call Center and leaves empty-denominator days as null', () => {
    const series = costHistoryFromDailySeries(
      [
        { id: 'rm', name: 'Reverse Co', is_call_center: false },
        { id: 'cc', name: 'CC Co', is_call_center: true },
      ],
      new Map([
        [
          'rm',
          [
            {
              client_id: 'rm',
              event_type: 'lead',
              occurred_at: '2026-08-01T12:00:00.000Z',
              is_qualified: true,
              ghl_contact_id: 'a',
            },
            {
              client_id: 'rm',
              event_type: 'show',
              occurred_at: '2026-08-01T13:00:00.000Z',
              ghl_contact_id: 'a',
            },
          ],
        ],
      ]),
      [{ client_id: 'rm', spend_date: '2026-08-01', amount: 100 }],
      '2026-08-01',
      '2026-08-02',
      'day',
    );
    assert.equal(series.length, 1);
    assert.equal(series[0].id, 'rm');
    assert.equal(series[0].points[0].cpl, 100);
    assert.equal(series[0].points[0].cpql, 100);
    assert.equal(series[0].points[0].cpconv, 100);
    assert.equal(series[0].points[1].cpl, null);
    assert.equal(series[0].points[1].cpconv, null);
  });

  it('pivots one column per client for the selected metric', () => {
    const series = costHistoryFromDailySeries(
      [
        { id: 'a', name: 'A', is_call_center: false },
        { id: 'b', name: 'B', is_call_center: false },
      ],
      new Map(),
      [
        { client_id: 'a', spend_date: '2026-08-01', amount: 50 },
        { client_id: 'b', spend_date: '2026-08-01', amount: 80 },
      ],
      '2026-08-01',
      '2026-08-01',
      'day',
    );
    // Spend with 0 leads stays null — add leads so CPL plots.
    const withLeads = costHistoryFromDailySeries(
      [
        { id: 'a', name: 'A', is_call_center: false },
        { id: 'b', name: 'B', is_call_center: false },
      ],
      new Map([
        [
          'a',
          [{ client_id: 'a', event_type: 'lead', occurred_at: '2026-08-01T12:00:00.000Z', ghl_contact_id: '1' }],
        ],
        [
          'b',
          [{ client_id: 'b', event_type: 'lead', occurred_at: '2026-08-01T12:00:00.000Z', ghl_contact_id: '2' }],
        ],
      ]),
      [
        { client_id: 'a', spend_date: '2026-08-01', amount: 50 },
        { client_id: 'b', spend_date: '2026-08-01', amount: 80 },
      ],
      '2026-08-01',
      '2026-08-01',
      'day',
    );
    const pivoted = pivotCostHistory(withLeads, 'cpl');
    assert.equal(pivoted.length, 1);
    assert.equal(pivoted[0].a, 50);
    assert.equal(pivoted[0].b, 80);
    assert.equal(series[0].points[0].cpl, null);
  });
});

function dial(id = 'a'): EventRow {
  return {
    client_id: 'c1',
    event_type: 'dial',
    ghl_contact_id: id,
    occurred_at: '2026-07-01T13:00:00.000Z',
    is_pickup: true,
    is_conversation: true,
    speed_to_lead_seconds: null,
  };
}

describe('client-compare table metrics', () => {
  it('divides unchecked DSCR rates by every lead and keeps Peter on qualified leads', () => {
    const events = [
      lead('a', true),
      lead('b', false),
      evt('appointment_booked', 'a'),
      evt('show', 'a'),
    ];
    const metrics = calculateMetrics(events, []);
    const peter = compareRowFromMetrics({
      id: 'peter',
      name: 'Peter',
      reporting_type: 'DSCR',
      qualifies_leads: true,
      metrics,
    });
    const open = compareRowFromMetrics({
      id: 'dscr',
      name: 'Other DSCR',
      reporting_type: 'DSCR',
      qualifies_leads: false,
      metrics,
    });
    const callCenter = compareRowFromMetrics({
      id: 'cc',
      name: 'Call Center',
      reporting_type: 'CALL_CENTER',
      qualifies_leads: true,
      metrics,
    });
    assert.equal(peter.hand_raise, 100);
    assert.equal(peter.conversation_rate, 100);
    assert.equal(peter.qualified, 1);
    assert.equal(open.hand_raise, 50);
    assert.equal(open.conversation_rate, 50);
    assert.equal(open.dial_pool, 'all');
    assert.equal(callCenter.dial_pool, null);
    assert.equal(callCenter.hand_raise, 50);
  });
  it('keeps Call Center dials while omitting cost', () => {
    const cc = row(
      'CALL_CENTER',
      [...fiveLeads, dial('a'), dial('b'), dial('c')],
      [{ amount: 999 }],
      { id: 'cc' },
    );
    assert.equal(cc.spend, null);
    assert.equal(cc.cpl, null);
    assert.equal(cc.cpql, null);
    assert.equal(cc.cpconv, null);
    assert.equal(cc.dials, 3);
    assert.equal(cc.dials_per_qualified, 3 / 5);
    assert.ok(cc.conversation_rate != null);
  });

  it('nulls conversation rate and dials/QL when there are no qualified leads', () => {
    const unpaid = row('RM', [lead('x', false), dial('x'), dial('x')], []);
    assert.equal(unpaid.qualified, 0);
    assert.equal(unpaid.dials, 2);
    assert.equal(unpaid.conversation_rate, null);
    assert.equal(unpaid.dials_per_qualified, null);
  });

  it('sorts nulls last in both directions and uses first-click dirs', () => {
    assert.equal(defaultSortDir('cpl'), 'asc');
    assert.equal(defaultSortDir('cpconv'), 'asc');
    assert.equal(defaultSortDir('dials_per_qualified'), 'asc');
    assert.equal(defaultSortDir('hand_raise'), 'desc');
    assert.equal(defaultSortDir('conversation_rate'), 'desc');
    assert.equal(defaultSortDir('dials'), 'desc');

    const cheap = row('RM', fiveLeads, [{ amount: 50 }], { id: 'cheap', name: 'Cheap' });
    const pricey = row('RM', fiveLeads, [{ amount: 200 }], { id: 'pricey', name: 'Pricey' });
    const cc = row('CALL_CENTER', fiveLeads, [], { id: 'cc', name: 'Call Co' });
    const asc = sortCompareRows([pricey, cc, cheap], 'cpl', 'asc').map(r => r.id);
    const desc = sortCompareRows([pricey, cc, cheap], 'cpl', 'desc').map(r => r.id);
    assert.deepEqual(asc, ['cheap', 'pricey', 'cc']);
    assert.deepEqual(desc, ['pricey', 'cheap', 'cc']);
  });

  it('first click on a new column uses the default direction', () => {
    assert.deepEqual(nextSortState('name', 'asc', 'cpl'), { key: 'cpl', dir: 'asc' });
    assert.deepEqual(nextSortState('name', 'asc', 'hand_raise'), { key: 'hand_raise', dir: 'desc' });
    assert.deepEqual(nextSortState('cpl', 'asc', 'cpl'), { key: 'cpl', dir: 'desc' });
    assert.equal(parseTableSortKey('cpconv'), 'cpconv');
    assert.equal(parseTableSortKey('nope'), 'name');
  });
});

