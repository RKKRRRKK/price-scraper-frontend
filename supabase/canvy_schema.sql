-- Canvy — digital whiteboard (Miro-style) boards + folders.
-- Run this in the Supabase SQL editor (these tables are not managed by repo
-- migrations, matching how the app's other tools' tables were created).
--
-- Folders mirror squell_folders (normalized). A board is the unit of work and the
-- whole board (elements, arrows, comments, viewport) lives in `data` as JSONB —
-- same approach as breadboard_sheets.

-- ── Tables ──────────────────────────────────────────────────────────────────
-- Folders group boards in the catalogue rail (e.g. "System Architecture").
create table if not exists public.canvy_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.canvy_boards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  folder_id   uuid references public.canvy_folders (id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Migration for existing installs: tie a board to an optional folder. on delete
-- set null leaves the board intact (ungrouped) when its folder is removed. Safe
-- to re-run.
alter table public.canvy_boards
  add column if not exists folder_id uuid references public.canvy_folders (id) on delete set null;

create index if not exists canvy_boards_user_idx
  on public.canvy_boards (user_id, updated_at desc);
create index if not exists canvy_boards_folder_idx
  on public.canvy_boards (folder_id);
create index if not exists canvy_folders_user_idx
  on public.canvy_folders (user_id, name);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.canvy_boards  enable row level security;
alter table public.canvy_folders enable row level security;

drop policy if exists "canvy_boards owner access" on public.canvy_boards;
create policy "canvy_boards owner access"
  on public.canvy_boards
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "canvy_folders owner access" on public.canvy_folders;
create policy "canvy_folders owner access"
  on public.canvy_folders
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Global whitelist restriction ─────────────────────────────────────────────
-- Mirrors the restrictive "global_app_a_whitelist_restriction" policy used on the
-- app's other tables (e.g. public.squell_queries). Restrictive policies AND with
-- the permissive owner policy above, so access requires: owner AND whitelisted.
drop policy if exists "global_app_a_whitelist_restriction" on public.canvy_boards;
create policy "global_app_a_whitelist_restriction"
  on public.canvy_boards
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );

drop policy if exists "global_app_a_whitelist_restriction" on public.canvy_folders;
create policy "global_app_a_whitelist_restriction"
  on public.canvy_folders
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );
