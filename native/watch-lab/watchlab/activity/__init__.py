"""Xiaomi activity files: file id, parsers and session merging.

A Python port of Gadgetbridge's `service/devices/xiaomi/activity/` (XiaomiActivityFileId, the
XiaomiActivityParser dispatch and the DailyDetails / DailySummary / SleepDetails / SleepStages /
ManualSamples / WorkoutSummary / WorkoutDetails / WorkoutGps parsers). The Kotlin app ports the same
code in `watch/activity/`; the rules below are what both ports must agree on.

`parse_file(file_id, data)`
    `data` is the whole file exactly as Gadgetbridge hands it to XiaomiActivityParser.parse: the 7
    file-id bytes, one padding byte, the payload and the trailing 4-byte CRC32 (the fetcher has
    already checked the CRC). Unknown versions / subtypes and truncated files raise
    `ActivityParseError` (message = file id + length + first bytes); keep the raw file in the store.

File type -> parser -> output (type/subtype/detail from the file id):

    ACTIVITY 0x00 DETAILS  v1-4   DailyDetails    steps, active_kcal, distance_m (interval, 1 min);
                                                  heart_rate, spo2, stress, body_energy (instant)
    ACTIVITY 0x00 SUMMARY  v3-5   DailySummary    resting_heart_rate, pai at the day's start
    ACTIVITY 0x03 DETAILS  v2     SleepStages     sleep session
    ACTIVITY 0x06 DETAILS  v1,2   ManualSamples   heart_rate, spo2, stress, skin_temp_c (instant)
    ACTIVITY 0x08 any      v1-5   SleepDetails    sleep session + respiratory_rate
    SPORTS   any  SUMMARY         WorkoutSummary  exercise session with stats in `details`, vo2max
    SPORTS   any  DETAILS         WorkoutDetails  exercise session, details = {"hr": [[s, bpm], ...]}
    SPORTS   any  GPS_TRACK v1-3  WorkoutGps      exercise session, details = {"gps": [[s, lat, lon, alt|null], ...]}

Sample validity (a value outside these ranges, or flagged absent, produces no sample):
    heart_rate 10..250, spo2 1..100, stress 1..100 (255 = absent), body_energy 1..100,
    steps / active_kcal / distance_m only when > 0, resting_heart_rate 10..250, pai when flagged valid,
    respiratory_rate 1..40 (sleep), skin_temp_c = (u16 low half of the value) / 100.
    Interval metrics get end = start + 60 s; daily-details minute i starts at file timestamp + 60*i.
    Times are epoch ms.

Session ids:
    exercise   hb:exercise:<file id timestamp, epoch s>. Summary, details and GPS files of a workout
               all carry the workout start in their file id, so they share the id.
    sleep      hb:sleep:<bed time, epoch s> where bed time is the bed-time field inside the file
               (SleepDetails and SleepStages both read it; Gadgetbridge keys its sleep rows by it, so
               the details and stages files of one night converge on one id).

Session contents:
    start / end    exercise: start = file id timestamp; end = summary end time (or start + active
                   seconds), details end = last record + 1 s, gps end = last fix; sleep: bed / wake time.
    exercise_type  Health Connect EXERCISE_TYPE_* from the summary's Xiaomi sport type
                   (`sports.XIAOMI_TO_EXERCISE`), else from the file subtype; 0 when unknown.
                   Details / GPS sessions carry None.
    stages         sleep only: [{"stage": light|deep|rem|awake, "start": iso, "end": iso}], clipped to
                   [bed, wake]. SleepDetails raw stages 0..3 = awake, light, deep, rem; SleepStages
                   (Gadgetbridge numbering) 2 deep, 3 light, 4 rem, 5 awake; everything else dropped.
    details        workout stats keys of Metrics.kt (zeros omitted); hr zones as hr_zones_s.

`merge_session(existing, incoming)`: used by the store before every write of a session.
    start = min, end = max; title / exercise_type = incoming's if not None else existing's;
    stages = the list with more total covered time (ties: incoming); details merged key by key at the
    top level: incoming's value wins when it is not None, except that an empty list / dict never
    replaces a non-empty one; an empty result is None.
"""
from __future__ import annotations

import copy
from datetime import datetime

from ._util import error
from .daily import parse_daily_details, parse_daily_summary
from .manual import parse_manual_samples
from .model import (ActivityParseError, DETAIL_DETAILS, DETAIL_GPS_TRACK, DETAIL_SUMMARY, FileId, Parsed,  # noqa: F401
                    Sample, Session, TYPE_ACTIVITY, TYPE_SPORTS, utc_iso)
from .sleep import parse_sleep_details, parse_sleep_stages
from .workout import parse_workout_details, parse_workout_gps, parse_workout_summary


def _dispatch(fid: FileId):
    if fid.type == TYPE_ACTIVITY:
        if fid.subtype == 0x00 and fid.detail_type == DETAIL_DETAILS:
            return parse_daily_details
        if fid.subtype == 0x00 and fid.detail_type == DETAIL_SUMMARY:
            return parse_daily_summary
        if fid.subtype == 0x03 and fid.detail_type == DETAIL_DETAILS:
            return parse_sleep_stages
        if fid.subtype == 0x06 and fid.detail_type == DETAIL_DETAILS:
            return parse_manual_samples
        if fid.subtype == 0x08:
            return parse_sleep_details
    elif fid.type == TYPE_SPORTS:
        return {DETAIL_SUMMARY: parse_workout_summary, DETAIL_GPS_TRACK: parse_workout_gps,
                DETAIL_DETAILS: parse_workout_details}.get(fid.detail_type)
    return None


def parse_file(file_id: FileId, data: bytes) -> Parsed:
    data = bytes(data)
    if len(data) >= FileId.SIZE and data[:FileId.SIZE] != file_id.to_bytes():
        raise error(file_id, data, f"file starts with a different id ({data[:FileId.SIZE].hex()})")
    parser = _dispatch(file_id)
    if parser is None:
        raise error(file_id, data, "no parser for this file type")
    try:
        return parser(file_id, data)
    except ActivityParseError:
        raise
    except Exception as e:  # a parser bug must still name the file
        raise error(file_id, data, f"{type(e).__name__}: {e}") from e


def _coverage_ms(stages: list) -> int:
    total = 0
    for s in stages or []:
        try:
            total += int((datetime.fromisoformat(s["end"]) - datetime.fromisoformat(s["start"])).total_seconds() * 1000)
        except (KeyError, ValueError, TypeError):
            pass
    return total


def _empty(v) -> bool:
    return isinstance(v, (list, dict, str)) and len(v) == 0


def merge_details(existing: dict | None, incoming: dict | None) -> dict | None:
    merged = dict(existing or {})
    for k, v in (incoming or {}).items():
        if v is None:
            continue
        if _empty(v) and not _empty(merged.get(k)) and merged.get(k) is not None:
            continue
        merged[k] = copy.deepcopy(v)
    return merged or None


def merge_session(existing: Session | None, incoming: Session) -> Session:
    if existing is None:
        return incoming
    stages = incoming.stages if _coverage_ms(incoming.stages) >= _coverage_ms(existing.stages) else existing.stages
    return Session(
        id=incoming.id,
        kind=incoming.kind,
        start=min(existing.start, incoming.start),
        end=max(existing.end, incoming.end),
        title=incoming.title if incoming.title is not None else existing.title,
        exercise_type=incoming.exercise_type if incoming.exercise_type is not None else existing.exercise_type,
        stages=list(stages),
        details=merge_details(existing.details, incoming.details),
    )
