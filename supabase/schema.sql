-- Reporting Dashboard — Single Agency
-- Run this ONE file in: Supabase Dashboard > SQL Editor > New query
-- Creates all tables, columns, indexes, and triggers from scratch.
-- Safe to re-run (all statements use IF NOT EXISTS / CREATE OR REPLACE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profiles (team login)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id         uuid    primary key references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  -- Owner role: always unrestricted, the only role that bypasses permissions.
  is_owner   boolean not null default false,
  -- Legacy per-tab column (superseded by allowed_permissions).
  allowed_views jsonb,
  -- JSON array of permission keys (see src/lib/permissions.ts) this user may use,
  -- covering both views and future features. NULL = no restriction (unrestricted).
  allowed_permissions jsonb,
  created_at timestamptz default now()
);

alter table profiles add column if not exists allowed_views jsonb;
alter table profiles add column if not exists is_owner boolean not null default false;
alter table profiles add column if not exists allowed_permissions jsonb;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Clients (lead sources or service lines)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists clients (
  id               uuid    primary key default gen_random_uuid(),
  name             text    not null unique,
  is_live          boolean not null default true,
  reporting_type   text    not null default 'RM',
  ghl_location_id  text,
  share_token      text default encode(gen_random_bytes(16), 'hex'),
  team_invite_token text,
  created_at       timestamptz default now(),

  -- Lifecycle (mirrors ClickUp "Clients" list)
  lifecycle_status       text default 'active',
  client_stage           text,
  launch_date            date,
  date_signed            date,
  churned_at             timestamptz,
  reinstated_at          timestamptz,
  welcome_back_token     text,
  welcome_back_token_created_at timestamptz,
  last_status_changed_at timestamptz,

  -- Revenue / contract
  mrr                  numeric,   -- ClickUp "Monthly $"
  daily_adspend        numeric,
  billing_type         text,      -- monthly | pif | pif_monthly
  contract_term_months int,
  contract_end_date    date,

  -- Health
  cs_status text,
  ad_status text,

  -- Per-client KPI band overrides (Client Success). Sparse JSON:
  -- { kpi_key: { critical?, below?, at? } }. Missing -> DEFAULT_KPI_BANDS.
  kpi_benchmarks jsonb,

  -- Offer / identity
  offer               text,       -- RM | DSCR | CALL_CENTER (mirrors reporting_type)
  offer_summary       text,       -- brief ad/offer blurb for setter-facing directory
  service_program     text,       -- core (Call Center) | lead_gen (Leads Only); RM/DSCR only
  nmls                text,
  brokerage_name      text,
  legal_business_name text,
  business_type       text,
  website             text,
  funnel_url          text,
  source              text,
  biography           text,

  -- Contact
  primary_contact_name   text,
  email                  text,
  phone                  text,
  phone_ghl              text,
  phone_live_transfer    text,
  phone_notifications    text,
  live_transfer_approved boolean default false,
  appointment_watch      boolean,  -- dial appointments + live transfer (New Client Form)
  contact_role           text,
  appointment_settings   text,
  facebook_page_name     text,
  instagram_handle       text,
  ad_account_name        text,
  ad_account_url         text,
  thank_you_page_url     text,
  second_landing_page_url text,
  landing_page_url       text,
  slack_id               text,
  ghl_subaccount_url     text,

  -- Location
  street_address  text,
  city            text,
  state           text,
  zip_code        text,
  timezone        text,
  states_licensed text[],

  -- Sync key for a future ClickUp → Supabase import
  clickup_task_id text,
  -- ClickUp task used by the onboarding process
  onboarding_clickup_task_id text,

  constraint clients_reporting_type_check check (reporting_type in ('RM', 'DSCR', 'CALL_CENTER', 'HE'))
);

-- Additive columns (so re-running on an older clients table backfills them)
alter table clients add column if not exists lifecycle_status       text default 'active';
alter table clients add column if not exists client_stage           text;
alter table clients add column if not exists launch_date            date;
alter table clients add column if not exists date_signed            date;
alter table clients add column if not exists churned_at             timestamptz;
alter table clients add column if not exists reinstated_at          timestamptz;
alter table clients add column if not exists welcome_back_token     text;
alter table clients add column if not exists welcome_back_token_created_at timestamptz;
alter table clients add column if not exists last_status_changed_at timestamptz;
alter table clients add column if not exists mrr                    numeric;
alter table clients add column if not exists daily_adspend          numeric;
alter table clients add column if not exists billing_type           text;
alter table clients add column if not exists contract_term_months   int;
alter table clients add column if not exists contract_end_date      date;
alter table clients add column if not exists cs_status              text;
alter table clients add column if not exists ad_status              text;
alter table clients add column if not exists ads_paused             boolean not null default false;
alter table clients add column if not exists ads_paused_at          timestamptz;
alter table clients add column if not exists ads_paused_note        text;
alter table clients add column if not exists offer                  text;
alter table clients add column if not exists offer_summary          text;
alter table clients add column if not exists service_program        text;
alter table clients add column if not exists nmls                   text;
alter table clients add column if not exists brokerage_name         text;
alter table clients add column if not exists legal_business_name    text;
alter table clients add column if not exists business_type          text;
alter table clients add column if not exists website                text;
alter table clients add column if not exists funnel_url             text;
alter table clients add column if not exists virtual_card_slug      text;
alter table clients add column if not exists virtual_business_card_url text;
alter table clients add column if not exists source                 text;
alter table clients add column if not exists biography              text;
alter table clients add column if not exists primary_contact_name   text;
alter table clients add column if not exists email                  text;
alter table clients add column if not exists phone                  text;
alter table clients add column if not exists phone_ghl              text;
alter table clients add column if not exists phone_live_transfer    text;
alter table clients add column if not exists phone_notifications    text;
alter table clients add column if not exists live_transfer_approved boolean default false;
alter table clients add column if not exists appointment_watch      boolean;
alter table clients add column if not exists contact_role           text;
alter table clients add column if not exists appointment_settings   text;
alter table clients add column if not exists facebook_page_name     text;
alter table clients add column if not exists instagram_handle       text;
alter table clients add column if not exists ad_account_name        text;
alter table clients add column if not exists ad_account_url         text;
alter table clients add column if not exists thank_you_page_url     text;
alter table clients add column if not exists second_landing_page_url text;
alter table clients add column if not exists landing_page_url       text;
alter table clients add column if not exists slack_id               text;
alter table clients add column if not exists ghl_subaccount_url     text;
alter table clients add column if not exists street_address         text;
alter table clients add column if not exists city                   text;
alter table clients add column if not exists state                  text;
alter table clients add column if not exists zip_code               text;
alter table clients add column if not exists timezone               text;
alter table clients add column if not exists states_licensed        text[];
alter table clients add column if not exists clickup_task_id        text;
alter table clients add column if not exists onboarding_clickup_task_id text;
alter table clients add column if not exists ghl_contact_id         text;
alter table clients add column if not exists ghl_cs_location_id     text;
alter table clients add column if not exists performance_terms      text;
alter table clients add column if not exists billing_email          text;
alter table clients add column if not exists primary_contact        text;
alter table clients add column if not exists billing_day            smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_billing_day_check') then
    alter table clients add constraint clients_billing_day_check
      check (billing_day is null or (billing_day >= 1 and billing_day <= 31));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_lifecycle_status_check') then
    alter table clients add constraint clients_lifecycle_status_check check (
      lifecycle_status in ('new_account', 'onboarding', 'active', 'paused', 'off_boarding', 'churned')
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clients_billing_type_check') then
    alter table clients add constraint clients_billing_type_check check (
      billing_type is null or billing_type in ('monthly', 'pif', 'pif_monthly')
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clients_offer_check') then
    alter table clients add constraint clients_offer_check check (
      offer is null or offer in ('RM', 'HE')
    );
  end if;
end $$;

create unique index if not exists clients_clickup_task_id_key
  on clients (clickup_task_id) where clickup_task_id is not null;

create unique index if not exists clients_onboarding_clickup_task_id_key
  on clients (onboarding_clickup_task_id) where onboarding_clickup_task_id is not null;

create unique index if not exists clients_ghl_contact_id_key
  on clients (ghl_contact_id) where ghl_contact_id is not null;

alter table clients
  add column if not exists reporting_type text not null default 'RM';

-- Per-client KPI band overrides (Client Success). See src/lib/client-health.ts.
alter table clients
  add column if not exists kpi_benchmarks jsonb;

-- Governance for the benchmark overrides above: who set them, when, and why, plus
-- a basis for a >90-day staleness flag so per-client bars can't silently rot to green.
alter table clients add column if not exists kpi_benchmarks_updated_at timestamptz;
alter table clients add column if not exists kpi_benchmarks_updated_by uuid references auth.users(id) on delete set null;
alter table clients add column if not exists kpi_benchmarks_note text;

update clients
  set reporting_type = 'RM'
  where reporting_type is null or reporting_type not in ('RM', 'HE');

alter table clients
  alter column reporting_type set default 'RM',
  alter column reporting_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_reporting_type_check'
  ) then
    alter table clients
      add constraint clients_reporting_type_check check (reporting_type in ('RM', 'HE'));
  end if;
end $$;

create unique index if not exists clients_ghl_location_id_key
  on clients (ghl_location_id) where ghl_location_id is not null;

-- Multi-offer / upsell: LO account groups (one group, many client rows / GHL subaccounts)
create table if not exists client_account_groups (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  primary_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists client_account_groups_primary_email_idx
  on client_account_groups (lower(primary_email))
  where primary_email is not null;

alter table clients add column if not exists account_group_id uuid;
alter table clients add column if not exists engagement_kind text not null default 'initial';
alter table clients add column if not exists origin_client_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_account_group_id_fkey') then
    alter table clients add constraint clients_account_group_id_fkey
      foreign key (account_group_id) references client_account_groups(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_origin_client_id_fkey') then
    alter table clients add constraint clients_origin_client_id_fkey
      foreign key (origin_client_id) references clients(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_engagement_kind_check') then
    alter table clients add constraint clients_engagement_kind_check
      check (engagement_kind in ('initial', 'upsell', 'cross_sell'));
  end if;
end $$;

create index if not exists clients_account_group_id_idx on clients (account_group_id);
create index if not exists clients_origin_client_id_idx
  on clients (origin_client_id) where origin_client_id is not null;

create table if not exists client_engagements (
  id                   uuid primary key default gen_random_uuid(),
  account_group_id     uuid not null references client_account_groups(id) on delete restrict,
  from_client_id       uuid references clients(id) on delete set null,
  to_client_id         uuid not null references clients(id) on delete restrict,
  engagement_kind      text not null,
  reporting_type       text not null,
  sales_package        text,
  mrr_snapshot         numeric(12, 2),
  closed_at            date,
  logged_by            uuid references profiles(id) on delete set null,
  acquisition_close_id uuid,
  created_at           timestamptz not null default now(),
  constraint client_engagements_engagement_kind_check
    check (engagement_kind in ('initial', 'upsell', 'cross_sell'))
);

create index if not exists client_engagements_account_group_id_idx
  on client_engagements (account_group_id);
create index if not exists client_engagements_account_group_id_created_at_idx
  on client_engagements (account_group_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Agents (setters)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists agents (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  phone                 text not null unique,
  email                 text,
  user_id               uuid references auth.users(id) on delete set null,
  pay_type              text not null default 'call_rep',
  base_salary           numeric(10,2) not null default 0,
  monthly_bonus         numeric(10,2) not null default 0,
  base_salary_prorate_days int,
  pay_per_booking       numeric(10,2) not null default 0,
  pay_per_show          numeric(10,2) not null default 0,
  pay_per_live_transfer numeric(10,2) not null default 0,
  pay_per_qualified_demo numeric(10,2) not null default 0,
  pay_per_close         numeric(10,2) not null default 0,
  active                boolean not null default true,
  ended_on              date,
  created_at            timestamptz default now(),
  constraint agents_pay_type_check check (
    pay_type in ('call_rep', 'b2b_setter', 'admin', 'media_buyer', 'operations', 'client_success', 'ccm', 'other')
  )
);

create index if not exists agents_active_idx on agents (active);

create unique index if not exists agents_user_id_key on agents (user_id) where user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Goals (per-agent KPI targets)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  agent_name text,
  metric text not null,
  target numeric not null check (target > 0),
  period text not null check (period in ('daily', 'monthly')),
  month text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_month_format check (
    month is null or month ~ '^\d{4}-\d{2}$'
  ),
  constraint goals_month_period_consistency check (
    (period = 'daily' and month is null)
    or (period = 'monthly' and month is not null)
  )
);

create unique index if not exists goals_unique_key
  on goals (client_id, agent_name, metric, period, month)
  nulls not distinct;

create index if not exists goals_agent_period_idx
  on goals (agent_name, period, month);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Events (all GHL events: dials, leads, bookings, shows, no-shows, callbacks)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists events (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  event_type  text    not null,
  occurred_at timestamptz default now(),

  -- Call fields
  duration_seconds   int,
  is_pickup          boolean,
  is_conversation    boolean,
  speed_to_lead_seconds numeric,
  -- False when occurred_at came from a date-only source (no real time of day).
  -- Speed-to-lead skips these rows. NULL = unknown/legacy.
  occurred_at_has_time boolean,
  -- Lead's real creation time, captured from the dialer payload (lead_created_date) on dial
  -- rows. Speed-to-lead prefers this precise instant over a date-only lead event.
  lead_created_at timestamptz,
  -- The lead/contact's own IANA timezone (e.g. "America/New_York") from the GHL payload.
  -- Heat maps bucket each event by the lead's LOCAL time of day using this zone.
  lead_timezone text,
  direction          text,       -- inbound | outbound
  call_status        text,       -- completed | voicemail | canceled | no_answer
  recording_url      text,
  call_summary       text,
  phone_number_used  text,
  dial_source        text,       -- dialing software/source, e.g. GHL | HP

  -- Appointment fields
  scheduled_at   timestamptz,   -- when the appointment is scheduled for
  external_id    text,          -- GHL appointment ID — used to flip booked → show/no_show
  calendar_name  text,          -- GHL calendar name
  calendar_id    text,          -- GHL calendar id (which calendar the appointment is on)
  stage_booked   text,          -- e.g. "Day 1 AM"

  -- Lead identity
  lead_name   text,
  lead_phone  text,
  lead_email  text,

  -- Agent
  agent_name      text,
  ghl_contact_id  text,
  raw             jsonb,

  -- Lead flags (meaningful when event_type = 'lead')
  is_qualified    boolean,
  is_hot          boolean,
  is_out_of_state boolean,

  -- Manual DQ (meaningful when event_type = 'manual_dq')
  dq_reason       text,
  lead_event_id   uuid references events(id) on delete set null,

  constraint events_event_type_check check (
    event_type in (
      'dial', 'lead', 'appointment_booked', 'appointment_cancelled', 'appointment_rescheduled',
      'show', 'no_show', 'callback_booked',
      'live_transfer', 'proposal_sent', 'loan_processing', 'closed',
      'proposal_made', 'submission_made', 'loan_funded',
      'out_of_state_lead',
      'lo_bailed', 'lo_audit', 'claimed',
      'manual_dq'
    )
  )
);

-- Additive columns (so re-running on an older events table backfills them)
alter table events add column if not exists occurred_at_has_time boolean;
alter table events add column if not exists lead_created_at timestamptz;
alter table events add column if not exists lead_timezone text;

-- Ad / UTM attribution (Media Buyer view). ad_name is the cross-client join key.
alter table events add column if not exists ad_name      text;
alter table events add column if not exists adset_name   text;
alter table events add column if not exists campaign_name text;
alter table events add column if not exists utm_source   text;
alter table events add column if not exists utm_campaign text;
alter table events add column if not exists utm_content  text;
alter table events add column if not exists utm_term     text;

-- Lead origin (HE dial-only lists, partner feeds, etc.). Meaningful on event_type = 'lead'.
alter table events add column if not exists lead_source text;

-- True when GHL contact had the ai-booked tag at webhook time (excluded from agent credit queue).
alter table events add column if not exists is_ai_booked boolean;

-- Manual DQ: setter disqualifies a lead that passed automated filters.
alter table events add column if not exists dq_reason text;
alter table events add column if not exists lead_event_id uuid references events(id) on delete set null;

create index if not exists events_lead_event_id_idx
  on events (lead_event_id)
  where lead_event_id is not null;

create index if not exists events_manual_dq_contact_idx
  on events (client_id, ghl_contact_id, occurred_at desc)
  where event_type = 'manual_dq';

create unique index if not exists events_manual_dq_contact_uidx
  on events (client_id, ghl_contact_id)
  where event_type = 'manual_dq' and ghl_contact_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Meta Ad Insights (daily ad-level reporting from Meta Ads — sole spend source)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists meta_ad_insights (
  id                   uuid    primary key default gen_random_uuid(),
  client_id            uuid    not null references clients(id) on delete cascade,
  insight_date         date    not null,
  account_id           text    not null,
  campaign_id          text    not null,
  campaign_name        text,
  adset_id             text    not null,
  adset_name           text,
  ad_id                text    not null,
  ad_name              text,
  spend                numeric not null default 0,
  impressions          bigint  not null default 0,
  clicks               bigint  not null default 0,
  ctr                  numeric,
  cpc                  numeric,
  cpm                  numeric,
  actions              jsonb,
  cost_per_action_type jsonb,
  raw                  jsonb,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  unique(client_id, insight_date, account_id, campaign_id, adset_id, ad_id)
);

-- Daily Meta spend rollup (query via PostgREST as daily_meta_spend)
create or replace view daily_meta_spend as
select
  client_id,
  insight_date as spend_date,
  sum(spend) as amount
from meta_ad_insights
group by client_id, insight_date;

grant select on daily_meta_spend to service_role;
grant select on daily_meta_spend to authenticated;
grant select on daily_meta_spend to anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b. Ad format catalog (shared by client + acquisition libraries)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists ad_formats (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ad_formats_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists ad_formats_label_lower_key
  on ad_formats (lower(label));

insert into ad_formats (slug, label, sort_order) values
  ('static', 'Static', 10),
  ('ugc', 'UGC', 20),
  ('testimonial', 'Testimonial', 30),
  ('ext', 'Ext', 40)
on conflict (slug) do nothing;

alter table ad_formats enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6c. Ad Library (manually curated Facebook ad creatives — Media Buyer view)
--     Keyed by ad_name (same join key as meta_ad_insights / events). Stores a
--     Google Drive link to the creative plus a summary and visual notes.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists ad_library (
  id            uuid    primary key default gen_random_uuid(),
  ad_name       text    not null unique,
  platform      text    not null default 'facebook',
  status        text    not null default 'active',
  ad_format     text    references ad_formats(slug) on update cascade on delete set null,
  product       text,
  summary       text,
  visual_notes  text,
  drive_url     text,
  thumbnail_url text,
  ready_to_test boolean not null default false,
  created_by    uuid    references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ad_library_status_check check (
    status in ('active', 'winner', 'paused', 'archived')
  ),
  constraint ad_library_product_check check (
    product is null or product in ('reverse', 'dscr', 'broad_forward')
  ),
  knowledge_capture_status text not null default 'none',
  captured_at timestamptz,
  os_refs text[] not null default '{}',
  constraint ad_library_knowledge_capture_status_check check (
    knowledge_capture_status in ('none', 'pending', 'processed', 'needs_review', 'skipped')
  )
);

create index if not exists ad_library_status_idx on ad_library(status);
create index if not exists ad_library_ad_format_idx on ad_library(ad_format);
create index if not exists ad_library_product_idx on ad_library(product);
create index if not exists ad_library_ready_to_test_idx
  on ad_library (created_at desc)
  where ready_to_test = true;

-- Alternate Facebook ad names mapped to the same ad_library creative.
create table if not exists ad_library_aliases (
  id          uuid primary key default gen_random_uuid(),
  library_id  uuid not null references ad_library(id) on delete cascade,
  alias_name  text not null,
  created_at  timestamptz not null default now(),
  unique (alias_name)
);

create index if not exists ad_library_aliases_library_id_idx on ad_library_aliases(library_id);

-- Product × category tags for ad library creatives. Junction is many-to-many
-- on tag id so DSCR and RM can share slug strings (e.g. cash-out).
create table if not exists ad_tags (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  label       text not null,
  product     text not null,
  category    text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ad_tags_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint ad_tags_product_check check (
    product in ('dscr', 'reverse', 'broad_forward')
  ),
  constraint ad_tags_category_format check (
    category ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
  )
);

create unique index if not exists ad_tags_product_category_slug_key
  on ad_tags (product, category, slug);

create unique index if not exists ad_tags_product_category_label_lower_key
  on ad_tags (product, category, lower(label));

create index if not exists ad_tags_product_idx on ad_tags (product);
create index if not exists ad_tags_product_category_idx on ad_tags (product, category);

-- Seed catalog is applied by migration rebuild_ad_tags_product_categories.sql
-- (source of truth: src/lib/ad-tag-categories.ts). Do not re-seed legacy flat tags here.

create table if not exists ad_library_tags (
  library_id uuid not null references ad_library(id) on delete cascade,
  tag_id     uuid not null references ad_tags(id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (library_id, tag_id)
);

create index if not exists ad_library_tags_tag_id_idx on ad_library_tags(tag_id);

alter table ad_tags enable row level security;
alter table ad_library_tags enable row level security;

do $$ begin
  create policy ad_tags_read on ad_tags
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy ad_library_tags_read on ad_library_tags
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6d. Resource Library (company-wide forms, SOPs, document links, templates)
--     Company-wide (not per-client). Viewing is gated by the 'resources' tab
--     permission; mutations are admin/owner only (enforced in app code).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists resources (
  id          uuid    primary key default gen_random_uuid(),
  title       text    not null,
  description text,
  category    text    not null default 'document',
  tags        text[]  not null default '{}',
  url         text    not null,
  created_by  uuid    references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint resources_category_check check (
    category in ('form', 'sop', 'document', 'template', 'client_playbook', 'other')
  )
);

create index if not exists resources_category_idx on resources(category);
create index if not exists resources_tags_idx on resources using gin(tags);
create index if not exists resources_updated_at_idx on resources(updated_at desc);

-- Native playbooks / SOPs (in-app editable markdown).
create table if not exists library_documents (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  title           text not null,
  description     text,
  body            text not null,
  domain          text not null default 'acquisition',
  owner           text not null,
  status          text not null default 'draft',
  artifact_type   text not null,
  department      text,
  review_cycle    text,
  script_version  text,
  related_docs    jsonb not null default '[]',
  headings        jsonb not null default '[]',
  stage_nav       jsonb not null default '[]',
  opening_pills   jsonb not null default '[]',
  icp_pills       jsonb not null default '[]',
  featured        boolean not null default false,
  bundle          text,
  tags            text[] not null default '{}',
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint library_documents_owner_check check (
    owner in ('setter', 'closer', 'sales-leadership', 'operations')
  ),
  constraint library_documents_status_check check (
    status in ('active', 'draft')
  ),
  constraint library_documents_artifact_type_check check (
    artifact_type in ('script', 'sop', 'checklist', 'reference', 'framework', 'doctrine', 'prompt', 'hub', 'document')
  ),
  constraint library_documents_department_check check (
    department is null or department in ('sales', 'call-center', 'media-buying', 'client-success', 'operations')
  )
);

create index if not exists library_documents_department_idx on library_documents(department);
create index if not exists library_documents_status_idx on library_documents(status);
create index if not exists library_documents_updated_at_idx on library_documents(updated_at desc);
create index if not exists library_documents_tags_idx on library_documents using gin(tags);
create index if not exists library_documents_search_idx on library_documents
  using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(body, '')));

-- Form registry: metadata for internal forms (routes remain React pages).
create table if not exists form_registry (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  description text not null default '',
  href        text not null,
  audience    text not null default '',
  tags        text[] not null default '{}',
  sort_order  int not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists form_registry_sort_order_idx on form_registry(sort_order);
create index if not exists form_registry_tags_idx on form_registry using gin(tags);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Setter Availability (recurring weekly windows per agent)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists setter_availability (
  id          uuid    primary key default gen_random_uuid(),
  agent_id    uuid    not null references agents(id) on delete cascade,
  weekday     text    not null,   -- Monday | Tuesday | ... | Sunday
  time_start  text    not null,   -- HH:MM 24-hour
  time_end    text    not null,
  is_live     boolean not null default true,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Client Calling Windows (deprecated — unused by Weekly Focus UI)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_calling_windows (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  weekday     text    not null,
  time_slot_1 text,              -- HH:MM 24-hour
  time_slot_2 text,
  is_live     boolean not null default true,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Watch Schedule (manager assigns setters to specific dates + hours)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists watch_schedule (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references agents(id) on delete cascade,
  scheduled_date date not null,
  slot_hour      int  not null,   -- 8–20 (8am–8pm)
  created_at     timestamptz default now(),
  unique(agent_id, scheduled_date, slot_hour)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PD Schedule (deprecated — superseded by focus_schedule; leave for history)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists pd_schedule (
  id             uuid    primary key default gen_random_uuid(),
  client_id      uuid    not null references clients(id) on delete cascade,
  agent_id       uuid    references agents(id) on delete set null,
  scheduled_date date    not null,
  slot_time      text    not null,   -- HH:MM 24-hour
  status         text    not null default 'pending',  -- pending | done | skipped | no_setters
  notes          text,
  created_at     timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10b. Focus Schedule (weekly timed client focus blocks)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists focus_schedule (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  agent_id       uuid references agents(id) on delete set null,
  scheduled_date date not null,
  time_start     text not null,  -- HH:MM 24-hour
  time_end       text not null,  -- HH:MM 24-hour; must be after time_start
  status         text not null default 'scheduled'
                 check (status in ('scheduled', 'done', 'skipped')),
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists focus_schedule_date_idx
  on focus_schedule (scheduled_date);

create index if not exists focus_schedule_client_date_idx
  on focus_schedule (client_id, scheduled_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Client Health Snapshots (frozen periodic verdicts — progress baselines)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_health_snapshots (
  id                  uuid    primary key default gen_random_uuid(),
  client_id           uuid    not null references clients(id) on delete cascade,
  period_start        date    not null,
  period_end          date    not null,
  window_code         text,                 -- W7 | W14 | W30 | custom
  cpconv              numeric,
  cpql                numeric,
  cpl                 numeric,
  conversation_yield  numeric,
  show_rate           numeric,
  booking_rate        numeric,
  lead_to_qual        numeric,
  attention_score     numeric,
  worst_tier          text,                 -- critical | below | at | above | insufficient
  primary_constraint  text,
  constraint_label    text,
  metrics             jsonb,                -- full MetricsResult snapshot
  ai_diagnosis        jsonb,                -- latest AI verdict for this period (optional)
  created_by          uuid    references auth.users(id) on delete set null,
  created_at          timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Client Action Logs (work log: findings, cadence, bets)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_action_logs (
  id                   uuid    primary key default gen_random_uuid(),
  client_id            uuid    not null references clients(id) on delete cascade,
  created_by           uuid    references auth.users(id) on delete set null,
  created_at           timestamptz default now(),
  title                text    not null,
  work_type            text    not null default 'bet',  -- finding | cadence | bet
  layer                text,             -- L1 | L2 | L3 | L4 | DATA
  constraint_label     text,
  change_description   text,
  hypothesis           text,
  bet_category         text,             -- curated lever type (bets only)
  loom_url             text,             -- Loom of what changed + why (required when bet goes live)
  baseline_snapshot_id uuid    references client_health_snapshots(id) on delete set null,
  success_metric       text,             -- which KPI must move, e.g. cpconv / show_rate
  baseline_value       numeric,
  target_value         numeric,
  status               text    not null default 'planned',
  review_date          date,
  change_date          date,             -- live / done / observed (null until a bet ships)
  planned_date         date,             -- when we intended to do it
  outcome_value        numeric,
  outcome_notes        text,
  outcome_recorded_at  timestamptz,
  ai_generated         boolean not null default false,
  constraint client_action_logs_status_check check (
    status in ('planned', 'in_progress', 'measuring', 'succeeded', 'failed', 'abandoned')
  ),
  constraint client_action_logs_work_type_check check (
    work_type in ('finding', 'cadence', 'bet')
  ),
  constraint client_action_logs_bet_category_check check (
    bet_category is null
    or bet_category in (
      'new_creatives',
      'new_angle_offer',
      'audience_targeting',
      'landing_optin',
      'budget_allocation',
      'campaign_structure',
      'reactivate_leads',
      'confirmation_rebook',
      'dial_coverage',
      'script_booking',
      'live_transfer',
      'lo_show_process',
      'other'
    )
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Client Status History (append-only log of lifecycle transitions)
--     Backbone for churn timing, reactivations, and tenure.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_status_history (
  id              uuid    primary key default gen_random_uuid(),
  client_id       uuid    not null references clients(id) on delete cascade,
  previous_status text,
  new_status      text    not null,
  mrr_at_change   numeric,
  changed_at      timestamptz not null default now(),
  changed_by      uuid    references auth.users(id) on delete set null,
  source          text    not null default 'manual',  -- manual | clickup_sync | trigger
  note            text,
  reason_code     text,
  constraint client_status_history_reason_code_check check (
    reason_code is null or reason_code in (
      'poor_results', 'pricing_cost', 'went_in_house', 'business_closed',
      'contract_ended', 'service_issues', 'competitor', 'unresponsive',
      'mutual_decision', 'other'
    )
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14b. Client Calls (account-management: onboarding, launch, check-in, churn)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_calls (
  id            uuid    primary key default gen_random_uuid(),
  client_id     uuid    not null references clients(id) on delete cascade,
  call_type     text    not null,
  called_at     timestamptz not null,
  recording_url text,
  transcript    text,
  notes         text,
  attendees     text,
  checkin_form  jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid    references auth.users(id) on delete set null,
  updated_by    uuid    references auth.users(id) on delete set null,
  duration_seconds int,
  disposition   text,
  follow_up_due_at timestamptz,
  deleted_at    timestamptz,
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(transcript, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(attendees, '')
    )
  ) stored,
  constraint client_calls_type_check check (
    call_type in ('onboarding', 'launch', 'checkin', 'churn', 'other')
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14b2. Team Calls (coaching / team call library)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists team_calls (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  call_type        text not null,
  called_at        timestamptz not null,
  participants     text,
  recording_url    text,
  transcript       text,
  summary          text,
  highlights       jsonb not null default '[]',
  highlights_text  text,
  tags             text[] not null default '{}',
  duration_seconds int,
  lead_type        text,
  grade            text,
  source_event_id  uuid references events(id) on delete set null,
  is_private       boolean not null default false,
  is_important     boolean not null default false,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  search_vector    tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(transcript, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(participants, '') || ' ' ||
      coalesce(highlights_text, '')
    )
  ) stored,
  constraint team_calls_type_check check (
    call_type in ('coaching', 'training', 'team_meeting', 'team_review', 'interview', 'role_play', '1on1', 'sales_review', 'other')
  ),
  constraint team_calls_lead_type_check check (
    lead_type is null or lead_type in ('RM', 'DSCR', 'HE')
  ),
  constraint team_calls_grade_check check (
    grade is null or grade in ('A+', 'A', 'A-', 'B')
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14c. Client Notes (append-only ongoing feedback)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_notes (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  note_type   text    not null default 'general',
  reason_code text,
  body        text    not null,
  created_at  timestamptz not null default now(),
  created_by  uuid    references auth.users(id) on delete set null,
  updated_at  timestamptz,
  updated_by  uuid    references auth.users(id) on delete set null,
  deleted_at  timestamptz,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored,
  constraint client_notes_type_check check (
    note_type in ('general', 'concern', 'win', 'internal')
  ),
  constraint client_notes_reason_code_check check (
    reason_code is null or reason_code in (
      'poor_results', 'pricing_cost', 'went_in_house', 'business_closed',
      'contract_ended', 'service_issues', 'competitor', 'unresponsive',
      'mutual_decision', 'other'
    )
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14d. Client Contacts (additional team members per account)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_contacts (
  id               uuid    primary key default gen_random_uuid(),
  client_id        uuid    not null references clients(id) on delete cascade,
  contact_type     text    not null,
  name             text    not null,
  email            text,
  phone            text,
  nmls             text,
  states_licensed  text[],
  notes            text,
  sort_order       int     not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  created_by       uuid    references auth.users(id) on delete set null,
  updated_by       uuid    references auth.users(id) on delete set null,
  constraint client_contacts_type_check check (
    contact_type in ('loa', 'co_lo', 'other')
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Client Monthly Snapshots (point-in-time per client per month)
--     Powers MRR-over-time, churn rate, retention/cohort, expansion/contraction.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_monthly_snapshots (
  id               uuid    primary key default gen_random_uuid(),
  client_id        uuid    not null references clients(id) on delete cascade,
  period_month     date    not null,   -- first day of the month
  lifecycle_status text,
  mrr              numeric,
  daily_adspend    numeric,
  cs_status        text,
  client_stage     text,
  is_active        boolean not null default false,
  captured_at      timestamptz not null default now(),
  unique(client_id, period_month)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Status-change trigger (auto-log transitions + maintain churn fields)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.log_client_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.lifecycle_status is distinct from old.lifecycle_status then
    insert into public.client_status_history
      (client_id, previous_status, new_status, mrr_at_change, source)
    values
      (new.id, old.lifecycle_status, new.lifecycle_status, new.mrr, 'trigger');

    new.last_status_changed_at := now();

    if new.lifecycle_status = 'churned' then
      if new.churned_at is null then
        new.churned_at := now();
      end if;
    elsif new.lifecycle_status not in ('churned', 'off_boarding') then
      new.churned_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_status_change on clients;
create trigger clients_status_change
  before update on clients
  for each row execute function public.log_client_status_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. Business Metrics (company-wide KPI time series for the CEO view)
--     Flexible key/value-over-time table so new high-level metrics can be tracked
--     without schema changes. dimension allows optional slicing (e.g. offer=RM).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists business_metrics (
  id            uuid    primary key default gen_random_uuid(),
  metric_key    text    not null,    -- total_mrr | active_clients | new_clients | churned_clients | headcount | cash_balance | ...
  period_date   date    not null,
  value_numeric numeric,
  value_text    text,
  dimension     text,                -- optional slice label, e.g. 'offer=RM'
  notes         text,
  created_by    uuid    references auth.users(id) on delete set null,
  created_at    timestamptz default now()
);

create unique index if not exists business_metrics_key_period_dim
  on business_metrics (metric_key, period_date, coalesce(dimension, ''));

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. Client Billings (append-only ledger of every billing made per client)
--     Next billing date is DERIVED in app code from billing_type / date_signed
--     + the latest row here; not stored. Reached via service role only (no RLS).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_billings (
  id                 uuid    primary key default gen_random_uuid(),
  client_id          uuid    not null references clients(id) on delete cascade,
  billed_on          date    not null,                 -- date this billing was issued
  due_date           date,                             -- when payment is due (extendable)
  period_start       date,                             -- service period this covers
  period_end         date,
  amount             numeric not null,                 -- total due = base + performance + late_fee - discount
  base_amount        numeric,                          -- recurring base (defaults to clients.mrr)
  performance_amount numeric default 0,                -- manual performance add-on
  late_fee           numeric default 0,                -- late charge
  discount           numeric default 0,                -- discount applied (reduces total due)
  amount_paid        numeric default 0,                -- actually collected (partial = 0 < paid < amount)
  status             text    not null default 'pending',  -- pending | partial | paid | overdue | failed | refunded
  paid_on            date,
  method             text,                             -- card | ach | wire | stripe | manual
  invoice_ref        text,                             -- external invoice / Stripe id
  note               text,
  revenue_type       text,                             -- mrr | pif | performance | passthrough | upsell | one_off
  revenue_segment    text,                             -- front_end (new cash) | back_end (recurring)
  lead_source        text,                             -- Meta | Referral | Cold Call | Linkedin | ...
  term_months        int,                              -- months covered (PIF lump sums)
  processing_fee     numeric default 0,                -- payment processor fee
  passthrough_amount numeric default 0,                -- ad-spend reimbursement (excluded from revenue)
  stripe_invoice_id  text,                             -- Stripe invoice id (in_...)
  stripe_payment_intent_id text,                       -- Stripe payment intent id (pi_...)
  is_first_payment   boolean not null default false,   -- client's first paid revenue billing
  is_extension       boolean not null default false,   -- free-month retention comp ($0 paid cycle)
  created_by         uuid    references auth.users(id) on delete set null,
  created_at         timestamptz default now()
);

-- Additive columns (so re-running on an older client_billings table backfills them)
alter table client_billings add column if not exists due_date           date;
alter table client_billings add column if not exists base_amount        numeric;
alter table client_billings add column if not exists performance_amount numeric default 0;
alter table client_billings add column if not exists late_fee           numeric default 0;
alter table client_billings add column if not exists discount           numeric default 0;
alter table client_billings add column if not exists amount_paid        numeric default 0;
alter table client_billings add column if not exists revenue_type       text;
alter table client_billings add column if not exists revenue_segment    text;
alter table client_billings add column if not exists lead_source        text;
alter table client_billings add column if not exists term_months        int;
alter table client_billings add column if not exists processing_fee     numeric default 0;
alter table client_billings add column if not exists passthrough_amount numeric default 0;
alter table client_billings add column if not exists stripe_invoice_id  text;
alter table client_billings add column if not exists stripe_payment_intent_id text;
alter table client_billings add column if not exists is_first_payment   boolean not null default false;
alter table client_billings add column if not exists is_extension       boolean not null default false;
update client_billings set base_amount = amount   where base_amount is null;
update client_billings set due_date    = billed_on where due_date is null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'client_billings_status_check') then
    alter table client_billings drop constraint client_billings_status_check;
  end if;
  alter table client_billings add constraint client_billings_status_check check (
    status in ('pending', 'partial', 'paid', 'overdue', 'failed', 'refunded', 'voided', 'scheduled')
  );
  if exists (select 1 from pg_constraint where conname = 'client_billings_revenue_type_check') then
    alter table client_billings drop constraint client_billings_revenue_type_check;
  end if;
  alter table client_billings add constraint client_billings_revenue_type_check
    check (revenue_type is null or revenue_type in (
      'mrr', 'pif', 'performance', 'passthrough', 'upsell', 'one_off'
    ));
  if not exists (select 1 from pg_constraint where conname = 'client_billings_revenue_segment_check') then
    alter table client_billings add constraint client_billings_revenue_segment_check
      check (revenue_segment is null or revenue_segment in ('front_end', 'back_end'));
  end if;
end $$;

create unique index if not exists client_billings_stripe_invoice_uid
  on client_billings (stripe_invoice_id)
  where stripe_invoice_id is not null;
create unique index if not exists client_billings_stripe_payment_intent_uid
  on client_billings (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index if not exists client_billings_is_first_payment
  on client_billings (client_id, paid_on)
  where is_first_payment = true;

-- Append-only audit trail for charge create / edit / pay / void.
create table if not exists billing_events (
  id          uuid primary key default gen_random_uuid(),
  billing_id  uuid not null references client_billings(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  event_type  text not null
    check (event_type in ('created', 'updated', 'payment', 'voided', 'status_changed')),
  actor_id    uuid references auth.users(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists billing_events_billing_created
  on billing_events (billing_id, created_at desc);
create index if not exists billing_events_client_created
  on billing_events (client_id, created_at desc);

-- Stripe invoice staging for future webhook sync + manual mapping.
create table if not exists stripe_invoices (
  id                   uuid primary key default gen_random_uuid(),
  stripe_invoice_id    text not null unique,
  stripe_customer_id   text,
  customer_email       text,
  amount_due           numeric,
  amount_paid          numeric,
  status               text,
  currency             text default 'usd',
  hosted_invoice_url   text,
  raw                  jsonb not null default '{}'::jsonb,
  matched_billing_id   uuid references client_billings(id) on delete set null,
  matched_client_id    uuid references clients(id) on delete set null,
  matched_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists stripe_invoices_customer
  on stripe_invoices (stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists stripe_invoices_unmatched
  on stripe_invoices (status, created_at desc)
  where matched_billing_id is null;

-- Non-client revenue (Skool / Bootcamp / community) not tied to a roster client.
create table if not exists misc_revenue (
  id             uuid    primary key default gen_random_uuid(),
  source         text    not null,                 -- 'skool' | 'bootcamp' | ...
  occurred_on    date    not null,
  amount         numeric not null,
  processing_fee numeric default 0,
  currency       text    default 'usd',
  description    text,
  external_ref   text,                             -- payment processor charge id
  note           text,
  created_by     uuid    references auth.users(id) on delete set null,
  created_at     timestamptz default now()
);
create index if not exists misc_revenue_source_date on misc_revenue(source, occurred_on desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists events_client_occurred  on events(client_id, occurred_at desc);
create index if not exists events_type             on events(event_type);
-- Hot path: type+date and client+type+date (dashboard KPI / STL / heatmap)
create index if not exists events_type_occurred_idx
  on events(event_type, occurred_at desc);
create index if not exists events_client_type_occurred_idx
  on events(client_id, event_type, occurred_at desc);
create index if not exists events_scheduled_at_idx
  on events(scheduled_at)
  where scheduled_at is not null;
create index if not exists events_outcome_external_id_idx
  on events(external_id)
  where event_type in ('show', 'no_show', 'appointment_cancelled', 'lo_bailed')
    and external_id is not null;
create index if not exists events_ghl_contact_id_idx
  on events(ghl_contact_id)
  where ghl_contact_id is not null;
create index if not exists events_client_type_contact_idx
  on events(client_id, event_type, ghl_contact_id)
  where ghl_contact_id is not null;
create index if not exists events_external_id_idx  on events(external_id)  where external_id is not null;
create index if not exists events_calendar_id_idx  on events(calendar_id)  where calendar_id is not null;
create index if not exists events_agent_name_idx   on events(agent_name)   where agent_name is not null;
create index if not exists events_lead_phone_idx   on events(lead_phone)   where lead_phone is not null;
create index if not exists events_ad_name_idx       on events(ad_name)      where ad_name is not null;
create index if not exists events_lead_ad_name_idx  on events(ad_name)      where event_type = 'lead' and ad_name is not null;
-- One conversion event per contact per stage (idempotent LO pipeline ingest)
create unique index if not exists events_conversion_unique
  on events (client_id, event_type, ghl_contact_id)
  where event_type in ('proposal_made','submission_made','loan_funded')
    and ghl_contact_id is not null;
create index if not exists meta_ad_insights_client_date on meta_ad_insights(client_id, insight_date desc);
create index if not exists meta_ad_insights_campaign    on meta_ad_insights(client_id, campaign_id);
create index if not exists meta_ad_insights_ad          on meta_ad_insights(client_id, ad_id);
create index if not exists watch_schedule_date     on watch_schedule(scheduled_date);
create index if not exists pd_schedule_date        on pd_schedule(scheduled_date);
create index if not exists client_health_snapshots_client_period on client_health_snapshots(client_id, period_end desc);
create index if not exists client_action_logs_client_created     on client_action_logs(client_id, created_at desc);
create index if not exists client_action_logs_status             on client_action_logs(status);
create index if not exists client_action_logs_client_type_change_idx on client_action_logs(client_id, work_type, change_date);
create index if not exists client_action_logs_client_bet_category_idx on client_action_logs(client_id, bet_category) where bet_category is not null;
create index if not exists clients_lifecycle_status_idx          on clients(lifecycle_status);
create index if not exists clients_churned_at_idx                on clients(churned_at) where churned_at is not null;
create index if not exists client_status_history_client          on client_status_history(client_id, changed_at desc);
create index if not exists client_status_history_new             on client_status_history(new_status);
create index if not exists client_calls_client_called            on client_calls(client_id, called_at desc);
create index if not exists client_calls_called                   on client_calls(called_at desc);
create index if not exists client_calls_checkin_form             on client_calls(client_id, called_at desc)
  where call_type = 'checkin' and checkin_form is not null;
create index if not exists client_notes_client_created           on client_notes(client_id, created_at desc);
create index if not exists idx_client_contacts_client_id         on client_contacts(client_id);
create index if not exists client_monthly_snapshots_period       on client_monthly_snapshots(period_month);
create index if not exists client_monthly_snapshots_client       on client_monthly_snapshots(client_id, period_month desc);
create index if not exists business_metrics_key_period           on business_metrics(metric_key, period_date desc);
create index if not exists client_billings_client_billed         on client_billings(client_id, billed_on desc);
create index if not exists client_billings_open_status           on client_billings(status, billed_on) where status in ('pending', 'overdue');

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Starter CEO views (lightweight; grow into a real dashboard later)
-- ─────────────────────────────────────────────────────────────────────────────

-- Current active recurring revenue.
create or replace view v_active_mrr as
select
  count(*) filter (where lifecycle_status = 'active') as active_clients,
  coalesce(sum(mrr) filter (where lifecycle_status = 'active'), 0) as active_mrr
from clients;

grant select on v_active_mrr to service_role;
grant select on v_active_mrr to authenticated;
grant select on v_active_mrr to anon;

-- Churn events per month (count of transitions into 'churned').
create or replace view v_monthly_churn as
select
  date_trunc('month', changed_at)::date as period_month,
  count(*) as churned_count
from client_status_history
where new_status = 'churned'
group by date_trunc('month', changed_at);

grant select on v_monthly_churn to service_role;
grant select on v_monthly_churn to authenticated;
grant select on v_monthly_churn to anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Client data architecture (billing void, links, activity views, attributes)
-- See supabase/migrations/client_data_architecture.sql
-- ─────────────────────────────────────────────────────────────────────────────
alter table client_billings add column if not exists voided_at timestamptz;
alter table client_billings add column if not exists voided_by uuid references auth.users(id) on delete set null;

-- Performance billing cycles (see migrations/add_client_billing_model.sql)
create table if not exists client_billing_cycles (
  id                    uuid        primary key default gen_random_uuid(),
  client_id             uuid        not null references clients(id) on delete cascade,
  period_start          date        not null,
  period_end            date        not null,
  base_amount           numeric     not null default 0,
  show_count            int         not null default 0,
  live_transfer_count   int         not null default 0,
  bailed_count          int         not null default 0,
  pay_per_show          numeric     not null default 0,
  pay_per_bailed        numeric     not null default 0,
  performance_amount    numeric     not null default 0,
  discount              numeric     not null default 0,
  status                text        not null default 'draft',
  report_sent_at        timestamptz,
  objection_deadline_at timestamptz,
  dispute_note          text,
  billing_id            uuid        references client_billings(id) on delete set null,
  note                  text,
  created_by            uuid        references auth.users(id) on delete set null,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
alter table client_billing_cycles
  add column if not exists live_transfer_count int not null default 0;

alter table client_calls add column if not exists status_history_id uuid
  references client_status_history(id) on delete set null;
alter table client_notes add column if not exists related_call_id uuid
  references client_calls(id) on delete set null;
alter table client_status_history add column if not exists related_call_id uuid
  references client_calls(id) on delete set null;

create index if not exists client_calls_status_history on client_calls(status_history_id)
  where status_history_id is not null;
create index if not exists client_calls_type on client_calls(call_type);
create index if not exists client_notes_related_call on client_notes(related_call_id)
  where related_call_id is not null;

create table if not exists client_attributes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  attr_key    text not null,
  attr_value  jsonb not null default 'null'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  constraint client_attributes_key_check check (char_length(trim(attr_key)) > 0),
  constraint client_attributes_client_key_unique unique (client_id, attr_key)
);
create index if not exists client_attributes_client on client_attributes(client_id);

-- v_client_activity (the unified per-client timeline) is defined at the bottom of
-- this file instead of here: it unions eleven sources, several of which — CS
-- touchpoints, meeting commitments, account week plans and their tasks — are
-- created further down, so it cannot be created at this point in a fresh run.

create or replace view v_churn_reasons as
select date_trunc('month', h.changed_at)::date as period_month, h.reason_code,
  count(*) as churn_count, coalesce(sum(h.mrr_at_change), 0) as lost_mrr
from client_status_history h
where h.new_status in ('churned', 'off_boarding') and h.reason_code is not null
group by date_trunc('month', h.changed_at), h.reason_code;

grant select on v_churn_reasons to service_role;
grant select on v_churn_reasons to authenticated;

-- Phase 2: MRR history, billing reminder dedupe, billing↔lifecycle link
alter table client_billings add column if not exists status_history_id uuid
  references client_status_history(id) on delete set null;

create table if not exists client_mrr_history (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  previous_mrr  numeric,
  new_mrr       numeric,
  changed_at    timestamptz not null default now(),
  changed_by    uuid references auth.users(id) on delete set null,
  note          text
);
create index if not exists client_mrr_history_client on client_mrr_history(client_id, changed_at desc);

create table if not exists billing_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  reminder_date   date not null,
  next_billing_date date not null,
  clickup_task_id text,
  created_at      timestamptz not null default now(),
  unique (client_id, reminder_date)
);
create index if not exists billing_reminder_log_date on billing_reminder_log(reminder_date desc);
create index if not exists client_calls_search on client_calls using gin(search_vector);
create index if not exists team_calls_search on team_calls using gin(search_vector);
create index if not exists team_calls_tags on team_calls using gin(tags);
create index if not exists team_calls_called_at on team_calls(called_at desc);
create index if not exists team_calls_call_type on team_calls(call_type);
create unique index if not exists team_calls_source_event_unique
  on team_calls (source_event_id)
  where source_event_id is not null and deleted_at is null;
create index if not exists team_calls_lead_type on team_calls (lead_type)
  where lead_type is not null and deleted_at is null;
create index if not exists team_calls_grade on team_calls (grade)
  where grade is not null and deleted_at is null;
create index if not exists client_notes_search on client_notes using gin(search_vector);

-- Unmapped webhook events (arrived before sub-account name existed in roster)
create table if not exists pending_events (
  id                    uuid primary key default gen_random_uuid(),
  client_name           text not null,
  ghl_location_id       text,
  event_type            text not null,
  source_event_type     text not null,
  normalized_event_type text not null,
  payload               jsonb not null,
  ghl_contact_id        text,
  occurred_at           timestamptz,
  status                text not null default 'pending'
    check (status in ('pending', 'resolved', 'skipped')),
  resolved_client_id    uuid references clients(id) on delete set null,
  resolved_event_id     uuid references events(id) on delete set null,
  resolved_at           timestamptz,
  error_message         text,
  received_at           timestamptz not null default now(),
  replay_attempts       int not null default 0
);

create index if not exists pending_events_status_received
  on pending_events (status, received_at desc)
  where status = 'pending';

create index if not exists pending_events_client_name_pending
  on pending_events (client_name)
  where status = 'pending';

create index if not exists pending_events_ghl_location_pending
  on pending_events (ghl_location_id)
  where status = 'pending' and ghl_location_id is not null;

-- Client onboarding form submissions (audit trail; checklist answers in JSONB).
alter table clients add column if not exists headshot_url text;
alter table clients add column if not exists logo_url text;
alter table clients add column if not exists team_invite_token text;
alter table clients add column if not exists loan_log_token text;

create unique index if not exists clients_team_invite_token_uidx
  on clients(team_invite_token)
  where team_invite_token is not null;

create unique index if not exists clients_loan_log_token_uidx
  on clients(loan_log_token)
  where loan_log_token is not null;

-- Dedicated welcome-back OB token (not report share_token). See add_client_reinstate.sql.
create unique index if not exists clients_welcome_back_token_key
  on clients (welcome_back_token)
  where welcome_back_token is not null;

-- Client reinstate / winback closes (acquisition_closes lives in acquisition migrations).
-- Guard: table is not created in this file; skip when acquisition migrations have not run.
do $$
begin
  if to_regclass('public.acquisition_closes') is null then
    return;
  end if;

  execute 'drop index if exists acquisition_closes_client_id_key';

  alter table acquisition_closes
    add column if not exists close_kind text not null default 'standard';

  alter table acquisition_closes
    drop constraint if exists acquisition_closes_close_kind_check;

  alter table acquisition_closes
    add constraint acquisition_closes_close_kind_check check (
      close_kind in ('standard', 'reinstate')
    );

  execute 'create index if not exists acquisition_closes_close_kind_idx on acquisition_closes (close_kind)';
end $$;

-- One row per loan transaction (file). Unique-person conversion stays on events.
create table if not exists loan_deals (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  ghl_contact_id       text,
  lead_name            text,
  lead_phone           text,
  lead_email           text,
  transaction_label    text,
  stage                text not null,
  submitted_at         timestamptz not null,
  funded_at            timestamptz,
  fell_out_at          timestamptz,
  loan_size            numeric(14, 2),
  commission_amount    numeric(12, 2),
  conversion_event_id  uuid references events(id) on delete set null,
  source               text not null default 'loan_log_form',
  raw                  jsonb not null default '{}'::jsonb,
  inserted_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint loan_deals_stage_check check (stage in ('submitted', 'funded')),
  constraint loan_deals_funded_at_check check (
    (stage = 'submitted' and funded_at is null)
    or (stage = 'funded' and funded_at is not null)
  ),
  constraint loan_deals_source_check check (
    source in ('loan_log_form', 'webhook', 'backfill')
  )
);

create index if not exists loan_deals_client_funded_idx
  on loan_deals (client_id, funded_at desc)
  where funded_at is not null;

create index if not exists loan_deals_client_submitted_idx
  on loan_deals (client_id, submitted_at desc);

create index if not exists loan_deals_contact_idx
  on loan_deals (client_id, ghl_contact_id)
  where ghl_contact_id is not null;

create unique index if not exists loan_deals_conversion_event_uidx
  on loan_deals (conversion_event_id)
  where conversion_event_id is not null;

create unique index if not exists loan_deals_identity_day_uidx
  on loan_deals (
    client_id,
    ghl_contact_id,
    loan_size,
    coalesce(lower(btrim(transaction_label)), ''),
    (timezone('UTC', coalesce(funded_at, submitted_at)))::date
  )
  where ghl_contact_id is not null and loan_size is not null;

alter table loan_deals enable row level security;

do $$ begin
  create policy loan_deals_read on loan_deals
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

grant select on loan_deals to authenticated;
grant all on loan_deals to service_role;

create table if not exists client_form_submissions (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete set null,
  form_type     text not null,
  status        text not null default 'submitted',
  submitted_by  text,
  match_email   text,
  match_phone   text,
  responses     jsonb not null default '{}',
  applied_patch jsonb,
  submitted_at  timestamptz not null default now(),
  constraint client_form_submissions_form_type_check check (
    form_type in (
      'new_client', 'onboarding', 'kickoff', 'tech_qa', 'marketing_qa',
      'launch', 'launch_kit', 'virtual_card',
      'churn', 'reinstate', 'reinstate_onboarding',
      'landing_page'
    )
  ),
  constraint client_form_submissions_status_check check (
    status in ('draft', 'submitted', 'unmapped', 'applied', 'dismissed')
  )
);

create index if not exists client_form_submissions_client_id_idx on client_form_submissions(client_id);
create index if not exists client_form_submissions_form_type_idx on client_form_submissions(form_type);
create index if not exists client_form_submissions_status_idx on client_form_submissions(status) where status = 'unmapped';

-- End-of-day forms (Media Buyer, Client Success, CCM).
create table if not exists eod_form_submissions (
  id                     uuid primary key default gen_random_uuid(),
  agent_id               uuid not null references agents(id) on delete cascade,
  department             text not null,
  work_date              date not null,
  status                 text not null default 'submitted',
  submitted_by_user_id   uuid references auth.users(id) on delete set null,
  submitted_by_label     text,
  responses              jsonb not null default '{}'::jsonb,
  submitted_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint eod_form_submissions_department_check check (
    department in ('media_buyer', 'client_success', 'ccm')
  ),
  constraint eod_form_submissions_status_check check (
    status in ('draft', 'submitted')
  ),
  constraint eod_form_submissions_unique_day unique (agent_id, department, work_date)
);
create index if not exists eod_form_submissions_agent_id_idx on eod_form_submissions (agent_id);
create index if not exists eod_form_submissions_department_idx on eod_form_submissions (department);
create index if not exists eod_form_submissions_work_date_idx on eod_form_submissions (work_date desc);

-- Workspace Slack channels + future notification automations (phase 1: storage only).
create table if not exists slack_channels (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  label        text not null,
  channel_id   text not null,
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  constraint slack_channels_slug_check check (char_length(trim(slug)) > 0),
  constraint slack_channels_label_check check (char_length(trim(label)) > 0),
  constraint slack_channels_channel_id_check check (char_length(trim(channel_id)) > 0)
);
create index if not exists slack_channels_active on slack_channels(is_active) where is_active = true;

create table if not exists notification_automations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  event_key         text not null,
  target_type       text not null,
  slack_channel_id  uuid references slack_channels(id) on delete set null,
  is_enabled        boolean not null default false,
  config            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint notification_automations_name_check check (char_length(trim(name)) > 0),
  constraint notification_automations_event_key_check check (char_length(trim(event_key)) > 0),
  constraint notification_automations_target_type_check check (
    target_type in ('workspace_channel', 'client_channel')
  )
);
create index if not exists notification_automations_event_key on notification_automations(event_key);
create index if not exists notification_automations_enabled on notification_automations(is_enabled) where is_enabled = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- Payroll runs (frozen monthly team payroll snapshots)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  period_month  date not null,
  start_date    date not null,
  end_date      date not null,
  summary       jsonb not null,
  report        jsonb not null,
  status        text not null default 'closed' check (status in ('open', 'closed')),
  finalized_at  timestamptz not null default now(),
  finalized_by  uuid references auth.users(id) on delete set null,
  notes         text,
  unique (period_month)
);

create table if not exists payroll_run_employees (
  id                  uuid primary key default gen_random_uuid(),
  payroll_run_id      uuid not null references payroll_runs(id) on delete cascade,
  period_month        date not null,
  agent_id            uuid references agents(id) on delete set null,
  agent_name          text not null,
  pay_type            text not null,
  section             text not null check (section in ('call_rep', 'b2b_setter', 'salaried')),
  total_pay           numeric(12, 2) not null,
  amounts             jsonb not null,
  counts              jsonb not null default '{}',
  rates               jsonb not null default '{}',
  line_items          jsonb not null default '[]',
  pending_disposition jsonb,
  non_show_appointments jsonb,
  submitted_at        timestamptz,
  submitted_by        uuid references auth.users(id) on delete set null,
  line_item_exclusions jsonb not null default '[]'::jsonb,
  unique (payroll_run_id, agent_id)
);

create index if not exists payroll_runs_period_month_idx on payroll_runs (period_month desc);
create index if not exists payroll_run_employees_agent_idx on payroll_run_employees (agent_id, period_month desc);
create index if not exists payroll_run_employees_period_idx on payroll_run_employees (period_month desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Business Expenses (see migrations/add_business_expenses.sql)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists finance_accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  institution   text,
  account_type  text not null default 'credit_card',
  entity        text,
  is_business   boolean not null default true,
  active        boolean not null default true,
  last4         text,
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  constraint finance_accounts_type_check check (
    account_type in ('checking', 'credit_card', 'other')
  )
);

create table if not exists expense_category_rules (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  match_type        text not null,
  match_value       text not null,
  amount_min        numeric,
  amount_max        numeric,
  ceo_bucket        text not null,
  subcategory       text,
  fulfillment_line  text,
  exclude_from_pnl  boolean not null default false,
  priority          int not null default 100,
  active            boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expense_rules_match_type_check check (
    match_type in ('merchant_contains', 'merchant_equals', 'memo_contains', 'amount_range')
  ),
  constraint expense_rules_bucket_check check (
    ceo_bucket in ('cac', 'fulfillment', 'overhead', 'passthrough', 'owner_draw', 'personal', 'uncategorized')
  )
);

create table if not exists business_expenses (
  id                   uuid primary key default gen_random_uuid(),
  occurred_on          date not null,
  amount               numeric not null,
  currency             text not null default 'USD',
  account_id           uuid references finance_accounts(id) on delete set null,
  source               text not null default 'manual',
  merchant_raw         text,
  merchant_normalized  text,
  memo                 text,
  external_id          text,
  ceo_bucket           text not null default 'uncategorized',
  subcategory          text,
  fulfillment_line     text,
  exclude_from_pnl     boolean not null default false,
  categorized_by       text,
  rule_id              uuid references expense_category_rules(id) on delete set null,
  payroll_run_id       text,
  client_id            uuid references clients(id) on delete set null,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint business_expenses_source_check check (
    source in ('manual', 'csv_import', 'payroll', 'bank_sync')
  ),
  constraint business_expenses_bucket_check check (
    ceo_bucket in ('cac', 'fulfillment', 'overhead', 'passthrough', 'owner_draw', 'personal', 'uncategorized')
  ),
  constraint business_expenses_categorized_by_check check (
    categorized_by is null or categorized_by in ('rule', 'user', 'import')
  )
);

-- 14b3. Dial Examples (curated call-center + B2B coaching library)
create table if not exists dial_examples (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  source text not null,
  source_id uuid not null,
  title text not null,
  recording_url text not null,
  called_at timestamptz not null,
  duration_seconds int,
  agent_name text,
  lead_name text,
  lead_phone text,
  lead_type text,
  call_type text,
  grade text,
  summary text,
  transcript text,
  highlights jsonb not null default '[]',
  tags text[] not null default '{}',
  client_id uuid references clients(id) on delete set null,
  lead_id uuid, -- references acquisition_leads(id); table lives in acquisition migrations
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint dial_examples_domain_check check (domain in ('call_center', 'b2b')),
  constraint dial_examples_source_check check (
    source in ('events', 'acquisition_dials', 'acquisition_calls')
  ),
  constraint dial_examples_domain_source_check check (
    (domain = 'call_center' and source = 'events')
    or (domain = 'b2b' and source in ('acquisition_dials', 'acquisition_calls'))
  ),
  constraint dial_examples_lead_type_check check (
    lead_type is null or lead_type in ('RM', 'DSCR', 'HE')
  ),
  constraint dial_examples_grade_check check (
    grade is null or grade in ('A+', 'A', 'A-', 'B')
  )
);

-- 14b4. Client Success appointments (onboarding / launch / check-in calendars)
-- Client key is clickup_task_id (soft join to clients). Call type lives on calendar config only.
create table if not exists cs_calendar_config (
  calendar_id   text primary key,
  calendar_name text not null,
  call_type     text not null,
  constraint cs_calendar_config_type_check check (
    call_type in ('onboarding', 'launch', 'checkin')
  )
);

create table if not exists cs_appointments (
  id                  uuid primary key default gen_random_uuid(),
  clickup_task_id     text not null,
  ghl_appointment_id  text not null,
  calendar_id         text not null,
  calendar_name       text,
  booked_at           timestamptz,
  scheduled_at        timestamptz not null,
  status              text not null default 'scheduled',
  title               text,
  assigned_to         text,
  raw                 jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cs_appointments_status_check check (
    status in ('scheduled', 'cancelled', 'completed', 'no_show')
  ),
  constraint cs_appointments_ghl_appointment_id_key unique (ghl_appointment_id)
);

create index if not exists cs_appointments_scheduled_upcoming_idx
  on cs_appointments (scheduled_at)
  where status = 'scheduled';

create index if not exists cs_appointments_clickup_scheduled_idx
  on cs_appointments (clickup_task_id, scheduled_at);

create index if not exists cs_appointments_calendar_id_idx
  on cs_appointments (calendar_id);

-- 14b5. CS Slack touchpoint work queue (Follow-ups)
create table if not exists cs_touchpoints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  touchpoint_type text not null,
  cycle_key text not null,
  status text not null default 'open',
  due_at timestamptz not null,
  triggered_at timestamptz not null default now(),
  completed_at timestamptz,
  snoozed_until timestamptz,
  trigger_source text not null,
  source_ref text,
  playbook_stage text,
  slack_sent boolean not null default false,
  slack_snippet text,
  completion_note text,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cs_touchpoints_type_check check (
    touchpoint_type in (
      'post_ob',
      'mid_build',
      'pre_launch',
      'launch_day',
      'm1_expectation_reset',
      'first_lead',
      'first_qc',
      'first_booking',
      'first_show',
      'm2_biweekly'
    )
  ),
  constraint cs_touchpoints_status_check check (
    status in ('open', 'snoozed', 'done', 'skipped')
  ),
  constraint cs_touchpoints_trigger_source_check check (
    trigger_source in (
      'cs_appointment',
      'client_call',
      'event',
      'schedule',
      'manual'
    )
  ),
  constraint cs_touchpoints_client_type_cycle_key unique (client_id, touchpoint_type, cycle_key)
);

create index if not exists cs_touchpoints_open_due_idx
  on cs_touchpoints (due_at)
  where status in ('open', 'snoozed');

create index if not exists cs_touchpoints_client_completed_idx
  on cs_touchpoints (client_id, completed_at desc nulls last);

create index if not exists cs_touchpoints_status_due_idx
  on cs_touchpoints (status, due_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team meeting runbooks (templates + instances)
-- Spec: Wm-os docs/plans/2026-07-21-team-call-runbooks-design.md
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists team_meeting_templates (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  theme           text not null default '',
  call_type       text not null,
  weekdays        int[] not null default '{}',
  default_time    time not null,
  duration_min    int not null default 30,
  host_role       text not null,
  attendee_roles  text[] not null default '{}',
  agenda_md       text not null default '',
  checklist       jsonb not null default '[]'::jsonb,
  disposition     jsonb not null default '[]'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint team_meeting_templates_call_type_check check (
    call_type in (
      'coaching', 'training', 'team_meeting', 'team_review',
      'interview', 'role_play', '1on1', 'sales_review', 'other'
    )
  ),
  constraint team_meeting_templates_host_role_check check (
    host_role in ('ccm', 'client_success', 'ceo', 'shared')
  )
);

create table if not exists team_meeting_instances (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null
    references team_meeting_templates(id) on delete cascade,
  scheduled_at      timestamptz not null,
  status            text not null default 'scheduled',
  host_agent_id     uuid references agents(id) on delete set null,
  checklist_state   jsonb not null default '{}'::jsonb,
  responses         jsonb not null default '{}'::jsonb,
  recording_url     text,
  notes             text,
  team_call_id      uuid references team_calls(id) on delete set null,
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint team_meeting_instances_status_check check (
    status in (
      'scheduled', 'in_progress', 'completed', 'skipped', 'cancelled'
    )
  ),
  constraint team_meeting_instances_unique_slot
    unique (template_id, scheduled_at)
);

create index if not exists team_meeting_instances_scheduled_at_idx
  on team_meeting_instances (scheduled_at);

create index if not exists team_meeting_instances_status_idx
  on team_meeting_instances (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Meeting commitments (Mon/Thu KPI + Ops Needs Founder)
-- Spec: Wm-os docs/superpowers/specs/2026-07-22-kpi-meeting-commitments-design.md
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists meeting_commitments (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references clients(id) on delete cascade,
  severity                text not null,
  why                     text not null default '',
  constraint_type         text not null,
  constraint_label        text not null default '',
  plan                    text not null default '',
  owner_role              text not null,
  due_date                date not null,
  needs_founder           boolean not null default false,
  founder_ask             text,
  status                  text not null default 'proposed',
  success_signal          text not null default '',
  origin_meeting_id       uuid references team_meeting_instances(id) on delete set null,
  approved_in_meeting_id  uuid references team_meeting_instances(id) on delete set null,
  last_touched_meeting_id uuid references team_meeting_instances(id) on delete set null,
  clickup_url             text,
  founder_note            text,
  check_note              text,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint meeting_commitments_severity_check check (
    severity in ('911', 'below')
  ),
  constraint meeting_commitments_constraint_type_check check (
    constraint_type in ('system', 'quality', 'data')
  ),
  constraint meeting_commitments_owner_role_check check (
    owner_role in ('client_success', 'media_buyer', 'ccm', 'ops', 'founder')
  ),
  constraint meeting_commitments_status_check check (
    status in (
      'proposed',
      'approved',
      'rejected',
      'needs_clarification',
      'in_progress',
      'landed',
      'blocked',
      'missed',
      'cancelled'
    )
  )
);

create index if not exists meeting_commitments_status_needs_founder_idx
  on meeting_commitments (status, needs_founder);

create index if not exists meeting_commitments_client_created_idx
  on meeting_commitments (client_id, created_at desc);

create index if not exists meeting_commitments_origin_meeting_idx
  on meeting_commitments (origin_meeting_id);

create index if not exists meeting_commitments_due_date_idx
  on meeting_commitments (due_date);

create index if not exists meeting_commitments_approved_meeting_idx
  on meeting_commitments (approved_in_meeting_id);

create index if not exists meeting_commitments_last_touched_meeting_idx
  on meeting_commitments (last_touched_meeting_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Account week plans + tasks (Mon KPI work plans, founder approve, person/day)
-- Spec: Wm-os docs/superpowers/specs/2026-08-06-account-week-plans-design.md
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists account_week_plans (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  week_start          date not null,
  why                 text not null default '',
  severity            text,
  status              text not null default 'pending',
  success_signal      text,
  origin_meeting_id   uuid references team_meeting_instances(id) on delete set null,
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  founder_note        text,
  reflection          text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint account_week_plans_severity_check check (
    severity is null or severity in ('911', 'below', 'watch')
  ),
  constraint account_week_plans_status_check check (
    status in ('pending', 'approved', 'rejected')
  )
);

create index if not exists account_week_plans_client_week_idx
  on account_week_plans (client_id, week_start desc);

create index if not exists account_week_plans_status_idx
  on account_week_plans (status);

create index if not exists account_week_plans_week_status_idx
  on account_week_plans (week_start, status);

create index if not exists account_week_plans_origin_meeting_idx
  on account_week_plans (origin_meeting_id)
  where origin_meeting_id is not null;

create index if not exists account_week_plans_pending_idx
  on account_week_plans (status)
  where status = 'pending';

create table if not exists account_plan_tasks (
  id                     uuid primary key default gen_random_uuid(),
  plan_id                uuid not null references account_week_plans(id) on delete cascade,
  client_id              uuid not null references clients(id) on delete cascade,
  title                  text not null,
  notes                  text,
  tactic_tag             text,
  assignee_user_id       uuid references auth.users(id) on delete set null,
  scheduled_for          date,
  status                 text not null default 'open',
  completion_report      text,
  completed_at           timestamptz,
  completed_by           uuid references auth.users(id) on delete set null,
  client_action_log_id   uuid references client_action_logs(id) on delete set null,
  sort_order             int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint account_plan_tasks_status_check check (
    status in ('open', 'done', 'cancelled')
  )
);

create index if not exists account_plan_tasks_assignee_day_idx
  on account_plan_tasks (assignee_user_id, scheduled_for);

create index if not exists account_plan_tasks_client_created_idx
  on account_plan_tasks (client_id, created_at desc);

create index if not exists account_plan_tasks_plan_sort_idx
  on account_plan_tasks (plan_id, sort_order);

create index if not exists account_plan_tasks_status_idx
  on account_plan_tasks (status);

create index if not exists account_plan_tasks_open_assignee_day_idx
  on account_plan_tasks (assignee_user_id, scheduled_for)
  where status = 'open';

-- task KPI target + team review (post-deploy)
alter table account_plan_tasks
  add column if not exists success_metric text,
  add column if not exists baseline_value numeric,
  add column if not exists outcome_value numeric,
  add column if not exists review_notes text,
  add column if not exists review_verdict text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists work_type text not null default 'cadence';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_plan_tasks_review_verdict_check'
  ) then
    alter table account_plan_tasks
      add constraint account_plan_tasks_review_verdict_check check (
        review_verdict is null or review_verdict in (
          'helped', 'no_change', 'hurt', 'unclear', 'too_early'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_plan_tasks_work_type_check'
  ) then
    alter table account_plan_tasks
      add constraint account_plan_tasks_work_type_check check (
        work_type in ('finding', 'cadence', 'bet')
      );
  end if;
end $$;

create index if not exists account_plan_tasks_completed_at_idx
  on account_plan_tasks (completed_at desc)
  where completed_at is not null;

-- Closebot personas, agent directory, versions, prompt change log
create table if not exists closebot_personas (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null,
  description            text,
  how_to_respond         text,
  tone                   text[] not null default '{}',
  custom_delay_enabled   boolean not null default false,
  typo_frequency         numeric,
  custom_delay_seconds   integer,
  is_active              boolean not null default true,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint closebot_personas_slug_unique unique (slug)
);

create index if not exists closebot_personas_active_sort_idx
  on closebot_personas (is_active, sort_order, name);

create table if not exists closebot_agents (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null,
  description      text,
  job_information  text,
  persona_id       uuid references closebot_personas (id) on delete set null,
  nodes            jsonb not null default '[]'::jsonb,
  follow_ups       jsonb not null default '[]'::jsonb,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint closebot_agents_slug_unique unique (slug)
);

create index if not exists closebot_agents_active_sort_idx
  on closebot_agents (is_active, sort_order, name);

create index if not exists closebot_agents_persona_id_idx
  on closebot_agents (persona_id)
  where persona_id is not null;

create table if not exists closebot_agent_clients (
  agent_id   uuid not null references closebot_agents (id) on delete cascade,
  client_id  uuid not null references clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, client_id),
  constraint closebot_agent_clients_client_unique unique (client_id)
);

create index if not exists closebot_agent_clients_agent_idx
  on closebot_agent_clients (agent_id);

create table if not exists closebot_bug_types (
  slug         text primary key,
  name         text not null,
  short_code   text not null,
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint closebot_bug_types_slug_check check (slug ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint closebot_bug_types_code_check check (char_length(short_code) between 2 and 8)
);

create table if not exists closebot_agent_versions (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references closebot_agents (id) on delete restrict,
  status             text not null,
  name               text not null,
  description        text,
  job_information    text,
  persona_id         uuid references closebot_personas (id) on delete set null,
  persona_snapshot   jsonb,
  nodes              jsonb not null default '[]'::jsonb,
  follow_ups         jsonb not null default '[]'::jsonb,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  went_live_at       timestamptz,
  superseded_at      timestamptz,
  constraint closebot_agent_versions_status_check check (
    status in ('pending', 'live', 'superseded', 'rejected')
  )
);

create index if not exists closebot_agent_versions_agent_updated_idx
  on closebot_agent_versions (agent_id, updated_at desc);

create index if not exists closebot_agent_versions_as_of_idx
  on closebot_agent_versions (agent_id, went_live_at desc)
  where status in ('live', 'superseded') and went_live_at is not null;

create unique index if not exists closebot_agent_versions_one_pending_idx
  on closebot_agent_versions (agent_id)
  where status = 'pending';

create table if not exists closebot_prompt_log (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid not null references closebot_agents (id) on delete restrict,
  agent_version_id  uuid references closebot_agent_versions (id) on delete set null,
  changed_at        timestamptz not null,
  prompt_body       text not null,
  problem_solved    text not null,
  change_reason     text not null,
  reference_urls    text[] not null default '{}',
  status            text not null default 'watching',
  outcome_notes     text,
  created_by        uuid references auth.users (id) on delete set null,
  updated_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint closebot_prompt_log_status_check check (
    status in ('open', 'watching', 'worked', 'did_not_work', 'reverted')
  )
);

create index if not exists closebot_prompt_log_changed_at_idx
  on closebot_prompt_log (changed_at desc);

create index if not exists closebot_prompt_log_agent_changed_idx
  on closebot_prompt_log (agent_id, changed_at desc);

create index if not exists closebot_prompt_log_open_status_idx
  on closebot_prompt_log (status)
  where status in ('open', 'watching');

create index if not exists closebot_prompt_log_version_idx
  on closebot_prompt_log (agent_version_id)
  where agent_version_id is not null;

create table if not exists closebot_log_bug_types (
  log_id     uuid not null references closebot_prompt_log (id) on delete cascade,
  bug_type   text not null references closebot_bug_types (slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (log_id, bug_type)
);

create index if not exists closebot_log_bug_types_type_idx
  on closebot_log_bug_types (bug_type);

create table if not exists closebot_tickets (
  id                 uuid primary key default gen_random_uuid(),
  occurred_at        timestamptz not null,
  bug_type           text references closebot_bug_types (slug),
  description        text not null,
  contact_url        text not null,
  client_id          uuid not null references clients (id) on delete restrict,
  agent_id           uuid not null references closebot_agents (id) on delete restrict,
  agent_version_id   uuid references closebot_agent_versions (id) on delete set null,
  status             text not null default 'new',
  reporter_name      text not null,
  prompt_log_id      uuid references closebot_prompt_log (id) on delete set null,
  covered_by_log_id  uuid references closebot_prompt_log (id) on delete set null,
  coverage           text not null default 'actionable',
  coverage_manual    boolean not null default false,
  status_notes       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint closebot_tickets_status_check check (
    status in (
      'new',
      'investigating',
      'ticket_open',
      'resolved_no_change',
      'resolved_updated_agent'
    )
  ),
  constraint closebot_tickets_coverage_check check (
    coverage in ('actionable', 'pre_fix')
  )
);

create index if not exists closebot_tickets_open_status_idx
  on closebot_tickets (status, occurred_at desc)
  where status in ('new', 'investigating', 'ticket_open');

create index if not exists closebot_tickets_open_actionable_idx
  on closebot_tickets (status, occurred_at desc)
  where status in ('new', 'investigating', 'ticket_open')
    and coverage = 'actionable';

create index if not exists closebot_tickets_pre_fix_idx
  on closebot_tickets (occurred_at desc)
  where coverage = 'pre_fix';

create index if not exists closebot_tickets_agent_occurred_idx
  on closebot_tickets (agent_id, occurred_at desc);

create index if not exists closebot_tickets_agent_type_occurred_idx
  on closebot_tickets (agent_id, bug_type, occurred_at)
  where bug_type is not null;

create index if not exists closebot_tickets_version_idx
  on closebot_tickets (agent_version_id)
  where agent_version_id is not null;

create index if not exists closebot_tickets_covered_by_log_idx
  on closebot_tickets (covered_by_log_id)
  where covered_by_log_id is not null;

create index if not exists closebot_tickets_client_occurred_idx
  on closebot_tickets (client_id, occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Client month disposition overrides (CS payment-streak timeline)
-- Most months derive from client_billings; only exceptions persist here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_month_disposition_overrides (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  year_month   text not null,
  disposition  text not null,
  note         text,
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint client_month_disposition_overrides_ym_check
    check (year_month ~ '^\d{4}-\d{2}$'),
  constraint client_month_disposition_overrides_disp_check
    check (disposition in ('paid', 'short', 'extension', 'unpaid', 'paused', 'churned')),
  constraint client_month_disposition_overrides_client_ym_unique
    unique (client_id, year_month)
);

create index if not exists client_month_disposition_overrides_client_idx
  on client_month_disposition_overrides (client_id, year_month);

-- ─────────────────────────────────────────────────────────────────────────────
-- Unified client activity timeline
--
-- Every source that carries (client_id, a timestamp, a description), unioned
-- into one shape: (client_id, source_id, activity_type, occurred_at, subtype,
-- summary, source_table). Served by /api/clients/[id]/activity and rendered by
-- the Client Workspace activity rail and the Client File account timeline.
--
-- Lives at the end of the file because it spans tables declared throughout it.
--
-- Date-only sources are anchored with the `::timestamptz at time zone 'UTC'`
-- idiom so all date-only rows in the view share one convention.
--
-- Performance: an eleven-branch union ordered by occurred_at desc is only cheap
-- if the client_id predicate pushes into each branch and each branch can walk an
-- index, so every source table carries a (client_id, <timestamp> desc) index.
-- ─────────────────────────────────────────────────────────────────────────────

-- cs_touchpoints is dated from triggered_at below, and its only client index was
-- on completed_at, which is null for all open work.
create index if not exists cs_touchpoints_client_triggered_idx
  on cs_touchpoints (client_id, triggered_at desc);

create or replace view v_client_activity as
  select h.client_id, h.id as source_id, 'lifecycle'::text as activity_type,
    h.changed_at as occurred_at, coalesce(h.new_status, 'unknown') as subtype,
    trim(both ' ' from coalesce(h.previous_status, '—') || ' → ' || coalesce(h.new_status, '—')
      || coalesce(' · ' || h.reason_code, '') || coalesce(' — ' || left(h.note, 200), '')) as summary,
    'client_status_history'::text as source_table
  from client_status_history h
  union all
  select c.client_id, c.id, 'call'::text, c.called_at, c.call_type,
    trim(both ' ' from c.call_type || coalesce(' · ' || left(c.attendees, 80), '')
      || coalesce(' — ' || left(coalesce(c.notes, c.transcript), 200), '')),
    'client_calls'::text from client_calls c where c.deleted_at is null
  union all
  select n.client_id, n.id, 'note'::text, n.created_at, n.note_type,
    trim(both ' ' from n.note_type || coalesce(' · ' || n.reason_code, '') || ' — ' || left(n.body, 200)),
    'client_notes'::text from client_notes n where n.deleted_at is null
  union all
  select a.client_id, a.id, 'action'::text,
    coalesce(
      a.change_date::timestamptz at time zone 'UTC',
      a.planned_date::timestamptz at time zone 'UTC',
      a.created_at
    ),
    coalesce(a.work_type, a.status, 'action'),
    trim(both ' ' from coalesce(a.work_type, 'work')
      || ' · ' || a.title
      || coalesce(' · ' || a.status, '')
      || coalesce(' · ' || a.success_metric, '')
      || coalesce(' · review ' || a.review_date::text, '')
      || coalesce(' — ' || left(a.change_description, 120), '')),
    'client_action_logs'::text from client_action_logs a
  union all
  select b.client_id, b.id, 'billing'::text, (b.billed_on::timestamptz at time zone 'UTC'), b.status,
    trim(both ' ' from 'Billing ' || b.status || ' $' || coalesce(b.amount::text, '0')
      || coalesce(' — ' || left(b.note, 160), '')),
    'client_billings'::text from client_billings b where b.status is distinct from 'voided'
  union all
  -- Dated from when the touchpoint was raised, not when it was closed, so open
  -- and snoozed work still appears on the timeline.
  select t.client_id, t.id, 'touchpoint'::text, t.triggered_at, t.status,
    trim(both ' ' from replace(t.touchpoint_type, '_', ' ')
      || ' · ' || t.status
      || coalesce(' · ' || t.playbook_stage, '')
      || coalesce(' — ' || left(t.completion_note, 160), '')),
    'cs_touchpoints'::text from cs_touchpoints t
  union all
  select m.client_id, m.id, 'commitment'::text, m.created_at, m.status,
    trim(both ' ' from m.severity || ' · ' || m.status
      || coalesce(' · ' || nullif(m.constraint_label, ''), '')
      || ' · due ' || m.due_date::text
      || coalesce(' — ' || left(nullif(m.plan, ''), 160), '')
      || coalesce(' (why: ' || left(nullif(m.why, ''), 120) || ')', '')),
    'meeting_commitments'::text from meeting_commitments m
  union all
  select p.client_id, p.id, 'plan'::text,
    (p.week_start::timestamptz at time zone 'UTC'), p.status,
    trim(both ' ' from 'Week of ' || p.week_start::text || ' · ' || p.status
      || coalesce(' · ' || p.severity, '')
      || coalesce(' — ' || left(nullif(p.why, ''), 160), '')
      || coalesce(' · signal: ' || left(nullif(p.success_signal, ''), 100), '')),
    'account_week_plans'::text from account_week_plans p
  union all
  select k.client_id, k.id, 'task'::text, k.created_at, k.status,
    trim(both ' ' from coalesce(k.work_type || ' · ', '') || k.title || ' · ' || k.status
      || coalesce(' · ' || k.tactic_tag, '')
      || coalesce(' · verdict ' || k.review_verdict, '')
      || coalesce(' — ' || left(k.completion_report, 160), '')),
    'account_plan_tasks'::text from account_plan_tasks k
  union all
  select s.client_id, s.id, 'health'::text,
    (s.period_end::timestamptz at time zone 'UTC'), coalesce(s.worst_tier, 'unknown'),
    trim(both ' ' from coalesce(s.window_code, 'health check')
      || ' ' || s.period_start::text || '→' || s.period_end::text
      || coalesce(' · tier ' || s.worst_tier, '')
      || coalesce(' · attention ' || round(s.attention_score, 1)::text, '')
      || coalesce(' · constraint ' || coalesce(nullif(s.constraint_label, ''), s.primary_constraint), '')),
    'client_health_snapshots'::text from client_health_snapshots s
  union all
  select r.client_id, r.id, 'mrr'::text, r.changed_at,
    case
      when coalesce(r.new_mrr, 0) > coalesce(r.previous_mrr, 0) then 'increase'
      when coalesce(r.new_mrr, 0) < coalesce(r.previous_mrr, 0) then 'decrease'
      else 'change'
    end,
    trim(both ' ' from 'MRR $' || coalesce(r.previous_mrr::text, '0')
      || ' → $' || coalesce(r.new_mrr::text, '0')
      || coalesce(' — ' || left(r.note, 160), '')),
    'client_mrr_history'::text from client_mrr_history r;

grant select on v_client_activity to service_role;
grant select on v_client_activity to authenticated;
