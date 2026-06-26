-- Breadboard tool — saved sheets.
-- Run this in the Supabase SQL editor (these tables are not managed by repo
-- migrations, matching how the app's other tables were created).

-- ── Table ────────────────────────────────────────────────────────────────────
-- The whole sheet (breadboards, placed components/boards, wires) lives in `data`
-- as JSONB. A sheet is the unit of work, so no child table is needed.
create table if not exists public.breadboard_sheets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists breadboard_sheets_user_idx
  on public.breadboard_sheets (user_id, updated_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.breadboard_sheets enable row level security;

create policy "breadboard_sheets owner access"
  on public.breadboard_sheets
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Global whitelist restriction ─────────────────────────────────────────────
-- Mirrors the restrictive "global_app_a_whitelist_restriction" policy used on the
-- app's other tables (e.g. public.squell_queries). Restrictive policies AND with
-- the permissive owner policy above, so access requires: owner AND whitelisted.
create policy "global_app_a_whitelist_restriction"
  on public.breadboard_sheets
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );
