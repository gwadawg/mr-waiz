---
name: dscr-testing-level1
description: >-
  Grade a DSCR Meta Ads Manager report with the testing ruling card
  and say which ads to turn off, leave on, or pass to Growth. Use when
  the user uploads or points at a Meta CSV and asks which DSCR test
  ads to close, kill, cut, graduate, or promote, or mentions
  DSCR-Testing-Level1, the ruling card, the 1,000-impression floor,
  or the 1.5% kill line.
---

# DSCR-Testing-Level1

Decide the DSCR testing verdicts from a Meta export. The whole test
is one ruling card per ad: a click kill at 1,000 impressions, then
spend stops graded on qualified leads. There is no extension, no CPM
row, no promote bar, and no baseline comparison at verdict time.

"Close" an ad means turn it off. It does not mean a funded loan. This
skill does not grade the Growth campaign (cost per conversation).

The buyer sheet is `docs/CREATIVE_TESTING.md` (the ruling card). Gate
logic and the why is `docs/AD_TESTING_RULEBOOK.md`. The script
encodes the card. Do not re-derive the bars, and do not override the
script because a number feels close.

## The card the script applies

First match wins, per ad:

| # | The row shows | Ruling |
|---|---------------|--------|
| 1 | Under 1,000 impressions | Waiting. No action. |
| 2 | Link CTR under 1.5% | Turn it off. No lead veto. |
| 3 | Spend under $200 | Leave it on. Buying its lead sample. |
| 4 | $200+ spend, 0–1 leads | Turn it off. CTR still 1.5%+ shelves the creative (page missed, not the ad). |
| 5 | 10 leads or $500 spend, and 2+ leads | Off and grade. CPQL ≤ $65 and qualified rate ≥ 70% passes to Growth. A link CTR that has since drifted under 1.5% does not block that pass. Anything else is off for good. If the qualified rate held at 70%+ and link CTR held at 1.5%+ but the cost missed, shelf the creative: the page made the lead expensive. A qualified rate under 70% kills the concept. |

$200–$500 with 2–9 leads matches no row: leave it on. $500 with 0–1
leads is row 4, not a grade: there is nothing to grade.

A pass is a duplicate into Growth, published before the testing copy
is turned off. An account whose trailing link CTR is under 1.5% is an
instant-form account: row 2 is skipped, the spend rows still apply.

One delivery rule the export cannot see: if an ad is the last one
still on in its batch and it will not spend, turn it off. It does not
re-enter the next batch. Nothing is left to turn off to force budget
onto it.

## When to use

- A downloaded Meta report, and which DSCR test ads to close or pass
- "Grade this batch" / "DSCR-Testing-Level1" / "run the card"

Mature ads ("what's working", CPCONV, fatigue) use
`ad-performance-learnings` instead. An ad past about $750 of spend is
flagged as probably not a testing ad; do not turn it off from this
sheet.

## Step 1 — Run the grader

The user points at the CSV. Pass the raw export. Do not total the
days yourself and do not grade from CTR (all).

```bash
npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts \
  --file path/to/report.csv
```

Qualified leads are not in Ads Manager. Rows 1–4 grade without them;
row 5 needs them. If the user has them, pass a second CSV with
`ad id` or `ad name` and `qualified`:

```bash
npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts \
  --file report.csv --qualified qualified.csv
```

The baseline in the campaign name (`baseline 2.10%`) is only used to
detect instant-form accounts (under 1.5%). `--baseline` overrides it.

If the script throws, stop. Do not grade by hand.

Link CTR is link clicks ÷ impressions, summed across days and
placements first. CTR (all) counts reactions, comments, shares, and
"see more," and is ignored.

## Step 2 — Say the verdicts

One ad set at a time. Use the script's `actions` and each ad's `why`.
Do not add a next-test idea. The sheet does not know the creative.

Lead with the lists, then the table.

```text
DSCR testing card — {campaign} / {ad set}

Pass to Growth (duplicate, publish, then turn off here)
1. {ad} — {why}

Turn off
- {ad} — {why}

Shelf the creative (off, kept for a later page test)
- {ad} — {why}

Leave on
- {ad} — {why}

Waiting (under 1,000 impressions)
- {ad} — {impressions} impressions

Needs the qualified count before the grade
- {ad} — {why}
```

Omit empty lists. If `page_leak` is true, lead with
`page_leak_reason`. The script has already held every ad that reached
1,000 impressions: do not pass or kill any of them on creative. Fix
the page, form, or pixel and re-run the same ads. If `instant_form`
is true, say the 1.5% kill line is the landing-page standard and was
skipped. If nothing passes, say so and name the best cost per
qualified lead. Do not guess what an ad did right.

When an ad is `needs_qualified` or `needs_leads`, ask for the
pipeline count in the same message. Still show the turn-offs that do
not need it.

## Do not

- Grade from CTR (all), CPC, CPM, or a single day's rate
- Apply the $50 general cost-per-lead standard, or any $80 hot
  exception — the pass is $65 CPQL at a 70% qualified rate, only
- Average the CTR column across days
- Treat Meta Results as qualified leads
- Extend an ad to 2,000 impressions for a second click look — the
  click kill happens once, everything after it is spend rows
- Let a link CTR that drifted under 1.5% block a pass. Row 2 does
  not override row 5
- Promote an ad on link CTR — a healthy click only keeps it spending
- Move or edit budgets, or add ads to a live ad set
- Cut an ad past $750 spend from this sheet
- Write a learning to Wm-os from this read

If the script and the buyer sheet ever disagree, the sheet wins.
Re-read `docs/CREATIVE_TESTING.md` and fix the script before giving
the buyer a verdict.
