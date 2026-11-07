"""Data types shared by the activity parsers. Re-exported from `watchlab.activity`."""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from datetime import datetime, timezone

TYPE_ACTIVITY = 0
TYPE_SPORTS = 1

DETAIL_DETAILS = 0
DETAIL_SUMMARY = 1
DETAIL_GPS_TRACK = 2

TYPE_NAMES = {TYPE_ACTIVITY: "ACTIVITY", TYPE_SPORTS: "SPORTS"}
DETAIL_NAMES = {DETAIL_DETAILS: "DETAILS", DETAIL_SUMMARY: "SUMMARY", DETAIL_GPS_TRACK: "GPS_TRACK"}
# Summary first so the workout summary exists before its details / GPS files.
DETAIL_FETCH_ORDER = {DETAIL_SUMMARY: 0, DETAIL_DETAILS: 1, DETAIL_GPS_TRACK: 2}

SUBTYPE_NAMES = {
    (TYPE_ACTIVITY, 0x00): "ACTIVITY_DAILY",
    (TYPE_ACTIVITY, 0x03): "ACTIVITY_SLEEP_STAGES",
    (TYPE_ACTIVITY, 0x06): "ACTIVITY_MANUAL_SAMPLES",
    (TYPE_ACTIVITY, 0x08): "ACTIVITY_SLEEP",
    (TYPE_SPORTS, 0x01): "SPORTS_OUTDOOR_RUNNING",
    (TYPE_SPORTS, 0x02): "SPORTS_OUTDOOR_WALKING_V1",
    (TYPE_SPORTS, 0x03): "SPORTS_TREADMILL",
    (TYPE_SPORTS, 0x06): "SPORTS_OUTDOOR_CYCLING_V2",
    (TYPE_SPORTS, 0x07): "SPORTS_INDOOR_CYCLING",
    (TYPE_SPORTS, 0x08): "SPORTS_FREESTYLE",
    (TYPE_SPORTS, 0x09): "SPORTS_POOL_SWIMMING",
    (TYPE_SPORTS, 0x10): "SPORTS_HIIT",
    (TYPE_SPORTS, 0x0B): "SPORTS_ELLIPTICAL",
    (TYPE_SPORTS, 0x0D): "SPORTS_ROWING",
    (TYPE_SPORTS, 0x0E): "SPORTS_JUMP_ROPING",
    (TYPE_SPORTS, 0x16): "SPORTS_OUTDOOR_WALKING_V2",
    (TYPE_SPORTS, 0x17): "SPORTS_OUTDOOR_CYCLING",
}


class ActivityParseError(Exception):
    """A corrupt or unsupported activity file. The message names the file and shows its first bytes."""


def utc_iso(ms: int) -> str:
    """Instant.toString()-style UTC time: 2026-11-05T10:00:00Z, with .mmm only when non-zero."""
    dt = datetime.fromtimestamp(ms // 1000, tz=timezone.utc)
    frac = ms % 1000
    base = dt.strftime("%Y-%m-%dT%H:%M:%S")
    return f"{base}.{frac:03d}Z" if frac else f"{base}Z"


def _s8(v: int) -> int:
    v &= 0xFF
    return v - 256 if v > 127 else v


@dataclass(frozen=True)
class FileId:
    """The 7-byte Xiaomi activity file id (ported from XiaomiActivityFileId.java).

    Layout, little endian: u32 timestamp (epoch s) | i8 timezone (15 min blocks) | u8 version |
    u8 flags, where flags = type << 7 | subtype << 2 | detail_type.
    """
    timestamp: int
    timezone: int
    version: int
    type: int
    subtype: int
    detail_type: int

    SIZE = 7

    @classmethod
    def from_bytes(cls, b: bytes, offset: int = 0) -> "FileId":
        if len(b) - offset < cls.SIZE:
            raise ActivityParseError(f"file id needs {cls.SIZE} bytes, got {len(b) - offset}: {bytes(b[offset:]).hex()}")
        ts, tz, version, flags = struct.unpack_from("<IbBB", b, offset)
        return cls(ts, tz, version, (flags >> 7) & 1, (flags & 127) >> 2, flags & 3)

    def to_bytes(self) -> bytes:
        flags = ((self.type << 7) | (self.subtype << 2) | self.detail_type) & 0xFF
        return struct.pack("<IbBB", self.timestamp & 0xFFFFFFFF, _s8(self.timezone), self.version & 0xFF, flags)

    @property
    def hex(self) -> str:
        return self.to_bytes().hex()

    @property
    def sort_key(self) -> tuple:
        return (self.timestamp, self.timezone, self.type, self.subtype,
                DETAIL_FETCH_ORDER.get(self.detail_type, 3), self.version)

    @property
    def type_name(self) -> str:
        return TYPE_NAMES.get(self.type, "UNKNOWN")

    @property
    def subtype_name(self) -> str:
        return SUBTYPE_NAMES.get((self.type, self.subtype), "UNKNOWN")

    @property
    def detail_name(self) -> str:
        return DETAIL_NAMES.get(self.detail_type, "UNKNOWN")

    def describe(self) -> str:
        return (f"FileId{{{self.hex} ts={utc_iso(self.timestamp * 1000)} tz={self.timezone} "
                f"type={self.type_name}(0x{self.type:02X}) subtype={self.subtype_name}(0x{self.subtype:02X}) "
                f"detail={self.detail_name}(0x{self.detail_type:02X}) v{self.version}}}")


@dataclass
class Sample:
    """One numeric point, epoch ms. `end` is set for interval values, None for instants."""
    metric: str
    start: int
    end: int | None
    value: float


@dataclass
class Session:
    """A sleep or workout. `stages`: [{"stage","start","end"}] with ISO-8601 UTC strings."""
    id: str
    kind: str
    start: int
    end: int
    title: str | None = None
    exercise_type: int | None = None
    stages: list = field(default_factory=list)
    details: dict | None = None


@dataclass
class Parsed:
    samples: list = field(default_factory=list)
    sessions: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
