package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.watch.transport.Channel
import app.kumquant.healthbridge.watch.transport.PacketCrypto
import app.kumquant.healthbridge.watch.transport.SppPacketV1
import app.kumquant.healthbridge.watch.transport.SppPacketV2
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Reversible stand-in for the session keys: XOR with a constant, 4 trailing marker bytes where CCM has its tag. */
internal class FakeCrypto(override var encryptionInitialized: Boolean = true) : PacketCrypto {
    override fun encryptV1(payload: ByteArray, counter: Int) =
        ByteArray(payload.size) { (payload[it].toInt() xor 0x5a).toByte() } + byteArrayOf(counter.toByte(), 0, 0, 0)

    override fun decryptV1(payload: ByteArray) = ByteArray(payload.size - 4) { (payload[it].toInt() xor 0x5a).toByte() }
    override fun encryptV2(payload: ByteArray) = ByteArray(payload.size) { (payload[it].toInt() xor 0x33).toByte() }
    override fun decryptV2(payload: ByteArray) = encryptV2(payload)
}

class SppPacketTest {

    // --- v1 ---

    @Test
    fun v1VersionRequestBytes() {
        val frame = SppPacketV1.create(
            Channel.Version, SppPacketV1.OPCODE_READ, 0, SppPacketV1.DATA_TYPE_PLAIN, needsResponse = true,
        ).encode(null, null)
        // ba dc fe | channel 0 | flags c0 | len 3 | opcode 0, serial 0, dataType 0 | ef
        assertEquals("badcfe00c003000000 00ef".replace(" ", ""), frame.toHex())
    }

    @Test
    fun v1AuthPacketIsPlainOnProtoTxChannel() {
        val payload = byteArrayOf(1, 2, 3)
        val frame = SppPacketV1.create(Channel.Authentication, SppPacketV1.OPCODE_SEND, 7, SppPacketV1.getDataTypeForChannel(Channel.Authentication), payload)
            .encode(FakeCrypto(), AtomicInteger())
        // ba dc fe | channel 2 | flags 80 | len 6 | opcode 02, serial 07, dataType 02 | payload | ef
        assertEquals("badcfe0280" + "0600" + "02" + "07" + "02" + "010203" + "ef", frame.toHex())
        val decoded = SppPacketV1.decode(frame)!!
        assertEquals(Channel.ProtobufCommand, decoded.channel)
        assertEquals(SppPacketV1.DATA_TYPE_AUTH, decoded.dataType)
        assertArrayEquals(payload, decoded.payload)
    }

    @Test
    fun v1CommandPacketCarriesCounterAndEncryptedPayload() {
        val counter = AtomicInteger(0)
        val payload = byteArrayOf(9, 8, 7)
        val crypto = FakeCrypto()
        val first = SppPacketV1.create(Channel.ProtobufCommand, SppPacketV1.OPCODE_SEND, 0, SppPacketV1.DATA_TYPE_ENCRYPTED, payload).encode(crypto, counter)
        val second = SppPacketV1.create(Channel.ProtobufCommand, SppPacketV1.OPCODE_SEND, 1, SppPacketV1.DATA_TYPE_ENCRYPTED, payload).encode(crypto, counter)
        val d1 = SppPacketV1.decode(first)!!
        val d2 = SppPacketV1.decode(second)!!
        // payload = le16 counter + encrypt(payload, counter); counters start at 1
        assertEquals(1, d1.payload[0].toInt())
        assertEquals(2, d2.payload[0].toInt())
        assertEquals(0, d1.payload[1].toInt())
        assertArrayEquals(crypto.encryptV1(payload, 1), d1.payload.copyOfRange(2, d1.payload.size))
        assertEquals(2 + 3 + 4, d1.payload.size)
    }

    @Test
    fun v1DecryptOnlyWhenTypedEncryptedAndReady() {
        val crypto = FakeCrypto(encryptionInitialized = false)
        val enc = SppPacketV1.create(Channel.ProtobufCommand, 2, 0, SppPacketV1.DATA_TYPE_ENCRYPTED, crypto.encryptV1(byteArrayOf(1, 2), 0))
        assertArrayEquals(enc.payload, enc.decryptedPayload(crypto)) // keys not ready, passes through
        crypto.encryptionInitialized = true
        assertArrayEquals(byteArrayOf(1, 2), enc.decryptedPayload(crypto))
        val plain = SppPacketV1.create(Channel.ProtobufCommand, 2, 0, SppPacketV1.DATA_TYPE_AUTH, byteArrayOf(5))
        assertArrayEquals(byteArrayOf(5), plain.decryptedPayload(crypto))
    }

    @Test
    fun v1DecodeRejectsBadFrames() {
        val good = SppPacketV1.create(Channel.Version, 0, 0, 0, byteArrayOf(2)).encode(null, null)
        assertNotNull(SppPacketV1.decode(good))
        assertNull(SppPacketV1.decode(good.copyOf(good.size - 1))) // truncated
        assertNull(SppPacketV1.decode(good.copyOf().also { it[0] = 0 })) // preamble
        assertNull(SppPacketV1.decode(good.copyOf().also { it[it.size - 1] = 0 })) // epilogue
        assertNull(SppPacketV1.decode(ByteArray(5)))
    }

    @Test
    fun v1ChannelMapping() {
        assertEquals(Channel.ProtobufCommand, SppPacketV1.getChannel(1))
        assertEquals(Channel.ProtobufCommand, SppPacketV1.getChannel(2))
        assertEquals(Channel.Activity, SppPacketV1.getChannel(3))
        assertEquals(Channel.Data, SppPacketV1.getChannel(5))
        assertEquals(Channel.Version, SppPacketV1.getChannel(0))
        assertEquals(Channel.Unknown, SppPacketV1.getChannel(9))
    }

    // --- v2 (Gadgetbridge's XiaomiSppPacketV2Test, plus CRC and data packets) ---

    private fun emptyFrame(type: Int, seq: Int) = byteArrayOf(0xa5.toByte(), 0xa5.toByte(), type.toByte(), seq.toByte(), 0, 0, 0, 0)

    @Test
    fun v2DecodesAck() {
        val p = SppPacketV2.decode(emptyFrame(SppPacketV2.PACKET_TYPE_ACK, 0xf2))
        assertTrue(p is SppPacketV2.Ack)
        assertEquals(0xf2, p!!.sequenceNumber)
    }

    @Test
    fun v2DecodesNackCapturedFromAMiBand10() {
        val p = SppPacketV2.decode(byteArrayOf(0xa5.toByte(), 0xa5.toByte(), 0, 0xf6.toByte(), 0, 0, 0, 0))
        assertTrue(p is SppPacketV2.Nack)
        assertEquals(0xf6, p!!.sequenceNumber)
    }

    @Test
    fun v2RejectsShortTruncatedAndCorruptFrames() {
        assertNull(SppPacketV2.decode(byteArrayOf(0xa5.toByte(), 0xa5.toByte(), 1)))
        assertNull(SppPacketV2.decode(byteArrayOf(0xa5.toByte(), 0xa5.toByte(), 3, 1, 6, 0, 0, 0)))
        assertNull(SppPacketV2.decode(byteArrayOf(0xa5.toByte(), 0xa5.toByte(), 3, 1, 2, 0, 0xff.toByte(), 0xff.toByte(), 1, 2)))
    }

    @Test
    fun crc16IsCrcArc() {
        assertEquals(0xBB3D, SppPacketV2.crc16("123456789".toByteArray()))
        assertEquals(0, SppPacketV2.crc16(ByteArray(0)))
    }

    @Test
    fun v2DataPacketRoundTripEncryptsProtobufButNotData() {
        val crypto = FakeCrypto()
        val body = byteArrayOf(1, 2, 3, 4)

        val cmd = SppPacketV2.decode(SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_DATA, 5, SppPacketV2.dataPayload(Channel.ProtobufCommand, body, crypto))) as SppPacketV2.Data
        assertEquals(5, cmd.sequenceNumber)
        assertEquals(Channel.ProtobufCommand, cmd.channel)
        assertEquals(SppPacketV2.OPCODE_SEND_ENCRYPTED, cmd.opCode)
        assertFalse(cmd.payload.contentEquals(body))
        assertArrayEquals(body, cmd.plainPayload(crypto))

        val auth = SppPacketV2.decode(SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_DATA, 0, SppPacketV2.dataPayload(Channel.Authentication, body, crypto))) as SppPacketV2.Data
        assertEquals(SppPacketV2.OPCODE_SEND_PLAINTEXT, auth.opCode)
        assertArrayEquals(body, auth.payload)
        assertEquals(Channel.ProtobufCommand, auth.channel) // auth shares the protobuf raw channel

        val act = SppPacketV2.decode(SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_DATA, 0, SppPacketV2.dataPayload(Channel.Activity, body, crypto))) as SppPacketV2.Data
        assertEquals(Channel.Activity, act.channel)
        assertEquals(SppPacketV2.OPCODE_SEND_ENCRYPTED, act.opCode)
    }

    @Test
    fun v2SessionConfigRequestMatchesTheOfficialAppDump() {
        val frame = SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_SESSION_CONFIG, 0, SppPacketV2.sessionConfigPayload(1))
        val decoded = SppPacketV2.decode(frame) as SppPacketV2.SessionConfig
        assertEquals(1, decoded.opCode)
        assertEquals(
            "01" + "01" + "0300" + "010000" + "02" + "0200" + "00fc" + "03" + "0200" + "2000" + "04" + "0200" + "1027",
            frame.copyOfRange(8, frame.size).toHex(),
        )
    }
}
