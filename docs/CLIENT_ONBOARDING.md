# Client Onboarding (Mr. Waiz)

Mr. Waiz (Supabase `clients` table) is the **source of truth** for client data. GHL handles the closer New Client form and outbound comms. Make.com orchestrates Slack, emails, and ClickUp **tasks only** (no field mirroring to ClickUp).

Onboarding writes target the ClickUp onboarding task, not the retired
Client Hub task. Store that pointer explicitly on the client record as
`clients.onboarding_clickup_task_id`. Keep `clients.clickup_task_id` only
as legacy Client Hub history unless a later migration deliberately
renames it. New onboarding code must not write `clickup_task_id`.

## Flow overview

| Step | Who | Where | Mr. Waiz effect |
|------|-----|-------|-----------------|
| 1. New Client | Closer | GHL form → Make → `POST /api/admin/onboard` | `lifecycle_status: new_account`, signing billing, sales call, ClickUp task |
| 2. Onboarding | Client | `/onboard` (static link in GHL emails) | Match by email/phone → update client; else unmapped queue |
| 3. Kickoff | CS manager | Kick-Off wizard in Client Roster | Ops fields + PM brief (JSON audit) |
| 3b. Launch Kit | CSM | **Kit** wizard in Client Roster | Branded client PDF → Storage, `launch_kit` submission, Slack links |
| 3c. Virtual Card | CS / ops | **Card** wizard in Client Roster / File | `loanofficer.me/{slug}` + `/learn`; URL on `clients.virtual_business_card_url` |
| 3e. Landing page | CS / ops | **Landing** on Client File (DSCR only) | Pull request into `gwadawg/dscr-experts`. URLs written after the live page responds |
| 3d. Tech / Media / Creative QA | Tech VA / Media Buyer / Creative | QA wizards in Client Roster / File | `tech_qa` / `marketing_qa` / `creative` submission + ClickUp fact `Complete` |
| 4. Launch | Ops | Launch checklist wizard | `lifecycle_status: active`, `launch_date`, Slack via Make |

**Scheduled CS calls** (onboarding / launch / check-in calendars from GHL Client Success) sync via Make into `cs_appointments` and show on Ops Overview + Client Roster/File. See [`docs/CS_APPOINTMENTS.md`](CS_APPOINTMENTS.md).

## 1. New Client (GHL + Make)

1. Closer submits **GHL New Client Form** after payment.
2. **Make.com** creates ClickUp onboarding task, then Slack channel.
3. **Make.com** calls `POST /api/admin/onboard` **last** — single write with contact fields + both IDs.
4. Mr. Waiz upserts client (`lifecycle_status: new_account`); links `onboarding_clickup_task_id` and `slack_id` (no duplicate ClickUp task when ID is sent).

Blueprint: [`make-blueprints/ccm-new-client-onboard.blueprint.json`](../make-blueprints/ccm-new-client-onboard.blueprint.json)  
Make SOP: [`make-blueprints/MAKE_NEW_CLIENT.md`](../make-blueprints/MAKE_NEW_CLIENT.md)

### Step 1 field mapping

| GHL / Make | Payload field | `clients` / notes |
|------------|---------------|-------------------|
| Client name (person) | `primary_contact_name` | `primary_contact_name`, `primary_contact` |
| *(derived)* | — | `name` = person name until kickoff sets GHL sub-account name |
| Email | `email` | `email`, `billing_email` |
| Phone | `phone` | `phone` |
| Date signed | `date_signed` | `date_signed` |
| ClickUp onboarding task id | `onboarding_clickup_task_id` | `onboarding_clickup_task_id`; required for all onboarding ClickUp writes |
| Slack channel id | `slack_id` | `slack_id` |
| GHL contact id (CS) | `ghl_contact_id` | `ghl_contact_id` |
| **Offer Type** (RM · DSCR · HE) | `reporting_type` | `reporting_type` + `offer` (HE → `CALL_CENTER`) |
| **Offer** (Call Center · Leads Only) | `sales_package` | `sales_package` (`core_offer` / `mid_offer`) |
| Appointment Watch (Yes/No) | `appointment_watch` | `appointment_watch` |
| Daily adspend | `daily_adspend` | `daily_adspend` |
| Google Drive folder | `drive_folder_url` | `drive_folder_url` |
| Agreed Offer Terms | `offer_summary` | `offer_summary` |
| Custom ads | `custom_ads` | `client_notes` (internal) |
| Onboarding setup breakdown | `onboarding_setup` | `client_notes` (internal) |
| Notes on client | `notes` | `client_notes` (internal) |

### Recommended Make payload (after ClickUp + Slack modules)

```json
{
  "primary_contact_name": "{{1.name}}",
  "lifecycle_status": "new_account",
  "email": "{{1.email}}",
  "phone": "{{1.phone}}",
  "date_signed": "{{1.date_signed}}",
  "onboarding_clickup_task_id": "{{2.id}}",
  "slack_id": "{{3.id}}",
  "ghl_contact_id": "{{1.contact_id}}",
  "reporting_type": "{{1.offer_type}}",
  "sales_package": "{{1.offer}}",
  "appointment_watch": "{{1.appointment_watch}}",
  "daily_adspend": "{{1.daily_adspend}}",
  "drive_folder_url": "{{drive.webViewLink}}",
  "offer_summary": "{{1.offer_summary}}",
  "custom_ads": "{{1.custom_ads}}",
  "onboarding_setup": "{{1.onboarding_setup}}",
  "notes": "{{1.notes}}"
}
```

Do **not** send GHL sub-account name at sign-up — kick-off sets `clients.name` later.

**Retire in Make:** ClickUp custom-field updates that mirror client data (tasks/status only). See [`MAKE_NEW_CLIENT.md`](../make-blueprints/MAKE_NEW_CLIENT.md).

**Optional env:** `CLICKUP_AUTO_CREATE_ON_ONBOARD=false` when Make always sends `onboarding_clickup_task_id`.

## 2. Client onboarding form

**Public URLs** (also listed under Resources / Forms via `src/lib/internal-forms.ts`):

| Offer | Path | Notes |
|-------|------|--------|
| Core / RM (default) | `/onboard` | Universal link in GHL onboarding emails for non-DSCR-performance closes |
| DSCR performance | `/onboard/dscr` | Same Mr. Waiz match pipeline; Leads vs Conversations + CRM (Leads only). Design: [`docs/superpowers/specs/2026-08-11-dscr-performance-onboarding-form-design.md`](superpowers/specs/2026-08-11-dscr-performance-onboarding-form-design.md) |

**Example:** `https://<your-app>/onboard` or `https://<your-app>/onboard/dscr`

Clients enter email + phone (required for matching), licensed states, business info, address, and optional headshot.

- **1 match** → fields applied to `clients`, `new_account` → `onboarding`, then **GHL tag** + **ClickUp comment** + **Slack ops alert**. GHL/ClickUp only run when matched.
- **0 or 2+ matches** → `client_form_submissions` row with `status: unmapped`; **Slack ops alert** explains the match failure. Resolve in **Client Roster → Unmapped onboarding forms** — linking to a client then triggers GHL + ClickUp.

### Team member invite (unique per client)

Primary onboarding stays on the universal `/onboard` link. For additional users (LOA / Co-LO / other), use the **unique team invite** on Client File → Contacts:

- **Copy link** generates (or returns) `clients.team_invite_token` → `/onboard/team/<token>`
- Submit writes directly to `client_contacts` for that client (no email/phone matching)
- **Rotate** invalidates the old token and copies a new URL

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/clients/[id]/team-invite` | Admin session | Ensure token + return URL |
| `POST /api/clients/[id]/team-invite` `{ rotate: true }` | Admin session | Rotate token |
| `GET/POST /api/onboard/team` | Public (token) | Prefetch + submit team member form |

### Onboarding complete side effects (direct API)

When a matched client submits `/onboard`, Mr. Waiz:

1. **GHL** — updates the CS contact (`ghl_contact_id`) with OB fields for subaccount/user setup, then adds tag `OB Form Filled` (triggers GHL automations / emails).
2. **ClickUp** — posts a formatted comment on `onboarding_clickup_task_id` with all OB answers. Optionally updates task status (`CLICKUP_OB_TASK_STATUS`) and custom fields (`CLICKUP_OB_FIELD_MAP` JSON).

**GHL CS contact fields written (partial update — does not clear unrelated fields; does not overwrite name / email / phone):**

| OB source | GHL target |
|-----------|------------|
| `street_address` (if set) | standard `address1` |
| `city` | standard `city` |
| `state` | standard `state` |
| `zip_code` (if set) | standard `postalCode` |
| `ob_role` | custom `own_the_company` — exact `MLO For Brokerage/Lender` / `Owner of Brokerage/Lender` |
| `brokerage_name` | standard `companyName` |
| `company_nmls` | custom `company_nmls` (owner only) |
| `website` | custom `company_website` (owner only) |
| `additional_members` | custom `other_user_information` (`{label}: {value}` rows; omitted if none) |

Unmapped submissions skip GHL until linked in **Unmapped onboarding forms**.

**Create client GHL subaccount (Make):** after OB fields are on the CS contact, fire the CS→Make webhook to create the location from the DSCR / RM snapshot and invite the primary user. See [`make-blueprints/MAKE_GHL_SUBACCOUNT.md`](../make-blueprints/MAKE_GHL_SUBACCOUNT.md).


**Required env (Railway):**

| Variable | Purpose |
|----------|---------|
| `GHL_CS_API_TOKEN` or `GHL_API_TOKEN` | Private Integration Token with contacts write / tags |
| `GHL_CS_LOCATION_ID` | Waiz CS location — same for all clients (`ShWJuggoS02PZidEL4HK`) |
| `CLICKUP_API_TOKEN` | Required in Railway for onboarding ClickUp comments, custom-field writes, and future replay actions |

**Optional env:**

| Variable | Purpose |
|----------|---------|
| `GHL_CS_OB_FIELD_MAP` | JSON overrides for custom field IDs (defaults baked in for CS location) |
| `CLICKUP_OB_TASK_STATUS` | ClickUp status name after OB submit (e.g. `ob form received`) |
| `CLICKUP_OB_FIELD_MAP` | JSON map of field keys → typed ClickUp field config; legacy `key: "field_uuid"` still works for text fields |

Step 1 must store `ghl_contact_id` on the client (see Make payload above). Without it, GHL tag + field sync are skipped. CS location is global via `GHL_CS_LOCATION_ID` on Railway — not stored per client.

Step 1 must also store `onboarding_clickup_task_id` on the client. Without
it, onboarding comments, custom-field writes, calendar joins, and replay
actions do not have a task target.

### ClickUp write policy

ClickUp custom fields are for operational facts only — values the board
uses for routing, filtering, or automations. Full form answers stay in
`client_form_submissions.responses` and are posted to the ClickUp task as
comments when helpful.

Do not mirror large form-answer sets such as biography, address, licensed
states, brokerage notes, PM brief, launch checklist details, or transcripts
into ClickUp custom fields unless that value is needed for a ClickUp
automation or saved view.

Planned fact fields:

| Source | ClickUp fields |
|--------|----------------|
| New Client | `Offer` and `Deliverable` on the onboarding task. `Mr. Waiz` URL, initial `OB Stage`, `OB Form`, and `OB Call` stay on the template until those fields are mapped |
| GHL CS appointment sync | `OB Call = Booked`, `OB Call Date` |
| Onboarding Form | `OB Form = Filled` |
| Kickoff Form | `kickoff_form` = `Submitted` and `ob_stage` = `In Build`. Does not set Launch Call Date. |
| Tech QA Form | `Tech QA = Complete` |
| Marketing QA Form | `Marketing QA = Complete` |
| Creative QA Form | Add `creative_qa` to `CLICKUP_OB_FIELD_MAP`. Submit sets that field to `Complete` and posts a comment. `creative` is accepted only if `creative_qa` is absent. |
| Launch Form | `launch_form` = `Submitted`. ClickUp automation owns Launch Gate. Mr. Waiz does not set it. |

Use `CLICKUP_OB_FIELD_MAP` for live ClickUp field IDs and dropdown option
UUIDs. Keep IDs in Railway, not hardcoded in code.

### QA skeleton forms

Added 2026-09-29 as automation skeletons, not final SOP-derived QA.

| Form | Route | Stored `form_type` | ClickUp field key | ClickUp value |
|------|-------|--------------------|-------------------|---------------|
| Tech Setup QA | `/api/clients/[id]/qa/tech_setup` | `tech_qa` | `tech_qa` | `Complete` |
| Media Buying QA | `/api/clients/[id]/qa/media_buying` | `marketing_qa` | `marketing_qa` | `Complete` |
| Creative QA | `/api/clients/[id]/qa/creative` | `creative` | `creative_qa` (`creative` only if `creative_qa` is absent) | `Complete` |

Creative QA is a third form. It does not change the Media Buying QA checklist.
Creatives and Funnel lines are confirm checkboxes. A line left unchecked is
omitted from `responses.checklist` and is not stored as no. Funnel link rows
stay links: Perspective funnel link is editable and stored on
`clients.landing_page_url`. Apex funnel link is read-only, auto-mapped as
`{site}/{slug}/` from the published landing page. Thank-you link is read-only
from `clients.thank_you_page_url` (`{site}/{slug}/thank-you`).

The landing publish already writes that same `{site}/{slug}/` Apex URL onto
`clients.landing_page_url`, which is also the Perspective funnel link column.
Both rows share that column. Creative QA does not add a column and does not
write the Apex URL onto `clients.funnel_url`.

Add `creative_qa` to `CLICKUP_OB_FIELD_MAP`. Submit sets that onboarding
custom field to `Complete` and posts a comment. If `creative_qa` is missing
and `creative` is present, submit uses `creative`. Submit fails before the
submission row when the key, the onboarding task, or the token is missing.
It does not change ClickUp status or post to Slack. Run
`supabase/migrations/add_creative_qa_form_type.sql` so submissions accept
`creative`.

These forms are client-scoped admin wizards opened from Client Roster or
Client File. They do not create per-client form definitions. One shared
config in `src/lib/qa-form.ts` is reused for every client. The submitted
answers are saved in `client_form_submissions.responses` with
`skeleton_version = qa-skeleton-v0`. When a ClickUp field is written, the
onboarding task also receives a comment with the checklist evidence.

QA actions only appear while `lifecycle_status` is `new_account` or
`onboarding`. A reinstate starts a new QA cycle. ClickUp writes go only to
`clients.onboarding_clickup_task_id` — never the retired Client Hub task.

Tech QA, Media Buying QA, and Creative QA fail before writing the submission
when `onboarding_clickup_task_id`, `CLICKUP_API_TOKEN`, or the matching
`CLICKUP_OB_FIELD_MAP` key is missing. Creative QA's key is `creative_qa`.
None of the QA forms change ClickUp status or post to Slack.

Run `supabase/migrations/add_onboarding_qa_form_types.sql` so
`client_form_submissions` accepts `tech_qa` and `marketing_qa`.

Replace the skeleton checklist content later from the Tech/A2P and
Media Buying/Funnel SOP done-definitions. Keep the write contract the
same unless the ClickUp field architecture changes.

After `POST /api/admin/onboard` stores `onboarding_clickup_task_id`, Mr. Waiz
writes two dropdowns on that task:

| Payload | Stored code | ClickUp field | Option label |
|---------|-------------|---------------|--------------|
| `reporting_type` RM / DSCR / HE | `RM` / `DSCR` / `CALL_CENTER` | `offer` | `RM` / `DSCR` / `HE` |
| `sales_package` Call Center / Leads Only | `core_offer` / `mid_offer` | `deliverable` | `Call Center` / `Leads Only` |

Make creates the task and does not set these dropdowns. A key missing from
`CLICKUP_OB_FIELD_MAP` is skipped. Add `offer` and `deliverable` next to
the existing `ob_form` entry.

### Phase 1 implementation packet

Implemented in code on 2026-09-29:

1. Add `clients.onboarding_clickup_task_id` to the Supabase schema and a
   partial unique index for non-null values.
2. Update `src/lib/onboard-client.ts` to parse
   `onboarding_clickup_task_id`, match existing clients by it, store it,
   return it, and use it for ClickUp auto-create fallback. During
   migration only, a read fallback to `clickup_task_id` is acceptable for
   old rows; new writes go only to `onboarding_clickup_task_id`.
3. Update `src/lib/onboarding-side-effects.ts` so comments, custom-field
   writes, and replay actions target `onboarding_clickup_task_id`.
4. Update `src/lib/cs-appointments.ts` to accept
   `onboarding_clickup_task_id` from Make/GHL and join clients on
   `clients.onboarding_clickup_task_id`.
5. Update Client File / Client Roster UI labels from generic “ClickUp
   task” to “ClickUp onboarding task” wherever the onboarding pointer is
   shown or edited.
6. Support typed `CLICKUP_OB_FIELD_MAP` entries for dropdowns, dates,
   labels, numbers and text fields.

Still required before production proof:

- Run `supabase/migrations/add_onboarding_clickup_task_id.sql`.
- `CLICKUP_API_TOKEN` is already set in Railway (owner, 2026-09-30).
  Local `.env.local` does not have it. Do not re-add it from a local file.
- Set `CLICKUP_CLIENT_HUB_LIST_ID` to the onboarding list ID in Railway.
- Export live onboarding list field IDs and option UUIDs, then populate
  `CLICKUP_OB_FIELD_MAP`. Example: `{ "ob_form": { "id": "field_uuid",
  "type": "dropdown", "options": { "Filled": "option_uuid" } } }`.
- Update/import Make scenarios so they send `onboarding_clickup_task_id`.

Proof test: use a test onboarding task, have Mr. Waiz set one safe
ClickUp fact field through the API, confirm the ClickUp automation fires,
then submit or replay one onboarding form and confirm the comment lands on
the same task.

### Storage

Create a public Supabase Storage bucket `client-headshots` for headshot uploads.

### Make webhook (legacy — optional)

`MAKE_ONBOARDING_COMPLETE_WEBHOOK_URL` is **no longer used** for onboarding complete. GHL + ClickUp are updated via direct API. You may remove the Make scenario if it was only for OB confirmation.

## 3. Kickoff (CS manager)

Open **Kick-off** from Client Roster after the OB call. Confirms client info, captures GHL location ID + sub-account name, PM landing-page brief (stored in `client_form_submissions`, not `clients` columns).

### Account setup (client file)

Collected on the onboarding call. The kickoff form writes them once. If Team or Brand changes later, update the client file. Do not treat the old kickoff submission as the current setup. The kickoff form does not write these columns yet.

| Field | Column | Values |
|-------|--------|--------|
| Brand | `brand_subject` | `client` (Client name) · `company` (Company). Whose name the ads and funnel use. |
| Team | `account_shape` | `solo` · `team` |
| Lead routing | `team_routing_notes` | Free text. Shown only when Team. Who receives each lead and how it is split. |
| We qualify leads | `qualifies_leads` | `true` / `false` / null |
| How we qualify | `qualification_notes` | Free text. Shown only when Yes. |

Run `supabase/migrations/add_client_launch_setup.sql` before editing these on an existing database.

## 3b. Launch Kit (CSM)

The Launch Kit is the client's leave-behind from the Launch Call: a branded PDF covering what is live, how to run Week 1, and where every file lives. Process owner and copy source of truth: Wm-os `docs/client-fulfillment/onboarding/sop-client-launch-kit.md` + `docs/templates/client-launch-kit-template.md`. Mr. Waiz is the execution surface.

Open **Kit** from Client Roster once kickoff is complete (available for `new_account`, `onboarding`, and `active` so a kit can be regenerated after go-live).

### Variant matrix

The PDF is deterministic — no AI, no free-form copy. Only per-client fields are substituted. Two axes pick the pages:

| Axis | Source | Values |
|------|--------|--------|
| Product | `clients.reporting_type` | `rm` (Reverse mortgage) · `dscr` |
| Who works leads | `clients.service_program` | `core` → **Call Center** (Waiz dials) · `lead_gen` → **Leads Only** (client dials; gets playbooks) |

`CALL_CENTER` clients prefill "Waiz" and require the CSM to choose the product. Both can be overridden in step 1 of the wizard.

### Wizard steps

1. **Variant** — product, who works leads, contact first name, company / DBA, go-live date, plus on-file snapshot (NMLS, states licensed). Company, contact, go-live, NMLS, and states licensed fill from the client file when those columns are already set. NMLS and states licensed do not write back.
2. **What's live** — WM Apex Funnel, CRM, Launch Kit Drive folder, Slack channel name, plus a **Please review** block (legal notice, Go High Level number, live transfer number, optional notification number, virtual business card, Facebook page). Every URL must be a full `http(s)` link or explicitly marked *Not part of this account* / declined (funnel and CRM can never be N/A). The notification number can be left blank when it is the same as the live transfer number. Client-file columns fill the form when they are already set, and they win over an older kit draft. Generate writes back funnel, CRM, the three phone numbers, and the virtual business card. Legal notice and Facebook stay on the kit. `[TO FILL]` is rejected at generate.
3. **Operator setup** — CSM name, who works leads (sentence subject), speed standard *as sold* (blank → kit says "as sold on your Kickoff" instead of inventing a number), internal notes.
4. **Resources** — lead logging form, plus client playbooks from the Resource Library (`client_playbook` only). Manual links stay available for a file that is not in the library yet.
5. **Review & generate** — intake table, blocking errors, version list with **Download** and **Send to client**.

**Save draft** stores a `client_form_submissions` row with `status: draft`; reopening the wizard resumes from it. Drafts are dismissed once a kit is generated.

### On generate

- Renders with `@react-pdf/renderer` (server-side, Node — no Chromium). Template copy lives in `src/lib/launch-kit/copy/` with `TEMPLATE_VERSION`; edit Wm-os first, then mirror here and bump the version.
- Uploads to the private bucket **`client-launch-kits`** at `{client_id}/{slug}-launch-kit-v{n}.pdf`. Every generate is a new version; nothing is overwritten.
- Inserts `client_form_submissions` (`form_type: launch_kit`, `status: applied`) with the intake, `storage_path`, `version`, `template_version`, and `variant`.
- Changed funnel, CRM, Go High Level number, live transfer number, notification number, and virtual business card values are written back to `clients` (`applied_patch`).
- Posts to the **ops** team channel (`SLACK_OPS_CHANNEL_SLUG`) with an app link + 7-day signed download URL, and to the `mrwaiz` activity feed.
- Does **not** post to the client. Drive upload is manual: CSM downloads → drops into `{Client Drive}/Launch Kit/01-Launch-PDF/`.

### Send to client

**Send to client** (per version) posts a 7-day signed link + the Launch Kit folder link to `clients.slack_id`. Done by the CSM on the Launch Call, never automatically. Stamps `sent_to_client_at` on the submission. Requires the client channel to be mapped in Admin → Automations.

### Launch checklist gate

The Launch wizard shows a non-blocking notice when no kit exists. It does not prevent go-live.

## 3c. Virtual Business Card (CS / ops)

Per-client mobile card on **loanofficer.me/{slug}** plus educate page at **/{slug}/learn**. No Waiz branding on public pages. Stock RM / DSCR layouts and style packs (frozen demos in Wm-os `demos/rm-loanofficer-templates` + `demos/dscr-loanofficer-templates`).

Open **Card** from Client Roster actions or Client File (shows **✓** when published). Soft kickoff warning only — does not hard-block.

### Wizard steps

1. **Identity** — slug, name, title, company, NMLS, states, phone (prefill from `clients.phone_ghl` — our GHL prospecting number), email, headshot URL, optional value line.
2. **Product & style** — RM or DSCR + one of four style packs.
3. **Links** — booking calendar **Needed / Not needed** (required URL only when Needed; prefills Launch Kit `calendar_url` when present). Educate `/learn` always on; optional LO note.
4. **Review & publish** — mobile preview → Save draft / Publish. After publish: card URL, learn URL, SMS snippet, QR image.

### On publish

- Inserts `client_form_submissions` (`form_type: virtual_card`, `status: applied`) with the full card payload.
- Writes `clients.virtual_card_slug` + `clients.virtual_business_card_url` (roster field **Virtual Business Card**).
- Sets form progress `virtual_card` when an applied submission exists.
- Public pages read published payload by slug (Paul Scheper remains a hardcoded fallback until republished).

### Team outputs to send

| Output | Example |
|--------|---------|
| Card URL | `https://loanofficer.me/paul-scheper` |
| Educate | `https://loanofficer.me/paul-scheper/learn` |
| SMS | `Hi — here's Paul's contact card: https://loanofficer.me/paul-scheper` |
| QR | Generated from card URL (copy image URL from wizard) |

Run migration `supabase/migrations/add_virtual_card.sql` before first publish.

## 3e. Landing page (CS / ops, DSCR only)

Stock DSCR page on `https://dscrexperts.com/{slug}/`, opened from
**Landing** on Client File. Not shown for reverse mortgage or call center.
The form publishes a pull request to `gwadawg/dscr-experts`. A person
merges it. Mr. Waiz writes `landing_page_url` and `thank_you_page_url`
only after that URL responds.

The first publish stays out of search (`preview`). Launch needs a second
publish with search indexing on. Design and build order:
[`2026-10-06-client-landing-builder-design.md`](superpowers/specs/2026-10-06-client-landing-builder-design.md)
and
[`2026-10-07-client-landing-builder.md`](superpowers/plans/2026-10-07-client-landing-builder.md).

## 4. Launch checklist
Open **Launch** from Client Roster when kickoff is complete. The wizard is a 4-department checklist (18 items). Checklist answers live in `client_form_submissions.responses` JSON. On submit the form also writes `clients.phone_ghl` (Go High Level prospecting number) plus lifecycle / launch date.

If the client has a built landing page, republish it from Client File
with search indexing on before ads go live. The wizard does not block
on that republish.

### Departments

**Media Buying**
- Headline / primary text aligned with creative message
- Correct states are being targeted
- Correct budget is set
- Campaign scheduled for launch at midnight *(type yes)*
- Correct funnel is in the ad and tested funnel is live correctly

**Funnel**
- Funnel headline congruent to ad message / angle
- Split test between two headlines is on
- Pixel data working with correct conversion event *(type yes)*
- GHL subaccount correctly integrated
- Privacy policy and compliant footer added
- Compliant checkbox for sending SMS with client's name

**GHL Subaccount**
- Client info NOT updated — client assigned user with HP tag *(type yes)*
- Custom values all filled out
- Calendar assigned to correct user
- A2P approved *(type yes)*

**Admin**
- Mr. Waiz and ClickUp fields fully filled out
- Make scenario for Facebook is active
- Full test lead executed: perspective → SMS → AI booking → appointment booked *(type yes)*

### Confirmation rules

- **Go High Level number**: required text field — the subaccount number we prospect with (saved to `clients.phone_ghl`, used on the virtual card)
- Routine items: checkbox only
- Critical items (marked *type yes* above): rep must type `yes` and check the box
- Final gate: rep types `LAUNCH` before submit
- **Completed by** dropdown: required; lists users with Client Roster or Billing access

### On complete

- `lifecycle_status → active`, `launch_date` set, `phone_ghl` saved, launch call logged
- **ops-alerts** Slack channel: full department audit (configure slug in Automations; default `ops_alerts` via `SLACK_OPS_CHANNEL_SLUG`)
- **Client Slack channel** (`clients.slack_id`): short go-live announcement
- Make webhook fallback if Slack is unavailable: `MAKE_LAUNCH_COMPLETE_WEBHOOK_URL`

Blueprint: [`ccm-launch-complete.blueprint.json`](../make-blueprints/ccm-launch-complete.blueprint.json)

## Slack channel IDs (Automations tab)

**Dashboard → Admin → Automations** is where ops manages Slack channel IDs for future automations and Make scenarios.

| Channel type | Storage | How it gets set |
|--------------|---------|-----------------|
| Per-client | `clients.slack_id` | Make onboarding creates the channel and sends the ID on `POST /api/admin/onboard`; editable in Automations tab |
| Internal team | `slack_channels` table | Added manually in Automations tab (slug + label + channel ID) |

Suggested team channel slugs: `ops_alerts`, `client_success`, `billing`, `setters`. Reference these slugs in future automations or Make payloads.

`notification_automations` table exists for phase 2 (event → channel routing). No triggers are wired yet.

### Automations API

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET/POST /api/slack/channels` | `admin_automations` | List / create team channels |
| `PATCH/DELETE /api/slack/channels/[id]` | `admin_automations` | Update / delete team channel |
| `GET/PATCH /api/slack/client-channels` | `admin_automations` | List / update per-client `slack_id` |
| `GET /api/slack/automations` | `admin_automations` | Read-only automation stubs (phase 2) |

Grant the **Automations** tab in **Admin → Users** so ops can manage channel IDs without full Client Roster access.

## Audit trail

**Client File → Onboarding forms** shows every submission (type, date, submitter, expandable answers).

Roster shows progress strip: Sign | OB | KO | Kit | Live. Launch Kit rows in Client File → Forms & history include a **Download Launch Kit PDF** link.

## API reference

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/admin/onboard` | Bearer `ADMIN_WEBHOOK_SECRET` | New client from Make |
| `PATCH /api/admin/clients/[id]` | Bearer `ADMIN_WEBHOOK_SECRET` | `slack_id`, integration fields |
| `POST /api/onboard/submit` | Public | Client onboarding form |
| `GET/POST /api/onboard/team` | Public (token) | Team member invite form |
| `GET/POST /api/clients/[id]/team-invite` | Admin session | Copy / rotate team invite URL |
| `GET/POST /api/form-submissions/pending` | Admin session | Unmapped OB queue |
| `POST /api/clients/[id]/kickoff` | Admin session | Kickoff wizard |
| `GET/POST /api/clients/[id]/qa/tech_setup` | Admin session (`admin_clients` / `admin_billing`) | Tech Setup QA skeleton |
| `GET/POST /api/clients/[id]/qa/media_buying` | Admin session (`admin_clients` / `admin_billing`) | Media Buying QA skeleton |
| `GET/POST /api/clients/[id]/launch-kit` | Admin session (`admin_clients` / `admin_billing`) | Prefill + versions / `{ mode: 'draft' \| 'generate', draft }` |
| `POST /api/clients/[id]/launch-kit/send` | Admin session | Post a kit version to the client Slack channel |
| `GET /api/clients/[id]/launch-kit/download?submission=` | Admin session (+ `client_health`) | Redirect to a fresh 15-min signed URL |
| `POST /api/clients/[id]/launch` | Admin session | Launch checklist |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_WEBHOOK_SECRET` | Yes | Onboard + admin integration routes |
| `CLICKUP_API_TOKEN` | Yes for onboarding ClickUp writes | Comments, custom-field writes, replay actions, and task creation fallback |
| `MAKE_ONBOARDING_COMPLETE_WEBHOOK_URL` | No | GHL confirmation email trigger |
| `MAKE_LAUNCH_COMPLETE_WEBHOOK_URL` | No | Launch go-live fallback when Slack unavailable |
| `SLACK_OPS_CHANNEL_SLUG` | No | Team channel for launch audit + Launch Kit notices (default `ops_alerts`) |
| `SLACK_BOT_TOKEN` | For Launch Kit Slack posts | Existing bot; no new scopes needed (`chat:write` only — links, not file uploads) |

### Launch Kit storage

Run `supabase/migrations/add_launch_kit_form_type.sql` — adds the `launch_kit` form type and creates the private `client-launch-kits` bucket (PDF only, 10 MB). `node scripts/verify-onboard-infra.mjs` checks both buckets.

## Decommission (ops)

1. Point GHL onboarding email link to `/onboard` (retire GHL OB form).
2. Remove Make modules that PATCH ClickUp client custom fields.
3. Retire external launch form; use Launch wizard only.
4. Keep ClickUp for OB task creation and optional status → Live on launch.

## Verification

1. Test New Client form → client row with `lifecycle_status: new_account` + `client_form_submissions` `new_client` row.
2. After Slack create → `slack_id` on client via PATCH.
3. Submit `/onboard` with matching email → client fields updated + `onboarding` submission.
4. Submit with unknown email → appears in unmapped queue; assign works.
5. Complete kickoff → `kickoff` submission in Client File.
6. Open Kit → generate → PDF in `client-launch-kits`, `launch_kit` submission, ops Slack post with download link; Send to client posts to `slack_id`.
7. Complete launch → `active`, launch date, Slack webhook fires.

## Reinstate / welcome-back

Run `supabase/migrations/add_client_reinstate.sql` before deploying.

Paid rejoins use the closer form at `/forms/reinstate` (not the New Client
GHL form). That writes `reinstated_at`, a winback `acquisition_closes` row
(`close_kind=reinstate`), and a per-client welcome-back token.

The closer name is stored only on `acquisition_closes.raw.closer_name` (and
`raw.close_kind=reinstate`). Do **not** put it in `setter_name` — that column
feeds setter metrics / payroll and would wrongly credit a setter.
Closer-stats credit winbacks from `raw.closer_name` when there is no demo/offer
appointment link (see `calculateCloserMetrics`).

Ops Slack gets the welcome-back URL after reinstate (forward to the client).
There is no client email send — copy the link from the form success screen or
Slack. Welcome-back tokens expire after **30 days**
(`welcome_back_token_created_at`); re-run reinstate to mint a new link.
ClickUp / client Slack channel / Meta map stay manual.

The client then completes **Welcome-Back Onboarding** at
`/onboard/welcome-back/[token]` (token-only; not a public universal link).
Client File shows a Reinstate badge plus welcome-back OB pending/done from
form progress, and CS can tick the reinstate checklist on that submission.

See the spec: [Client reinstate design][reinstate-spec].

[reinstate-spec]: superpowers/specs/2026-09-17-client-reinstate-design.md
