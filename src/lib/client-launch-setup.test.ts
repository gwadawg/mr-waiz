import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountShapeLabel,
  brandSubjectLabel,
  normalizeAccountShape,
  normalizeBrandSubject,
  parseQualifiesLeads,
  qualifiesLeadsLabel,
} from './client-launch-setup';

test('brand is client name or company', () => {
  assert.equal(normalizeBrandSubject(''), null);
  assert.equal(normalizeBrandSubject('client'), 'client');
  assert.equal(normalizeBrandSubject('company'), 'company');
  assert.equal(normalizeBrandSubject('person'), 'invalid');
  assert.equal(brandSubjectLabel('client'), 'Client name');
  assert.equal(brandSubjectLabel('company'), 'Company');
});

test('team shape only accepts solo or team', () => {
  assert.equal(normalizeAccountShape(null), null);
  assert.equal(normalizeAccountShape('solo'), 'solo');
  assert.equal(normalizeAccountShape('team'), 'team');
  assert.equal(normalizeAccountShape('group'), 'invalid');
  assert.equal(accountShapeLabel('team'), 'Team');
});

test('qualify stays unset until yes or no', () => {
  assert.equal(parseQualifiesLeads(''), null);
  assert.equal(parseQualifiesLeads(null), null);
  assert.equal(parseQualifiesLeads('yes'), true);
  assert.equal(parseQualifiesLeads(false), false);
  assert.equal(parseQualifiesLeads('maybe'), 'invalid');
  assert.equal(qualifiesLeadsLabel(true), 'Yes');
  assert.equal(qualifiesLeadsLabel(false), 'No');
  assert.equal(qualifiesLeadsLabel(null), null);
});
