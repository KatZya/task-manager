-- Admin panel migration: roles, blocking, admin RLS policies.
-- Run once in: Dashboard → SQL Editor → New query → paste → Run.

-- ---------- 1. Role and block flag ----------

alter table public.profiles
  add column if not exists role text not null default 'user'
    check (role in ('user', 'admin'));
alter table public.profiles
  add column if not exists is_blocked boolean not null default false;

-- ---------- 2. Helper functions (security definer avoids RLS recursion) ----------

-- Is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not is_blocked
  )
$$;

-- Is the current user allowed to touch data (exists and not blocked)?
create or replace function public.current_user_active()
returns boolean
language sql
security definer stable set search_path = public
as $$
  select coalesce(
    (select not is_blocked from public.profiles where id = auth.uid()),
    false
  )
$$;

-- Per-user counters for the admin panel without exposing task content.
create or replace function public.admin_user_stats()
returns table (user_id uuid, lists_count bigint, tasks_count bigint)
language sql
security definer stable set search_path = public
as $$
  select l.user_id, count(distinct l.id), count(t.id)
  from public.lists l
  left join public.tasks t on t.list_id = l.id
  where public.is_admin()
  group by l.user_id
$$;

-- ---------- 3. Admin can read and manage all profiles ----------

create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());

-- ---------- 4. Blocked users lose data access ----------
-- Recreate the data policies with an "active account" check.

drop policy if exists "lists_select_own" on public.lists;
drop policy if exists "lists_insert_own" on public.lists;
drop policy if exists "lists_update_own" on public.lists;
drop policy if exists "lists_delete_own" on public.lists;

create policy "lists_select_own" on public.lists
  for select using (auth.uid() = user_id and public.current_user_active());
create policy "lists_insert_own" on public.lists
  for insert with check (auth.uid() = user_id and public.current_user_active());
create policy "lists_update_own" on public.lists
  for update using (auth.uid() = user_id and public.current_user_active());
create policy "lists_delete_own" on public.lists
  for delete using (auth.uid() = user_id and public.current_user_active());

drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;

create policy "tasks_select_own" on public.tasks
  for select using (
    public.current_user_active()
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
create policy "tasks_insert_own" on public.tasks
  for insert with check (
    public.current_user_active()
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
create policy "tasks_update_own" on public.tasks
  for update using (
    public.current_user_active()
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
create policy "tasks_delete_own" on public.tasks
  for delete using (
    public.current_user_active()
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );

-- ---------- 5. Make yourself the first admin ----------
-- Replace the email with yours, then run this statement (or the whole file):

-- update public.profiles set role = 'admin' where email = 'you@example.com';
