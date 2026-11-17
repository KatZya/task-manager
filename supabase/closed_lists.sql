-- Closed (archived) lists: a flag on lists. Closed lists disappear from the
-- main grid and can be reopened from the sidebar.
-- Run once in: Dashboard → SQL Editor → New query → paste → Run.

alter table public.lists
  add column if not exists is_closed boolean not null default false;
