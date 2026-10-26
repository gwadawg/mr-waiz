# Media Buyer Brief API

**Purpose:** Let the media-buyer Cursor kit read one client's ads, landing pages, and fulfillment performance from Mr. Waiz. The portfolio exception is `GET /api/mb/performance` with no `clientId` (same body on `GET /api/mb/spend`): every client's full KPI set for one shared window.  
**Status:** routes are in the Mr. Waiz repo. `profiles.mb_api_token_hash` is applied on WM Reporting (`fszmndldcvrrmitfbwde`). The routes serve traffic after this app is deployed. Kit: sibling `wm-mb-kit`.  
**Related:** [CSM_BRIEF_API.md](CSM_BRIEF_API.md). Do not reuse the CSM token.

Company P&L is not on this API. The dollars a client payload may include are that client's ad spend and the loan volume on their funded files. The portfolio report lists those client metrics for every client. What Waiz charges the client, and what Waiz pays anyone, are never selected.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/mb/clients?search=` | Bearer `mb_…` or a session with `media_buyer` |
| GET | `/api/mb/client?clientId=` | Same |
| GET | `/api/mb/performance?clientId=&start_date=&end_date=` | Same. One client when `clientId` is set. Omit `clientId` for every client's KPIs. |
| GET | `/api/mb/spend?preset=` | Same. Alias of the all-client performance report. |
| GET | `/api/mb/ads?clientId=&start_date=&end_date=` | Same. Omit `clientId` for every client's ads. |
| GET | `/api/mb/library` | Same. Every ad name and alias. No spend and no client. |
| GET | `/api/mb/ads?library_id=` or `?ad=` | Same. One creative, split per client. |
| GET | `/api/mb/ad-diagnosis?clientId=&start_date=&end_date=` | Same. Deep diagnosis for one client (required `clientId`). |
| GET | `/api/mb/activity?clientId=&kind=leads\|dials\|appointments\|closes` | Same |
| GET | `/api/mb/calls?clientId=` | Same. Onboarding and launch only. |
| GET | `/api/mb/changes?clientId=` | Same. L1 and L2 only. |
| GET | `/api/mb/landing?clientId=` | Same. Read only. |

Dates are `YYYY-MM-DD`. A one-client performance window defaults to the last 30 days. Ad-diagnosis defaults to that client's launch date through today. The all-client report defaults to last week (Monday–Sunday before today in the call-center calendar). Activity defaults to `kind=dials`, `limit=200`, max `500`.

Omit `clientId` on `/api/mb/performance`, or call `/api/mb/spend`, for every client in one response. Presets: `today`, `yesterday`, `this_week`, `last_week`, `last_7`, `last_14`, `last_30`, `last_90`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `ytd`, `all_time`. An explicit `start_date` and `end_date` may be any length. Do not send a preset and dates together. `since_launch` stays on one client, because each launch date differs. Each `clients[]` row has `client_id`, `name`, `is_live`, `launch_date`, `reporting_type`, and `performance` — the same KPI fields as one client (spend, leads through fundings, dials, speed-to-lead, loan volume, and the cost-per figures). `totals` recomputes those rates from the summed counts. `totals.speed_to_lead_min` is not a pooled median. Speed on a client row is the median of stored dial seconds, which can differ from the one-client availability-aware figure. Clients with no activity are included at zero. Ads requested without a `clientId` stay rolled up by creative and do not name the account.

**Gate:** `media_buyer`. `client_health` alone is not enough. A `csm_…` token does not match this API.

## What is included

**Client record** (`/api/mb/client`)

- Name, live flag, lifecycle, launch date, product (`reporting_type`)
- Fulfillment: Call Center, Leads Only, or HE
- Package name: Call Center, Leads Only, Skool, or Bootcamp. The name only. No price.
- Address, licensed states, phones, email, NMLS, brokerage, offer summary
- Client contacts (LOA, co-LO, other) by name, role, phone, email
- Waiz people scheduled on the account, by name and role
- Meta ad account name and URL, Facebook page, Instagram
- Landing, thank-you, second landing, and funnel URLs
- Daily ad budget, ads-paused flag and note
- Google Drive folder link

**Performance** (`/api/mb/performance`)

With `clientId`: that client's totals for the window. Without `clientId`: the same totals for every client, plus a `totals` row. Fields: ad spend, leads, qualified, hot, opt-in is on the ad rows, DQ count, bookings, shows, hand-raises, conversations, proposals, submissions, funded count, close counts, loan volume, cost-per for those steps, total dials, pickup, and speed-to-lead.

**Spend** (`/api/mb/spend`)

Alias of the all-client performance report. `total_ad_spend` is the sum of client Meta budgets in `totals`. It is not Waiz revenue, not what Waiz charges, and not Waiz's own acquisition ads.

**Library** (`/api/mb/library`)

The creative catalog used to name a new ad: `ad_name`, aliases, product, format, status, summary, visual notes, tags, and the Drive link. This route does not return spend or which client ran the ad. Uniqueness checks use this list, including names that have not spent yet.

**Ads** (`/api/mb/ads`)

Spend, impressions, clicks, CTR, CPC, CPM, opt-in, the funnel counts above, DQ reasons, and the library entry (name, summary, visual notes, tags, product, format, Drive link to the creative). A drilldown adds the same numbers per client.

**Ad diagnosis** (`/api/mb/ad-diagnosis`)

One client's ads ranked on what their leads became downstream — quality-weighted conversations, proposals, submissions, and fundings — not CPL. Leads are grouped by the date they came in and followed forward. The payload includes evidence tiers, shrunk rank costs, stage owners (ad vs page vs setters vs loan officer), same-product peer medians with **no peer names**, angles by tag and format, and front-vs-back disagreements. Optional: `mature_days`, `qualify_switch`, `qualify_before=yes|no`. Large accounts can take about a minute. Kit skill: `client-ad-diagnosis` in `wm-mb-kit`.

**Activity** (`/api/mb/activity`)

Lead, dial, appointment, and close rows: borrower name and phone, which rep dialed, the ad name, qualified / hot / DQ, pickup, and speed-to-lead. Dial rows do not include a recording or a transcript.

**Calls** (`/api/mb/calls`)

Onboarding and launch calls, including the recording, transcript, and notes.

**Change log** (`/api/mb/changes`)

Ads and landing entries only (layers L1 and L2): what changed, why, the metric, and the number before and after.

**Landing** (`/api/mb/landing`)

The published URL and the draft copy (headline, offer, form, phone, NMLS, address printed on the page). `read_only: true`. This route does not publish or edit.

## Hard exclusions

- What Waiz charges: MRR, invoices, Stripe, billing email, contract price, retainers
- What Waiz pays: salary, bonus, per-booking rates, payroll totals
- Company KPIs: headcount, logo churn, Waiz pipeline, company ad spend, profit, cash
- GoHighLevel location id and subaccount link
- Setter call recordings and transcripts
- Check-in, churn, and other account calls
- Free-text client notes
- Call-center and show-rate change-log entries (L3, L4)
- Commission and ROAS

A blank package stays blank. The API does not guess Call Center when `sales_package` is empty.

## Setup

1. Migration `add_mb_api_token_hash.sql` is applied on WM Reporting.
2. Create the user with `media_buyer` only. Do not give them a dashboard login. The existing Ad Performance and Client Directory screens still return the GoHighLevel link and the rest of the client file.
3. Token: `npx tsx scripts/issue-mb-api-token.ts --email …`
4. Kit env in sibling `wm-mb-kit`: `MR_WAIZ_BASE_URL` and `MB_API_TOKEN`

## Code map

```
src/lib/mb-auth.ts
src/lib/mb-api.ts
src/app/api/mb/clients/route.ts
src/app/api/mb/client/route.ts
src/app/api/mb/performance/route.ts
src/app/api/mb/spend/route.ts
src/app/api/mb/ads/route.ts
src/app/api/mb/library/route.ts
src/app/api/mb/ad-diagnosis/route.ts
src/app/api/mb/activity/route.ts
src/app/api/mb/calls/route.ts
src/app/api/mb/changes/route.ts
src/app/api/mb/landing/route.ts
src/lib/client-ad-diagnosis.ts
scripts/issue-mb-api-token.ts
```
