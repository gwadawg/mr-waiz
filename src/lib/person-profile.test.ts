import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  availablePlusItems,
  itemIsAttached,
  missingRoleRequirement,
  parsePersonProfile,
  validatePlusText,
} from './person-profile';

describe('person plus catalog', () => {
  it('starts with headshot, bio, note, and file on an empty person', () => {
    const labels = availablePlusItems({}).map(item => item.label);
    assert.deepEqual(labels.slice(0, 4), ['Headshot', 'Bio', 'Note', 'File']);
    assert.ok(labels.includes('Headshot'));
    assert.equal(labels.includes('Email'), true);
  });

  it('drops headshot from the list once this person has one, and keeps note and file', () => {
    const labels = availablePlusItems({
      files: [{ kind: 'headshot', file_name: 'jane.jpg', public_url: 'https://cdn.example/jane.jpg' }],
      notes: [{ body: 'Morning calls' }],
      profile: { biography: 'Helps first-time buyers.' },
    }).map(item => item.key);
    assert.equal(labels.includes('headshot'), false);
    assert.equal(labels.includes('biography'), false);
    assert.equal(labels.includes('note'), true);
    assert.equal(labels.includes('file'), true);
    assert.equal(itemIsAttached({ files: [{ kind: 'headshot', file_name: 'a.jpg' }] }, 'headshot'), true);
  });

  it('asks for licensed states on a co-LO only when that item was never added', () => {
    assert.equal(missingRoleRequirement('co_lo', {}), 'Add licensed states for this co-LO');
    assert.equal(missingRoleRequirement('co_lo', { states_licensed: ['TX'] }), null);
    assert.equal(missingRoleRequirement('loa', {}), null);
    assert.equal(missingRoleRequirement('primary_lo', {}), null);
  });

  it('keeps only catalog keys in the profile bag', () => {
    assert.deepEqual(
      parsePersonProfile({ biography: '  Bio  ', review_url: 'https://r.example', extra: 'no', timezone: '' }),
      { biography: 'Bio', review_url: 'https://r.example' },
    );
  });

  it('checks email and review links when that item is saved', () => {
    assert.match(validatePlusText('email', 'not-an-email') ?? '', /email/i);
    assert.equal(validatePlusText('email', 'a@b.co'), null);
    assert.match(validatePlusText('review_url', 'reviews.example') ?? '', /http/i);
    assert.equal(validatePlusText('biography', 'Short bio'), null);
  });
});
