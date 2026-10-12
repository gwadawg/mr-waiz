import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultQualifiesLeads,
  dialPoolForClient,
  dialPoolRate,
  hintForDialPool,
  withDialPoolRates,
} from './dial-pool';

const metrics = {
  hand_raise_rate: 100,
  conversation_rate: 50,
  unique_hand_raises: 1,
  unique_conversations: 1,
  new_leads: 4,
  qualified_leads: 1,
};

describe('dial pool', () => {
  it('defaults reverse to checked and DSCR to unchecked', () => {
    assert.equal(defaultQualifiesLeads('RM'), true);
    assert.equal(defaultQualifiesLeads('DSCR'), false);
    assert.equal(defaultQualifiesLeads('CALL_CENTER'), null);
    assert.equal(defaultQualifiesLeads('HE'), null);
  });

  it('ignores the flag on call center', () => {
    assert.equal(dialPoolForClient('CALL_CENTER', true), null);
    assert.equal(dialPoolForClient('CALL_CENTER', false), null);
  });

  it('uses qualified leads only when the box is checked', () => {
    assert.equal(dialPoolForClient('DSCR', true), 'qualified');
    assert.equal(dialPoolForClient('RM', true), 'qualified');
    assert.equal(dialPoolForClient('DSCR', false), 'all');
    assert.equal(dialPoolForClient('RM', false), 'all');
  });

  it('follows the product default when the box is unset', () => {
    assert.equal(dialPoolForClient('RM', null), 'qualified');
    assert.equal(dialPoolForClient('DSCR', null), 'all');
  });

  it('rewrites hand-raise and conversation onto all leads when unchecked', () => {
    const next = withDialPoolRates(metrics, 'all');
    assert.equal(next.hand_raise_rate, 25);
    assert.equal(next.conversation_rate, 25);
    assert.equal(next.qualified_leads, 1);
    assert.equal(withDialPoolRates(metrics, 'qualified'), metrics);
    assert.equal(withDialPoolRates(metrics, null), metrics);
  });

  it('returns null when the chosen pool is empty', () => {
    assert.equal(dialPoolRate(1, 0, 4, 'qualified'), null);
    assert.equal(dialPoolRate(1, 2, 0, 'all'), null);
    assert.equal(dialPoolRate(1, 2, 4, 'all'), 25);
  });

  it('relabels only the two rates that change pool', () => {
    assert.match(hintForDialPool('hand_raise_rate', 'old', 'all') ?? '', /Total Leads/);
    assert.match(hintForDialPool('conversation_rate', 'old', 'all') ?? '', /Total Leads/);
    assert.equal(hintForDialPool('show_rate', 'show', 'all'), 'show');
    assert.equal(hintForDialPool('hand_raise_rate', 'qualified hint', 'qualified'), 'qualified hint');
  });
});
