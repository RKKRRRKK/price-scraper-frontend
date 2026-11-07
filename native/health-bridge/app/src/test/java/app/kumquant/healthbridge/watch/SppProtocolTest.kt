package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.watch.transport.Channel
import app.kumquant.healthbridge.watch.transport.PacketCrypto
import app.kumquant.healthbridge.watch.transport.ParseResult
import app.kumquant.healthbridge.watch.transport.SppIo
import app.kumquant.healthbridge.watch.transport.SppPacketV2
import app.kumquant.healthbridge.watch.transport.SppProtocolV1
import app.kumquant.healthbridge.watch.transport.SppProtocolV2
import app.kumquant.healthbridge.watch.transport.SppV2SendWindow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Ports of Gadgetbridge's XiaomiSppV2SendWindowTest and XiaomiSppProtocolV2Test. */
class SppSendWindowTest {
    private fun send(window: SppV2SendWindow, count: Int) {
        repeat(count) {
            val seq = window.nextSequenceNumber()
            window.onSent(seq, byteArrayOf(seq.toByte()))
        }
    }

    @Test
    fun ackIsCumulative() {
        val w = SppV2SendWindow()
        send(w, 5)
        assertEquals(3, w.onAck(2))
        assertEquals(3, w.oldestUnacked)
        assertEquals(2, w.unackedFrames().size)
    }

    @Test
    fun ignoresAnAckForNoUnackedFrame() {
        val w = SppV2SendWindow()
        send(w, 5)
        w.onAck(2)
        assertEquals(0, w.onAck(1))
        assertEquals(0, w.onAck(9))
        assertEquals(3, w.oldestUnacked)
    }

    @Test
    fun sequenceNumbersWrap() {
        val w = SppV2SendWindow()
        send(w, 254)
        w.onAck(253)
        send(w, 4)
        assertEquals(254, w.oldestUnacked)
        assertEquals(3, w.onAck(0))
        assertEquals(1, w.oldestUnacked)
        assertEquals(2, w.nextSequenceNumber())
    }

    @Test
    fun forgetsTheOldestFramesPastTheLimit() {
        val w = SppV2SendWindow()
        send(w, SppV2SendWindow.MAX_TRACKED_FRAMES + 2)
        assertEquals(2, w.oldestUnacked)
        assertEquals(SppV2SendWindow.MAX_TRACKED_FRAMES, w.unackedFrames().size)
    }

    @Test
    fun clearRestartsTheSequence() {
        val w = SppV2SendWindow()
        send(w, 3)
        w.clear()
        assertTrue(w.isEmpty())
        assertEquals(-1, w.oldestUnacked)
        assertEquals(0, w.nextSequenceNumber())
    }
}

/** Runs queued writes at once on the calling thread and records them, standing in for the transport. */
internal class RecordingIo(override val crypto: PacketCrypto = FakeCrypto()) : SppIo {
    val written = mutableListOf<ByteArray>()
    val delivered = mutableListOf<Pair<Channel, ByteArray>>()
    var dropped = false
    var sessionReady = false
    var failWrites = false

    override fun deliver(channel: Channel, payload: ByteArray) {
        synchronized(delivered) { delivered += channel to payload }
    }

    override fun enqueue(name: String, task: suspend () -> Boolean) {
        runBlocking { task() }
    }

    override suspend fun writeRaw(frame: ByteArray): Boolean {
        if (failWrites) return false
        synchronized(written) { written += frame }
        return true
    }

    override fun onSessionReady() {
        sessionReady = true
    }

    override fun dropConnection(reason: String) {
        dropped = true
    }

    fun takeWritten(): List<ByteArray> = synchronized(written) { written.toList().also { written.clear() } }
}

class SppProtocolV2Test {
    private lateinit var scope: CoroutineScope
    private lateinit var io: RecordingIo
    private lateinit var protocol: SppProtocolV2

    @Before
    fun setUp() {
        scope = CoroutineScope(Dispatchers.Default + Job())
        io = RecordingIo()
        protocol = SppProtocolV2(io, scope, resendTimeoutMs = 150)
    }

    @After
    fun tearDown() {
        protocol.dispose()
        scope.cancel()
    }

    private fun sendPackets(count: Int): List<ByteArray> {
        repeat(count) { protocol.writePacket(Channel.Data, byteArrayOf(it.toByte())) }
        return io.takeWritten()
    }

    private fun receive(hex: String) {
        var buffer = hex.hexToBytes()
        while (buffer.isNotEmpty()) {
            val result = protocol.processPacket(buffer)
            assertTrue(result is ParseResult.Complete)
            buffer = buffer.copyOfRange((result as ParseResult.Complete).packetSize, buffer.size)
        }
    }

    private fun assertFrames(expected: List<ByteArray>, actual: List<ByteArray>) {
        assertEquals(expected.size, actual.size)
        expected.indices.forEach { assertArrayEquals("frame $it", expected[it], actual[it]) }
    }

    private fun waitFor(timeoutMs: Long = 3000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!cond() && System.currentTimeMillis() < end) Thread.sleep(10)
    }

    @Test
    fun resendsFromThePacketTheWatchExpectsAfterANack() {
        val sent = sendPackets(21)
        // Redmi Watch 6 log from GB #6888: acks 8 and 9, then type 0 for 17.
        receive("A5A5010800000000A5A5010900000000A5A5001100000000")
        assertFrames(sent.subList(17, 21), io.takeWritten())
        // Then ack 17 and type 0 for 18: everything from 18 on is resent, 17 is not.
        receive("A5A5011100000000A5A5001200000000")
        assertFrames(sent.subList(18, 21), io.takeWritten())
    }

    @Test
    fun ignoresANackForAPacketNotPending() {
        sendPackets(3)
        receive("A5A5000300000000")
        assertTrue(io.takeWritten().isEmpty())
    }

    @Test
    fun numbersPacketsInWriteOrder() {
        val frames = sendPackets(3)
        assertEquals(listOf(0, 1, 2), frames.map { it[3].toInt() and 0xff })
    }

    @Test
    fun resendsOnTimeoutAndDropsTheConnectionWhenNothingIsAcked() {
        val sent = sendPackets(2)
        waitFor { io.written.size >= 2 }
        assertFrames(sent, io.takeWritten())
        assertFalse(io.dropped)
        waitFor { io.written.size >= 2 }
        assertFrames(sent, io.takeWritten())
        waitFor { io.dropped }
        assertTrue(io.dropped)
    }

    @Test
    fun anAckRestartsTheTimeoutCount() {
        sendPackets(3)
        Thread.sleep(400) // two timeouts, one short of dropping
        assertFalse(io.dropped)
        receive("A5A5010000000000") // ack 0: progress
        Thread.sleep(400)
        assertFalse(io.dropped)
    }

    @Test
    fun staysQuietOnceEverythingIsAcked() {
        sendPackets(3)
        receive("A5A5010200000000")
        Thread.sleep(600)
        assertTrue(io.takeWritten().isEmpty())
        assertFalse(io.dropped)
    }

    @Test
    fun acksWatchDataAndDeliversItDecrypted() {
        val crypto = io.crypto
        val body = byteArrayOf(10, 20, 30)
        val frame = SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_DATA, 7, SppPacketV2.dataPayload(Channel.ProtobufCommand, body, crypto))
        assertEquals(ParseResult.Complete(frame.size), protocol.processPacket(frame))
        assertEquals(Channel.ProtobufCommand, io.delivered.single().first)
        assertArrayEquals(body, io.delivered.single().second)
        assertEquals("a5a5010700000000", io.takeWritten().single().toHex())
    }

    @Test
    fun watchSessionConfigStartsTheHandshake() {
        val frame = SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_SESSION_CONFIG, 0, SppPacketV2.sessionConfigPayload(2))
        protocol.processPacket(frame)
        assertTrue(io.sessionReady)
    }

    @Test
    fun initializeSessionSendsOurConfigAndWaitsForTheWatch() {
        assertFalse(protocol.initializeSession())
        val frame = io.takeWritten().single()
        assertEquals(SppPacketV2.PACKET_TYPE_SESSION_CONFIG, frame[2].toInt() and 0xf)
        assertEquals(1, frame[8].toInt())
    }

    @Test
    fun framingResyncsOnGarbageAndPartialFrames() {
        assertEquals(ParseResult.Incomplete, protocol.processPacket(byteArrayOf(0xa5.toByte(), 0xa5.toByte(), 1)))
        assertEquals(ParseResult.Invalid, protocol.processPacket(ByteArray(10)))
        val buf = byteArrayOf(0, 0, 0xa5.toByte(), 0xa5.toByte(), 1, 1, 0, 0, 0, 0)
        assertEquals(2, protocol.findNextPacketOffset(buf))
        // header says 4 payload bytes but only 2 arrived
        assertEquals(ParseResult.Incomplete, protocol.processPacket(byteArrayOf(0xa5.toByte(), 0xa5.toByte(), 3, 1, 4, 0, 0, 0, 1, 2)))
    }
}

class SppProtocolV1Test {
    @Test
    fun parsesFramesAndReportsIncompleteOnes() {
        val io = RecordingIo()
        val protocol = SppProtocolV1(io)
        protocol.writePacket(Channel.Authentication, byteArrayOf(1, 2, 3))
        val frame = io.takeWritten().single()

        assertEquals(ParseResult.Incomplete, protocol.processPacket(frame.copyOf(frame.size - 2)))
        assertEquals(ParseResult.Complete(frame.size), protocol.processPacket(frame + byteArrayOf(0x55)))
        assertArrayEquals(byteArrayOf(1, 2, 3), io.delivered.single().second)
        assertEquals(ParseResult.Invalid, protocol.processPacket(ByteArray(20)))
        assertEquals(3, protocol.findNextPacketOffset(byteArrayOf(0, 0, 0, 0xba.toByte(), 0xdc.toByte())))
    }

    @Test
    fun frameSerialCountsUpAndCommandCountersStartAtOne() {
        val io = RecordingIo()
        val protocol = SppProtocolV1(io)
        repeat(2) { protocol.writePacket(Channel.ProtobufCommand, byteArrayOf(7)) }
        val frames = io.takeWritten()
        assertEquals(listOf(0, 1), frames.map { it[8].toInt() })
        assertEquals(listOf(1, 2), frames.map { it[10].toInt() }) // first payload byte is the le16 counter
    }
}
