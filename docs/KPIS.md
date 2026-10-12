# KPI Reference — Call Center Reporting

**Source of truth** for which metrics we track per client, how they are calculated, and how data flows from GoHighLevel (GHL) into this app.

**Pipeline:** GHL → Make.com → `POST /api/webhooks` (and related routes) → Supabase → Dashboard

**Client filter:** Every metric is scoped by client. In GHL/sheets this is **Account**, **Project Name**, or **Sub-account**. In the app this is `clients.name` (resolved from `client_name` on webhooks).

**Last updated:** August 2026

---

## Primary client KPIs

These are the headline metrics reported to clients (formerly tracked in the Waiz Google Sheet).

| KPI | Definition | Formula | GHL / sheet source |
|-----|------------|---------|-------------------|
| **Total Leads** | Every new lead/contact ingested | `COUNT(lead events)` | Leads tab |
| **Qualified Leads** | Leads manually tagged as qualified | `COUNT(leads WHERE qualified = Y)` | Leads col G |
| **Hot Leads** | Leads manually tagged as hot | `COUNT(leads WHERE hot = Y)` | Leads col H |
| **Out of State Leads** | Leads outside target geography | `COUNT(out-of-state leads)` | Out of State tab / Leads col M |
| **Appointments Booked** | Every appointment booked | `COUNT(appointment_booked events)` | Appointments tab |
| **Booking Rate** | Reference only (not graded) | `Unique leads with appointment_booked ÷ Qualified Leads × 100` | Leads + Appointments |
| **Hand Raise Rate** | **Conversion benchmark** — share of qualified leads who raised their hand | `Unique leads with booked ∪ claimed ∪ live_transfer ÷ Qualified × 100` | Appointments + Claimed + LT |
| **Hand Raise Rate** | Share of qualified leads showing any intent path | `Unique leads with booked ∪ claimed ∪ live_transfer ÷ Qualified Leads × 100` | Appointments + Claimed + Live Transfers |
| **Shows** | Lead attended the appointment | `COUNT(show events)` or `Showed? = Y` | Appointments col J |
| **No Shows** | Lead missed the appointment | `COUNT(no_show events)` or `Showed? = N` | Appointments col J |
| **LO bailed** | Partner LO missed the appointment with the lead (not a lead no-show) | `COUNT(lo_bailed events)` or `Showed? = X` | Appointments col J |
| **Show Rate** | **Primary quality grade** — unique booked people who eventually spoke to the LO (recovery-inclusive). Metric key: `booked_to_conversation_rate` / graded as `show_rate`. | `Unique (booked ∩ show∪claimed∪live_transfer) ÷ Unique booked × 100` | Book + Show/Claim/LT |
| **Booked who spoke** | Count form of Show Rate | `unique_booked_converted` / `unique_booked` | same |
| **True Show** | Of appointments that took place (final attendance outcome), how many showed. Metric key: `show_pct`. | `Shows ÷ (Shows + No Shows + LO bailed) × 100` | Appointments |
| **LO Bail Rate** | Share of bookings the partner LO missed | `LO bailed ÷ Appointments Booked × 100` | Appointments |
| **Cancellations** | Appointments cancelled | `COUNT(appointment_cancelled)` | GHL cancel trigger |
| **Cancel Rate** | Cancelled vs scheduled | `Cancellations ÷ (Appointments Booked + Cancellations) × 100` | Appointments |
| **Conversation Rate** | Client-side conversations per qualified lead | `Unique leads with show ∪ claimed ∪ live_transfer ÷ Qualified Leads × 100` | Leads + Appointments + Live Transfers |
| **Live Transfers** | Live transfer to client/agent | `COUNT(live_transfer events)` | Live Transfers tab |
| **Total Conversations** | Meaningful completed calls (2 min+) plus client-claimed conversations | `COUNT(dials WHERE is_conversation = true) + COUNT(claimed events)` | Conversations / Claimed tab |
| **Proposals Made** | Reached proposal stage **or beyond** | `COUNT(unique leads with proposal_made OR submission_made OR loan_funded)` | MLO / Pipeline |
| **Submissions** | Reached submission stage **or beyond** | `COUNT(unique leads with submission_made OR loan_funded)` | MLO `Submitted` |
| **Funded Loans** | Unique borrowers who funded (conversion grain) | `COUNT(unique leads with loan_funded)` | MLO `Closed` |
| **Funded Transactions** | Each loan file that funded (two loans on the same house count as two) | `COUNT(loan_deals WHERE stage = funded)` | Loan log form + pipeline |
| **Loan Volume** | Production volume | `SUM(loan_deals.loan_size)` for funded transactions in range | Loan log |
| **Cost per Proposal** | Spend efficiency at proposal stage | `Ad Spend ÷ Proposals Made` | Spend + Pipeline |
| **Cost per Submission** | Spend efficiency at submission stage | `Ad Spend ÷ Submissions` | Spend + Pipeline |
| **Cost per Funded Borrower** | Spend efficiency at unique-person funded | `Ad Spend ÷ Funded Loans` | Spend + Pipeline |
| **Cost per Funded Transaction** | Spend efficiency at loan-file funded | `Ad Spend ÷ Funded Transactions` | Spend + `loan_deals` |

### Formula notes

- **Booking rate:** Unique leads with at least one `appointment_booked` in the window ÷ Qualified leads. A lead who books three times still counts once. Use the same date window for both sides and filter by the same client. Absolute **Appointments Booked** remains an event count (rebooks included).
- **Hand-raise rate:** Unique leads with any of `appointment_booked`, `live_transfer`, or `claimed` ÷ Qualified leads, when `clients.qualifies_leads` is true (we only dial and book qualified leads). When that flag is false, divide by total leads instead, because setters book every lead. The Client Roster **Qualify** checkbox is what writes this flag. Call center clients ignore it and keep hand-raise ÷ total leads. A lead who books and is later tagged claimed counts once.
- **Show Rate (primary Client Success “show quality”):** Unique leads with ≥1 `appointment_booked` **and** any of `show`, `claimed`, or `live_transfer` ÷ unique booked leads. Rebooks, no-show rebooks, cancels, and reschedules do not multiply the lead: one person in the denominator once; if they eventually speak they count once in the numerator. Cancel-only booked leads lower the rate. Live-transfer-only or claim-only leads **without** a booking are not in this rate (they still appear in Unique Conversations). Do **not** use `unique_conversations ÷ unique_booked` without the intersection.
- **True Show (appointments that took place):** `Shows ÷ (Shows + No Shows + LO bailed)`. Event-level booking-process quality. Pending, cancelled, and rescheduled slots are excluded from the denominator. Prefer **Show Rate** for graded “of people we booked, how many spoke?”
- **LO bail rate:** `LO bailed ÷ Appointments Booked`. Surfaces partner loan-officer no-shows (Showed? = X) as their own KPI rather than burying them in slot show rates.
- **Conversation rate:** Unique leads with any of `show`, `claimed`, or `live_transfer` ÷ Qualified leads when `clients.qualifies_leads` is true. When the flag is false, divide by total leads. Call center clients ignore the flag. A lead who shows and was also live-transferred counts once. Same unique-conversation figure is the Cost per Conversation denominator. Qualified-lead counts, qualification rate, and CPQL stay on the qualified tag either way.
- **Cancel rate:** `Cancellations ÷ (Appointments Booked + Cancellations)`. Use the same GHL **appointment ID** (`external_id`) on book and cancel. Prefer `/api/webhooks/appointment-status` with `status: "cancelled"` so the original booking row is updated (see `ccm-appt-cancelled.blueprint.json`). Reschedules are **not** cancellations — they use `appointment_rescheduled`.
- **Reschedules:** When a lead rebooks, ingest upserts by the same GHL `external_id` (time change) or inserts a new booking and auto-marks prior **pending** bookings for that contact as `appointment_rescheduled` (new GHL id / cancel+rebook). Optional Make field: `previous_external_id`. Absolute booked still counts each book event; **Appts to take place** subtracts rescheduled so superseded slots leave the pending backlog.
- **Appts to take place:** `Booked − Shows − No Shows − Cancellations − Rescheduled − LO bailed` (pending / unresolved slots).
- **Conversion funnel rollup:** Reaching a later stage implies every earlier stage. A lead with only `loan_funded` still counts toward Submissions and Proposals; a lead with only `submission_made` still counts toward Proposals. Implied stages are derived at read time (in `src/lib/metrics.ts`) — we do **not** insert synthetic proposal/submission rows, and each lead is counted once per stage.
- **Person vs transaction grain:** Unique funded / submissions / proposals stay **one count per borrower** (`events`). Each loan file is a row in `loan_deals`. Same borrower, two loans (even on the same house) = +1 unique funded borrower and +2 funded transactions. Do not combine dollar amounts onto one close. Log each transaction on the loan-log form (optional name if two files are the same size the same day).
- **Qualified / Hot:** Manually tagged in GHL or the setter team — there is no automatic qualification rule.
- **Total conversations:** Do not count failed or zero-duration calls. Use **completed** status and **duration > 120 seconds** (2 minutes), matching the Daily Summary definition. `claimed` events also count because they represent the client manually speaking with or messaging a lead outside the setter workflow.

---

## Operational KPIs (call center performance)

Tracked on the internal dashboard and derived from call + funnel events (formerly in Daily Summary aggregates — **do not ingest Daily Summary as source of truth**; compute from row-level events).

| KPI | Definition | Formula |
|-----|------------|---------|
| **Outbound Dials** | All dial events | `COUNT(dial)` |
| **Pickups** | Calls at least 40 seconds | `COUNT(dial WHERE is_pickup = true)` — typically `duration ≥ 40s` |
| **Pick Up Rate** | Pickups per dial | `Pickups ÷ Outbound Dials × 100` |
| **Conversations (2 min+)** | Dial conversations only | `COUNT(dial WHERE is_conversation = true)` |
| **Claimed** | Client manually spoke with/messaged the lead outside our booking flow | `COUNT(claimed)` |
| **Conversation Rate** | Conversations per pickup | `Conversations ÷ Pickups × 100` |
| **Speed to Lead** | **Median** minutes from lead to first dial, counting only leads that arrive inside a live setter-availability window | `MEDIAN(first_dial.occurred_at − lead.occurred_at)` per contact, excluding leads with no precise timestamp and leads that arrive off-hours |
| **Callback Requests** | Callback appointments booked | `COUNT(callback_booked)` |
| **Callback Rate** | Callbacks per lead | `Callbacks ÷ Total Leads × 100` |
| **Appts To Take Place** | Still scheduled (pending outcomes) | `Appointments Booked − Shows − No Shows − Cancellations − Rescheduled − LO bailed` |
| **Dials Per Lead** | Dial effort per qualified lead (only qualified leads are dialed) | `Outbound Dials ÷ Qualified Leads` |
| **Ad Spend** | Meta (Facebook) | `SUM(meta_ad_insights.spend)` via `daily_meta_spend` view |
| **Meta spend** | Facebook / Meta only | `SUM(meta_ad_insights.spend)` (daily rollup via `daily_meta_spend` view) |
| **CPL** | Cost per lead | `Ad Spend ÷ Total Leads` |
| **CP Qualified Lead (CPQL)** | Cost per qualified lead | `Ad Spend ÷ Qualified Leads` |
| **CP Hot Lead (CPH)** | Cost per hot lead | `Ad Spend ÷ Hot Leads` |
| **CP Conversation** | Cost per client conversation | `Ad Spend ÷ Unique leads with show ∪ claimed ∪ live_transfer` |
| **CP Appointment** | Cost per booking | `Ad Spend ÷ Appointments Booked` |
| **CPS** | Cost per show | `Ad Spend ÷ Shows` |

### Client Workspace KPI layout

The main **Dashboard** view for RM clients shows these sections:

1. **Leads & Pipeline** — Total Leads, Qualified, Hot, Out of State, Claimed, Live Transfers  
2. **Appointments** — Booked, booking rate, appts to take place, shows, no-shows, LO bailed, cancellations  
3. **Show Quality & Conversion** — **Show Rate** (primary), **True Show**, Cancel Rate, LO Bail Rate, Conversation Rate  
4. **Acquisition Costs** — Total Spend, CPL, CPQL, CPH, Cost per Appointment, Cost per Conversation  
5. **Conversions** — Proposals Made, Submissions, Unique Funded
   Borrowers (and funded-transaction / loan-volume cards). Shown for
   Reverse, DSCR, and Call Center. Cost per stage and ROAS omit when
   ad spend in range is $0. Unique-lead count cards open Explorer →
   Conversions filtered to that stage.
6. **Trends** — Line charts for CPL, CPQL, and Cost per Conversation over the selected date range  

The **Funnel Simulator** tab (`?view=kpi_simulator`) is a forward-looking calculator for RM prospects and clients: plug in spend, CPL, and stage conversion rates (or load from a selected RM client’s date range) to see projected funnel counts, cost metrics, KPI tier badges, and goal back-solve (“N funded loans → required spend”).

Rate cards carry an info tooltip with their formula. Show Quality leads with **Show Rate** (unique booked → spoke to LO); **True Show** (took-place slots) is secondary.

HE / Call Center clients keep the appointment + calling stats grid
and also get the Conversions block. Booking Rate on the HE overview
still uses Total Leads as the denominator.

**Call Center billable (not RM Unique Conversations):** **Billable Conversations** = unique leads with `live_transfer` ∪ `show` in the selected range — claimed never counts toward what we charge. **Claimed After Booked** = unique leads whose earliest `claimed` in range is strictly after their earliest `appointment_booked` in range (summary watch card; dated drill-down is a follow-up). RM **Unique Conversations** remains `show ∪ claimed ∪ live_transfer` and is unchanged.

### Client Success tab (RM vs HE)

The **Client Success** view (`client_health`) splits clients by `reporting_type` and by **department lens**:

| Segment | Clients | Graded KPIs | Account (Overview) tier |
|---------|---------|-------------|-------------------------|
| **Paid Ads (RM + DSCR)** | paid-ads reporting types | Lead-to-qualified, **unique hand-raise**, **Show Rate** (unique booked→spoke), close, CPL, CPQL, CPConv | North star = **CPConv** only |
| **Call Center (HE)** | appointment-only / HE | **Unique hand-raise** (÷ total leads), **Show Rate** | Worst of hand-raise + Show Rate |

**Role lenses (same data, different 911):**

| Lens | Status drivers | Does not grade |
|------|----------------|----------------|
| **Overview** | CPConv (RM) / hand-raise + **Show Rate** (HE). Focus **Act now** = north-star 911 only; leading cost/funnel reds → Monitor / Leading watch | — |
| **Media Buyer** | Worst of CPL, CPQL, lead→qualified (leading 7d preferred) | CPConv, hand-raise, Show Rate |
| **CCM** | Worst of **unique hand-raise**, **Show Rate**, conversation % | CPL, CPQL, CPConv, booking-only |

**Conversion benchmark = unique hand-raise** (`Unique leads with booked ∪ claimed ∪ live_transfer`), not booking-only rate. **Graded show quality = Show Rate** (`unique booked ∩ spoke ÷ unique booked`). Multiple booking events for one lead count once. **True Show** (slot took-place) is booking-process secondary only — not Client Success grades.

HE accounts have **no ad-cost grading** (CPL / CPQL / CPConv are omitted). **Outbound dials** are shown for volume context but are not tiered. Detail drill-down shows **Account** + **lane** badges when opened from Media / CCM so CPConv 911 is never mistaken for that seat’s scorecard. Per-client benchmark overrides in Admin → Client Roster allow CPL customization (CPQL / CPConv derive from CPL + global conversion bands).

---

## Sheet tabs → app mapping

### Ingest (row-level source of truth)

| Sheet tab | App `event_type` | Webhook |
|-----------|------------------|---------|
| **Leads** | `lead` | `POST /api/webhooks` |
| **Appointments** | `appointment_booked` | `POST /api/webhooks` |
| **Appointments** (outcome) | `show`, `no_show`, `lo_bailed`, `appointment_cancelled`, `appointment_rescheduled` | `POST /api/webhooks` or `POST /api/webhooks/appointment-status` |
| **Conversations** | `dial` | `POST /api/webhooks` |
| **Claimed** (client-handled) | `claimed` | `POST /api/webhooks` |
| **LO audit** | `lo_audit` | Internal cadence tracking — **not** a client KPI |
| **Live Transfers** | `live_transfer` *(planned)* | `POST /api/webhooks` |
| **Pipeline / MLO** | `proposal_made`, `submission_made`, `loan_funded` | `POST /api/webhooks` |
| **Callbacks** (callback calendar) | `callback_booked` | `POST /api/webhooks` |
| **Ad spend** | — | `POST /api/ad-spend` |

### Reference only (do not ingest as KPI source)

| Tab | Use |
|-----|-----|
| **Daily Summary** | Cross-check aggregates only; all KPIs computed from events |
| **Agents** | Maps to `agents` table in app (Admin → Agent Roster) |
| **Raw GHL Leads** | Optional full payload in `events.raw` on lead ingest |

### Ignore completely

- CFNB  
- Ad stats  
- Costs  
- Calendar  

---

## Field mapping (GHL → webhook → `events` table)

### Lead (`event_type: lead`)

| Sheet (Leads) | Webhook field | DB column |
|---------------|---------------|-----------|
| Date Created | `occurred_at` | `occurred_at` |
| Account | `client_name` | → `client_id` |
| Lead Name | `lead_name` | `lead_name` |
| Phone Number | `lead_phone` | `lead_phone` |
| Email | `lead_email` | `lead_email` |
| Link To Contact | `ghl_contact_id` | `ghl_contact_id` |
| Qualified | `qualified` *(planned)* | `raw` until column added |
| Hot | `hot` or `is_hot` | `is_hot` |
| Out of State? | `out_of_state` *(planned)* | `raw` |
| Ad Name | `ad_name` or `utm_content` | `ad_name` |
| Ad Set | `adset_name` / `ad_set_name` | `adset_name` |
| Campaign | `campaign_name` or `utm_campaign` | `campaign_name` |
| UTM source/campaign/content | `utm_source`, `utm_campaign`, `utm_content` | `utm_source`, `utm_campaign`, `utm_content` |
| UTM term (site) | `utm_term` | `events.utm_term`, copied onto `leads.utm_term`. Blank is stored as null. |
| Loan amount, property value, State | `loan_amount`, `property_value`, `state` | `raw` |
| B1 / B2 age (RM) | `b1_age`, `b2_age` | `raw` |
| Credit score range, Property use (DSCR) | `credit_score_range`, `property_use` | `raw` |

**Lead intake by product.** Intake is read from `events.raw` on the `lead` event by `src/lib/lead-intake.ts` and shown in the Leads table and CSV. The product comes from `clients.reporting_type`, not from which fields are filled in.

| Field | RM | DSCR |
|-------|----|------|
| Loan amount, property value, LTV (loan ÷ value), state | Yes | Yes |
| B1 age, B2 age | Yes | No |
| Credit score range (text bucket such as `700-739`, never coerced to a number) | No | Yes |
| Property use (`Primary` / `Investment`; other text kept as sent) | No | Yes |

Make's `ccm-new-lead` scenario sends all keys for every client. Keys that do not apply to a product arrive blank and the app ignores them.

**Ad attribution (Media Buyer view):** `ad_name` is the universal join key — the same Facebook ad names are reused across every client, so the Media Buyer leaderboard groups by `ad_name` globally. On lead ingest the webhook resolves `ad_name` from `ad_name` → `adName` → `utm_content` (Facebook commonly maps `{{ad.name}}` into `utm_content`). Send the ad name on the **lead** webhook so downstream appointments/shows/closes for that contact can be attributed back to the ad. Imported leads already carry `raw.ad_name`/`raw.ad_set_name`; run `node scripts/backfill-ad-attribution.mjs` once to copy those into the new columns.

### Appointment (`event_type: appointment_booked`)

| Sheet (Appointments) | Webhook field | DB column |
|----------------------|---------------|-----------|
| Date Appointment Created | `occurred_at` | `occurred_at` |
| Date Of Appointment / Requested Time | `scheduled_at` | `scheduled_at` |
| Project Name | `client_name` | → `client_id` |
| Lead Name / Email / Phone | `lead_name`, `lead_email`, `lead_phone` | same |
| GHL appointment ID | `external_id` or `ghl_appointment_id` | `external_id` |
| GHL calendar ID | `calendar_id` or `ghl_calendar_id` | `calendar_id` |
| Calendar Name | `calendar_name` | `calendar_name` |
| Stage Booked | `stage_booked` | `stage_booked` |
| Showed? Y/N/X | `show` / `no_show` / `lo_bailed` or status webhook | `event_type` |
| Agent | `agent_name` | `agent_name` |
| AI booking flag | `contact_tags` includes `ai-booked`, or `is_ai_booked: true` | `is_ai_booked` (excludes from agent credit queue; still counts in KPIs) |

**Credit queue:** **Live transfers** plus appointments/callbacks on **`Call Center Booking Calendar`** always appear. **`AI Booking Calendar`** bookings also appear for historical rep credit (null/empty agent or already credited to a real name). Rows with agent `#N/A` on the AI calendar are Conversation AI and stay out of the queue. `#N/A` on the Call Center calendar counts as uncredited. Run `node scripts/backfill-legacy-calendar-agent-credit.mjs --apply` once to auto-credit bookings from the last roster dial before the appointment.

**Lifecycle:** Send the **same** `external_id` (GHL appointment id) on `appointment_booked` and when calling **`POST /api/webhooks/appointment-status`** (show / no_show / cancelled / rescheduled). Same-id time changes upsert the booking row in place. A new book for the same contact auto-marks prior pending bookings as `appointment_rescheduled` (optional Make field: `previous_external_id`). For separate outcome **inserts** (`show`, `no_show`, `lo_bailed`, `appointment_cancelled`, `appointment_rescheduled` via main webhook), include **`external_id`** on each row so joins and exports stay aligned. Include **`calendar_id`** on booking (and on any follow-up inserts if you want it denormalized).

### Call (`event_type: dial`)

| Sheet (Conversations) | Webhook field | DB column |
|-----------------------|---------------|-----------|
| Date & Time of Call | `occurred_at` | `occurred_at` |
| Sub-account | `client_name` | → `client_id` |
| Direction | `direction` | `direction` |
| Status | `call_status` | `call_status` |
| Durations (seconds) | `duration_seconds` | `duration_seconds` |
| Agent | `agent_name` | `agent_name` |
| Dialing software | `dial_source` or `software` | `dial_source` |
| Phone number used | `phone_number_used` | `phone_number_used` |
| Recording URL | `recording_url` | `recording_url` |
| Call Summary | `call_summary` | `call_summary` |

**Derived on ingest (Make):**

```text
is_pickup       = duration_seconds >= 40
is_conversation = duration_seconds >= 120 AND call_status = 'completed'
```

**GHL → Make → `recording_url`:** map the first non-empty URL from GHL custom data, in order:

1. `Attachment ` (note trailing space — GHL’s label)
2. `Message Attachments`
3. `Recording URL`

Example Make field: `{{ifempty(1.customData.`Attachment `; ifempty(1.customData.`Message Attachments`; 1.customData.`Recording URL`))}}`

Recordings appear in **Data Explorer → Dials** (▶ Listen) and **Agents → Recordings**.

### Live transfer (`event_type: live_transfer`) — planned

| Sheet (Live Transfers) | Webhook field |
|------------------------|---------------|
| Date | `occurred_at` |
| Project Name | `client_name` |
| Lead Name / Phone | `lead_name`, `lead_phone` |
| Agent | `agent_name` |

### Claimed (`event_type: claimed`)

Use when the client manually spoke with or messaged a lead outside the setter booking/live-transfer flow. This counts toward **Total Conversations** but does not count as an outbound dial or appointment.

| Field | Webhook field |
|-------|---------------|
| Date | `occurred_at` |
| Project Name | `client_name` |
| Lead identity | `ghl_contact_id`, `lead_name`, `lead_phone`, `lead_email` |
| Who handled it, if known | `agent_name` |
| Channel/source, optional | Stored in `raw` fields like `channel`, `claimed_source` |

### Meta ad insights (`meta_ad_insights` table) — Meta spend source

All Meta spend KPIs sum `spend` from this table (grouped by client and day). Make
posts ad-level rows daily; historical sheet totals may exist as synthetic daily rows
from one-time migration scripts.

For setup, see [`docs/META_ADS_SPEND_IMPORT.md`](META_ADS_SPEND_IMPORT.md).

### Meta ad insights webhook (`POST /api/meta-ad-insights`)
|-------|----------------------------------------|
| Date | `date`, `insight_date`, or Meta `date_start` |
| Client | `client_name` or `client_id` |
| Campaign | `campaign_id`, `campaign_name` |
| Ad set | `adset_id`, `adset_name` |
| Ad | `ad_id`, `ad_name` |
| Delivery account | `account_id` |
| Cost metrics | `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm` |
| Meta actions | `actions`, `cost_per_action_type` |

---

## Show / no-show handling (choose one model)

Document your live Make scenario to match one approach:

| Model | Behavior | Best for |
|-------|----------|----------|
| **A — Outcome rows** | Keep `appointment_booked`; add separate `show` / `no_show` events | Sheet-style show rate (bookings stay in denominator) |
| **B — Status update** | `POST /api/webhooks/appointment-status` flips row `appointment_booked` → `show` / `no_show` | Single row per appointment in DB |

**Client show rate** uses appointments that took place (Shows + No Shows + LO bailed) in the denominator — still-pending and cancelled bookings are excluded. Prefer **Model A** or keep immutable booking counts so each outcome is recorded.

---

## Implementation status

| KPI | Dashboard today | Notes |
|-----|-----------------|-------|
| Total Leads | Yes | `lead` events |
| Appointments Booked | Yes | `appointment_booked` |
| Booking Rate | Yes | RM: unique booked ÷ Qualified; HE overview: unique booked ÷ Total Leads (`lead_booking_rate`) |
| Shows / No Shows | Yes | Event counts |
| **Show Rate** | Yes | Graded Client Success `show_rate`: unique (booked ∩ spoken) ÷ unique booked |
| Booked who spoke | Yes | `unique_booked_converted` count |
| Show Rate (of booked) | Yes | Slot events — secondary |
| True Show | Yes | Slot took-place — secondary |
| LO Bail Rate | Yes | `lo_bailed ÷ appointments booked` |
| Conversation Rate | Yes | unique (show ∪ claimed ∪ live_transfer) ÷ qualified_leads |
| Cancellations / Cancel Rate | Yes | `appointment_cancelled`; rate = cancel ÷ (booked + cancel) |
| Outbound Dials, Pickups, CPL, etc. | Yes | See `src/lib/metrics.ts` |
| Total Conversations (2 min+) | Yes | Dial conversations plus `claimed` events |
| Qualified / Hot / Out of State | Yes | `is_qualified`, `is_hot`, `is_out_of_state` on lead webhooks |
| Live Transfers | Yes | `event_type: live_transfer` |
| Claimed | Yes | `event_type: claimed` |
| Conversions (Proposal / Submission / Funded) | Yes | Canonical `proposal_made`, `submission_made`, `loan_funded` (legacy aliases normalized) |
| Goals (targets) | Partial | Requires `goals` table in Supabase |

**Code references:**

- Metric formulas: `src/lib/metrics.ts`
- Webhook ingest: `src/app/api/webhooks/route.ts`
- Dashboard display: `src/components/DashboardView.tsx`
- Agent breakdown: `src/app/api/agent-stats/route.ts`

---

## Data prep checklist (go-live)

1. Create each client in **Admin → Client Roster** (`clients.name` must match GHL location / sheet Account).
2. Point Make scenarios at your app URL with `Authorization: Bearer <ADMIN_WEBHOOK_SECRET>`.
3. Backfill or live-stream: `lead`, `dial`, `appointment_booked`, show/no-show, `callback_booked` where used.
4. Send daily **ad spend** per client/platform.
5. For speed-to-lead: reuse `ghl_contact_id` on lead and first dial for the same contact.
6. Do **not** sync Daily Summary totals — validate against them only.

### Speed-to-lead timestamps (critical)

Speed-to-lead is only as accurate as the **lead's creation timestamp**. It must be a full
date-time **with a timezone offset**, not a bare date.

- **Lead scenario (Make.com):** map `occurred_at` from the GHL contact `dateAdded` field,
  which is full ISO 8601 with offset (e.g. `2026-06-03T08:14:22-04:00`). Do **not** map a
  date-only field (e.g. `2026-06-03`) — the app cannot recover the time of day and the lead
  is excluded from speed-to-lead.
  - **Easiest bulletproof option:** `{{formatDate(dateAdded; "YYYY-MM-DDTHH:mm:ssZ"; "UTC")}}`
    → `2026-06-03T18:31:00+00:00`. UTC for every client, so per-subaccount zones don't matter.
  - **Per-contact-zone option:** GHL also sends the contact's own zone as `timezone`
    (e.g. `America/New_York`). If you map a naive ISO `occurred_at` (no offset) **and** pass
    that zone as `lead_timezone` (or `timezone`), the app anchors the lead to its own zone.
    Priority for offset-less lead times: payload `timezone` → `INGEST_SOURCE_TIMEZONE`.
- **Dial scenario (Make.com / dialer):** send `occurred_at` as ISO 8601 with an offset too.
  Both GHL and HP dials currently emit a naive `2026-06-03T20:18:12` in **US Eastern**, so the
  app anchors offset-less lead + dial times to `INGEST_SOURCE_TIMEZONE` (default
  `America/New_York`). This is independent of the agents' zone and the client's zone.
- **Source of speed-to-lead:** the metric pairs each lead's created time to its **earliest
  dial from any source** (GHL or HP). So the universal fix is to give every lead a precise
  created time (below); the HP `lead_created_date` capture is only a fallback for HP-first leads.
- A lead sent with only a date is stored with `events.occurred_at_has_time = false` and is
  skipped by the speed-to-lead metric (it never produces a `speed_to_lead_seconds`).
- The metric counts a lead only if it arrives inside a **live setter-availability window**,
  evaluated in `CALL_CENTER_TIMEZONE` (the agents' shift zone, e.g. `America/Sao_Paulo`);
  off-hours leads are excluded, not penalized. The lead's own zone and the client's zone do
  not affect the elapsed minutes — a duration between two absolute instants is the same
  everywhere; only the in-window check depends on the agents' zone.
- **Historical caveat:** leads ingested before this fix were stored date-only (no time of
  day), so their speed-to-lead is unrecoverable and excluded. The metric only becomes
  meaningful for leads received after the Make `dateAdded` mapping is in place.

### Speed-to-lead time filters & hour breakdown

All speed-to-lead views (Dial Analytics, Raw Data → Speed to Lead) use the same computed
metric in `src/lib/speed-to-lead.ts` — not the stored `events.speed_to_lead_seconds` column alone.

| Feature | Behavior |
|---------|----------|
| **Setter schedule filter** | On by default. Leads must arrive inside a live row in `setter_availability` (Call Center Hub → Weekly Focus → Setter Availability). Toggle off to include all precise-timestamp leads. |
| **Lead arrived after / before** | Optional `HH:MM` cutoffs in call-center timezone. Excludes overnight backlog or other stale leads without affecting the dial timestamp. API params: `lead_after`, `lead_before`. |
| **Hour breakdown** | Dial Analytics shows median minutes by lead-arrival hour (0–23) in `CALL_CENTER_TIMEZONE`. |
| **Raw Data tab** | One row per lead→first-dial pair with **Lead Arrived**, **First Dial**, **Response (min)**, and **Counted** (yes/no with exclusion reason on hover). |

Exclusion reasons: off-hours (outside setter schedule), missing precise timestamp, before/after manual cutoff.

---

## Heat maps (lead-local time)

The lead-volume, pickup-rate, and show-rate heat maps bucket each event by the **lead's own
local time of day**, so "best hour to call" reflects the prospect's clock rather than UTC.

- Each event is placed using the contact's IANA zone in `events.lead_timezone`, captured from
  the GHL payload's **`timezone`** field at ingest (e.g. `America/New_York`).
- Dials and appointments that don't carry their own zone are resolved from the matching
  contact's lead, then fall back to `LEAD_DEFAULT_TIMEZONE` (default `America/New_York`).
- **Make mapping:** add a `timezone` field to the lead webhook, mapped to the GHL contact's
  timezone. (Client/sub-account `clients.timezone` is *not* used here — it's sparse and stored
  as abbreviations like `EST`, which aren't valid IANA zones.)
- Historical caveat: rows ingested before `lead_timezone` existed have no stored zone and use
  the default; lead-volume is also date-only until the speed-to-lead `occurred_at` fix lands.

---

## Media Buyer (global ad performance)

The **Media Buyer** view (Overview group) ranks Facebook ads **globally across all live clients**, grouped by `ad_name`. It joins two sources by ad name:

- **Spend / platform metrics** from `meta_ad_insights` (spend, impressions, clicks, CTR, CPC, CPM), summed across clients.
- **Funnel outcomes** attributed from `events`: the ad name on each `lead` builds a per-client contact → ad map (via `buildContactKey`), and that contact's later `appointment_booked` / `show` / `no_show` / `claimed` / `live_transfer` / `proposal_made` / `submission_made` / `loan_funded` events inherit the lead's ad. Unique-lead rates use the same `leadIdentityKey` as client KPI cards.
- **Manual DQs** (`event_type = 'manual_dq'`, `raw.source = 'client_log_form'`)
  use only that lead map. A name copied onto the DQ row is ignored, so a later
  remap cannot split the creative. A DQ whose lead is outside the range does
  not count.

| Metric | Formula (per ad name, summed across clients) |
|--------|----------------------------------------------|
| **Spend** | `SUM(meta_ad_insights.spend)` |
| **Impressions** | `SUM(meta_ad_insights.impressions)` |
| **Clicks** | `SUM(meta_ad_insights.clicks)` |
| **CTR** | `Clicks ÷ Impressions × 100` |
| **CPC** | `Spend ÷ Clicks` |
| **CPM** | `Spend ÷ Impressions × 1000` |
| **Leads / Qualified / Hot / Closes** | `COUNT(attributed lead / qualified lead / hot lead / loan_funded)` — volume, not unique |
| **Qual %** | `Qualified ÷ Leads × 100` |
| **Hot %** | `Hot ÷ Leads × 100` |
| **CPL** | `Spend ÷ Leads` |
| **CPQL** | `Spend ÷ Qualified` |
| **CPH** | `Spend ÷ Hot` |
| **CPCONV** | `Spend ÷ Unique (show ∪ claimed ∪ live_transfer)` — north star, same as client cards |
| **Hand-raise %** | `Unique (booked ∪ claimed ∪ LT) ÷ Qualified × 100` |
| **Conversation %** | `Unique (show ∪ claimed ∪ LT) ÷ Qualified × 100` |
| **Proposals** | Unique leads with `proposal_made` / `proposal_sent` **or later** (submission / funded roll up) |
| **Submissions** | Unique leads with `submission_made` / `loan_processing` **or later** (funded rolls up) |
| **Funded** | Unique borrowers with `loan_funded` / `closed` |
| **DQs** | Unique contacts with a form `manual_dq` whose lead is also in range |
| **DQ %** | `Unique DQs ÷ Leads × 100` |
| **DQ reasons** | Count of each slug in `raw.dq_reasons` (LTV, FICO, Low Property Value, Seasoning, Low Income, Other). One contact can increment more than one reason. Shown in the ad workspace, not as separate leaderboard columns. |
| **CPP / CPS / CPF** | `Spend ÷ unique proposals / submissions / funded` — same formulas as client cards |
| **Booking Rate** | `Unique booked leads ÷ Qualified × 100` |
| **Cost per Show** | `Spend ÷ Show events` — platform/secondary only; **not** CPCONV |
| **Cost per Close** | `Spend ÷ Closes` |
| **Show Rate** (Media Buyer ad board) | Slot/event attendance (`Shows ÷ (Shows + No Shows)`). **Not** Client Success graded **Show Rate** (unique booked → spoke) |

Opening an ad loads the **ad workspace**: CPL / CPQL / CPH / CPCONV plus backend CPP / CPS / CPF (and qual / hot / hand-raise / conversation rate) as day or week series (week when the range is > 90 days, same rule as client cost trends), the manual-DQ reason mix, plus a per-client table so a blended spike can be split into **creative fatigue** (most accounts drift together) vs **one account**.

Client Workspace → Conversions shows the same unique form-DQ count.
That card opens Explorer with the Disqualified stage filter.

Each ad can also have an **Ad Library** entry (`ad_library` table): a Google Drive link to the creative plus a summary and visual notes. This is curated manually and is the structured input a future "AI recreate this winning ad" feature will use.

**Attribution caveat:** the leaderboard scopes events to the selected date range, so an appointment is attributed only when its originating lead also falls in range. Widen the range to capture lead → close journeys that span months.

**Code references:** `src/lib/ad-performance.ts` (engine), `src/app/api/media-buyer/route.ts` (API), `src/app/api/ad-library/route.ts` (library CRUD), `src/components/MediaBuyer.tsx` (UI).

---

## Date filtering

| Data | Filter field |
|------|----------------|
| Events (leads, dials, bookings) | `occurred_at` |
| Show heat map | `scheduled_at` |
| Ad spend | `spend_date` |

Use the same client + date range when comparing booking rate across qualified leads and appointments.

---

## CEO / Business KPIs (Business view)

The **Business** view (Overview group) is the agency-owner cockpit: recurring revenue, cash
collected, churn/retention, and portfolio risk **across the whole client book** — not scoped to
one client. It is powered by `src/lib/business-metrics.ts` (`src/app/api/business/route.ts`),
which aggregates three tables:

- `clients` — current `mrr`, `lifecycle_status`, `date_signed`, `churned_at`, `offer`, contract terms.
- `client_status_history` — every lifecycle transition with `mrr_at_change` + `changed_at` (the churn / lost-MRR backbone).
- `client_billings` — the append-only cash ledger (`amount`, `amount_paid`, `paid_on`, `revenue_segment`, `revenue_type`, `processing_fee`, `passthrough_amount`, `lead_source`).

### Headline KPIs

| KPI | Definition | Formula |
|-----|------------|---------|
| **Active MRR** | Current recurring revenue from active clients | `SUM(clients.mrr WHERE lifecycle_status = 'active')` |
| **Net New MRR** (month) | Growth in recurring revenue this month | `New MRR − Lost MRR (± Expansion − Contraction)` |
| **Cash Collected** (month) | Cash actually received this month | `SUM(amount_paid WHERE paid_on in month)` (excludes passthrough) |
| **Gross Revenue Churn %** | Recurring revenue lost to churn | `Lost MRR ÷ MRR at month start × 100` |
| **Active Clients** | Live recurring accounts | `COUNT(clients WHERE lifecycle_status = 'active')` |
| **ARPA** | Average revenue per account | `Active MRR ÷ Active Clients` |

### Revenue & cash (cash-collected basis)

All cash KPIs use **cash actually collected** (`amount_paid`, dated by `paid_on`), not amounts billed,
so the numbers match the bank. Passthrough (ad-spend reimbursement) is always excluded from revenue.

| KPI | Definition |
|-----|------------|
| **New Cash Collected** | Cash collected this month on `revenue_segment = 'front_end'` billings — a new client's setup / PIF / first-contract payment. |
| **New-Logo Cash** (cross-check) | Cash collected this month on each client's **first-ever** paid billing (`MIN(paid_on)` per client). A tagging-free sanity check on New Cash. |
| **Recurring Cash Collected** | Cash collected on `revenue_segment = 'back_end'` billings. |
| **Total Cash Collected** | `SUM(amount_paid)` for the month (front + back), excluding passthrough. |
| **Net of Processing Fees** | `SUM(amount_paid − processing_fee)`. |
| **Revenue by Type** | Split of collected cash by `revenue_type` (`mrr` / `pif` / `performance`). |
| **Revenue by Lead Source** | Split of collected cash by `lead_source` (Meta / Referral / Cold Call / LinkedIn …) — where the agency's own clients come from. |
| **Outstanding AR / Overdue** | Unpaid balances from `balanceOf` + `recordedState` (see `src/lib/billing.ts`). |

### MRR movement (the MRR bridge)

| KPI | Definition |
|-----|------------|
| **New MRR** | `SUM(clients.mrr)` for clients whose `date_signed` falls in the month. |
| **Lost MRR** | Roster-only. One departure per client from `client_status_history` into `off_boarding` or `churned` (deduped). Month bucket = churn form `effective_churn_date` when present, else `clients.churned_at`, else first departure `changed_at`. Amount = `mrr_at_change` at first departure. **Not** derived from billing charges. |
| **Expansion / Contraction MRR** | MoM MRR delta on clients active in both prior-month and this-month `client_monthly_snapshots`. |
| **Net New MRR** | `New + Expansion − Contraction − Lost`. |
| **Start / End MRR** | Prior-month snapshot (start) and this-month snapshot or live Active MRR (end). Cron on the 1st freezes the **prior** month. |

**Extensions, free months, late charges (cash timing — not Lost MRR):**

| Situation | What to do | What CEO metrics should show |
|-----------|------------|------------------------------|
| Free month / payment extension | Keep lifecycle `active`; defer the billing `due_date` / next charge date. Do **not** zero MRR or mark churned. | Active MRR unchanged; cash collected later (or $0 that month); AR may rise if you still book a future due. |
| Late to charge | Same — leave roster alone; when you collect, set `paid_on` to the real collection date. | Cash lands in the payment month; MRR bridge unchanged. |
| Client actually left | Set `off_boarding` then `churned` (or straight to churned) with correct `churned_at` / keep `mrr` until the status change so Lost MRR stamps correctly. | Lost MRR in the effective leave month. |
| Roster catch-up (left months ago, still “active”) | Backfill churn with the real `churned_at` before trusting historical Lost MRR / churn %. | Until cleaned, Active MRR is overstated and Lost MRR understated. |

### Churn & retention

| KPI | Definition |
|-----|------------|
| **Logo Churn Rate** | `Departed clients in month ÷ Active clients at month start × 100`. |
| **Gross Revenue Churn Rate** | `Lost MRR ÷ MRR at month start × 100`. |
| **Net Revenue Retention (NRR)** | `(Start MRR + Expansion − Contraction − Lost) ÷ Start MRR × 100`. |
| **Avg Client Tenure** | Mean months from `date_signed` to `churned_at` (or today for active). |

### Clients & portfolio risk

| KPI | Definition |
|-----|------------|
| **Lifecycle Funnel** | Client counts by `lifecycle_status`: new_account → onboarding → active → paused → off_boarding → churned. |
| **New Clients Signed** | `COUNT(clients WHERE date_signed in month)` — roster logos (reporting). |
| **Signed closes** | Non-dismissed `acquisition_closes` in the month — **CAC denominator**. |
| **MRR by Offer** | Active MRR + client count split by `offer` (RM vs HE). |
| **Revenue Concentration** | Top client's % of Active MRR, and top-5 % — single-client dependency risk. |
| **Contracts Ending Soon** | Clients with `contract_end_date` within 60/90 days and their at-risk MRR. |

### Unit economics & finance (input-driven)

These light up per metric as soon as the relevant input exists. Inputs are imported (or typed into
the **Edit inputs** modal) and stored in the `business_metrics` time-series table, keyed by month.
Each missing-input metric shows a dimmed "needs data" card until its inputs are present.

**Preferred source (v1+):** the **Expenses** ledger (`business_expenses`) — every card/bank charge
classified into CEO buckets. Ledger writes **auto-rollup** these keys into `business_metrics`.
See [`docs/EXPENSES.md`](./EXPENSES.md). Manual Edit inputs still works as an override / bootstrap.

**Canonical input keys** (`BUSINESS_METRIC_KEYS` in `src/lib/business-metrics.ts`):

| `metric_key` | Meaning |
|--------------|---------|
| `marketing_spend` | Agency client-acquisition spend for the month (= sum of `ceo_bucket = cac` when rolled from ledger) |
| `operating_expenses` | Total company P&L expenses for the month (= `cac` + `fulfillment` + `overhead` from ledger) |
| `delivery_costs` | Cost to deliver client work / COGS (= sum of `ceo_bucket = fulfillment`) |
| `cash_balance` | Cash on hand at month end |
| `headcount` | Team headcount |

**Ledger → metrics rollup:** Runs automatically after create / edit / delete / categorize /
exclude / CSV import / payroll post / apply-rules. Manual refresh: `POST /api/expenses/rollup`
with `{ month: "YYYY-MM" }`. Excludes `personal`, `owner_draw`, `passthrough`, `uncategorized`,
and any row with `exclude_from_pnl` (excluded charges must not appear in any KPI total).

**Derived metrics:**

| KPI | Formula | Needs |
|-----|---------|-------|
| **CAC** | `marketing_spend ÷ signed closes` | `marketing_spend` + acquisition closes |
| **ROAS** (new cash) | `New Cash Collected ÷ marketing_spend` | `marketing_spend` |
| **LTV** | `ARPA × avg tenure (× gross margin if known)` | portfolio (live) |
| **LTV : CAC** | `LTV ÷ CAC` | `marketing_spend` |
| **CAC Payback** | `CAC ÷ (ARPA × gross margin)` | `marketing_spend` |
| **Gross Margin** | `(Total Cash − delivery_costs) ÷ Total Cash` | `delivery_costs` |
| **Operating Profit** | `Total Cash − operating_expenses` | `operating_expenses` |
| **Profit Margin** | `Operating Profit ÷ Total Cash` | `operating_expenses` |
| **Net Burn / Runway** | `cash_balance ÷ (operating_expenses − Total Cash)` | `cash_balance` + `operating_expenses` |
| **Rule of 40** | `annualized MRR growth % + profit margin %` | `operating_expenses` |
| **Revenue / Head** | `(Active MRR × 12) ÷ headcount` | `headcount` |
| **Quick Ratio** | `(New + Expansion MRR) ÷ (Lost + Contraction MRR)` | snapshots help expansion |

Read/write the inputs via `GET|POST /api/business/metrics` (`ceo`-guarded). An import job can POST the
same body (`{ metric_key, month, value_numeric }`) to backfill history; the route upserts per
`(metric_key, period_date, dimension)`. The **Acquisition & Profit Trend** chart appears automatically
once any month carries `marketing_spend` or `operating_expenses`.

### Data hygiene (keeps these KPIs automatic)

The accuracy of the Business view depends on a small, consistent billing/lifecycle convention:

1. **Tag every billing's segment.** Set `revenue_segment` to `front_end` (new-client cash: setup, PIF, first contract) or `back_end` (ongoing retainer) on each `client_billings` row, and set `revenue_type` (`mrr` / `pif` / `performance` / `passthrough`). New Cash reads `front_end`; the New-Logo Cash cross-check works even if a row is mis-tagged. Mixed ad-spend on a retainer invoice must set `passthrough_amount` (or use a separate `passthrough` row).
2. **Record cash when it lands.** Fill `paid_on` and `amount_paid` so cash-collected KPIs match the bank. Refunds: clear paid fields or mark `refunded`.
3. **Churn through lifecycle (roster), not billing.** Lost MRR comes from status history + `churned_at`. Keep `clients.mrr` current **before** the status change so `mrr_at_change` stamps correctly. Extensions / late charges do **not** change lifecycle.
4. **Snapshot monthly.** `GET /api/business/snapshot?run=1` (Vercel cron on the 1st) freezes the **prior** month’s end-of-month roster into `client_monthly_snapshots`. Check health with `GET /api/business/snapshot` (no `run` param).

### Month-close checklist (CEO books)

1. Clear Finance → Expenses **Pending** (`uncategorized`) for the month.
2. Confirm one expense source of truth (sheet **or** bank; payroll not double-posted).
3. Confirm Overview OpEx / CAC / COGS match the ledger (auto-rolled; optional **Refresh KPIs**).
4. Reconcile **New cash** vs **New-logo cash** vs acquisition **signed closes**.
5. Confirm roster churn catch-up (`churned_at` / off_boarding) before trusting Lost MRR.
6. Confirm prior-month snapshot healthy (`/api/business/snapshot`).

**Code references:** `src/lib/business-metrics.ts` (engine), `src/app/api/business/route.ts` (API), `src/app/api/business/snapshot/route.ts` (monthly snapshot writer), `src/components/CeoDashboard.tsx` (UI).
