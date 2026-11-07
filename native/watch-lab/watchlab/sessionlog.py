"""Per-session packet log: out/session-<timestamp>.log. Never writes the auth key."""
from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from google.protobuf import text_format

from .config import OUT_DIR

MAX_HEX = 512  # bytes of a payload logged in hex; activity files can be large


def proto_text(msg) -> str:
    try:
        return text_format.MessageToString(msg, as_utf8=True).rstrip()
    except Exception as e:  # pragma: no cover
        return f"<undecodable: {e}>"


class SessionLog:
    def __init__(self, directory: Path = OUT_DIR, verbose: bool = False, echo=print) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / f"session-{datetime.now():%Y%m%d-%H%M%S}.log"
        self._f = open(self.path, "a", encoding="utf-8", buffering=1)
        self.verbose = verbose
        self.echo = echo

    @staticmethod
    def _ts() -> str:
        t = time.time()
        return time.strftime("%H:%M:%S", time.localtime(t)) + f".{int((t % 1) * 1000):03d}"

    def write(self, line: str) -> None:
        self._f.write(f"{self._ts()} {line}\n")

    def note(self, text: str) -> None:
        self.write(f"NOTE {text}")

    def frame(self, direction: str, info: str, frame: bytes) -> None:
        """A raw SPP frame (the bytes on the wire, encrypted payload included)."""
        hx = frame[:MAX_HEX].hex() + (f"...(+{len(frame) - MAX_HEX}B)" if len(frame) > MAX_HEX else "")
        self.write(f"{direction.upper():2} FRAME {info} | {hx}")
        if self.verbose:
            self.echo(f"  [{direction}] {info}\n       {hx}")

    def payload(self, direction: str, channel: str, data: bytes, decoded: Optional[str] = None) -> None:
        hx = data[:MAX_HEX].hex() + (f"...(+{len(data) - MAX_HEX}B)" if len(data) > MAX_HEX else "")
        self.write(f"{direction.upper():2} {channel} {len(data)}B | {hx}")
        if decoded:
            for ln in decoded.splitlines():
                self._f.write(f"      {ln}\n")
        if self.verbose:
            self.echo(f"  [{direction}] {channel} {len(data)}B {hx}")
            if decoded:
                for ln in decoded.splitlines():
                    self.echo(f"       {ln}")

    def close(self) -> None:
        try:
            self._f.close()
        except Exception:
            pass
