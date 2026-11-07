"""Byte-level helpers: the bitmap-driven group reader and validity bitmaps."""
from __future__ import annotations

import logging
import struct
import zlib

from .model import ActivityParseError, FileId

log = logging.getLogger("watchlab.activity")


def crc32_ok(data: bytes) -> bool:
    """True when the trailing little-endian CRC32 matches the rest of the file."""
    return len(data) >= 5 and zlib.crc32(data[:-4]) & 0xFFFFFFFF == struct.unpack_from("<I", data, len(data) - 4)[0]


def valid_data(header: bytes, i: int) -> bool:
    """Bit `i` of a validity bitmap, MSB first within each byte."""
    return (header[i // 8] & (1 << (7 - (i % 8)))) != 0


def hexhead(data: bytes, n: int = 24) -> str:
    return data[:n].hex() + ("..." if len(data) > n else "")


def error(file_id: FileId, data: bytes, msg: str) -> ActivityParseError:
    return ActivityParseError(f"{file_id.describe()}: {msg} (len={len(data)}, head={hexhead(data)})")


class Reader:
    """Sequential reader over data[pos:limit]; underflow raises struct.error."""

    def __init__(self, data: bytes, pos: int = 0, limit: int | None = None, big: bool = False):
        self.data = data
        self.pos = pos
        self.limit = len(data) if limit is None else limit
        self.e = ">" if big else "<"

    def remaining(self) -> int:
        return self.limit - self.pos

    def _take(self, fmt: str, size: int):
        if self.pos + size > self.limit:
            raise struct.error(f"need {size} bytes at {self.pos}, limit {self.limit}")
        v = struct.unpack_from(self.e + fmt, self.data, self.pos)[0]
        self.pos += size
        return v

    def u8(self) -> int: return self._take("B", 1)
    def i8(self) -> int: return self._take("b", 1)
    def i16(self) -> int: return self._take("h", 2)
    def u16(self) -> int: return self._take("H", 2)
    def i32(self) -> int: return self._take("i", 4)
    def u32(self) -> int: return self._take("I", 4)
    def i64(self) -> int: return self._take("q", 8)
    def f32(self) -> float: return self._take("f", 4)

    def skip(self, n: int) -> None:
        if self.pos + n > self.limit:
            raise struct.error(f"skip {n} at {self.pos}, limit {self.limit}")
        self.pos += n

    def take(self, n: int) -> bytes:
        if self.pos + n > self.limit:
            raise struct.error(f"need {n} bytes at {self.pos}, limit {self.limit}")
        b = self.data[self.pos:self.pos + n]
        self.pos += n
        return b


def start_reader(file_id: FileId, data: bytes, strip_crc: bool) -> Reader:
    """Reader positioned after the 7-byte file id and the padding byte (which should be 0)."""
    if len(data) < 8 + (4 if strip_crc else 0):
        raise error(file_id, data, "file too short")
    r = Reader(data, limit=len(data) - 4 if strip_crc else len(data))
    r.skip(7)
    if r.u8() != 0:
        log.warning("%s: expected 0 padding after the file id, got %d", file_id.describe(), data[7])
    return r


class ComplexGroups:
    """Port of XiaomiComplexActivityParser: a header of nibbles says which groups are present.

    Each nibble: bit 3 = group exists (and consumes its bytes), bits 2..0 = which of the three
    sub-values inside the group are valid.
    """

    def __init__(self, header: bytes, r: Reader):
        self.header = header
        self.r = r
        self.reset()

    def reset(self) -> None:
        self.group = -1
        self.bits = 0
        self.val = 0

    def _consume(self, n_bits: int) -> int:
        if n_bits == 8:
            return self.r.u8()
        if n_bits == 16:
            return self.r.u16()
        if n_bits == 32:
            return self.r.u32()
        raise ValueError(f"unsupported group width {n_bits}")

    def _nibble(self) -> int:
        b = self.header[self.group // 2]
        return (b >> 4) & 0xF if self.group % 2 == 0 else b & 0xF

    def next_group(self, n_bits: int) -> bool:
        self.group += 1
        if self.group >= len(self.header) * 2:
            log.error("header too small for group %d", self.group)
            self._consume(n_bits)
            return False
        if (self._nibble() & 8) == 0:
            return False
        self.bits = n_bits
        self.val = self._consume(n_bits)
        return (self._nibble() & 8) != 0

    def is_valid(self, idx: int) -> bool:
        return (self._nibble() & (1 << (2 - idx))) != 0

    def has_first(self) -> bool: return self.is_valid(0)
    def has_second(self) -> bool: return self.is_valid(1)
    def has_third(self) -> bool: return self.is_valid(2)

    def get(self, idx: int, n_bits: int) -> int:
        shift = self.bits - idx - n_bits
        return (self.val & (((1 << n_bits) - 1) << shift)) >> shift
