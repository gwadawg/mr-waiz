---
name: backfill-client-data
description: >-
  Backfill missing client KPI data from a CSV into Mr. Waiz without
  duplicating leads or Meta spend. Use when the user asks to backfill, fill
  gaps, or load a lead list or Meta ads export for a client whose data is
  already partly in the dashboard.
---

# Backfill-Client-data

The CSV overlaps data already in Mr. Waiz. Find the gaps. Write only what
this run asked for. Leave everything else stored.

Ask only to protect stored data. If the user already said what to fill,
do that. Show the summary and wait for an explicit yes. Ask when a write
would change a value they did not mention, when one row matches two
different people, or when the client or the file is unclear.

Do not use `scripts/import-historical-events.mjs`. It inserts every row.
Do not use `scripts/import-meta-insights-csv.mjs`. It deletes the client's
whole date range and writes the file back.

## Run

1. Take the client name, the CSV path, and what to fill from the user.
2. Resolve the client. Compare the file. Write nothing.
3. Show one example and the counts below. Stop until the user says yes.
4. Write only the approved gaps for this client.

## Client

Look up `clients.name` with the name the user gave. Trim it. One match
is the client. Zero matches, or more than one, is a stop. Show the closest
roster names and ask. Do not start the comparison.

## Which file

Handle only these two. Any other CSV, including appointments, shows, live
transfers, claimed, dials, or pipeline, is named and left unwritten.

| File | How to recognize it |
|------|---------------------|
| Meta ads export | A day column (`Reporting starts`, `Day`, or `Date`) and `Amount spent` |
| Lead list | Phone, email, or a Lead ID, and no spend column |

A file that looks like both is a stop. Ask which one it is.

## Lead list

Client KPIs count `events` rows with `event_type = 'lead'`. A second lead
event for someone already stored doubles Total Leads. Update the existing
lead event. Insert a lead event only when nobody matches.

Match in this order. One hit is the same person.

1. Phone. Digits only, last 10. A leading `1` on 11 digits is dropped.
2. Email. Trimmed and lowercased.
3. Lead ID. `ghl_contact_id` on the lead event. Often absent from the file.

Phone, email, and Lead ID pointing at two different people is a stop for
that row. Show it in the example. Do not write it.

A row with no phone, no email, and no Lead ID is unmatched. Do not insert
it. Do not match on name.

Which fields change comes from the user's instructions for this run.
Common ones are `is_qualified`, `is_hot`, and `is_out_of_state`. If they
did not say what to fill, ask before changing stored values.

Several stored lead events already share one phone, email, or Lead ID.
Ask before choosing one to update. Do not add another.

Inserts and updates go to `events`. Database triggers maintain the lead
record. Do not write the `leads` table by hand.

A lead that is only in Mr. Waiz stays. The file is not a full roster.

## Meta ads export

The number that matters is the total spent on each start date. Use the
row's start date (`Reporting starts`, else `Day` or `Date`). Sum
`Amount spent` for that date. Ignore the timezone slip against the 4am
Make pull. Do not match a neighboring day. Do not pause because a hole
before the file is wide.

`daily_meta_spend` is the sum of `meta_ad_insights.spend` for that
`client_id` and `insight_date`. A sentinel row counts in that sum too.
Adding the file on top of rows already stored for that date double-counts
the day.

After the user says yes, for each start date in the file, make that
client's stored sum for that date equal the file's sum. Replace rows for
that client and that date only.

- The file has Account ID, Campaign ID, Ad set ID, and Ad ID. Replace
  that date with those ad rows.
- The file has no ad IDs. Replace that date with one daily total.
  `account_id` comes from an existing row for that client, or `legacy`
  if the client has none. Set `campaign_id`, `adset_id`, and `ad_id` to
  `_imported_daily_total`. Set `spend` to the file's sum for that date.

Every date absent from the file stays, including dates that already have
spend. Do not clear a boundary day.

If the user said to add only dates that have no spend yet, skip dates
that already have a total. The summary still shows those dates in
Already stored.

## Summary

Show this before any write. One example, then the counts. Do not list
every row.

```text
Client: <roster name>
File: lead list | Meta ads
Already stored: N
Missing: N
Disagree: N
Unmatched: N

Example:
<one lead or one date>
File: <value>
Stored: <value>
```

Already stored means a match that this run will leave alone. Missing
means a lead or a start date to add. Disagree means a matched lead field
or a start-date total that would change. Unmatched means a row that
cannot be tied to one person, or a spend row with no start date.

The example is one real disagreement when any exist. Otherwise one
missing row. Then say where the rest sit: which fields or dates, and how
many. Wait for yes.

## After the write

Re-read the dates or leads that were approved. Confirm the stored lead
was updated rather than duplicated, or that the day's spend sum equals
the file's sum for that start date. Report those checked figures.
Dates and leads outside the approval are unchanged.
