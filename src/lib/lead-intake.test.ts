import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  borrowerSummary,
  extractCreditScoreRange,
  extractLeadIntake,
  extractLtv,
  extractPropertyUse,
  extractState,
  extractUtmTerm,
  intakeFor,
  leadProductFor,
  normalizePropertyUse,
} from './lead-intake';

const RM_PAYLOAD = {
  event_type: 'lead',
  state: 'FL',
  loan_amount: '150000',
  property_value: '500000',
  b1_age: '72',
  b2_age: '70',
  credit_score_range: '',
  property_use: '',
};

const DSCR_PAYLOAD = {
  event_type: 'lead',
  state: 'TX',
  loan_amount: '$300,000',
  property_value: '$400,000',
  b1_age: '',
  b2_age: '',
  credit_score_range: '700-739',
  property_use: 'Investment Property',
};

describe('leadProductFor', () => {
  it('maps reporting_type to a product', () => {
    assert.equal(leadProductFor('RM'), 'rm');
    assert.equal(leadProductFor('dscr'), 'dscr');
    assert.equal(leadProductFor(' DSCR '), 'dscr');
  });
  it('returns null for call center, legacy HE, and unknown', () => {
    assert.equal(leadProductFor('CALL_CENTER'), null);
    assert.equal(leadProductFor('HE'), null);
    assert.equal(leadProductFor(null), null);
    assert.equal(leadProductFor(undefined), null);
  });
});

describe('shared fields', () => {
  it('computes LTV for both payloads', () => {
    assert.equal(extractLtv(RM_PAYLOAD), 30);
    assert.equal(extractLtv(DSCR_PAYLOAD), 75);
  });
  it('returns null LTV when value is missing or zero', () => {
    assert.equal(extractLtv({ loan_amount: '100', property_value: '' }), null);
    assert.equal(extractLtv({ loan_amount: '100', property_value: '0' }), null);
  });
  it('reads state with aliases and blank handling', () => {
    assert.equal(extractState({ state: ' FL ' }), 'FL');
    assert.equal(extractState({ property_state: 'TX' }), 'TX');
    assert.equal(extractState({ state: '' }), null);
  });
});

describe('DSCR fields', () => {
  it('keeps credit score range as text', () => {
    assert.equal(extractCreditScoreRange({ credit_score_range: '700-739' }), '700-739');
    assert.equal(extractCreditScoreRange({ creditScoreRange: '740+' }), '740+');
    assert.equal(extractCreditScoreRange({ credit_score_range: '  ' }), null);
  });
  it('normalizes property use to a label and keeps unknown text', () => {
    assert.equal(extractPropertyUse({ property_use: 'Investment Property' }), 'Investment');
    assert.equal(extractPropertyUse({ property_use: 'Primary Residence' }), 'Primary');
    assert.equal(extractPropertyUse({ property_use: 'Second home' }), 'Second home');
    assert.equal(extractPropertyUse({ property_use: '' }), null);
    assert.equal(normalizePropertyUse('Owner Occupied'), 'primary');
    assert.equal(normalizePropertyUse('Rental'), 'investment');
  });
});

describe('extractLeadIntake by product', () => {
  it('RM gets ages and no DSCR fields', () => {
    const i = extractLeadIntake({ ...RM_PAYLOAD, credit_score_range: '700-739' }, 'rm');
    assert.equal(i.b1_age, '72');
    assert.equal(i.b2_age, '70');
    assert.equal(i.credit_score_range, null);
    assert.equal(i.property_use, null);
    assert.equal(i.state, 'FL');
    assert.equal(i.ltv, 30);
  });
  it('DSCR gets FICO and property use and no ages', () => {
    const i = extractLeadIntake({ ...DSCR_PAYLOAD, b1_age: '65' }, 'dscr');
    assert.equal(i.credit_score_range, '700-739');
    assert.equal(i.property_use, 'Investment');
    assert.equal(i.b1_age, null);
    assert.equal(i.b2_age, null);
    assert.equal(i.loan_amount, '$300,000');
    assert.equal(i.ltv, 75);
  });
  it('DSCR with blank intake still returns nulls, not RM fields', () => {
    const i = extractLeadIntake({ event_type: 'lead' }, 'dscr');
    assert.equal(i.credit_score_range, null);
    assert.equal(i.b1_age, null);
  });
  it('unknown product shows whatever is present', () => {
    const i = extractLeadIntake({ ...RM_PAYLOAD, credit_score_range: '680-699' }, null);
    assert.equal(i.b1_age, '72');
    assert.equal(i.credit_score_range, '680-699');
  });
  it('tolerates non-object raw', () => {
    assert.equal(extractLeadIntake(null, 'rm').loan_amount, null);
    assert.equal(extractLeadIntake('x', 'dscr').state, null);
  });
});

describe('utm term', () => {
  it('keeps the site and treats a blank as empty for both products', () => {
    assert.equal(extractUtmTerm({ utm_term: ' dscr-landing ' }), 'dscr-landing');
    assert.equal(extractUtmTerm({ utmTerm: 'rm-quiz' }), 'rm-quiz');
    assert.equal(extractUtmTerm({ utm_term: '' }), null);
    assert.equal(extractUtmTerm({ utm_term: '   ' }), null);
    assert.equal(extractLeadIntake({ utm_term: 'site-a' }, 'rm').utm_term, 'site-a');
    assert.equal(extractLeadIntake({ utm_term: 'site-b' }, 'dscr').utm_term, 'site-b');
    assert.equal(extractLeadIntake({}, 'dscr').utm_term, null);
  });
});

describe('intakeFor and borrowerSummary', () => {
  it('lists the product-specific fields', () => {
    assert.deepEqual(intakeFor('rm').rmFields, ['b1_age', 'b2_age']);
    assert.deepEqual(intakeFor('rm').dscrFields, []);
    assert.deepEqual(intakeFor('dscr').rmFields, []);
    assert.deepEqual(intakeFor('dscr').dscrFields, ['credit_score_range', 'property_use']);
  });
  it('formats one-cell summaries', () => {
    const rm = extractLeadIntake(RM_PAYLOAD, 'rm');
    const dscr = extractLeadIntake(DSCR_PAYLOAD, 'dscr');
    assert.equal(borrowerSummary(rm, 'rm'), 'B1 72 / B2 70');
    assert.equal(borrowerSummary(dscr, 'dscr'), 'FICO 700-739 / Investment');
    assert.equal(borrowerSummary({}, 'dscr'), null);
  });
});
