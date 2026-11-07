"""Mi Body Composition Scale 2 (XMTZC05HM) over BLE advertisements. No pairing needed.

The scale puts a 13-byte frame in the service data of UUID 0x181B (Body Composition) while it is
awake. Layout and flag bits ported from openScale's MiScaleHandler.kt (parseLive13), which reads
the same frame from the GATT history characteristic:

    0      control 0   bit0 = weight in lb
    1      control 1   bit1 = impedance present, bit5 = stabilised, bit6 = weight in jin (0.5 kg),
                       bit7 = weight removed (stepped off)
    2-3    year (u16 LE)
    4..8   month, day, hour, minute, second (the scale's local clock)
    9-10   impedance, ohm (u16 LE)
    11-12  weight (u16 LE): /200 = kg, /100 = lb or jin
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from . import bodycomp

SERVICE_UUID = "0000181b-0000-1000-8000-00805f9b34fb"
FRAME_LEN = 13
LB_TO_KG = 0.45359237
GRACE_S = 6.0  # wait this long after a stabilised weight for the impedance frame
SAME_WEIGHT_KG = 0.3  # frames within this of each other, and within 2 min, are one weigh-in
SAME_WEIGHIN_MS = 120_000


@dataclass(frozen=True)
class Advert:
    raw: bytes
    unit: str  # "kg" | "lb" | "jin"
    stabilized: bool
    has_impedance: bool
    removed: bool
    time: datetime  # the scale's own clock, naive local time
    impedance: int  # 0 when none
    weight_kg: float

    def describe(self) -> str:
        flags = [n for n, on in (("stable", self.stabilized), ("imp", self.has_impedance),
                                 ("removed", self.removed)) if on]
        return (f"{self.time:%Y-%m-%d %H:%M:%S}  {self.weight_kg:7.2f} kg  imp={self.impedance:<5d} "
                f"[{','.join(flags) or '-'}]  {self.raw.hex()}")


def decode_advert(data: bytes) -> Advert:
    """Decode the 0x181B service data. Raises ValueError (with the hex) on anything unexpected."""
    if len(data) != FRAME_LEN:
        raise ValueError(f"expected {FRAME_LEN} bytes, got {len(data)}: {bytes(data).hex()}")
    c0, c1 = data[0], data[1]
    year = data[2] | data[3] << 8
    try:
        when = datetime(year, data[4], data[5], data[6], data[7], data[8])
    except ValueError as e:
        raise ValueError(f"bad timestamp ({e}): {bytes(data).hex()}") from None
    raw_w = data[11] | data[12] << 8
    if c0 & 0x01:
        unit, kg = "lb", raw_w / 100.0 * LB_TO_KG
    elif c1 & 0x40:
        unit, kg = "jin", raw_w / 100.0 * 0.5
    else:
        unit, kg = "kg", raw_w / 200.0
    return Advert(raw=bytes(data), unit=unit, stabilized=bool(c1 & 0x20), has_impedance=bool(c1 & 0x02),
                  removed=bool(c1 & 0x80), time=when, impedance=data[9] | data[10] << 8, weight_kg=kg)


def to_ms(local: datetime) -> int:
    return int(local.astimezone().timestamp() * 1000)


def resolve_time_ms(a: Advert, received_ms: int) -> int:
    """When the advert arrived. The scale's clock isn't trusted (the user's runs exactly an hour behind,
    seen 2026-11-06) and only live frames get here (replays carry `removed`). Same as the Kotlin tracker."""
    return received_ms


@dataclass(frozen=True)
class Reading:
    """A finished weigh-in. `impedance` is None when the scale gave none (socks, shoes)."""
    time_ms: int
    weight_kg: float
    impedance: int | None


class _Cluster:
    def __init__(self, time_ms: int, weight: float):
        self.time_ms, self.weight, self.last_ms = time_ms, weight, time_ms
        self.since: float | None = None  # monotonic time of the first stabilised frame without impedance
        self.sent_weight = False
        self.sent_full = False


class ReadingTracker:
    """Turns the stream of adverts into one Reading per weigh-in.

    A reading is final when a stabilised frame carries impedance, or when a stabilised weight
    has waited `grace_s` (or the user stepped off) without any impedance arriving. A late
    impedance frame for the same weigh-in re-emits the reading with the same time so the
    store overwrites the weight-only rows. Byte-identical repeated adverts are dropped.
    """

    def __init__(self, grace_s: float = GRACE_S):
        self.grace_s = grace_s
        self._cluster: _Cluster | None = None
        self._seen: list[bytes] = []

    def feed(self, a: Advert, mono: float, received_ms: int) -> list[Reading]:
        if a.raw in self._seen:
            return self.poll(mono)
        self._seen = (self._seen + [a.raw])[-64:]
        out: list[Reading] = []
        if a.removed:
            out += self._flush()
            self._cluster = None
            return out
        if not a.stabilized:
            return self.poll(mono)
        t = resolve_time_ms(a, received_ms)
        c = self._cluster
        if c is None or abs(c.weight - a.weight_kg) > SAME_WEIGHT_KG or abs(t - c.last_ms) > SAME_WEIGHIN_MS:
            out += self._flush()
            c = self._cluster = _Cluster(t, a.weight_kg)
        c.last_ms = t
        if a.has_impedance and a.impedance > 0:
            if not c.sent_full:
                c.sent_full = True
                out.append(Reading(c.time_ms, a.weight_kg, a.impedance))
        elif c.since is None:
            c.since = mono
        return out + self.poll(mono)

    def poll(self, mono: float) -> list[Reading]:
        c = self._cluster
        if c and c.since is not None and mono - c.since >= self.grace_s:
            return self._flush()
        return []

    def flush(self) -> list[Reading]:
        """End of scan: emit a weight-only reading that is still waiting for impedance."""
        return self._flush()

    def _flush(self) -> list[Reading]:
        c = self._cluster
        if c and c.since is not None and not c.sent_weight and not c.sent_full:
            c.sent_weight = True
            return [Reading(c.time_ms, c.weight, None)]
        return []


@dataclass(frozen=True)
class Profile:
    height_cm: float
    birth_date: date
    sex: str  # "male" | "female"


def profile_from_config(cfg) -> Profile | None:
    if not (cfg.height_cm and cfg.birth_date and cfg.sex):
        return None
    sex = "male" if cfg.sex.startswith("m") else "female" if cfg.sex.startswith("f") else None
    return Profile(cfg.height_cm, cfg.birth_date, sex) if sex else None


def build_samples(reading: Reading, profile: Profile | None) -> list:
    """Samples for every Metrics.SCALE metric we can compute, all stamped with the weigh-in time."""
    from .activity import Sample
    t = reading.time_ms
    values: list[tuple[str, float | None]] = [("weight_kg", reading.weight_kg), ("impedance", reading.impedance)]
    if profile:
        age = bodycomp.age_on(profile.birth_date, datetime.fromtimestamp(t / 1000).date())
        c = bodycomp.compose(reading.weight_kg, reading.impedance, profile.height_cm, age, profile.sex)
        values += [("body_fat_pct", c.body_fat_pct), ("muscle_kg", c.muscle_kg), ("water_pct", c.water_pct),
                   ("bone_kg", c.bone_kg), ("visceral_fat", c.visceral_fat), ("bmr_kcal", c.bmr_kcal),
                   ("bmi", c.bmi)]
    return [Sample(m, t, None, round(float(v), 3 if m == "weight_kg" else 2)) for m, v in values if v is not None]


def describe_reading(r: Reading, samples: list) -> str:
    when = datetime.fromtimestamp(r.time_ms / 1000)
    parts = ", ".join(f"{s.metric}={s.value:g}" for s in samples)
    return f"FINAL {when:%Y-%m-%d %H:%M:%S}  {parts}"


async def scan(seconds: float, on_advert, on_reading, tracker: ReadingTracker | None = None) -> None:
    """Passive scan for `seconds`; calls on_advert(address, Advert) and on_reading(Reading)."""
    from bleak import BleakScanner
    tracker = tracker or ReadingTracker()

    def emit(readings):
        for r in readings:
            on_reading(r)

    def on_detect(device, adv):
        data = (adv.service_data or {}).get(SERVICE_UUID)
        if data is None:
            return
        try:
            a = decode_advert(data)
        except ValueError as e:
            print(f"! undecodable scale advert from {device.address}: {e}")
            return
        on_advert(device.address, a)
        emit(tracker.feed(a, time.monotonic(), int(time.time() * 1000)))

    async with BleakScanner(detection_callback=on_detect):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            await asyncio.sleep(0.25)
            emit(tracker.poll(time.monotonic()))
    emit(tracker.flush())


def run_scale(args) -> int:
    from . import config
    cfg = config.load()
    profile = profile_from_config(cfg)
    if not profile:
        print("! PROFILE_HEIGHT_CM / PROFILE_BIRTH_DATE / PROFILE_SEX missing in .env: weight and impedance only")
    all_samples: list = []
    state = {"addr": None, "warned": False}

    def on_advert(addr, a: Advert):
        if state["addr"] != addr:
            state["addr"] = addr
            print(f"scale advert source {addr}")
        print(a.describe())
        skew = abs((datetime.now() - a.time).total_seconds())
        if skew > 600 and not state["warned"]:
            state["warned"] = True
            print(f"! the scale's clock is {timedelta(seconds=int(skew))} off from this PC")

    def on_reading(r: Reading):
        samples = build_samples(r, profile)
        all_samples.extend(samples)
        print(describe_reading(r, samples))

    print(f"scanning {args.seconds:g}s for the scale (step on it barefoot)...")
    from bleak.exc import BleakError
    try:
        asyncio.run(scan(args.seconds, on_advert, on_reading))
    except BleakError as e:
        print(f"! Bluetooth scan failed: {e}")
        return 2
    if not all_samples:
        print("no final reading seen")
        return 1
    if args.ingest:
        from .activity import Parsed
        from .ingest import upload_pending
        from .store import LabStore
        store = LabStore()
        store.write(Parsed(samples=all_samples, sessions=[]))
        print(upload_pending(store, cfg))
    return 0


def add_cli(subparsers) -> None:
    p = subparsers.add_parser("scale", help="listen for Mi Body Composition Scale 2 weigh-ins")
    p.add_argument("--seconds", type=float, default=120, help="how long to scan (default 120)")
    p.add_argument("--ingest", action="store_true", help="store the readings and upload them")
    p.set_defaults(func=run_scale)
