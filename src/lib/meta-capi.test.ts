import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { parsePixelWrite, toPublicPixel } from '../app/api/meta-pixels/pixel-http';
import {
  buildCapiEvent,
  buildFbc,
  hashEmail,
  hashPhone,
  metaEventName,
  metaSourceKey,
  stagesForEvent,
  stagesForFlagChange,
} from './meta-capi';

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('meta stage mapping', () => {
  it('sends qualified and hot only when those flags are true on a lead', () => {
    assert.deepEqual(
      stagesForEvent({ eventType: 'lead', isQualified: true, isHot: true }),
      ['qualified', 'hot'],
    );
    assert.deepEqual(
      stagesForEvent({ eventType: 'lead', isQualified: false, isHot: false }),
      [],
    );
    assert.deepEqual(
      stagesForEvent({ eventType: 'dial', isQualified: true, isHot: true }),
      [],
    );
  });

  it('maps pipeline events onto the five Meta names', () => {
    assert.equal(metaEventName('qualified'), 'CompleteRegistration');
    assert.equal(metaEventName('hot'), 'Contact');
    assert.equal(metaEventName('proposal_made'), 'InitiateCheckout');
    assert.equal(metaEventName('submission_made'), 'SubmitApplication');
    assert.equal(metaEventName('loan_funded'), 'Purchase');
    assert.deepEqual(
      stagesForEvent({ eventType: 'loan_funded', isQualified: false, isHot: false }),
      ['loan_funded'],
    );
  });

  it('sends a flag only on the transition to true', () => {
    assert.deepEqual(
      stagesForFlagChange(
        { is_qualified: false, is_hot: true },
        { is_qualified: true, is_hot: true },
      ),
      ['qualified'],
    );
    assert.deepEqual(
      stagesForFlagChange(
        { is_qualified: true, is_hot: null },
        { is_hot: true },
      ),
      ['hot'],
    );
    assert.deepEqual(
      stagesForFlagChange(
        { is_qualified: true, is_hot: true },
        { is_qualified: true, is_hot: true },
      ),
      [],
    );
  });
});

describe('pixel library input', () => {
  it('accepts a shared pixel without a client and hides the token from the public shape', () => {
    const parsed = parsePixelWrite(
      {
        name: 'DSCR pixel',
        pixel_id: '123456789012345',
        access_token: 'a'.repeat(20),
        test_event_code: '',
      },
      { tokenRequired: true },
    );
    assert.equal('error' in parsed, false);
    if ('error' in parsed) return;
    assert.equal(parsed.pixel_id, '123456789012345');
    assert.equal(parsed.test_event_code, null);
    const pub = toPublicPixel({
      id: '41d3ed87-30f6-40d3-a25d-914729d1038b',
      name: parsed.name,
      pixel_id: parsed.pixel_id,
      test_event_code: parsed.test_event_code,
      updated_at: '2026-10-14T00:00:00.000Z',
    });
    assert.equal('access_token' in pub, false);
    assert.equal(pub.has_token, true);
  });

  it('rejects a missing token on create and a short token on edit', () => {
    const created = parsePixelWrite({ name: 'DSCR', pixel_id: '12345' }, { tokenRequired: true });
    assert.equal('error' in created, true);
    const edited = parsePixelWrite(
      { name: 'DSCR', pixel_id: '12345', access_token: 'short' },
      { tokenRequired: false },
    );
    assert.equal('error' in edited, true);
  });
});

describe('meta identity', () => {
  it('hashes a normalized email and a 10-digit phone with country code', () => {
    assert.equal(hashEmail('  Ada@Example.com '), sha('ada@example.com'));
    assert.equal(hashPhone('(415) 555-1212'), sha('14155551212'));
    assert.equal(hashEmail('not-an-email'), null);
    assert.equal(hashPhone('555'), null);
  });

  it('builds fbc from fbclid and keeps an existing fbc', () => {
    assert.equal(buildFbc('IwAR0abc', 1_700_000_000_000), 'fb.1.1700000000000.IwAR0abc');
    assert.equal(buildFbc(' fb.1.5.IwAR0 ', 9), 'fb.1.5.IwAR0');
    assert.equal(buildFbc('   ', 9), null);
  });

  it('omits a purchase with no match keys and attaches loan size only on Purchase', () => {
    assert.equal(
      buildCapiEvent('loan_funded', 'event-1', {
        email: null,
        phone: null,
        externalId: 'contact-1',
        fbclid: null,
        leadTimeMs: 1_700_000_000_000,
        eventTimeSec: 1_700_000_100,
        value: 250000,
      }),
      null,
    );

    const purchase = buildCapiEvent('loan_funded', 'event-1', {
      email: 'ada@example.com',
      phone: '4155551212',
      externalId: 'contact-1',
      fbclid: 'IwAR0abc',
      leadTimeMs: 1_700_000_000_000,
      eventTimeSec: 1_700_000_100,
      value: 250000,
    });
    assert.equal(purchase?.event_name, 'Purchase');
    assert.equal(purchase?.event_id, 'event-1');
    assert.equal(purchase?.action_source, 'system_generated');
    assert.deepEqual(purchase?.custom_data, { currency: 'USD', value: 250000 });
    const userData = purchase?.user_data as { fbc: string; em: string[] };
    assert.equal(userData.fbc, 'fb.1.1700000000000.IwAR0abc');
    assert.equal(userData.em[0], sha('ada@example.com'));

    const qualified = buildCapiEvent('qualified', 'lead-1', {
      email: 'ada@example.com',
      phone: null,
      externalId: null,
      fbclid: null,
      leadTimeMs: 1,
      eventTimeSec: 2,
      value: 250000,
    });
    assert.equal(qualified?.event_name, 'CompleteRegistration');
    assert.equal(qualified?.event_id, metaSourceKey('qualified', 'lead-1'));
    assert.equal(qualified?.custom_data, undefined);
  });
});
