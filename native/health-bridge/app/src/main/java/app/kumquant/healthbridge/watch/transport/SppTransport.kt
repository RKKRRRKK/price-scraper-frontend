package app.kumquant.healthbridge.watch.transport

import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.auth.XiaomiAuth
import app.kumquant.healthbridge.watch.toHex
import app.kumquant.healthbridge.watch.toHexCapped
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel as KChannel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Xiaomi SPP link over an already open byte stream: frames outgoing packets, parses incoming
 * ones, negotiates the protocol version and routes payloads to per-channel handlers.
 * Ported from Gadgetbridge's XiaomiSppSupport; the RFCOMM socket itself lives in [Rfcomm].
 *
 * Connection sequence: [start] sends a v1 "version" read request. The watch's answer carries its
 * protocol version; 2 or more switches to [SppProtocolV2], which opens a session first. No answer
 * within [versionTimeoutMs] means v1. Once the protocol is ready, [onHandshakeReady] fires exactly
 * once and the caller begins the auth handshake.
 *
 * All writes go through one coroutine, so frames hit the socket in the order they were queued.
 */
internal class SppTransport(
    private val input: InputStream,
    private val output: OutputStream,
    override val crypto: PacketCrypto,
    private val scope: CoroutineScope,
    private val resendTimeoutMs: Long = SppProtocolV2.RESEND_TIMEOUT_MS,
    private val versionTimeoutMs: Long = VERSION_TIMEOUT_MS,
) : SppIo {

    /** Payload for [Channel.ProtobufCommand], [Channel.Activity] and so on, already decrypted. */
    var onPayload: (Channel, ByteArray) -> Unit = { _, _ -> }

    /** The protocol session is up; start the auth handshake. Fires once per connection. */
    var onHandshakeReady: () -> Unit = {}

    /** The link ended: end of stream, a write failure, or [dropConnection]. Fires once. */
    var onClosed: (Throwable?) -> Unit = {}

    @Volatile
    var protocolVersion: Int = 1
        private set

    private val rx = RxBuffer()
    private val outbox = KChannel<suspend () -> Boolean>(KChannel.UNLIMITED)
    private val closed = AtomicBoolean(false)
    private val versionHandled = AtomicBoolean(false)
    private val handshakeStarted = AtomicBoolean(false)

    @Volatile
    private var protocol: SppProtocol = SppProtocolV1(this)
    private var versionTimeout: Job? = null
    private var readJob: Job? = null
    private var writeJob: Job? = null

    fun start() {
        writeJob = scope.launch(Dispatchers.IO) {
            for (task in outbox) {
                val ok = try {
                    task()
                } catch (e: IOException) {
                    close(e)
                    return@launch
                } catch (e: Exception) {
                    WatchLog.e("write task failed", e)
                    false
                }
                if (!ok) {
                    close(IOException("socket write failed"))
                    return@launch
                }
            }
        }
        readJob = scope.launch(Dispatchers.IO) { readLoop() }

        // Ask for the protocol version in a v1 frame; a v2 watch answers in v1 framing too.
        enqueue("version request") {
            writeRaw(
                SppPacketV1.create(
                    channel = Channel.Version,
                    opCode = SppPacketV1.OPCODE_READ,
                    frameSerial = 0,
                    dataType = SppPacketV1.DATA_TYPE_PLAIN,
                    needsResponse = true,
                ).encode(null, null),
            )
        }
        versionTimeout = scope.launch {
            delay(versionTimeoutMs)
            WatchLog.w("SPP protocol version request timed out, assuming v1")
            handleVersionPacket(ByteArray(0))
        }
    }

    /** Sends a protobuf command: auth commands go out in the clear on the auth channel, the rest encrypted. */
    fun sendCommand(command: XiaomiProto.Command) {
        val bytes = command.toByteArray()
        WatchLog.d("tx command type=${command.type} sub=${command.subtype} ${bytes.toHexCapped()}")
        val channel = if (command.type == XiaomiAuth.COMMAND_TYPE) Channel.Authentication else Channel.ProtobufCommand
        protocol.writePacket(channel, bytes)
    }

    fun close(cause: Throwable? = null) {
        if (!closed.compareAndSet(false, true)) return
        versionTimeout?.cancel()
        protocol.dispose()
        outbox.close()
        try {
            input.close()
        } catch (_: IOException) {
        }
        try {
            output.close()
        } catch (_: IOException) {
        }
        readJob?.cancel()
        writeJob?.cancel()
        onClosed(cause)
    }

    // --- SppIo ---

    override fun enqueue(name: String, task: suspend () -> Boolean) {
        if (outbox.trySend(task).isFailure) WatchLog.d("dropping write '$name', link closed")
    }

    override suspend fun writeRaw(frame: ByteArray): Boolean = withContext(Dispatchers.IO) {
        try {
            WatchLog.d("tx ${frame.size}B ${frame.toHexCapped()}")
            output.write(frame)
            output.flush()
            true
        } catch (e: IOException) {
            WatchLog.w("write failed: ${e.message}")
            false
        }
    }

    override fun deliver(channel: Channel, payload: ByteArray) {
        if (channel == Channel.Version) {
            handleVersionPacket(payload)
        } else {
            onPayload(channel, payload)
        }
    }

    override fun onSessionReady() = startHandshake()

    override fun dropConnection(reason: String) {
        WatchLog.w("dropping connection: $reason")
        close(IOException(reason))
    }

    // --- internals ---

    private suspend fun readLoop() {
        val buf = ByteArray(READ_BUFFER)
        var failure: Throwable? = null
        try {
            while (scope.isActive && !closed.get()) {
                val n = input.read(buf)
                if (n < 0) throw IOException("end of stream")
                WatchLog.d("rx ${n}B ${buf.copyOf(n).toHexCapped()}")
                rx.append(buf, n)
                processBuffer()
            }
        } catch (e: Exception) {
            if (!closed.get()) failure = e
        }
        if (failure != null) WatchLog.w("read loop ended: ${failure.message}")
        close(failure)
    }

    private fun processBuffer() {
        while (true) {
            val state = rx.bytes()
            if (state.isEmpty()) return
            val skip = when (val result = protocol.processPacket(state)) {
                ParseResult.Incomplete -> return
                is ParseResult.Complete -> result.packetSize
                ParseResult.Invalid -> {
                    val next = protocol.findNextPacketOffset(state)
                    val n = if (next < 0) state.size else next
                    WatchLog.w("skipping $n invalid bytes: ${state.copyOf(minOf(n, 64)).toHex()}")
                    n
                }
            }
            rx.skip(skip)
        }
    }

    private fun handleVersionPacket(payload: ByteArray) {
        if (!versionHandled.compareAndSet(false, true)) {
            WatchLog.d("ignoring late version packet ${payload.toHex()}")
            return
        }
        versionTimeout?.cancel()
        if (payload.isNotEmpty()) {
            WatchLog.i("SPP protocol version bytes: ${payload.toHex()}")
            if ((payload[0].toInt() and 0xff) >= 2) {
                WatchLog.i("watch speaks SPP v2, switching protocol")
                protocol.dispose()
                protocol = SppProtocolV2(this, scope, resendTimeoutMs)
                protocolVersion = 2
            }
        }
        if (protocol.initializeSession()) startHandshake()
    }

    private fun startHandshake() {
        if (handshakeStarted.compareAndSet(false, true)) onHandshakeReady()
    }

    /** Bytes read but not yet consumed as frames. */
    private class RxBuffer {
        private var data = ByteArray(2048)
        private var size = 0

        @Synchronized
        fun append(src: ByteArray, n: Int) {
            if (size + n > data.size) data = data.copyOf(maxOf(data.size * 2, size + n))
            System.arraycopy(src, 0, data, size, n)
            size += n
        }

        @Synchronized
        fun bytes(): ByteArray = data.copyOf(size)

        @Synchronized
        fun skip(n: Int) {
            if (n >= size) {
                size = 0
                return
            }
            System.arraycopy(data, n, data, 0, size - n)
            size -= n
        }
    }

    companion object {
        const val VERSION_TIMEOUT_MS = 5_000L
        private const val READ_BUFFER = 1024
    }
}
