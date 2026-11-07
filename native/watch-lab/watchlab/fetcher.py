"""Activity file fetching. Ported from XiaomiActivityFileFetcher + XiaomiHealthService.handleActivityFetchResponse.

Protocol: ask for today's and past files (8/1, 8/2) -> the watch answers with a list of 7-byte file ids;
for each id send 8/3; the watch streams the file on the Activity channel as chunks
`total(u16le) num(u16le) data`. A complete file is `7-byte id | data... | crc32(le) of everything before`.
Acking a file (8/5) makes the watch delete it, so ack is opt-in.
"""
from __future__ import annotations

import asyncio
import logging
import struct
import zlib
from dataclasses import dataclass, field
from typing import Callable, Optional

from . import commands as C
from .client import WatchClient, WatchError

log = logging.getLogger("watchlab.fetcher")

FILE_ID_SIZE = 7
CHUNK_GAP_TIMEOUT = 8.0     # GB waits 5 s between chunks; the first chunk can take longer
FIRST_CHUNK_TIMEOUT = 15.0


def _fetch_order(detail_type: int) -> int:
    # summary first so workout summaries exist before the GPS track is parsed
    return {1: 0, 0: 1, 2: 2}.get(detail_type, 3)


def sort_key(fid):
    return (fid.timestamp, fid.timezone, fid.type, fid.subtype, _fetch_order(fid.detail_type), fid.version)


def split_file_ids(raw: bytes, FileId) -> list:
    if len(raw) % FILE_ID_SIZE:
        log.warning("record ids %s length %d is not a multiple of 7", raw.hex(), len(raw))
        return []
    ids = []
    for off in range(0, len(raw), FILE_ID_SIZE):
        fid = FileId.from_bytes(raw, off)
        if fid.timestamp == 0 and fid.version == 0:
            log.warning("skipping invalid file id with no timestamp and version")
            continue
        ids.append(fid)
    return ids


class ChunkAssembler:
    """Reassembles one file from Activity-channel chunks; returns the full bytes when the last chunk arrives."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def reset(self) -> None:
        self.buf = bytearray()

    def add(self, chunk: bytes) -> Optional[bytes]:
        if len(chunk) < 4:
            log.warning("activity chunk too short: %s", chunk.hex())
            return None
        total, num = struct.unpack_from("<HH", chunk, 0)
        if num == 1:
            self.buf = bytearray()
        self.buf.extend(chunk[4:])
        log.debug("activity chunk %d/%d", num, total)
        if num != total:
            return None
        data = bytes(self.buf)
        self.buf = bytearray()
        return data


def validate_file(data: bytes) -> tuple[bool, str]:
    """Length and CRC checks from XiaomiActivityFileFetcher.addChunk."""
    if len(data) < 13:
        return False, f"too short ({len(data)} bytes)"
    got = zlib.crc32(data[:-4]) & 0xFFFFFFFF
    want = struct.unpack_from("<I", data, len(data) - 4)[0]
    if got != want:
        return False, f"bad crc32: computed {got:08X}, file says {want:08X}"
    note = "" if data[7] == 0 else f"unexpected byte 0x{data[7]:02X} at position 7"
    return True, note


@dataclass
class FetchSummary:
    listed: int = 0
    fetched: int = 0
    bad: int = 0
    timeouts: int = 0
    parsed: int = 0
    parse_failures: int = 0
    acked: int = 0
    samples: int = 0
    sessions: int = 0
    failures: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (f"{self.listed} listed, {self.fetched} fetched ({self.bad} corrupt, {self.timeouts} timed out), "
                f"{self.parsed} parsed ({self.parse_failures} failed), {self.acked} acked, "
                f"{self.samples} samples, {self.sessions} sessions")


def process_file(file_id, data: bytes, store, summary: FetchSummary, say: Callable[[str], None],
                 sessions: dict) -> None:
    """Parse one stored file and write it. Never raises: a failure is recorded and the raw file stays in the store."""
    from .activity import Parsed, merge_session, parse_file
    try:
        parsed = parse_file(file_id, data)
    except Exception as e:
        summary.parse_failures += 1
        msg = f"parse failed for {file_id.describe()}: {type(e).__name__}: {e}  [{len(data)}B {data[:48].hex()}...]"
        summary.failures.append(msg)
        say("  !! " + msg)
        return
    merged = []
    for s in parsed.sessions:
        m = merge_session(sessions.get(s.id), s)
        sessions[s.id] = m
        merged.append(m)
    try:
        store.write(Parsed(samples=parsed.samples, sessions=merged))
    except Exception as e:
        summary.parse_failures += 1
        msg = f"store write failed for {file_id.describe()}: {type(e).__name__}: {e}"
        summary.failures.append(msg)
        say("  !! " + msg)
        return
    summary.parsed += 1
    summary.samples += len(parsed.samples)
    summary.sessions += len(parsed.sessions)
    say(f"  parsed: {len(parsed.samples)} samples, {len(parsed.sessions)} sessions")


async def fetch_activity(client: WatchClient, store, *, ack: bool = False, limit: Optional[int] = None,
                         say: Callable[[str], None] = print) -> FetchSummary:
    from .activity import FileId

    summary = FetchSummary()
    ids: list = []
    for label, cmd, sub in (("today", C.build_fetch_today(), C.HEALTH_FETCH_TODAY),
                            ("past", C.build_fetch_past(), C.HEALTH_FETCH_PAST)):
        reply = await client.send_command(cmd, expect=(C.HEALTH, sub), timeout=15)
        raw = bytes(reply.health.activityRequestFileIds)
        got = split_file_ids(raw, FileId)
        say(f"{label}: {len(got)} file(s) listed" + (f" (status {reply.status})" if reply.HasField("status") else ""))
        ids.extend(got)
    uniq = {f.to_bytes(): f for f in ids}
    queue = sorted(uniq.values(), key=sort_key)
    if limit:
        queue = queue[:limit]
    summary.listed = len(queue)

    assembler = ChunkAssembler()
    done: asyncio.Queue = asyncio.Queue()
    state = {"last": 0.0, "chunks": 0}
    loop = asyncio.get_running_loop()
    client.set_activity_callback(lambda chunk: _on_chunk(chunk, assembler, done, state, loop))
    sessions: dict = {}
    try:
        for i, fid in enumerate(queue, 1):
            say(f"[{i}/{len(queue)}] {fid.describe()}")
            assembler.reset()
            while not done.empty():
                done.get_nowait()
            await client.send_command(C.build_fetch_request(fid.to_bytes()))
            state["last"], state["chunks"] = loop.time(), 0
            data = None
            while data is None:
                try:
                    data = await asyncio.wait_for(done.get(), 1.0)
                except asyncio.TimeoutError:
                    limit = CHUNK_GAP_TIMEOUT if state["chunks"] else FIRST_CHUNK_TIMEOUT
                    if loop.time() - state["last"] > limit:
                        break
            if data is None:
                summary.timeouts += 1
                say(f"  !! file stalled ({state['chunks']} chunk(s) received), skipping")
                continue
            ok, note = validate_file(data)
            if not ok:
                summary.bad += 1
                summary.failures.append(f"{fid.describe()}: {note}")
                say(f"  !! corrupt file ({note}); {len(data)}B {data[:32].hex()} - not stored, not acked")
                continue
            if note:
                say(f"  note: {note}")
            summary.fetched += 1
            real_id = FileId.from_bytes(data[:FILE_ID_SIZE])
            store.put_raw_file(real_id, data)           # raw bytes first, before any ack
            say(f"  stored raw file ({len(data)} bytes)")
            if ack:
                await client.send_command(C.build_fetch_ack(real_id.to_bytes()))
                summary.acked += 1
            process_file(real_id, data, store, summary, say, sessions)
    finally:
        client.set_activity_callback(None)
    return summary


def _on_chunk(chunk: bytes, assembler: ChunkAssembler, done: asyncio.Queue, state: dict, loop) -> None:
    state["last"] = loop.time()
    state["chunks"] += 1
    data = assembler.add(chunk)
    if data is not None:
        done.put_nowait(data)
