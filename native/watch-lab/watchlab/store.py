"""The lab's local store: SQLite at out/lab.db with the same tables and keys as the phone's Room DB
(Entities.kt / HealthStore.kt), so lab data and phone data upload identically."""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from .activity import FileId, Parsed, Sample, Session, merge_session

SOURCE = "healthbridge"
LAB_DIR = Path(__file__).resolve().parent.parent

_SCHEMA = """
create table if not exists samples (
  metric text not null, start integer not null, "end" integer, value real not null,
  source text not null default 'healthbridge',
  primary key (metric, start)
);
create table if not exists sessions (
  id text primary key, kind text not null, start integer not null, "end" integer not null,
  title text, exercise_type integer, stages_json text not null default '[]', details_json text,
  source text not null default 'healthbridge'
);
create index if not exists sessions_kind_start on sessions (kind, start);
create table if not exists upload_queue (
  key text primary key, queued_at integer not null, attempts integer not null default 0
);
create table if not exists raw_files (
  file_id text primary key, timestamp integer not null, type integer not null, subtype integer not null,
  detail_type integer not null, version integer not null, fetched_at integer not null, bytes blob not null,
  parsed integer not null default 0, parse_error text
);
create index if not exists raw_files_timestamp on raw_files (timestamp);
"""


def utc_day(epoch_ms: int) -> str:
    """UTC day of an epoch-ms time, yyyy-mm-dd (HealthStore.utcDay)."""
    return datetime.fromtimestamp(epoch_ms // 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def sample_key(metric: str, start_ms: int) -> str:
    return f"s:{metric}:{utc_day(start_ms)}"


def sample_record_id(metric: str, day: str) -> str:
    return f"hb:{metric}:{day}"


def session_from_row(row) -> Session:
    return Session(row["id"], row["kind"], row["start"], row["end"], row["title"], row["exercise_type"],
                   json.loads(row["stages_json"] or "[]"),
                   json.loads(row["details_json"]) if row["details_json"] else None)


class LabStore:
    def __init__(self, path: str = "out/lab.db"):
        p = Path(path)
        if not p.is_absolute():
            p = LAB_DIR / p
        p.parent.mkdir(parents=True, exist_ok=True)
        self.path = p
        self.db = sqlite3.connect(str(p))
        self.db.row_factory = sqlite3.Row
        self.db.executescript(_SCHEMA)
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    # -- raw files ---------------------------------------------------------------------------

    def put_raw_file(self, file_id: FileId, data: bytes) -> None:
        self.db.execute(
            "insert or replace into raw_files (file_id, timestamp, type, subtype, detail_type, version, "
            "fetched_at, bytes, parsed, parse_error) values (?,?,?,?,?,?,?,?,0,null)",
            (file_id.hex, file_id.timestamp, file_id.type, file_id.subtype, file_id.detail_type,
             file_id.version, int(time.time() * 1000), bytes(data)))
        self.db.commit()

    def raw_files(self) -> list[tuple[FileId, bytes]]:
        """Every stored file in fetch order (summary before details before GPS)."""
        rows = self.db.execute("select file_id, bytes from raw_files").fetchall()
        out = [(FileId.from_bytes(bytes.fromhex(r["file_id"])), bytes(r["bytes"])) for r in rows]
        out.sort(key=lambda x: x[0].sort_key)
        return out

    def mark_parsed(self, file_id: FileId, error: str | None = None) -> None:
        self.db.execute("update raw_files set parsed = ?, parse_error = ? where file_id = ?",
                        (1 if error is None else 0, error, file_id.hex))
        self.db.commit()

    def raw_file_errors(self) -> list[tuple[str, str]]:
        return [(r["file_id"], r["parse_error"]) for r in
                self.db.execute("select file_id, parse_error from raw_files where parse_error is not null")]

    # -- parsed data -------------------------------------------------------------------------

    def session(self, session_id: str) -> Session | None:
        row = self.db.execute("select * from sessions where id = ?", (session_id,)).fetchone()
        return session_from_row(row) if row else None

    def write(self, parsed: Parsed) -> None:
        """Upsert samples, merge sessions with the stored ones, queue the touched metric-days
        (`s:<metric>:<utc day>`) and sessions (`x:<id>`) for upload."""
        if not parsed.samples and not parsed.sessions:
            return
        now = int(time.time() * 1000)
        keys: set[str] = set()
        with self.db:
            for s in parsed.samples:
                self.db.execute(
                    "insert into samples (metric, start, \"end\", value, source) values (?,?,?,?,?) "
                    "on conflict (metric, start) do update set \"end\" = excluded.\"end\", "
                    "value = excluded.value, source = excluded.source",
                    (s.metric, s.start, s.end, s.value, SOURCE))
                keys.add(sample_key(s.metric, s.start))
            for sess in parsed.sessions:
                merged = merge_session(self.session(sess.id), sess)
                self.db.execute(
                    "insert or replace into sessions (id, kind, start, \"end\", title, exercise_type, "
                    "stages_json, details_json, source) values (?,?,?,?,?,?,?,?,?)",
                    (merged.id, merged.kind, merged.start, merged.end, merged.title, merged.exercise_type,
                     json.dumps(merged.stages), json.dumps(merged.details) if merged.details else None, SOURCE))
                keys.add(f"x:{merged.id}")
            self.db.executemany(
                "insert into upload_queue (key, queued_at, attempts) values (?,?,0) "
                "on conflict (key) do update set queued_at = excluded.queued_at",
                [(k, now) for k in keys])

    # -- upload queue ------------------------------------------------------------------------

    def pending_count(self) -> int:
        return self.db.execute("select count(*) from upload_queue").fetchone()[0]

    def pending_keys(self) -> list[str]:
        return [r[0] for r in self.db.execute("select key from upload_queue order by queued_at, key")]

    def mark_done(self, keys: list[str]) -> None:
        with self.db:
            self.db.executemany("delete from upload_queue where key = ?", [(k,) for k in keys])

    def bump_attempts(self, keys: list[str]) -> None:
        with self.db:
            self.db.executemany("update upload_queue set attempts = attempts + 1 where key = ?",
                                [(k,) for k in keys])

    def metric_day(self, metric: str, day: str) -> list[Sample]:
        """All stored rows of one metric on one UTC day, oldest first."""
        t0 = int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)
        rows = self.db.execute(
            "select metric, start, \"end\", value from samples where metric = ? and start >= ? and start < ? "
            "order by start", (metric, t0, t0 + 86_400_000)).fetchall()
        return [Sample(r["metric"], r["start"], r["end"], r["value"]) for r in rows]

    # -- reporting ---------------------------------------------------------------------------

    def summary(self) -> dict:
        samples = [dict(metric=r[0], n=r[1], first=r[2], last=r[3]) for r in self.db.execute(
            "select metric, count(*), min(start), max(start) from samples group by metric order by metric")]
        sessions = [dict(kind=r[0], n=r[1], first=r[2], last=r[3]) for r in self.db.execute(
            "select kind, count(*), min(start), max(\"end\") from sessions group by kind order by kind")]
        raw = self.db.execute("select count(*), coalesce(sum(parsed), 0), "
                              "coalesce(sum(parse_error is not null), 0) from raw_files").fetchone()
        return {"samples": samples, "sessions": sessions, "pending": self.pending_count(),
                "raw_files": {"total": raw[0], "parsed": raw[1], "failed": raw[2]}}

    def summary_text(self) -> str:
        def t(ms):
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M") if ms else "-"
        s = self.summary()
        lines = ["samples:"]
        lines += [f"  {r['metric']:<20} {r['n']:>7} rows  {t(r['first'])} .. {t(r['last'])} UTC" for r in s["samples"]]
        lines.append("sessions:")
        lines += [f"  {r['kind']:<20} {r['n']:>7}       {t(r['first'])} .. {t(r['last'])} UTC" for r in s["sessions"]]
        rf = s["raw_files"]
        lines.append(f"raw files: {rf['total']} stored, {rf['parsed']} parsed, {rf['failed']} failed; "
                     f"{s['pending']} uploads pending")
        return "\n".join(lines)
