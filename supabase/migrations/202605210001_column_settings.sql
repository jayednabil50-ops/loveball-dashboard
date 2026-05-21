create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.column_settings (
  id uuid default gen_random_uuid() primary key,
  table_name text not null,
  column_key text not null,
  display_name text not null,
  updated_at timestamp default now(),
  unique(table_name, column_key)
);

alter table public.column_settings enable row level security;

drop policy if exists column_settings_all on public.column_settings;
create policy column_settings_all
on public.column_settings
for all
to anon, authenticated
using (true)
with check (true);

drop trigger if exists trg_column_settings_updated_at on public.column_settings;
create trigger trg_column_settings_updated_at
before update on public.column_settings
for each row execute function public.set_updated_at();
