-- Read-only: Health Bridge v2 (source 'healthbridge') against Mi Fitness (every other source, e.g.
-- 'com.xiaomi.wearable') over one time window.
--   Run from the repo root:  npx supabase db query --linked -f native/watch-lab/compare.sql
-- Edit the window in `win` below. One result set; `section` says what a row is:
--   metric   per metric and side: count, min / avg / max, first and last time
--   hr_match minute-level heart rate: matched minutes, mean absolute difference, minutes in one side only
--   sleep    sleep sessions of both sides, with minutes per stage in `extra`
-- `side` is 'healthbridge' or 'mifitness'.

with win as (
  select now() - interval '24 hours' as t0,   -- window start (edit)
         now()                       as t1    -- window end (edit)
),
s as (
  select h.metric, h.start_time, h.value,
         case when h.source = 'healthbridge' then 'healthbridge' else 'mifitness' end as side
    from health_samples h, win
   where h.start_time >= win.t0 and h.start_time < win.t1
),
metric_rows as (
  select 'metric'::text as section, metric as label, side,
         count(*)::bigint as n, min(value) as min_v, avg(value) as avg_v, max(value) as max_v,
         min(start_time) as first_at, max(start_time) as last_at, null::jsonb as extra
    from s
   group by metric, side
),
hr_min as (
  select date_trunc('minute', start_time) as minute, side, avg(value) as v
    from s
   where metric = 'heart_rate'
   group by 1, 2
),
hr_join as (
  select coalesce(a.minute, b.minute) as minute, a.v as hb, b.v as mi
    from (select * from hr_min where side = 'healthbridge') a
    full outer join (select * from hr_min where side = 'mifitness') b on a.minute = b.minute
),
hr_row as (
  select 'hr_match'::text as section, 'heart_rate per minute'::text as label, 'both'::text as side,
         count(*) filter (where hb is not null and mi is not null)::bigint as n,
         min(abs(hb - mi)) as min_v, avg(abs(hb - mi)) as avg_v, max(abs(hb - mi)) as max_v,
         min(minute) as first_at, max(minute) as last_at,
         jsonb_build_object(
           'matched_minutes',      count(*) filter (where hb is not null and mi is not null),
           'mean_abs_diff_bpm',    round((avg(abs(hb - mi)))::numeric, 2),
           'only_healthbridge',    count(*) filter (where mi is null),
           'only_mifitness',       count(*) filter (where hb is null)
         ) as extra
    from hr_join
),
sleep_rows as (
  select 'sleep'::text as section, p.record_id as label,
         case when p.source = 'healthbridge' then 'healthbridge' else 'mifitness' end as side,
         jsonb_array_length(p.stages)::bigint as n,
         null::double precision as min_v,
         extract(epoch from (p.end_time - p.start_time)) / 60.0 as avg_v,
         null::double precision as max_v,
         p.start_time as first_at, p.end_time as last_at,
         jsonb_build_object(
           'minutes_in_bed', round((extract(epoch from (p.end_time - p.start_time)) / 60.0)::numeric, 0),
           'source', p.source,
           'stage_minutes', (
             select coalesce(jsonb_object_agg(stage, mins), '{}'::jsonb)
               from (select st->>'stage' as stage,
                            round(sum(extract(epoch from ((st->>'end')::timestamptz - (st->>'start')::timestamptz)) / 60.0)::numeric, 0) as mins
                       from jsonb_array_elements(p.stages) st
                      group by 1) m)
         ) as extra
    from health_sessions p, win
   where p.kind = 'sleep' and p.end_time >= win.t0 and p.start_time < win.t1
)
select * from metric_rows
union all select * from hr_row
union all select * from sleep_rows
order by section, label, side;
