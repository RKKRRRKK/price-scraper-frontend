package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.proto.xiaomi.Account
import app.kumquant.healthbridge.proto.xiaomi.Auth
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.proto.xiaomi.XiaomiSystem
import app.kumquant.healthbridge.watch.auth.AuthService
import app.kumquant.healthbridge.watch.auth.CompanionInfo
import app.kumquant.healthbridge.watch.auth.XiaomiAuth
import app.kumquant.healthbridge.watch.crypto.AesCcm
import app.kumquant.healthbridge.watch.services.SystemService
import app.kumquant.healthbridge.watch.transport.Channel
import app.kumquant.healthbridge.watch.transport.SppPacketV1
import app.kumquant.healthbridge.watch.transport.SppPacketV2
import app.kumquant.healthbridge.watch.transport.SppTransport
import com.google.protobuf.ByteString
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A byte pipe with blocking reads, closable from either end. */
private class Pipe {
    private val queue = LinkedBlockingQueue<ByteArray>()
    private val eof = ByteArray(0)
    private var current = ByteArray(0)
    private var pos = 0

    @Volatile
    var closed = false

    val input = object : InputStream() {
        override fun read(): Int = throw UnsupportedOperationException()
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            while (pos >= current.size) {
                if (closed && queue.isEmpty()) return -1
                val next = queue.poll(50, TimeUnit.MILLISECONDS) ?: continue
                if (next === eof) return -1
                current = next
                pos = 0
            }
            val n = minOf(len, current.size - pos)
            System.arraycopy(current, pos, b, off, n)
            pos += n
            return n
        }

        override fun close() {
            closed = true
        }
    }
    val output = object : OutputStream() {
        override fun write(b: Int) = throw UnsupportedOperationException()
        override fun write(b: ByteArray, off: Int, len: Int) {
            if (closed) throw IOException("pipe closed")
            queue.add(b.copyOfRange(off, off + len))
        }

        override fun close() {
            queue.add(eof)
        }
    }

    fun readExactly(n: Int, timeoutMs: Long = 5000): ByteArray {
        val out = ByteArray(n)
        var got = 0
        val end = System.currentTimeMillis() + timeoutMs
        while (got < n) {
            check(System.currentTimeMillis() < end) { "timed out waiting for $n bytes (got $got)" }
            val r = input.read(out, got, n - got)
            check(r >= 0) { "pipe closed" }
            got += r
        }
        return out
    }
}

/**
 * Runs the real transport, auth service and system service against a scripted watch that
 * derives the same keys from the shared auth key: the full connection sequence for SPP v1 and v2.
 */
class HandshakeEndToEndTest {
    private val key = "000102030405060708090a0b0c0d0e0f".hexToBytes()
    private val watchNonce = ByteArray(16) { (0x80 + it).toByte() }

    private val toWatch = Pipe()
    private val toPhone = Pipe()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @After
    fun tearDown() {
        scope.cancel()
        toWatch.closed = true
        toPhone.closed = true
    }

    private class Keys(secret: ByteArray, phoneNonce: ByteArray, watchNonce: ByteArray) {
        private val k = XiaomiAuth.computeAuthStep3Hmac(secret, phoneNonce, watchNonce)
        val phoneDecKey = k.copyOfRange(0, 16) // the watch encrypts with this
        val phoneEncKey = k.copyOfRange(16, 32) // the watch decrypts with this
        val phoneDecNonce = k.copyOfRange(32, 36)
        val phoneEncNonce = k.copyOfRange(36, 40)
    }

    private fun ctr(key: ByteArray, data: ByteArray): ByteArray =
        Cipher.getInstance("AES/CTR/NoPadding").also { it.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(key)) }.doFinal(data)

    private fun readV1(): SppPacketV1 {
        val head = toWatch.readExactly(7)
        val len = ByteBuffer.wrap(head, 5, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
        return SppPacketV1.decode(head + toWatch.readExactly(len + 8 - 7))!!
    }

    private fun readV2(): SppPacketV2 {
        val head = toWatch.readExactly(8)
        val len = ByteBuffer.wrap(head, 4, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
        return SppPacketV2.decode(head + toWatch.readExactly(len))!!
    }

    /** The next data packet; the phone's acks for the watch's own packets are skipped. */
    private fun readV2Data(): SppPacketV2.Data {
        while (true) {
            val p = readV2()
            if (p is SppPacketV2.Data) return p
            assertTrue("unexpected $p", p is SppPacketV2.Ack)
        }
    }

    /** Frames [payload] as given, with no encryption, so tests control the bytes. */
    private fun writeV1(channel: Channel, dataType: Int, payload: ByteArray) {
        val frame = ByteBuffer.allocate(11 + payload.size).order(ByteOrder.LITTLE_ENDIAN)
            .put(SppPacketV1.PREAMBLE)
            .put(SppPacketV1.getRawChannel(channel, tx = false).toByte())
            .put(0x80.toByte())
            .putShort((payload.size + 3).toShort())
            .put(SppPacketV1.OPCODE_SEND.toByte()).put(0).put(dataType.toByte())
            .put(payload)
            .put(SppPacketV1.EPILOGUE)
            .array()
        toPhone.output.write(frame)
    }

    private fun writeV2Data(seq: Int, opCode: Int, payload: ByteArray) {
        val body = byteArrayOf(1, opCode.toByte()) + payload
        toPhone.output.write(SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_DATA, seq, body))
    }

    private fun deviceInfoCommand() = XiaomiProto.Command.newBuilder()
        .setType(SystemService.COMMAND_TYPE).setSubtype(SystemService.CMD_DEVICE_INFO)
        .setSystem(XiaomiSystem.System.newBuilder().setDeviceInfo(
            XiaomiSystem.DeviceInfo.newBuilder().setSerialNumber("SN123").setFirmware("1.2.3").setModel("o66")))
        .build()

    @Test
    fun connectsOverSppV1() = runScenario(version = 1)

    @Test
    fun connectsOverSppV2() = runScenario(version = 2)

    private fun runScenario(version: Int) {
        val auth = XiaomiAuth(key, CompanionInfo(35, "Test", "EN"))
        val transport = SppTransport(toPhone.input, toWatch.output, auth, scope, resendTimeoutMs = 5000, versionTimeoutMs = 3000)
        val info = MutableStateFlow(WatchInfo())
        lateinit var session: CommandSession
        session = CommandSession(transport) { block -> scope.launch { block() } }
        val authService = AuthService(session, auth)
        session.register(authService)
        session.register(SystemService(session, info, object : WatchListener {}))
        transport.onPayload = { ch, payload -> if (ch == Channel.ProtobufCommand) session.handleCommandBytes(payload) }
        transport.onHandshakeReady = { authService.start() }

        val watchError = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val watch = Thread {
            try {
                if (version == 1) watchV1() else watchV2()
            } catch (t: Throwable) {
                watchError.set(t)
            }
        }
        watch.isDaemon = true
        watch.start()

        transport.start()
        runBlocking {
            withTimeout(10_000) { authService.result.await() }
            assertTrue(auth.encryptionInitialized)
            assertEquals(version, transport.protocolVersion)
            val reply = session.request(SystemService.COMMAND_TYPE, SystemService.CMD_DEVICE_INFO, 5000)
            assertEquals("SN123", reply.system.deviceInfo.serialNumber)
        }
        watch.join(5000)
        watchError.get()?.let { throw AssertionError("scripted watch failed", it) }
        val end = System.currentTimeMillis() + 2000
        while (info.value.serial == null && System.currentTimeMillis() < end) Thread.sleep(10)
        assertEquals(WatchInfo(model = "o66", firmware = "1.2.3", serial = "SN123"), info.value)
    }

    private fun watchV1() {
        val version = readV1()
        assertEquals(Channel.Version, version.channel)
        assertEquals(SppPacketV1.OPCODE_READ, version.opCode)
        writeV1(Channel.Version, SppPacketV1.DATA_TYPE_PLAIN, byteArrayOf(1))

        val step1 = XiaomiProto.Command.parseFrom(readV1().also { assertEquals(SppPacketV1.DATA_TYPE_AUTH, it.dataType) }.payload)
        val phoneNonce = step1.auth.appVerify.nonce.toByteArray()
        val keys = Keys(key, phoneNonce, watchNonce)
        writeV1(Channel.ProtobufCommand, SppPacketV1.DATA_TYPE_AUTH, nonceReply(keys, phoneNonce).toByteArray())

        val step2 = XiaomiProto.Command.parseFrom(readV1().payload)
        verifyConfirm(step2, keys, phoneNonce)
        writeV1(Channel.ProtobufCommand, SppPacketV1.DATA_TYPE_AUTH, authDone().toByteArray())

        // phone request: le16 counter, then CCM under the phone's encryption key
        val request = readV1()
        assertEquals(SppPacketV1.DATA_TYPE_ENCRYPTED, request.dataType)
        val counter = ByteBuffer.wrap(request.payload, 0, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt()
        val nonce = keys.phoneEncNonce + ByteArray(4) + ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(counter).array()
        val plain = AesCcm(keys.phoneEncKey).decrypt(nonce, request.payload.copyOfRange(2, request.payload.size))
        assertEquals(SystemService.CMD_DEVICE_INFO, XiaomiProto.Command.parseFrom(plain).subtype)

        val replyNonce = keys.phoneDecNonce + ByteArray(8)
        writeV1(Channel.ProtobufCommand, SppPacketV1.DATA_TYPE_ENCRYPTED, AesCcm(keys.phoneDecKey).encrypt(replyNonce, deviceInfoCommand().toByteArray()))
    }

    private fun watchV2() {
        val version = readV1Compat()
        assertEquals(Channel.Version, version.channel)
        writeV1(Channel.Version, SppPacketV1.DATA_TYPE_PLAIN, byteArrayOf(2))

        val session = readV2() as SppPacketV2.SessionConfig
        assertEquals(SppPacketV2.OPCODE_START_SESSION_REQUEST, session.opCode)
        toPhone.output.write(SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_SESSION_CONFIG, 0, SppPacketV2.sessionConfigPayload(SppPacketV2.OPCODE_START_SESSION_RESPONSE)))

        val step1Frame = readV2Data()
        assertEquals(SppPacketV2.OPCODE_SEND_PLAINTEXT, step1Frame.opCode)
        val step1 = XiaomiProto.Command.parseFrom(step1Frame.payload)
        val phoneNonce = step1.auth.appVerify.nonce.toByteArray()
        val keys = Keys(key, phoneNonce, watchNonce)
        writeV2Data(0, SppPacketV2.OPCODE_SEND_PLAINTEXT, nonceReply(keys, phoneNonce).toByteArray())

        val step2 = XiaomiProto.Command.parseFrom((readV2Data()).payload)
        verifyConfirm(step2, keys, phoneNonce)
        writeV2Data(1, SppPacketV2.OPCODE_SEND_PLAINTEXT, authDone().toByteArray())

        val request = readV2Data()
        assertEquals(SppPacketV2.OPCODE_SEND_ENCRYPTED, request.opCode)
        assertEquals(SystemService.CMD_DEVICE_INFO, XiaomiProto.Command.parseFrom(ctr(keys.phoneEncKey, request.payload)).subtype)
        writeV2Data(2, SppPacketV2.OPCODE_SEND_ENCRYPTED, ctr(keys.phoneDecKey, deviceInfoCommand().toByteArray()))
    }

    /** The phone's first frame is a v1 version read even when the watch speaks v2. */
    private fun readV1Compat() = readV1()

    private fun nonceReply(keys: Keys, phoneNonce: ByteArray) = XiaomiProto.Command.newBuilder()
        .setType(XiaomiAuth.COMMAND_TYPE).setSubtype(XiaomiAuth.CMD_NONCE)
        .setAuth(Account.newBuilder().setDeviceVerify(
            Auth.DeviceVerify.newBuilder()
                .setNonce(ByteString.copyFrom(watchNonce))
                .setHmac(ByteString.copyFrom(XiaomiAuth.hmacSha256(keys.phoneDecKey, watchNonce + phoneNonce)))))
        .build()

    private fun verifyConfirm(step2: XiaomiProto.Command, keys: Keys, phoneNonce: ByteArray) {
        assertEquals(XiaomiAuth.CMD_AUTH, step2.subtype)
        val confirm = step2.auth.appConfirm
        assertArrayEquals(XiaomiAuth.hmacSha256(keys.phoneEncKey, phoneNonce + watchNonce), confirm.encryptedNonces.toByteArray())
        val nonce = keys.phoneEncNonce + ByteArray(8)
        AesCcm(keys.phoneEncKey).decrypt(nonce, confirm.encryptedDeviceInfo.toByteArray()) // throws if the tag is wrong
    }

    private fun authDone() = XiaomiProto.Command.newBuilder()
        .setType(XiaomiAuth.COMMAND_TYPE).setSubtype(XiaomiAuth.CMD_AUTH)
        .setAuth(Account.newBuilder().setStatus(1))
        .build()

    @Test
    fun aWatchWithADifferentKeyFailsTheHandshake() {
        val auth = XiaomiAuth(key, CompanionInfo(35, "Test", "EN"))
        val transport = SppTransport(toPhone.input, toWatch.output, auth, scope, versionTimeoutMs = 3000)
        val session = CommandSession(transport) { block -> scope.launch { block() } }
        val authService = AuthService(session, auth)
        session.register(authService)
        transport.onPayload = { ch, payload -> if (ch == Channel.ProtobufCommand) session.handleCommandBytes(payload) }
        transport.onHandshakeReady = { authService.start() }

        val watch = Thread {
            readV1()
            writeV1(Channel.Version, SppPacketV1.DATA_TYPE_PLAIN, byteArrayOf(1))
            val step1 = XiaomiProto.Command.parseFrom(readV1().payload)
            val phoneNonce = step1.auth.appVerify.nonce.toByteArray()
            val otherKeys = Keys(ByteArray(16) { 0x77 }, phoneNonce, watchNonce)
            writeV1(Channel.ProtobufCommand, SppPacketV1.DATA_TYPE_AUTH, nonceReply(otherKeys, phoneNonce).toByteArray())
        }
        watch.isDaemon = true
        watch.start()

        transport.start()
        try {
            runBlocking { withTimeout(10_000) { authService.result.await() } }
            fail("expected the auth to fail")
        } catch (e: WatchAuthException) {
            assertTrue(e.message!!.contains("key"))
        }
    }
}
