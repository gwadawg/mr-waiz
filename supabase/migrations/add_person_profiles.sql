-- Loan officer profiles live on client_contacts (the person), including the primary.
-- Optional facts are a catalog-keyed jsonb bag. Notes point at the person from
-- client_notes. Files are rows. No separate people table.

alter table client_contacts add column if not exists profile jsonb not null default '{}'::jsonb;

alter table client_contacts drop constraint if exists client_contacts_type_check;
alter table client_contacts add constraint client_contacts_type_check
  check (contact_type in ('primary_lo', 'loa', 'co_lo', 'other'));

create unique index if not exists client_contacts_one_primary_per_client
  on client_contacts (client_id)
  where contact_type = 'primary_lo';

alter table client_notes add column if not exists contact_id uuid references client_contacts(id) on delete cascade;

create index if not exists client_notes_contact_id_idx
  on client_notes (contact_id)
  where contact_id is not null and deleted_at is null;

create table if not exists client_contact_files (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references client_contacts(id) on delete cascade,
  kind          text not null,
  file_name     text not null,
  content_type  text,
  storage_path  text not null,
  public_url    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  constraint client_contact_files_kind_check check (kind in ('headshot', 'license', 'other'))
);

create index if not exists client_contact_files_contact_id_idx
  on client_contact_files (contact_id, created_at desc);

-- Private attachments (licenses and other files). Headshots stay on the public
-- client-headshots bucket so the card and landing page can read the URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-person-files',
  'client-person-files',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
