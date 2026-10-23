---
name: client-ad-diagnosis
description: >-
  Deep diagnosis of one long-running client's Meta ads on what their leads
  became downstream — weighted conversations, proposals, submissions, and
  fundings — not CPL or CPQL. Separates ad problems from landing, setter, and
  loan-officer problems, pools ads by angle, and gives each ad a verdict
  (Scale, Keep, Cut, Cheap but wrong person, Blocked downstream, Too thin).
  Use when the user asks to diagnose a client's ads, which ads or messages
  are actually producing proposals or fundings for a client, or why a client
  with cheap leads isn't closing.
---

# Client Ad Diagnosis

Read one client's ads the way a senior media buyer would: an ad is only
good if the people it brings in become conversations, proposals, and
fundings at a fair cost, on enough spend to believe it. Front-end cost
explains a result. It never decides one.

Cross-client "which messages work" is `ad-performance-learnings`. New
DSCR test ads are `dscr-testing-level1`. This skill is one client.

The media-buyer kit runs the same engine through
`GET /api/mb/ad-diagnosis` (no Supabase key). Logic lives in
`src/lib/client-ad-diagnosis.ts`.

## Step 1 — Run the script

```bash
npx tsx .cursor/skills/client-ad-diagnosis/scripts/client-ad-diagnosis.ts --client "<name or id>"
```

| Flag | Use |
|------|-----|
| `--start` / `--end` | Default: launch date → today |
| `--mature-days` | Default 60 (30 if live under 90 days) |
| `--qualify-switch YYYY-MM-DD --qualify-before yes\|no` | Only if the user says the "we qualify leads" setting changed |
| `--verbose` | Query timings. A large client takes about a minute |

If the name matches several clients it lists ids; rerun with the id. If
it throws, stop. Do not estimate by hand. Read the JSON path it prints.

How the numbers are built (do not re-derive):

- Leads are grouped by the date they came in and followed forward. Front
  end uses every lead; conversation stage uses leads 14+ days old;
  proposal / submission / funded use leads older than `backend_cutoff`.
  Spend is cut at the same dates.
- **Weighted conversation:** hot = 2, qualified = 1, unqualified = 0.
  When the client books every lead (`dial_pool: all`), junk conversations
  score zero instead of making an ad look cheap.
- Hand-raise and conversation rates divide by qualified leads when we
  only dial qualified (`dial_pool: qualified`), else by all leads.
- **`shrunk` / `rank_cost`:** cost after blending in $1,000 of spend at
  the client's own rate. A $300 ad is mostly the client average; a $5,000
  ad is mostly itself. Rank on this. Show raw cost beside it.
- `cost_range` and `*_ci` are 95% ranges. Quote them when counts are small.

## Step 2 — Data quality first

Read `data_quality` before any verdict. Say each of these out loud when
it applies:

- `leads_without_ad_pct` over 15%, or `unattributed_backend` holding a
  real share of proposals or fundings: rankings are partial.
- `spend_without_leads`: ads that spent with no leads attached are a
  naming mismatch (instant form, renamed ad), not a dead ad. List the
  biggest ones; do not call them Cut.
- `unsourced_spend`: ads missing from the library. Rank them on numbers,
  message unknown.
- `loan_volume` of 0 with fundings means loan sizes aren't logged. Skip
  volume claims.
- `leads_without_lead_event`: qualified/hot unknown for those leads.
- A pipeline stage at 0 for the whole account (e.g. proposals but zero
  submissions) almost always means that stage isn't logged for this
  client. Say so, and grade on the stage above it. It is not an LO
  failure until confirmed.

Also state `provisional`, the `dial_pool`, and ask once whether the
qualify setting ever changed (rerun with the switch flags if yes).

## Step 3 — Find who owns the leak

Use `stage_diagnosis` and `benchmark`. Each stage has an owner:

| Stage | Owner |
|-------|-------|
| CTR | ad |
| Opt-in (leads ÷ clicks) | landing page |
| Qualified / hot rate | ad — who it attracts |
| Hand-raise rate | setters |
| Show rate (graded) | setters and client — never ad quality |
| Conversation → proposal → submission → funded | client's loan officer |

Rules:

- `ads_differ: false` and the client is below the peer median → that
  owner's problem across the account. Do not blame or credit an ad for
  it. Good ads on that account get **Blocked downstream**, not Cut.
- `ads_differ: true` → the stage separates ads; use it in the verdicts
  (`best` / `worst` name them).
- `peer_median: null` means fewer than 3 same-product peers log that
  stage. Say "no benchmark".
- Speed-to-lead is not reliable right now. Do not use it.
- Healthy CTR with weak opt-in is the page. Healthy CTR and opt-in with
  rising cost per conversation is setters or the LO. Neither gets a new
  hook.

## Step 4 — Rank the ads

`rank_stage` is the deepest stage where at least two graded ads have
enough evidence: funded (2+ fundings) → submission → proposal →
conversation. Say which stage you ranked on. `ranking` is sorted by
`rank_cost`; `conversation_ranking` covers every graded ad.

Evidence tiers (in `evidence`):

- **thin** — under $500, or under 2 conversations. No verdict.
- **conversation** — graded on weighted conversations only.
  `early_signal: true` means it has proposals but not enough to grade.
- **backend** — $1,500+ on matured leads and 3+ proposals ($1,000 and
  2 when provisional).

## Step 5 — Media-buyer checks before any verdict

Run each check. Most misreads come from skipping one.

1. **Front vs back.** `front_vs_back_disagreements` lists ads whose CPL
   rank and downstream rank differ by 2+. Lead with these. They are the
   reason this skill exists.
2. **Retargeting is not cold traffic.** `funnel_stage` MOF / MOFU / BOF
   ads reach people who already engaged. Rank them against each other,
   not against TOF. A BOF ad at the top of the list is expected; judge
   it on whether it beats other retargeting ads. `null` = stage unknown;
   check the name and campaign.
3. **Meta picked the spend.** Low spend usually means Meta starved the
   ad, not that it was tested and lost. Call it untested, not a loser.
   A cheap result on small spend is regression bait: check `shrunk`
   against raw, and the `cost_range`.
4. **Timing.** Read `by_month`. An ad that only ran in a month when the
   whole account converted well (or badly) carries that month. Compare
   its months to the account's before crediting the ad. If a setter,
   LO, or page change landed mid-window, say which ads straddle it.
5. **Fatigue is spend-weighted, and usually the message.** An ad whose
   later months turn worse with CTR holding is an ops or LO shift; CTR
   falling with it is the creative wearing out. High spend with
   cost still at or below average is scaled, not dead.
6. **Scale capacity.** A great cost on 3% of spend says nothing about
   holding it at 30%. Note `spend_share` beside every Scale.
7. **Quality vs volume.** Cheap CPL with qualified or hot rate below the
   account's range, or a worse weighted-conversation cost, is the wrong
   person — no matter the CPL.
8. **One loan is not a pattern.** At 2–3 fundings, quote the cost range.
   Never Scale an ad on a single funded file.

## Step 6 — Angles

Use `angles.by_tag` (category: label) and `angles.by_format`. Pooling
lets a message earn a verdict when no single ad has enough. Then read
each graded ad's `summary` / `visual_notes` and name the one desire it
sells (independence, payment relief, trapped equity, proof). Concept
before hook before visual. Say which angle wins at the deepest stage it
can be graded on, which attracts the wrong person, and which is untested.
Unsourced ads: "message unknown".

## Step 7 — Verdicts

Compare against the account's own cost at `rank_stage` (from
`client_totals.paid`):

| Verdict | When |
|---------|------|
| **Scale** | Backend tier, `rank_cost` at or below the account, quality at or above the account, not resting on one funding, and spend share leaves room to grow |
| **Keep** | Graded, near the account cost, nothing wrong downstream |
| **Cut** | Graded, `rank_cost` clearly worse (about 1.5× the account or more) and the low end of its range is still worse than the account |
| **Cheap but wrong person** | Cheap CPL/CPQL but weak qualified/hot rate or weighted-conversation cost |
| **Blocked downstream** | Ad holds up through conversation, but an account-wide owner stage (Step 3) is losing the leads |
| **Too thin** | Thin tier — split into "untested (Meta starved it)" and "spent but too early" |

No budget dollar amounts. No client-to-client ad comparisons beyond the
peer benchmark.

## Output (chat only)

```markdown
## {Client} — ad diagnosis ({start} → {end}, back end on leads before {backend_cutoff})

**Bottom line:** 2–3 sentences. The real constraint, the best ad/angle at
the deepest stage graded, and the biggest misread the front end would
cause.

**Data caveats:** only the ones that apply.

**Where the account leaks**
| Stage | Client | Peers | Same on every ad? | Owner |

**Ads** (ranked on {rank_stage})
| Ad | Stage | Spend (share) | CPL / CPQL | Cost per weighted conv | Proposals / Funded | Ranked cost (range) | Verdict |

**Front end vs back end:** each disagreement in one line.

**Angles:** what's working, what attracts the wrong person, what's untested.

**Actions (3–5):** each with an owner — media buyer, landing page,
setters, or the client's loan officer — and the metric that proves it.

**Open questions:** e.g. qualify setting history, missing loan sizes,
unnamed spend.
```

Cite ads by `ad_name` with `supabase_ref` when sourced. Write numbers
from the JSON; do not round a range into a point.

## Do not

- Call an ad good on CPL, CPQL, or CTR alone
- Treat show rate as ad quality
- Use speed-to-lead
- Grade back-end stages on leads younger than `backend_cutoff`
- Scale on one funding, or Cut an ad Meta never spent on
- Compare MOF / BOF results against TOF
- Refresh creative for a page, setter, or LO problem
- Save files or write to Wm-os. Offer a cross-client lesson as a
  candidate for `ad-performance-learnings`, only if the user asks
