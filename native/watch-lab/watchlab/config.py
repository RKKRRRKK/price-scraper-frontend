"""Lab configuration, read from `.env` next to `lab.py`. Never prints secret values."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

LAB_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = LAB_DIR / ".env"
OUT_DIR = LAB_DIR / "out"


@dataclass
class Config:
    watch_address: str | None = None
    watch_auth_key: bytes | None = None
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    health_token: str | None = None
    height_cm: float | None = None
    birth_date: date | None = None
    sex: str | None = None
    lab_dir: Path = field(default=LAB_DIR, repr=False)
    out_dir: Path = field(default=OUT_DIR, repr=False)

    def key_hint(self) -> str:
        """First 4 hex chars of the auth key, the most we ever log."""
        return self.watch_auth_key[:2].hex() + "..." if self.watch_auth_key else "(none)"

    def __repr__(self) -> str:
        return (f"Config(watch_address={self.watch_address!r}, auth_key={self.key_hint()}, "
                f"supabase={'set' if self.supabase_url else 'unset'}, profile={self.sex}/{self.height_cm})")


def _parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        values[k.strip()] = v
    return values


def normalize_address(addr: str | None) -> str | None:
    if not addr:
        return None
    a = addr.strip().upper().replace("-", ":")
    if len(a) == 12 and ":" not in a:
        a = ":".join(a[i:i + 2] for i in range(0, 12, 2))
    return a


def address_to_int(addr: str) -> int:
    return int(addr.replace(":", ""), 16)


def load(path: Path | str | None = None) -> Config:
    env = _parse_env(Path(path) if path else ENV_PATH)
    for k, v in os.environ.items():  # real environment wins over the file
        if k in env or k.startswith(("WATCH_", "SUPABASE_", "HEALTH_", "PROFILE_")):
            env[k] = v

    def get(k: str) -> str | None:
        v = env.get(k, "").strip()
        return v or None

    key = None
    k_hex = get("WATCH_AUTH_KEY")
    if k_hex:
        k_hex = k_hex.replace(" ", "").removeprefix("0x")
        try:
            key = bytes.fromhex(k_hex)
        except ValueError:
            raise ValueError("WATCH_AUTH_KEY in .env is not valid hex (expected 32 hex chars)") from None
        if len(key) != 16:
            raise ValueError(f"WATCH_AUTH_KEY must be 16 bytes (32 hex chars), got {len(key)} bytes")

    height = get("PROFILE_HEIGHT_CM")
    birth = get("PROFILE_BIRTH_DATE")
    return Config(
        watch_address=normalize_address(get("WATCH_ADDRESS")),
        watch_auth_key=key,
        supabase_url=(get("SUPABASE_URL") or "").rstrip("/") or None,
        supabase_anon_key=get("SUPABASE_ANON_KEY"),
        health_token=get("HEALTH_TOKEN"),
        height_cm=float(height) if height else None,
        birth_date=date.fromisoformat(birth) if birth else None,
        sex=(get("PROFILE_SEX") or "").lower() or None,
    )
