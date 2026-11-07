-- Health — watch and scale data for the Sensors → Health view. Run this in the
-- Supabase SQL editor (these tables are not managed by repo migrations, matching
-- how the app's other tables were made). Already ran an older copy? Run
-- health_v2_migration.sql instead: it adds `details`, the new ingest and the
-- cutover-aware query functions.
--
-- Data path (Health Bridge v2):
--   Xiaomi Watch S5 (Bluetooth Classic) + Mi Body Composition Scale 2 (BLE)
--   → native/health-bridge app (Room DB on the phone)
--   → POST /rest/v1/rpc/health_ingest (anon key + per-phone token) → these tables
-- (v1 went watch → Mi Fitness → Health Connect → the same app; those rows keep
-- their own `source`, the dashboard prefers `healthbridge`.)
--
-- The phone never signs in: it holds a random token whose sha256 lives in
-- health_ingest_tokens. health_ingest() (security definer) maps the token to its
-- user and writes the batch. Tokens are made from the web app's "Link phone"
-- dialog via health_create_token().
--
-- health_ingest payload:
--   {
--     "samples":  [ { "id": "hb:<metric>:<utc day yyyy-mm-dd>", "metric": "heart_rate",
--                     "source": "healthbridge",
--                     "points": [ ["<start iso>", "<end iso>"|null, 72], ... ] } ],
--     "sessions": [ { "id": "hb:sleep:<start epoch s>" | "hb:exercise:<start epoch s>",
--                     "kind": "sleep"|"exercise", "source": "healthbridge",
--                     "start": "...", "end": "...", "title": null,
--                     "exercise_type": 56,                       -- exercise only
--                     "stages": [ { "stage": "deep", "start": "...", "end": "..." } ],
--                     "details": { "kcal": 312, "distance_m": 5200, "avg_hr": 142,
--                                  "hr_zones_s": { ... }, "hr": [[epoch s, bpm], ...],
--                                  "gps": [[epoch s, lat, lon, alt|null], ...], ... } } ],
--     "deleted":  [ "<record id>", ... ]
--   }
-- Every record id in a batch replaces what was stored for it, so a whole metric-day
-- re-sent by the phone never leaves stale rows. (v1 ids were Health Connect ids.)
--
-- Metrics: heart_rate, steps, active_kcal, distance_m, spo2, stress, body_energy,
-- resting_heart_rate, pai, vo2max, skin_temp_c, hrv_rmssd, respiratory_rate, and
-- from the scale weight_kg, body_fat_pct, muscle_kg, water_pct, bone_kg,
-- visceral_fat, bmr_kcal, bmi, impedance. (v1 also wrote total_kcal and floors.)

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.health_samples (
  user_id     uuid not null references auth.users (id) on delete cascade,
  record_id   text not null,                 -- Health Connect record id
  metric      text not null,
  start_time  timestamptz not null,
  end_time    timestamptz,                   -- null for instantaneous samples
  value       double precision not null,
  source      text,                          -- package that wrote it to Health Connect
  primary key (user_id, record_id, metric, start_time)
);

create index if not exists health_samples_metric_time
  on public.health_samples (user_id, metric, start_time);

create table if not exists public.health_sessions (
  user_id        uuid not null references auth.users (id) on delete cascade,
  record_id      text not null,
  kind           text not null,              -- 'sleep' | 'exercise'
  start_time     timestamptz not null,
  end_time       timestamptz not null,
  title          text,
  exercise_type  int,                        -- Health Connect EXERCISE_TYPE_* constant
  stages         jsonb not null default '[]'::jsonb,
  source         text,
  details        jsonb,                      -- workout summary, HR curve, GPS route (Health Bridge v2)
  primary key (user_id, record_id)
);

alter table public.health_sessions add column if not exists details jsonb;

create index if not exists health_sessions_time
  on public.health_sessions (user_id, kind, start_time);

create table if not exists public.health_ingest_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  token_hash    text not null unique,        -- hex sha256 of the token
  device        text,                        -- reported by the phone on each sync
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Reads only: all writes go through health_ingest().
alter table public.health_samples       enable row level security;
alter table public.health_sessions      enable row level security;
alter table public.health_ingest_tokens enable row level security;

drop policy if exists "health_samples own" on public.health_samples;
create policy "health_samples own" on public.health_samples
  for select using (user_id = auth.uid());

drop policy if exists "health_sessions own" on public.health_sessions;
create policy "health_sessions own" on public.health_sessions
  for select using (user_id = auth.uid());

drop policy if exists "health_ingest_tokens own" on public.health_ingest_tokens;
create policy "health_ingest_tokens own" on public.health_ingest_tokens
  for select using (user_id = auth.uid());

-- ── Token ───────────────────────────────────────────────────────────────────
-- Makes a fresh phone token for the signed-in user and returns it (only its hash
-- is kept). One phone per user: a new token replaces the old one.
create or replace function public.health_create_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from health_ingest_tokens where user_id = auth.uid();
  insert into health_ingest_tokens (user_id, token_hash)
  values (auth.uid(), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  return v_token;
end;
$$;

revoke all on function public.health_create_token() from public;
grant execute on function public.health_create_token() to authenticated;

-- ── Ingest ──────────────────────────────────────────────────────────────────
create or replace function public.health_ingest(p_token text, p_payload jsonb, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid;
  v_ids       text[];
  v_samples   int := 0;
  v_sessions  int := 0;
begin
  update health_ingest_tokens
     set last_used_at = now(),
         device = coalesce(p_device, device)
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  returning user_id into v_user;

  if v_user is null then
    raise exception 'invalid health token' using errcode = '28000';
  end if;

  v_ids := array(
    select jsonb_array_elements_text(coalesce(p_payload->'deleted', '[]'::jsonb))
    union select r->>'id' from jsonb_array_elements(coalesce(p_payload->'samples', '[]'::jsonb)) r
    union select r->>'id' from jsonb_array_elements(coalesce(p_payload->'sessions', '[]'::jsonb)) r
  );

  delete from health_samples  where user_id = v_user and record_id = any (v_ids);
  delete from health_sessions where user_id = v_user and record_id = any (v_ids);

  insert into health_samples (user_id, record_id, metric, start_time, end_time, value, source)
  select v_user, r->>'id', r->>'metric',
         (p->>0)::timestamptz, (p->>1)::timestamptz, (p->>2)::double precision, r->>'source'
    from jsonb_array_elements(coalesce(p_payload->'samples', '[]'::jsonb)) r,
         jsonb_array_elements(r->'points') p
  on conflict do nothing;
  get diagnostics v_samples = row_count;

  insert into health_sessions (user_id, record_id, kind, start_time, end_time, title, exercise_type, stages, source, details)
  select v_user, s->>'id', s->>'kind', (s->>'start')::timestamptz, (s->>'end')::timestamptz,
         s->>'title', (s->>'exercise_type')::int, coalesce(s->'stages', '[]'::jsonb), s->>'source', s->'details'
    from jsonb_array_elements(coalesce(p_payload->'sessions', '[]'::jsonb)) s
  on conflict do nothing;
  get diagnostics v_sessions = row_count;

  return jsonb_build_object(
    'samples', v_samples,
    'sessions', v_sessions,
    'deleted', jsonb_array_length(coalesce(p_payload->'deleted', '[]'::jsonb))
  );
end;
$$;

revoke all on function public.health_ingest(text, jsonb, text) from public;
grant execute on function public.health_ingest(text, jsonb, text) to anon, authenticated;

-- ── Queries (security invoker — RLS scopes them to the caller) ──────────────
-- Every source-filtered query takes an optional cutover so the old app's history
-- and Health Bridge's data join into one series: rows from p_source at or after
-- p_cutover, plus rows from p_legacy_source before it. Leave both null (or omit
-- them) for a plain single-source filter. The signatures changed, so the old ones
-- are dropped first (PostgREST can't choose between overloads).
drop function if exists public.health_series(text, int, timestamptz, timestamptz, text);
drop function if exists public.health_daily(text, text, timestamptz, timestamptz, text);
drop function if exists public.health_sources(timestamptz);
drop function if exists public.health_points(text, timestamptz, timestamptz, text);
drop function if exists public.health_buckets(text, int, timestamptz, timestamptz, text);
drop function if exists public.health_hr_daily(text, timestamptz, timestamptz, text);

-- Fixed-width time buckets, e.g. heart rate in 15-minute averages.
create or replace function public.health_series(
  p_metric text,
  p_bucket_seconds int,
  p_start timestamptz,
  p_end timestamptz default null,
  p_source text default null,
  p_legacy_source text default null,
  p_cutover timestamptz default null
)
returns table (bucket timestamptz, mean double precision, lo double precision,
               hi double precision, total double precision, n bigint)
language sql
stable
set search_path = public
as $$
  select to_timestamp(floor(extract(epoch from start_time) / p_bucket_seconds) * p_bucket_seconds),
         avg(value), min(value), max(value), sum(value), count(*)
    from health_samples
   where metric = p_metric
     and start_time >= p_start
     and start_time < coalesce(p_end, now())
     and (p_source is null
          or (source = p_source and (p_cutover is null or start_time >= p_cutover))
          or (p_legacy_source is not null and source = p_legacy_source and start_time < p_cutover))
   group by 1
   order by 1
$$;

-- Calendar days in the viewer's time zone, e.g. steps per day.
create or replace function public.health_daily(
  p_metric text,
  p_tz text,
  p_start timestamptz,
  p_end timestamptz default null,
  p_source text default null,
  p_legacy_source text default null,
  p_cutover timestamptz default null
)
returns table (day date, mean double precision, lo double precision,
               hi double precision, total double precision, n bigint)
language sql
stable
set search_path = public
as $$
  select (start_time at time zone p_tz)::date,
         avg(value), min(value), max(value), sum(value), count(*)
    from health_samples
   where metric = p_metric
     and start_time >= p_start
     and start_time < coalesce(p_end, now())
     and (p_source is null
          or (source = p_source and (p_cutover is null or start_time >= p_cutover))
          or (p_legacy_source is not null and source = p_legacy_source and start_time < p_cutover))
   group by 1
   order by 1
$$;

-- Which metrics exist and which apps wrote them, with each pair's first and last
-- reading (the same metric can come from the old app and from Health Bridge; the
-- view cuts over from one to the other at Health Bridge's first reading).
create or replace function public.health_sources(p_start timestamptz)
returns table (metric text, source text, n bigint, first_at timestamptz, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  select metric, source, count(*), min(start_time), max(start_time)
    from health_samples
   where start_time >= p_start
   group by 1, 2
$$;

-- ── Dashboard queries ───────────────────────────────────────────────────────
-- These return ONE jsonb array instead of rows, so PostgREST's 1000-row cap
-- never truncates a day of minute-by-minute heart rate.

-- Raw readings in a window: [[start_ms, end_ms|null, value], ...] oldest first.
create or replace function public.health_points(
  p_metric text,
  p_start timestamptz,
  p_end timestamptz default null,
  p_source text default null,
  p_legacy_source text default null,
  p_cutover timestamptz default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           (extract(epoch from start_time) * 1000)::bigint,
           (extract(epoch from end_time) * 1000)::bigint,
           value
         ) order by start_time), '[]'::jsonb)
    from health_samples
   where metric = p_metric
     and start_time >= p_start
     and start_time < coalesce(p_end, 'infinity')
     and (p_source is null
          or (source = p_source and (p_cutover is null or start_time >= p_cutover))
          or (p_legacy_source is not null and source = p_legacy_source and start_time < p_cutover))
$$;

-- Fixed-width buckets: [[bucket_ms, mean, lo, hi, total, n], ...] oldest first.
create or replace function public.health_buckets(
  p_metric text,
  p_bucket_seconds int,
  p_start timestamptz,
  p_end timestamptz default null,
  p_source text default null,
  p_legacy_source text default null,
  p_cutover timestamptz default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(b, mean, lo, hi, total, n) order by b), '[]'::jsonb)
    from (
      select (floor(extract(epoch from start_time) / p_bucket_seconds) * p_bucket_seconds * 1000)::bigint as b,
             round(avg(value)::numeric, 2) as mean,
             min(value) as lo,
             max(value) as hi,
             sum(value) as total,
             count(*) as n
        from health_samples
       where metric = p_metric
         and start_time >= p_start
         and start_time < coalesce(p_end, 'infinity')
         and (p_source is null
              or (source = p_source and (p_cutover is null or start_time >= p_cutover))
              or (p_legacy_source is not null and source = p_legacy_source and start_time < p_cutover))
       group by 1
    ) t
$$;

-- Heart rate per local calendar day; p05 stands in for resting HR when the
-- watch doesn't write resting_heart_rate.
create or replace function public.health_hr_daily(
  p_tz text,
  p_start timestamptz,
  p_end timestamptz default null,
  p_source text default null,
  p_legacy_source text default null,
  p_cutover timestamptz default null
)
returns table (day date, lo double precision, p05 double precision,
               mean double precision, hi double precision, n bigint)
language sql
stable
set search_path = public
as $$
  select (start_time at time zone p_tz)::date,
         min(value),
         percentile_cont(0.05) within group (order by value),
         avg(value),
         max(value),
         count(*)
    from health_samples
   where metric = 'heart_rate'
     and start_time >= p_start
     and start_time < coalesce(p_end, 'infinity')
     and (p_source is null
          or (source = p_source and (p_cutover is null or start_time >= p_cutover))
          or (p_legacy_source is not null and source = p_legacy_source and start_time < p_cutover))
   group by 1
   order by 1
$$;

revoke all on function public.health_series(text, int, timestamptz, timestamptz, text, text, timestamptz) from public;
revoke all on function public.health_daily(text, text, timestamptz, timestamptz, text, text, timestamptz) from public;
revoke all on function public.health_sources(timestamptz) from public;
revoke all on function public.health_points(text, timestamptz, timestamptz, text, text, timestamptz) from public;
revoke all on function public.health_buckets(text, int, timestamptz, timestamptz, text, text, timestamptz) from public;
revoke all on function public.health_hr_daily(text, timestamptz, timestamptz, text, text, timestamptz) from public;
grant execute on function public.health_series(text, int, timestamptz, timestamptz, text, text, timestamptz) to authenticated;
grant execute on function public.health_daily(text, text, timestamptz, timestamptz, text, text, timestamptz) to authenticated;
grant execute on function public.health_sources(timestamptz) to authenticated;
grant execute on function public.health_points(text, timestamptz, timestamptz, text, text, timestamptz) to authenticated;
grant execute on function public.health_buckets(text, int, timestamptz, timestamptz, text, text, timestamptz) to authenticated;
grant execute on function public.health_hr_daily(text, timestamptz, timestamptz, text, text, timestamptz) to authenticated;
