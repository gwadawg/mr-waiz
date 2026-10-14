---
title: Client landing builder — Design
status: ready
last_updated: 2026-10-14
compatibility_reviewed: 2026-10-07
artifact_type: design
related_docs:
  - docs/CLIENT_ONBOARDING.md
  - docs/superpowers/plans/2026-10-07-client-landing-builder.md
  - src/lib/form-submissions.ts
  - src/lib/client-sites.ts
  - src/lib/virtual-card/intake.ts
  - src/app/api/clients/[id]/virtual-card/route.ts
---

# Client landing builder — Design

The team publishes a loan-officer landing page from Client File.
DSCR pages are built from YAML in `gwadawg/dscr-experts` and served at
`https://dscrexperts.com/{slug}/`. Reverse pages are built from YAML in
`gwadawg/rm-website-template` and served at
`https://retirementmortgagexperts.com/{slug}/`. Mr. Waiz keeps the form
and the publish record. Each template repo keeps layout, copy, themes,
and the compliance build.

The client's product chooses the form. DSCR and reverse mortgage
clients can publish. Call center clients cannot. Team Westside is
later work.

## Purpose

A teammate opens a DSCR or reverse client, fills the form, and publishes.
The same form edits a page later. Each publish is a new row.
The live page is rebuilt by the template repo from that save.

## Non-goals (v1)

- A second site, a second Supabase project, or a second Railway app
- New columns or actions on Client Roster
- A history browser. Rows are kept. A screen to browse them comes later
- Virtual cards, or merging this with the card wizard
- Team Westside pages on `teamwestside.dscrexperts.com`.
  Those stay hand-edited in the sibling repo
- Letting the team change layout, CSS, or stock copy.
  A new theme is a change in `dscr-experts`, then a new option here
- Auto-merge. A person with write access on the template repo merges
- Choosing which CRM the phone comes from. That process stores one number
  before this form is opened

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Where the form lives | Mr. Waiz. Own folder, own API route, lazy-loaded from Client File |
| Who sees it | `clients.reporting_type` of `DSCR` or `RM`. Call center hides the control |
| Which repo | `gwadawg/dscr-experts` (`LANDING_DSCR_GITHUB_REPO`) |
| Public site | `https://dscrexperts.com/{slug}/` |
| Where the design lives | The template repo. Mr. Waiz does not store HTML or CSS |
| Where client data lives | Supabase, through Mr. Waiz. One row per save in `client_form_submissions` |
| Team-facing word | **Template**. Stored in YAML as `theme` |
| v1 templates | `theme-1` (dark), `theme-light` (light), `theme-custom` (dark + hex accent) |
| What a publish commits | `clients/{slug}.yaml` and, when a headshot exists, `brand_assets/clients/{slug}/headshot.{ext}` |
| What a publish does not commit | Generated HTML, `vercel.json`, or theme files. Vercel runs `npm run build` |
| Edit model | Open the last save, change fields, publish again. New row each publish |
| When URLs are saved | After a human merges and `HEAD https://dscrexperts.com/{slug}/` returns 200 |
| Phone on the page | The number on the form. Prefill from `clients.phone`. The operator confirms it. The YAML is a snapshot |
| Texting | Form sets `compliance.sms.status` to `ready` or `pending`. Default `ready` |
| Search indexing | First publish sets `preview: true` (live, `noindex`). A later publish can turn it off |
| Quiz link | Operator pastes `applyUrl`. It is not `clients.funnel_url` |
| Company NMLS | Typed on the form. Not read from a client column |
| Who merges | Anyone with write access on the repo. Mr. Waiz has no merger allow-list |
| Preview of the PR | The Vercel preview on the pull request |

## Flow

```text
Client File → Landing   (DSCR and RM clients)
  → GET  /api/clients/{id}/landing-page
       latest draft, else latest applied, else clients row
  → teammate edits fields
  → POST save
       inserts or updates the open draft
  → POST publish
       validate
       reject a slug that is reserved, a demo, or already used
       download headshot when clients.headshot_url is set
       open PR on branch landing/{slug}
       insert status=submitted with pr url
  → human merges
  → GitHub pull_request webhook
       merged + HEAD /{slug}/ is 200 → applied + both URLs
       merged + page not live yet → stay submitted, set publish.error
       closed unmerged → dismissed
  → POST { action: "check" }
       retries the HEAD when a build finishes after the webhook
```

If a `submitted` row already exists for that client, the form is
read-only until the pull request merges or is closed. Closing the pull
request sets that row to `dismissed`. The previous `applied` row stays
the live page.

## What each side owns

| Mr. Waiz | Template repo `gwadawg/dscr-experts` |
|----------|--------------------------------------|
| Form, prefill, permissions | Layout, CSS, stock copy, themes, compliance pages |
| Draft and publish rows | `npm run build` and `compliance-check` |
| Opening the pull request | Failing the deploy when compliance is missing |
| Live URLs on `clients`, after the page responds | The public site on Vercel |

Adding a theme later is a `tokens.css` and `theme.json` in the template
repo. This form gains a choice. It does not gain a layout.

## Page contract

A publish writes `clients/{slug}.yaml` with `draft: false`.
The shape matches `clients/_example.yaml` in `dscr-experts`.

| YAML | Form |
|------|------|
| `slug` | Required. Lowercase letters, numbers, single hyphens. Must match the filename |
| `theme` | `theme-1`, `theme-light`, or `theme-custom` |
| `brand.accent` | Required on `theme-custom` (`#RGB` or `#RRGGBB`). Optional on `theme-light`. Rejected on `theme-1` |
| `preview` | `true` on the first publish. Operator can clear it on a later publish |
| `identity.name` | Required. Prefill from `primary_contact_name` or `name` |
| `identity.firstName` | Prefill from the onboarding submission `first_name`, else the first word of the name |
| `identity.title` | Optional |
| `identity.company` | Required. Prefill from `brokerage_name`, else `legal_business_name` |
| `identity.tagline` | Default `DSCR refinance for rental investors` |
| `identity.bio` | Optional. Prefill from `clients.biography` |
| `contacts.phone` | Required. Prefill from `clients.phone`. Operator confirms |
| `contacts.phoneE164` | Derived from the phone |
| `contacts.email` | Required. Prefill from `clients.email` |
| `contacts.address` | Required street, city, region, postal code. Prefill from the client address |
| `compliance.nmlsIndividual` | Required. Prefill from `clients.nmls` |
| `compliance.nmlsCompany` | Required. Typed on the form |
| `compliance.sms.status` | `ready` or `pending`. Default `ready` |
| `compliance.stateNotices` | Optional `texas` and/or `illinois`. Suggest from `states_licensed`. Operator confirms |
| `products` | Default DSCR refinance only (`primaryResidence: false`) |
| `applyUrl` | Required full `http(s)` URL. Pasted. Not the Perspective funnel |
| `bookingUrl` | Optional. Blank hides the thank-you booking button |
| `assets.headshot` | Left blank. The build finds `brand_assets/clients/{slug}/headshot.{ext}` |

Live URLs, written only after the production page responds:

| Column | Value |
|--------|--------|
| `clients.landing_page_url` | `https://dscrexperts.com/{slug}/` |
| `clients.thank_you_page_url` | `https://dscrexperts.com/{slug}/thank-you` |

### Slug

Refuse the publish when any of these is true:

- The slug fails the factory pattern, or it is a reserved site folder
  (`assets`, `clients`, `themes`, and the rest of `RESERVED_SLUGS`
  in `scripts/build-clients.mjs`)
- The slug is `demo-lo`, `demo-light`, or `demo-custom`
- Another client's `landing_page` row in `draft`, `submitted`, or
  `applied` already uses it
- `clients/{slug}.yaml` already exists in the repo and this client has
  no `applied` row for that same slug

An update for the same client and the same slug is allowed.
That commit replaces the YAML.

### Headshot

`clients.headshot_url` is a public URL in the `client-headshots` bucket.
The factory only reads a file under `brand_assets/clients/{slug}/`.

On publish, download the URL and commit
`brand_assets/clients/{slug}/headshot.png`, `.jpg`, `.jpeg`, or `.webp`.
A GIF is committed as PNG. If the client has no headshot, skip the file.
The page still publishes. The portrait stays empty until a later publish
adds one.

### Merged is not live

The GitHub webhook fires when the pull request closes.
A merge does not mean Vercel finished.

- Merged, and `HEAD https://dscrexperts.com/{slug}/` returns 200:
  set the row `applied` and write both URLs
- Merged, and the HEAD is not 200: leave the row `submitted` and set
  `publish.error`. The previous live URL stays
- Closed without merge: set the row `dismissed`

The form's check action retries the HEAD for a `submitted` row whose
pull request is merged. v1 has no cron and no Vercel webhook.

### Search indexing

`preview: true` keeps the pages live and sets `noindex`.
The first publish for a client uses `preview: true`.
Launch is a second publish with preview turned off.
The launch checklist in `docs/CLIENT_ONBOARDING.md` reminds the team.
It does not block go-live.

## Reverse mortgage

`reporting_type = RM` uses the same form, route, and webhook.
The product on the client picks the fields, the repo, and the site.
There is no picker inside the form.

A publish writes `clients/{slug}.yaml` with `draft: false` and
`theme: theme-1`, plus a headshot or logo when the client has one.
It does not commit generated HTML or `vercel.json`. Vercel runs
`npm run build`.

Reverse fields that DSCR does not have:

- Brand `individual` (default) or `company`. A company brand does not
  require an individual NMLS or a parent company. It can take a legal
  name.
- Colorway `stock`, or `custom` with `brandColors.ink` and
  `brandColors.action`. Mark and cream are optional.
- Hero line. The stock line is prefilled. Eighty visible characters,
  and one `*italic*` pair. Asterisks are not counted.
- SMS program name is the public brand. The texting checkbox sets
  `compliance.sms.status`.

Leave off booking URL, bio, DSCR product flags, accent themes, and
themes 2–5. Also leave off hide-from-search. This factory has no
preview flag. A `draft: true` file is skipped, so a publish stays
`draft: false`. The first publish is live and can be indexed.

Quiz URLs stay plain. The factory copies the visit query and forces
`utm_term=WM` on the quiz hop.

Refuse a host path, a demo slug (`demo-specialist`, `demo-brand`,
`demo-company`, `demo-evergreen`), or a yaml already on `main` that
this client does not own. The same slug may exist on the DSCR site.
Slug checks are per product. A merged pull request is matched by
number and `template_repo`, because the two repos number pulls
separately.

## Code layout

Do not add the form body to `ClientFile.tsx` or `ClientRoster.tsx`.
`ClientFile` gets one control, shown for DSCR and RM clients, that
mounts the lazy component. Client Roster gets no new action.

```text
src/lib/landing-page/
  products.ts     repo, site URL, theme ids, files a publish may touch
  types.ts        DSCR payload
  intake.ts       empty draft, prefill, parse, validate, slug rules
  yaml.ts         payload → clients/{slug}.yaml
  headshot.ts     download headshot_url → repo path + bytes
  github.ts       branch, commit the allowed files, open PR, read a file
  storage.ts      latest draft / submitted / applied, slug taken
  landing-page.test.ts

src/components/landing-page/
  LandingPageForm.tsx

src/app/api/clients/[id]/landing-page/route.ts
  GET    load form
  POST   { action: "save" | "publish" | "check" }

src/app/api/webhooks/github/landing-page/route.ts
  verify X-Hub-Signature-256
  merge + live page → applied + URLs
  merge + page down → stay submitted
  close → dismissed
```

`src/lib/client-sites.ts` stays the label helper for Personal, Landing,
Perspective, and Thank-you URLs. This feature writes `landing_page_url`
and `thank_you_page_url`. It does not replace that helper.

Follow `src/lib/virtual-card/` and
`src/app/api/clients/[id]/virtual-card/route.ts` for auth
(`admin_clients`), prefill order, and insert-via-`insertFormSubmission`.
Do not render the landing page inside Mr. Waiz.

## Data

### Form type

Add `landing_page` to `FORM_TYPES` in `src/lib/form-submissions.ts` and
to the `client_form_submissions_form_type_check` constraint. Copy the
current allowed list from `supabase/schema.sql` and add the new value.
Do not replace the list with an older migration.

Statuses stay the existing set: `draft`, `submitted`, `applied`,
`dismissed`.

### Row shape

`responses` jsonb:

```json
{
  "schema_version": "2026-10-07",
  "product": "DSCR",
  "template_repo": "gwadawg/dscr-experts",
  "template_id": "theme-1",
  "fields": {},
  "publish": {
    "pr_url": null,
    "pr_number": null,
    "head_sha": null,
    "merged": false,
    "error": null
  }
}
```

`fields` matches the page contract above. Theme ids never appear in the
public URL.

### Prefill order

1. Open `draft` for this client and `form_type = landing_page`, if one exists.
2. Else the latest `applied` row. Editing it creates a new draft.
   The applied row stays as history.
3. Else the `clients` row, using the prefill sources in the page contract.

Empty form fields fall through to the next source.
A saved value wins over the client row.

### History

Every publish inserts a `submitted` row, which becomes `applied` only
after the live page responds. Older applied rows stay.
v1 has no history screen.

There is one live page: the latest `applied` row.
Changing the client file does not change that page.
The team republishes to update it.

## Publish

Already prepared:

| Item | State |
|------|--------|
| GitHub token | On Railway as `LANDING_GITHUB_TOKEN` |
| Webhook | Hook `693836837` on `gwadawg/dscr-experts`. Events: `pull_request`. URL: `https://os.waizmedia.net/api/webhooks/github/landing-page` |
| Webhook secret | Local `.env.local` key `LANDING_GITHUB_WEBHOOK_SECRET`. Copy the same value to Railway before the route is deployed |
| Site | `https://dscrexperts.com/` is the production Vercel project `dscr-experts` |

Set on Railway before the first real publish:

| Variable | Use |
|----------|-----|
| `LANDING_GITHUB_TOKEN` | Fine-grained token. Contents and pull requests on `gwadawg/dscr-experts` |
| `LANDING_RM_GITHUB_TOKEN` | Fine-grained token. Contents and pull requests on `gwadawg/rm-website-template` |
| `LANDING_DSCR_GITHUB_REPO` | `gwadawg/dscr-experts` |
| `LANDING_RM_GITHUB_REPO` | `gwadawg/rm-website-template` |
| `LANDING_GITHUB_WEBHOOK_SECRET` | Verifies `X-Hub-Signature-256` |

Reverse uses the same webhook URL and the same secret.
The `pull_request` hook on `gwadawg/rm-website-template` is already installed.
The handler matches the repository name to the saved `template_repo`.

Branch name: `landing/{slug}`. One open branch per client.
The commit touches only the YAML and the headshot file.

The template repo build remains the compliance gate.
The form checks stop an empty or colliding publish.
They do not replace `compliance-check`.

## Operator notes

- Quiz completion in the quiz tool must be
  `https://dscrexperts.com/{slug}/thank-you`. The form does not set that.
- `sms.status: ready` turns on Text now. `pending` leaves call only.
  Default is `ready` because the stored number is already approved for text.
- The phone field is the number the outside process already chose.
  This form does not ask whether the CRM is ours or theirs.
