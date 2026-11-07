"""Xiaomi SPP framing, flow control and version negotiation.

Ported from Gadgetbridge's XiaomiSppPacketV1/V2, XiaomiSppProtocolV1/V2, XiaomiSppV2SendWindow,
XiaomiSppSupport and XiaomiChannelHandler. Nothing here touches I/O: a `SppSession` is fed bytes
through `on_socket_read` and writes bytes through the `write` callable it was given, so the unit
tests drive it directly.

Protocol summary
  V1 frame: ba dc fe | channel | flags | len(le16) | opcode | serial | datatype | payload | ef
  V2 frame: a5 a5 | type | seq | len(le16) | crc16-arc(le16) | payload
The version is negotiated by sending a V1 "Version" read request and looking at payload[0] of the
answer (>= 2 switches to V2). After 5 s without an answer V1 is assumed.
"""
from __future__ import annotations

import enum
import logging
import struct
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

log = logging.getLogger("watchlab.spp")


class Channel(enum.Enum):
    Unknown = 0
    Version = 1
    ProtobufCommand = 2
    Activity = 3
    Data = 4
    Authentication = 5


class ParseStatus(enum.Enum):
    INVALID = 0
    INCOMPLETE = 1
    COMPLETE = 2


@dataclass
class ParseResult:
    status: ParseStatus
    packet_size: int = 0


# ----------------------------------------------------------------------------------------------
# V1 packets
# ----------------------------------------------------------------------------------------------

V1_PREAMBLE = bytes([0xBA, 0xDC, 0xFE])
V1_EPILOGUE = bytes([0xEF])

V1_CHANNEL_VERSION = 0
V1_CHANNEL_PROTO_RX = 1
V1_CHANNEL_PROTO_TX = 2
V1_CHANNEL_FITNESS = 3
V1_CHANNEL_VOICE = 4
V1_CHANNEL_MASS = 5
V1_CHANNEL_OTA = 7

DATA_TYPE_PLAIN = 0
DATA_TYPE_ENCRYPTED = 1
DATA_TYPE_AUTH = 2

OPCODE_READ = 0
OPCODE_SEND = 2

AUTH_COMMAND_TYPE = 1


class Counter:
    """Pre-increment counter, like Java's AtomicInteger.incrementAndGet()."""

    def __init__(self) -> None:
        self.value = 0

    def increment_and_get(self) -> int:
        self.value += 1
        return self.value

    def set(self, v: int) -> None:
        self.value = v


def v1_data_type_for_channel(channel: Channel) -> int:
    if channel == Channel.Authentication:
        return DATA_TYPE_AUTH
    if channel in (Channel.ProtobufCommand, Channel.Version, Channel.Data):
        return DATA_TYPE_ENCRYPTED
    if channel != Channel.Activity:
        log.warning("v1: cannot determine data type for channel %s", channel)
    return DATA_TYPE_PLAIN


def v1_raw_channel(channel: Channel, tx: bool) -> int:
    if channel == Channel.Version:
        return V1_CHANNEL_VERSION
    if channel in (Channel.Authentication, Channel.ProtobufCommand):
        return V1_CHANNEL_PROTO_TX if tx else V1_CHANNEL_PROTO_RX
    if channel == Channel.Activity:
        return V1_CHANNEL_FITNESS
    if channel == Channel.Data:
        return V1_CHANNEL_MASS
    log.warning("v1: raw channel for %s unknown", channel)
    return -1


def v1_channel_from_raw(raw: int) -> Channel:
    raw &= 0xFF
    if raw in (V1_CHANNEL_PROTO_RX, V1_CHANNEL_PROTO_TX):
        return Channel.ProtobufCommand
    if raw == V1_CHANNEL_FITNESS:
        return Channel.Activity
    if raw == V1_CHANNEL_MASS:
        return Channel.Data
    if raw == V1_CHANNEL_VERSION:
        return Channel.Version
    log.warning("v1: cannot convert raw channel %d to a known channel", raw)
    return Channel.Unknown


@dataclass
class PacketV1:
    channel: Channel = Channel.Unknown
    raw_channel: int = -1
    flag: bool = True
    needs_response: bool = False
    opcode: int = -1
    frame_serial: int = -1
    data_type: int = -1
    payload: bytes = b""

    @classmethod
    def build(cls, channel: Channel, *, flag: bool = True, needs_response: bool = False, opcode: int = -1,
              frame_serial: int = -1, data_type: int = -1, payload: bytes = b"") -> "PacketV1":
        return cls(channel, v1_raw_channel(channel, True), flag, needs_response, opcode, frame_serial,
                   data_type, payload)

    def decrypted_payload(self, auth) -> bytes:
        if auth is None:
            log.warning("v1 get_decrypted_payload: auth service is None")
            return self.payload
        if not auth.encryption_initialized and self.data_type == DATA_TYPE_ENCRYPTED:
            log.warning("v1 get_decrypted_payload: auth service is not ready to decrypt")
            return self.payload
        if self.data_type == DATA_TYPE_ENCRYPTED:
            return auth.decrypt(self.payload)
        return self.payload

    def encode(self, auth, encryption_counter: Optional[Counter]) -> bytes:
        payload = self.payload
        if self.data_type == DATA_TYPE_ENCRYPTED and self.channel == Channel.ProtobufCommand:
            packet_counter = encryption_counter.increment_and_get()
            payload = struct.pack("<H", packet_counter & 0xFFFF) + auth.encrypt(payload, packet_counter)
        elif self.data_type == DATA_TYPE_ENCRYPTED:
            payload = auth.encrypt(payload, 0)
        flags = (0x80 if self.flag else 0) | (0x40 if self.needs_response else 0)
        return (V1_PREAMBLE
                + bytes([v1_raw_channel(self.channel, True) & 0xF, flags])
                + struct.pack("<H", len(payload) + 3)
                + bytes([self.opcode & 0xFF, self.frame_serial & 0xFF, self.data_type & 0xFF])
                + payload + V1_EPILOGUE)

    @classmethod
    def decode(cls, packet: bytes) -> Optional["PacketV1"]:
        if len(packet) < 11:
            log.error("v1: cannot decode incomplete packet")
            return None
        if packet[:3] != V1_PREAMBLE:
            log.error("v1: expected preamble %s, found %s", V1_PREAMBLE.hex(), packet[:3].hex())
            return None
        channel = packet[3]
        if channel & 0xF0:
            log.warning("v1: reserved bits in channel byte are non-zero: %s", bin((channel & 0xF0) >> 4))
            channel = 0x0F
        flags = packet[4]
        flag = bool(flags & 0x80)
        needs_response = bool(flags & 0x40)
        if flags & 0x0F:
            log.warning("v1: reserved bits in flags byte are non-zero: %s", bin(flags & 0x0F))
        payload_length = struct.unpack_from("<H", packet, 5)[0] - 3
        if payload_length < 0 or payload_length + 11 > len(packet):
            log.error("v1: packet incomplete (expected %d, actual %d)", payload_length + 11, len(packet))
            return None
        opcode, frame_serial, data_type = packet[7], packet[8], packet[9]
        payload = bytes(packet[10:10 + payload_length])
        if packet[10 + payload_length:11 + payload_length] != V1_EPILOGUE:
            log.error("v1: expected epilogue ef, got %s", packet[10 + payload_length:11 + payload_length].hex())
            return None
        return cls(v1_channel_from_raw(channel), channel, flag, needs_response, opcode, frame_serial,
                   data_type, payload)

    def __str__(self) -> str:
        return (f"SppPacketV1(channel={self.channel.name}, raw={self.raw_channel}, flag={self.flag}, "
                f"needsResponse={self.needs_response}, opcode=0x{self.opcode:x}, serial=0x{self.frame_serial:x}, "
                f"dataType=0x{self.data_type:x}, payloadSize={len(self.payload)})")


# ----------------------------------------------------------------------------------------------
# V2 packets
# ----------------------------------------------------------------------------------------------

V2_PREAMBLE = bytes([0xA5, 0xA5])

PACKET_TYPE_UNKNOWN = -1
PACKET_TYPE_NACK = 0       # empty payload; seq = next data packet the receiver expects
PACKET_TYPE_ACK = 1        # cumulative: everything up to and including seq
PACKET_TYPE_SESSION_CONFIG = 2
PACKET_TYPE_DATA = 3

SESSION_OP_START_REQUEST = 1
SESSION_OP_START_RESPONSE = 2
SESSION_OP_STOP_REQUEST = 3
SESSION_OP_STOP_RESPONSE = 4

SESSION_KEY_VERSION = 1
SESSION_KEY_MAX_PACKET_SIZE = 2
SESSION_KEY_TX_WIN = 3
SESSION_KEY_SEND_TIMEOUT = 4

V2_CHANNEL_PROTOBUF = 1   # encrypted after authentication
V2_CHANNEL_DATA = 2       # not encrypted
V2_CHANNEL_ACTIVITY = 5   # encrypted
V2_OPCODE_UNKNOWN = -1
V2_OPCODE_SEND_PLAINTEXT = 1
V2_OPCODE_SEND_ENCRYPTED = 2


def crc16_arc(payload: bytes) -> int:
    """CRC-16/ARC (poly 0x8005, init 0, reflected), the way Gadgetbridge computes it bit by bit."""
    crc = 0
    for b in payload:
        for j in range(8):
            crc = (crc << 1) & 0xFFFFFFFF
            if (((crc >> 16) & 1) ^ ((b >> j) & 1)) == 1:
                crc ^= 0x8005
    rev = int(f"{crc & 0xFFFFFFFF:032b}"[::-1], 2)
    return (rev >> 16) & 0xFFFF


def v2_raw_channel(channel: Channel) -> int:
    if channel in (Channel.Authentication, Channel.ProtobufCommand):
        return V2_CHANNEL_PROTOBUF
    if channel == Channel.Data:
        return V2_CHANNEL_DATA
    if channel == Channel.Activity:
        return V2_CHANNEL_ACTIVITY
    log.warning("v2: unable to get raw channel value for channel %s", channel)
    return -1


def v2_channel_from_raw(raw: int) -> Channel:
    if raw == V2_CHANNEL_PROTOBUF:
        return Channel.ProtobufCommand
    if raw == V2_CHANNEL_ACTIVITY:
        return Channel.Activity
    if raw == V2_CHANNEL_DATA:
        return Channel.Data
    log.warning("v2: unknown raw channel %d", raw)
    return Channel.Unknown


def v2_opcode_for_channel(channel: Channel) -> int:
    if channel in (Channel.Authentication, Channel.Data):
        return V2_OPCODE_SEND_PLAINTEXT
    if channel in (Channel.ProtobufCommand, Channel.Activity):
        return V2_OPCODE_SEND_ENCRYPTED
    log.warning("v2: opcode for channel %s unknown", channel)
    return V2_OPCODE_UNKNOWN


@dataclass
class PacketV2:
    packet_type: int
    sequence_number: int = -1
    # session config
    opcode: int = -1
    config: dict = field(default_factory=dict)
    # data
    channel: Channel = Channel.Unknown
    payload: bytes = b""

    # -- construction helpers --------------------------------------------------------------
    @classmethod
    def ack(cls, seq: int) -> "PacketV2":
        return cls(PACKET_TYPE_ACK, seq)

    @classmethod
    def nack(cls, seq: int) -> "PacketV2":
        return cls(PACKET_TYPE_NACK, seq)

    @classmethod
    def session_config(cls, opcode: int, seq: int = 0) -> "PacketV2":
        return cls(PACKET_TYPE_SESSION_CONFIG, seq, opcode=opcode)

    @classmethod
    def data(cls, channel: Channel, opcode: int, payload: bytes, seq: int = -1) -> "PacketV2":
        return cls(PACKET_TYPE_DATA, seq, opcode=opcode, channel=channel, payload=payload)

    # -- payload ---------------------------------------------------------------------------
    def payload_bytes(self, auth) -> bytes:
        """The bytes that go after the V2 header (encrypted for data packets that need it)."""
        if self.packet_type in (PACKET_TYPE_ACK, PACKET_TYPE_NACK):
            return b""
        if self.packet_type == PACKET_TYPE_SESSION_CONFIG:
            # from packet dump of the official app
            return bytes([
                self.opcode & 0xFF,
                SESSION_KEY_VERSION, 0x03, 0x00, 0x01, 0x00, 0x00,           # VERSION = 01.00.00
                SESSION_KEY_MAX_PACKET_SIZE, 0x02, 0x00, 0x00, 0xFC,         # MAX_FRAME_SIZE = 0xfc00
                SESSION_KEY_TX_WIN, 0x02, 0x00, 0x20, 0x00,                  # TX_WIN = 32 frames
                SESSION_KEY_SEND_TIMEOUT, 0x02, 0x00, 0x10, 0x27,            # SEND_TIMEOUT = 10000 ms
            ])
        body = auth.encrypt_v2(self.payload) if self.opcode == V2_OPCODE_SEND_ENCRYPTED else self.payload
        return bytes([v2_raw_channel(self.channel) & 0xF, self.opcode & 0xFF]) + body

    def decrypted_payload(self, auth) -> bytes:
        if self.opcode == V2_OPCODE_SEND_ENCRYPTED:
            return auth.decrypt_v2(self.payload)
        return self.payload

    def encode(self, auth) -> bytes:
        return encode_frame_v2(self.packet_type, self.sequence_number, self.payload_bytes(auth))

    # -- decode ----------------------------------------------------------------------------
    @classmethod
    def decode(cls, packet: bytes) -> Optional["PacketV2"]:
        if len(packet) < 8:
            log.warning("v2 decode: at least 8 bytes required, got %d", len(packet))
            return None
        if packet[:2] != V2_PREAMBLE:
            log.error("v2 decode: header mismatch, expected %s got %s", V2_PREAMBLE.hex(), packet[:2].hex())
            return None
        ptype = packet[2] & 0xF
        seq = packet[3]
        length, given_crc = struct.unpack_from("<HH", packet, 4)
        if len(packet) - 8 < length:
            log.error("v2 decode: expected at least %d bytes, got %d (missing %d)", length + 8, len(packet),
                      length - (len(packet) - 8))
            return None
        payload = bytes(packet[8:8 + length])
        calc = crc16_arc(payload)
        if calc != given_crc:
            log.error("v2 decode: payload checksum mismatch (given %d != calculated %d)", given_crc, calc)
            return None
        if ptype == PACKET_TYPE_SESSION_CONFIG:
            return cls._decode_session_config(seq, payload)
        if ptype == PACKET_TYPE_DATA:
            return cls._decode_data(seq, payload)
        if ptype == PACKET_TYPE_ACK:
            return cls.ack(seq)
        if ptype == PACKET_TYPE_NACK:
            return cls.nack(seq)
        log.warning("v2 decode: unhandled packet type %d", ptype)
        return None

    @classmethod
    def _decode_session_config(cls, seq: int, payload: bytes) -> Optional["PacketV2"]:
        if len(payload) < 1:
            log.warning("v2 session config: at least 1 byte required")
            return None
        opcode = payload[0]
        config: dict = {}
        if opcode in (SESSION_OP_START_REQUEST, SESSION_OP_START_RESPONSE):
            pos = 1
            while len(payload) - pos >= 3:
                key = payload[pos]
                size = struct.unpack_from("<H", payload, pos + 1)[0]
                pos += 3
                if len(payload) - pos < size:
                    log.warning("v2 session config: not enough bytes remaining to extract value")
                    break
                value = payload[pos:pos + size]
                pos += size
                if key == SESSION_KEY_VERSION and size == 3:
                    config["version"] = value.hex()
                elif key in (SESSION_KEY_MAX_PACKET_SIZE, SESSION_KEY_TX_WIN, SESSION_KEY_SEND_TIMEOUT) and size == 2:
                    name = {SESSION_KEY_MAX_PACKET_SIZE: "max_packet_size", SESSION_KEY_TX_WIN: "tx_win",
                            SESSION_KEY_SEND_TIMEOUT: "send_timeout_ms"}[key]
                    config[name] = struct.unpack("<H", value)[0]
                else:
                    config[f"key{key}"] = value.hex()
        elif opcode not in (SESSION_OP_STOP_REQUEST, SESSION_OP_STOP_RESPONSE):
            log.error("v2 session config: unknown opcode %d", opcode)
        pkt = cls.session_config(opcode, seq)
        pkt.config = config
        return pkt

    @classmethod
    def _decode_data(cls, seq: int, payload: bytes) -> Optional["PacketV2"]:
        if len(payload) < 2:
            log.error("v2 data: not enough bytes to decode data packet payload")
            return None
        raw_channel = payload[0] & 0xF
        return cls.data(v2_channel_from_raw(raw_channel), payload[1], bytes(payload[2:]), seq)

    def __str__(self) -> str:
        if self.packet_type == PACKET_TYPE_DATA:
            return (f"SppPacketV2(DATA seq={self.sequence_number} channel={self.channel.name} "
                    f"opcode={self.opcode} len={len(self.payload)})")
        if self.packet_type == PACKET_TYPE_SESSION_CONFIG:
            return f"SppPacketV2(SESSION_CONFIG seq={self.sequence_number} opcode={self.opcode} {self.config})"
        name = {PACKET_TYPE_ACK: "ACK", PACKET_TYPE_NACK: "NACK"}.get(self.packet_type, str(self.packet_type))
        return f"SppPacketV2({name} seq={self.sequence_number})"


def encode_frame_v2(packet_type: int, sequence_number: int, payload: bytes) -> bytes:
    """The checksum covers the payload only, so a payload can be encrypted before its sequence number is known."""
    return (V2_PREAMBLE + bytes([packet_type & 0xF, sequence_number & 0xFF])
            + struct.pack("<HH", len(payload), crc16_arc(payload)) + payload)


# ----------------------------------------------------------------------------------------------
# V2 send window
# ----------------------------------------------------------------------------------------------

class SendWindow:
    """Sequence numbers (8 bit, wrapping) and unacked frames of the V2 data packets we send.

    Acks are cumulative: acking a sequence number releases every frame sent up to and including it.
    """

    MAX_TRACKED_FRAMES = 128  # half the sequence space, so a number identifies at most one tracked frame

    def __init__(self) -> None:
        self._unacked: deque[tuple[int, bytes]] = deque()
        self._next = 0

    def next_sequence_number(self) -> int:
        n = self._next
        self._next = (self._next + 1) & 0xFF
        return n

    def on_sent(self, seq: int, frame: bytes) -> None:
        self._unacked.append((seq, frame))
        while len(self._unacked) > self.MAX_TRACKED_FRAMES:
            self._unacked.popleft()

    def on_ack(self, seq: int) -> int:
        """Number of frames released; 0 if `seq` matches no unacked frame."""
        if not any(s == seq for s, _ in self._unacked):
            return 0
        released = 0
        while True:
            s, _ = self._unacked.popleft()
            released += 1
            if s == seq:
                return released

    def oldest_unacked(self) -> int:
        return self._unacked[0][0] if self._unacked else -1

    def is_empty(self) -> bool:
        return not self._unacked

    def unacked_frames(self) -> list[bytes]:
        return [f for _, f in self._unacked]

    def clear(self) -> None:
        self._unacked.clear()
        self._next = 0


# ----------------------------------------------------------------------------------------------
# Protocols
# ----------------------------------------------------------------------------------------------

class Timers(Protocol):
    def call_later(self, delay: float, callback: Callable[[], None]): ...


class _Link(Protocol):
    auth: object
    timers: Timers

    def write_frame(self, frame: bytes) -> None: ...
    def on_packet_received(self, channel: Channel, payload: bytes) -> None: ...
    def start_encrypted_handshake(self) -> None: ...
    def drop_connection(self, reason: str) -> None: ...
    def tap(self, direction: str, info: str, frame: bytes) -> None: ...


class SppProtocolV1:
    """Ported from XiaomiSppProtocolV1."""

    def __init__(self, link: _Link) -> None:
        self.link = link
        self.frame_counter = Counter()
        self.encryption_counter = Counter()

    def reset(self) -> None:
        self.frame_counter.set(0)
        self.encryption_counter.set(0)

    def dispose(self) -> None:
        pass

    def find_next_packet_offset(self, buf: bytes) -> int:
        for i in range(1, len(buf)):
            if buf[i] == V1_PREAMBLE[0]:  # processPacket checks the full magic
                return i
        return -1

    def process_packet(self, buf: bytes) -> ParseResult:
        if len(buf) < 11:
            return ParseResult(ParseStatus.INCOMPLETE)
        if buf[:3] != V1_PREAMBLE:
            log.debug("v1 process_packet: header mismatch, expected %s got %s", V1_PREAMBLE.hex(), buf[:3].hex())
            return ParseResult(ParseStatus.INVALID)
        payload_size = struct.unpack_from("<H", buf, 5)[0]
        packet_size = payload_size + 8  # payload size includes the payload header
        if len(buf) < packet_size:
            return ParseResult(ParseStatus.INCOMPLETE)
        packet = PacketV1.decode(bytes(buf[:packet_size]))
        if packet is None:
            return ParseResult(ParseStatus.INVALID)
        self.link.tap("rx", str(packet), bytes(buf[:packet_size]))
        try:
            payload = self._decrypt(packet)
            self.link.on_packet_received(packet.channel, payload)
        except Exception:
            log.exception("v1: failed to handle %s (payload %s)", packet, packet.payload.hex())
        # TODO (as in Gadgetbridge): send a response if the device requested one
        return ParseResult(ParseStatus.COMPLETE, packet_size)

    def _decrypt(self, packet: PacketV1) -> bytes:
        try:
            return packet.decrypted_payload(self.link.auth)
        except Exception as e:
            # Not in Gadgetbridge: some firmware may prefix the 2-byte counter on received protobuf packets too.
            if packet.data_type == DATA_TYPE_ENCRYPTED and len(packet.payload) > 2:
                try:
                    alt = self.link.auth.decrypt(packet.payload[2:])
                    log.warning("v1: decrypt failed (%s) but succeeded after stripping a 2-byte counter", e)
                    return alt
                except Exception:
                    pass
            log.error("v1: failed to decrypt payload %s: %s", packet.payload.hex(), e)
            raise

    def write_packet(self, channel: Channel, data: bytes) -> None:
        pkt = PacketV1.build(channel, opcode=OPCODE_SEND, frame_serial=self.frame_counter.value & 0xFF,
                             data_type=v1_data_type_for_channel(channel), payload=data)
        self.frame_counter.value += 1
        frame = pkt.encode(self.link.auth, self.encryption_counter)
        self.link.tap("tx", str(pkt), frame)
        self.link.write_frame(frame)

    def initialize_session(self) -> bool:
        return True


class SppProtocolV2:
    """Ported from XiaomiSppProtocolV2.

    Data packets are delivered go-back-N: the watch accepts them strictly in sequence and acks
    cumulatively, so a packet that reaches it out of order is dropped together with everything sent
    after it until the missing one is resent.
    """

    RESEND_TIMEOUT_SECONDS = 10.0
    MAX_TIMEOUTS_WITHOUT_ACK = 3

    def __init__(self, link: _Link) -> None:
        self.link = link
        self.window = SendWindow()
        self._timeout_handle = None
        self._timeout_pending = False
        self._timeouts_without_ack = 0
        self._session_started = False

    # -- lifecycle -------------------------------------------------------------------------
    def reset(self) -> None:
        self.dispose()

    def dispose(self) -> None:
        if self._timeout_handle is not None:
            self._timeout_handle.cancel()
        self._timeout_handle = None
        self._timeout_pending = False
        self._timeouts_without_ack = 0
        self.window.clear()

    def initialize_session(self) -> bool:
        self.dispose()
        self._session_started = False
        pkt = PacketV2.session_config(SESSION_OP_START_REQUEST, 0)
        frame = pkt.encode(None)
        self.link.tap("tx", str(pkt), frame)
        self.link.write_frame(frame)
        return False  # the handshake starts once the watch answers with its session config

    # -- receive ---------------------------------------------------------------------------
    def find_next_packet_offset(self, buf: bytes) -> int:
        for i in range(1, len(buf)):
            if buf[i] == V2_PREAMBLE[0]:
                return i
        return -1

    def process_packet(self, buf: bytes) -> ParseResult:
        if len(buf) < 8:
            return ParseResult(ParseStatus.INCOMPLETE)
        if buf[:2] != V2_PREAMBLE:
            log.warning("v2 process_packet: invalid header magic (expected %s, got %s)", V2_PREAMBLE.hex(), buf[:2].hex())
            return ParseResult(ParseStatus.INVALID)
        packet_size = 8 + struct.unpack_from("<H", buf, 4)[0]
        if len(buf) < packet_size:
            return ParseResult(ParseStatus.INCOMPLETE)
        raw = bytes(buf[:packet_size])
        pkt = PacketV2.decode(raw)
        if pkt is None:
            self.link.tap("rx", "undecodable v2 frame (crc/format)", raw)
        else:
            self.link.tap("rx", str(pkt), raw)
            self._handle(pkt)
        return ParseResult(ParseStatus.COMPLETE, packet_size)

    def _handle(self, pkt: PacketV2) -> None:
        t = pkt.packet_type
        if t == PACKET_TYPE_SESSION_CONFIG:
            log.info("received session config, opcode=%d %s", pkt.opcode, pkt.config)
            if not self._session_started:
                self._session_started = True
                self.link.start_encrypted_handshake()
        elif t == PACKET_TYPE_DATA:
            try:
                payload = pkt.decrypted_payload(self.link.auth)
                self.link.on_packet_received(pkt.channel, payload)
            except Exception:
                log.exception("exception while handling received packet (seq %d, channel %s, opcode %d, payload %s)",
                              pkt.sequence_number, pkt.channel.name, pkt.opcode, pkt.payload.hex())
            self._send_ack(pkt.sequence_number)
        elif t == PACKET_TYPE_ACK:
            log.debug("receive ack for packet %d", pkt.sequence_number)
            self._on_ack(pkt.sequence_number)
        elif t == PACKET_TYPE_NACK:
            self._on_nack(pkt.sequence_number)
        else:
            log.warning("unhandled v2 packet type %d", t)

    def _send_ack(self, seq: int) -> None:
        pkt = PacketV2.ack(seq)
        frame = pkt.encode(None)
        self.link.tap("tx", str(pkt), frame)
        self.link.write_frame(frame)

    def _on_ack(self, seq: int) -> None:
        if self.window.on_ack(seq) > 0:
            self._on_ack_progress()

    def _on_nack(self, expected: int) -> None:
        self._on_ack((expected - 1) & 0xFF)
        if self.window.oldest_unacked() != expected:
            log.warning("receive nack, watch expects packet %d, which is not pending", expected)
            return
        log.warning("receive nack, watch expects packet %d, resending", expected)
        self._resend_unacked()

    def _resend_unacked(self) -> None:
        frames = self.window.unacked_frames()
        log.debug("resending %d unacked packets", len(frames))
        for f in frames:
            self.link.tap("tx", "resend", f)
            self.link.write_frame(f)
        self._arm_resend_timeout()

    def _on_ack_progress(self) -> None:
        self._timeouts_without_ack = 0
        if self._timeout_handle is not None:
            self._timeout_handle.cancel()
        self._timeout_handle = None
        self._timeout_pending = False
        if not self.window.is_empty():
            self._arm_resend_timeout()

    def _arm_resend_timeout(self) -> None:
        if not self._timeout_pending:
            self._timeout_pending = True
            self._timeout_handle = self.link.timers.call_later(self.RESEND_TIMEOUT_SECONDS, self._on_resend_timeout)

    def _on_resend_timeout(self) -> None:
        self._timeout_pending = False
        if self.window.is_empty():
            self._timeouts_without_ack = 0
            return
        self._timeouts_without_ack += 1
        if self._timeouts_without_ack >= self.MAX_TIMEOUTS_WITHOUT_ACK:
            log.warning("no ack for packet %d after %d timeouts, dropping the connection",
                        self.window.oldest_unacked(), self._timeouts_without_ack)
            self.dispose()
            self.link.drop_connection("no ack from watch")
            return
        log.warning("no ack for packet %d within %.0f s, resending", self.window.oldest_unacked(),
                    self.RESEND_TIMEOUT_SECONDS)
        self._resend_unacked()

    # -- send ------------------------------------------------------------------------------
    def write_packet(self, channel: Channel, payload: bytes) -> None:
        """The payload is encrypted here; the sequence number is taken right before the write."""
        pkt = PacketV2.data(channel, v2_opcode_for_channel(channel), payload)
        body = pkt.payload_bytes(self.link.auth)
        seq = self.window.next_sequence_number()
        frame = encode_frame_v2(PACKET_TYPE_DATA, seq, body)
        self.window.on_sent(seq, frame)
        self.link.tap("tx", f"SppPacketV2(DATA seq={seq} channel={channel.name} opcode={pkt.opcode} "
                            f"len={len(payload)})", frame)
        self.link.write_frame(frame)
        self._arm_resend_timeout()


# ----------------------------------------------------------------------------------------------
# Session (XiaomiSppSupport)
# ----------------------------------------------------------------------------------------------

class SppSession:
    """Reassembles the byte stream, negotiates V1/V2 and routes payloads by channel.

    `on_command_bytes(payload)` gets protobuf Command bytes (both channels carrying them),
    `on_activity_chunk(payload)` the Activity channel, `on_data(payload)` the Data channel.
    `on_handshake` is called when the auth handshake should start (step 1 is sent by the caller).
    `tap(direction, info, frame)` receives every frame for logging.
    """

    VERSION_TIMEOUT_SECONDS = 5.0

    def __init__(self, auth, write: Callable[[bytes], None], timers: Timers, *,
                 on_command_bytes: Callable[[bytes], None],
                 on_activity_chunk: Callable[[bytes], None] = lambda b: None,
                 on_data: Callable[[bytes], None] = lambda b: None,
                 on_handshake: Callable[[], None],
                 on_drop: Callable[[str], None] = lambda r: None,
                 tap: Callable[[str, str, bytes], None] = lambda d, i, f: None) -> None:
        self.auth = auth
        self.timers = timers
        self._write = write
        self._on_command_bytes = on_command_bytes
        self._on_activity_chunk = on_activity_chunk
        self._on_data = on_data
        self._on_handshake = on_handshake
        self._on_drop = on_drop
        self._tap = tap
        self.buffer = bytearray()
        self.protocol: SppProtocolV1 | SppProtocolV2 = SppProtocolV1(self)
        self.version_payload: Optional[bytes] = None
        self._version_timer = None
        self._handshake_started = False

    # -- _Link interface -------------------------------------------------------------------
    def write_frame(self, frame: bytes) -> None:
        self._write(frame)

    def start_encrypted_handshake(self) -> None:
        if self._handshake_started:
            log.warning("handshake already started, ignoring duplicate trigger")
            return
        self._handshake_started = True
        self._on_handshake()

    def drop_connection(self, reason: str) -> None:
        self._on_drop(reason)

    def tap(self, direction: str, info: str, frame: bytes) -> None:
        self._tap(direction, info, frame)

    def on_packet_received(self, channel: Channel, payload: bytes) -> None:
        if channel == Channel.Version:
            self._handle_version_packet(payload)
        elif channel == Channel.ProtobufCommand:
            self._on_command_bytes(payload)
        elif channel == Channel.Activity:
            self._on_activity_chunk(payload)
        elif channel == Channel.Data:
            self._on_data(payload)
        else:
            log.warning("unhandled SppPacket on channel %s (payload %s)", channel.name, payload.hex())

    # -- lifecycle -------------------------------------------------------------------------
    def start(self) -> None:
        """Send the V1 version request and arm the 5 s fallback (XiaomiSppSupport.initializeDevice)."""
        self.reset()
        pkt = PacketV1.build(Channel.Version, needs_response=True, opcode=OPCODE_READ, data_type=DATA_TYPE_PLAIN,
                             frame_serial=0)
        frame = pkt.encode(None, None)
        self._tap("tx", str(pkt), frame)
        self._write(frame)
        self._version_timer = self.timers.call_later(self.VERSION_TIMEOUT_SECONDS, self._on_version_timeout)

    def reset(self) -> None:
        self.buffer.clear()
        self._cancel_version_timer()
        self.protocol.dispose()
        self.protocol = SppProtocolV1(self)  # back to V1 so the version packet can be parsed
        self.version_payload = None
        self._handshake_started = False

    def dispose(self) -> None:
        self._cancel_version_timer()
        self.protocol.dispose()

    def _cancel_version_timer(self) -> None:
        if self._version_timer is not None:
            self._version_timer.cancel()
            self._version_timer = None

    def _on_version_timeout(self) -> None:
        log.warning("SPP protocol version request timed out, assuming V1")
        self._version_timer = None
        self._handle_version_packet(b"")

    def _handle_version_packet(self, payload: bytes) -> None:
        self._cancel_version_timer()
        if payload:
            self.version_payload = payload
            log.info("received SPP protocol version: %s", payload.hex())
            if payload[0] >= 2:
                log.info("detected protocol version %d, switching to V2", payload[0])
                self.protocol.dispose()
                self.protocol = SppProtocolV2(self)
        if self.protocol.initialize_session():
            self.start_encrypted_handshake()

    @property
    def protocol_name(self) -> str:
        return "V2" if isinstance(self.protocol, SppProtocolV2) else "V1"

    # -- receive ---------------------------------------------------------------------------
    def on_socket_read(self, data: bytes) -> None:
        self.buffer.extend(data)
        self._process_buffer()

    def _process_buffer(self) -> None:
        while True:
            state = bytes(self.buffer)
            if not state:
                return
            result = self.protocol.process_packet(state)
            if result.status == ParseStatus.INCOMPLETE:
                return
            if result.status == ParseStatus.COMPLETE:
                skip = result.packet_size
            else:
                skip = self.protocol.find_next_packet_offset(state)
                if skip < 0:
                    skip = len(state)
                log.warning("invalid data in rx buffer, skipping %d bytes: %s", skip, state[:skip].hex())
            if skip <= 0:
                skip = len(state)  # never spin
            del self.buffer[:skip]

    # -- send ------------------------------------------------------------------------------
    def send_command_bytes(self, command_type: int, command_bytes: bytes) -> None:
        channel = Channel.Authentication if command_type == AUTH_COMMAND_TYPE else Channel.ProtobufCommand
        self.protocol.write_packet(channel, command_bytes)

    def send_data_chunk(self, chunk: bytes) -> None:
        self.protocol.write_packet(Channel.Data, chunk)
