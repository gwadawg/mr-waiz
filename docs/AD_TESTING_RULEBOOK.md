# Ad Testing Rulebook (graduation rules)

How a new Meta ad earns budget. Small-budget structure from ADVYT
(creative test first, one variable at a time), adapted to mortgage lead
gen. KPI formulas live in [`KPIS.md`](KPIS.md). The scorecard and
"thin" rule live in `.cursor/skills/ad-performance-learnings/SKILL.md`.

## Why the gates use different metrics

Each gate reads the cheapest metric that has enough events to trust at
that spend. A rare event read too early is noise.

Our accounts run at a $100–150 CPM on a $150/day minimum. 1,000
impressions is already $100–150 of spend per ad, roughly 2× a typical
target CPL, so one or two leads are expected at the floor. A higher CPM
buys more spend, not a bigger sample: 1,000 impressions is still 10–20
link clicks and 0–4 leads. Three qualified leads at the floor has a 95%
range of roughly 1–9, so CPQL on it sits anywhere between $15 and
$200. Leads at the floor can stop a kill; they cannot earn a promotion.
CPM and hook rate have hundreds of events behind them by then and are
the only numbers that are actually stable at 1,000.

| Gate | Unit of evidence | Rank on | Veto / tiebreak | Never decides here |
|------|------------------|---------|-----------------|--------------------|
| 1. Attention | 1,000 impressions per ad (one extension to 2,000) | Link CTR vs the DSCR bars (kill 1.5 / promote 2.0 / good 2.2) and the account baseline | CPM $90–$190; hook rate tiebreak; a qualified lead vetoes a kill | CPQL, hot, CPC |
| 2. Lead quality | 10 matured leads per ad | CPQL ($65, or $80 on the hot exception) | Qualified rate: 70% to pass, under 60% kills | Funded |
| 3. Growth | $500 spend and 2+ conversations | Cost per conversation | Hand-raise % | Funded |
| Confirm | Cohort 60+ days old | Proposal / submission / funded | — | Killing a test |

Qualified and hot are automated from the lead form at ingest. They
filter the obviously wrong person; they are not underwriting. A credit
pull can sink a hot lead. A normal lead can fund. The tags grade Gate 2
(and the 2,000-impression rescue in Gate 1); conversations still decide
growth.

## Gate 1: Creative Test (attention)

Structure: one Testing campaign, ad set budgets, broad. Level 1 is a
single ad set with the batch in it. Level 2 is a second ad set in that
same campaign with its own daily budget and one graduated ad. Same
landing page and offer for every ad in the batch. Campaign budget
optimization is off: it would hand the money to the level 2 ad set
once that ad set has leads, and the creative test would starve.
Turning a level 1 ad off only pushes spend to the other ads in that
ad set, which is why the batch shares one budget. Growth is a separate
campaign, so test spend stays out of the cost-per-conversation average.

Batch size comes from the budget, not ambition:

```text
days to finish = ads × 1,000 × CPM ÷ 1,000 ÷ daily testing budget
```

That formula assumes even delivery. Meta will not deliver evenly: one
ad takes most of the spend until it is turned off. Seven days is the
planning estimate, not a cutoff. At a $125 CPM: $50/day testing = 3 ads,
$75/day = 4, $100/day = 5. Fewer ads at the full floor beats more ads
at half the floor. Each extension adds about one more CPM of spend.

Before the batch starts, write the **account baseline link CTR**
(trailing 30 days, all ads) into the campaign name. Ads Manager has no
column for it and the buyer should not be pulling a second date range
at verdict time. A new account with no history uses the median link CTR
of its first batch as the baseline.

The bars themselves come from DSCR account history, not from the batch.
Seven accounts, $41,452 spend, about 337,000 impressions (Oct 15, 2026):
blended link CTR **1.90%**, CPC **$6.49**, CPM **$123**. That 1.90%
includes the bad ads, so it is the mix, not the promote bar. Landing-page
accounts without instant forms sit near 2.0%. The two strongest accounts
sit at 2.19% and 2.22%, and those numbers include their losers too.
The buyer-facing version of Stage 1 and Stage 2 is [`CREATIVE_TESTING.md`](CREATIVE_TESTING.md).

Turn-off rules:

1. Turn each ad off at 1,000 impressions and give it a verdict, so Meta
   has to spend on the rest of the batch. Ads Manager cannot cap by
   impressions, so use an automated rule (impressions ≥ 1,000 → turn
   off, checked hourly) and accept 100–300 of overshoot.
2. An ad under 1,000 stays on, however many days that takes. Not
   hitting the floor is a delivery queue, not a verdict: the ads that
   already reached 1,000 are off, so the budget moves to the ones still
   short. Every ad in the batch is judged at 1,000.
3. The one delivery kill: the ad is the last one still on, the rest of
   the batch is already off, and it still will not spend. Nothing is
   left to turn off to force budget onto it. Off, and it does not
   re-enter the next batch.
4. An ad with strong leads before the floor stays on until the floor.
   It is not promoted early.
5. An extended ad is turned off at 2,000 for a final verdict. No third
   run. While it is extended it is still spending, so the untested ads
   wait behind it. That wait is expected.

Verdict at the floor. Rank on **link CTR** (link clicks ÷ impressions),
not CTR (all). Sergio reads CTR (all) first and link CTR second, because
in ecommerce the first job is stopping the scroll. We invert that. CTR
(all) also counts reactions, comments, shares, "see more," and profile
taps, and a reverse-mortgage comment section inflates it without sending
anyone to the form. The only click that can become a lead is the link
click. Graduation is against the
account baseline, not the batch, so a batch of three weak ads promotes
none and a batch of three strong ads can promote all three. Check the
rows in order; the first match is the verdict. **No row at 1,000
promotes on leads.** The qualified tag is written at ingest, so the
count is current; the count is just too small to grade on.

| Order | Verdict | Condition |
|-------|---------|-----------|
| 1 | Extend to 2,000 | Best link CTR in the batch, and that CTR is ≥ 2.0%, **and** zero leads |
| 2 | Extend to 2,000 (lead veto) | Does not clear row 3, but has 1+ qualified lead |
| 3 | Graduate | Link CTR ≥ 2.0% **and** ≥ account baseline, CPM $90–$190 |
| 4 | Extend to 2,000 | Link CTR 1.5–2.0%, or ≥ 2.0% but under the account baseline, or CPM under $90 |
| 5 | Kill | Link CTR under 1.5%, or CPM over $190 |

At 2,000 (final, no third run):

| Order | Verdict | Condition |
|-------|---------|-----------|
| 1 | Graduate | Link CTR ≥ 2.0% **and** ≥ account baseline, CPM $90–$190 |
| 2 | Graduate (lead rescue) | 5+ qualified leads at CPQL ≤ $65, regardless of CTR or CPM |
| 3 | Kill | Everything left |

Notes:

- Link CTR bands: **under 1.5% kill**, **1.5–2.0% extend** (around or
  below the mix, which includes bad ads), **2.0%+ graduate** if it also
  clears the account baseline, **2.2%+ promoted first**. At 1,000
  impressions the gap from 1.5% to 2.0% is about 5 clicks, which is why
  that band is neither a kill nor a promotion.
- Row 1 at the floor is a page check, not a creative verdict. With a
  true $50 CPL, $125 of spend produces zero leads about 8% of the
  time, so zero on the best-clicking ad is suspicious, not damning.
  If it is still zero at 2,000 and the rest of the batch looks the
  same, the page is the leak (see below). A batch whose link CTR is
  ≥ 2.0% and whose click-to-lead is under 6% is the same leak.
- Row 2 at the floor exists because a kill is the one irreversible
  verdict and a qualified lead is weak evidence against it. A lead buys
  one more look, nothing more. It never buys a promotion.
- CPM over $190 is the testing cap from the same accounts (watch band
  runs to $180, testing may touch $190). Under $90 is cheap inventory,
  not a good creative: extend once and check placements. Do not
  graduate it.
- CPC is not a row. Blended CPC is $6.49; above $10 is their pause
  line. CPC is CPM ÷ link CTR, so the link CTR and CPM rows already
  cover it.
- An account whose own trailing link CTR is under 1.5% (instant forms
  ran 1.11% on $7,142) does not use the 1.5% kill. Grade it against
  its own baseline until it runs landing pages. The kill / promote / good
  bars (1.5 / 2.0 / 2.2) are the landing-page standard. The promote bar
  is 2.0%, not the 1.90% all-in blend.
- The 2,000 lead rescue needs 5 qualified, not 3. At $250 of spend that
  is half of Gate 2's evidence and the low end of its range is finally
  above zero. It is the only place in Gate 1 where CPQL decides.
- There is no looser CPL or CPQL for Gate 1. A looser price bar lets
  more noise through; it adds no information. Small samples get a
  smaller verdict (extend), not a cheaper threshold.
- Hook rate (3-second plays ÷ impressions, video only) has hundreds of
  events at the floor and is more stable than link CTR. Use it as the
  tiebreak when more than 3 ads graduate and when diagnosing: high hook
  rate with low link CTR means the hook works and the offer or CTA does
  not.
- Promote at most 3 ads, best link CTR first. If nothing graduates,
  promote none and build the next batch from what the best ad did
  right.
- If every ad in the batch has a healthy link CTR and almost no leads,
  the page is the leak. Stop, fix the page, re-run the same batch.
- The audience confound (state, placement, day) is real and cannot be
  diagnosed at the floor: every breakdown is a 20-impression cell. That
  is the reason leads do not decide here, not a reason to read the
  breakdowns anyway.

Read on the side: CTR (all) far above link CTR means the hook stops the
scroll but the offer or CTA does not earn the click.

Open assumption to verify before trusting this gate: that link CTR
predicts cost per conversation for this product. Older reverse-mortgage
audiences produce curiosity clicks. On the first account with enough
history, compare link CTR against cost per conversation for every ad
with $500+ spend. If the top-CTR third did not produce cheaper
conversations than the bottom third, rank Gate 1 on hook rate instead.

Gate 1 never says no on lead quality, and at 1,000 impressions it never
says yes on it either. Gate 2 does both. Ads never go from Gate 1
straight into growth.

## Gate 2: Lead quality

Buyer sheet: [`CREATIVE_TESTING.md`](CREATIVE_TESTING.md). Stage 1 and Stage 2 are locked there.

Structure: one Gate 1 winner at a time, in the level 2 ad set of the
Testing campaign. Its own daily budget, so it does not spend the level 1
ad set's money. Same page, same offer, same states. About $70/day.
The next graduate waits.

Turn-off, checked daily. Under $200: leave it on. From $200: off at
0 or 1 lead. Otherwise off at $500 or 10 leads, whichever comes first.
The qualified tag is written at ingest, so the grade is ready the
moment the ad stops.

Two cost standards. Across large spend on winners, about $50 a lead is
the general standard. Testing is higher. Do not grade a test against
$50. In testing, CPL up to $65 is on track. From $65 to $85 the ad
passes only on the hot exception. Over $85 kills, whatever the
qualified rate.

Before the first ad: a $65 CPQL only passes if CPL comes in under
$65 × the account's qualified rate. The $80 exception needs CPL under
$80 × that rate. If the account's recent CPL is already above the $65
path, move the target first. This gate does not start when the trailing
qualified rate is under 60%.

Check the rows in order. The first match is the verdict. Same rows as
the buyer sheet.

| Order | Verdict | Condition |
|-------|---------|-----------|
| 1 | Pass to growth | CPQL ≤ $65 and qualified rate ≥ 70%, including when link CTR has fallen under 1.5% |
| 2 | Pass to growth (hot exception) | CPQL ≤ $80, qualified rate ≥ 85%, and hot rate ≥ 30% |
| 3 | Keep the creative, stop the spend | Link CTR still ≥ 1.5%, and too few leads: 0–1 after $200, or fewer than 5 at $500 |
| 4 | Kill the concept | Qualified rate under 60%, or CPL over $85. A cheap unqualified lead is this row. |
| 5 | Keep the creative, stop the spend | Link CTR still ≥ 1.5%, qualified rate ≥ 70%, and CPL over $65 |
| 6 | Kill the concept | Everything else, including a 60–70% qualified rate, and link CTR under 1.5% that missed the cost |

A 70% qualified rate is the pass floor, not the target. Winners across
large spend run nearer 80%. Rows 3 and 5 shelf the concept for a
different page later. They do not open a page split. A low link CTR
only kills when the qualified lead missed the cost. When the cost
cleared, the ad is a filter and it passes, with a note that growth may
deliver it slowly. Hot rate grades only on row 2. It does not pass an
ad by itself.

## Gate 3: Growth (conversations)

Structure: passing ads join the growth campaign alongside the current
winners. Gates 1–2 keep running beside it for new batches. New creative
never goes straight into growth.

Evidence: $500 spend and 2+ conversations (show ∪ claimed ∪ live
transfer). Below that the ad is "thin" and the scorecard ignores it.

Rules:

1. **Keep:** cost per conversation no worse than 1.2× the growth
   campaign's current average.
2. **Cut:** worse than 1.5× the average once it reaches $1,000 spend.
3. Between 1.2× and 1.5×: keep running and recheck at $1,000.
4. Conversations from leads nobody tagged qualified count toward the ad.
5. If cost per conversation rises and link CTR holds, check landing,
   speed-to-lead, setters, and the one account before calling the ad
   tired.

## Confirm (slow outcome)

After a cohort is 60+ days old, compare proposal, submission, and funded
rates by ad. Use this to set the target CPL and the allowed cost per
conversation for the next quarter. It never kills a running test.

If every ad dies at the credit pull at a similar rate, the constraint is
underwriting, not creative. If one ad's leads die there far more often,
that ad's message attracts people who look good on a form and fail on a
pull. Rewrite or retire it.

## States are an account test, not an ad test

Every ad in a batch shares the same states, so the creative test is
fair. Never judge an ad by state; per-ad, per-state counts are too thin.

Read state quality at the account level: Qual % and cost per
conversation by lead state, all ads, 60–90 days, from the dashboard
(the qualified tag lives in the pipeline, not Ads Manager). If a few
states are consistently worse, exclude them at the ad set level for
every campaign. One account fix, not a graduation rule.

## Budget moves

- Raise growth spend in small steps (about +$20/day). Each step funds one
  new variable: an audience or a fresh test batch.
- Do not push a single strong week into a large budget jump.
- An ad that lost a gate does not return to growth or retargeting.
  Retargeting uses ads that already passed Gate 3.

## Inputs to set per account before the first test

- Target CPL (from allowed cost per conversation and lead → conversation
  rate)
- Trailing 30-day Qual % and hot %
- Current CPM (sets batch size)
- Daily testing budget, kept separate from the growth budget
