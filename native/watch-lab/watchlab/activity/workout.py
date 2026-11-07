"""Workout summary, details and GPS files. Ported from WorkoutSummaryParser.java,
XiaomiSimpleActivityParser.java, WorkoutDetailsParser.java and WorkoutGpsParser.java.

All three files of a workout carry the workout's start time in their file id, so they share one
session id, hb:exercise:<file id timestamp>, and `merge_session` joins what each one contributes:
the summary gives the stats, the details file the heart-rate curve, the GPS file the track.
"""
from __future__ import annotations

import struct
from typing import Callable

from ._util import Reader, error, log, start_reader
from .model import ActivityParseError, FileId, Parsed, Sample, Session
from .sports import exercise_type

MAX_HR = 250


def exercise_session_id(file_timestamp_s: int) -> str:
    return f"hb:exercise:{file_timestamp_s}"


# ---------------------------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------------------------

class Spec:
    """Port of XiaomiSimpleActivityParser.Builder: a fixed header (validity bitmap, unused like in
    Gadgetbridge) followed by typed fields read in order. Keyed fields land in the result dict;
    `unk` fields are skipped."""

    def __init__(self, header_size: int):
        self.header_size = header_size
        self.entries: list[tuple] = []

    def byte(self, key=None): self.entries.append(("B", key, 1)); return self
    def short(self, key=None): self.entries.append(("h", key, 2)); return self
    def int(self, key=None): self.entries.append(("i", key, 4)); return self
    def float(self, key=None): self.entries.append(("f", key, 4)); return self
    def unk(self, n): self.entries.append(("skip", None, n)); return self

    def unk_if_prev(self, n, pred: Callable[[int], bool]):
        self.entries.append(("skip_if_prev", pred, n))
        return self

    def parse(self, r: Reader) -> dict:
        r.skip(self.header_size)
        out: dict = {}
        for fmt, key, size in self.entries:
            if fmt == "skip":
                r.skip(size)
            elif fmt == "skip_if_prev":
                if key(r.data[r.pos - 1]):
                    r.skip(size)
            else:
                if r.pos + size > r.limit:
                    raise struct.error(f"need {size} bytes at {r.pos}, limit {r.limit}")
                v = struct.unpack_from("<" + fmt, r.data, r.pos)[0]
                r.pos += size
                if key:
                    out[key] = v
        return out


def _zones(s: Spec) -> Spec:
    return s.int("z_extreme").int("z_anaerobic").int("z_aerobic").int("z_fatburn").int("z_warmup")


def _freestyle(v):
    hs = {5: 3, 7: 5, 8: 6, 9: 6, 10: 6}.get(v)
    if hs is None:
        return None
    s = Spec(hs).int("start").int("end").int("active_s").short("kcal").byte("hr_avg").byte("hr_max").byte("hr_min")
    if v > 5:
        s.unk(6)
    s.float("te_aero")
    if v > 6:
        s.unk(1)
    s.unk(1).short("recovery")
    _zones(s)
    if v == 5:
        s.unk(10).short("xtype").unk(2).int("time_goal").short("kcal_goal")
    else:
        s.short("kcal_total").unk(4).float("te_anaero").unk(1).short("xtype").unk(2).int("time_goal")
        s.short("kcal_goal").short("load").unk(1)
        if v > 7:
            s.byte("vitality").short("punch_total").short("punch_perfect").short("punch_good").short("punch_miss").unk(7)
        if v >= 10:
            s.short("throws_low").short("throws_medium").short("throws_high").unk(1)
    return s


def _indoor_cycling(v):
    hs = {8: 7, 9: 8}.get(v)
    if hs is None:
        return None
    s = Spec(hs).int("start").int("end").int("active_s").unk(4).short("kcal").unk(4)
    s.byte("hr_avg").byte("hr_max").byte("hr_min").float("te_aero").unk(1).unk(1).short("recovery")
    _zones(s)
    s.unk(2).unk(4).float("te_anaero").unk(3).int("time_goal").short("kcal_goal").short("kcal_goal_max")
    s.unk(28).short("load").unk(24).byte("configured_sets").unk(13)
    return s


def _outdoor_v3(with_steps: bool) -> Spec:
    """Mi Watch Color Sport layout shared by outdoor walking v1 v3 and outdoor cycling v2 v3."""
    s = Spec(4).int("start").int("end").int("active_s").int("distance_m").short("kcal")
    s.int("pace_max").int("pace_min").float("speed_max")
    if with_steps:
        s.int("steps").short("cadence_max")
    s.byte("hr_avg").byte("hr_max").byte("hr_min")
    s.float("elev_gain").float("elev_loss").float("alt_avg").float("alt_max").float("alt_min")
    s.float("te_aero").byte("vo2max").unk(1).short("recovery")
    _zones(s)
    s.short("kcal_total").unk(4).float("te_anaero")
    return s


def _walking_v1(v):
    if v == 3:
        return _outdoor_v3(True)
    if v != 4:
        return None
    s = Spec(4).int("start").int("end").int("active_s").int("distance_m").int("kcal")
    s.int("pace_max").int("pace_min").unk(4).int("steps").unk(2)
    s.byte("hr_avg").byte("hr_max").byte("hr_min").unk(20).float("te_anaero").unk(9).byte("recovery").unk(2)
    _zones(s)
    s.int("time_goal")
    return s


def _walking_v2(v):
    hs = {1: 5, 2: 6, 4: 7, 5: 9, 6: 9, 9: 13}.get(v)
    if hs is None:
        return None
    s = Spec(hs).short("xtype").int("start").int("end").int("active_s").unk(4).int("distance_m")
    s.short("kcal_total").short("kcal")
    if v >= 5:
        s.int("pace_avg")
    s.int("pace_max").int("pace_min")
    if v >= 5:
        s.float("speed_avg")
    s.float("speed_max").int("steps")
    if v >= 5:
        s.short("step_length").short("step_rate_avg")
    s.short("step_rate_max").byte("hr_avg").byte("hr_max").byte("hr_min").unk(20).float("te_aero")
    if v == 1:
        s.unk(9)
    else:
        s.unk(1).float("te_anaero")
        s.unk(6 if v >= 9 else 1)
        s.byte("vo2max").unk(2).short("recovery").unk(1)
    _zones(s)
    if v == 6:
        s.int("time_goal").short("kcal_goal").int("distance_goal").int("pace_goal").float("speed_goal")
        s.short("cadence_goal").unk(1).short("load").unk(7)
        s.short("proj_5k").short("proj_10k").short("proj_marathon").short("proj_half")
        s.byte("vitality").unk(18).short("ground_contact_avg").short("ground_contact_min").unk(7)
    if v >= 9:
        s.unk(46).short("load").unk(15).short("active_score").unk(17).short("ground_contact_avg")
        s.short("ground_contact_min").unk(6).short("vertical_ratio_avg").short("vertical_ratio_min")
        s.short("vertical_osc_max").short("vertical_osc_avg").short("vertical_osc_min")
    return s


def _outdoor_cycling(v):
    hs = {4: 6, 5: 6, 6: 7, 8: 8}.get(v)
    if hs is None:
        return None
    s = Spec(hs).short("xtype").int("start").int("end").int("active_s").unk(4).int("distance_m")
    s.short("kcal_total").short("kcal").int("pace_max").int("pace_min")
    if v >= 5:
        s.float("speed_avg")
    s.float("speed_max").byte("hr_avg").byte("hr_max").byte("hr_min")
    s.float("elev_gain").float("elev_loss").float("alt_avg").float("alt_max").float("alt_min")
    s.float("te_aero").unk(1).float("te_anaero").unk(1)
    if v >= 7:
        s.unk(5)
    s.byte("vo2max").unk(1).unk(1).short("recovery").unk(1)
    _zones(s)
    if v >= 6:
        if v >= 7:
            s.unk(5)
        s.int("time_goal").short("kcal_goal").int("distance_goal").float("speed_goal")
        s.unk(1).unk_if_prev(8, lambda route: route in (0xFC, 0xFD, 0xFF))
        s.short("load").unk(15).byte("vitality").unk(5)
        if v >= 7:
            s.unk(2)
        if v >= 8:
            s.unk(1)
    return s


def _hiit(v):
    if v not in (5, 6):
        return None
    s = Spec(4).int("start").int("end").int("active_s").short("kcal").byte("hr_avg").byte("hr_max").byte("hr_min")
    s.float("te_aero").unk(1).unk(1).short("recovery")
    return _zones(s)


def _pool_swimming(v):
    hs = {6: 4, 7: 5, 8: 8}.get(v)
    if hs is None:
        return None
    s = Spec(hs).int("start").int("end").int("active_s").int("distance_m").short("kcal")
    if v >= 7:
        s.int("pace_avg")
    s.int("pace_max").int("pace_min").unk(1).short("recovery").short("strokes").byte("swim_style")
    if v >= 7:
        s.byte("stroke_rate_avg")
    s.byte("stroke_rate_max").short("laps").short("swolf_avg").short("swolf_min").byte("pool_length")
    s.short("kcal_total").unk(4).int("time_goal").short("kcal_goal").int("distance_goal").int("pace_goal")
    s.short("lengths_goal").float("te_aero").unk(1).float("te_anaero").unk(1).short("load").unk(1).byte("vitality")
    return s


def _elliptical(v):
    if v not in (3, 4, 5, 6):
        return None
    s = Spec(4).int("start").int("end").int("active_s").short("kcal").int("steps")
    if v >= 6:
        s.short("cadence_avg")
    s.short("cadence_max").byte("hr_avg").byte("hr_max").byte("hr_min").float("te_aero")
    if v >= 4:
        s.unk(1)
    s.unk(1).short("recovery")
    return _zones(s)


def _rowing(v):
    hs = {4: 4, 6: 5, 7: 5, 8: 6}.get(v)
    if hs is None:
        return None
    s = Spec(hs).int("start").int("end").int("active_s").short("kcal").byte("hr_avg").byte("hr_max").byte("hr_min")
    if v >= 7:
        s.float("te_aero").unk(2).short("recovery")
    else:
        s.unk(7)
        if v > 4:
            s.unk(1)
    _zones(s)
    if v >= 8:
        s.unk(5)
    if v >= 7:
        s.short("kcal_total")
    else:
        s.unk(2)
    s.int("strokes").int("stroke_rate_avg")
    if v >= 7:
        s.int("stroke_rate_max").unk(12).byte("group_count").unk(4).float("te_anaero").unk(3)
        s.int("time_goal").short("kcal_goal").short("goal_count").short("load").unk(1).byte("vitality")
    else:
        s.unk(4)
    return s


def _treadmill(v):
    hs = {5: 4, 9: 6, 10: 8, 11: 9}.get(v)
    if hs is None:
        return None
    s = Spec(hs).int("start").int("end").int("active_s").int("distance_m").short("kcal")
    if v >= 10:
        s.int("pace_avg")
    s.int("pace_max").int("pace_min").int("steps")
    if v >= 10:
        s.short("step_length").short("cadence_avg")
    s.short("cadence_max").byte("hr_avg").byte("hr_max").byte("hr_min").float("te_aero")
    if v == 9:
        s.unk(4)
    else:
        if v >= 10:
            s.unk(1)
        s.byte("vo2max")
        if v >= 10:
            s.byte("vo2max_level")
        s.unk(1)
    s.short("recovery")
    _zones(s)
    if v == 9:
        s.unk(39).short("load").unk(7).byte("vitality")
    if v >= 11:
        s.short("kcal_total").unk(4).float("te_anaero").unk(5).int("time_goal").short("kcal_goal")
        s.int("distance_goal").int("pace_goal").float("speed_goal").short("cadence_goal")
        s.int("distance_cal_m").short("load").unk(7)
        s.short("proj_5k").short("proj_10k").short("proj_marathon").short("proj_half")
        s.byte("vitality").unk(18).short("ground_contact_avg").short("ground_contact_min").unk(7)
    return s


def _cycling_v2(v):
    if v == 3:
        return _outdoor_v3(False)
    if v != 4:
        return None
    s = Spec(5).int("start").int("end").int("active_s").int("distance_m").short("kcal").unk(8).float("speed_max")
    s.byte("hr_avg").byte("hr_max").byte("hr_min").unk(28)
    _zones(s)
    return s.unk(18).unk(2).unk(6)


def _jump_rope(v):
    if v not in (3, 5):
        return None
    s = Spec(5).int("start").int("end").int("active_s").short("kcal").byte("hr_avg").byte("hr_max").byte("hr_min")
    s.float("te_aero")
    if v == 3:
        s.unk(3)
    else:
        s.unk(2).short("recovery")
    _zones(s)
    s.unk(2).int("jumps").short("jump_rate_avg").unk(2).short("jump_rate_max")
    if v == 3:
        s.unk(43).unk(2).unk(2)
    else:
        s.unk(27).unk(4).float("te_anaero").unk(3).int("time_goal").short("kcal_goal").int("jumps_goal")
        s.short("load").unk(1).byte("vitality")
    return s


SUMMARY_SPECS = {
    0x01: _walking_v1, 0x02: _walking_v1, 0x03: _treadmill, 0x06: _cycling_v2, 0x07: _indoor_cycling,
    0x08: _freestyle, 0x09: _pool_swimming, 0x10: _hiit, 0x0B: _elliptical, 0x0D: _rowing,
    0x0E: _jump_rope, 0x16: _walking_v2, 0x17: _outdoor_cycling,
}


def decode_summary(fid: FileId, data: bytes) -> dict:
    """Raw summary fields by key (see the Spec builders), zeros included."""
    factory = SUMMARY_SPECS.get(fid.subtype)
    if factory is None:
        raise error(fid, data, f"no workout summary parser for subtype {fid.subtype:#04x}")
    spec = factory(fid.version)
    if spec is None:
        raise error(fid, data, f"unsupported workout summary version {fid.version} for {fid.subtype_name}")
    r = start_reader(fid, data, strip_crc=False)
    try:
        return spec.parse(r)
    except struct.error as e:
        raise error(fid, data, f"workout summary shorter than its layout: {e}")


def _num(v, nd=2):
    """Drop None / zero / non-finite, round floats."""
    if v is None:
        return None
    if isinstance(v, float):
        if v != v or abs(v) == float("inf"):
            return None
        v = round(v, nd)
        if nd == 0:
            v = int(v)
    return v if v else None


def summary_details(f: dict) -> dict:
    """Map decoded summary fields to the workout `details` JSON in Metrics.kt. Zeros are dropped
    (Gadgetbridge's ActivitySummaryData.add does the same), so every key is optional."""
    d: dict = {}

    def put(key, value, nd=2):
        v = _num(value, nd)
        if v is not None:
            d[key] = v

    put("xiaomi_type", f.get("xtype"))
    put("kcal", f.get("kcal") or f.get("kcal_total"))
    dist = f.get("distance_cal_m") or f.get("distance_m")
    put("distance_m", dist)
    put("steps", f.get("steps"))
    put("avg_hr", f.get("hr_avg"))
    put("max_hr", f.get("hr_max"))
    put("min_hr", f.get("hr_min"))
    active = f.get("active_s")
    pace = f.get("pace_avg")
    speed = f.get("speed_avg")
    if not pace and dist and active:
        pace = active / (dist / 1000.0)
    if not speed and dist and active:
        speed = dist / active * 3.6
    put("avg_pace_s_per_km", pace, 0)
    put("avg_speed_kmh", speed)
    put("avg_cadence", f.get("cadence_avg") or f.get("step_rate_avg"))
    put("elevation_gain_m", f.get("elev_gain"), 1)
    put("elevation_loss_m", f.get("elev_loss"), 1)
    put("vo2max", f.get("vo2max"))
    put("training_load", f.get("load"))
    put("training_effect_aerobic", f.get("te_aero"), 1)
    put("recovery_h", f.get("recovery"))
    zones = {"warmup": f.get("z_warmup"), "fatburn": f.get("z_fatburn"), "aerobic": f.get("z_aerobic"),
             "anaerobic": f.get("z_anaerobic"), "extreme": f.get("z_extreme")}
    if any(zones.values()):
        d["hr_zones_s"] = {k: int(v or 0) for k, v in zones.items()}
    return d


def parse_workout_summary(fid: FileId, data: bytes) -> Parsed:
    f = decode_summary(fid, data)
    start = fid.timestamp * 1000
    end_s = f.get("end") or 0
    if end_s > fid.timestamp and end_s - fid.timestamp < 7 * 86400:
        end = end_s * 1000
    elif f.get("active_s"):
        end = start + int(f["active_s"]) * 1000
    else:
        end = start
    xtype = f.get("xtype") or None
    details = summary_details(f)
    sess = Session(exercise_session_id(fid.timestamp), "exercise", start, end, None,
                   exercise_type(xtype, fid.subtype), [], details or None)
    out = Parsed(sessions=[sess])
    vo2 = details.get("vo2max")
    if vo2:
        out.samples.append(Sample("vo2max", start, None, float(vo2)))
    return out


# ---------------------------------------------------------------------------------------------
# Details (per-second records)
# ---------------------------------------------------------------------------------------------

_RUN_WALK_GROUP_BYTES = [1, 1, 1, 1, 1, 4, 1, 1, 2, 2, 2, 2, 2]
_FREESTYLE_V3 = bytes([0xFF, 0xBB])
_OUTDOOR_CYCLING = bytes([0xDF, 0xCF, 0xFB])
_ELLIPTICAL_V3 = bytes([0xFF, 0xFF])
_ROWING_V4 = bytes([0xFF, 0xFF])
_TREADMILL_V6 = bytes([0xFF, 0xFF, 0x8B, 0xFF])
_INDOOR_CYCLING_V6 = bytes([0xDF, 0xBB, 0xBB, 0xBF])

# layout code -> (record size, reader(record bytes) -> (hr, steps, cadence))
def _rec(hr_at, steps=None, cadence=None):
    def read(b):
        return (b[hr_at],
                None if steps is None else (b[steps[0]] & steps[1]),
                None if cadence is None else b[cadence])
    return read

_RECORDS = {
    2: (2, _rec(0)),
    3: (6, _rec(1)),
    4: (3, _rec(0, cadence=2)),
    5: (8, _rec(1, steps=(0, 0xFF), cadence=5)),
    6: (12, _rec(1, steps=(0, 0x0F), cadence=9)),
    101: (3, _rec(1)),
    102: (4, _rec(1, steps=(0, 0x0F))),
    103: (4, _rec(0)),
    205: (8, _rec(1)),
    111: (3, _rec(1, steps=(0, 0x0F), cadence=2)),
    113: (7, _rec(1)),
    116: (9, _rec(1)),
    109: (25, _rec(1, steps=(0, 0x0F))),
}


def _same_groups(data: bytes, bitmap: bytes) -> bool:
    """Bit 3 of every nibble matches (the other bits vary by band without changing the layout)."""
    if len(data) < 8 + len(bitmap):
        return False
    return all((data[8 + i] & 0x88) == (bitmap[i] & 0x88) for i in range(len(bitmap)))


def _matches(fid: FileId, data: bytes, subtype: int, bitmap: bytes) -> bool:
    return data[8:8 + len(bitmap)] == bitmap or (fid.subtype == subtype and _same_groups(data, bitmap))


def _run_walk_records(fid: FileId, data: bytes) -> list[dict]:
    """Outdoor run/walk (subtype 0x16) v5 and v8: a bitmap with one nibble per field group, a 17 or
    27 byte header per segment, and records holding only the flagged groups."""
    v = fid.version
    bitmap_size = 5 if v == 5 else 7
    group_count = 9 if v == 5 else len(_RUN_WALK_GROUP_BYTES)
    seg_hdr = 17 if v == 5 else 27
    if len(data) < 8 + bitmap_size + 4:
        raise error(fid, data, f"run/walk v{v} details too short")
    bitmap = data[8:8 + bitmap_size]
    present = []
    off = 0
    for g in range(group_count):
        nib = ((bitmap[g // 2] >> 4) if g % 2 == 0 else bitmap[g // 2]) & 0xF
        if nib & 8:
            present.append((g, off, _RUN_WALK_GROUP_BYTES[g]))
            off += _RUN_WALK_GROUP_BYTES[g]
    if off == 0:
        raise error(fid, data, f"run/walk v{v} details bitmap {bitmap.hex()} has no field groups")
    rec_size = off
    by_group = {g: (o, n) for g, o, n in present}
    pos, limit = 8 + bitmap_size, len(data) - 4
    records = []
    while pos < limit:
        if limit - pos < seg_hdr:
            raise error(fid, data, f"run/walk v{v} details: {limit - pos} trailing bytes at {pos}")
        nr, ts = struct.unpack_from("<ii", data, pos + 4)
        pos += seg_hdr
        if nr < 0 or nr * rec_size > limit - pos:
            raise error(fid, data, f"run/walk v{v} details: segment claims {nr} records of {rec_size} bytes, "
                                   f"{limit - pos} bytes remain")
        for _ in range(nr):
            rec = data[pos:pos + rec_size]
            pos += rec_size
            r = {"ts": ts, "hr": 0, "steps": None, "cadence": None}
            if 0 in by_group:
                r["steps"] = rec[by_group[0][0]] & 0x0F
            if 1 in by_group:
                r["hr"] = rec[by_group[1][0]]
            if 7 in by_group:
                r["cadence"] = rec[by_group[7][0]]
            records.append(r)
            ts += 1
    return records


def parse_detail_records(fid: FileId, data: bytes) -> list[dict]:
    """Per-second records [{ts, hr, steps, cadence}] of a workout details file. Raises on an
    unknown version or layout signature."""
    v = fid.version
    if fid.subtype == 0x16 and v in (5, 8):
        return _run_walk_records(fid, data)
    layout = v
    sig: bytes
    if v == 1:
        if len(data) >= 10 and data[8] == 0xEC and data[9] == 0xFC:
            sig, rec_size, layout = bytes([0xEC, 0xFC]), 4, 102
        elif len(data) >= 10 and data[8] == 0xCC and data[9] == 0xF0:
            sig, rec_size, layout = bytes([0xCC, 0xF0]), 3, 101
        else:
            raise error(fid, data, "unknown v1 details signature")
        seg_hdr, ts_pos, nr_pos = 12, 8, 4
    elif v == 2:
        sig, seg_hdr, rec_size, ts_pos, nr_pos = bytes([0xC0]), 9, 2, 4, 0
    elif v == 3:
        if len(data) >= 11 and data[8:11] == bytes([0xCC, 0xCC, 0xC0]):
            sig, seg_hdr, rec_size, ts_pos, nr_pos = data[8:11], 17, 6, 8, 4
        elif _matches(fid, data, 0x08, _FREESTYLE_V3):
            sig, seg_hdr, rec_size, ts_pos, nr_pos, layout = data[8:10], 9, 4, 4, 0, 103
        elif _matches(fid, data, 0x17, _OUTDOOR_CYCLING):
            sig, seg_hdr, rec_size, ts_pos, nr_pos, layout = data[8:11], 17, 7, 8, 4, 113
        elif _matches(fid, data, 0x0B, _ELLIPTICAL_V3):
            sig, seg_hdr, rec_size, ts_pos, nr_pos, layout = data[8:10], 9, 3, 4, 0, 111
        else:
            raise error(fid, data, "unknown v3 details signature")
    elif v == 4:
        if _matches(fid, data, 0x0D, _ROWING_V4):
            sig, seg_hdr, rec_size, ts_pos, nr_pos = data[8:10], 13, 3, 4, 0
        elif len(data) >= 13 and data[8:11] == bytes([0xEC, 0xCC, 0xC8]):
            raise error(fid, data, "Mi Band 8 walking-style v4 details (EC CC C8) have an undecoded layout")
        else:
            raise error(fid, data, "unknown v4 details signature")
    elif v == 5:
        if len(data) >= 13 and data[8:13] == bytes([0xEC, 0xCC, 0xC0, 0x0C, 0xC0]):
            sig, seg_hdr, rec_size, ts_pos, nr_pos = data[8:13], 17, 8, 8, 4
        elif len(data) >= 13 and data[8:13] == bytes([0xEC, 0xCC, 0x80, 0x28, 0x06]):
            sig, seg_hdr, rec_size, ts_pos, nr_pos, layout = data[8:13], 115, 8, 2, 0, 205
        elif _matches(fid, data, 0x17, _OUTDOOR_CYCLING):
            sig, seg_hdr, rec_size, ts_pos, nr_pos, layout = data[8:11], 23, 7, 8, 4, 113
        else:
            raise error(fid, data, "unknown v5 details signature")
    elif v == 6:
        if _matches(fid, data, 0x03, _TREADMILL_V6):
            sig, seg_hdr, rec_size, ts_pos, nr_pos = data[8:12], 13, 12, 4, 0
        elif _matches(fid, data, 0x07, _INDOOR_CYCLING_V6):
            sig, seg_hdr, rec_size, ts_pos, nr_pos, layout = data[8:12], 13, 9, 4, 0, 116
        else:
            raise error(fid, data, "unknown v6 details signature")
    elif v == 9:
        sig = bytes([0xFF, 0xFF, 0xF8, 0xBF, 0xFB, 0xBB, 0xBF])
        seg_hdr, rec_size, ts_pos, nr_pos, layout = 27, 25, 8, 4, 109
        if data[8:8 + len(sig)] != sig:
            raise error(fid, data, f"unexpected v9 details signature {data[8:8 + len(sig)].hex()}")
    else:
        raise error(fid, data, f"unsupported workout details version {v}")

    if len(data) < 8 + len(sig) + 4 or data[8:8 + len(sig)] != sig:
        raise error(fid, data, f"unexpected v{v} details signature")
    size, read = _RECORDS[layout]
    assert size == rec_size, (layout, size, rec_size)
    pos, limit = 8 + len(sig), len(data) - 4
    records: list[dict] = []
    while pos < limit:
        if limit - pos < seg_hdr:
            if not (v == 1 and limit - pos == 8 and struct.unpack_from("<i", data, pos + 4)[0] == 0):
                log.warning("%s: %d trailing bytes after the last segment", fid.describe(), limit - pos)
            break
        nr = struct.unpack_from("<i", data, pos + nr_pos)[0]
        ts = struct.unpack_from("<i", data, pos + ts_pos)[0]
        pos += seg_hdr
        if layout == 205:
            nr = (limit - pos) // rec_size
        seg_end = min(pos + nr * rec_size, limit)
        while pos < seg_end:
            if pos + rec_size > limit:
                raise error(fid, data, f"truncated record at {pos}")
            hr, steps, cadence = read(data[pos:pos + rec_size])
            pos += rec_size
            records.append({"ts": ts, "hr": hr, "steps": steps, "cadence": cadence})
            ts += 1
    return records


def parse_workout_details(fid: FileId, data: bytes) -> Parsed:
    records = parse_detail_records(fid, data)
    curve = [[r["ts"], r["hr"]] for r in records if 0 < r["hr"] <= MAX_HR]
    out = Parsed()
    if not records:
        msg = f"{fid.describe()}: workout details produced no records"
        log.warning(msg)
        out.warnings.append(msg)
        return out
    start = fid.timestamp * 1000
    end = max(start, (records[-1]["ts"] + 1) * 1000)
    out.sessions.append(Session(exercise_session_id(fid.timestamp), "exercise", start, end, None, None, [],
                                {"hr": curve} if curve else None))
    return out


# ---------------------------------------------------------------------------------------------
# GPS
# ---------------------------------------------------------------------------------------------

def parse_gps_points(fid: FileId, data: bytes) -> list[list]:
    """[[epoch s, lat, lon, alt|None], ...] with the (0, 0) 'no fix' points removed."""
    sample = {1: 12, 2: 18, 3: 26}.get(fid.version)
    if sample is None:
        raise error(fid, data, f"unsupported workout gps version {fid.version}")
    r = start_reader(fid, data, strip_crc=True)
    try:
        r.skip(1)  # header
    except struct.error:
        raise error(fid, data, "gps file too short")
    if r.remaining() % sample:
        log.warning("%s: gps payload %d is not a multiple of %d", fid.describe(), r.remaining(), sample)
    pts = []
    while r.remaining() >= sample:
        ts = r.i32()
        lon = r.f32()
        lat = r.f32()
        alt = None
        if fid.version == 2:
            r.skip(6)  # accuracy f32 + packed speed u16
        elif fid.version == 3:
            r.skip(6)
            alt = r.f32()
            r.skip(4)  # hdop
        if lat == 0 and lon == 0:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        pts.append([ts, round(lat, 6), round(lon, 6), None if alt is None or alt != alt else round(alt, 1)])
    return pts


def parse_workout_gps(fid: FileId, data: bytes) -> Parsed:
    pts = parse_gps_points(fid, data)
    out = Parsed()
    if not pts:
        out.warnings.append(f"{fid.describe()}: gps file without a usable fix ({len(data)} bytes)")
        return out
    start = fid.timestamp * 1000
    end = max(start, pts[-1][0] * 1000)
    out.sessions.append(Session(exercise_session_id(fid.timestamp), "exercise", start, end, None, None, [],
                                {"gps": pts}))
    return out
