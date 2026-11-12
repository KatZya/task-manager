-- Task Manager schema for Supabase (PostgreSQL).
-- Run once in: Dashboard → SQL Editor → New query → paste → Run.

-- ---------- TABLES ----------

-- Public profile mirror of auth.users (auth.users itself is not exposed).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  icon text not null default 'list',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  done boolean not null default false,
  due date,
  priority text check (priority in ('low', 'medium', 'high')),
  tags text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists lists_user_id_idx on public.lists (user_id);
create index if not exists tasks_list_id_idx on public.tasks (list_id);

-- ---------- AUTO-CREATE PROFILE ON SIGNUP ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- ROW LEVEL SECURITY ----------

alter table public.profiles enable row level security;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;

-- Profiles: a user sees and edits only their own row.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Lists: full access only to own lists.
create policy "lists_select_own" on public.lists
  for select using (auth.uid() = user_id);
create policy "lists_insert_own" on public.lists
  for insert with check (auth.uid() = user_id);
create policy "lists_update_own" on public.lists
  for update using (auth.uid() = user_id);
create policy "lists_delete_own" on public.lists
  for delete using (auth.uid() = user_id);

-- Tasks: access through parent list ownership.
create policy "tasks_select_own" on public.tasks
  for select using (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
create policy "tasks_insert_own" on public.tasks
  for insert with check (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
create policy "tasks_update_own" on public.tasks
  for update using (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
create policy "tasks_delete_own" on public.tasks
  for delete using (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
