-- Site the lead came from (GHL "UTM Term"). Nullable on purpose: an empty
-- Make value is stored as null and the lead insert still succeeds.
-- Credit score range and property use stay in events.raw (jsonb). That column
-- already accepts extra keys, so those fields need no new columns.

alter table public.events add column if not exists utm_term text;
alter table public.leads add column if not exists utm_term text;

create index if not exists leads_client_utm_term_idx
  on public.leads (client_id, utm_term)
  where utm_term is not null;

-- First lead event that carries a term wins. A later blank does not clear it.
create or replace function public.stamp_lead_utm_term(p_lead uuid)
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
  set utm_term = sub.term
  from (
    select nullif(btrim(e.utm_term), '') as term
    from public.events e
    where e.lead_id = p_lead
      and e.event_type = 'lead'
      and nullif(btrim(e.utm_term), '') is not null
    order by e.occurred_at, e.id
    limit 1
  ) sub
  where l.id = p_lead
    and sub.term is not null
    and l.utm_term is distinct from sub.term;
end;
$$;

revoke execute on function public.stamp_lead_utm_term(uuid) from public, anon, authenticated;

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
    elsif tg_op = 'UPDATE' then
      perform refresh_lead(new.lead_id);
      perform stamp_lead_utm_term(new.lead_id);
      if old.lead_id is distinct from new.lead_id then
        perform refresh_lead(old.lead_id);
        perform stamp_lead_utm_term(old.lead_id);
      end if;
    else
      perform refresh_lead(old.lead_id);
      perform stamp_lead_utm_term(old.lead_id);
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
    or old.raw is distinct from new.raw
  )
  execute function trg_events_refresh_lead();
