#!/usr/bin/env python
"""Xiaomi Watch S5 PC lab. Run `python lab.py <command> --help`. Never prints the auth key."""
from __future__ import annotations

import argparse
import asyncio
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from watchlab import config as cfgmod  # noqa: E402


def need(module: str, who: str):
    """Import another agent's module lazily with a clear error."""
    import importlib
    try:
        return importlib.import_module(module)
    except Exception as e:
        raise SystemExit(f"error: {module} ({who}) is not usable yet: {type(e).__name__}: {e}")


def load_cfg(args):
    try:
        cfg = cfgmod.load()
    except ValueError as e:
        raise SystemExit(f"error: {e}")
    if getattr(args, "address", None):
        cfg.watch_address = cfgmod.normalize_address(args.address)
    return cfg


def make_client(args, cfg):
    from watchlab import transport
    from watchlab.client import WatchClient
    transport.RADIO_ON = bool(args.radio_on)
    return WatchClient(cfg, transport=args.transport, channel=args.channel, verbose=args.verbose)


class Session:
    """async context manager: connect, run, always close; prints where the packet log is."""

    def __init__(self, args, init: bool = True):
        self.args, self.init = args, init

    async def __aenter__(self):
        self.cfg = load_cfg(self.args)
        self.client = make_client(self.args, self.cfg)
        print(f"packet log: {self.client.slog.path}")
        try:
            await self.client.connect(init=self.init)
        except BaseException:
            await self.client.close()
            raise
        return self.client

    async def __aexit__(self, *exc):
        await self.client.close()


def run(coro):
    from watchlab.auth import AuthError
    from watchlab.client import WatchError
    from watchlab.transport import TransportError
    try:
        asyncio.run(coro)
        return 0
    except KeyboardInterrupt:
        print("\ninterrupted")
        return 130
    except (WatchError, AuthError, TransportError) as e:
        print(f"\nERROR: {e}")
        return 1


# ---- commands ---------------------------------------------------------------------------------

def cmd_scan(args):
    from watchlab import transport
    transport.RADIO_ON = bool(args.radio_on)
    return run(transport.scan(args.seconds, print, ble=args.ble))


def cmd_pair(args):
    from watchlab import transport
    cfg = load_cfg(args)
    if not cfg.watch_address:
        raise SystemExit("error: no WATCH_ADDRESS (run `python lab.py scan` first, or pass --address)")
    transport.RADIO_ON = bool(args.radio_on)

    async def go():
        ok = await transport.pair(cfg.watch_address, print)
        print("\nResult:", "paired" if ok else "NOT paired")
        if ok:
            print("Diagnostics after pairing:")
            await transport.diagnose(cfg.watch_address, print)
    return run(go())


def cmd_info(args):
    async def go():
        async with Session(args) as c:
            print("\n" + c.describe_info())
    return run(go())


def cmd_time(args):
    async def go():
        async with Session(args, init=False) as c:
            r = await c.set_time(is_24h=not args.h12)
            print("time set" + (f" (status {r.status})" if r is not None and r.HasField("status") else ""))
    return run(go())


def cmd_notify(args):
    async def go():
        async with Session(args, init=False) as c:
            await c.notify(args.title, args.body)
            print("notification sent; look at the watch")
    return run(go())


def cmd_call(args):
    async def go():
        async with Session(args, init=False) as c:
            await c.incoming_call(args.name, args.number)
            print(f"incoming-call alert sent; ending it in {args.seconds:.0f} s")
            await asyncio.sleep(args.seconds)
            await c.end_call()
            await asyncio.sleep(0.5)
    return run(go())


def cmd_findwatch(args):
    async def go():
        async with Session(args, init=False) as c:
            await c.find_watch(True)
            print(f"watch should be ringing/vibrating; stopping in {args.seconds:.0f} s")
            await asyncio.sleep(args.seconds)
            await c.find_watch(False)
    return run(go())


def cmd_settings(args):
    from watchlab.sessionlog import proto_text

    async def go():
        async with Session(args, init=False) as c:
            for label, r in await c.read_settings():
                print(f"\n== {label}")
                if r is None:
                    print("   (no answer)")
                    continue
                print("   " + (proto_text(r.health) or f"(empty, status={r.status})").replace("\n", "\n   "))
    return run(go())


def cmd_hr_interval(args):
    v = args.minutes.lower()
    if v in ("off", "disable", "disabled"):
        minutes, disabled = None, True
    else:
        try:
            minutes, disabled = int(v), None
        except ValueError:
            raise SystemExit("error: minutes must be a number (1, 10, 30; 0 = smart) or 'off'")

    async def go():
        async with Session(args, init=False) as c:
            await c.set_hr_interval(minutes, disabled)
    return run(go())


def cmd_weather(args):
    from watchlab import weather as W
    print(f"fetching Open-Meteo for {args.lat}, {args.lon} ...")
    report = W.fetch_open_meteo(args.lat, args.lon, args.name)
    print(report.summary())
    if args.dry_run:
        for cmd in W.build_all(report):
            print(f"{cmd.type}/{cmd.subtype}: {cmd.SerializeToString().hex()}")
        return 0

    async def go():
        async with Session(args, init=False) as c:
            await W.push_weather(c, report)
    return run(go())


def cmd_listen(args):
    from watchlab import commands as C
    from watchlab.sessionlog import proto_text

    beep = {"stop": threading.Event()}

    def beeper():
        try:
            import winsound
        except ImportError:
            return
        ev = beep["stop"]
        ev.clear()
        end = __import__("time").time() + 30
        while not ev.is_set() and __import__("time").time() < end:
            winsound.Beep(1200, 400)
            ev.wait(0.3)

    async def go():
        async with Session(args, init=False) as c:
            report = None
            if args.lat is not None and args.lon is not None:
                from watchlab import weather as W
                report = W.fetch_open_meteo(args.lat, args.lon, args.name)
                print(f"weather requests will be answered with: {report.summary()}")

            def on_cmd(cmd):
                ev = C.find_phone_event(cmd)
                if ev == "start":
                    print("*** FIND PHONE: watch is asking this PC to ring (beeping) ***")
                    threading.Thread(target=beeper, daemon=True).start()
                elif ev == "stop":
                    print("*** FIND PHONE: stopped on the watch ***")
                    beep["stop"].set()
                elif cmd.type == C.MUSIC:
                    print(f"music: {C.describe_music(cmd)}")
                elif cmd.type == C.NOTIF:
                    names = {C.NOTIF_DISMISS: "dismiss", C.NOTIF_CALL_REJECT: "reject call",
                             C.NOTIF_CALL_IGNORE: "ignore call", C.NOTIF_OPEN_ON_PHONE: "open on phone"}
                    print(f"notification action: {names.get(cmd.subtype, cmd.subtype)}\n   " +
                          proto_text(cmd.notification).replace("\n", "\n   "))
                elif cmd.type == C.WEATHER and cmd.subtype == C.WEATHER_REQUEST:
                    loc = cmd.weather.location
                    print(f"weather request from watch (location code={loc.code!r} name={loc.name!r})")
                    if report is not None:
                        from watchlab import weather as W
                        asyncio.get_running_loop().create_task(W.push_weather(c, report))
                    else:
                        print("   (pass --lat/--lon to answer these automatically)")
                else:
                    print(f"event {cmd.type}/{cmd.subtype}: " + proto_text(cmd).replace("\n", " "))

            c.on_any_command(on_cmd)
            print("listening; press Ctrl+C to stop. Trigger find-phone / music / a weather refresh on the watch.")
            await c.wait_disconnect()
            beep["stop"].set()
    return run(go())


def cmd_fetch(args):
    store_mod = need("watchlab.store", "py-activity")
    from watchlab.fetcher import fetch_activity

    async def go():
        store = store_mod.LabStore(str(cfgmod.OUT_DIR / "lab.db"))
        if args.ack:
            print("ACK is ON: the watch will delete files it has handed over.")
        else:
            print("ack is off: files stay on the watch, so Mi Fitness can still get them (use --ack to opt in).")
        async with Session(args, init=False) as c:
            summary = await fetch_activity(c, store, ack=args.ack, limit=args.limit)
        print(f"\nfetch summary: {summary}")
        for f in summary.failures:
            print("  problem:", f)
        print(f"pending uploads: {store.pending_count()}")
    return run(go())


def cmd_parse(args):
    store_mod = need("watchlab.store", "py-activity")
    act = need("watchlab.activity", "py-activity")
    from watchlab.fetcher import FetchSummary, process_file

    store = store_mod.LabStore(str(cfgmod.OUT_DIR / "lab.db"))
    files = store.raw_files()
    print(f"re-parsing {len(files)} stored raw file(s)")
    summary, sessions = FetchSummary(), {}
    for fid, data in sorted(files, key=lambda x: (x[0].timestamp, x[0].detail_type)):
        print(f"{fid.describe()} ({len(data)}B)")
        summary.fetched += 1
        process_file(fid, data, store, summary, print, sessions)
    print(f"\nparse summary: {summary.parsed} parsed, {summary.parse_failures} failed, "
          f"{summary.samples} samples, {summary.sessions} sessions; pending uploads: {store.pending_count()}")
    return 0


def cmd_upload(args):
    store_mod = need("watchlab.store", "py-activity")
    ingest = need("watchlab.ingest", "py-activity")
    cfg = load_cfg(args)
    store = store_mod.LabStore(str(cfgmod.OUT_DIR / "lab.db"))
    print(f"pending before: {store.pending_count()}")
    res = ingest.upload_pending(store, cfg, dry_run=True) if args.dry_run else ingest.upload_pending(store, cfg)
    print("result:", res)
    print(f"pending after: {store.pending_count()}")
    return 0


def cmd_dryrun(args):
    """Encode (do not send) the auth step-1 command, a notification, and the weather commands."""
    from watchlab import commands as C
    from watchlab import weather as W
    from watchlab.auth import AuthService
    from watchlab.spp import Channel, PacketV1, DATA_TYPE_PLAIN, OPCODE_READ, encode_frame_v2, PACKET_TYPE_DATA

    auth = AuthService(bytes(16), nonce=bytes(range(16)))
    step1 = auth.start_encrypted_handshake()
    b = step1.SerializeToString()
    print(f"auth step 1 (cmd 1/26) protobuf: {b.hex()}")
    v1 = PacketV1.build(Channel.Authentication, opcode=2, frame_serial=1, data_type=2, payload=b).encode(None, None)
    print(f"  as SPP V1 frame : {v1.hex()}")
    print(f"  as SPP V2 frame : {encode_frame_v2(PACKET_TYPE_DATA, 0, bytes([1, 1]) + b).hex()}")
    ver = PacketV1.build(Channel.Version, needs_response=True, opcode=OPCODE_READ, data_type=DATA_TYPE_PLAIN, frame_serial=0)
    print(f"version request frame: {ver.encode(None, None).hex()}")
    print(f"notification: {C.build_notification('Lab', 'Hello').SerializeToString().hex()}")
    sample = W.parse_open_meteo(_SAMPLE_METEO, "Test", now=_SAMPLE_METEO["current"]["time"])
    print(sample.summary())
    for cmd in W.build_all(sample):
        hx = cmd.SerializeToString().hex()
        print(f"weather {cmd.type}/{cmd.subtype}: {len(hx) // 2} bytes  {hx[:72]}...")
    return 0


_SAMPLE_METEO = {
    "current": {"time": 1767600000, "temperature_2m": 12.4, "relative_humidity_2m": 71, "weather_code": 61,
                "wind_speed_10m": 14.0, "wind_direction_10m": 230, "surface_pressure": 1008.0, "uv_index": 0.5},
    "hourly": {"time": [1767600000 + 3600 * i for i in range(30)], "temperature_2m": [12.0 - i * 0.1 for i in range(30)],
               "weather_code": [61] * 30, "wind_speed_10m": [14.0] * 30, "wind_direction_10m": [230] * 30},
    "daily": {"time": [1767571200 + 86400 * i for i in range(8)], "weather_code": [61, 3, 0, 0, 80, 95, 71, 45],
              "temperature_2m_max": [13, 12, 14, 15, 11, 10, 2, 3], "temperature_2m_min": [8, 7, 6, 7, 5, 4, -2, -1],
              "sunrise": [1767597000 + 86400 * i for i in range(8)], "sunset": [1767626000 + 86400 * i for i in range(8)]},
}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="lab.py", description="Xiaomi Watch S5 PC lab (Bluetooth Classic SPP).")
    p.add_argument("-v", "--verbose", action="store_true", help="print every packet (hex + decoded) as it happens")
    p.add_argument("--address", help="watch Bluetooth address (default: WATCH_ADDRESS from .env)")
    p.add_argument("--transport", choices=["auto", "winrt", "socket"], default="auto",
                   help="RFCOMM transport (default auto: winrt, then Winsock socket)")
    p.add_argument("--channel", type=int, help="force the RFCOMM channel for --transport socket")
    p.add_argument("--radio-on", action="store_true", help="switch the PC's Bluetooth radio on if it is off")
    sub = p.add_subparsers(dest="command", required=True, metavar="command")

    def add(name, fn, help_, **kw):
        sp = sub.add_parser(name, help=help_, description=help_, **kw)
        sp.set_defaults(func=fn)
        return sp

    s = add("scan", cmd_scan, "list adapter state, paired and nearby Bluetooth devices; find the watch (read-only)")
    s.add_argument("--seconds", type=float, default=12, help="discovery time for unpaired devices")
    s.add_argument("--ble", action="store_true", help="also list BLE advertisements")
    add("pair", cmd_pair, "pair this PC with the watch (prints what to confirm on the watch)")
    add("info", cmd_info, "connect, authenticate, print model/firmware/serial/battery")
    t = add("time", cmd_time, "set the watch clock from this PC")
    t.add_argument("--h12", action="store_true", help="tell the watch to show 12-hour time")
    n = add("notify", cmd_notify, "send a test notification")
    n.add_argument("title")
    n.add_argument("body")
    c = add("call", cmd_call, "show an incoming-call alert on the watch")
    c.add_argument("name")
    c.add_argument("--number", help="number shown under the name")
    c.add_argument("--seconds", type=float, default=8, help="how long to keep the alert up")
    f = add("findwatch", cmd_findwatch, "make the watch ring/vibrate")
    f.add_argument("--seconds", type=float, default=5)
    add("settings", cmd_settings, "read HR, SpO2, stress, standing, goals settings")
    h = add("hr-interval", cmd_hr_interval, "set continuous heart-rate interval (1 = every minute, 0 = smart, off)")
    h.add_argument("minutes", help="1, 10, 30, 0 (smart) or off")
    w = add("weather", cmd_weather, "fetch Open-Meteo and push current/hourly/daily weather")
    w.add_argument("--lat", type=float, required=True)
    w.add_argument("--lon", type=float, required=True)
    w.add_argument("--name", help="location label shown on the watch")
    w.add_argument("--dry-run", action="store_true", help="only print the encoded commands")
    l = add("listen", cmd_listen, "print every event from the watch until Ctrl+C (find phone, music, weather requests...)")
    l.add_argument("--lat", type=float)
    l.add_argument("--lon", type=float)
    l.add_argument("--name")
    fe = add("fetch", cmd_fetch, "fetch activity files, store raw, parse and store (ack is OFF unless --ack)")
    fe.add_argument("--ack", action="store_true", help="ack files so the watch deletes them (Mi Fitness will not get them)")
    fe.add_argument("--limit", type=int, help="only fetch the first N files (oldest first)")
    add("parse", cmd_parse, "re-parse the stored raw files")
    u = add("upload", cmd_upload, "upload pending data to Supabase (health_ingest)")
    u.add_argument("--dry-run", action="store_true")
    add("dryrun", cmd_dryrun, "encode auth step 1, a notification and weather to hex without any Bluetooth")
    try:
        scale = need("watchlab.scale", "scale agent")
        scale.add_cli(sub)
    except SystemExit as e:  # keep the other commands working
        sp = sub.add_parser("scale", help=f"unavailable: {e}")
        sp.set_defaults(func=lambda a, _e=e: print(_e) or 1)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    rc = args.func(args)
    return rc if isinstance(rc, int) else 0


if __name__ == "__main__":
    sys.exit(main())
