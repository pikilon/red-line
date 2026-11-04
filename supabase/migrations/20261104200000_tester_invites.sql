-- Tester invite links replace email accounts (specs/47-tester-reports.md §3).
drop trigger if exists only_testers_sign_up on auth.users;
drop function if exists public.only_testers_sign_up();
drop table if exists public.testers;

-- One row per invited tester; the invite link carries a secret whose
-- SHA-256 is stored here. Deleting the row revokes the link. No policies:
-- only the service role (the report function) reads it.
create table public.testers (
  name text primary key check (length(trim(name)) between 1 and 60),
  token_hash text not null unique,
  added_at timestamptz not null default now()
);
alter table public.testers enable row level security;
