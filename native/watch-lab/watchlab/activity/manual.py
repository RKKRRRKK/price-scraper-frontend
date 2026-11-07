"""Manual / spot measurements. Ported from ManualSamplesParser.java."""
from __future__ import annotations

import struct

from ._util import error, log, start_reader
from .model import FileId, Parsed, Sample

TYPE_HR = 0x11
TYPE_SPO2 = 0x12
TYPE_STRESS = 0x13
TYPE_TEMPERATURE = 0x44


def decode_v1(fid: FileId, data: bytes) -> list[tuple[int, int, int]]:
    """Version 1: 0xff header byte, then 6-byte records (u32 ts, u8 type, u8 value). Strict like
    Gadgetbridge: any unexpected header, type or value rejects the whole file.
    Returns (timestamp_s, type, value)."""
    if len(data) < 19:
        raise error(fid, data, "manual samples v1 packet too short")
    r = start_reader(fid, data, strip_crc=True)
    if data[7] != 0:
        raise error(fid, data, f"unexpected padding {data[7]} after the file id")
    header = r.u8()
    if header != 0xFF:
        raise error(fid, data, f"unexpected manual samples v1 header {header:#04x}")
    if r.remaining() == 0 or r.remaining() % 6 != 0:
        raise error(fid, data, f"unexpected manual samples v1 payload length {r.remaining()}")
    out = []
    while r.remaining():
        ts, type_v1, value = r.u32(), r.u8(), r.u8()
        if type_v1 == 0x02:
            typ = TYPE_SPO2
        elif type_v1 == 0x03:
            typ = TYPE_STRESS
        else:
            raise error(fid, data, f"unknown manual samples v1 type {type_v1:#04x}")
        if value == 0 or value > 100:
            raise error(fid, data, f"invalid manual samples v1 value {value} for type {type_v1:#04x}")
        out.append((ts, typ, value))
    return out


def decode_v2(fid: FileId, data: bytes) -> list[tuple[int, int, int]]:
    """Version 2: no header, records of u32 ts, u8 type, then a 1-byte value (hr, spo2, stress) or
    a 4-byte value (temperature). A zero value is skipped; an unknown type aborts the file."""
    r = start_reader(fid, data, strip_crc=True)
    out = []
    try:
        while r.remaining():
            ts, typ = r.u32(), r.u8()
            if typ in (TYPE_HR, TYPE_SPO2, TYPE_STRESS):
                value = r.u8()
            elif typ == TYPE_TEMPERATURE:
                value = r.i32()
            else:
                raise error(fid, data, f"unknown manual sample type {typ:#04x} at {r.pos - 5}; "
                                       f"cannot continue since its size is unknown")
            if value != 0:
                out.append((ts, typ, value))
    except struct.error as e:
        raise error(fid, data, f"truncated manual samples: {e}")
    return out


def parse_manual_samples(fid: FileId, data: bytes) -> Parsed:
    if fid.version == 1:
        records = decode_v1(fid, data)
    elif fid.version == 2:
        records = decode_v2(fid, data)
    else:
        raise error(fid, data, f"unknown manual samples version {fid.version}")
    out = Parsed()
    for ts, typ, value in records:
        start = ts * 1000
        if typ == TYPE_HR:
            if 10 <= value <= 250:
                out.samples.append(Sample("heart_rate", start, None, float(value)))
        elif typ == TYPE_SPO2:
            if 0 < value <= 100:
                out.samples.append(Sample("spo2", start, None, float(value)))
        elif typ == TYPE_STRESS:
            if 0 < value <= 100:
                out.samples.append(Sample("stress", start, None, float(value)))
        elif typ == TYPE_TEMPERATURE:
            # Low 16 bits = skin temperature in 0.01 degC (the high half is a body-temperature
            # slot that stays 0); Gadgetbridge reports the same half.
            temp = (value & 0xFFFF) / 100.0
            if temp > 0:
                out.samples.append(Sample("skin_temp_c", start, None, temp))
        else:
            log.warning("%s: unhandled manual sample type %#x", fid.describe(), typ)
    return out
