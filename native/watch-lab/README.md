# watch-lab

A Python lab that talks to the Xiaomi Watch S5 straight from this Windows PC over Bluetooth Classic (SPP/RFCOMM), using a port of Gadgetbridge's Xiaomi protocol. It proves the watch side (auth, time, notifications, weather, find-phone, activity files) before the same code goes into the Android app.

**Never unpair the watch in Mi Fitness and never factory-reset it. Either one destroys the auth key.**

> **Status 2026-11-06:** the real watch refuses the PC (`WinError 10051` on connect, no SDP services) unless it is paired with Windows. The user chose not to risk the phone's bond for that, so the phone app (`native/health-bridge`) is the live path. Use this lab for parser, upload and scale work (`tests/`, `parse`, `upload`, `scale`); the watch commands below stay as reference.

Setup: `.venv` exists. Fill `.env` (see `.env.example`): `WATCH_ADDRESS` (from `scan`) and `WATCH_AUTH_KEY` (32 hex chars). Packet logs go to `out/session-<time>.log` (hex + decoded protobuf, never the key); data to `out/lab.db`.

## Session checklist

Before: turn the **phone's Bluetooth off** (or force-stop Mi Fitness) so the watch is free, keep the watch next to the PC, wake its screen, and make sure the PC's Bluetooth is on (or add `--radio-on`).

Run in order (`python lab.py` = `.venv/Scripts/python lab.py`):

| # | Command | Should print |
|---|---|---|
| 1 | `scan` | adapter + radio state, paired devices, nearby devices; a `>>` line for `Xiaomi Watch S5 ...` with its address (put it in `.env`) and a diagnostics block (see Troubleshooting) |
| 2 | `pair` (only if scan says NOT paired) | the pairing ceremony kind and exactly what to confirm on the watch (a code to match, or an accept tap); then `Result: paired` |
| 3 | `info` | `link up via winrt`, `auth step 2 ok`, `authenticated (SPP V2, encrypted)`, then model / firmware / serial / battery |
| 4 | `time` | `time set` |
| 5 | `settings` | the watch's HR, SpO2, stress, standing, goals config |
| 6 | `hr-interval 1` | interval before and after (after should be 1 min) |
| 7 | `fetch` | files listed, each stored raw then parsed, a summary. **Ack is off**, so files stay on the watch and Mi Fitness can still get them. `--ack` makes the watch delete them. |
| 8 | `upload` | pending count before and after (add `--dry-run` first) |
| 9 | `notify "Test" "Hello from the PC"` | the watch buzzes and shows it |
| 10 | `listen` (add `--lat/--lon` to answer weather requests), then trigger **Find my phone** on the watch | `*** FIND PHONE ***` and the PC beeps; open the weather app on the watch to see a weather request |
| 11 | `weather --lat 52.5 --lon 13.4 --name Home` | current/daily/hourly each `sent` or `ack`; the watch weather app shows the forecast |

Also: `call NAME` (incoming-call alert), `findwatch`, `parse` (re-parse stored raw files after a parser fix), `scale` (separate agent), `dryrun` (encode auth step 1 and weather to hex without Bluetooth). Global flags: `-v` prints every packet, `--transport winrt|socket|auto`, `--channel N` (socket transport), `--address`.

## Transport

Windows RFCOMM via WinRT `RfcommDeviceService` + `StreamSocket` first (Windows does the SDP lookup and applies the pairing state; real async I/O), then a Winsock `AF_BLUETOOTH` socket to the channel read from the SDP record as a second data point. Details are in the `watchlab/transport.py` docstring.

## Troubleshooting

- **`Radio: Bluetooth ... state=OFF`**: the PC's Bluetooth is off. Turn it on or pass `--radio-on`.
- **Watch not listed by `scan`**: it is connected to the phone (Classic devices answer inquiries only when idle). Phone Bluetooth off, watch screen on, rerun.
- **`pair` says cannot pair / REMOTE_DEVICE_HAS_ASSOCIATION / CONNECTION_REJECTED**: the watch refuses a second bond while bonded to the phone. This is the key unknown of the lab; the log shows the exact status. Do not unpair from Mi Fitness. Next step: a different approach (HCI snoop log from the phone) is needed.
- **`SPP service not found`**: the PC is not paired, or the watch did not answer SDP. The diagnostics list every service Windows could read.
- **`StreamSocket connect failed`** with `0x8007274D`: refused (another host connected). `0x8007274C`: timed out (out of range or asleep). `0x80070005`: access denied.
- **`the watch's hmac does not match`**: wrong `WATCH_AUTH_KEY`.
- **Link up but no authentication**: the watch is silent; check the log's last lines (`TX FRAME` with no `RX`) and that the phone is not connected.
- **Parse failures in `fetch`**: the raw file is already stored; fix the parser, then run `parse`.

Tests: `.venv/Scripts/python -m unittest discover -s tests`. Regenerate protos: `bash scripts/gen_proto.sh`.
