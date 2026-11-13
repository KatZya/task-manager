-- Task attachments: table + private Storage bucket + RLS.
-- Run once in: Dashboard → SQL Editor → New query → paste → Run.

-- ---------- 1. Table ----------

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  size_bytes integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists attachments_task_id_idx on public.attachments (task_id);

alter table public.attachments enable row level security;

-- Access follows parent-list ownership (same pattern as tasks).
create policy "attachments_select_own" on public.attachments
  for select using (
    public.current_user_active()
    and exists (
      select 1 from public.tasks t
      join public.lists l on l.id = t.list_id
      where t.id = task_id and l.user_id = auth.uid()
    )
  );
create policy "attachments_insert_own" on public.attachments
  for insert with check (
    auth.uid() = user_id
    and public.current_user_active()
    and exists (
      select 1 from public.tasks t
      join public.lists l on l.id = t.list_id
      where t.id = task_id and l.user_id = auth.uid()
    )
  );
create policy "attachments_delete_own" on public.attachments
  for delete using (auth.uid() = user_id);

-- ---------- 2. Private Storage bucket ----------

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Files live at <userId>/<taskId>/<file>. A user touches only their own folder.
create policy "storage_attachments_select_own" on storage.objects
  for select using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "storage_attachments_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "storage_attachments_delete_own" on storage.objects
  for delete using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Known limitation: deleting a task cascades attachment ROWS, but the files
-- themselves stay in Storage (Postgres triggers can't reach Storage). Orphans
-- are rare and small; a periodic cleanup job can be added later.
