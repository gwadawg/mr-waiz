---
name: dscr-testing-level1
description: >-
  Grade a DSCR Meta Ads Manager report with the Level 1 creative test
  and say which ads to turn off, leave on, or graduate. Use when the
  user uploads or points at a Meta CSV and asks which DSCR test ads to
  close, kill, cut, graduate, or promote, or mentions
  DSCR-Testing-Level1, Level 1 grading, the 1,000-impression gate, or
  link CTR bars.
---

# DSCR-Testing-Level1

Decide the DSCR Level 1 creative test from a Meta export. One question:
did the right person click, at a sane cost to reach them?

"Close" an ad means the **Kill** verdict: turn it off. It does not
mean a funded loan. This skill does not grade Stage 2 or growth.

The buyer sheet is `docs/CREATIVE_TESTING.md` (Stage 1). Gate logic is
`docs/AD_TESTING_RULEBOOK.md`. The script encodes those tables. Do not
re-derive the bars, and do not override the script because a number
feels close.

## What this gate does not use

The bars below are the DSCR landing-page mix. Cost here is CPM
($90–$190), not cost per lead.

About $50 a lead is the general standard across large spend on
winners. Testing allows a higher cost, and that cost is graded in
Stage 2, after this gate. Do not kill or graduate a Level 1 ad on
cost per lead, qualified rate, or hot rate.

The only cost-per-qualified-lead read in this gate is the rescue at
2,000 impressions: 5 or more qualified leads at $65 or under. The
Stage 2 pass does not apply on that sample. That pass is a qualified
rate of 70% or higher, an $80 cost per qualified lead only when the
qualified rate is at least 85% and the hot rate is at least 30%, and
a kill above $85 a lead or under a 60% qualified rate.

## When to use

- A downloaded Meta report, and which DSCR test ads to close or graduate
- "Grade this batch" / "DSCR-Testing-Level1" / "Level 1" /
  "who hit 1,000 impressions"

Mature ads ("what's working", CPCONV, fatigue) use
`ad-performance-learnings` instead. An ad past 2,500 impressions is
called out that way. Do not turn it off from this sheet.

## Step 1 — Run the grader

The user points at the CSV. Pass the raw export. Do not total the days
yourself and do not grade from CTR (all).

```bash
npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts \
  --file path/to/report.csv \
  --baseline 2.1
```

`--baseline` is the account's trailing 30-day link CTR, as a percent
(`2.1` or `2.10%`). Skip the flag when the campaign name contains
`baseline 2.10%`. A first batch on a new account uses `--new-account`
(the median link CTR of that batch). Otherwise leave it off. The
script will not graduate without a baseline. It will still kill on
link CTR under 1.5% and CPM over $190.

Qualified leads are not in Ads Manager. If the user has them, pass a
second CSV with `ad id` or `ad name` and `qualified`:

```bash
npx tsx .cursor/skills/dscr-testing-level1/scripts/grade-level-1.ts \
  --file report.csv --baseline 2.1 --qualified qualified.csv
```

If the script throws, stop. Do not grade by hand.

Link CTR is link clicks ÷ impressions, summed across days and
placements first. The CPM column and CTR (all) are ignored. CTR (all)
counts reactions, comments, shares, and "see more."

## Step 2 — Say the verdicts

One batch (campaign + ad set) at a time. Use the script's `actions`
and each ad's `why`. Do not add a next-test idea. The sheet does not
know the creative.

Lead with the lists, then the table.

```text
DSCR-Testing-Level1 — {campaign} / {ad set}
Baseline: {baseline_pct}% ({baseline_source})

Graduate
1. {ad} — {why}

Turn off
- {ad} — {why}
  {note, including the qualified confirm}

Leave on until 2,000
- {ad} — {why}

Waiting (under 1,000, not failing)
- {ad} — {impressions} impressions

Held (cleared the bar, already graduating 3)
- {ad}

Past this gate (do not turn off from Level 1)
- {ad} — {impressions} impressions. {would_have_been} on these totals.
```

Omit empty lists. If `page_leak` is true, lead with
`page_leak_reason` and do not list graduates or kills. If
`instant_form` is true, say the 1.5 / 2.0 / 2.2 bars are the
landing-page standard and this account is not graded on them. If
nothing graduates and the page is fine, say there is no winner and
name the best link CTR. Do not guess what that ad did right.

Ask for the trailing 30-day link CTR in the same message when any ad
is `needs_baseline`. Still show the kills and extends that do not
need it.

When `confirm_before_kill` is set, those ads are not a clean turn-off
yet. Say so in the Turn off list.

## Rules the script is applying

Judge at 1,000 impressions. One extension, then a final look at
2,000. Under 1,000 is waiting. Over 2,500 is no longer this gate.

At 1,000, first match wins:

| Order | Verdict | When |
|-------|---------|------|
| 1 | Extend | Best link CTR in the batch, at or above 2.0%, and zero leads |
| 2 | Extend | Would not graduate, but has 1+ qualified lead |
| 3 | Graduate | Link CTR at or above 2.0% and at or above the account baseline, CPM $90–$190 |
| 4 | Extend | Link CTR 1.5–2.0%, or at or above 2.0% but under the baseline, or CPM under $90 |
| 5 | Kill | Link CTR under 1.5%, or CPM over $190 |

At 2,000: graduate on that same bar, or graduate on 5+ qualified
leads at a cost per qualified lead of $65 or under. Everything else
is a kill. No third run. Do not use the Stage 2 $80 hot exception
here.

Promote at most 3, highest link CTR first. 2.2% or better ranks
first. A qualified lead never promotes at 1,000. It only stops a kill.

An account baseline under 1.5% is an instant form. Do not use these
bars.

If the script and the buyer sheet ever disagree, the sheet wins.
Re-read `docs/CREATIVE_TESTING.md` (Stage 1) and fix the script before giving
the buyer a verdict.

## Do not

- Grade from CTR (all), CPC, CPL, or a single day's rate
- Apply the $50 general cost-per-lead standard, or the Stage 2
  qualified-rate and hot-rate bars
- Average the CTR or CPM column across days
- Treat Meta Results as qualified leads
- Turn off an ad with a qualified lead while it is under 2,000
- Graduate more than 3 ads from one batch
- Cut an ad that is already past 2,500 impressions
- Write a learning to Wm-os from this read
