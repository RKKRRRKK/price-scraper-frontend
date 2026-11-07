"""Sleep files. Ported from SleepDetailsParser.java and SleepStagesParser.java, plus the session
building of XiaomiSleepSessionProvider.kt.

Both file kinds describe one night as a bed time and a wake-up time. Gadgetbridge keys its sleep
rows by the bed time ("samples for the same sleep always have the same bedtime"), so the session id
is hb:sleep:<bed time, epoch seconds> for both, and details + stages files of a night converge.
"""
from __future__ import annotations

import math
import struct

from ._util import Reader, error, log, start_reader, valid_data
from .model import FileId, Parsed, Sample, Session, utc_iso

STAGE_MARKER = 0xFFFCFAFB

# Gadgetbridge's stage numbering (what SleepStages files store and SleepDetails decodes to):
# 0 not sleep, 1 n/a, 2 deep, 3 light, 4 rem, 5 awake.
GB_STAGE_NAMES = {2: "deep", 3: "light", 4: "rem", 5: "awake"}
# SleepDetails type-17 packets use their own 0..3 (then 4 = not sleep).
DETAILS_STAGE_NAMES = {0: "awake", 1: "light", 2: "deep", 3: "rem"}


def sleep_session_id(bed_time_s: int) -> str:
    return f"hb:sleep:{bed_time_s}"


def build_session(bed_s: int, wake_s: int, runs: list[tuple[str, int, int]]) -> Session:
    """runs: (stage name, start ms, end ms). Clipped to [bed, wake], zero-length runs dropped."""
    start, end = bed_s * 1000, wake_s * 1000
    stages = []
    for name, s, e in sorted(runs, key=lambda x: x[1]):
        s, e = max(s, start), min(e, end)
        if e > s:
            stages.append({"stage": name, "start": utc_iso(s), "end": utc_iso(e)})
    return Session(sleep_session_id(bed_s), "sleep", start, end, None, None, stages, None)


def parse_sleep_details(fid: FileId, data: bytes) -> Parsed:
    """ACTIVITY_SLEEP files (both the details and the summary flavour)."""
    header_size = {1: 1, 2: 1, 3: 1, 4: 1, 5: 2}.get(fid.version)
    if header_size is None:
        raise error(fid, data, f"unknown sleep details version {fid.version}")
    v = fid.version
    r = start_reader(fid, data, strip_crc=False)
    out = Parsed()
    try:
        header = r.take(header_size)
        r.u8()  # isAwake: 0/1, 1 while the night is still open
        bed = r.i32()
        wake = r.i32()
        idx = 2 + 1  # header bit index, advances only for fields this version has
        if v >= 4:
            if valid_data(header, idx):
                r.u8()  # sleep quality
            idx += 1
        if v >= 5:
            r.skip(9)
            r.i32()  # bedTime2: about 30 min earlier, "into bed"
            r.i32()  # wakeupTime2
            idx += 5
        for width, has in ((1, True), (1, True), (4, v >= 3)):
            if not has:
                continue
            if valid_data(header, idx):
                r.i16()  # time unit
                count = r.i16()
                if count > 0:
                    if v >= 2:
                        r.i32()  # first record time
                    r.skip(count * width)
            idx += 1
    except struct.error as e:
        raise error(fid, data, f"truncated sleep header: {e}")

    runs: list[tuple[str, int, int]] = []
    resp: list[Sample] = []
    failed = False
    try:
        while r.remaining() >= 17:
            if not _read_stage_marker(r):
                break
            r.u8()  # header length, always 17
            ts = r.i64()
            r.u8()  # parity
            typ = r.u8()
            data_len = (r.u8() << 8) | r.u8()
            if typ in (0x2, 0x3, 0x9, 0xC, 0xD, 0xE, 0xF, 0x12):
                continue  # flag packets: no data follows the header
            body = Reader(r.take(data_len), big=True)
            if typ == 17:
                t = ts * 1000
                for _ in range(data_len // 2):
                    val = body.u16()
                    stage, minutes = val >> 12, val & 0xFFF
                    name = DETAILS_STAGE_NAMES.get(stage)
                    if name:
                        runs.append((name, t, t + minutes * 60_000))
                    t += minutes * 60_000
            elif typ == 0xA:
                count = data_len // 4
                if count > 0:
                    window = 600_000
                    window_start = math.floor(ts / 1_000_000.0 + 0.5) - window
                    for i in range(count):
                        body.u8()
                        rate = body.u8()
                        body.u8()
                        body.u8()
                        if 1 <= rate <= 40:
                            resp.append(Sample("respiratory_rate", window_start + (i + 1) * window // (count + 1),
                                               None, float(rate)))
            # types 1 (RR intervals), 16 (summary) and 0x65 (sentinel) carry nothing we store
    except struct.error as e:
        failed = True
        msg = f"{fid.describe()}: sleep packets truncated ({e}); stages dropped"
        log.warning(msg)
        out.warnings.append(msg)

    if bed <= 0 or wake <= bed:
        out.warnings.append(f"{fid.describe()}: no usable sleep span (bed={bed}, wake={wake})")
        return out
    out.sessions.append(build_session(bed, wake, [] if failed else runs))
    out.samples.extend(resp)
    return out


def _read_stage_marker(r: Reader) -> bool:
    while r.remaining() >= 17:
        if r.u32() == STAGE_MARKER:
            return True
        r.pos -= 3
    return False


def parse_sleep_stages(fid: FileId, data: bytes) -> Parsed:
    """ACTIVITY_SLEEP_STAGES (older bands): totals, then (u32 time, u8 stage) change points."""
    if fid.version != 2:
        raise error(fid, data, f"unknown sleep stages version {fid.version}")
    r = start_reader(fid, data, strip_crc=True)
    out = Parsed()
    try:
        r.skip(7)
        r.i16()  # sleep duration, minutes
        bed = r.i32()
        wake = r.i32()
        r.skip(3)
        r.skip(8)  # deep, light, rem, wake durations
        r.u8()
        changes = []
        while r.remaining() > 0:
            changes.append((r.i32(), r.u8()))
    except struct.error as e:
        raise error(fid, data, f"truncated sleep stages: {e}")
    if bed == 0 or wake == 0:
        out.warnings.append(f"{fid.describe()}: sleep stages without data")
        return out
    runs = []
    for i, (t, phase) in enumerate(changes):
        name = GB_STAGE_NAMES.get(phase)
        if not name:
            continue
        end = changes[i + 1][0] if i + 1 < len(changes) else wake
        runs.append((name, t * 1000, end * 1000))
    out.sessions.append(build_session(bed, wake, runs))
    return out
