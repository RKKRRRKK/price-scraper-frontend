"""asyncio WatchClient: transport + SPP session + auth + command dispatch + packet log.

Ported behaviour: XiaomiSupport.handleCommandBytes (dispatch by command type), XiaomiAuthService
(handshake), and the connect sequence of XiaomiSppSupport. Every packet is logged to
out/session-<timestamp>.log (hex + decoded protobuf); the auth key is never logged.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional

from . import commands as C
from .auth import AuthError, AuthService, CMD_AUTH, CMD_NONCE, CMD_SEND_USERID, COMMAND_TYPE as AUTH_TYPE
from .config import Config
from .sessionlog import SessionLog, proto_text
from .spp import Channel, SppSession
from .transport import BaseTransport, TransportError, open_transport
from .proto import xiaomi_pb2

log = logging.getLogger("watchlab.client")

Handler = Callable[[xiaomi_pb2.Command], None]


class WatchError(Exception):
    pass


class AsyncioTimers:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def call_later(self, delay: float, callback):
        return self.loop.call_later(delay, callback)


class WatchClient:
    def __init__(self, cfg: Config, *, transport: str = "auto", channel: Optional[int] = None,
                 verbose: bool = False, say: Callable[[str], None] = print,
                 session_log: Optional[SessionLog] = None, address: Optional[str] = None) -> None:
        self.cfg = cfg
        self.address = address or cfg.watch_address
        self.transport_mode = transport
        self.channel = channel
        self.say = say
        self.slog = session_log or SessionLog(cfg.out_dir, verbose=verbose, echo=say)
        self.transport: Optional[BaseTransport] = None
        self.session: Optional[SppSession] = None
        self.auth: Optional[AuthService] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._pending: list[tuple[int, Optional[int], asyncio.Future]] = []
        self._handlers: dict[int, list[Handler]] = {}
        self._any_handlers: list[Handler] = []
        self._auth_future: Optional[asyncio.Future] = None
        self._disconnected: Optional[asyncio.Future] = None
        self._activity_cb: Optional[Callable[[bytes], None]] = None
        self.device_info = None
        self.battery = None

    # -- lifecycle -------------------------------------------------------------------------
    async def connect(self, *, init: bool = True, auth_timeout: float = 20.0) -> None:
        if not self.address:
            raise WatchError("no watch address: set WATCH_ADDRESS in .env (run `lab.py scan`)")
        if not self.cfg.watch_auth_key:
            raise WatchError("no auth key: set WATCH_AUTH_KEY in .env (32 hex chars)")
        self.loop = asyncio.get_running_loop()
        self._disconnected = self.loop.create_future()
        self.auth = AuthService(self.cfg.watch_auth_key)
        self.slog.note(f"connect {self.address} transport={self.transport_mode} key={self.cfg.key_hint()}")
        self.session = SppSession(
            self.auth, self._write, AsyncioTimers(self.loop),
            on_command_bytes=self._on_command_bytes, on_activity_chunk=self._on_activity,
            on_data=lambda b: self.slog.payload("rx", "Data", b),
            on_handshake=self._start_handshake, on_drop=self._on_drop,
            tap=self.slog.frame)
        self._auth_future = self.loop.create_future()
        try:
            self.transport = await open_transport(self.transport_mode, self.address, self._on_data, self._on_close,
                                                  self.say, self.channel)
        except TransportError:
            self.slog.note("transport failed")
            raise
        self.say(f"link up via {self.transport.name}; negotiating protocol version...")
        self.session.start()
        try:
            await asyncio.wait_for(self._auth_future, auth_timeout)
        except asyncio.TimeoutError:
            raise WatchError(
                f"no authentication within {auth_timeout:.0f} s (protocol {self.session.protocol_name}, "
                f"version payload {self.session.version_payload.hex() if self.session.version_payload else 'none'}). "
                f"The RFCOMM link is up but the watch stayed silent: is another host (the phone) connected? "
                f"See {self.slog.path}") from None
        self.say(f"authenticated (SPP {self.session.protocol_name}, encrypted)")
        if init:
            await self.refresh_info()

    async def close(self) -> None:
        if self.session:
            self.session.dispose()
        if self.transport:
            await self.transport.close()
        self.slog.close()

    async def wait_disconnect(self) -> str:
        return await self._disconnected

    # -- plumbing --------------------------------------------------------------------------
    def _write(self, frame: bytes) -> None:
        if self.transport:
            self.transport.write(frame)

    def _on_data(self, data: bytes) -> None:
        try:
            self.session.on_socket_read(data)
        except Exception:
            log.exception("error while processing %d received bytes", len(data))
            self.slog.note(f"processing error on bytes {data.hex()}")

    def _on_close(self, reason: str) -> None:
        self.say(f"link closed: {reason}")
        self.slog.note(f"closed: {reason}")
        self._fail_all(WatchError(f"link closed: {reason}"))
        if self._disconnected and not self._disconnected.done():
            self._disconnected.set_result(reason)

    def _on_drop(self, reason: str) -> None:
        if self.loop:
            self.loop.create_task(self._drop(reason))

    async def _drop(self, reason: str) -> None:
        if self.transport:
            await self.transport.close()
        self._on_close(reason)

    def _fail_all(self, exc: Exception) -> None:
        for _, _, fut in self._pending:
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()
        if self._auth_future and not self._auth_future.done():
            self._auth_future.set_exception(exc)

    # -- handshake -------------------------------------------------------------------------
    def _start_handshake(self) -> None:
        self.say("starting auth handshake (step 1)")
        self._send(self.auth.start_encrypted_handshake())

    def _handle_auth(self, cmd: xiaomi_pb2.Command) -> None:
        fut = self._auth_future
        if cmd.subtype == CMD_NONCE:
            reply = self.auth.handle_watch_nonce(cmd.auth.deviceVerify)
            if reply is None:
                if fut and not fut.done():
                    fut.set_exception(AuthError(
                        "the watch's hmac does not match: WATCH_AUTH_KEY is wrong (or belongs to a different watch). "
                        "Do not unpair/reset the watch; re-fetch the key."))
                return
            self.say("auth step 2 ok (watch proved it knows the key); confirming (step 3)")
            self._send(reply)
        elif cmd.subtype in (CMD_AUTH, CMD_SEND_USERID):
            if self.auth.on_auth_response(cmd):
                if fut and not fut.done():
                    fut.set_result(True)
            elif fut and not fut.done():
                fut.set_exception(AuthError(
                    f"authentication refused by the watch (subtype {cmd.subtype}, status {cmd.status}/{cmd.auth.status})"))
        else:
            self.say(f"unknown auth subtype {cmd.subtype}")

    # -- commands --------------------------------------------------------------------------
    def _send(self, cmd: xiaomi_pb2.Command) -> None:
        data = cmd.SerializeToString()
        self.slog.payload("tx", f"cmd {cmd.type}/{cmd.subtype}", data, proto_text(cmd))
        self.session.send_command_bytes(cmd.type, data)

    async def send_command(self, cmd: xiaomi_pb2.Command, *, expect: Optional[tuple[int, Optional[int]]] = None,
                           timeout: float = 10.0) -> Optional[xiaomi_pb2.Command]:
        """Send; if `expect=(type, subtype)` wait for the matching reply (subtype None = any) and return it."""
        fut = None
        if expect is not None:
            fut = self.loop.create_future()
            self._pending.append((expect[0], expect[1], fut))
        self._send(cmd)
        if fut is None:
            return None
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise WatchError(f"no reply to {cmd.type}/{cmd.subtype} within {timeout:.0f} s (expected {expect})") from None
        finally:
            self._pending = [p for p in self._pending if p[2] is not fut]

    def on_command(self, ctype: int, handler: Handler) -> None:
        self._handlers.setdefault(ctype, []).append(handler)

    def on_any_command(self, handler: Handler) -> None:
        self._any_handlers.append(handler)

    def _on_command_bytes(self, data: bytes) -> None:
        try:
            cmd = xiaomi_pb2.Command.FromString(data)
        except Exception as e:
            self.slog.payload("rx", "UNPARSEABLE", data)
            self.say(f"!! could not parse protobuf command ({e}): {data.hex()}")
            return
        self.slog.payload("rx", f"cmd {cmd.type}/{cmd.subtype}", data, proto_text(cmd))
        if cmd.type == AUTH_TYPE:
            self._handle_auth(cmd)
            return
        matched = False
        for entry in list(self._pending):
            t, s, fut = entry
            if t == cmd.type and (s is None or s == cmd.subtype) and not fut.done():
                fut.set_result(cmd)
                self._pending.remove(entry)
                matched = True
                break
        handlers = self._handlers.get(cmd.type, []) + self._any_handlers
        for h in handlers:
            try:
                h(cmd)
            except Exception:
                log.exception("handler failed for %d/%d", cmd.type, cmd.subtype)
        if not matched and not handlers:
            self.say(f"!! unhandled command {cmd.type}/{cmd.subtype}: {data.hex()}")

    def _on_activity(self, chunk: bytes) -> None:
        self.slog.payload("rx", "Activity", chunk)
        if self._activity_cb:
            self._activity_cb(chunk)
        else:
            self.say(f"!! activity chunk with no fetch running ({len(chunk)} bytes): {chunk[:32].hex()}")

    def set_activity_callback(self, cb: Optional[Callable[[bytes], None]]) -> None:
        self._activity_cb = cb

    # -- high-level ------------------------------------------------------------------------
    async def refresh_info(self) -> None:
        try:
            r = await self.send_command(C.simple(C.SYS, C.SYS_DEVICE_INFO), expect=(C.SYS, C.SYS_DEVICE_INFO))
            self.device_info = r.system.deviceInfo
            b = await self.send_command(C.simple(C.SYS, C.SYS_BATTERY), expect=(C.SYS, C.SYS_BATTERY))
            self.battery = b.system.power.battery
        except WatchError as e:
            self.say(f"device info/battery not available: {e}")

    def describe_info(self) -> str:
        lines = []
        if self.device_info is not None:
            d = self.device_info
            lines += [f"model:    {d.model}", f"firmware: {d.firmware}", f"serial:   {d.serialNumber}"]
        if self.battery is not None:
            b = self.battery
            state = {1: "charging", 2: "normal", 3: "normal"}.get(b.state, f"state {b.state}") if b.HasField("state") else "?"
            lines.append(f"battery:  {b.level}% ({state})")
        return "\n".join(lines) or "(no device info received)"

    async def set_time(self, **kw) -> Optional[xiaomi_pb2.Command]:
        return await self.send_command(C.build_set_time(**kw), expect=(C.SYS, C.SYS_CLOCK))

    async def _lenient(self, cmd, expect, timeout: float = 5.0) -> Optional[xiaomi_pb2.Command]:
        """Send and wait for an ack, but only warn if the watch stays silent (it may have acted anyway)."""
        try:
            return await self.send_command(cmd, expect=expect, timeout=timeout)
        except WatchError as e:
            self.say(f"(no acknowledgement: {e})")
            return None

    async def find_watch(self, start: bool = True) -> Optional[xiaomi_pb2.Command]:
        return await self._lenient(C.build_find_watch(start), (C.SYS, C.SYS_FIND_WATCH))

    async def notify(self, title: str, body: str) -> Optional[xiaomi_pb2.Command]:
        return await self._lenient(C.build_notification(title, body), (C.NOTIF, C.NOTIF_SEND))

    async def incoming_call(self, name: str, number: Optional[str] = None) -> Optional[xiaomi_pb2.Command]:
        return await self._lenient(C.build_incoming_call(name, number), (C.NOTIF, C.NOTIF_SEND))

    async def end_call(self) -> None:
        self._send(C.build_call_end())

    async def read_settings(self) -> list[tuple[str, Optional[xiaomi_pb2.Command]]]:
        out = []
        for label, t, s in C.SETTINGS_QUERIES:
            try:
                out.append((label, await self.send_command(C.simple(t, s), expect=(t, s), timeout=5)))
            except WatchError as e:
                self.say(f"  {label}: {e}")
                out.append((label, None))
        return out

    async def set_hr_interval(self, minutes: Optional[int] = None, disabled: Optional[bool] = None):
        cur = await self.send_command(C.simple(C.HEALTH, C.HEALTH_HR_GET), expect=(C.HEALTH, C.HEALTH_HR_GET))
        before = cur.health.heartRate
        self.say(f"heart-rate config before: interval={before.interval} min, disabled={before.disabled}")
        ack = await self.send_command(C.build_hr_set(before, interval_minutes=minutes, disabled=disabled),
                                      expect=(C.HEALTH, C.HEALTH_HR_SET))
        self.say(f"set acknowledged (status={ack.status})")
        after = (await self.send_command(C.simple(C.HEALTH, C.HEALTH_HR_GET), expect=(C.HEALTH, C.HEALTH_HR_GET))).health.heartRate
        self.say(f"heart-rate config after:  interval={after.interval} min, disabled={after.disabled}")
        return after
