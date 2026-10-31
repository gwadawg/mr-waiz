import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareRowFromMetrics } from './client-compare';
import { computeFocus, tierFromBands, type KpiKey } from './client-health';
import { deptStatus } from './dept-health';
import {
  assertVersionUpdate,
  ClosedVersionError,
  gradeMetrics,
  gradeRange,
  planStockSave,
  resolveClientCriteria,
  resolveCriteriaSpans,
  seedStockVersions,
  type CriteriaCatalog,
  type CriteriaClient,
  type CustomVersion,
} from './kpi-criteria';
import { DEMO_WAIZ, WAIZ_RANGES } from './lead-source-roi/config';
import type { MetricsResult } from './metrics';

const CUTOVER = '2026-11-01';

function metrics(partial: Partial<MetricsResult> & Pick<MetricsResult, 'new_leads'>): MetricsResult {
  return {
    qualified_leads: 0,
    shows: 0,
    closed: 0,
    ad_spend: 0,
    cpl: 0,
    cp_conversation: 0,
    unique_conversations: 0,
    unique_hand_raises: 0,
    hand_raise_rate: 0,
    lead_hand_raise_rate: 0,
    booked_to_conversation_rate: 0,
    unique_booked_appointments: 0,
    booked_appointments: 0,
    outbound_dials: 0,
    ...partial,
  } as MetricsResult;
}

function client(partial: Partial<CriteriaClient> & Pick<CriteriaClient, 'id'>): CriteriaClient {
  return {
    reportingType: 'RM',
    serviceProgram: 'core',
    qualifiesLeads: true,
    ...partial,
  };
}

function catalog(custom: CustomVersion[] = []): CriteriaCatalog {
  return { stock: seedStockVersions(CUTOVER), custom };
}

function customVersion(partial: Partial<CustomVersion> & Pick<CustomVersion, 'id' | 'clientId' | 'effectiveStart'>): CustomVersion {
  return {
    effectiveEnd: null,
    ruler: 'current',
    bands: {},
    note: null,
    createdBy: 'gabe',
    createdAt: '2026-11-15T00:00:00.000Z',
    ...partial,
  };
}

function gradeOf(snap: { grades: { key: KpiKey; tier: string }[] }, key: KpiKey) {
  return snap.grades.find(g => g.key === key)?.tier;
}

describe('criteria resolver', () => {
  it('keeps DSCR cost grades off until real tiers are saved', () => {
    const c = client({ id: 'dscr-1', reportingType: 'DSCR', qualifiesLeads: true });
    const criteria = resolveClientCriteria(c, '2026-11-15', catalog());
    assert.ok(criteria);
    assert.equal(criteria.costUnapproved, true);
    assert.equal(criteria.rateLinesShared, true);
    assert.equal(criteria.placeholders?.cpl?.worst, WAIZ_RANGES.cpl.worst);
    assert.equal(criteria.placeholders?.cpl?.demo, DEMO_WAIZ.cpl);
    assert.equal(criteria.placeholders?.cpl?.best, WAIZ_RANGES.cpl.best);
    const snap = gradeMetrics(criteria, metrics({
      new_leads: 20,
      qualified_leads: 16,
      unique_hand_raises: 8,
      hand_raise_rate: 50,
      unique_conversations: 10,
      unique_booked_appointments: 8,
      booked_to_conversation_rate: 80,
      shows: 8,
      closed: 4,
      ad_spend: 1100,
      cpl: 55,
      cp_conversation: 110,
    }));
    assert.equal(gradeOf(snap, 'cpl'), 'insufficient');
    assert.equal(gradeOf(snap, 'cpql'), 'insufficient');
    assert.equal(gradeOf(snap, 'cps'), 'insufficient');
    const focus = computeFocus(snap, null, 'DSCR');
    assert.notEqual(focus.focus, 'monitor');
    assert.notEqual(focus.focus, 'act_now');
  });

  it('does not let a weak hand-raise or high CPConv move a leads-only account', () => {
    const c = client({
      id: 'leads-1',
      reportingType: 'RM',
      serviceProgram: 'lead_gen',
      qualifiesLeads: true,
    });
    const criteria = resolveClientCriteria(c, '2026-11-15', catalog());
    assert.ok(criteria);
    assert.deepEqual(criteria.gradedKeys, ['cpl', 'lead_to_qualified', 'cpql']);
    const snap = gradeMetrics(criteria, metrics({
      new_leads: 20,
      qualified_leads: 16,
      unique_hand_raises: 1,
      hand_raise_rate: 6,
      unique_conversations: 10,
      ad_spend: 300,
      cpl: 15,
      cp_conversation: 500,
      shows: 8,
      closed: 1,
      unique_booked_appointments: 8,
      booked_to_conversation_rate: 40,
    }));
    assert.equal(snap.worst_tier, 'above');
    assert.equal(gradeOf(snap, 'hand_raise_rate'), undefined);
    assert.equal(gradeOf(snap, 'cps'), undefined);
    const row = {
      client_id: c.id,
      client_name: 'Leads',
      is_live: true,
      reporting_type: 'RM' as const,
      current: snap,
      prior: null,
      trend: 'stable' as const,
      trend_delta_score: 0,
      has_activity: true,
      recent: null,
      recent_prior: null,
      focus: computeFocus(snap, null, 'RM'),
      open_action: null,
      launch_date: null,
      is_fresh_launch: false,
      fresh: null,
      graded_keys: criteria.gradedKeys,
    };
    assert.equal(deptStatus(row, 'ccm', false), 'insufficient');
    assert.notEqual(row.focus.focus, 'act_now');
  });

  it('grades not-qualifying hand-raise on 3 / 5 / 8 and does not 911 on 0% qualified', () => {
    const rm = client({ id: 'all-1', reportingType: 'RM', qualifiesLeads: false });
    const dscr = client({ id: 'dscr-all', reportingType: 'DSCR', qualifiesLeads: null, serviceProgram: 'core' });
    for (const c of [rm, dscr]) {
      const criteria = resolveClientCriteria(c, '2026-11-15', catalog());
      assert.ok(criteria);
      assert.equal(criteria.gradedKeys.includes('lead_to_qualified'), false);
      assert.equal(criteria.bands.hand_raise_rate?.bands.critical, 3);
      assert.equal(criteria.bands.hand_raise_rate?.bands.below, 5);
      assert.equal(criteria.bands.hand_raise_rate?.bands.at, 8);
      const snap = gradeMetrics(criteria, metrics({
        new_leads: 100,
        qualified_leads: 0,
        unique_hand_raises: 6,
        hand_raise_rate: 0,
        lead_hand_raise_rate: 6,
        unique_conversations: 10,
        unique_booked_appointments: 10,
        booked_to_conversation_rate: 80,
        shows: 8,
        closed: 3,
        ad_spend: 1500,
        cpl: 15,
        cp_conversation: 150,
      }));
      assert.equal(gradeOf(snap, 'hand_raise_rate'), 'at');
      assert.equal(gradeOf(snap, 'lead_to_qualified'), undefined);
      assert.notEqual(snap.worst_tier, 'critical');
    }
  });

  it('applies a custom hand-raise only on and after its effective start', () => {
    const c = client({ id: 'custom-1' });
    const rows = catalog([
      customVersion({
        id: 'custom-open',
        clientId: c.id,
        effectiveStart: '2026-11-15',
        bands: { hand_raise_rate: { critical: 20, below: 25, at: 40 } },
      }),
    ]);
    const before = resolveClientCriteria(c, '2026-11-14', rows);
    const after = resolveClientCriteria(c, '2026-11-15', rows);
    assert.equal(before?.bands.hand_raise_rate?.bands.at, 30);
    assert.equal(after?.bands.hand_raise_rate?.bands.at, 40);
    const specBefore = before!.bands.hand_raise_rate!;
    const specAfter = after!.bands.hand_raise_rate!;
    assert.equal(tierFromBands(35, specBefore.bands, true, 5, 10), 'above');
    assert.equal(tierFromBands(35, specAfter.bands, true, 5, 10), 'at');
  });

  it('keeps all-leads CPConv on the previous dollars when a new RM CPL starts later', () => {
    const seeded = seedStockVersions(CUTOVER);
    const open = seeded.find(v => v.id === 'stock-rm-open');
    assert.ok(open);
    const edited = {
      ...open.bands,
      cpl: {
        ...open.bands.cpl!,
        bands: { critical: 22, below: 18, at: 10 },
      },
    };
    const saved = planStockSave(seeded, 'RM', '2026-12-01', '2026-11-20', edited, null, 'CPL moved');
    assert.equal(saved.error, undefined);
    const cat = { stock: saved.versions, custom: [] };
    const c = client({ id: 'all-cpl', qualifiesLeads: false });
    const before = resolveClientCriteria(c, '2026-11-30', cat);
    const after = resolveClientCriteria(c, '2026-12-01', cat);
    assert.equal(before?.bands.cps?.bands.at, 187.5);
    assert.equal(before?.bands.cps?.bands.below, 400);
    assert.equal(before?.bands.cps?.bands.critical, 833.33);
    assert.equal(after?.bands.cpl?.bands.at, 10);
    assert.notEqual(after?.bands.cps?.bands.at, 187.5);
  });

  it('splits a crossed range into two rulers and does not emit one tier', () => {
    const c = client({ id: 'span-1' });
    const spans = resolveCriteriaSpans(c, '2026-10-20', '2026-11-10', catalog());
    assert.equal(spans.segments.length, 2);
    assert.equal(spans.single, null);
    assert.equal(spans.writes, false);
    const graded = gradeRange(spans.segments, () => metrics({ new_leads: 0 }));
    assert.equal(graded.tier, null);
    assert.deepEqual(
      graded.segments.map(s => s.stock_version_id),
      ['stock-rm-legacy', 'stock-rm-open'],
    );
  });

  it('uses only the open version when the range starts after it', () => {
    const c = client({ id: 'open-only' });
    const spans = resolveCriteriaSpans(c, '2026-11-05', '2026-11-20', catalog());
    assert.equal(spans.segments.length, 1);
    assert.equal(spans.single?.stockVersionId, 'stock-rm-open');
  });

  it('replays today\'s criteria as one open ruler and writes nothing', () => {
    const c = client({ id: 'replay-1' });
    const replay = resolveCriteriaSpans(c, '2026-10-20', '2026-11-10', catalog(), {
      lens: 'on_todays_criteria',
    });
    assert.equal(replay.segments.length, 1);
    assert.equal(replay.single?.stockVersionId, 'stock-rm-open');
    assert.equal(replay.writes, false);
    const judged = resolveCriteriaSpans(c, '2026-10-20', '2026-11-10', catalog(), {
      lens: 'as_judged_then',
    });
    assert.equal(judged.segments.length, 2);
    assert.equal(judged.segments[0].criteria.stockVersionId, 'stock-rm-legacy');
    assert.equal(judged.segments[1].criteria.stockVersionId, 'stock-rm-open');
  });

  it('agrees on the account tier across health, compare, and department status', () => {
    const c = client({ id: 'same-1' });
    const criteria = resolveClientCriteria(c, '2026-11-15', catalog());
    assert.ok(criteria);
    const m = metrics({
      new_leads: 20,
      qualified_leads: 14,
      unique_hand_raises: 6,
      hand_raise_rate: 40,
      unique_conversations: 10,
      unique_booked_appointments: 8,
      booked_to_conversation_rate: 80,
      shows: 8,
      closed: 3,
      ad_spend: 1000,
      cpl: 15,
      cp_conversation: 100,
    });
    const snap = gradeMetrics(criteria, m);
    const compared = compareRowFromMetrics({
      id: c.id,
      name: 'Same',
      reporting_type: 'RM',
      metrics: m,
      qualifies_leads: true,
      criteria,
    });
    const row = {
      client_id: c.id,
      client_name: 'Same',
      is_live: true,
      reporting_type: 'RM' as const,
      current: snap,
      prior: null,
      trend: 'stable' as const,
      trend_delta_score: 0,
      has_activity: true,
      recent: null,
      recent_prior: null,
      focus: computeFocus(snap, null, 'RM'),
      open_action: null,
      launch_date: null,
      is_fresh_launch: false,
      fresh: null,
      graded_keys: criteria.gradedKeys,
    };
    assert.equal(snap.worst_tier, 'at');
    assert.equal(compared.north_star_grade, snap.worst_tier);
    assert.equal(deptStatus(row, 'overview', false), snap.worst_tier);
  });

  it('shows 3 / 5 / 8 for call center hand-raise on the open version', () => {
    const c = client({ id: 'cc-1', reportingType: 'CALL_CENTER', serviceProgram: null, qualifiesLeads: null });
    const criteria = resolveClientCriteria(c, '2026-11-15', catalog());
    assert.equal(criteria?.bands.hand_raise_rate?.bands.critical, 3);
    assert.equal(criteria?.bands.hand_raise_rate?.bands.below, 5);
    assert.equal(criteria?.bands.hand_raise_rate?.bands.at, 8);
    assert.equal(criteria?.gradedKeys.includes('cpl'), false);
  });

  it('refuses to update a closed version', () => {
    const closed = seedStockVersions(CUTOVER).find(v => v.id === 'stock-rm-legacy');
    assert.ok(closed);
    assert.throws(
      () => assertVersionUpdate(closed, { bands: { cpl: { critical: 1 } } }),
      ClosedVersionError,
    );
  });

  it('treats an unset service program as Call Center service', () => {
    const c = client({ id: 'unset-1', serviceProgram: null, qualifiesLeads: true });
    const criteria = resolveClientCriteria(c, '2026-11-15', catalog());
    assert.equal(criteria?.programUnset, true);
    assert.equal(criteria?.gradedKeys.includes('hand_raise_rate'), true);
    assert.equal(criteria?.accountMode, 'cpconv');
  });
});
