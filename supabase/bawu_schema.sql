-- Bawu — practice aid for a bawu flute (Tools section). Run this in the Supabase
-- SQL editor (these tables are not managed by repo migrations, matching how the
-- app's other tools' tables were created).
--
-- Folders mirror canvy_folders. A score is one transcribed piece: the whole
-- note list (jianpu lines, key, tempo) lives in `data` as JSONB. Scores made
-- from a photo/screenshot keep the original picture in the private `bawu`
-- storage bucket (`image_path`), and `ai_meta` records the conversion (model,
-- usage, raw reply) so every AI conversion is stored alongside its picture.
--
-- `data` shape:
--   {
--     "key": "F",            -- jianpu key (1=F)
--     "bpm": 80,             -- score tempo
--     "timeSig": "4/4",
--     "lines": [             -- systems, in reading order (drives the
--       { "notes": [         --  where-are-we indicator on the original image)
--         { "deg": 1, "oct": 0, "beats": 1 }   -- deg 0 = rest; oct -1/0/+1
--       ] }
--     ]
--   }
--
-- Every note field beyond deg/oct/beats is OPTIONAL and simply absent when
-- unset, so older rows stay valid without a migration:
--   "acc": 1 | -1 | 2          sharp / flat / natural printed on this note
--   "ly", "py"                 sung syllable and its tone-marked pinyin
--   "art": "T"|"TK"|"tr"|"grace"   articulation
--   "ti": 1                    tied into the next note (same pitch) — one sound
--   "sl": 1                    slurred into the next note (different pitch)
--   "gi": 1                    glissando into this note at the attack
--   "go": "off" | "to"         falls away, or portamento to the next note
--   "bd": -2..2                bend in semitones during the note, and back
--   "vb": 0..3                 vibrato depth (3 = flutter tongue)
--
-- `data` may also carry "origKey" (the key the score was imported in),
-- "contentTop"/"contentBottom" (the printed music block's vertical span on the
-- picture, as fractions of its height) and "adjusted" — a hand-edited
-- { key, bpm, timeSig, lines } variant kept alongside the AI transcription so
-- the original is never overwritten.

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.bawu_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.bawu_scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  folder_id   uuid references public.bawu_folders (id) on delete set null,
  source      text not null default 'manual',        -- 'image' | 'manual'
  data        jsonb not null default '{}'::jsonb,
  image_path  text,                                  -- storage path in the `bawu` bucket
  ai_meta     jsonb,                                 -- { model, usage, raw } for AI conversions
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bawu_scores_user_idx
  on public.bawu_scores (user_id, updated_at desc);
create index if not exists bawu_scores_folder_idx
  on public.bawu_scores (folder_id);
create index if not exists bawu_folders_user_idx
  on public.bawu_folders (user_id, name);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.bawu_scores  enable row level security;
alter table public.bawu_folders enable row level security;

drop policy if exists "bawu_scores owner access" on public.bawu_scores;
create policy "bawu_scores owner access"
  on public.bawu_scores
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "bawu_folders owner access" on public.bawu_folders;
create policy "bawu_folders owner access"
  on public.bawu_folders
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Global whitelist restriction ─────────────────────────────────────────────
-- Mirrors the restrictive policy used on the app's other tables. Restrictive
-- policies AND with the permissive owner policy above.
drop policy if exists "global_app_a_whitelist_restriction" on public.bawu_scores;
create policy "global_app_a_whitelist_restriction"
  on public.bawu_scores
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );

drop policy if exists "global_app_a_whitelist_restriction" on public.bawu_folders;
create policy "global_app_a_whitelist_restriction"
  on public.bawu_folders
  as restrictive
  for all
  to public
  using ( is_whitelisted_user(auth.uid()) );

-- ── Storage: private `bawu` bucket for original score pictures ───────────────
-- Files are stored under <user_id>/<score_id>.<ext>; the app reads them via
-- short-lived signed URLs (same pattern as the `documents` bucket).
insert into storage.buckets (id, name, public)
values ('bawu', 'bawu', false)
on conflict (id) do nothing;

drop policy if exists "bawu images owner all" on storage.objects;
create policy "bawu images owner all"
  on storage.objects
  for all
  using (
    bucket_id = 'bawu'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'bawu'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
