# Creative testing (Stage 1 and Stage 2)

Locked. Both stages run in one Testing campaign with ad set budgets.
Stage 1 is one ad set, and the batch shares its budget. Stage 2 is a
second ad set with its own budget and one graduated ad. Campaign budget
optimization stays off. Growth is a separate campaign.

Stage 1 asks whether the right person clicked. Stage 2 asks whether
those clicks became qualified leads. Testing allows a higher cost per
lead than the general standard. Growth, judged on cost per
conversation, is in [`AD_TESTING_RULEBOOK.md`](AD_TESTING_RULEBOOK.md).

## Stage 1 — the click

Grade an ad at 1,000 impressions. Not before, and not on a calendar.
Turn it off at the floor so the budget moves to the ads still short.
An ad under 1,000 is waiting. The only delivery kill is the last ad
still on, with the rest of the batch already off, that still will not
spend.

Rank on link CTR (link clicks ÷ impressions). CTR (all) counts
reactions, comments, and "see more," so it does not grade. Write the
account's trailing 30-day link CTR in the campaign name before the
batch starts. A new account uses the median of its first batch.

The promote bar is 2.0% link CTR. That is the landing-page mix with
instant forms left out. The all-in blend of 1.90% includes bad ads, so
matching it does not promote. 2.2% or higher is promoted first. Under
1.5% is a kill on a landing page. An account already under 1.5%
(instant forms) is graded on its own baseline.

CPM for a pass is $90–$190. Under $90 is cheap inventory. Over $190 is
a kill. CPC is not its own row.

### At 1,000 impressions

First row that matches wins. A lead never promotes here.

| Order | Verdict | Link CTR | CPM | Leads |
|-------|---------|----------|-----|-------|
| 1 | Extend to 2,000 | Best in the batch, and ≥ 2.0% | — | Zero. Page check. |
| 2 | Extend to 2,000 | Anything that fails row 3 | — | 1+ qualified. Stops a kill. Does not promote. |
| 3 | **Graduate to Stage 2** | ≥ 2.0%, and ≥ this account's baseline. 2.2%+ goes first. | $90–$190 | Ignored |
| 4 | Extend to 2,000 | 1.5–2.0%, or ≥ 2.0% but under this account's baseline | or under $90 | Ignored |
| 5 | **Kill** | Under 1.5% | or over $190 | None |

Promote at most 3 ads. If nothing hits row 3, promote none.

### At 2,000 impressions

One extension, then this is final.

| Order | Verdict | Condition |
|-------|---------|-----------|
| 1 | Graduate to Stage 2 | Same bar as row 3 above |
| 2 | Graduate to Stage 2 | 5+ qualified leads at a cost per qualified lead ≤ $65 |
| 3 | Kill | Anything else |

If most ads are at 2.0% link CTR or better and the batch click-to-lead
is under 6%, stop and fix the page before Stage 2.

## Stage 2 — the qualified lead

Locked. One graduate at a time, about $70 a day, same page, same offer,
same states. The next graduate waits.

Two cost standards. Across large spend on winners, about $50 a lead is
the general standard. Testing is higher: the sample is small, and the
ad has no delivery history. Do not grade a test against $50.

In testing, cost per lead up to $65 is on track. From $65 to $85 the
ad can still pass, but only on the quality exception below. Over $85
is a kill, whatever the qualified rate. Cost per qualified lead passes
at $65. It passes at $80 only when the qualified rate is at least 85%
and the hot rate is at least 30%. A qualified rate under 70% does not
pass. Under 60% kills the concept, even when the lead was cheap.

Before the first dollar, write down the trailing qualified rate and the
recent cost per lead. A $65 cost per qualified lead needs the cost per
lead under **$65 × qualified rate**. The $80 exception needs it under
**$80 × qualified rate**. If the account is already more expensive than
the $65 path, change the target first. If the trailing qualified rate
is under 60%, Stage 2 does not start. An ad cannot be graded on a 70%
floor in an account already under the kill line.

### When to turn it off

Check once a day. Do not grade an ad while it is still on.

| Spend | Leads | Action |
|-------|-------|--------|
| Under $200 | Any number | Leave it on. One expensive lead is not a cost. |
| $200 or more | 0 or 1 | Turn it off now. |
| Any spend | 10 | Turn it off. |
| $500 | Fewer than 10 | Turn it off. This is the ceiling. |
| $200 to $500 | 2 to 9 | Leave it on. It is still close. |

### The grade

Use this only after the ad is off. First row that matches wins.
Grade on cost per qualified lead, not on raw cost per lead.

| Order | What you see | Verdict |
|-------|--------------|---------|
| 1 | Cost per qualified lead is $65 or under, and the qualified rate is 70% or higher | **Pass** to growth. A link CTR under 1.5% still passes. Note that it may spend slowly. |
| 2 | Cost per qualified lead is $80 or under, the qualified rate is 85% or higher, and the hot rate is 30% or higher | **Pass** to growth. The only row where a hotter lead buys a higher cost. |
| 3 | Link CTR is still 1.5% or higher, and there are too few leads (0–1 after $200, or fewer than 5 at $500) | **Keep the creative. Stop.** The page missed the click. |
| 4 | Qualified rate is under 60%, or cost per lead is over $85 | **Kill the concept.** A cheap lead that is not qualified is this row. |
| 5 | Link CTR is still 1.5% or higher, the qualified rate is 70% or higher, and cost per lead is over $65 | **Keep the creative. Stop.** The page made the lead expensive. |
| 6 | Anything else | **Kill the concept.** A qualified rate of 60–70% is this row. A link CTR under 1.5% that missed the cost is this row. |

A qualified rate of 70% is the pass floor, not the target. Winners
across large spend run nearer 80%. Hot rate grades only on row 2.
It does not pass an ad by itself.

Rows 3 and 5 shelf the concept. They do not open a second page. A
different page is a later test, one creative, a page that already
exists. Changing the conversion event the ad set bids for waits until
growth, and only when that ad set can produce about 50 of the new event
per week.
