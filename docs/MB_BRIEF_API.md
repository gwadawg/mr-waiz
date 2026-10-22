# Media Buyer Brief API

**Purpose:** Let the media-buyer Cursor kit read one client's ads, landing pages, and fulfillment performance from Mr. Waiz.  
**Status:** routes are in the Mr. Waiz repo. `profiles.mb_api_token_hash` is applied on WM Reporting (`fszmndldcvrrmitfbwde`). The routes serve traffic after this app is deployed. Kit: sibling `wm-mb-kit`.  
**Related:** [CSM_BRIEF_API.md](CSM_BRIEF_API.md). Do not reuse the CSM token.

The brief is that client's account. Company KPIs are not on this API. The only dollars in the payload are what that client spends on ads, and the loan volume on their funded files. What Waiz charges the client, and what Waiz pays anyone, are never selected.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/mb/clients?search=` | Bearer `mb_…` or a session with `media_buyer` |
| GET | `/api/mb/client?clientId=` | Same |
| GET | `/api/mb/performance?clientId=&start_date=&end_date=` | Same |
| GET | `/api/mb/ads?clientId=&start_date=&end_date=` | Same. Omit `clientId` for every client's ads. |
| GET | `/api/mb/ads?library_id=` or `?ad=` | Same. One creative, split per client. |
| GET | `/api/mb/activity?clientId=&kind=leads\|dials\|appointments\|closes` | Same |
| GET | `/api/mb/calls?clientId=` | Same. Onboarding and launch only. |
| GET | `/api/mb/changes?clientId=` | Same. L1 and L2 only. |
| GET | `/api/mb/landing?clientId=` | Same. Read only. |

Dates are `YYYY-MM-DD`. The default window is the last 30 days. Activity defaults to `kind=dials`, `limit=200`, max `500`.

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

That client's totals for the window: ad spend, leads, qualified, hot, opt-in is on the ad rows, DQ count, bookings, shows, hand-raises, conversations, proposals, submissions, funded count, close counts, loan volume, cost-per for those steps, total dials, pickup, and speed-to-lead.

**Ads** (`/api/mb/ads`)

Spend, impressions, clicks, CTR, CPC, CPM, opt-in, the funnel counts above, DQ reasons, and the library entry (name, summary, visual notes, tags, product, format, Drive link to the creative). A drilldown adds the same numbers per client.

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
src/app/api/mb/ads/route.ts
src/app/api/mb/activity/route.ts
src/app/api/mb/calls/route.ts
src/app/api/mb/changes/route.ts
src/app/api/mb/landing/route.ts
scripts/issue-mb-api-token.ts
```
