# Offer letters

Private HTML letters for sales calls. This folder is the whole feature. The dashboard does not own it.

Sheets are viewed in the browser. They are not a download, and they are not a public page.

## Link

`https://offerletter.waizmedia.net/{slug}/{token}`

The token is the access key. A wrong or missing token returns a blank private-link page. The old `os.waizmedia.net/offers/...` path is not used for letters in this folder.

`offerletter.waizmedia.net` serves only these links. Login, the dashboard, and the API do not answer on that host.

## Add a letter

1. Copy the latest sheet into `offer-letters/sheets/{slug}/index.html`.
2. Add `{slug}` to `offer-letters/registry.ts` with a new 32-character hex token.
3. Publish this repo. Send the link above. Do not send a link that uses the company name alone.

The token stays in `registry.ts`. Do not paste it into the HTML. The repo stays private because the token is a key.

## What stays out

Older public sheets under `public/offers/` (Chuck Eueno and the rest) are a different set. New letters do not go there.
