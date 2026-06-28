-- Squell — SQL query versioning catalogue
-- Run this in the Supabase SQL editor (these tables are not managed by repo migrations,
-- matching how the app's other tables were created).

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.squell_queries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  dialect     text not null default 'bigquery',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.squell_versions (
  id             uuid primary key default gen_random_uuid(),
  query_id       uuid not null references public.squell_queries (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  version_number int not null,
  sql_text       text not null,
  note           text,           -- user-written note
  ai_note        text,           -- AI-generated note (kept distinct from the user's)
  created_at     timestamptz not null default now()
);

-- Folders group queries in the catalogue rail (e.g. "Payment Queries").
create table if not exists public.squell_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Migration for existing installs: add the distinct AI note column. Safe to re-run.
alter table public.squell_versions add column if not exists ai_note text;
-- Migration: tie a query to an optional folder. on delete set null leaves the
-- query intact (ungrouped) when its folder is removed. Safe to re-run.
alter table public.squell_queries
  add column if not exists folder_id uuid references public.squell_folders (id) on delete set null;

create index if not exists squell_queries_user_idx
  on public.squell_queries (user_id, updated_at desc);
create index if not exists squell_queries_folder_idx
  on public.squell_queries (folder_id);
create index if not exists squell_versions_query_idx
  on public.squell_versions (query_id, version_number);
create index if not exists squell_folders_user_idx
  on public.squell_folders (user_id, name);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.squell_queries  enable row level security;
alter table public.squell_versions enable row level security;
alter table public.squell_folders  enable row level security;

drop policy if exists "squell_queries owner access" on public.squell_queries;
create policy "squell_queries owner access"
  on public.squell_queries
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "squell_versions owner access" on public.squell_versions;
create policy "squell_versions owner access"
  on public.squell_versions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "squell_folders owner access" on public.squell_folders;
create policy "squell_folders owner access"
  on public.squell_folders
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Global whitelist restriction ─────────────────────────────────────────────
-- Mirrors the restrictive "global_app_a_whitelist_restriction" policy used on the
-- app's other tables (e.g. public.reminders). Restrictive policies AND with the
-- permissive owner policy above, so access requires: owner AND whitelisted user.
drop policy if exists "global_app_a_whitelist_restriction" on public.squell_queries;
create policy "global_app_a_whitelist_restriction"
  on public.squell_queries
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );

drop policy if exists "global_app_a_whitelist_restriction" on public.squell_versions;
create policy "global_app_a_whitelist_restriction"
  on public.squell_versions
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );

drop policy if exists "global_app_a_whitelist_restriction" on public.squell_folders;
create policy "global_app_a_whitelist_restriction"
  on public.squell_folders
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );
