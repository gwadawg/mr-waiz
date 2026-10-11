/**
 * Private offer letters. The token is the access key.
 * A link without it must not render the sheet.
 */
export type OfferLetter = {
  /** URL-safe secret. Same length for every letter. */
  token: string;
  /** Path under offer-letters/sheets/. */
  file: string;
};

export const OFFER_LETTER_HOSTS = new Set([
  'offerletter.waizmedia.net',
]);

export const offerLetters: Record<string, OfferLetter> = {
  'trust-one': {
    token: 'f392f8ef0dd59187ec4988afe6122911',
    file: 'trust-one/index.html',
  },
};
