-- Apply after add_utm_term.sql. That file owns the previous refresh trigger.
-- Meta Conversions API pixels, one per client, plus the hidden click id
-- used to match later CRM stages back to the ad click.
-- fbclid is data only: no dashboard, roster, or lead profile reads it.

alter table public.events add column if not exists fbclid text;
alter table public.leads add column if not exists fbclid text;

create table if not exists public.meta_pixels (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  pixel_id         text not null,
  access_token     text not null,
  client_id        uuid not null unique references public.clients(id) on delete cascade,
  test_event_code  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint meta_pixels_name_check check (char_length(btrim(name)) > 0),
  constraint meta_pixels_pixel_id_check check (pixel_id ~ '^[0-9]{5,32}$'),
  constraint meta_pixels_token_check check (char_length(btrim(access_token)) > 0)
);

create table if not exists public.meta_capi_sends (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  meta_pixel_id  uuid references public.meta_pixels(id) on delete set null,
  source_key     text not null,
  event_name     text not null,
  status         text not null,
  fbtrace_id     text,
  error          text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  constraint meta_capi_sends_status_check check (status in ('pending', 'sent', 'failed')),
  constraint meta_capi_sends_source_event unique (source_key, event_name)
);

create index if not exists meta_capi_sends_client_created_idx
  on public.meta_capi_sends (client_id, created_at desc);

alter table public.meta_pixels enable row level security;
alter table public.meta_capi_sends enable row level security;

revoke all on public.meta_pixels from public, anon, authenticated;
revoke all on public.meta_capi_sends from public, anon, authenticated;
grant all on public.meta_pixels to service_role;
grant all on public.meta_capi_sends to service_role;

-- First non-empty fbclid sticks. A later blank does not clear it.
-- A lead event wins over any other event that arrived in the same stamp.
create or replace function public.stamp_lead_fbclid(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lead is null then
    return;
  end if;

  update public.leads l
  set fbclid = sub.fbclid
  from (
    select nullif(btrim(e.fbclid), '') as fbclid
    from public.events e
    where e.lead_id = p_lead
      and nullif(btrim(e.fbclid), '') is not null
    order by (e.event_type = 'lead') desc, e.occurred_at, e.id
    limit 1
  ) sub
  where l.id = p_lead
    and nullif(btrim(l.fbclid), '') is null
    and sub.fbclid is not null;
end;
$$;

revoke execute on function public.stamp_lead_fbclid(uuid) from public, anon, authenticated;

create or replace function public.trg_events_refresh_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('leads.skip_refresh', true) = 'on' then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      perform refresh_lead(new.lead_id);
      perform stamp_lead_utm_term(new.lead_id);
      perform stamp_lead_fbclid(new.lead_id);
    elsif tg_op = 'UPDATE' then
      perform refresh_lead(new.lead_id);
      perform stamp_lead_utm_term(new.lead_id);
      perform stamp_lead_fbclid(new.lead_id);
      if old.lead_id is distinct from new.lead_id then
        perform refresh_lead(old.lead_id);
        perform stamp_lead_utm_term(old.lead_id);
        perform stamp_lead_fbclid(old.lead_id);
      end if;
    else
      perform refresh_lead(old.lead_id);
      perform stamp_lead_utm_term(old.lead_id);
      perform stamp_lead_fbclid(old.lead_id);
    end if;
  exception when others then
    raise warning 'refresh_lead failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists events_refresh_lead_update on public.events;
create trigger events_refresh_lead_update
  after update on public.events
  for each row
  when (
    old.lead_id is distinct from new.lead_id
    or old.occurred_at is distinct from new.occurred_at
    or old.scheduled_at is distinct from new.scheduled_at
    or old.external_id is distinct from new.external_id
    or old.event_type is distinct from new.event_type
    or old.utm_content is distinct from new.utm_content
    or old.utm_term is distinct from new.utm_term
    or old.ad_name is distinct from new.ad_name
    or old.lead_source is distinct from new.lead_source
    or old.fbclid is distinct from new.fbclid
    or old.raw is distinct from new.raw
  )
  execute function trg_events_refresh_lead();
