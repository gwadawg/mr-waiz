import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isKickoffIdentityFieldComplete,
  mergeIdentityFields,
  mergeIdentityFromMembers,
  pickAccountIdentityRootId,
  pickIdentitySource,
  resolveIdentityClientId,
  withIdentityProfile,
} from './client-identity';

describe('client-identity', () => {
  it('resolveIdentityClientId uses self when no link', () => {
    assert.equal(resolveIdentityClientId({ id: 'a', identity_client_id: null }), 'a');
    assert.equal(resolveIdentityClientId({ id: 'b', identity_client_id: 'a' }), 'a');
  });

  it('mergeIdentityFields fills gaps without overwriting offer row', () => {
    const offer = {
      id: 'offer',
      name: 'Jane Doe DSCR',
      phone: '',
      nmls: '123',
      reporting_type: 'DSCR',
      states_licensed: null as string[] | null,
    };
    const identity = {
      id: 'identity',
      name: 'Jane Doe RM',
      phone: '555-0100',
      nmls: '123',
      states_licensed: ['FL'],
      reporting_type: 'RM',
    };
    const merged = withIdentityProfile(offer, identity);
    assert.equal(merged.name, 'Jane Doe DSCR');
    assert.equal(merged.phone, '555-0100');
    assert.deepEqual(merged.states_licensed, ['FL']);
    assert.equal(merged.reporting_type, 'DSCR');
  });

  it('pickIdentitySource prefers the row with more identity fields', () => {
    const sparse = { id: '1', name: 'A', phone: '1' };
    const rich = { id: '2', name: 'B', phone: '1', nmls: '99', website: 'https://x.com' };
    assert.equal(pickIdentitySource([sparse, rich]).id, '2');
  });

  it('isKickoffIdentityFieldComplete requires all kickoff identity keys', () => {
    assert.equal(
      isKickoffIdentityFieldComplete({
        contact_role: 'MLO',
        states_licensed: ['FL'],
        nmls: '1',
        brokerage_name: 'Co',
        timezone: 'America/New_York',
      }),
      true,
    );
    assert.equal(
      isKickoffIdentityFieldComplete({
        contact_role: '',
        states_licensed: [],
        nmls: '1',
        brokerage_name: 'Co',
        timezone: 'America/New_York',
      }),
      false,
    );
  });

  it('mergeIdentityFields does not copy empty arrays', () => {
    const base = { id: '1', name: 'X', states_licensed: ['TX'] };
    const source = { id: '2', name: 'Y', states_licensed: [] };
    assert.deepEqual(mergeIdentityFields(base, source).states_licensed, ['TX']);
  });

  it('mergeIdentityFromMembers fills each field from whichever offer has it', () => {
    const merged = mergeIdentityFromMembers([
      {
        id: 'he',
        name: 'HE subaccount',
        email: 'lo@example.com',
        phone: null,
        nmls: '111',
        states_licensed: ['TX'],
      },
      {
        id: 'dscr',
        name: 'DSCR subaccount',
        email: null,
        phone: '5559876543',
        nmls: null,
        states_licensed: null,
        timezone: 'America/Chicago',
      },
    ]);
    assert.equal(merged?.email, 'lo@example.com');
    assert.equal(merged?.phone, '5559876543');
    assert.equal(merged?.nmls, '111');
    assert.deepEqual(merged?.states_licensed, ['TX']);
    assert.equal(merged?.timezone, 'America/Chicago');
  });

  it('pickAccountIdentityRootId prefers the fullest profile', () => {
    const root = pickAccountIdentityRootId([
      {
        id: 'he',
        name: 'HE',
        identity_client_id: null,
        engagement_kind: 'initial',
        created_at: '2026-01-01',
        email: null,
        phone: null,
        nmls: null,
      },
      {
        id: 'dscr',
        name: 'DSCR',
        identity_client_id: null,
        engagement_kind: 'cross_sell',
        created_at: '2026-02-01',
        email: 'lo@example.com',
        phone: '5551234567',
        nmls: '12345',
      },
    ]);
    assert.equal(root, 'dscr');
  });
});
