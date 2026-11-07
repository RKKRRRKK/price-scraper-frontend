"""Upload the lab store's queue to Supabase through the health_ingest RPC (urllib only).

Each queued metric-day is sent whole (all stored rows of that metric and UTC day) under the record
id hb:<metric>:<day>, which the server replaces as a unit, so replays are harmless.
"""
from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

from .activity.model import utc_iso
from .store import LAB_DIR, SOURCE, LabStore, sample_record_id

MAX_POINTS = 3000


def _sample_record(store: LabStore, key: str):
    _, metric, day = key.split(":", 2)
    rows = store.metric_day(metric, day)
    if not rows:
        return None
    points = [[utc_iso(r.start), utc_iso(r.end) if r.end is not None else None, r.value] for r in rows]
    return {"id": sample_record_id(metric, day), "metric": metric, "source": SOURCE, "points": points}, len(points)


def _session_record(store: LabStore, key: str):
    s = store.session(key[2:])
    if s is None:
        return None
    rec = {"id": s.id, "kind": s.kind, "source": SOURCE, "start": utc_iso(s.start), "end": utc_iso(s.end),
           "title": s.title, "exercise_type": s.exercise_type, "stages": s.stages, "details": s.details}
    return rec, 1 + len(s.stages)


def build_batches(store: LabStore, keys: list[str] | None = None, max_points: int = MAX_POINTS):
    """Returns (batches, empty_keys). A batch is {"keys", "samples", "sessions", "points"}; one record
    id is never split across batches, so a record bigger than `max_points` travels alone."""
    keys = store.pending_keys() if keys is None else keys
    batches: list[dict] = []
    empty: list[str] = []

    def new():
        return {"keys": [], "samples": [], "sessions": [], "points": 0}

    cur = new()
    for key in keys:
        built = _sample_record(store, key) if key.startswith("s:") else _session_record(store, key) if key.startswith("x:") else None
        if built is None:
            empty.append(key)
            continue
        rec, n = built
        if cur["points"] and cur["points"] + n > max_points:
            batches.append(cur)
            cur = new()
        cur["keys"].append(key)
        cur["samples" if key.startswith("s:") else "sessions"].append(rec)
        cur["points"] += n
    if cur["keys"]:
        batches.append(cur)
    return batches, empty


def _post(cfg, payload: dict, device: str) -> dict:
    url = cfg.supabase_url.rstrip("/") + "/rest/v1/rpc/health_ingest"
    body = json.dumps({"p_token": cfg.health_token, "p_device": device, "p_payload": payload}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": cfg.supabase_anon_key,
        "Authorization": f"Bearer {cfg.supabase_anon_key}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=90) as resp:
        text = resp.read().decode("utf-8", "replace")
    return json.loads(text) if text else {}


def upload_pending(store: LabStore, cfg, dry_run: bool = False) -> dict:
    """Send every queued record. Queue items are removed only after a successful response; the first
    failing batch stops the run (its items stay queued with attempts + 1)."""
    batches, empty = build_batches(store)
    if empty:
        store.mark_done(empty)  # queued, but nothing stored any more
    result = {"batches": len(batches), "records": sum(len(b["keys"]) for b in batches),
              "points": sum(b["points"] for b in batches), "sent": 0, "failed": 0, "errors": [],
              "dry_run": dry_run, "server": []}
    if not batches:
        return result
    device = f"watch-lab {socket.gethostname()}"
    if dry_run:
        out_dir = Path(getattr(cfg, "out_dir", None) or LAB_DIR / "out")
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"ingest-dryrun-{time.strftime('%Y%m%d-%H%M%S')}.json"
        path.write_text(json.dumps({"p_device": device, "batches": [
            {"samples": b["samples"], "sessions": b["sessions"]} for b in batches]}, indent=1), encoding="utf-8")
        result["file"] = str(path)
        return result
    if not (cfg.supabase_url and cfg.supabase_anon_key and cfg.health_token):
        raise RuntimeError("SUPABASE_URL, SUPABASE_ANON_KEY and HEALTH_TOKEN must be set in .env to upload")
    for b in batches:
        try:
            resp = _post(cfg, {"samples": b["samples"], "sessions": b["sessions"]}, device)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            err = f"HTTP {e.code}: {detail}"
        except (urllib.error.URLError, OSError, ValueError) as e:
            err = f"{type(e).__name__}: {e}"
        else:
            store.mark_done(b["keys"])
            result["sent"] += 1
            result["server"].append(resp)
            continue
        store.bump_attempts(b["keys"])
        result["failed"] += 1
        result["errors"].append(err)
        break
    return result
