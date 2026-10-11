---
title: Offer letter process — Design
status: draft
last_updated: 2026-10-11
artifact_type: design
related_docs:
  - offer-letters/README.md
  - AGENTS.md
---

# Offer letter process — Design

After a sales call, produce a designed offer page for that person
from one of four frameworks.
The page uses the Trust One visual system.
Price and the call story change per person.
Deliverables, section order, and proof numbers stay in the framework.

The skill that fills a letter is a later pass.
The host and the access rule are decided here.
This spec stores the frameworks, the letter files, and the rulings
the skill will read.

## Purpose

End a sales call and fill a custom offer page in one pass.
The person gets the offer they were quoted, in the language of
their product, with the deliverables for their package.

## Non-goals

- The offer-letter skill
- Minting a new token or sending a link as part of filling a letter
- A typed password, a login, or a second channel to open a letter
- Migrating pages that already live in `public/offers/`
- Copying framework text into `AGENTS.md`, Cursor rules, or Claude rules
- A fifth offer shape. Home equity and other products wait
  until a framework file exists for them

## Host and access

`offerletter.waizmedia.net` is a custom domain on the Railway service
that deploys this repo.
The hostname moves off Vercel.
The public marketing page that Vercel serves on that hostname today
is replaced by this app.

A letter opens only at `/{slug}/{token}`.
The token is 32 random hex characters, stored in `offer-letters/registry.ts`,
and it is not written into the HTML.
A missing token, a wrong token, and an unknown slug all return
the same private-link page.
There is no index and no sitemap.
The response is `noindex`, `nofollow`, `no-referrer`, and `no-store`.
The token list is read on the server only.

The link is the key.
Whoever receives the full link can open it,
including someone they forward it to.
Guessing a company name does not open a letter, and scraping the host
does not produce a list of letters.
A typed password is not added.
New letters stay out of `public/offers/`.

Order of work:

1. Point `offerletter.waizmedia.net` at Railway and confirm the Trust One
   link hits the private gate.
2. Add the frameworks, the shell, the rules, and the Trust One brief.
3. Build the skill after that hostname is serving the gate.

## Layout and authority

Everything for this process stays in `offer-letters/`.
`AGENTS.md` keeps its existing pointer to `offer-letters/README.md`.
Frameworks, rules, and a letter are loaded only while a letter
is being built.
One letter loads one framework file.

```text
offer-letters/
  README.md
  RULES.md
  shell/
  frameworks/
    dscr-call-center.md
    dscr-leads-only.md
    reverse-call-center.md
    reverse-leads-only.md
  letters/{slug}/
    brief.md
    transcript.txt
    transition.md
  sheets/{slug}/index.html
  registry.ts
```

`README.md` is the map.
`RULES.md` holds the production paths and the stop rules in this spec.
Deliverables and proof numbers stay in the framework files.
`shell/index.html` is the visual system taken from the Trust One page,
stored once, with slots for the framework copy and the brief.
Each framework file is one complete offer.
`letters/{slug}/` is that person's state.
`sheets/{slug}/index.html` is the page they open.
`registry.ts` stays as it is until the publishing pass.

When two files disagree, use this order:

| Question | File that wins |
|---|---|
| Headlines, deliverables, proof numbers, mission statement, section order | That letter's framework document |
| Name, company, which framework, the price in your words | `letters/{slug}/brief.md` |
| What was said on the call | `letters/{slug}/transcript.txt` |
| The transition paragraph on the page | `letters/{slug}/transition.md` |
| What the prospect sees | `sheets/{slug}/index.html` |

`transition.md` can be rewritten from the transcript and the framework.
The HTML is produced from the shell, the framework, the brief,
and either the transition or the mission statement.

## What a framework holds

Each framework file owns the locked copy:

- Section order: Hero, Plan, Deliverables, Price, Scenario, Next
- The headline, with the company name left open
- The deliverable list and the two-week onboarding timeline
- The proof numbers for that product
- The mission statement, used as the Plan block when there is no transcript
- The "new system" side of the Plan, including those proof numbers

The brief owns the quote.
The Price section and the Scenario table are the price quoted on the call,
or the price written out when the call does not make it clear.
Dollar amounts are not stored in the framework.
A definition that belongs to the quote, such as what counts as
a conversation, lives in the price words.

The package decides the deliverable list.
The product decides the words and the proof numbers.
Reverse and DSCR share deliverable roles inside a package.
They do not share proof numbers.

Call center roles, taken from the Trust One page:

- Meta ads under their brand
- Campaign management
- Sites, funnels, and landers
- Live call center
- Qualify, then hand off
- Reporting

Leads-only roles, taken from the shape of that offer:

- Meta ads under their brand
- Campaign management
- Sites, funnels, and landers
- A pipeline for these leads
- Playbook and nurture
- Training and a team channel
- Reporting

A tool that belongs to one person, such as a named CRM
or an extra drip line, is added only by editing that framework.
The edit then applies to every letter on that package.

First drafts:

| Framework | Source |
|---|---|
| DSCR call center | The Trust One sheet |
| DSCR leads only | The Chuck Eueno sheet, leaving out facts that are only his |
| Reverse call center | The DSCR call-center roles, in reverse language |
| Reverse leads only | The DSCR leads-only roles, in reverse language |

Facts that stay out of the DSCR leads-only framework because they
are Chuck Eueno's: his daily volume, golden and brown lead mix,
Bonzo as his CRM, a named LOA, Facebook profile polish,
and the second-number drip.
The DSCR leads-only proof number taken from that sheet is the
conversation rate of about 40 percent.
His office's cost-to-contact figure stays out.

The two reverse files are unfinished until their proof numbers
are written into those files.
Until that review is recorded in the file, a reverse letter is not filled.

## How a letter is produced

The slug is the lowercase kebab-case of the company name.
Drop a trailing legal word such as Financial, Group, or LLC
when the short name is already clear, as in `trust-one`.
When that company already has a letter, the slug is the existing one.

```text
letters/{slug}/brief.md
  product:      reverse | dscr
  package:      call-center | leads-only
  name:         the person
  company:      the company
  price:        the quote, in your words
  transcript:   path to transcript.txt, or none
  recording:    optional link
  email:        optional
```

The product and package select the framework file.

**Transcript attached.**
The call is saved as `transcript.txt` and left as the raw call.
`transition.md` is written from that call plus the framework's
"new system" side.
A reasonable inference about their situation is allowed.
The Plan block uses that transition.
The quoted price is copied into the brief.
If the call names two prices, or the price is muddy,
the letter waits until the price is written out.

**No transcript.**
The brief supplies the product, package, name, company, and price.
The Plan block is the framework mission statement.
`transition.md` is not created.

The page is filled in one pass.

- The shell supplies the design.
- The framework supplies the headline, deliverables, proof numbers,
  onboarding, and next step.
- The brief supplies the name, company, and price.
- The Plan block is the transition or the mission statement.
- The Scenario table uses only figures already in the price.
- A missing recording link or email is left off the page.

The company name is filled into the headline and the deliverables.
The rest of that locked copy stays as written in the framework.

Changing this person's deal means editing the brief,
or `transition.md` when the story is wrong,
then filling the page again.
Changing the offer for everyone on that package means editing
the framework.
Letters already filled stay as they are until they are filled again.

### Existing sheets

Trust One stays the first sheet.
Its DSCR call-center copy is extracted into
`frameworks/dscr-call-center.md`.
The Plan copy already on that page is saved as
`letters/trust-one/transition.md`.
The brief records the name, company, price, and recording link
from the page.
`transcript.txt` is added when the call file is available.
Until then the brief sets `transcript` to `none`,
and the page keeps the saved transition.
It does not switch to the mission statement
just because the raw call is not in the repo yet.

Chuck Eueno is a source for the DSCR leads-only framework.
His page stays in `public/offers/`.

## When the process stops

The letter is filled only when the brief has a product,
a package, a name, a company, and a price.
If one of those is missing, ask for that field and wait.

If a transcript is attached and the price is muddy,
or the call states two different quotes,
the price stays blank until it is written out.
The page is not filled with a guessed number.

If the call asks for a deliverable that is not in the framework,
the page keeps the framework list.
The transition can describe their situation.
It cannot promise the extra item.
Adding that item means editing the framework.

Proof numbers on the page come from the framework.
The transition can infer their situation.
It cannot introduce a new stat, a new timeline, or a new guarantee.
If the call cites a different benchmark, the framework number stays.

A slug that already exists is an update of that letter.
The brief is edited and the page is filled again.
A second sheet is not created under the same slug.

The Scenario table is drawn only from figures already in the price.
When the price cannot be turned into rows,
the page shows the price in the brief's words and leaves the table out.
The remaining sections stay in order:
Hero, Plan, Deliverables, Price, Next.

This process writes the brief, the transcript, the transition,
and the HTML.
It does not mint a token or publish the link.

## How a letter is checked

A letter is done when the files agree.
Read them before the page is treated as finished.

The framework file has a headline, a deliverable list,
proof numbers, a mission statement, the two-week onboarding steps,
and the six sections in order.
A reverse framework with no proof numbers fails this check.

The brief has a product, a package, a name, a company, and a price.
The page is not filled while any of those are empty,
or while a transcript leaves the price muddy or states two quotes.

With no transcript, and no saved `transition.md`,
the Plan block is the framework mission statement.
With a transcript, `transcript.txt` is the call itself,
and `transition.md` is what the Plan block shows.
An existing sheet may keep a saved `transition.md`
while `transcript` is `none`.

The deliverable list on the page matches the framework,
with the company name filled in.
The price on the page matches the brief.
Every figure in the Scenario table appears in that price.
If the price cannot be turned into rows,
the table is absent and the price words are shown.

An existing slug updates that letter's brief and page.

Trust One is the first regression case.
`frameworks/dscr-call-center.md` is taken from that sheet,
and a refilled page keeps its deliverables, proof numbers,
and section order.
The DSCR leads-only framework is checked against the
leads-only roles above, with Chuck Eueno's personal facts left out.
Each reverse framework is checked against the DSCR list it was
rewritten from: same roles, reverse language, and proof numbers
written into the file.

The skill is not part of this check.
The host check is separate: a request to the bare company slug on
`offerletter.waizmedia.net` returns the private-link page,
and the full Trust One link returns that sheet.
