"""Daily details (per-minute series) and daily summary. Ported from DailyDetailsParser.java and
DailySummaryParser.java in Gadgetbridge."""
from __future__ import annotations

import struct

from ._util import ComplexGroups, error, log, start_reader, valid_data
from .model import FileId, Parsed, Sample

HR_MIN, HR_MAX = 10, 250  # Gadgetbridge's HeartRateUtils defaults


def parse_daily_details(fid: FileId, data: bytes) -> Parsed:
    """One file = consecutive minutes starting at the file timestamp, one record per minute."""
    header_size = {1: 4, 2: 4, 3: 5, 4: 6}.get(fid.version)
    if header_size is None:
        raise error(fid, data, f"unsupported daily details version {fid.version}")
    r = start_reader(fid, data, strip_crc=True)
    try:
        header = r.take(header_size)
    except struct.error as e:
        raise error(fid, data, f"truncated header: {e}")
    groups = ComplexGroups(header, r)
    out = Parsed()
    minute = 0
    try:
        while r.pos < r.limit:
            groups.reset()
            steps = kcal = dist = hr = energy = spo2 = stress = None
            extra = 0
            if groups.next_group(16):
                if groups.has_second():
                    extra = groups.get(1, 1)
                if groups.has_third():
                    steps = groups.get(2, 14)
            if groups.next_group(8):
                if groups.has_second():
                    kcal = groups.get(2, 6)
            groups.next_group(8)
            if groups.next_group(16):
                if groups.has_first():
                    dist = groups.get(0, 16)
            if groups.next_group(8):
                if groups.has_first():
                    hr = groups.get(0, 8)
            if groups.next_group(8):
                if groups.has_first():
                    energy = groups.get(0, 8)
            groups.next_group(16)
            if fid.version >= 3:
                if groups.next_group(8):
                    if groups.has_first():
                        spo2 = groups.get(0, 8)
                if groups.next_group(8):
                    if groups.has_first():
                        s = groups.get(0, 8)
                        if s != 255:
                            stress = s
            if extra == 1:
                r.u8()
            if fid.version >= 4:
                groups.next_group(16)  # light
                groups.next_group(16)  # body momentum
            start = (fid.timestamp + 60 * minute) * 1000
            end = start + 60_000
            if steps:
                out.samples.append(Sample("steps", start, end, float(steps)))
            if kcal:
                out.samples.append(Sample("active_kcal", start, end, float(kcal)))
            if dist:
                out.samples.append(Sample("distance_m", start, end, float(dist)))
            if hr is not None and HR_MIN <= hr <= HR_MAX:
                out.samples.append(Sample("heart_rate", start, None, float(hr)))
            if energy is not None and 0 < energy <= 100:
                out.samples.append(Sample("body_energy", start, None, float(energy)))
            if spo2 is not None and 0 < spo2 <= 100:
                out.samples.append(Sample("spo2", start, None, float(spo2)))
            if stress is not None and 0 < stress <= 100:
                out.samples.append(Sample("stress", start, None, float(stress)))
            minute += 1
    except struct.error as e:
        msg = f"{fid.describe()}: daily details truncated at minute {minute} ({e}); kept {len(out.samples)} samples"
        log.warning(msg)
        out.warnings.append(msg)
    return out


# (name, struct format or None for a skipped reserved byte run, size)
_SLOTS = [
    ("steps", "i", 4), ("active_calories", "H", 2), (None, None, 1), ("hr_resting", "B", 1),
    ("hr_max", "B", 1), ("hr_max_ts", "i", 4), ("hr_min", "B", 1), ("hr_min_ts", "i", 4),
    ("hr_avg", "B", 1), ("stress_avg", "B", 1), ("stress_max", "B", 1), ("stress_min", "B", 1),
    ("standing", "3B", 3), ("calories", "H", 2), ("recovery_hours", "H", 2), (None, None, 1),
    ("spo2_max", "B", 1), ("spo2_max_ts", "i", 4), ("spo2_min", "B", 1), ("spo2_min_ts", "i", 4),
    ("spo2_avg", "B", 1), ("training_load_day", "H", 2), ("training_load_week", "H", 2),
    ("training_load_level", "B", 1), ("vitality_light", "B", 1), ("vitality_moderate", "B", 1),
    ("vitality_high", "B", 1), ("vitality_current", "H", 2), (None, None, 1), (None, None, 1),
    (None, None, 2), (None, None, 2),
]


def decode_daily_summary(fid: FileId, data: bytes) -> dict:
    """Slot values by name; a slot whose validity bit is clear is absent from the dict."""
    header_size, slot_count = {3: (3, 21), 4: (3, 21), 5: (4, 32)}.get(fid.version, (None, None))
    if header_size is None:
        raise error(fid, data, f"unsupported daily summary version {fid.version}")
    r = start_reader(fid, data, strip_crc=False)
    try:
        header = r.take(header_size)
        out: dict = {}
        for i in range(slot_count):
            name, fmt, size = _SLOTS[i]
            raw = r.take(size)
            if name is None or not valid_data(header, i):
                continue
            if fmt == "3B":
                out[name] = raw[0] | (raw[1] << 8) | (raw[2] << 16)
            else:
                out[name] = struct.unpack("<" + fmt, raw)[0]
        return out
    except struct.error as e:
        raise error(fid, data, f"truncated daily summary: {e}")


def parse_daily_summary(fid: FileId, data: bytes) -> Parsed:
    """Resting heart rate and PAI (the daily summary's 'vitality current') at the day's start."""
    s = decode_daily_summary(fid, data)
    out = Parsed()
    start = fid.timestamp * 1000
    hr = s.get("hr_resting")
    if hr is not None and HR_MIN <= hr <= HR_MAX:
        out.samples.append(Sample("resting_heart_rate", start, None, float(hr)))
    if s.get("vitality_current") is not None:
        out.samples.append(Sample("pai", start, None, float(s["vitality_current"])))
    return out
