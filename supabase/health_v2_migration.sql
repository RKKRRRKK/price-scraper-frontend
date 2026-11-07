-- Health Bridge v2 migration. Idempotent; paste the whole file into the Supabase SQL
-- editor. It (1) adds `health_sessions.details` (workout summary, HR curve, GPS
-- route) and makes health_ingest store it, and (2) gives every source-filtered query
-- a cutover (p_legacy_source, p_cutover) so Mi Fitness history and Health Bridge
-- data join into one series, and health_sources returns each pair's first_at.
-- Until it runs the dashboard still works: it shows Health Bridge data only and
-- workouts without extra detail.

alter table public.health_sessions add column if not exists details jsonb;

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
