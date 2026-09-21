-- Groovy — metronome, timing trainer and lightweight bass amp (Tools section).
-- Run this in the Supabase SQL editor; these tables are not managed by repo
-- migrations, matching how the app's other tools' tables were created.
--
-- One row per recorded take. A take is a stretch of playing against a known
-- grid, so the row carries three things: the grid it was played to
-- (`settings`), every attack the detector found (`hits`), and the numbers
-- derived from them (`stats`). `stats` is denormalised on purpose — the
-- catalogue lists dozens of takes and should not have to re-derive a standard
-- deviation from a few hundred hits to draw the list.
--
-- Practice settings that are per-machine (which input, the interface's latency
-- offset, amp knob positions) deliberately do NOT live here — they are in
-- localStorage, because one desk's calibration is meaningless on another.
--
-- `settings` shape:
--   {
--     "bpm": 90,
--     "meterId": "4/4",        -- 4/4 | 3/4 | 2/4 | 6/8 | 12/8
--     "subdiv": 2,             -- grid lines per pulse (1,2,3,4,6)
--     "toleranceMs": 25,       -- the "in pocket" window used for stats
--     "offsetMs": 12.5,        -- latency offset subtracted from every hit
--     -- Rows written between Sep 18 and Sep 20 2026 also carry
--     -- "offsetVerified". The app no longer writes or reads it: the offset is
--     -- measured fresh each session and never restored, so there is nothing
--     -- left for the flag to warn about.
--     "drumsOn": true,
--     "patternId": "rock",
--     "clickSubdivisions": false,
--     "countInBars": 1
--   }
--
-- `hits` is an array, in playing order. Negative deviation is EARLY (rushing),
-- positive is LATE (dragging) — the same convention the whole app uses:
--   { "t": 3.482,      -- seconds from the start of the take
--     "devMs": -12.4,  -- distance from the nearest grid line
--     "slot": 27,      -- absolute slot index on the transport's grid
--     "slotInBar": 3,  -- position within the bar (indexes settings.subdiv grid)
--     "bar": 6,
--     "midi": 45,      -- detected pitch, or null when the tracker was unsure
--     "freq": 110.3,
--     "str": 0.21 }    -- attack strength, 0…1-ish; drives the dot size
--
-- `stats` mirrors src/lib/groovy/analysis.js — summarise():
--   { count, meanMs, sdMs, medianMs, medAbsMs, maxAbsMs,
--     inPocketPct, rushPct, dragPct, toleranceMs, slotsPerBar,
--     bySlot: [ { slotInBar, label, isPulse, n, meanMs, sdMs } ],
--     worst:  { slotInBar, label, n, meanMs, sdMs } | null }

-- ── Table ───────────────────────────────────────────────────────────────────
create table if not exists public.groovy_takes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  settings     jsonb not null default '{}'::jsonb,
  hits         jsonb not null default '[]'::jsonb,
  stats        jsonb not null default '{}'::jsonb,
  duration_ms  integer not null default 0,
  audio_path   text,                                -- storage path in the `groovy` bucket
  created_at   timestamptz not null default now()
);

create index if not exists groovy_takes_user_idx
  on public.groovy_takes (user_id, created_at desc);

-- Comparing like with like ("all my 4/4 takes at 90") is the main way the
-- catalogue gets filtered, so index the two settings keys it filters on.
create index if not exists groovy_takes_grid_idx
  on public.groovy_takes ((settings ->> 'meterId'), ((settings ->> 'bpm')::int));

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.groovy_takes enable row level security;

drop policy if exists "groovy_takes owner access" on public.groovy_takes;
create policy "groovy_takes owner access"
  on public.groovy_takes
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Global whitelist restriction ────────────────────────────────────────────
-- Mirrors the restrictive policy used on the app's other tables. Restrictive
-- policies AND with the permissive owner policy above.
drop policy if exists "global_app_a_whitelist_restriction" on public.groovy_takes;
create policy "global_app_a_whitelist_restriction"
  on public.groovy_takes
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );

-- ── Storage: private `groovy` bucket for optional take audio ────────────────
-- Only written when "keep audio" is on for a take. Files are stored under
-- <user_id>/<take_id>.<ext> and read through short-lived signed URLs, the same
-- pattern as the `bawu` and `documents` buckets.
insert into storage.buckets (id, name, public)
values ('groovy', 'groovy', false)
on conflict (id) do nothing;

drop policy if exists "groovy audio owner all" on storage.objects;
create policy "groovy audio owner all"
  on storage.objects
  for all
  using (
    bucket_id = 'groovy'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'groovy'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
