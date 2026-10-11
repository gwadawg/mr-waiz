---
name: offer-letter
description: >-
  Builds a private client offer page for offerletter.waizmedia.net from one
  framework plus a brief. Use when the user asks for an offer letter, offer
  page, or offer sheet, pastes a sales-call transcript, or names Reverse or
  DSCR with call center or leads only.
---

# Offer letter

Fill one private offer page for one client.

The page arrives after the sales call.
The sale is already made on the phone.
The page exists to give clarity: what they get, what it costs,
and how the mechanism works.
It is not a landing page and not an opt-in page.
No hooks, no urgency, no persuasion copy.
Write it like a professional scope-and-pricing document
that happens to look good.

The locked offer lives in `offer-letters/frameworks/`.
Read the [design spec][spec] before the first letter in a session.
Load one framework file after the product and package are known.

## Inputs

Required before a page is filled:

- product: `reverse` or `dscr`
- package: `call-center` or `leads-only`
- person name
- company
- price, in the user's words

Optional:

- transcript
- recording link
- email
- additions, such as a resource section or a recording button

Ask only for the required fields that are missing.
Wait. Do not guess a price, a product, or a package.

## Pick the framework

| Product | Package | File |
|---|---|---|
| `dscr` | `call-center` | `offer-letters/frameworks/dscr-call-center.md` |
| `dscr` | `leads-only` | `offer-letters/frameworks/dscr-leads-only.md` |
| `reverse` | `call-center` | `offer-letters/frameworks/reverse-call-center.md` |
| `reverse` | `leads-only` | `offer-letters/frameworks/reverse-leads-only.md` |

Read that file when it exists.
If it is missing, still fill the page.
Use the layout of the current sheet under `offer-letters/sheets/`.
Copy the design only.
Deliverables follow the call-center roles on that sheet
when the price includes a per-conversation fee.
Do not invent a proof number that is not already printed
on an existing letter.

One page can show reverse and DSCR together
when the brief says to show both.
Put each price in the price section.
Keep one slug.

## How the transcript is used

The transcript personalizes. It does not narrate.

Pull from the call only:

- names, company, and who the page should speak to
- the product or products they want
- a specific concern to answer inside an existing section,
  such as wanting to see the ad message before it runs

Do not retell the call on the page.
Do not quote the prospect.
Do not build sections out of call moments.
One short personalized paragraph at the top of the page is the cap.
If the transcript adds nothing a section needs, use none of it.

## Write the letter

Slug: lowercase kebab-case of the company name.
Drop a trailing Financial, Group, or LLC when the short name is clear.
Acme Financial becomes `acme`.
If that slug already exists, update that letter.
Do not create a second sheet. Keep its token.

```text
offer-letters/letters/{slug}/brief.md
  product, package, name, company, price
  transcript: path, or none
  recording, email, additions — only when supplied
```

With a transcript, save it verbatim as `transcript.txt`.
Write `transition.md` as the one short personalized paragraph,
within the limits above.
It cannot add a deliverable, a stat, a timeline,
or a guarantee, and it cannot change the price.
If the user writes two prices as options to show, put both on the page.
If the call states two prices and the user has not written
which ones to show, leave the price blank and wait.

With no transcript, skip `transition.md`.
The opening paragraph is the framework mission statement.

## Page

Fill `offer-letters/sheets/{slug}/index.html` from
`offer-letters/shell/index.html` plus the framework and the brief.

Section order: Hero, Deliverables, Price, How it works, Next step.
Deliverables come before price.
Clarity on what they get is the point of the page.

- The headline is professional and plain.
  Name the company and the service.
  "Reverse + DSCR growth system for Lending Arena" is right.
  "One offer. Or both. The spend stays in ads." is wrong.
- The hero subline states the structure and the price in one breath,
  then stops.
- Deliverables, proof numbers, onboarding, and next step
  come from the framework. Fill the company name into that copy.
- "How it works" explains the mechanism: who runs what,
  whose card pays Meta, what counts as a billable conversation,
  what happens after a conversation is established.
- Price and the Scenario table come from the brief.
  Every scenario figure must already be in the price.
  If the price cannot be rows, omit the table and show the price words.
- The one personalized paragraph is `transition.md`,
  or the mission statement when there is no transcript.
- A missing recording link or email is left off the page.

If `shell/index.html` does not exist yet, use the layout and CSS of
the current page under `offer-letters/sheets/` as the visual system.
Copy the design only.
Do not copy that page's client name, price, or plan.

### Additions

An addition is an instruction on this letter only.
It may add a block or a control.
It may not change deliverables, proof numbers, price,
or the section order above.

- Recording button: only when the brief has a recording link.
  The button opens that link.
- Resource section: only the links named in the instruction,
  placed after the core sections.
  Do not invent links.

If an instruction asks to change locked copy, stop and ask
the user to restate it as an addition or as a framework edit.

## Access

New letters go under `offer-letters/`, never `public/offers/`.
Do not add a password.

For a new slug, add one entry to `offer-letters/registry.ts`:

- `token`: 32 random hex characters
- `file`: `{slug}/index.html`

Do not write the token into the HTML.
On an update, keep the existing token.
The link to give the user is:

`https://offerletter.waizmedia.net/{slug}/{token}`

Do not send that link to the client.
The page is live after this repo is deployed to Railway.
When the user asks to make the letter live, commit the letter
files, push the branch Railway deploys, and confirm the link
opens the page.
Do not deploy unless the user asks.

## Done

The brief has product, package, name, company, and price.
The headline is plain: company plus service, no hook.
The deliverable list on the page matches the framework,
with the company name filled in.
The price on the page matches the brief.
Call material appears only as the one personalized paragraph
or as an answer inside an existing section.
An addition appears only when the brief contains that instruction.

[spec]: ../../../docs/superpowers/specs/2026-10-11-offer-letter-process-design.md
