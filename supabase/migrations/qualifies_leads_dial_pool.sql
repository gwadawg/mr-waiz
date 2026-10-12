-- Dial pool for hand-raise % and conversation %.
-- Checked: setters only dial and book qualified leads.
-- Unchecked: setters book every lead.
-- Call center stays null; those clients keep their existing formulas.

alter table clients add column if not exists brand_subject text;
alter table clients add column if not exists account_shape text;
alter table clients add column if not exists team_routing_notes text;
alter table clients add column if not exists qualifies_leads boolean;
alter table clients add column if not exists qualification_notes text;

comment on column clients.qualifies_leads is
  'Paid-ads only. True: dial and book qualified leads, so hand-raise and conversation rates use qualified leads. False: book every lead, so those rates use total leads. Null on call center.';
comment on column clients.qualification_notes is
  'What counts as qualified. Only when qualifies_leads is true.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_brand_subject_check') then
    alter table clients add constraint clients_brand_subject_check
      check (brand_subject is null or brand_subject in ('client', 'company'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_account_shape_check') then
    alter table clients add constraint clients_account_shape_check
      check (account_shape is null or account_shape in ('solo', 'team'));
  end if;
end $$;

update clients
set qualifies_leads = true
where reporting_type = 'RM';

update clients
set qualifies_leads = false
where reporting_type = 'DSCR';

update clients
set qualifies_leads = true
where name = 'Peter Escaross DSCR';
