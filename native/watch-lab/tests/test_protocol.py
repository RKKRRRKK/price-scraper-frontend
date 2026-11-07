"""Protocol tests. Ports of Gadgetbridge's XiaomiAuthServiceTest, XiaomiSppPacketV2Test,
XiaomiSppV2SendWindowTest and XiaomiSppProtocolV2Test (real byte vectors), plus an end-to-end
handshake against a simulated watch, and the weather mapping / SDP / activity-chunk helpers.

Run: .venv/Scripts/python -m unittest discover -s tests -v
"""
import os
import struct
import sys
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from watchlab import auth as A  # noqa: E402
from watchlab import commands as C  # noqa: E402
from watchlab import fetcher as F  # noqa: E402
from watchlab import spp as S  # noqa: E402
from watchlab import transport as T  # noqa: E402
from watchlab import weather as W  # noqa: E402
from watchlab.proto import xiaomi_pb2  # noqa: E402
from watchlab.proto.xiaomi import wear_account_pb2  # noqa: E402

NONCE = bytes([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF])


class AuthServiceTest(unittest.TestCase):
    """XiaomiAuthServiceTest"""

    def test_nonce_command_with_device_id(self):
        av = A.build_nonce_command(NONCE, "0123456789abcdef0123456789abcdef").auth.appVerify
        self.assertEqual(NONCE, av.nonce)
        self.assertTrue(av.HasField("deviceId"))
        self.assertEqual("0123456789abcdef0123456789abcdef", av.deviceId)

    def test_nonce_command_without_device_id_is_unchanged_on_the_wire(self):
        expected = xiaomi_pb2.Command(type=1, subtype=26)
        expected.auth.appVerify.nonce = NONCE
        for no_id in (None, ""):
            cmd = A.build_nonce_command(NONCE, no_id)
            self.assertFalse(cmd.auth.appVerify.HasField("deviceId"))
            self.assertEqual(expected.SerializeToString(), cmd.SerializeToString())

    def test_step1_wire_bytes(self):
        self.assertEqual("0801101a1a15f201120a10" + NONCE.hex(), A.build_nonce_command(NONCE).SerializeToString().hex())


class CryptoTest(unittest.TestCase):
    def test_ccm_matches_nist_sp800_38c_example1(self):
        # Key 40..4f, nonce 10..16, payload 20212223 -> ciphertext 7162015b, tag 4dac255d (Tlen 32), adata 00..07
        key = bytes(range(0x40, 0x50))
        nonce = bytes(range(0x10, 0x17))
        from cryptography.hazmat.primitives.ciphers.aead import AESCCM
        out = AESCCM(key, tag_length=4).encrypt(nonce, bytes.fromhex("20212223"), bytes(range(8)))
        self.assertEqual("7162015b4dac255d", out.hex())
        self.assertEqual("20212223", A.ccm_ctr_only(key, nonce, bytes.fromhex("7162015b")).hex())

    def test_ccm_round_trip_and_tag_check(self):
        key, nonce = os.urandom(16), os.urandom(12)
        ct = A.ccm_encrypt(key, nonce, b"hello watch")
        self.assertEqual(len(b"hello watch") + 4, len(ct))
        self.assertEqual(b"hello watch", A.ccm_decrypt(key, nonce, ct))
        self.assertEqual(b"hello watch", A.ccm_decrypt(key, nonce, ct[:-1] + bytes([ct[-1] ^ 1]), check_mac=False))
        from cryptography.exceptions import InvalidTag
        with self.assertRaises(InvalidTag):
            A.ccm_decrypt(key, nonce, ct[:-1] + bytes([ct[-1] ^ 1]))

    def test_hmac_matches_rfc4231_case1(self):
        self.assertEqual("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
                         A.hmac_sha256(b"\x0b" * 20, b"Hi There").hex())

    def test_key_expansion_is_64_bytes_and_depends_on_every_input(self):
        k, a, b = bytes(range(16)), bytes(16), bytes([1] * 16)
        out = A.compute_auth_step3_hmac(k, a, b)
        self.assertEqual(64, len(out))
        self.assertNotEqual(out, A.compute_auth_step3_hmac(k, b, a))
        self.assertNotEqual(out, A.compute_auth_step3_hmac(bytes(16), a, b))
        # first block by hand: HMAC(HMAC(a+b, secret), "miwear-auth" || 01)
        prk = A.hmac_sha256(a + b, k)
        self.assertEqual(A.hmac_sha256(prk, b"miwear-auth\x01"), out[:32])
        self.assertEqual(A.hmac_sha256(prk, out[:32] + b"miwear-auth\x02"), out[32:])

    def test_v2_ctr_round_trip(self):
        a = A.AuthService(bytes(16))
        a.encryption_key = a.decryption_key = os.urandom(16)
        self.assertEqual(b"x" * 40, a.decrypt_v2(a.encrypt_v2(b"x" * 40)))


class FakeTimers:
    def __init__(self):
        self.pending = []
        self.now = 0.0

    def call_later(self, delay, cb):
        h = type("H", (), {})()
        h.at, h.cb, h.cancelled = self.now + delay, cb, False
        h.cancel = lambda h=h: setattr(h, "cancelled", True)
        self.pending.append(h)
        return h

    def advance(self, secs):
        self.now += secs
        due = [h for h in self.pending if h.at <= self.now and not h.cancelled]
        self.pending = [h for h in self.pending if h not in due]
        for h in due:
            h.cb()


class SppPacketV2Test(unittest.TestCase):
    """XiaomiSppPacketV2Test"""

    @staticmethod
    def empty_frame(ptype, seq):
        return bytes([0xA5, 0xA5, ptype, seq, 0, 0, 0, 0])

    def test_decodes_ack(self):
        p = S.PacketV2.decode(self.empty_frame(S.PACKET_TYPE_ACK, 0xF2))
        self.assertEqual((S.PACKET_TYPE_ACK, 0xF2), (p.packet_type, p.sequence_number))

    def test_decodes_nack_captured_from_mi_band_10(self):
        p = S.PacketV2.decode(bytes([0xA5, 0xA5, 0x00, 0xF6, 0, 0, 0, 0]))
        self.assertEqual((S.PACKET_TYPE_NACK, 0xF6), (p.packet_type, p.sequence_number))

    def test_rejects_short_buffer(self):
        self.assertIsNone(S.PacketV2.decode(bytes([0xA5, 0xA5, 0x01])))

    def test_rejects_truncated_payload(self):
        self.assertIsNone(S.PacketV2.decode(bytes([0xA5, 0xA5, S.PACKET_TYPE_DATA, 1, 6, 0, 0, 0])))

    def test_rejects_checksum_mismatch(self):
        self.assertIsNone(S.PacketV2.decode(bytes([0xA5, 0xA5, S.PACKET_TYPE_DATA, 1, 2, 0, 0xFF, 0xFF, 1, 2])))

    def test_crc16_arc_check_value(self):
        self.assertEqual(0xBB3D, S.crc16_arc(b"123456789"))
        self.assertEqual(0, S.crc16_arc(b""))

    def test_frame_round_trip(self):
        frame = S.encode_frame_v2(S.PACKET_TYPE_DATA, 7, bytes([1, 1]) + b"abc")
        p = S.PacketV2.decode(frame)
        self.assertEqual((S.Channel.ProtobufCommand, 1, b"abc", 7), (p.channel, p.opcode, p.payload, p.sequence_number))

    def test_session_config_payload_matches_the_official_app(self):
        payload = S.PacketV2.session_config(S.SESSION_OP_START_REQUEST).payload_bytes(None)
        self.assertEqual("0101030001000002020000fc03020020000402001027", payload.hex())
        decoded = S.PacketV2.decode(S.PacketV2.session_config(S.SESSION_OP_START_RESPONSE, 0).encode(None))
        self.assertEqual({"version": "010000", "max_packet_size": 0xFC00, "tx_win": 32, "send_timeout_ms": 10000},
                         decoded.config)


class SppPacketV1Test(unittest.TestCase):
    def test_version_request_bytes(self):
        pkt = S.PacketV1.build(S.Channel.Version, needs_response=True, opcode=S.OPCODE_READ,
                               data_type=S.DATA_TYPE_PLAIN, frame_serial=0)
        self.assertEqual("badcfe00c00300000000ef", pkt.encode(None, None).hex())

    def test_round_trip(self):
        pkt = S.PacketV1.build(S.Channel.Activity, opcode=S.OPCODE_SEND, frame_serial=9,
                               data_type=S.DATA_TYPE_PLAIN, payload=b"\x01\x02\x03")
        dec = S.PacketV1.decode(pkt.encode(None, None))
        self.assertEqual((S.Channel.Activity, 9, b"\x01\x02\x03"), (dec.channel, dec.frame_serial, dec.payload))

    def test_rejects_bad_preamble_and_epilogue(self):
        good = S.PacketV1.build(S.Channel.Version, opcode=0, frame_serial=0, data_type=0).encode(None, None)
        self.assertIsNone(S.PacketV1.decode(b"\x00" + good[1:]))
        self.assertIsNone(S.PacketV1.decode(good[:-1] + b"\x00"))

    def test_encrypted_protobuf_gets_a_counter_prefix(self):
        a = A.AuthService(bytes(16))
        a.encryption_key, a.encryption_nonce = bytes(range(16)), bytes(4)
        ctr = S.Counter()
        pkt = S.PacketV1.build(S.Channel.ProtobufCommand, opcode=S.OPCODE_SEND, frame_serial=0,
                               data_type=S.DATA_TYPE_ENCRYPTED, payload=b"abc")
        frame = pkt.encode(a, ctr)
        payload = S.PacketV1.decode(frame).payload
        self.assertEqual(1, struct.unpack("<H", payload[:2])[0])
        self.assertEqual(b"abc", A.ccm_decrypt(a.encryption_key, a.encryption_nonce + struct.pack("<II", 0, 1), payload[2:]))
        self.assertEqual(1, ctr.value)


class SendWindowTest(unittest.TestCase):
    """XiaomiSppV2SendWindowTest"""

    @staticmethod
    def send(w, n):
        for _ in range(n):
            s = w.next_sequence_number()
            w.on_sent(s, bytes([s]))

    def test_ack_is_cumulative(self):
        w = S.SendWindow()
        self.send(w, 5)
        self.assertEqual(3, w.on_ack(2))
        self.assertEqual(3, w.oldest_unacked())
        self.assertEqual(2, len(w.unacked_frames()))

    def test_ignores_an_ack_for_no_unacked_frame(self):
        w = S.SendWindow()
        self.send(w, 5)
        w.on_ack(2)
        self.assertEqual(0, w.on_ack(1))
        self.assertEqual(0, w.on_ack(9))
        self.assertEqual(3, w.oldest_unacked())

    def test_sequence_numbers_wrap(self):
        w = S.SendWindow()
        self.send(w, 254)
        w.on_ack(253)
        self.send(w, 4)
        self.assertEqual(254, w.oldest_unacked())
        self.assertEqual(3, w.on_ack(0))
        self.assertEqual(1, w.oldest_unacked())
        self.assertEqual(2, w.next_sequence_number())

    def test_forgets_the_oldest_frames_past_the_limit(self):
        w = S.SendWindow()
        self.send(w, S.SendWindow.MAX_TRACKED_FRAMES + 2)
        self.assertEqual(2, w.oldest_unacked())
        self.assertEqual(S.SendWindow.MAX_TRACKED_FRAMES, len(w.unacked_frames()))

    def test_clear_restarts_the_sequence(self):
        w = S.SendWindow()
        self.send(w, 3)
        w.clear()
        self.assertTrue(w.is_empty())
        self.assertEqual(-1, w.oldest_unacked())
        self.assertEqual(0, w.next_sequence_number())


class FakeLink:
    def __init__(self):
        self.written, self.packets, self.dropped, self.handshakes = [], [], [], 0
        self.timers = FakeTimers()
        self.auth = A.AuthService(bytes(16))

    def write_frame(self, f): self.written.append(f)
    def on_packet_received(self, ch, payload): self.packets.append((ch, payload))
    def start_encrypted_handshake(self): self.handshakes += 1
    def drop_connection(self, reason): self.dropped.append(reason)
    def tap(self, d, i, f): pass


class SppProtocolV2Test(unittest.TestCase):
    """XiaomiSppProtocolV2Test (resend / timeout behaviour)"""

    def setUp(self):
        self.link = FakeLink()
        self.proto = S.SppProtocolV2(self.link)

    def send_packets(self, n):
        for i in range(n):
            self.proto.write_packet(S.Channel.Data, bytes([i]))
        frames = list(self.link.written)
        self.link.written.clear()
        return frames

    def receive(self, hexstr):
        buf = bytes.fromhex(hexstr)
        while buf:
            r = self.proto.process_packet(buf)
            self.assertEqual(S.ParseStatus.COMPLETE, r.status)
            buf = buf[r.packet_size:]

    def test_resends_from_the_packet_the_watch_expects_after_a_nack(self):
        sent = self.send_packets(21)
        # Redmi Watch 6 log from #6888: acks 8 and 9, then type 0 for 17.
        self.receive("A5A5010800000000A5A5010900000000A5A5001100000000")
        self.assertEqual(sent[17:21], self.link.written)
        self.link.written.clear()
        # Then ack 17 and type 0 for 18: everything from 18 on is resent, 17 is not.
        self.receive("A5A5011100000000A5A5001200000000")
        self.assertEqual(sent[18:21], self.link.written)

    def test_ignores_a_nack_for_a_packet_not_pending(self):
        self.send_packets(3)
        self.receive("A5A5000300000000")
        self.assertTrue(self.link.written == [])

    def test_takes_the_sequence_number_when_the_packet_is_written(self):
        frames = self.send_packets(3)
        self.assertEqual([0, 1, 2], [f[3] for f in frames])

    def test_resends_on_timeout_and_drops_the_connection_when_nothing_is_acked(self):
        sent = self.send_packets(2)
        self.link.timers.advance(10.1)
        self.assertEqual(sent, self.link.written)
        self.assertEqual([], self.link.dropped)
        self.link.written.clear()
        self.link.timers.advance(10.1)
        self.assertEqual(sent, self.link.written)
        self.link.timers.advance(10.1)
        self.assertEqual(1, len(self.link.dropped))

    def test_an_ack_restarts_the_timeout_count(self):
        self.send_packets(2)
        self.link.timers.advance(10.1)
        self.link.timers.advance(10.1)
        self.receive("A5A5010000000000")  # ack 0
        self.link.timers.advance(10.1)
        self.link.timers.advance(10.1)
        self.assertEqual([], self.link.dropped)

    def test_stays_quiet_once_everything_is_acked(self):
        self.send_packets(2)
        self.receive("A5A5010100000000")
        self.link.written.clear()
        self.link.timers.advance(60)
        self.assertEqual([], self.link.written)
        self.assertEqual([], self.link.dropped)

    def test_acks_every_data_packet_it_receives(self):
        frame = S.encode_frame_v2(S.PACKET_TYPE_DATA, 5, bytes([2, S.V2_OPCODE_SEND_PLAINTEXT]) + b"hi")
        r = self.proto.process_packet(frame)
        self.assertEqual(len(frame), r.packet_size)
        self.assertEqual([(S.Channel.Data, b"hi")], self.link.packets)
        self.assertEqual(S.PacketV2.ack(5).encode(None), self.link.written[0])

    def test_partial_and_garbage_input(self):
        self.assertEqual(S.ParseStatus.INCOMPLETE, self.proto.process_packet(b"\xa5\xa5\x03").status)
        self.assertEqual(S.ParseStatus.INVALID, self.proto.process_packet(b"\x00" * 10).status)
        self.assertEqual(3, self.proto.find_next_packet_offset(b"\x00\x01\x02\xa5\xa5"))


class WatchSimulator:
    """The watch's side of version negotiation, SPP V2 session config and the auth handshake."""

    def __init__(self, secret, version=2):
        self.secret, self.version = secret, version
        self.buf = bytearray()
        self.out = []          # frames to the phone
        self.seq = 0
        self.phone_nonce = None
        self.keys = None       # (watch_dec, watch_enc, watch_dec_nonce, watch_enc_nonce)
        self.rx_cmds = []
        self.expect_session = False

    def feed(self, data):
        self.buf.extend(data)
        while True:
            if not self.buf:
                return
            if self.buf[:3] == S.V1_PREAMBLE:
                size = struct.unpack_from("<H", self.buf, 5)[0] + 8 if len(self.buf) >= 7 else 1 << 30
                if len(self.buf) < size:
                    return
                pkt = S.PacketV1.decode(bytes(self.buf[:size]))
                del self.buf[:size]
                if pkt.channel == S.Channel.Version:
                    reply = S.PacketV1.build(S.Channel.Version, opcode=2, frame_serial=0, data_type=S.DATA_TYPE_PLAIN,
                                             payload=bytes([self.version, 0, 0]))
                    self.out.append(reply.encode(None, None))
            elif self.buf[:2] == S.V2_PREAMBLE:
                if len(self.buf) < 8:
                    return
                size = struct.unpack_from("<H", self.buf, 4)[0] + 8
                if len(self.buf) < size:
                    return
                pkt = S.PacketV2.decode(bytes(self.buf[:size]))
                del self.buf[:size]
                self.on_v2(pkt)
            else:
                raise AssertionError(f"watch got garbage {bytes(self.buf).hex()}")

    def send_data(self, cmd_bytes, encrypted):
        if encrypted:
            body = A.ctr_crypt(self.keys[1], self.keys[1], cmd_bytes)
            payload = bytes([1, S.V2_OPCODE_SEND_ENCRYPTED]) + body
        else:
            payload = bytes([1, S.V2_OPCODE_SEND_PLAINTEXT]) + cmd_bytes
        self.out.append(S.encode_frame_v2(S.PACKET_TYPE_DATA, self.seq, payload))
        self.seq += 1

    def on_v2(self, pkt):
        if pkt.packet_type == S.PACKET_TYPE_SESSION_CONFIG:
            self.out.append(S.PacketV2.session_config(S.SESSION_OP_START_RESPONSE, 0).encode(None))
            return
        if pkt.packet_type != S.PACKET_TYPE_DATA:
            return
        self.out.append(S.PacketV2.ack(pkt.sequence_number).encode(None))
        if pkt.opcode == S.V2_OPCODE_SEND_ENCRYPTED:
            plain = A.ctr_crypt(self.keys[0], self.keys[0], pkt.payload)
        else:
            plain = pkt.payload
        cmd = xiaomi_pb2.Command.FromString(plain)
        self.rx_cmds.append(cmd)
        if cmd.type == 1 and cmd.subtype == A.CMD_NONCE:
            self.phone_nonce = bytes(cmd.auth.appVerify.nonce)
            watch_nonce = bytes(range(100, 116))
            k = A.compute_auth_step3_hmac(self.secret, self.phone_nonce, watch_nonce)
            # phone's decryption side is the watch's encryption side
            self.keys = (k[16:32], k[0:16], k[36:40], k[32:36])
            reply = xiaomi_pb2.Command(type=1, subtype=A.CMD_NONCE)
            reply.auth.deviceVerify.nonce = watch_nonce
            reply.auth.deviceVerify.hmac = A.hmac_sha256(k[0:16], watch_nonce + self.phone_nonce)
            self.watch_nonce = watch_nonce
            self.send_data(reply.SerializeToString(), False)
        elif cmd.type == 1 and cmd.subtype == A.CMD_AUTH:
            confirm = cmd.auth.appConfirm
            assert bytes(confirm.encryptedNonces) == A.hmac_sha256(self.keys[0], self.phone_nonce + self.watch_nonce)
            info = A.ccm_decrypt(self.keys[0], self.keys[2] + bytes(8), bytes(confirm.encryptedDeviceInfo))
            self.device_info = wear_account_pb2.CompanionDevice.FromString(info)
            reply = xiaomi_pb2.Command(type=1, subtype=A.CMD_AUTH)
            self.send_data(reply.SerializeToString(), False)
        elif cmd.type == 2 and cmd.subtype == 2:
            reply = xiaomi_pb2.Command(type=2, subtype=2)
            reply.system.deviceInfo.serialNumber = "SN1"
            reply.system.deviceInfo.firmware = "1.2.3"
            reply.system.deviceInfo.model = "Watch S5"
            self.send_data(reply.SerializeToString(), True)


class SessionHandshakeTest(unittest.TestCase):
    def run_session(self, secret_watch, secret_phone, version=2):
        timers = FakeTimers()
        watch = WatchSimulator(secret_watch, version)
        phone_auth = A.AuthService(secret_phone, nonce=NONCE)
        events = {"cmds": [], "handshake": None, "step": []}

        def write(frame):
            watch.feed(frame)

        sess = None

        def deliver():
            while watch.out:
                sess.on_socket_read(watch.out.pop(0))

        def on_cmd(b):
            cmd = xiaomi_pb2.Command.FromString(b)
            events["cmds"].append(cmd)
            if cmd.type == 1 and cmd.subtype == A.CMD_NONCE:
                reply = phone_auth.handle_watch_nonce(cmd.auth.deviceVerify)
                events["step"].append(reply is not None)
                if reply is not None:
                    sess.send_command_bytes(1, reply.SerializeToString())
            elif cmd.type == 1 and cmd.subtype == A.CMD_AUTH:
                events["step"].append(phone_auth.on_auth_response(cmd))

        def handshake():
            events["handshake"] = True
            sess.send_command_bytes(1, phone_auth.start_encrypted_handshake().SerializeToString())

        sess = S.SppSession(phone_auth, write, timers, on_command_bytes=on_cmd, on_handshake=handshake)
        sess.start()
        for _ in range(10):
            deliver()
        return sess, watch, phone_auth, events, timers, deliver

    def test_v2_full_handshake_and_encrypted_command(self):
        secret = bytes(range(16))
        sess, watch, auth, ev, timers, deliver = self.run_session(secret, secret)
        self.assertEqual("V2", sess.protocol_name)
        self.assertEqual([True, True], ev["step"])
        self.assertTrue(auth.encryption_initialized)
        self.assertEqual(224, watch.device_info.unknown3)
        # now an encrypted exchange
        sess.send_command_bytes(2, xiaomi_pb2.Command(type=2, subtype=2).SerializeToString())
        for _ in range(5):
            deliver()
        reply = ev["cmds"][-1]
        self.assertEqual(("Watch S5", "1.2.3"), (reply.system.deviceInfo.model, reply.system.deviceInfo.firmware))
        self.assertEqual(S.SendWindow.MAX_TRACKED_FRAMES >= 1, True)

    def test_wrong_key_is_detected(self):
        sess, watch, auth, ev, timers, deliver = self.run_session(bytes(range(16)), bytes(range(1, 17)))
        self.assertEqual([False], ev["step"])
        self.assertFalse(auth.encryption_initialized)

    def test_silent_watch_falls_back_to_v1_after_five_seconds(self):
        timers = FakeTimers()
        auth = A.AuthService(bytes(16))
        got = {"hs": 0}
        sent = []
        sess = S.SppSession(auth, sent.append, timers, on_command_bytes=lambda b: None,
                            on_handshake=lambda: got.__setitem__("hs", got["hs"] + 1))
        sess.start()
        self.assertEqual("badcfe00c00300000000ef", sent[0].hex())
        timers.advance(4.9)
        self.assertEqual(0, got["hs"])
        timers.advance(0.2)
        self.assertEqual((1, "V1"), (got["hs"], sess.protocol_name))

    def test_garbage_in_the_stream_is_skipped(self):
        timers = FakeTimers()
        got = []
        sess = S.SppSession(A.AuthService(bytes(16)), lambda f: None, timers, on_command_bytes=got.append,
                            on_handshake=lambda: None)
        sess.protocol = S.SppProtocolV2(sess)
        good = S.encode_frame_v2(S.PACKET_TYPE_DATA, 0, bytes([1, 1]) + b"\x08\x07")
        sess.on_socket_read(b"\x00\x01\x02" + good[:5])
        sess.on_socket_read(good[5:])
        self.assertEqual([b"\x08\x07"], got)


class WeatherTest(unittest.TestCase):
    def test_owm_to_xiaomi_matches_gadgetbridge(self):
        cases = {800: 0, 801: 1, 803: 1, 804: 2, 200: 4, 232: 4, 300: 7, 321: 7, 500: 7, 501: 8, 502: 10, 503: 11,
                 504: 12, 511: 19, 520: 3, 522: 9, 600: 14, 601: 15, 602: 16, 611: 6, 616: 13, 622: 17, 701: 18,
                 741: 18, 751: 20, 761: 29, 781: 30, 906: 5, 957: 30, 951: 0, 999: 0}
        for owm, want in cases.items():
            self.assertEqual(want, W.owm_to_xiaomi(owm), owm)

    def test_wmo_mapping(self):
        cases = {0: 0, 1: 1, 2: 1, 3: 2, 45: 18, 51: 7, 55: 7, 61: 7, 63: 8, 65: 10, 66: 19, 71: 14, 73: 15,
                 75: 16, 80: 3, 82: 9, 85: 16, 86: 17, 95: 4, 99: 4, 1234: 0}
        for wmo, want in cases.items():
            self.assertEqual(want, W.wmo_to_xiaomi(wmo), wmo)
        for c in range(0, 100):
            self.assertLessEqual(W.wmo_to_xiaomi(c), 33)  # S1 Active crashes on icons above 33

    def test_beaufort(self):
        self.assertEqual([0, 1, 1, 2, 3, 12], [W.to_beaufort(s) for s in (0, 2.5, 6, 6.1, 20, 200)])

    def test_java_hash_and_location_key(self):
        self.assertEqual(0, W.java_string_hash(""))
        self.assertEqual(69609650, W.java_string_hash("Hello"))
        self.assertEqual(1794106052, W.java_string_hash("hello world"))
        self.assertEqual("accu:106052", W.location_key("hello world"))
        self.assertLess(W.java_string_hash("polygenelubricants"), 0)  # Integer.MIN_VALUE case
        self.assertEqual("accu:-483648", W.location_key("polygenelubricants"))

    def test_commands_encode_and_roundtrip(self):
        from lab import _SAMPLE_METEO
        r = W.parse_open_meteo(_SAMPLE_METEO, "Test", now=_SAMPLE_METEO["current"]["time"])
        self.assertEqual(23, len(r.hourly[:23]))
        cur = W.build_current(r).weather.current
        self.assertEqual((7, 12, 71, 3), (cur.weatherCondition, cur.temperature.value, cur.humidity.value, cur.wind.value))
        self.assertEqual("230", cur.wind.unit)
        self.assertAlmostEqual(100800.0, cur.pressure)
        daily = W.build_daily(r).weather.forecast.entries.entry
        self.assertEqual(7, len(daily))                     # today + 6
        self.assertEqual((13, 8), (getattr(daily[0].temperatureRange, "from"), daily[0].temperatureRange.to))
        hourly = W.build_hourly(r).weather.forecast.entries.entry
        self.assertEqual(23, len(hourly))
        self.assertEqual(0, getattr(hourly[0].conditionRange, "from"))
        for c in W.build_all(r):
            self.assertEqual(c, xiaomi_pb2.Command.FromString(c.SerializeToString()))


class SdpTest(unittest.TestCase):
    def test_rfcomm_channel_from_protocol_descriptor_list(self):
        # SEQ{ SEQ{UUID16 0x0100 (L2CAP)}, SEQ{UUID16 0x0003 (RFCOMM), UINT8 5} }
        data = bytes.fromhex("350c35031901003505190003" + "0805")
        self.assertEqual(5, T.rfcomm_channel_from_protocol_descriptor_list(data))

    def test_returns_none_when_absent_or_garbage(self):
        self.assertIsNone(T.rfcomm_channel_from_protocol_descriptor_list(bytes.fromhex("35053503190100")))
        self.assertIsNone(T.rfcomm_channel_from_protocol_descriptor_list(b"\x35"))

    def test_watch_name_filter(self):
        for n in ("Xiaomi Watch S5 1A2B", "xiaomi watch s5", "Xiaomi Watch S5"):
            self.assertTrue(T.WATCH_NAME_RE.search(n), n)
        self.assertFalse(T.WATCH_NAME_RE.search("Xiaomi Smart Band 9"))


def make_file(payload=b"\x01\x02\x03\x04\x05\x06"):
    body = bytes([0x10, 0x20, 0x30, 0x40, 0x01, 0x00, 0x00, 0x00]) + payload
    return body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)


class ActivityChunkTest(unittest.TestCase):
    def test_chunks_reassemble_and_validate(self):
        data = make_file(b"x" * 100)
        a = F.ChunkAssembler()
        parts = [data[i:i + 40] for i in range(0, len(data), 40)]
        out = None
        for n, p in enumerate(parts, 1):
            out = a.add(struct.pack("<HH", len(parts), n) + p)
            if n < len(parts):
                self.assertIsNone(out)
        self.assertEqual(data, out)
        self.assertEqual((True, ""), F.validate_file(out))

    def test_num_one_restarts_the_buffer(self):
        a = F.ChunkAssembler()
        a.add(struct.pack("<HH", 2, 1) + b"junk")
        self.assertEqual(b"ab", a.add(struct.pack("<HH", 1, 1) + b"ab"))

    def test_corrupt_files_are_rejected(self):
        data = bytearray(make_file())
        data[9] ^= 0xFF
        ok, why = F.validate_file(bytes(data))
        self.assertFalse(ok)
        self.assertIn("crc", why)
        self.assertFalse(F.validate_file(b"\x00" * 12)[0])

    def test_unexpected_byte_7_is_noted_not_fatal(self):
        body = bytes([1, 2, 3, 4, 5, 6, 7, 9, 1, 2])
        data = body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)
        ok, note = F.validate_file(data)
        self.assertTrue(ok)
        self.assertIn("0x09", note)

    def test_fetch_order(self):
        from collections import namedtuple
        Fid = namedtuple("Fid", "timestamp timezone type subtype detail_type version")
        ids = [Fid(5, 0, 1, 1, 2, 1), Fid(5, 0, 1, 1, 0, 1), Fid(5, 0, 1, 1, 1, 1), Fid(4, 0, 1, 1, 2, 1)]
        order = [i.detail_type for i in sorted(ids, key=F.sort_key)]
        self.assertEqual([2, 1, 0, 2], order)  # oldest first; summary(1) < details(0) < gps(2)


class CommandBuilderTest(unittest.TestCase):
    def test_find_watch_and_phone_events(self):
        self.assertEqual("0802101222022800", C.build_find_watch(True).SerializeToString().hex())
        start = xiaomi_pb2.Command(type=2, subtype=17)
        start.system.findDevice = 0
        stop = xiaomi_pb2.Command(type=2, subtype=17)
        stop.system.findDevice = 1
        self.assertEqual(("start", "stop", None), (C.find_phone_event(start), C.find_phone_event(stop),
                                                  C.find_phone_event(xiaomi_pb2.Command(type=2, subtype=3))))

    def test_hr_set_preserves_other_fields(self):
        from watchlab.proto.xiaomi import wear_fitness_pb2 as fit
        cur = fit.HeartRate(disabled=True, interval=10, alarmHighEnabled=True, alarmHighThreshold=120, unknown7=1)
        out = C.build_hr_set(cur, interval_minutes=1).health.heartRate
        self.assertEqual((1, False, True, 120, 1), (out.interval, out.disabled, out.alarmHighEnabled,
                                                    out.alarmHighThreshold, out.unknown7))

    def test_call_and_notification_fields(self):
        n = C.build_notification("T", "").notification.notification2.notification3
        self.assertTrue(n.HasField("body"))  # the watch shows nothing without a body
        call = C.build_incoming_call("Mum").notification.notification2.notification3
        self.assertEqual((True, "phone", "Mum", "?"), (call.isCall, call.package, call.title, call.body))


if __name__ == "__main__":
    unittest.main()
