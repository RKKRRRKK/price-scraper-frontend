package app.kumquant.healthbridge.watch.transport

import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.toHex
import app.kumquant.healthbridge.watch.toHexCapped
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

/** What a protocol needs from the transport that owns it. */
internal interface SppIo {
    val crypto: PacketCrypto

    /** A decoded, decrypted inbound payload for [channel]. Called on the read coroutine; must not block. */
    fun deliver(channel: Channel, payload: ByteArray)

    /** Runs [task] on the single write coroutine, in call order. The task returns false if the write failed. */
    fun enqueue(name: String, task: suspend () -> Boolean)

    /** Writes one frame to the socket; false if it failed. Only call from a task given to [enqueue]. */
    suspend fun writeRaw(frame: ByteArray): Boolean

    /** The watch's session config arrived (v2): time for the auth handshake. */
    fun onSessionReady()

    /** Gives up on the link so the caller can reconnect. */
    fun dropConnection(reason: String)
}

internal sealed interface ParseResult {
    /** The buffer does not start with a frame. */
    data object Invalid : ParseResult

    /** The buffer holds the start of a frame but not all of it. */
    data object Incomplete : ParseResult

    data class Complete(val packetSize: Int) : ParseResult
}

/** A framing protocol on top of the RFCOMM byte stream (v1 or v2); the version is negotiated per connection. */
internal abstract class SppProtocol {
    /** Offset of the next possible frame start after the first byte, or -1. */
    abstract fun findNextPacketOffset(buffer: ByteArray): Int

    /** Decodes and dispatches the frame at the start of [buffer], if it is complete. */
    abstract fun processPacket(buffer: ByteArray): ParseResult

    /** Queues [payload] for sending on [channel]; framing, encryption and sequencing happen when it is written. */
    abstract fun writePacket(channel: Channel, payload: ByteArray)

    /** Starts the protocol session. True means the auth handshake can begin now; false means wait for [SppIo.onSessionReady]. */
    open fun initializeSession(): Boolean = true

    /** Releases timers and pending state when the protocol is replaced or the link goes away. */
    open fun dispose() {}
}

/** SPP v1: one frame per command, no acknowledgements. Ported from Gadgetbridge's XiaomiSppProtocolV1. */
internal class SppProtocolV1(private val io: SppIo) : SppProtocol() {
    private val frameCounter = AtomicInteger(0)
    private val encryptionCounter = AtomicInteger(0)

    override fun findNextPacketOffset(buffer: ByteArray): Int {
        for (i in 1 until buffer.size) if (buffer[i] == SppPacketV1.PREAMBLE[0]) return i
        return -1
    }

    override fun processPacket(buffer: ByteArray): ParseResult {
        if (buffer.size < SppPacketV1.MIN_SIZE) return ParseResult.Incomplete
        for (i in SppPacketV1.PREAMBLE.indices) {
            if (buffer[i] != SppPacketV1.PREAMBLE[i]) {
                WatchLog.d("v1: header mismatch: ${buffer.copyOf(3).toHex()}")
                return ParseResult.Invalid
            }
        }
        val payloadSize = ByteBuffer.wrap(buffer, 5, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
        val packetSize = payloadSize + 8 // the length field includes the 3 header bytes after it
        if (buffer.size < packetSize) return ParseResult.Incomplete

        val packet = SppPacketV1.decode(buffer.copyOf(packetSize)) ?: return ParseResult.Invalid
        WatchLog.d("v1: rx $packet")
        try {
            io.deliver(packet.channel, packet.decryptedPayload(io.crypto))
        } catch (e: Exception) {
            WatchLog.e("v1: dropping undecryptable or unhandled packet $packet: ${buffer.copyOf(packetSize).toHexCapped()}", e)
        }
        return ParseResult.Complete(packetSize)
    }

    override fun writePacket(channel: Channel, payload: ByteArray) {
        io.enqueue("v1 $channel") {
            val frame = SppPacketV1.create(
                channel = channel,
                opCode = SppPacketV1.OPCODE_SEND,
                frameSerial = frameCounter.getAndIncrement(),
                dataType = SppPacketV1.getDataTypeForChannel(channel),
                payload = payload,
            ).encode(io.crypto, encryptionCounter)
            io.writeRaw(frame)
        }
    }
}

/**
 * SPP v2: sequenced frames with a CRC. Data packets go out go-back-N: the watch accepts them strictly
 * in sequence and acks cumulatively, so a packet that reaches it out of order is dropped together with
 * everything after it until the missing one is resent. Ported from Gadgetbridge's XiaomiSppProtocolV2.
 */
internal class SppProtocolV2(
    private val io: SppIo,
    private val scope: CoroutineScope,
    private val resendTimeoutMs: Long = RESEND_TIMEOUT_MS,
) : SppProtocol() {
    private val sendWindow = SppV2SendWindow()
    private val lock = Any()
    private var timeoutJob: Job? = null
    private var timeoutsWithoutAck = 0

    override fun findNextPacketOffset(buffer: ByteArray): Int {
        for (i in 1 until buffer.size) if (buffer[i] == SppPacketV2.PREAMBLE[0]) return i
        return -1
    }

    override fun processPacket(buffer: ByteArray): ParseResult {
        if (buffer.size < SppPacketV2.HEADER_SIZE) return ParseResult.Incomplete
        if (buffer[0] != SppPacketV2.PREAMBLE[0] || buffer[1] != SppPacketV2.PREAMBLE[1]) {
            WatchLog.w("v2: invalid header magic ${buffer.copyOf(2).toHex()}")
            return ParseResult.Invalid
        }
        val length = ByteBuffer.wrap(buffer, 4, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
        val packetSize = SppPacketV2.HEADER_SIZE + length
        if (buffer.size < packetSize) return ParseResult.Incomplete

        val packet = SppPacketV2.decode(buffer.copyOf(packetSize))
        if (packet == null) {
            WatchLog.w("v2: undecodable frame: ${buffer.copyOf(packetSize).toHexCapped()}")
        } else {
            handle(packet)
        }
        return ParseResult.Complete(packetSize)
    }

    private fun handle(packet: SppPacketV2) {
        when (packet) {
            is SppPacketV2.SessionConfig -> {
                WatchLog.i("v2: watch session config, opcode=${packet.opCode}")
                io.onSessionReady()
            }
            is SppPacketV2.Data -> {
                try {
                    io.deliver(packet.channel, packet.plainPayload(io.crypto))
                } catch (e: Exception) {
                    WatchLog.e("v2: unhandled data packet seq=${packet.sequenceNumber} ch=${packet.channel} op=${packet.opCode}: ${packet.payload.toHexCapped()}", e)
                }
                sendAck(packet.sequenceNumber)
            }
            is SppPacketV2.Ack -> {
                WatchLog.d("v2: ack ${packet.sequenceNumber}")
                onAck(packet.sequenceNumber)
            }
            is SppPacketV2.Nack -> onNack(packet.sequenceNumber)
        }
    }

    private fun sendAck(sequenceNumber: Int) {
        val frame = SppPacketV2.encodeAck(sequenceNumber)
        io.enqueue("v2 ack $sequenceNumber") { io.writeRaw(frame) }
    }

    private fun onAck(sequenceNumber: Int) {
        if (sendWindow.onAck(sequenceNumber) > 0) onAckProgress()
    }

    private fun onNack(expected: Int) {
        onAck((expected - 1) and 0xff)
        if (sendWindow.oldestUnacked != expected) {
            WatchLog.w("v2: nack, watch expects packet $expected, which is not pending")
            return
        }
        WatchLog.w("v2: nack, watch expects packet $expected, resending")
        queueResend("v2 resend from $expected")
    }

    private fun queueResend(name: String) {
        io.enqueue(name) { resendUnacked() }
    }

    private suspend fun resendUnacked(): Boolean {
        val frames = sendWindow.unackedFrames()
        WatchLog.d("v2: resending ${frames.size} unacked packets")
        for (frame in frames) if (!io.writeRaw(frame)) return false
        armResendTimeout()
        return true
    }

    private fun onAckProgress() {
        synchronized(lock) {
            timeoutsWithoutAck = 0
            timeoutJob?.cancel()
            timeoutJob = null
        }
        if (!sendWindow.isEmpty()) armResendTimeout()
    }

    private fun armResendTimeout() {
        synchronized(lock) {
            if (timeoutJob?.isActive == true) return
            timeoutJob = scope.launch {
                delay(resendTimeoutMs)
                onResendTimeout()
            }
        }
    }

    private fun onResendTimeout() {
        val timeouts: Int
        synchronized(lock) {
            timeoutJob = null
            if (sendWindow.isEmpty()) {
                timeoutsWithoutAck = 0
                return
            }
            timeouts = ++timeoutsWithoutAck
        }
        if (timeouts >= MAX_TIMEOUTS_WITHOUT_ACK) {
            WatchLog.w("v2: no ack for packet ${sendWindow.oldestUnacked} after $timeouts timeouts, dropping the connection")
            dispose()
            io.dropConnection("no ack from the watch")
            return
        }
        WatchLog.w("v2: no ack for packet ${sendWindow.oldestUnacked} within $resendTimeoutMs ms, resending")
        queueResend("v2 resend after timeout")
    }

    override fun initializeSession(): Boolean {
        dispose()
        val frame = SppPacketV2.encodeFrame(
            SppPacketV2.PACKET_TYPE_SESSION_CONFIG,
            0,
            SppPacketV2.sessionConfigPayload(SppPacketV2.OPCODE_START_SESSION_REQUEST),
        )
        io.enqueue("v2 session config") { io.writeRaw(frame) }
        return false
    }

    override fun writePacket(channel: Channel, payload: ByteArray) {
        // Encrypt and number the packet when it is written, so frames reach the socket in sequence
        // whichever thread queued them.
        io.enqueue("v2 data $channel") {
            val body = SppPacketV2.dataPayload(channel, payload, io.crypto)
            val seq = sendWindow.nextSequenceNumber()
            val frame = SppPacketV2.encodeFrame(SppPacketV2.PACKET_TYPE_DATA, seq, body)
            sendWindow.onSent(seq, frame)
            val written = io.writeRaw(frame)
            armResendTimeout()
            written
        }
    }

    override fun dispose() {
        synchronized(lock) {
            timeoutJob?.cancel()
            timeoutJob = null
            timeoutsWithoutAck = 0
        }
        sendWindow.clear()
    }

    companion object {
        const val RESEND_TIMEOUT_MS = 10_000L

        /** Resend timeouts in a row without any ack before the link is considered dead. */
        const val MAX_TIMEOUTS_WITHOUT_ACK = 3
    }
}
