-- Breadboard tool — user parts library + stock list.
-- Run this in the Supabase SQL editor (these tables are not managed by repo
-- migrations, matching breadboard_sheets and the app's other tables).

-- ── Table ────────────────────────────────────────────────────────────────────
-- One row per user. `custom_parts` holds the user-defined part definitions and
-- `stock` is a JSON map of partKind -> true for the parts they physically have.
create table if not exists public.breadboard_library (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  custom_parts jsonb not null default '[]'::jsonb,
  stock        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.breadboard_library enable row level security;

create policy "breadboard_library owner access"
  on public.breadboard_library
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Global whitelist restriction ─────────────────────────────────────────────
-- Mirrors the restrictive policy used on the app's other tables (e.g.
-- public.breadboard_sheets, public.squell_queries). Restrictive policies AND with
-- the permissive owner policy above, so access requires: owner AND whitelisted.
create policy "global_app_a_whitelist_restriction"
  on public.breadboard_library
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );
