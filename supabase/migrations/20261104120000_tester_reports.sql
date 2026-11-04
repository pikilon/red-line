-- Tester reports (specs/47-tester-reports.md).

-- The owner edits this list in the Supabase table editor. No policies: only
-- the service role (the report function) reads it.
create table public.testers (
  email text primary key check (email = lower(email)),
  name text not null,
  added_at timestamptz not null default now()
);
alter table public.testers enable row level security;

-- Only listed emails can register (spec 47 §3).
create function public.only_testers_sign_up()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.testers where email = lower(new.email)
  ) then
    raise exception 'not on the tester list';
  end if;
  return new;
end;
$$;

create trigger only_testers_sign_up
before insert on auth.users
for each row execute function public.only_testers_sign_up();

-- Screenshots, saves and attachments, linked from public GitHub issues.
insert into storage.buckets (id, name, public, file_size_limit)
values ('reports', 'reports', true, 10485760)
on conflict (id) do nothing;
