-- Kickoff redesign: facts the form now stores on the client.
-- Lead Nurturing Host is internal, external, or Both.
-- Booking hours are free text for Call Center.
-- Brand colors are the colors agreed on the kickoff call.

alter table clients add column if not exists lead_nurturing_host text;
alter table clients add column if not exists booking_hours text;
alter table clients add column if not exists brand_colors text;

comment on column clients.lead_nurturing_host is
  'Who nurtures leads: internal, external, or Both.';
comment on column clients.booking_hours is
  'Hours the call center can book. Free text. Call Center only.';
comment on column clients.brand_colors is
  'Brand colors agreed on the kickoff call.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_lead_nurturing_host_check'
  ) then
    alter table clients add constraint clients_lead_nurturing_host_check
      check (
        lead_nurturing_host is null
        or lead_nurturing_host in ('internal', 'external', 'Both')
      );
  end if;
end $$;
