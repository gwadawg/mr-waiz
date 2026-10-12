---
title: Lead Entity and Identity Resolution — Design
status: in-progress (phases 1–3 live 2026-10-02)
last_updated: 2026-10-02
artifact_type: design
related_docs:
  - docs/KPIS.md
  - docs/AD-INTELLIGENCE.md
  - docs/superpowers/specs/2026-08-18-client-backend-conversions-design.md
  - docs/superpowers/specs/2026-08-14-client-loan-log-form-design.md
  - supabase/schema.sql
  - src/lib/webhook-ingest.ts
  - src/lib/contact-key.ts
  - src/lib/metrics.ts
  - src/app/api/raw/leads/route.ts
---

# Lead Entity and Identity Resolution — Design

## Purpose

Make one person on one client a real row that every event points at.
Dials, bookings, shows, transfers, proposals, fundings, DQs, and any
event type added later attach to that row with a foreign key.

The lead row owns identity, first-touch ad, and intake facts.
Each event keeps its own date. Ad reports read the ad from the lead,
so a funding in October on a June lead counts in October under June's
creative.

## Current state (measured 2026-10-02)

Read-only counts against production `events` (133,536 rows).

| Finding | Number |
|---------|--------|
| `lead` rows | 44,457 |
| `lead` rows on a synthetic `ldr:` key, not a GHL id | 13,763 (31%) |
| `dial` rows | 71,994, all with a contact key |
| Client + phone reachable under both `ldr:` and a real GHL id | 674 |
| Client + phone shared by 2+ real GHL ids | 38 |
| Real GHL ids seen on more than one client | 7 |
| Contacts with more than one `lead` row | 98 |
| Contacts whose lead rows disagree on ad | 0 |
| Non-lead events carrying an ad that differs from their lead's ad | 194 |

Events with no `lead` row under the same contact key:

| Type | Orphaned | Recoverable by client + phone |
|------|---------:|------------------------------:|
| dial | 3,262 | 755 |
| appointment_booked | 1,202 | 74 |
| show | 686 | 52 |
| proposal_made | 328 | 144 |
| no_show | 284 | 13 |
| live_transfer | 187 | 14 |
| submission_made | 90 | 32 |
| lo_bailed | 90 | 3 |
| loan_funded | 59 | 24 |

The rest have no lead webhook at all (dial-only lists, history before
the pipeline, loan log "can't find").

Today the "lead" is assembled at read time from `ghl_contact_id` or
`ldr:{client}:{phone}`. Three code paths build that key differently
(`buildContactKey`, `leadIdentityKey`, inline SQL in RPCs). Only
`manual_dq` stores a parent pointer, and it points at a log row.

## Decision

Use the standard pattern for this problem: a **dimension table with a
surrogate key**, an **identity map** from external ids to that key,
and **fact tables** that carry the key. This is the Kimball star shape
plus the identity-graph approach used by Segment, HubSpot, and
Salesforce for contacts that arrive from several systems.

```text
                  lead_identities
       (client_id, kind, value) -> lead_id
                        |
                        v
 clients 1---* leads (surrogate id, first-touch ad, intake, flags)
                 |
                 +---* events      (lead_id NOT NULL, occurred_at, type)
                 +---* loan_deals  (lead_id, size, commission, dates)
                 +---* lead_merges (audit of every merge)
```

### Rejected alternatives

| Option | Why not |
|--------|---------|
| `ghl_contact_id` as the lead key | 31% of leads have no real GHL id. GHL merges duplicate contacts and retires an id. The same id appears on 7 clients. |
| Point events at the first `lead` event | A log row becomes the entity. 98 contacts already have two. Fixing an ad rewrites history. Dial-only people have no lead event. |
| Stage columns on the lead (`funded_at`) | Cannot hold two loans, re-engagement, or future event types. |
| Keep the read-time contact key | The current failure. Breaks on key drift and on date windows. |

## Schema

All tables carry `client_id`. Identity is always scoped per client.

### `leads`

| Column | Type | Rule |
|--------|------|------|
| `id` | uuid PK | Surrogate. Never shown as a business id. Matches existing uuid convention. |
| `client_id` | uuid FK clients, not null | `on delete cascade` like `events` |
| `lead_name`, `lead_phone`, `lead_email` | text | Best known value. `lead_phone` stored normalized (10 digits). |
| `origin` | text check | `lead_webhook`, `sheet_import`, `dial_only`, `loan_log`, `inferred` |
| `first_seen_at` | timestamptz not null | Earliest event of any type |
| `lead_created_at` | timestamptz | Earliest `lead` event, null when none |
| `first_lead_event_id` | uuid FK events | `on delete set null` |
| `utm_content`, `ad_name`, `adset_name`, `campaign_name`, `utm_source`, `utm_campaign` | text | First touch. Written only while null. |
| `lead_source` | text | First touch |
| `is_qualified`, `is_hot`, `is_out_of_state` | boolean | Current state. Changes also write an event for audit. |
| `loan_amount`, `property_value`, `ltv` | numeric | Intake, typed because reports filter on them |
| `intake` | jsonb not null default '{}' | Offer-specific intake fields that are not reported |
| `merged_into_id` | uuid FK leads | Set on the losing row after a merge |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(client_id, first_seen_at desc)`,
`(client_id, utm_content) where utm_content is not null`,
`(merged_into_id) where merged_into_id is not null`.

### `lead_identities`

| Column | Type | Rule |
|--------|------|------|
| `lead_id` | uuid FK leads, not null | `on delete cascade` |
| `client_id` | uuid not null | Denormalized for the unique key |
| `kind` | text check | `ghl_contact`, `phone`, `email`, `synthetic` |
| `value` | text not null | Normalized (GHL id trimmed, phone 10 digits, email lowercased, `ldr:` string as is) |
| `is_primary` | boolean | The id shown for that kind |
| `first_seen_at` | timestamptz | |

Primary key `(client_id, kind, value)`. One identifier resolves to one
lead. A lead can have many identifiers: an old GHL id after a GHL
merge, an `ldr:` key from a sheet import, a second phone.

Index `(lead_id)`.

### `events` and `loan_deals`

- Add `lead_id uuid references leads(id) on delete restrict`.
  Restrict, so deleting a lead never silently drops history.
- Index `(lead_id, occurred_at desc)` on events, `(lead_id)` on
  loan_deals. Postgres does not index foreign keys on its own.
- After backfill coverage is 100%, `events.lead_id` becomes NOT NULL.
  Add the constraint `NOT VALID`, then `VALIDATE` so the table is not
  locked during the scan.
- Keep `ghl_contact_id`, phone, and ad columns as an ingest snapshot.
  Reports stop reading them for identity or attribution.
- `events.lead_event_id` (manual DQ only) is superseded and dropped
  after readers move.

### `lead_merges`

`(id, client_id, winner_id, loser_id, reason, merged_by, merged_at,
moved_counts jsonb)`. Every merge is auditable and reversible.

## Resolution rules

One Postgres function owns resolution:
`resolve_lead(client_id, ghl_contact_id, phone, email, name, origin,
occurred_at) returns uuid`.

Order, stopping at the first hit:

1. GHL contact id. Exact match in `lead_identities` (`ghl_contact`, or
   `synthetic` for `ldr:` values still sent by the loan log).
2. Phone, **only when the incoming row has no real GHL id**, and the
   phone maps to exactly one lead. This attaches loan-log and sheet rows
   to the GHL lead.
3. Email under the same rule as phone.
4. Otherwise insert a new lead and its identities.

When a real GHL id arrives for a lead found by phone, add that GHL id
to the same lead. Do not create a second person.

**Never auto-merge two real GHL ids.** Reverse mortgage households
often share one phone; the 38 shared phones are reviewed by a person.
Ambiguous phone matches (two leads) also go to review and create a new
lead flagged `inferred`.

Insert with `INSERT ... ON CONFLICT (client_id, kind, value) DO
NOTHING RETURNING`, then read back. That closes the race where two
webhooks for one new contact arrive together.

### Enforcement for every writer

A `BEFORE INSERT` trigger on `events` and `loan_deals` calls
`resolve_lead` when `lead_id` is null. That covers:

- `ingestWebhookEvent` (Make, all GHL event types, pending replay)
- loan log and DQ forms
- appointment helpers and credit queue
- one-off backfill scripts
- any event type added later

New event types need only the `event_type` check update. Linking is
automatic. Writers may pass `lead_id` explicitly when they already know
it; the trigger then does nothing.

A `BEFORE UPDATE OF ghl_contact_id, lead_phone` trigger re-resolves
when an event's identity changes.

### First-touch attribution

The trigger, on the first event that carries an ad for a lead, sets the
lead's ad columns where they are null. Later events never overwrite
them. That keeps the existing rule in `docs/AD-INTELLIGENCE.md`: the
original creative is immutable.

The 194 events whose own ad differs from the lead's ad remain on the
event as touch history. Reports use the lead's ad. Multi-touch
attribution can later read the event snapshots without a schema change.

### Merges

`merge_leads(winner, loser, reason)` in one transaction:

1. Re-point `events`, `loan_deals`, and `lead_identities` to the winner.
2. Fill null winner fields from the loser. First-touch ad keeps the
   earlier `first_seen_at`.
3. Set `loser.merged_into_id`, write `lead_merges`.

Old ids keep resolving through `merged_into_id`.

`mergeClients` in `src/lib/client-merge.ts` adds `leads` and
`lead_identities` to the moved tables and merges leads that collide on
the same identifier.

## Reporting day

Today every range filter uses UTC calendar days
(`${date}T00:00:00Z` to `T23:59:59Z`), and `events_daily_kpi` buckets
by `occurred_at AT TIME ZONE 'UTC'`. Anything after 8 PM Eastern lands
on the next day.

Aug–Sep 2026, events whose UTC date differs from their Eastern date:

| Type | Shifted |
|------|--------:|
| lead | 20.9% |
| appointment_booked | 12.7% |
| show / no_show | 12–14% |
| proposal_made | 9.2% |
| dial | 1.2% |

Meta spend (`insight_date`) is already the ad account's local day, so
CPL on a single day compares a local-day spend to a UTC-day lead count.

Rule: a date filter means the client's reporting day.

- `clients.reporting_timezone` (IANA, not null, default
  `America/New_York`). Replaces reliance on the sparse `clients.timezone`
  abbreviations.
- Range bounds are computed as local midnight in that zone, converted
  to timestamptz. Daily buckets use `occurred_at AT TIME ZONE
  reporting_timezone`.
- Date-only rows keep the noon-UTC convention (`T12:00:00Z`), which is
  the same calendar day in every US zone.

## Derived milestones (funnel implication)

### Rule

A later stage proves the earlier ones:

```text
conversation -> proposal -> submission -> funded
```

- Funded implies submission and proposal.
- Submission implies proposal.
- Proposal, submission, or funded implies a conversation.
- A conversation is a `show`, `live_transfer`, or `claimed`.

Measured (all time, per contact key):

| Gap | Count |
|-----|------:|
| Funded leads missing a proposal | 43 of 119 |
| Funded leads missing a submission | 70 of 119 |
| Submission without proposal | 26 |
| Proposal-or-later leads with no conversation | 324 of 700 |
| ...of those, an appointment exists | 9 (6 marked no_show or lo_bailed) |
| ...of those, never booked | 315 |

Some gaps close on their own once split identities are merged (phase 2).

### Storage: milestones on the lead, not invented events

Events stay facts. Implied stages live on the lead as a projection
that is recomputed from that lead's events:

| Column | Meaning |
|--------|---------|
| `conversation_at` | Date of the conversation |
| `conversation_source` | `show`, `live_transfer`, `claimed`, `implied_show`, `implied_claimed` |
| `proposal_at`, `submission_at`, `funded_at` | Earliest date for each stage |
| `proposal_implied`, `submission_implied` | True when no real event exists |

This is the "convo tag": one place that answers whether the client
spoke to this lead, how, and when.

Why not write the missing events:

- `show` drives payroll show pay, commissions, show rate, and Call
  Center billing. A guessed show would pay a setter and bill a client.
- Recomputing a projection is idempotent. A real proposal that arrives
  later replaces the implied one. Inserted guesses would need cleanup.
- The loan log's synthetic `claimed` / `proposal_made` rows are the
  existing example of guesses becoming permanent facts.

### Implied dates

Each missing stage trails the next stage by 15 days (decided 2026-10-03):

| Stage | Date when implied |
|-------|-------------------|
| Submission | Funded − 15 days |
| Proposal | Submission (real or implied) − 15 days, else funded − 15 days |
| Conversation, appointment held before the first stage | That appointment's `scheduled_at`, source `implied_show` |
| Conversation, no eligible appointment | First stage − 15 days, source `implied_claimed` |

- An implied date is never earlier than the lead's first activity that
  did not come from a client form, nor earlier than a real earlier
  stage. It is also never later than the next stage.
- Real events always win over implied ones.
- Loan-log fillers count as empty: `claimed` from `loan_log_form`,
  `proposal_made` from `loan_log_form` without `loan_size`, and
  `submission_made` from `loan_log_form` on the same timestamp as a
  loan-log funding. A `loan_deals` row created directly as funded
  (`submitted_at = funded_at`) gives no submission date.
- Real submission and funded dates also read `loan_deals.submitted_at`
  and `loan_deals.funded_at`.

### Recompute

`refresh_lead(lead_id)` computes the milestones along with the
first-touch ad. It runs from the `events` triggers (insert, delete, and
updates to type, dates, `external_id`, `lead_id`, ad fields, or `raw`)
and from a `loan_deals` trigger. `refresh_leads_batch(after_id, limit)`
rebuilds every lead.

### Which KPIs read what

| KPI | Source |
|-----|--------|
| Unique conversations, conversation rate, CPConv | Leads with `conversation_at` in range |
| Proposals, submissions, funded (unique) | Leads with the stage date in range |
| Show rate, shows, no-shows | Real `show` / `no_show` events only |
| Payroll show pay, commissions | Real events only |
| Call Center billable conversations | Real `show` / `live_transfer` only |

Lead profiles mark implied milestones so nobody reads them as logged.

### Decisions (2026-10-02)

- An appointment explicitly marked `no_show` or `lo_bailed` is never
  promoted to a show. If it is the only appointment, the conversation is
  `implied_claimed`. The no-show stays as recorded.
- Implied milestones are reporting only. Pay and billing count only
  what the team actually logged (show, live transfer, claimed).

## Call center safety

Every call center consumer keeps reading real events with its current
rules. This design adds a column and a projection; it does not change
what those surfaces count.

| Surface | Code | Change |
|---------|------|--------|
| Payroll show pay, show-once | `payroll-report-builder.ts`, `payroll-show-once.ts` | None. Real `show` events. |
| Commissions, rep credits | `agent-commissions.ts`, `agent-call-rep-credits.ts` | None |
| Credit queue | `api/credit-queue` | None. Trigger only adds `lead_id`. |
| Agent stats, appointment stats | `agent-event-fetch.ts`, `agent-appointment-stats.ts` | None |
| Dials, pickups, conversations (2 min+), speed to lead | `metrics.ts`, `speed-to-lead.ts`, `dial-analytics.ts` | None. Dials get `lead_id` only. |
| Call Center billable conversations | `metrics.ts` | None. Real `live_transfer` ∪ `show`. |

Rules that protect it:

- The `events` trigger only fills `lead_id` and refreshes the lead
  projection. It never changes `event_type`, `agent_name`,
  `occurred_at`, or any pay field, and never inserts or deletes events.
- Merging leads re-points `lead_id` only. Agent credit and appointment
  links (`external_id`, `appointment_event_id`) are untouched.
- The reporting-day change applies to client KPIs and ad reports.
  Payroll and agent stats move to one team zone (`CALL_CENTER_TIMEZONE`)
  in a separate, announced change. Closed or paid payroll runs are
  frozen and never recomputed.
- Dual-read (phase 4) also compares payroll totals, credit queue counts,
  and agent stats per agent. Any difference blocks cut-over.

## Reads

- `lead_events` view: `events` joined to `leads`, exposing
  `lead_utm_content`, `lead_ad_name`, `lead_source`, `lead_created_at`.
  Ad performance groups by the lead columns. `buildContactAdMap` is
  removed.
- Lead profile: `leads` row, then `events` and `loan_deals` by
  `lead_id`. The date filter selects which events are in range; the
  lead and its facts always load.
- KPI counts are unchanged in meaning. They keep counting event rows by
  `occurred_at`. Unique-lead counts switch from string keys to
  `count(distinct lead_id)`.
- Total Leads keeps counting `lead` events. Dial-only and inferred
  leads exist in `leads` but do not inflate the Leads KPI.

## Rollout

Each phase ships alone and can be reverted alone.

### Status (2026-10-02)

Phases 1–3 are live in production (`add_lead_entity.sql`,
`add_lead_entity_indexes.sql`, applied by `scripts/apply-lead-entity.mjs`).
Dashboard KPI counts and trend conversations read lead milestone dates
(`use_lead_milestones_in_kpis.sql`, applied 2026-10-06). Billable
conversations, show rate, dials, and payroll stay on real events. Ad
performance and the lead explorer read `lead_id` and the lead's
first-touch ad in application code.

| Check | Result |
|-------|--------|
| Events linked | 133,595 of 133,595 |
| Loan deals linked | 200 of 200 |
| Leads created | 46,306 (44,318 with a lead event) |
| Pre-existing rows changed, excluding `lead_id` | 0 (per-row md5 against `lead_backfill_snapshot_20261002`) |
| `ldr:` leads joined to their GHL contact | 665 |
| Funded events with no lead event | 59 → 35 |
| Proposal events with no lead event | 328 → 180 |
| Open identity reviews (shared phone / email) | 77 |

Phase 3b milestones are live (`add_lead_milestones.sql`, applied by
`scripts/apply-lead-milestones.mjs`, tested by
`scripts/test-lead-milestones.mjs`). Pre-existing events and loan_deals
rows changed: 0 (per-row md5 against `lead_milestone_snapshot_20261003`).

| Milestone (2026-10-03) | Leads | Implied |
|------------------------|------:|--------:|
| Funded | 113 | — |
| Submission | 187 | 44 |
| Proposal | 670 | 52 |
| Conversation | 5,035 | 149 (11 `implied_show`, 138 `implied_claimed`) |

Every proposal-or-later lead has a conversation, and no implied date
falls after its next stage. `clients.reporting_timezone` is not added.

As built, versus the schema section above: intake columns and flag
columns are not added yet (phase 5). Until then, intake is read from
`events.raw` by `src/lib/lead-intake.ts` (shared: loan amount, property
value, LTV, state; RM: B1/B2 age; DSCR: credit score range, property
use, chosen by `clients.reporting_type`). These are the first typed
column candidates when phase 5 starts.
First-touch ad is recomputed by `refresh_lead` from the lead's events:
the earliest `lead` event with an ad wins, else the earliest event with
an ad. Integrity check: `node scripts/assert-lead-integrity.mjs`.

| Phase | Change | Exit check |
|-------|--------|-----------|
| 1. Add | Tables, nullable `lead_id`, indexes, `resolve_lead`. No trigger, no readers. | Migration applies twice cleanly. |
| 2. Backfill | Batched by client: create leads from identifiers, earliest event first; attach events and loan_deals; record phone attaches; queue ambiguous phones. Re-runnable. | Every event has `lead_id`. Ambiguous queue reviewed. |
| 3. Enforce writes | Enable triggers. | Nightly check: zero events with null `lead_id`. |
| 3b. Milestones and reporting day | Add milestone columns and `refresh_lead_milestones`; add `clients.reporting_timezone`. Backfill both. | Every proposal-or-later lead has `conversation_at`. |
| 4. Dual read | Reports compute both ways for a week and log differences. | KPI totals unchanged. Unique-lead and ad counts differ only where a split person was joined. |
| 5. Cut over | Reports read `lead_id` and the lead's ad. Remove `buildContactAdMap`, `leadIdentityKey`, and duplicated key logic. | Old code paths deleted. |
| 6. Tighten | `events.lead_id` NOT NULL. Drop `lead_event_id`. Stop writing `ldr:` into `ghl_contact_id`. Stop loan-log synthetic `claimed` / `proposal_made` rows. | Constraint validated. |

## Data quality checks

Add `scripts/assert-lead-integrity.mjs`, in the style of
`assert-ad-utm-consistency.mjs`. Exit 1 when:

- any event or loan_deal has null `lead_id` after phase 3
- a lead has more than one primary GHL identity
- a lead points `merged_into_id` at a merged lead (chain)
- a lead's first-touch ad changed since the last run

## Non-goals

- Changing KPI formulas or date semantics
- Cross-client identity (one person on two clients stays two leads)
- Multi-touch attribution
- Moving acquisition tables (they already follow this shape with
  `acquisition_leads`)

## Tests

- `resolve_lead`: GHL hit, phone attach without GHL, phone with two
  leads goes to review, two real GHL ids on one phone stay separate,
  concurrent inserts for one new contact yield one lead.
- Trigger: every current event type and a new test type get `lead_id`.
- First touch: a later event with a different ad does not change the
  lead.
- Merge: children move, identities move, audit row written, old id
  resolves.
- Reports: a funding in range on a lead created before the range shows
  the lead's ad and intake.
