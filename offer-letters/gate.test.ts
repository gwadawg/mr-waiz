import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideOfferLetterRequest, letterIsOpen, parseOfferLetterPath } from './gate';
import { offerLetters } from './registry';

const token = offerLetters['trust-one'].token;

describe('offer letter gate', () => {
  it('opens the sheet only on the offer host with the token', () => {
    const decision = decideOfferLetterRequest(
      'offerletter.waizmedia.net',
      `/trust-one/${token}`,
    );
    assert.deepEqual(decision, { kind: 'serve', slug: 'trust-one', token });
  });

  it('hides the sheet when the token is missing or wrong', () => {
    assert.equal(decideOfferLetterRequest('offerletter.waizmedia.net', '/trust-one').kind, 'wall');
    assert.equal(
      decideOfferLetterRequest('offerletter.waizmedia.net', '/trust-one/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').kind,
      'wall',
    );
  });

  it('does not serve the sheet from the dashboard host', () => {
    assert.equal(
      decideOfferLetterRequest('os.waizmedia.net', `/trust-one/${token}`).kind,
      'ignore',
    );
  });

  it('rejects a slug that is not a letter', () => {
    assert.equal(letterIsOpen('chuck-eueno', token), false);
    assert.equal(parseOfferLetterPath('/Trust-One/' + token), null);
  });
});
