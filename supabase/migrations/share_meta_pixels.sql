-- Apply after add_meta_pixels.sql.
-- Pixels are a small shared library (one reverse, one DSCR).
-- Each client file picks which pixel its events go to.

alter table public.clients
  add column if not exists meta_pixel_id uuid;

update public.clients c
set meta_pixel_id = p.id
from public.meta_pixels p
where p.client_id = c.id
  and c.meta_pixel_id is null;

alter table public.meta_pixels drop column if exists client_id;

alter table public.clients
  drop constraint if exists clients_meta_pixel_id_fkey;

alter table public.clients
  add constraint clients_meta_pixel_id_fkey
  foreign key (meta_pixel_id) references public.meta_pixels(id) on delete set null;

create index if not exists clients_meta_pixel_id_idx
  on public.clients (meta_pixel_id)
  where meta_pixel_id is not null;
