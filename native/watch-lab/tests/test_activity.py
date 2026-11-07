"""Tests for watchlab.activity (Gadgetbridge port), the lab store and the ingest client.

Byte vectors come from Gadgetbridge's own tests (XiaomiActivityFileIdTest, DailySummaryParserTest,
ManualSamplesParserTest, WorkoutSummaryParserTest, WorkoutDetailsSummaryConsistencyTest,
WorkoutDetailsParserTest layouts); the real captures are in tests/data/*.json, extracted verbatim
from those Java files.

Run from native/watch-lab:  .venv/Scripts/python -m unittest discover -s tests -p "test_activity.py"
"""
from __future__ import annotations

import base64
import http.server
import json
import struct
import sys
import tempfile
import threading
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from watchlab.activity import (ActivityParseError, FileId, Parsed, Sample, Session, merge_session,  # noqa: E402
                               parse_file)
from watchlab.activity.daily import decode_daily_summary  # noqa: E402
from watchlab.activity.manual import decode_v1, decode_v2  # noqa: E402
from watchlab.activity.model import utc_iso  # noqa: E402
from watchlab.activity.workout import decode_summary, parse_detail_records  # noqa: E402
from watchlab import ingest  # noqa: E402
from watchlab.store import LabStore  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"
SUMMARY = json.loads((DATA / "summary_vectors.json").read_text())
CONSISTENCY = json.loads((DATA / "consistency_vectors.json").read_text())


def b64(s: str) -> bytes:
    return base64.b64decode(s)


def hx(s: str) -> bytes:
    return bytes.fromhex(s.replace(" ", ""))


def with_crc(body: bytes) -> bytes:
    return body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)


def fid(ts=1_700_000_000, tz=4, version=1, type=0, subtype=0, detail=0) -> FileId:
    return FileId(ts, tz, version, type, subtype, detail)


def sample_map(parsed: Parsed, metric: str) -> dict:
    return {s.start: s.value for s in parsed.samples if s.metric == metric}


# --------------------------------------------------------------------------------------------
class FileIdTest(unittest.TestCase):
    """XiaomiActivityFileIdTest."""

    def test_encode(self):
        # GB passes (ts, tz=4, type=3, subtype=1, detailType=8, version=0); type 3 << 7 overflows the byte
        f = FileId(1697182497, 4, 0, 3, 1, 8)
        self.assertEqual(hx("21F3286504008C"), f.to_bytes())

    def test_decode(self):
        f = FileId.from_bytes(hx("21F328650403A0"))
        self.assertEqual(1697182497, f.timestamp)
        self.assertEqual(4, f.timezone)
        self.assertEqual(3, f.version)
        self.assertEqual((1, 8, 0), (f.type, f.subtype, f.detail_type))
        self.assertEqual("SPORTS_FREESTYLE", f.subtype_name)
        self.assertEqual("DETAILS", f.detail_name)

    def test_decode_encode(self):
        raw = hx("21F328650403A021F3286504008C")
        ids = [FileId.from_bytes(raw, o) for o in range(0, len(raw), 7)]
        self.assertEqual(raw, b"".join(i.to_bytes() for i in ids))

    def test_zero(self):
        f = FileId.from_bytes(bytes(7))
        self.assertEqual((0, 0), (f.timestamp, f.version))

    def test_negative_timezone_roundtrip(self):
        f = FileId.from_bytes(hx("EFB9856AF4011800"[:14]))
        self.assertEqual(-12, f.timezone)
        self.assertEqual(hx("EFB9856AF4011800"[:14]), f.to_bytes())

    def test_hex_describe_and_sort(self):
        f = FileId.from_bytes(hx("21F328650403A0"))
        self.assertEqual("21f328650403a0", f.hex)
        self.assertIn("SPORTS_FREESTYLE", f.describe())
        summary = FileId(5, 0, 1, 1, 8, 1)
        details = FileId(5, 0, 1, 1, 8, 0)
        gps = FileId(5, 0, 1, 1, 8, 2)
        self.assertEqual([summary, details, gps], sorted([gps, details, summary], key=lambda x: x.sort_key))

    def test_too_short(self):
        with self.assertRaises(ActivityParseError):
            FileId.from_bytes(bytes(3))


class DispatchTest(unittest.TestCase):
    """XiaomiActivityParser.create."""

    def test_unknown_types_raise(self):
        for f in (fid(subtype=0x05), fid(subtype=0x03, detail=1), fid(type=1, detail=3)):
            with self.assertRaises(ActivityParseError, msg=f.describe()):
                parse_file(f, f.to_bytes() + bytes(12))

    def test_error_names_the_file(self):
        f = fid(version=99)
        with self.assertRaises(ActivityParseError) as cm:
            parse_file(f, with_crc(f.to_bytes() + b"\x00" + bytes(8)))
        self.assertIn(f.hex, str(cm.exception))
        self.assertIn("99", str(cm.exception))

    def test_mismatched_header_raises(self):
        with self.assertRaises(ActivityParseError):
            parse_file(fid(), fid(version=2).to_bytes() + bytes(20))


# --------------------------------------------------------------------------------------------
class DailySummaryTest(unittest.TestCase):
    """DailySummaryParserTest."""

    def body(self) -> bytes:
        b = struct.pack("<i", 12345) + struct.pack("<H", 250) + bytes([75, 60, 180]) + struct.pack("<i", 1700001000)
        b += bytes([55]) + struct.pack("<i", 1700002000) + bytes([80, 40, 90, 10]) + bytes([1, 1, 1])
        b += struct.pack("<H", 2200) + struct.pack("<H", 480) + bytes([96, 99]) + struct.pack("<i", 1700003000)
        b += bytes([92]) + struct.pack("<i", 1700004000) + bytes([95])
        b += struct.pack("<HH", 130, 700) + bytes([2, 5, 25, 40]) + struct.pack("<H", 280)
        b += bytes([3, 30]) + struct.pack("<HH", 7, 65)
        return b

    def file(self, version, bitmap, body):
        f = fid(1_700_000_000, 4, version, 0, 0, 1)
        return f, f.to_bytes() + b"\x00" + bitmap + body

    def test_body_sizes(self):
        self.assertEqual(57, len(self.body()))

    def test_v5_all_bits(self):
        f, data = self.file(5, b"\xff" * 4, self.body())
        s = decode_daily_summary(f, data)
        self.assertEqual(12345, s["steps"])
        self.assertEqual(250, s["active_calories"])
        self.assertEqual(60, s["hr_resting"])
        self.assertEqual(180, s["hr_max"])
        self.assertEqual(1700001000, s["hr_max_ts"])
        self.assertEqual(55, s["hr_min"])
        self.assertEqual(80, s["hr_avg"])
        self.assertEqual(0x010101, s["standing"])
        self.assertEqual(2200, s["calories"])
        self.assertEqual(480, s["recovery_hours"])
        self.assertEqual(99, s["spo2_max"])
        self.assertEqual(95, s["spo2_avg"])
        self.assertEqual(130, s["training_load_day"])
        self.assertEqual(700, s["training_load_week"])
        self.assertEqual(280, s["vitality_current"])

    def test_v5_no_bits_stores_nothing(self):
        f, data = self.file(5, bytes(4), b"\xff" * 57)
        self.assertEqual({}, decode_daily_summary(f, data))
        self.assertEqual([], parse_file(f, data).samples)

    def test_v5_partial_vitality(self):
        f, data = self.file(5, bytes([0x80, 0, 0, 0x10]), self.body())
        s = decode_daily_summary(f, data)
        self.assertEqual({"steps": 12345, "vitality_current": 280}, s)

    def test_bitmap_is_msb_first(self):
        for slot, present, absent in ((0, "steps", "active_calories"), (7, "hr_min_ts", "hr_min"),
                                      (8, "hr_avg", "hr_min_ts"), (23, "training_load_level", "training_load_week")):
            bitmap = bytearray(4)
            bitmap[slot // 8] = 1 << (7 - slot % 8)
            f, data = self.file(5, bytes(bitmap), self.body())
            s = decode_daily_summary(f, data)
            self.assertIn(present, s)
            self.assertNotIn(absent, s)

    def test_little_endian(self):
        body = bytearray(57)
        body[0:4] = bytes([1, 2, 3, 4])
        off = 4 + 2 + 1 + 1 + 1 + 4 + 1 + 4 + 1 + 1 + 1 + 1 + 3 + 2 + 2 + 1 + 1 + 4 + 1 + 4 + 1 + 2 + 2 + 1 + 1 + 1 + 1
        body[off:off + 2] = bytes([2, 1])
        f, data = self.file(5, bytes([0x80, 0, 0, 0x10]), bytes(body))
        s = decode_daily_summary(f, data)
        self.assertEqual(0x04030201, s["steps"])
        self.assertEqual(0x0102, s["vitality_current"])

    def test_standing_packs_three_bytes(self):
        body = bytearray(57)
        off = 4 + 2 + 1 + 1 + 1 + 4 + 1 + 4 + 1 + 1 + 1 + 1
        body[off:off + 3] = bytes([0xAA, 0xBB, 0xCC])
        f, data = self.file(5, bytes([0, 0x08, 0, 0]), bytes(body))
        self.assertEqual(0xCCBBAA, decode_daily_summary(f, data)["standing"])

    def test_unsupported_version_raises(self):
        f = fid(version=99, detail=1)
        with self.assertRaises(ActivityParseError):
            parse_file(f, f.to_bytes() + bytes(8))

    def test_v3_all_bits(self):
        f, data = self.file(3, b"\xff" * 3, self.body()[:41])
        s = decode_daily_summary(f, data)
        self.assertEqual(95, s["spo2_avg"])
        self.assertNotIn("training_load_day", s)
        self.assertNotIn("vitality_current", s)

    def test_v3_partial(self):
        f, data = self.file(3, bytes([0x08, 0, 0]), self.body()[:41])
        self.assertEqual({"hr_max": 180}, decode_daily_summary(f, data))

    def test_samples(self):
        f, data = self.file(5, b"\xff" * 4, self.body())
        p = parse_file(f, data)
        self.assertEqual({1_700_000_000_000: 60.0}, sample_map(p, "resting_heart_rate"))
        self.assertEqual({1_700_000_000_000: 280.0}, sample_map(p, "pai"))
        self.assertEqual([], p.sessions)


class DailyDetailsTest(unittest.TestCase):
    def build(self, version=3):
        # v3 header 5 bytes = 10 nibbles: g0 steps(third) 9, g1 kcal(second) A, g2 -, g3 dist C, g4 hr C,
        # g5 energy C, g6 -, g7 spo2 C, g8 stress C, g9 -
        header = bytes([0x9A, 0x0C, 0xCC, 0x0C, 0xC0])

        def rec(steps, kcal, dist, hr, energy, spo2, stress):
            return (struct.pack("<H", steps) + bytes([kcal]) + struct.pack("<H", dist)
                    + bytes([hr, energy, spo2, stress]))

        f = fid(1_700_000_000, 4, version, 0, 0, 0)
        body = header + rec(100, 5, 3, 72, 80, 97, 40) + rec(0, 0, 0, 255, 0, 0, 255) + rec(7, 1, 0, 9, 101, 101, 0)
        return f, with_crc(f.to_bytes() + b"\x00" + body)

    def test_minutes(self):
        f, data = self.build()
        p = parse_file(f, data)
        t0 = 1_700_000_000_000
        self.assertEqual({t0: 100.0, t0 + 120_000: 7.0}, sample_map(p, "steps"))
        self.assertEqual({t0: 5.0, t0 + 120_000: 1.0}, sample_map(p, "active_kcal"))
        self.assertEqual({t0: 3.0}, sample_map(p, "distance_m"))
        self.assertEqual({t0: 72.0}, sample_map(p, "heart_rate"))  # 255 and 9 are not heart rates
        self.assertEqual({t0: 80.0}, sample_map(p, "body_energy"))
        self.assertEqual({t0: 97.0}, sample_map(p, "spo2"))
        self.assertEqual({t0: 40.0}, sample_map(p, "stress"))  # 255 = absent, 0 = nothing
        steps = [s for s in p.samples if s.metric == "steps"][0]
        self.assertEqual(steps.start + 60_000, steps.end)
        hr = [s for s in p.samples if s.metric == "heart_rate"][0]
        self.assertIsNone(hr.end)

    def test_unknown_version(self):
        f = fid(version=9)
        with self.assertRaises(ActivityParseError):
            parse_file(f, with_crc(f.to_bytes() + bytes(10)))

    def test_truncated_keeps_what_parsed(self):
        f, data = self.build()
        cut = with_crc(data[:-4][:-3])  # last record loses 3 bytes
        p = parse_file(f, cut)
        self.assertTrue(p.warnings)
        self.assertEqual({1_700_000_000_000: 72.0}, sample_map(p, "heart_rate"))


class ManualSamplesTest(unittest.TestCase):
    """ManualSamplesParserTest."""

    SPO2 = "EFB9856AF4011800FFEFB9856A0261511E4648"
    STRESS_40 = "65C0856AF4011800FF65C0856A03288CA20578"
    STRESS_27 = "D1C3856AF4011800FFD1C3856A031BFBF91375"

    def dec(self, data):
        return decode_v1(FileId.from_bytes(data), data)

    def test_spo2(self):
        r = self.dec(hx(self.SPO2))
        self.assertEqual([(1787148783, 0x12, 97)], r)

    def test_stress(self):
        r = self.dec(hx(self.STRESS_40))[0]
        self.assertEqual((0x13, 40), (r[1], r[2]))
        self.assertEqual(27, self.dec(hx(self.STRESS_27))[0][2])

    def test_rejects_unknown_header(self):
        d = bytearray(hx(self.SPO2)); d[8] = 0
        with self.assertRaises(ActivityParseError):
            self.dec(bytes(d))

    def test_rejects_unknown_type(self):
        d = bytearray(hx(self.SPO2)); d[13] = 4
        with self.assertRaises(ActivityParseError):
            self.dec(bytes(d))

    def test_rejects_out_of_range(self):
        d = bytearray(hx(self.SPO2)); d[14] = 101
        with self.assertRaises(ActivityParseError):
            self.dec(bytes(d))

    def test_parse_v1_samples(self):
        data = hx(self.SPO2)
        p = parse_file(FileId.from_bytes(data), data)
        self.assertEqual({1787148783000: 97.0}, sample_map(p, "spo2"))

    def test_v2(self):
        f = fid(1_700_000_000, 4, 2, 0, 6, 0)
        body = (struct.pack("<IBB", 1_700_000_010, 0x12, 98) + struct.pack("<IBB", 1_700_000_020, 0x13, 0)
                + struct.pack("<IBB", 1_700_000_030, 0x11, 66) + struct.pack("<IBi", 1_700_000_040, 0x44, 0x0E5A))
        p = parse_file(f, with_crc(f.to_bytes() + b"\x00" + body))
        self.assertEqual({1_700_000_010_000: 98.0}, sample_map(p, "spo2"))
        self.assertEqual({}, sample_map(p, "stress"))  # zero value skipped
        self.assertEqual({1_700_000_030_000: 66.0}, sample_map(p, "heart_rate"))
        self.assertAlmostEqual(36.74, sample_map(p, "skin_temp_c")[1_700_000_040_000])

    def test_v2_unknown_type_aborts(self):
        f = fid(1_700_000_000, 4, 2, 0, 6, 0)
        body = struct.pack("<IBB", 1_700_000_010, 0x55, 1)
        with self.assertRaises(ActivityParseError):
            parse_file(f, with_crc(f.to_bytes() + b"\x00" + body))

    def test_unknown_version(self):
        f = fid(version=7, subtype=6)
        with self.assertRaises(ActivityParseError):
            parse_file(f, with_crc(f.to_bytes() + b"\x00" + bytes(6)))


# --------------------------------------------------------------------------------------------
class WorkoutSummaryTest(unittest.TestCase):
    """WorkoutSummaryParserTest: GB's key -> ours: HR_AVG hr_avg, ACTIVE_SECONDS active_s,
    CALORIES_BURNT kcal, CALORIES_TOTAL kcal_total, WORKOUT_LOAD load, VITALITY_GAIN vitality,
    RECOVERY_TIME recovery, TRAINING_EFFECT_* te_aero / te_anaero."""

    def fields(self, name):
        data = b64(SUMMARY[name])
        return decode_summary(FileId.from_bytes(data), data)

    def parsed(self, name) -> Session:
        data = b64(SUMMARY[name])
        p = parse_file(FileId.from_bytes(data), data)
        self.assertEqual(1, len(p.sessions))
        return p.sessions[0]

    def test_treadmill_v11(self):
        f = self.fields("TREADMILL_V11_24APR")
        self.assertEqual(4479, f["distance_m"])
        self.assertAlmostEqual(4.2, f["te_aero"], 2)
        self.assertEqual(167, f["hr_avg"])
        self.assertEqual(163, f["cadence_avg"])
        self.assertAlmostEqual(1.8, f["te_anaero"], 2)
        self.assertEqual(4000, f["distance_goal"])
        self.assertEqual(4500, f["distance_cal_m"])
        self.assertEqual(104, f["load"])
        self.assertEqual(12, f["vitality"])
        s = self.parsed("TREADMILL_V11_24APR")
        self.assertEqual(57, s.exercise_type)  # no sport-type field: subtype treadmill
        self.assertEqual(4500, s.details["distance_m"])  # calibrated distance wins
        self.assertEqual(104, s.details["training_load"])
        self.assertEqual({"warmup": 16, "fatburn": 14, "aerobic": 61, "anaerobic": 1223, "extreme": 489},
                         s.details["hr_zones_s"])
        self.assertEqual("hb:exercise:%d" % (s.start // 1000), s.id)

    def test_treadmill_v9(self):
        f = self.fields("TREADMILL_V9_21JUN")
        self.assertEqual(192, f["kcal"])
        self.assertEqual(2720, f["distance_m"])
        self.assertEqual(3216, f["steps"])
        self.assertEqual(135, f["hr_avg"])
        self.assertEqual(180, f["cadence_max"])
        self.assertAlmostEqual(1.9, f["te_aero"], 2)
        self.assertEqual(32, f["recovery"])
        self.assertEqual(28, f["load"])
        self.assertEqual(15, f["vitality"])

    def test_rowing_v7(self):
        f = self.fields("ROWING_V7_20APR")
        self.assertEqual((142, 2549, 1208, 28), (f["hr_avg"], f["active_s"], f["strokes"], f["stroke_rate_avg"]))
        self.assertAlmostEqual(3.4, f["te_aero"], 2)
        self.assertAlmostEqual(0.4, f["te_anaero"], 2)
        self.assertEqual((71, 23, 69, 0), (f["stroke_rate_max"], f["recovery"], f["load"], f["vitality"]))
        self.assertEqual(54, self.parsed("ROWING_V7_20APR").exercise_type)

    def test_rowing_v7_15apr(self):
        f = self.fields("ROWING_V7_15APR")
        self.assertAlmostEqual(1.1, f["te_anaero"], 2)
        self.assertAlmostEqual(3.5, f["te_aero"], 2)
        self.assertEqual(41, f["stroke_rate_max"])

    def test_freestyle_v10_frisbee(self):
        f = self.fields("FREESTYLE_V10_FRISBEE")
        self.assertAlmostEqual(2.6, f["te_anaero"], 2)
        self.assertAlmostEqual(4.0, f["te_aero"], 2)
        self.assertEqual((105, 93, 7), (f["throws_low"], f["throws_medium"], f["throws_high"]))
        self.assertEqual(807, f["xtype"])
        s = self.parsed("FREESTYLE_V10_FRISBEE")
        self.assertEqual(31, s.exercise_type)
        self.assertEqual(807, s.details["xiaomi_type"])

    def test_rowing_v8_zones_add_up(self):
        f = self.fields("ROWING_V8_22AUG")
        self.assertEqual((147, 129, 145, 106), (f["active_s"], f["hr_avg"], f["hr_max"], f["hr_min"]))
        self.assertEqual((46, 18, 27), (f["strokes"], f["stroke_rate_avg"], f["stroke_rate_max"]))
        zones = sum(f[k] for k in ("z_extreme", "z_anaerobic", "z_aerobic", "z_fatburn", "z_warmup"))
        self.assertEqual(f["active_s"], zones)

    def test_outdoor_cycling_v8(self):
        f = self.fields("OUTDOOR_CYCLING_V8_23SEP")
        self.assertEqual((1579, 5282, 166, 127, 76, 1036), (f["active_s"], f["distance_m"], f["kcal_total"],
                                                          f["kcal"], f["pace_max"], f["pace_min"]))
        self.assertAlmostEqual(12.04, f["speed_avg"], 2)
        self.assertAlmostEqual(46.93, f["speed_max"], 2)
        self.assertEqual((133, 168, 80), (f["hr_avg"], f["hr_max"], f["hr_min"]))
        self.assertAlmostEqual(2.3, f["te_aero"], 2)
        self.assertAlmostEqual(0.8, f["te_anaero"], 2)
        self.assertEqual(13, f["recovery"])
        self.assertEqual((95, 814, 340, 283), (f["z_anaerobic"], f["z_aerobic"], f["z_fatburn"], f["z_warmup"]))
        self.assertEqual((28, 7), (f["load"], f["vitality"]))
        s = self.parsed("OUTDOOR_CYCLING_V8_23SEP")
        self.assertEqual(8, s.exercise_type)
        self.assertEqual(s.start + 1579_000, s.end)
        self.assertEqual(127, s.details["kcal"])

    def test_outdoor_cycling_v6(self):
        f = self.fields("OUTDOOR_CYCLING_V6_23MAY")
        self.assertEqual((11982, 538, 439, 104), (f["distance_m"], f["kcal_total"], f["kcal"], f["pace_max"]))
        self.assertAlmostEqual(34.48, f["speed_max"], 2)
        self.assertEqual((10, 97, 1110, 5), (f["z_aerobic"], f["z_fatburn"], f["z_warmup"], f["load"]))

    def test_route_ride_keeps_load_aligned(self):
        plain = b64(SUMMARY["OUTDOOR_CYCLING_V8_23SEP"])
        off = 0x8D
        route = bytearray(plain[:off + 1]) + bytes([0x5A] * 8) + plain[off + 1:]
        route[off] = 0xFF
        route[-4:] = struct.pack("<I", zlib.crc32(bytes(route[:-4])) & 0xFFFFFFFF)
        f = decode_summary(FileId.from_bytes(bytes(route)), bytes(route))
        self.assertEqual((28, 7), (f["load"], f["vitality"]))

    def test_unsupported_version_raises(self):
        data = bytearray(b64(SUMMARY["OUTDOOR_CYCLING_V8_23SEP"]))
        data[5] = 99
        with self.assertRaises(ActivityParseError):
            parse_file(FileId.from_bytes(bytes(data)), bytes(data))

    def test_outdoor_run_v5(self):
        f = self.fields("OUTDOOR_RUN_V5_30SEP")
        self.assertEqual((1704, 4189, 119, 200, 162, 395, 782, 178),
                         (f["active_s"], f["distance_m"], f["hr_min"], f["hr_max"], f["hr_avg"], f["pace_max"],
                          f["pace_min"], f["step_rate_max"]))
        s = self.parsed("OUTDOOR_RUN_V5_30SEP")
        self.assertEqual(56, s.exercise_type)
        self.assertEqual(4174, s.details["steps"])
        self.assertEqual(406, s.details["avg_pace_s_per_km"])
        self.assertEqual(146, s.details["avg_cadence"])

    def test_walking_v6_v9(self):
        f = self.fields("WALKING_V6_29MAY")
        self.assertEqual((1912, 131, 192, 149), (f["active_s"], f["hr_min"], f["hr_max"], f["hr_avg"]))
        self.assertEqual(79, self.parsed("WALKING_V6_29MAY").exercise_type)
        f = self.fields("WALKING_V9_04JAN")
        self.assertEqual((99, 163, 135), (f["hr_min"], f["hr_max"], f["hr_avg"]))

    def test_indoor_cycling_v9_and_elliptical_v6(self):
        f = self.fields("INDOOR_CYCLING_V9_22FEB")
        self.assertEqual((94, 150, 135), (f["hr_min"], f["hr_max"], f["hr_avg"]))
        self.assertEqual(9, self.parsed("INDOOR_CYCLING_V9_22FEB").exercise_type)
        f = self.fields("ELLIPTICAL_V6_10FEB")
        self.assertEqual((118, 156, 147), (f["hr_min"], f["hr_max"], f["hr_avg"]))
        self.assertEqual(25, self.parsed("ELLIPTICAL_V6_10FEB").exercise_type)

    def test_outdoor_cycling_v2_v3(self):
        f = self.fields("OUTDOOR_CYCLING_V2_V3_04OCT")
        self.assertEqual((6502, 18090, 586, 199, 716), (f["active_s"], f["distance_m"], f["kcal"], f["pace_max"],
                                                       f["pace_min"]))
        self.assertAlmostEqual(34.79, f["speed_max"], 2)
        self.assertEqual((122, 198, 59), (f["hr_avg"], f["hr_max"], f["hr_min"]))
        self.assertAlmostEqual(461.7, f["elev_gain"], 1)
        self.assertAlmostEqual(452.4, f["elev_loss"], 1)
        self.assertAlmostEqual(477.8, f["alt_avg"], 1)
        self.assertAlmostEqual(609.6, f["alt_max"], 1)
        self.assertAlmostEqual(303.3, f["alt_min"], 1)
        self.assertAlmostEqual(3.0, f["te_aero"], 2)
        self.assertEqual((50, 30, 729, 85, 1959), (f["vo2max"], f["recovery"], f["kcal_total"], f["z_extreme"],
                                                  f["z_warmup"]))
        data = b64(SUMMARY["OUTDOOR_CYCLING_V2_V3_04OCT"])
        p = parse_file(FileId.from_bytes(data), data)
        self.assertEqual(8, p.sessions[0].exercise_type)
        self.assertEqual(1791123696000, p.sessions[0].end)
        self.assertEqual({p.sessions[0].start: 50.0}, sample_map(p, "vo2max"))
        self.assertEqual(50, p.sessions[0].details["vo2max"])

    def test_outdoor_walking_v1_v3(self):
        f = self.fields("OUTDOOR_WALKING_V1_V3_03OCT")
        self.assertEqual((2040, 1484, 82, 815, 2224, 150), (f["active_s"], f["distance_m"], f["kcal"], f["pace_max"],
                                                           f["steps"], f["cadence_max"]))
        self.assertAlmostEqual(5.65, f["speed_max"], 2)
        self.assertEqual((86, 109, 71), (f["hr_avg"], f["hr_max"], f["hr_min"]))
        self.assertAlmostEqual(2.0, f["elev_gain"], 1)
        self.assertAlmostEqual(54.8, f["elev_loss"], 1)
        self.assertAlmostEqual(355.4, f["alt_max"], 1)
        self.assertAlmostEqual(298.4, f["alt_min"], 1)
        self.assertAlmostEqual(0.3, f["te_aero"], 2)
        self.assertEqual(127, f["kcal_total"])
        self.assertEqual(79, self.parsed("OUTDOOR_WALKING_V1_V3_03OCT").exercise_type)

    def test_details_json_shape(self):
        d = self.parsed("OUTDOOR_CYCLING_V8_23SEP").details
        allowed = {"xiaomi_type", "kcal", "distance_m", "steps", "avg_hr", "max_hr", "min_hr", "avg_pace_s_per_km",
                   "avg_speed_kmh", "avg_cadence", "elevation_gain_m", "elevation_loss_m", "vo2max", "training_load",
                   "training_effect_aerobic", "recovery_h", "hr_zones_s", "hr", "gps"}
        self.assertLessEqual(set(d), allowed)
        self.assertNotIn("steps", d)  # zero fields are left out
        json.dumps(d)


# --------------------------------------------------------------------------------------------
def build_details(f: FileId, sig: bytes, hdr_size: int, nr_pos: int, ts_pos: int, segments, rec_size: int,
                  rec_fn, fill_header=None) -> bytes:
    """segments: [(start_ts, [record args...])]."""
    body = bytes(sig)
    for ts, recs in segments:
        hdr = bytearray(hdr_size)
        if nr_pos is not None:
            struct.pack_into("<i", hdr, nr_pos, len(recs))
        struct.pack_into("<i", hdr, ts_pos, ts)
        if fill_header:
            fill_header(hdr)
        body += bytes(hdr)
        for r in recs:
            b = rec_fn(*r)
            assert len(b) == rec_size, (len(b), rec_size)
            body += b
    return with_crc(f.to_bytes() + b"\x00" + body)


T0 = 1_750_000_000


def hrs(parsed: Parsed):
    return parsed.sessions[0].details["hr"]


class WorkoutDetailsTest(unittest.TestCase):
    """WorkoutDetailsParserTest layouts."""

    def f(self, version, subtype=1):
        return fid(T0, 4, version, 1, subtype, 0)

    def test_v2_multi_segment(self):
        f = self.f(2)
        data = build_details(f, bytes([0xC0]), 9, 0, 4, [(T0, [(70, 1), (75, 1)]), (T0 + 100, [(80, 1), (82, 1), (84, 1)])],
                             2, lambda hr, kcal: bytes([hr, kcal]))
        p = parse_file(f, data)
        self.assertEqual([[T0, 70], [T0 + 1, 75], [T0 + 100, 80], [T0 + 101, 82], [T0 + 102, 84]], hrs(p))
        s = p.sessions[0]
        self.assertEqual(f"hb:exercise:{T0}", s.id)
        self.assertEqual((T0 * 1000, (T0 + 103) * 1000), (s.start, s.end))
        self.assertIsNone(s.exercise_type)

    def test_v3_cc_cc_c0(self):
        f = self.f(3)
        data = build_details(f, bytes([0xCC, 0xCC, 0xC0]), 17, 4, 8, [(T0, [(1, 120, 500), (2, 135, 1024)])], 6,
                             lambda k, hr, sp: bytes([k, hr]) + struct.pack("<i", sp))
        self.assertEqual([[T0, 120], [T0 + 1, 135]], hrs(parse_file(f, data)))

    def test_v4_rowing(self):
        f = self.f(4, 0x0D)
        data = build_details(f, bytes([0xFF, 0xFF]), 13, 0, 4, [(T0, [(142, 0, 33), (145, 0, 34), (148, 0, 35)])], 3,
                             lambda hr, ev, cad: bytes([hr, ev, cad]))
        recs = parse_detail_records(f, data)
        self.assertEqual([142, 145, 148], [r["hr"] for r in recs])
        self.assertEqual([33, 34, 35], [r["cadence"] for r in recs])

    def test_v5_cycling_run(self):
        f = self.f(5)
        data = build_details(f, bytes([0xEC, 0xCC, 0xC0, 0x0C, 0xC0]), 17, 4, 8,
                             [(T0, [(3, 155, 0, 0, 98, 170, 400), (4, 160, 0, 0, 97, 172, 390)])], 8,
                             lambda st, hr, ev, kc, sp, cad, pace: bytes([st, hr, ev, kc, sp, cad]) + struct.pack("<H", pace))
        recs = parse_detail_records(f, data)
        self.assertEqual([(155, 3, 170), (160, 4, 172)], [(r["hr"], r["steps"], r["cadence"]) for r in recs])

    def test_v6_treadmill(self):
        f = self.f(6, 0x03)
        data = build_details(f, bytes([0xFF, 0xFF, 0x8B, 0xFF]), 13, 0, 4,
                             [(T0, [(0x13, 165, 22, 90, 164, 430), (0x02, 167, 23, 90, 168, 420)])], 12,
                             lambda st, hr, d, stride, cad, pace: bytes([st, hr, d, stride]) + bytes(5) + bytes([cad]) + struct.pack("<H", pace))
        recs = parse_detail_records(f, data)
        self.assertEqual([(165, 3, 164), (167, 2, 168)], [(r["hr"], r["steps"], r["cadence"]) for r in recs])

    def test_v5_treadmill(self):
        f = self.f(5, 0x03)
        sig = bytes([0xEC, 0xCC, 0x80, 0x28, 0x06])
        body = bytearray(sig) + bytearray(115)
        struct.pack_into("<i", body, len(sig) + 2, T0)
        for hr, sp in ((100, 50), (135, 70), (165, 94)):
            body += bytes([0, hr, 0, sp]) + bytes(4)
        data = with_crc(f.to_bytes() + b"\x00" + bytes(body))
        recs = parse_detail_records(f, data)
        self.assertEqual([100, 135, 165], [r["hr"] for r in recs])
        self.assertEqual([T0, T0 + 1, T0 + 2], [r["ts"] for r in recs])

    def test_hr_only_layouts(self):
        cases = [  # version, subtype, signature, hdr, nr, ts, rec size, hr index
            (3, 0x17, bytes([0xDF, 0xCF, 0xFB]), 17, 4, 8, 7, 1),
            (5, 0x17, bytes([0xDF, 0xCF, 0xFB]), 23, 4, 8, 7, 1),
            (3, 0x0B, bytes([0xFF, 0xFF]), 9, 0, 4, 3, 1),
            (6, 0x07, bytes([0xDF, 0xBB, 0xBB, 0xBF]), 13, 0, 4, 9, 1),
            (3, 0x08, bytes([0xFF, 0xBB]), 9, 0, 4, 4, 0),
            (1, 0x02, bytes([0xEC, 0xFC]), 12, 4, 8, 4, 1),
            (1, 0x06, bytes([0xCC, 0xF0]), 12, 4, 8, 3, 1),
        ]
        for version, subtype, sig, hdr, nr, ts, rec, idx in cases:
            f = self.f(version, subtype)

            def mk(hr, _rec=rec, _idx=idx):
                b = bytearray(_rec)
                b[_idx] = hr
                return bytes(b)

            data = build_details(f, sig, hdr, nr, ts, [(T0, [(130,), (127,), (124,)])], rec, mk)
            self.assertEqual([130, 127, 124], [r["hr"] for r in parse_detail_records(f, data)],
                             f"v{version} subtype {subtype:#x}")

    def test_bitmap_variant_matches_by_group_bits(self):
        f = self.f(3, 0x08)
        sig = bytes([0xFF, 0xB9])  # other low bits, same group flags as FF BB
        data = build_details(f, sig, 9, 0, 4, [(T0, [(99,)])], 4, lambda hr: bytes([hr, 0, 0, 0]))
        self.assertEqual([99], [r["hr"] for r in parse_detail_records(f, data)])

    def test_wrong_signature_and_unknown_version_raise(self):
        f = self.f(2)
        bad = build_details(f, bytes([0xC1]), 9, 0, 4, [(T0, [(70, 1)])], 2, lambda a, b: bytes([a, b]))
        with self.assertRaises(ActivityParseError):
            parse_file(f, bad)
        f9 = self.f(77)
        with self.assertRaises(ActivityParseError):
            parse_file(f9, with_crc(f9.to_bytes() + bytes(20)))

    def test_hr_curve_skips_zero(self):
        f = self.f(2)
        data = build_details(f, bytes([0xC0]), 9, 0, 4, [(T0, [(0, 1), (88, 1)])], 2, lambda a, b: bytes([a, b]))
        self.assertEqual([[T0 + 1, 88]], hrs(parse_file(f, data)))


class WorkoutDetailsSummaryConsistencyTest(unittest.TestCase):
    """Real captures: the per-second records must agree with the summary the band computed itself."""

    def check(self, case):
        fid_b = bytes.fromhex(case["file_id"])
        bitmap = bytes.fromhex(case["bitmap"].replace(" ", ""))
        body = fid_b + b"\x00" + bitmap
        for h, r in zip(case["headers"], case["records"]):
            body += bytes.fromhex(h.replace(" ", "")) + b64(r)
        data = with_crc(body)
        f = FileId.from_bytes(data)
        recs = parse_detail_records(f, data)
        self.assertTrue(recs, case["label"])
        sdata = b64(case["summary"])
        summary = decode_summary(FileId.from_bytes(sdata), sdata)
        return recs, summary, f, data

    def test_treadmill_v6(self):
        recs, summary, _, _ = self.check(next(c for c in CONSISTENCY if c["label"] == "treadmill v6"))
        steps = sum(r["steps"] for r in recs)
        self.assertLessEqual(abs(steps - summary["steps"]), max(2, summary["steps"] * 0.03))
        self.assertEqual(171, max(r["cadence"] for r in recs))
        self.assertEqual(summary["cadence_max"], max(r["cadence"] for r in recs))

    def test_rowing_v4(self):
        recs, summary, _, _ = self.check(next(c for c in CONSISTENCY if c["label"] == "rowing v4"))
        self.assertEqual(42, max(r["cadence"] for r in recs))
        self.assertEqual(summary["stroke_rate_max"], 42)

    def test_outdoor_run_v5(self):
        recs, summary, f, data = self.check(next(c for c in CONSISTENCY if c["label"] == "outdoor run v5"))
        steps = sum(r["steps"] for r in recs)
        self.assertLessEqual(abs(steps - summary["steps"]), max(2, summary["steps"] * 0.03))
        self.assertLessEqual(abs(max(r["cadence"] for r in recs) - summary["step_rate_max"]), 1)
        p = parse_file(f, data)
        self.assertEqual(f"hb:exercise:{f.timestamp}", p.sessions[0].id)


class WorkoutGpsTest(unittest.TestCase):
    def build(self, version, points):
        f = fid(T0, 4, version, 1, 0x16, 2)
        body = b"\x01"
        for ts, lon, lat, alt in points:
            body += struct.pack("<iff", ts, lon, lat)
            if version >= 2:
                body += struct.pack("<fH", 5.0, 0x0150)
            if version == 3:
                body += struct.pack("<ff", alt, 1.2)
        return f, with_crc(f.to_bytes() + b"\x00" + body)

    def test_v1_v2_v3(self):
        pts = [(T0, 4.5, 50.8, 12.0), (T0 + 1, 4.5001, 50.8001, 13.5)]
        for v in (1, 2, 3):
            f, data = self.build(v, pts)
            p = parse_file(f, data)
            gps = p.sessions[0].details["gps"]
            self.assertEqual(2, len(gps), v)
            self.assertEqual(T0, gps[0][0])
            self.assertAlmostEqual(50.8, gps[0][1], 4)
            self.assertAlmostEqual(4.5, gps[0][2], 4)
            self.assertEqual(13.5 if v == 3 else None, gps[1][3])
            self.assertEqual(f"hb:exercise:{T0}", p.sessions[0].id)

    def test_null_island_dropped_and_placeholder(self):
        f, data = self.build(3, [(T0, 0.0, 0.0, 0.0), (T0 + 1, 4.5, 50.8, 1.0)])
        self.assertEqual(1, len(parse_file(f, data).sessions[0].details["gps"]))
        f, data = self.build(3, [(T0, 0.0, 0.0, 0.0)])
        p = parse_file(f, data)
        self.assertEqual([], p.sessions)
        self.assertTrue(p.warnings)
        ph = with_crc(f.to_bytes() + b"\x00" + b"\x01")  # 13-byte indoor placeholder
        self.assertEqual([], parse_file(f, ph).sessions)

    def test_unknown_version(self):
        f, data = self.build(1, [])
        f = fid(T0, 4, 9, 1, 0x16, 2)
        with self.assertRaises(ActivityParseError):
            parse_file(f, with_crc(f.to_bytes() + b"\x00\x01"))


# --------------------------------------------------------------------------------------------
class SleepTest(unittest.TestCase):
    BED = 1_700_000_000

    def stages_file(self, bed=None, changes=None):
        bed = bed or self.BED
        wake = bed + 8 * 3600
        f = fid(bed, 4, 2, 0, 3, 0)
        body = bytes(7) + struct.pack("<h", 480) + struct.pack("<ii", bed, wake) + bytes(3) + struct.pack("<hhhh", 100, 200, 90, 10)
        body += b"\x00"
        for t, ph in changes or [(bed, 3), (bed + 1800, 2), (bed + 3600, 4), (bed + 5400, 5), (bed + 6000, 0)]:
            body += struct.pack("<iB", t, ph)
        return f, with_crc(f.to_bytes() + b"\x00" + body)

    def test_stages_file(self):
        f, data = self.stages_file()
        p = parse_file(f, data)
        s = p.sessions[0]
        self.assertEqual(f"hb:sleep:{self.BED}", s.id)
        self.assertEqual("sleep", s.kind)
        self.assertEqual((self.BED * 1000, (self.BED + 8 * 3600) * 1000), (s.start, s.end))
        self.assertEqual(["light", "deep", "rem", "awake"], [x["stage"] for x in s.stages])
        self.assertEqual(utc_iso(self.BED * 1000), s.stages[0]["start"])
        self.assertEqual(utc_iso((self.BED + 1800) * 1000), s.stages[0]["end"])
        self.assertEqual(utc_iso((self.BED + 6000) * 1000), s.stages[3]["end"])  # up to the not-sleep marker

    def test_empty_stages_file(self):
        f = fid(self.BED, 4, 2, 0, 3, 0)
        body = bytes(7) + struct.pack("<h", 0) + struct.pack("<ii", 0, 0) + bytes(3) + bytes(8) + b"\x00"
        p = parse_file(f, with_crc(f.to_bytes() + b"\x00" + body))
        self.assertEqual([], p.sessions)

    def packet(self, ts, typ, data=b""):
        return (struct.pack("<I", 0xFFFCFAFB) + bytes([17]) + struct.pack("<q", ts) + bytes([1, typ])
                + struct.pack(">H", len(data)) + data)

    def details_file(self, version=2, bed=None, extra=b""):
        bed = bed or self.BED
        wake = bed + 7 * 3600
        f = fid(bed, 4, version, 0, 8, 0)
        body = bytes([0]) if version < 5 else bytes([0, 0])
        body += bytes([0]) + struct.pack("<ii", bed, wake)
        if version >= 4:
            pass  # quality byte only when its header bit is set (it is not)
        if version >= 5:
            body += bytes(9) + struct.pack("<ii", bed - 1800, wake)
        stages = struct.pack(">HHHH", (1 << 12) | 30, (2 << 12) | 60, (3 << 12) | 45, (0 << 12) | 5)
        body += b"\x99\x98" + self.packet(bed, 17, stages)  # junk before the marker: resync
        body += self.packet(bed, 2) + self.packet(bed, 16, bytes(12))
        resp = bytes([100, 15, 80, 0, 100, 17, 80, 0, 100, 99, 80, 0])  # 15, 17, and 99 (rejected)
        body += self.packet((bed + 3600) * 1_000_000_000, 0xA, resp)
        body += extra
        return f, with_crc(f.to_bytes() + b"\x00" + body)

    def test_details_file_all_versions(self):
        for v in (2, 3, 4, 5):
            f, data = self.details_file(v)
            p = parse_file(f, data)
            s = p.sessions[0]
            self.assertEqual(f"hb:sleep:{self.BED}", s.id, v)
            self.assertEqual(["light", "deep", "rem", "awake"], [x["stage"] for x in s.stages], v)
            self.assertEqual(utc_iso((self.BED + 30 * 60) * 1000), s.stages[0]["end"])
            self.assertEqual(utc_iso((self.BED + (30 + 60 + 45 + 5) * 60) * 1000), s.stages[3]["end"])
            rr = sorted(sample_map(p, "respiratory_rate").values())
            self.assertEqual([15.0, 17.0], rr, v)
            self.assertTrue(all(x.end is None for x in p.samples))

    def test_truncated_packet_drops_stages_keeps_session(self):
        f, data = self.details_file(2, extra=struct.pack("<I", 0xFFFCFAFB) + bytes([17]) + struct.pack("<q", 1) + bytes([1, 0x20]) + struct.pack(">H", 500))
        p = parse_file(f, data)
        self.assertEqual([], p.sessions[0].stages)
        self.assertTrue(p.warnings)

    def test_details_and_stages_converge(self):
        f1, d1 = self.stages_file()
        f2, d2 = self.details_file(2)
        s1 = parse_file(f1, d1).sessions[0]
        s2 = parse_file(f2, d2).sessions[0]
        self.assertEqual(s1.id, s2.id)

    def test_unknown_versions(self):
        f = fid(self.BED, 4, 9, 0, 8, 0)
        with self.assertRaises(ActivityParseError):
            parse_file(f, with_crc(f.to_bytes() + bytes(30)))
        f = fid(self.BED, 4, 3, 0, 3, 0)
        with self.assertRaises(ActivityParseError):
            parse_file(f, with_crc(f.to_bytes() + bytes(30)))

    def test_no_sleep_span_returns_nothing(self):
        f = fid(self.BED, 4, 2, 0, 8, 0)
        body = bytes([0, 0]) + struct.pack("<ii", 0, 0)
        p = parse_file(f, with_crc(f.to_bytes() + b"\x00" + body))
        self.assertEqual([], p.sessions)


# --------------------------------------------------------------------------------------------
def ses(id="hb:exercise:1", start=1000, end=2000, title=None, et=None, stages=None, details=None, kind="exercise"):
    return Session(id, kind, start, end, title, et, stages or [], details)


class MergeSessionTest(unittest.TestCase):
    def test_first_write(self):
        s = ses()
        self.assertIs(s, merge_session(None, s))

    def test_widest_range_and_kept_fields(self):
        a = ses(start=1000, end=2000, title="Run", et=56)
        b = ses(start=500, end=1500)
        m = merge_session(a, b)
        self.assertEqual((500, 2000, "Run", 56), (m.start, m.end, m.title, m.exercise_type))
        m = merge_session(a, ses(title="Tempo", et=0))
        self.assertEqual(("Tempo", 0), (m.title, m.exercise_type))

    def test_details_key_by_key(self):
        a = ses(details={"kcal": 300, "hr": [[1, 100], [2, 101]], "avg_hr": 140})
        b = ses(details={"gps": [[1, 50.0, 4.0, None]], "hr": [], "kcal": None, "avg_hr": 150})
        m = merge_session(a, b)
        self.assertEqual({"kcal": 300, "hr": [[1, 100], [2, 101]], "avg_hr": 150, "gps": [[1, 50.0, 4.0, None]]},
                         m.details)
        m = merge_session(a, ses(details={"hr": [[5, 90]]}))
        self.assertEqual([[5, 90]], m.details["hr"])
        self.assertIsNone(merge_session(ses(), ses()).details)
        self.assertEqual({"kcal": 1}, merge_session(ses(), ses(details={"kcal": 1})).details)

    def test_stages_with_more_coverage_win(self):
        short = [{"stage": "light", "start": "2026-01-01T00:00:00Z", "end": "2026-01-01T01:00:00Z"}]
        long_ = short + [{"stage": "deep", "start": "2026-01-01T01:00:00Z", "end": "2026-01-01T03:00:00Z"}]
        self.assertEqual(long_, merge_session(ses(stages=short), ses(stages=long_)).stages)
        self.assertEqual(long_, merge_session(ses(stages=long_), ses(stages=short)).stages)
        self.assertEqual(long_, merge_session(ses(stages=long_), ses(stages=[])).stages)

    def test_inputs_not_mutated(self):
        a = ses(details={"hr": [[1, 1]]})
        merge_session(a, ses(details={"hr": [[2, 2]]}))
        self.assertEqual({"hr": [[1, 1]]}, a.details)


class WorkoutTriadTest(unittest.TestCase):
    """Summary + details + GPS of one workout land in one merged session."""

    def test_merge_three_files(self):
        data = b64(SUMMARY["OUTDOOR_RUN_V5_30SEP"])
        sf = FileId.from_bytes(data)
        summary = parse_file(sf, data).sessions[0]
        df = FileId(sf.timestamp, sf.timezone, 2, 1, sf.subtype, 0)
        details = build_details(df, bytes([0xC0]), 9, 0, 4, [(sf.timestamp, [(119, 1), (162, 1)])], 2, lambda a, b: bytes([a, b]))
        gf1 = FileId(sf.timestamp, sf.timezone, 1, 1, sf.subtype, 2)
        gps = with_crc(gf1.to_bytes() + b"\x00\x01" + struct.pack("<iff", sf.timestamp + 1, 4.5, 50.8))
        s2 = parse_file(df, details).sessions[0]
        s3 = parse_file(gf1, gps).sessions[0]
        self.assertTrue(summary.id == s2.id == s3.id)
        m = merge_session(merge_session(merge_session(None, summary), s2), s3)
        self.assertEqual(56, m.exercise_type)
        self.assertEqual(summary.end, m.end)
        self.assertEqual([[sf.timestamp, 119], [sf.timestamp + 1, 162]], m.details["hr"])
        self.assertEqual(1, len(m.details["gps"]))
        self.assertEqual(4189, m.details["distance_m"])
        # order independence of the contents
        m2 = merge_session(merge_session(merge_session(None, s3), s2), summary)
        self.assertEqual(m.details, m2.details)
        self.assertEqual((m.start, m.end, m.exercise_type), (m2.start, m2.end, m2.exercise_type))


# --------------------------------------------------------------------------------------------
class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LabStore(str(Path(self.tmp.name) / "out" / "lab.db"))

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_samples_upsert_and_queue(self):
        t = 1_700_000_000_000  # 2023-11-14 22:13:20 UTC
        self.store.write(Parsed(samples=[Sample("heart_rate", t, None, 70), Sample("steps", t, t + 60000, 5),
                                         Sample("heart_rate", t + 3_600_000 * 2, None, 71)]))
        self.assertEqual(["s:heart_rate:2023-11-14", "s:heart_rate:2023-11-15", "s:steps:2023-11-14"],
                         self.store.pending_keys())
        self.store.write(Parsed(samples=[Sample("heart_rate", t, None, 75)]))
        rows = self.store.metric_day("heart_rate", "2023-11-14")
        self.assertEqual([75], [r.value for r in rows])  # same (metric, start) overwritten
        self.assertEqual(3, self.store.pending_count())

    def test_sessions_merge_on_write(self):
        self.store.write(Parsed(sessions=[ses(details={"kcal": 5}, et=56, end=2000)]))
        self.store.write(Parsed(sessions=[ses(details={"hr": [[1, 100]]}, start=900, end=1500)]))
        s = self.store.session("hb:exercise:1")
        self.assertEqual((900, 2000, 56), (s.start, s.end, s.exercise_type))
        self.assertEqual({"kcal": 5, "hr": [[1, 100]]}, s.details)
        self.assertEqual(["x:hb:exercise:1"], self.store.pending_keys())

    def test_raw_files_roundtrip(self):
        a, b = fid(2000, version=1, type=1, subtype=8, detail=2), fid(2000, version=1, type=1, subtype=8, detail=1)
        self.store.put_raw_file(a, b"AAA")
        self.store.put_raw_file(b, b"BBB")
        self.assertEqual([(b, b"BBB"), (a, b"AAA")], self.store.raw_files())  # summary first
        self.store.mark_parsed(a)
        self.store.mark_parsed(b, "boom")
        s = self.store.summary()
        self.assertEqual({"total": 2, "parsed": 1, "failed": 1}, s["raw_files"])
        self.assertEqual([(b.hex, "boom")], self.store.raw_file_errors())

    def test_reparse_from_raw_files(self):
        data = b64(SUMMARY["OUTDOOR_RUN_V5_30SEP"])
        f = FileId.from_bytes(data)
        self.store.put_raw_file(f, data)
        for file_id, raw in self.store.raw_files():
            self.store.write(parse_file(file_id, raw))
            self.store.mark_parsed(file_id)
        self.assertEqual(f"hb:exercise:{f.timestamp}", self.store.session(f"hb:exercise:{f.timestamp}").id)

    def test_summary(self):
        t = 1_700_000_000_000
        self.store.write(Parsed(samples=[Sample("spo2", t, None, 97), Sample("spo2", t + 60_000, None, 96)]))
        s = self.store.summary()
        self.assertEqual([{"metric": "spo2", "n": 2, "first": t, "last": t + 60_000}], s["samples"])
        self.assertIn("spo2", self.store.summary_text())


class IngestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LabStore(str(Path(self.tmp.name) / "lab.db"))
        self.cfg = SimpleNamespace(supabase_url=None, supabase_anon_key="anon-key", health_token="tok",
                                   out_dir=Path(self.tmp.name))

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def fill(self, minutes=1440, days=1):
        t = 1_700_000_000_000 - (1_700_000_000_000 % 86_400_000)  # UTC midnight
        samples = [Sample("heart_rate", t + d * 86_400_000 + i * 60_000, None, 60 + i % 40)
                   for d in range(days) for i in range(minutes)]
        self.store.write(Parsed(samples=samples))
        return t

    def test_payload_has_whole_metric_day(self):
        t = self.fill(10)
        self.store.mark_done(self.store.pending_keys())
        # a later partial write queues the day again; the upload carries every stored row of that day
        self.store.write(Parsed(samples=[Sample("heart_rate", t + 600_000, None, 99)]))
        batches, _ = ingest.build_batches(self.store)
        rec = batches[0]["samples"][0]
        self.assertEqual("hb:heart_rate:" + utc_iso(t)[:10], rec["id"])
        self.assertEqual("healthbridge", rec["source"])
        self.assertEqual(11, len(rec["points"]))
        self.assertEqual([utc_iso(t), None, 60.0], rec["points"][0])

    def test_interval_points_have_end(self):
        t = 1_700_000_000_000
        self.store.write(Parsed(samples=[Sample("steps", t, t + 60_000, 12)]))
        rec = ingest.build_batches(self.store)[0][0]["samples"][0]
        self.assertEqual([utc_iso(t), utc_iso(t + 60_000), 12.0], rec["points"][0])

    def test_session_record(self):
        self.store.write(Parsed(sessions=[ses(title=None, et=56, details={"kcal": 5},
                                              stages=[{"stage": "deep", "start": "a", "end": "b"}])]))
        rec = ingest.build_batches(self.store)[0][0]["sessions"][0]
        self.assertEqual({"id", "kind", "source", "start", "end", "title", "exercise_type", "stages", "details"}, set(rec))
        self.assertEqual((56, {"kcal": 5}, "healthbridge"), (rec["exercise_type"], rec["details"], rec["source"]))

    def test_batches_never_split_a_record(self):
        self.fill(1440, 3)  # three days, 1440 points each
        batches, _ = ingest.build_batches(self.store)
        self.assertEqual([2880, 1440], [b["points"] for b in batches])
        ids = [r["id"] for b in batches for r in b["samples"]]
        self.assertEqual(3, len(set(ids)))
        self.assertTrue(all(b["points"] <= 3000 for b in batches))
        big = ingest.build_batches(self.store, max_points=1000)[0]
        self.assertEqual([1440, 1440, 1440], [b["points"] for b in big])  # oversize record travels alone

    def test_dry_run_writes_file_and_keeps_queue(self):
        self.fill(5)
        res = ingest.upload_pending(self.store, self.cfg, dry_run=True)
        self.assertTrue(res["dry_run"])
        payload = json.loads(Path(res["file"]).read_text())
        self.assertEqual(5, len(payload["batches"][0]["samples"][0]["points"]))
        self.assertNotIn("tok", json.dumps(payload))
        self.assertEqual(1, self.store.pending_count())

    def serve(self, status=200):
        seen = []

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                seen.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"samples": 5, "sessions": 0, "deleted": 0}' if status == 200 else b'{"message":"nope"}')

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        self.cfg.supabase_url = f"http://127.0.0.1:{srv.server_port}"
        return seen

    def test_upload_success_clears_queue(self):
        self.fill(5)
        seen = self.serve(200)
        res = ingest.upload_pending(self.store, self.cfg)
        self.assertEqual((1, 0), (res["sent"], res["failed"]))
        self.assertEqual(0, self.store.pending_count())
        path, headers, body = seen[0]
        self.assertEqual("/rest/v1/rpc/health_ingest", path)
        self.assertEqual("anon-key", headers["apikey"])
        self.assertEqual("Bearer anon-key", headers["authorization"])
        self.assertEqual("tok", body["p_token"])
        self.assertTrue(body["p_device"].startswith("watch-lab "))
        self.assertEqual(1, len(body["p_payload"]["samples"]))

    def test_upload_failure_keeps_queue(self):
        self.fill(5)
        self.serve(500)
        res = ingest.upload_pending(self.store, self.cfg)
        self.assertEqual((0, 1), (res["sent"], res["failed"]))
        self.assertIn("HTTP 500", res["errors"][0])
        self.assertEqual(1, self.store.pending_count())
        self.assertEqual(1, self.store.db.execute("select attempts from upload_queue").fetchone()[0])

    def test_missing_config_is_a_clear_error(self):
        self.fill(2)
        self.cfg.health_token = None
        self.cfg.supabase_url = "http://127.0.0.1:1"
        with self.assertRaises(RuntimeError):
            ingest.upload_pending(self.store, self.cfg)

    def test_empty_queue(self):
        self.assertEqual(0, ingest.upload_pending(self.store, self.cfg)["batches"])


if __name__ == "__main__":
    unittest.main()
