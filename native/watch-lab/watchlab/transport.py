"""Bluetooth Classic RFCOMM (SPP) transport for Windows, plus discovery, pairing and diagnostics.

Why two transports
  * `winrt` (default): WinRT `RfcommDeviceService` + `StreamSocket`. Windows does the SDP lookup,
    resolves the RFCOMM channel, applies the pairing/link-security state of the device, and the
    socket is truly asynchronous. This is the path Windows itself supports for desktop apps, so it
    is the most robust choice for talking to a device Windows has bonded.
  * `socket`: stdlib `socket.AF_BLUETOOTH`/`BTPROTO_RFCOMM` (Winsock Bluetooth), connecting to the
    channel number pulled out of the SDP raw attributes (ProtocolDescriptorList, attribute 0x0004)
    - or one given with `--channel`. It needs threads for blocking I/O, but works when the WinRT
    service lookup fails yet the channel is known, and it gives a second, independent data point.
  * `auto` (what the CLI uses): try winrt, and if it fails try socket, reporting both outcomes.

What the lab cannot know in advance: whether the watch accepts a Classic pairing or connection from
the PC while it is bonded to the phone. Every step here therefore reports what Windows said (pairing
state, protection level, connection status, HRESULTs, service-lookup results), so a single session
shows where it stops.
"""
from __future__ import annotations

import asyncio
import re
import socket
import struct
import sys
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from .config import address_to_int, normalize_address

WATCH_NAME_RE = re.compile(r"xiaomi\s*watch\s*s5", re.I)
SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb"

HRESULT_HINTS = {
    0x80070490: "ELEMENT_NOT_FOUND (device/service not known to Windows)",
    0x80070005: "ACCESS_DENIED",
    0x8000000E: "E_ILLEGAL_METHOD_CALL",
    0x8007274C: "WSAETIMEDOUT (watch did not answer the connection)",
    0x8007274D: "WSAECONNREFUSED (watch refused: another host connected, or SPP not accepting this PC)",
    0x80072740: "WSAEADDRINUSE",
    0x80072745: "WSAECONNABORTED",
    0x80072746: "WSAECONNRESET",
    0x80072751: "WSAEHOSTUNREACH (watch not in range or not connectable)",
    0x80072742: "WSAENETUNREACH",
    0x80070057: "E_INVALIDARG",
    0x8007001F: "ERROR_GEN_FAILURE",
    0x800710DF: "ERROR_DEVICE_NOT_CONNECTED",
    0x80070015: "ERROR_NOT_READY",
    0x80004005: "E_FAIL",
    0x8000FFFF: "E_UNEXPECTED",
}


def fmt_exc(e: BaseException) -> str:
    code = getattr(e, "winerror", None)
    if code is None and e.args and isinstance(e.args[0], int):
        code = e.args[0]
    if isinstance(code, int):
        u = code & 0xFFFFFFFF
        hint = HRESULT_HINTS.get(u)
        return f"{type(e).__name__} HRESULT=0x{u:08X}{' ' + hint if hint else ''}: {e}"
    return f"{type(e).__name__}: {e}"


class TransportError(Exception):
    pass


Say = Callable[[str], None]
RADIO_ON = False  # set by the CLI's --radio-on


def _winrt():
    try:
        from winrt.windows.devices import bluetooth as bt
        from winrt.windows.devices.bluetooth import rfcomm
        from winrt.windows.devices import enumeration as enum_
        from winrt.windows.networking import sockets, HostName
        from winrt.windows.storage import streams
        return bt, rfcomm, enum_, sockets, streams, HostName
    except ImportError as e:  # pragma: no cover
        raise TransportError(f"WinRT bindings missing ({e}); run: .venv/Scripts/pip install -r requirements.txt") from e


# ----------------------------------------------------------------------------------------------
# SDP parsing (pure, unit-tested)
# ----------------------------------------------------------------------------------------------

def parse_sdp_element(data: bytes, pos: int = 0):
    """Decode one SDP data element. Returns (value, next_pos). Sequences become lists, UUIDs ('uuid', int)."""
    head = data[pos]
    etype, sdesc = head >> 3, head & 7
    pos += 1
    if etype == 0:  # nil
        return None, pos
    if sdesc <= 4:
        size = 1 << sdesc
    elif sdesc == 5:
        size = data[pos]
        pos += 1
    elif sdesc == 6:
        size = struct.unpack_from(">H", data, pos)[0]
        pos += 2
    else:
        size = struct.unpack_from(">I", data, pos)[0]
        pos += 4
    body = data[pos:pos + size]
    end = pos + size
    if etype in (1, 2):
        return int.from_bytes(body, "big", signed=(etype == 2)), end
    if etype == 3:
        return ("uuid", int.from_bytes(body, "big")), end
    if etype in (4, 8):
        return body.decode("utf-8", "replace"), end
    if etype == 5:
        return bool(body[0]), end
    if etype in (6, 7):
        items = []
        p = pos
        while p < end:
            v, p = parse_sdp_element(data, p)
            items.append(v)
        return items, end
    return body, end


def rfcomm_channel_from_protocol_descriptor_list(data: bytes) -> Optional[int]:
    """Attribute 0x0004 -> RFCOMM channel (the UINT following the RFCOMM UUID 0x0003)."""
    try:
        value, _ = parse_sdp_element(data)
    except Exception:
        return None
    for proto in value if isinstance(value, list) else []:
        if isinstance(proto, list) and proto and proto[0] == ("uuid", 0x0003) and len(proto) > 1:
            return int(proto[1])
    return None


def _buffer_bytes(ibuffer, streams) -> bytes:
    reader = streams.DataReader.from_buffer(ibuffer)
    out = bytearray(ibuffer.length)
    reader.read_bytes(out)
    return bytes(out)


# ----------------------------------------------------------------------------------------------
# Discovery
# ----------------------------------------------------------------------------------------------

@dataclass
class FoundDevice:
    name: str
    address: Optional[str]
    device_id: str
    paired: bool
    connected: Optional[bool] = None
    can_pair: Optional[bool] = None
    rssi: Optional[int] = None

    @property
    def is_watch(self) -> bool:
        return bool(WATCH_NAME_RE.search(self.name or ""))


def _unbox(v):
    """WinRT property-bag values arrive as opaque objects; unwrap string/bool/int ones."""
    if v is None:
        return None
    try:
        from winrt.windows.foundation import IPropertyValue
        pv = v.as_(IPropertyValue)
        t = int(pv.type)
        if t == 12:
            return pv.get_string()
        if t == 11:
            return pv.get_boolean()
        if t in (2, 3, 4, 5):
            return pv.get_int32()
    except Exception:
        pass
    return None


def _address_from_props(props, device_id: str) -> Optional[str]:
    raw = None
    try:
        raw = _unbox(props.get("System.Devices.Aep.DeviceAddress"))
    except Exception:
        pass
    if not raw:
        m = re.search(r"-([0-9a-fA-F:]{12,17})$", device_id)
        raw = m.group(1) if m else None
    if not raw:
        return None
    return normalize_address(str(raw).replace(":", ""))


def _to_found(info, paired: bool) -> FoundDevice:
    props = info.properties

    def prop(k):
        try:
            return _unbox(props.get(k))
        except Exception:
            return None
    pairing = info.pairing
    return FoundDevice(
        name=info.name or "",
        address=_address_from_props(props, info.id),
        device_id=info.id,
        paired=bool(pairing.is_paired) if pairing else paired,
        connected=prop("System.Devices.Aep.IsConnected"),
        can_pair=bool(pairing.can_pair) if pairing else None,
        rssi=prop("System.Devices.Aep.SignalStrength"),
    )


ADDITIONAL_PROPS = ["System.Devices.Aep.DeviceAddress", "System.Devices.Aep.IsConnected",
                    "System.Devices.Aep.IsPaired", "System.Devices.Aep.SignalStrength"]


async def adapter_report(say: Say) -> None:
    bt, *_ = _winrt()
    try:
        ad = await bt.BluetoothAdapter.get_default_async()
        if ad is None:
            say("Bluetooth adapter: NONE found (is the radio present and enabled?)")
        else:
            a = f"{ad.bluetooth_address:012X}"
            say(f"Bluetooth adapter: {':'.join(a[i:i+2] for i in range(0, 12, 2))}  classic={ad.is_classic_supported}  "
                f"le={ad.is_low_energy_supported}  secure-connections={ad.are_classic_secure_connections_supported}")
    except Exception as e:
        say(f"Bluetooth adapter query failed: {fmt_exc(e)}")
    try:
        from winrt.windows.devices import radios
        for r in await radios.Radio.get_radios_async():
            say(f"Radio: {r.name}  kind={r.kind.name}  state={r.state.name}")
            if r.kind == radios.RadioKind.BLUETOOTH and r.state != radios.RadioState.ON:
                say("  !! The PC's Bluetooth radio is not ON. Turn it on in Windows settings, or pass --radio-on.")
    except Exception as e:
        say(f"Radio query failed: {fmt_exc(e)}")


async def ensure_radio_on(say: Say, turn_on: bool = False) -> bool:
    """True if the PC's Bluetooth radio is on. With turn_on, switch it on (Windows may prompt for access)."""
    try:
        from winrt.windows.devices import radios
        access = await radios.Radio.request_access_async()
        if access != radios.RadioAccessStatus.ALLOWED:
            say(f"Radio access: {access.name} (cannot switch the radio from here)")
        for r in await radios.Radio.get_radios_async():
            if r.kind != radios.RadioKind.BLUETOOTH:
                continue
            if r.state == radios.RadioState.ON:
                return True
            if not turn_on:
                say("The PC's Bluetooth radio is OFF. Turn it on in Windows settings, or rerun with --radio-on.")
                return False
            say("Bluetooth radio is off; switching it on...")
            st = await r.set_state_async(radios.RadioState.ON)
            say(f"  result: {st.name}")
            await asyncio.sleep(2)
            return st == radios.RadioAccessStatus.ALLOWED
        say("No Bluetooth radio found on this PC.")
        return False
    except Exception as e:
        say(f"Radio check failed: {fmt_exc(e)}")
        return True  # do not block on a failed check


async def list_paired(say: Say) -> list[FoundDevice]:
    bt, _, enum_, *_ = _winrt()
    sel = bt.BluetoothDevice.get_device_selector_from_pairing_state(True)
    infos = await enum_.DeviceInformation.find_all_async(sel, ADDITIONAL_PROPS)
    return [_to_found(i, True) for i in infos]


async def discover_unpaired(seconds: float, say: Say) -> list[FoundDevice]:
    bt, _, enum_, *_ = _winrt()
    sel = bt.BluetoothDevice.get_device_selector_from_pairing_state(False)
    watcher = enum_.DeviceInformation.create_watcher(sel, ADDITIONAL_PROPS, enum_.DeviceInformationKind.ASSOCIATION_ENDPOINT)
    loop = asyncio.get_running_loop()
    found: dict[str, FoundDevice] = {}

    def added(sender, info):
        try:
            d = _to_found(info, False)
        except Exception:
            return
        loop.call_soon_threadsafe(found.__setitem__, d.device_id, d)

    def updated(sender, upd):
        pass

    t_add = watcher.add_added(added)
    t_upd = watcher.add_updated(updated)
    watcher.start()
    try:
        await asyncio.sleep(seconds)
    finally:
        try:
            watcher.stop()
            watcher.remove_added(t_add)
            watcher.remove_updated(t_upd)
        except Exception:
            pass
    return list(found.values())


def _fmt_dev(d: FoundDevice) -> str:
    bits = []
    if d.paired:
        bits.append("paired")
    if d.connected is not None:
        bits.append("connected" if d.connected else "not connected")
    if d.can_pair is not None and not d.paired:
        bits.append("can pair" if d.can_pair else "cannot pair")
    if d.rssi is not None:
        bits.append(f"rssi {d.rssi}")
    return f"{d.address or '??:??:??:??:??:??'}  {d.name or '(no name)'}  [{', '.join(bits)}]"


async def scan(seconds: float, say: Say, *, ble: bool = False) -> dict:
    """Print adapter state, paired devices, then discover unpaired ones. Returns {'watches': [...], ...}."""
    result: dict = {"watches": [], "paired": [], "unpaired": []}
    if RADIO_ON:
        await ensure_radio_on(say, True)
    await adapter_report(say)

    say("\nPaired Bluetooth Classic devices:")
    try:
        paired = await list_paired(say)
    except Exception as e:
        say(f"  paired-device enumeration failed: {fmt_exc(e)}")
        paired = []
    for d in paired:
        say(f"  {'>>' if d.is_watch else '  '} {_fmt_dev(d)}")
    if not paired:
        say("  (none)")
    result["paired"] = paired

    say(f"\nDiscovering unpaired devices for {seconds:.0f} s (put the watch near the PC; "
        f"if it is connected to the phone it may not answer inquiries)...")
    try:
        unpaired = await discover_unpaired(seconds, say)
    except Exception as e:
        say(f"  discovery failed: {fmt_exc(e)}")
        unpaired = []
    named = [d for d in unpaired if d.name]
    for d in sorted(named, key=lambda x: (not x.is_watch, x.name)):
        say(f"  {'>>' if d.is_watch else '  '} {_fmt_dev(d)}")
    if len(unpaired) > len(named):
        say(f"  ({len(unpaired) - len(named)} more nearby devices without a name)")
    if not unpaired:
        say("  (none)")
    result["unpaired"] = unpaired

    watches = [d for d in paired + unpaired if d.is_watch]
    result["watches"] = watches
    say("")
    if watches:
        for w in watches:
            say(f"Found '{w.name}' at {w.address}  ({'paired' if w.paired else 'NOT paired'}, "
                f"{'connected to something' if w.connected else 'not connected'}).")
            say(f"  -> put  WATCH_ADDRESS={w.address}  in .env" + ("" if w.paired else ", then run: python lab.py pair"))
    else:
        say("No 'Xiaomi Watch S5' found. If the watch is on the phone, switch the phone's Bluetooth off (or force-stop "
            "Mi Fitness) and run scan again; Classic watches often answer inquiries only while idle.")

    if ble:
        await _ble_scan(min(seconds, 8), say)

    for w in watches:
        if w.address and w.paired:
            say(f"\nDiagnostics for {w.address}:")
            await diagnose(w.address, say)
            break
    return result


async def _ble_scan(seconds: float, say: Say) -> None:
    try:
        from bleak import BleakScanner
    except ImportError:
        say("bleak not installed, skipping BLE scan")
        return
    say(f"\nBLE advertisements for {seconds:.0f} s (informational: the S5 data link is Classic, not BLE):")
    try:
        devs = await BleakScanner.discover(timeout=seconds, return_adv=True)
        for addr, (dev, adv) in sorted(devs.items(), key=lambda kv: -(kv[1][1].rssi or -999)):
            name = dev.name or adv.local_name or ""
            if name or adv.manufacturer_data:
                say(f"  {addr}  {name or '(no name)'}  rssi {adv.rssi}  mfr {list(adv.manufacturer_data)}")
    except Exception as e:
        say(f"  BLE scan failed: {fmt_exc(e)}")


# ----------------------------------------------------------------------------------------------
# Device resolution, pairing and diagnostics
# ----------------------------------------------------------------------------------------------

async def get_device(address: str):
    bt, *_ = _winrt()
    dev = await bt.BluetoothDevice.from_bluetooth_address_async(address_to_int(address))
    return dev


async def diagnose(address: str, say: Say) -> dict:
    """Everything Windows will tell us about the device and its SPP service. Never raises."""
    bt, rfcomm, enum_, sockets, streams, HostName = _winrt()
    info: dict = {"address": address, "channel": None, "services": [], "paired": None}
    try:
        dev = await get_device(address)
    except Exception as e:
        say(f"  BluetoothDevice.FromBluetoothAddressAsync failed: {fmt_exc(e)}")
        return info
    if dev is None:
        say("  Windows has no device object for this address (not paired / never seen). Run: python lab.py pair")
        return info
    di = dev.device_information
    pairing = di.pairing
    info["paired"] = bool(pairing.is_paired)
    say(f"  name={dev.name!r}  device_id={dev.device_id}")
    say(f"  connection_status={dev.connection_status.name}  class-of-device=0x{dev.class_of_device.raw_value:06X} "
        f"({dev.class_of_device.major_class.name})")
    say(f"  is_paired={pairing.is_paired}  can_pair={pairing.can_pair}  protection_level={pairing.protection_level.name}")
    try:
        say(f"  device_access={dev.device_access_information.current_status.name}")
    except Exception:
        pass
    # All services, then the SPP one, both uncached
    for label, coro in (
        ("all RFCOMM services", lambda: dev.get_rfcomm_services_async(bt.BluetoothCacheMode.UNCACHED)),
        ("SPP service", lambda: dev.get_rfcomm_services_for_id_async(rfcomm.RfcommServiceId.serial_port,
                                                                    bt.BluetoothCacheMode.UNCACHED)),
    ):
        try:
            res = await asyncio.wait_for(coro(), 30)
        except Exception as e:
            say(f"  {label}: lookup raised {fmt_exc(e)}")
            continue
        say(f"  {label}: error={res.error.name}  count={len(res.services)}")
        for svc in res.services:
            ch = await _service_channel(svc, streams)
            sid = svc.service_id.as_string() if hasattr(svc.service_id, "as_string") else svc.service_id.uuid
            say(f"    - uuid={sid}  service_name={svc.connection_service_name}  host={svc.connection_host_name.raw_name}  "
                f"protection={svc.protection_level.name} (max {svc.max_protection_level.name})  rfcomm_channel={ch}")
            info["services"].append((str(sid), ch))
            if label == "SPP service" and ch is not None:
                info["channel"] = ch
    return info


async def _service_channel(svc, streams) -> Optional[int]:
    try:
        attrs = await svc.get_sdp_raw_attributes_async(_winrt()[0].BluetoothCacheMode.UNCACHED)
        buf = attrs.lookup(0x0004)
        if buf is None:
            return None
        return rfcomm_channel_from_protocol_descriptor_list(_buffer_bytes(buf, streams))
    except Exception:
        return None


async def pair(address: str, say: Say) -> bool:
    """Pair with the PC as the initiator, handling every ceremony kind and printing what to confirm on the watch."""
    bt, rfcomm, enum_, sockets, streams, HostName = _winrt()
    if not await ensure_radio_on(say, RADIO_ON):
        return False
    dev = await get_device(address)
    if dev is None:
        say(f"Windows cannot create a device for {address}. Run `scan` first so Windows has seen the watch.")
        return False
    di = dev.device_information
    p = di.pairing
    say(f"{dev.name!r}: is_paired={p.is_paired} can_pair={p.can_pair} protection={p.protection_level.name}")
    if p.is_paired:
        say("Already paired with this PC. Nothing to do.")
        return True
    if not p.can_pair:
        say("Windows says this device cannot be paired right now. The watch is probably bonded to the phone and not "
            "pairable: turn the phone's Bluetooth off, wake the watch, and retry. (Do NOT unpair it from Mi Fitness.)")
        return False

    kinds = (enum_.DevicePairingKinds.CONFIRM_ONLY | enum_.DevicePairingKinds.DISPLAY_PIN
             | enum_.DevicePairingKinds.CONFIRM_PIN_MATCH)
    K = enum_.DevicePairingKinds

    def on_requested(sender, args):
        kind = args.pairing_kind
        try:
            pin = args.pin
        except Exception:
            pin = ""
        say(f"  pairing request from Windows: kind={kind.name if hasattr(kind, 'name') else kind} pin={pin!r}")
        if kind == K.CONFIRM_ONLY:
            say("  -> tap OK/accept on the watch if it asks to pair.")
            args.accept()
        elif kind == K.CONFIRM_PIN_MATCH:
            say(f"  -> the watch should show the code {pin}. Confirm that it matches and tap OK on the watch.")
            args.accept()
        elif kind == K.DISPLAY_PIN:
            say(f"  -> enter or confirm the code {pin} on the watch.")
            args.accept()
        else:
            say(f"  -> unsupported pairing kind {kind}; rejecting.")

    custom = di.pairing.custom
    token = custom.add_pairing_requested(on_requested)
    say("Pairing... (watch the watch screen; this can take ~30 s)")
    try:
        res = await asyncio.wait_for(
            custom.pair_async(kinds, enum_.DevicePairingProtectionLevel.ENCRYPTION_AND_AUTHENTICATION), 90)
    except Exception as e:
        say(f"Pairing raised: {fmt_exc(e)}")
        return False
    finally:
        try:
            custom.remove_pairing_requested(token)
        except Exception:
            pass
    ok = res.status in (enum_.DevicePairingResultStatus.PAIRED, enum_.DevicePairingResultStatus.ALREADY_PAIRED)
    say(f"Pairing result: {res.status.name}  protection_level_used={res.protection_level_used.name}")
    if not ok:
        hints = {
            "REJECTED_BY_HANDLER": "our handler rejected an unsupported ceremony",
            "REMOTE_DEVICE_HAS_ASSOCIATION": "the watch is bonded elsewhere and refuses a second bond",
            "AUTHENTICATION_FAILURE": "wrong or unconfirmed code / watch declined",
            "AUTHENTICATION_TIMEOUT": "nobody confirmed on the watch in time",
            "PAIRING_CANCELED": "cancelled",
            "CONNECTION_REJECTED": "the watch rejected the connection (it may only accept its bonded phone)",
            "TOO_MANY_CONNECTIONS": "the watch is at its connection limit",
            "PROTECTION_LEVEL_COULD_NOT_BE_MET": "the watch cannot do the requested protection level",
            "FAILED": "unspecified failure",
        }
        if res.status.name in hints:
            say(f"  hint: {hints[res.status.name]}")
    return ok


# ----------------------------------------------------------------------------------------------
# Transports
# ----------------------------------------------------------------------------------------------

DataCb = Callable[[bytes], None]
CloseCb = Callable[[str], None]


class BaseTransport:
    name = "base"

    def __init__(self, address: str, on_data: DataCb, on_close: CloseCb, say: Say = print) -> None:
        self.address = address
        self.on_data = on_data
        self.on_close = on_close
        self.say = say
        self._queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._closed = False

    async def open(self) -> None:
        raise NotImplementedError

    def write(self, data: bytes) -> None:
        """Ordered, non-blocking write; failures surface through on_close."""
        if not self._closed:
            self._queue.put_nowait(bytes(data))

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._queue.put_nowait(None)
        for t in self._tasks:
            t.cancel()
        await self._close_io()

    async def _close_io(self) -> None:
        pass

    def _closed_by_peer(self, reason: str) -> None:
        if not self._closed:
            self._closed = True
            self.on_close(reason)

    def _start_loops(self) -> None:
        self._tasks = [asyncio.create_task(self._read_loop()), asyncio.create_task(self._write_loop())]

    async def _read_loop(self) -> None:
        raise NotImplementedError

    async def _write_loop(self) -> None:
        raise NotImplementedError


class WinRtTransport(BaseTransport):
    name = "winrt"

    def __init__(self, *a, **kw) -> None:
        super().__init__(*a, **kw)
        self._socket = None
        self._reader = None
        self._writer = None
        self.protection_used: Optional[str] = None
        self.attempts: list[str] = []

    async def open(self) -> None:
        bt, rfcomm, enum_, sockets, streams, HostName = _winrt()
        say = self.say
        dev = await get_device(self.address)
        if dev is None:
            raise TransportError("Windows has no device for this address (run scan / pair first)")
        di = dev.device_information
        say(f"device {dev.name!r}: paired={di.pairing.is_paired} connection_status={dev.connection_status.name} "
            f"protection={di.pairing.protection_level.name}")
        try:
            res = await asyncio.wait_for(dev.get_rfcomm_services_for_id_async(
                rfcomm.RfcommServiceId.serial_port, bt.BluetoothCacheMode.UNCACHED), 30)
        except Exception as e:
            raise TransportError(f"SPP service lookup raised {fmt_exc(e)}") from e
        say(f"SPP service lookup (uncached): error={res.error.name} services={len(res.services)}")
        if res.error.name != "SUCCESS" or len(res.services) == 0:
            raise TransportError(
                f"SPP service not found (error={res.error.name}, count={len(res.services)}). "
                f"{'The device is not paired with this PC - run pair first.' if not di.pairing.is_paired else 'The watch did not answer SDP (phone connected? out of range?).'}")
        svc = res.services[0]
        try:
            access = await svc.request_access_async()
            say(f"service access: {access.name}")
        except Exception as e:
            say(f"service access check skipped: {fmt_exc(e)}")
        say(f"service: host={svc.connection_host_name.raw_name} name={svc.connection_service_name} "
            f"protection={svc.protection_level.name} max={svc.max_protection_level.name}")

        levels = [sockets.SocketProtectionLevel.BLUETOOTH_ENCRYPTION_ALLOW_NULL_AUTHENTICATION,
                  sockets.SocketProtectionLevel.BLUETOOTH_ENCRYPTION_WITH_AUTHENTICATION,
                  sockets.SocketProtectionLevel.PLAIN_SOCKET]
        last: Optional[Exception] = None
        for level in levels:
            sock = sockets.StreamSocket()
            try:
                say(f"connecting StreamSocket (protection {level.name})...")
                await asyncio.wait_for(sock.connect_async(svc.connection_host_name, svc.connection_service_name, level), 30)
                self._socket = sock
                self.protection_used = level.name
                self.attempts.append(f"{level.name}: connected")
                say(f"connected (protection {level.name}); socket protection now {sock.information.protection_level.name}")
                break
            except Exception as e:
                last = e
                self.attempts.append(f"{level.name}: {fmt_exc(e)}")
                say(f"  failed: {fmt_exc(e)}")
                try:
                    sock.close()
                except Exception:
                    pass
        if self._socket is None:
            raise TransportError("StreamSocket connect failed for every protection level:\n    " +
                                 "\n    ".join(self.attempts)) from last
        self._reader = streams.DataReader(self._socket.input_stream)
        self._reader.input_stream_options = streams.InputStreamOptions.PARTIAL
        self._writer = streams.DataWriter(self._socket.output_stream)
        self._start_loops()

    async def _read_loop(self) -> None:
        try:
            while True:
                n = await self._reader.load_async(1024)
                if n == 0:
                    self._closed_by_peer("watch closed the RFCOMM connection")
                    return
                buf = bytearray(n)
                self._reader.read_bytes(buf)
                self.on_data(bytes(buf))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._closed_by_peer(f"read failed: {fmt_exc(e)}")

    async def _write_loop(self) -> None:
        try:
            while True:
                data = await self._queue.get()
                if data is None:
                    return
                self._writer.write_bytes(data)
                await self._writer.store_async()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._closed_by_peer(f"write failed: {fmt_exc(e)}")

    async def _close_io(self) -> None:
        try:
            if self._socket is not None:
                self._socket.close()
        except Exception:
            pass


class SocketTransport(BaseTransport):
    """stdlib Winsock Bluetooth RFCOMM socket (blocking I/O in worker threads)."""

    name = "socket"

    def __init__(self, *a, channel: Optional[int] = None, **kw) -> None:
        super().__init__(*a, **kw)
        self.channel = channel
        self._sock: Optional[socket.socket] = None

    async def open(self) -> None:
        if not hasattr(socket, "AF_BLUETOOTH") or not hasattr(socket, "BTPROTO_RFCOMM"):
            raise TransportError("this Python build has no AF_BLUETOOTH/BTPROTO_RFCOMM support")
        ch = self.channel
        if ch is None:
            info = await diagnose(self.address, self.say)
            ch = info.get("channel")
        if ch is None:
            raise TransportError("could not determine the RFCOMM channel from SDP (pass --channel N to force one)")
        self.say(f"connecting Winsock RFCOMM socket to {self.address} channel {ch}...")
        loop = asyncio.get_running_loop()
        s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
        s.settimeout(30)
        try:
            await loop.run_in_executor(None, s.connect, (self.address, ch))
        except OSError as e:
            s.close()
            raise TransportError(f"Winsock connect failed: {fmt_exc(e)}") from e
        s.settimeout(None)
        self._sock = s
        self.say("connected (Winsock RFCOMM)")
        self._start_loops()

    async def _read_loop(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            while True:
                data = await loop.run_in_executor(None, self._sock.recv, 4096)
                if not data:
                    self._closed_by_peer("watch closed the RFCOMM connection")
                    return
                self.on_data(data)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._closed_by_peer(f"read failed: {fmt_exc(e)}")

    async def _write_loop(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            while True:
                data = await self._queue.get()
                if data is None:
                    return
                await loop.run_in_executor(None, self._sock.sendall, data)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._closed_by_peer(f"write failed: {fmt_exc(e)}")

    async def _close_io(self) -> None:
        try:
            if self._sock is not None:
                self._sock.close()
        except Exception:
            pass


async def open_transport(mode: str, address: str, on_data: DataCb, on_close: CloseCb, say: Say = print,
                         channel: Optional[int] = None) -> BaseTransport:
    """mode: 'winrt', 'socket' or 'auto' (winrt, then socket). Raises TransportError with every attempt listed."""
    errors: list[str] = []
    if not await ensure_radio_on(say, RADIO_ON):
        raise TransportError("Bluetooth radio is off")
    order = {"winrt": ["winrt"], "socket": ["socket"], "auto": ["winrt", "socket"]}[mode]
    for name in order:
        t: BaseTransport
        if name == "winrt":
            t = WinRtTransport(address, on_data, on_close, say)
        else:
            t = SocketTransport(address, on_data, on_close, say, channel=channel)
        try:
            say(f"--- transport: {name}")
            await t.open()
            return t
        except Exception as e:
            msg = f"{name}: {e}" if isinstance(e, TransportError) else f"{name}: {fmt_exc(e)}"
            errors.append(msg)
            say(f"{name} transport failed: {msg}")
            try:
                await t.close()
            except Exception:
                pass
    raise TransportError("could not open an RFCOMM connection:\n  " + "\n  ".join(errors))
