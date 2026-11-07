package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.transport.SppTransport
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/** Base of every failure the watch layer throws from [WatchClient]; an [IOException] so callers can catch it as such. */
open class WatchException(message: String, cause: Throwable? = null) : IOException(message, cause)

/** The auth key was rejected (the watch's proof did not match) or is malformed. */
class WatchAuthException(message: String) : WatchException(message)

/** The watch did not answer a request in time. */
class WatchTimeoutException(message: String) : WatchException(message)

/** What a service needs to talk to the watch; implemented by [CommandSession], faked in tests. */
internal interface CommandChannel {
    /** Queues [command] for sending. Never blocks. */
    fun send(command: XiaomiProto.Command)

    /**
     * Sends [command] and waits for the next incoming command with the same type and subtype.
     * @throws WatchTimeoutException if none arrives within [timeoutMs]
     */
    suspend fun request(command: XiaomiProto.Command, timeoutMs: Long = DEFAULT_TIMEOUT_MS): XiaomiProto.Command

    /** Runs follow-up work from a handler without blocking the read loop. */
    fun launch(block: suspend () -> Unit)

    companion object {
        const val DEFAULT_TIMEOUT_MS = 5_000L
    }
}

internal fun CommandChannel.send(type: Int, subtype: Int) =
    send(XiaomiProto.Command.newBuilder().setType(type).setSubtype(subtype).build())

internal suspend fun CommandChannel.request(type: Int, subtype: Int, timeoutMs: Long = CommandChannel.DEFAULT_TIMEOUT_MS) =
    request(XiaomiProto.Command.newBuilder().setType(type).setSubtype(subtype).build(), timeoutMs)

/** One protobuf command family (system, notification, ...), keyed by `Command.type`. */
internal abstract class XiaomiService(val commandType: Int) {
    /** Handles every incoming command of this service's type. Must not block. */
    abstract fun handle(cmd: XiaomiProto.Command)

    open fun onDisconnect() {}
}

/**
 * Routes incoming commands to services and matches responses to pending [request]s. The port of
 * the command half of Gadgetbridge's XiaomiSupport (handleCommandBytes, sendCommand).
 */
internal class CommandSession(
    private val transport: SppTransport,
    private val launcher: (suspend () -> Unit) -> Unit,
) : CommandChannel {
    private val services = ConcurrentHashMap<Int, XiaomiService>()
    private val waiters = ConcurrentHashMap<Int, CopyOnWriteArrayList<CompletableDeferred<XiaomiProto.Command>>>()

    fun register(service: XiaomiService) {
        services[service.commandType] = service
    }

    fun onDisconnect() = services.values.forEach { it.onDisconnect() }

    override fun send(command: XiaomiProto.Command) = transport.sendCommand(command)

    override fun launch(block: suspend () -> Unit) = launcher(block)

    override suspend fun request(command: XiaomiProto.Command, timeoutMs: Long): XiaomiProto.Command {
        val waiter = CompletableDeferred<XiaomiProto.Command>()
        val key = key(command.type, command.subtype)
        val list = waiters.getOrPut(key) { CopyOnWriteArrayList() }
        list.add(waiter)
        try {
            send(command)
            return withTimeoutOrNull(timeoutMs) { waiter.await() }
                ?: throw WatchTimeoutException("no reply to command ${command.type}/${command.subtype} within $timeoutMs ms")
        } finally {
            list.remove(waiter)
        }
    }

    /** Entry point for decrypted `ProtobufCommand` payloads. */
    fun handleCommandBytes(bytes: ByteArray) {
        val cmd = try {
            XiaomiProto.Command.parseFrom(bytes)
        } catch (e: Exception) {
            WatchLog.e("cannot parse command payload (${bytes.size}B): ${bytes.toHexCapped(256)}", e)
            return
        }
        WatchLog.d("rx command type=${cmd.type} sub=${cmd.subtype} status=${if (cmd.hasStatus()) cmd.status else -1}")
        waiters[key(cmd.type, cmd.subtype)]?.forEach { it.complete(cmd) }
        val service = services[cmd.type]
        if (service == null) {
            WatchLog.w("no service for command type ${cmd.type}/${cmd.subtype}: ${bytes.toHexCapped(256)}")
            return
        }
        try {
            service.handle(cmd)
        } catch (e: Exception) {
            WatchLog.e("service ${cmd.type} failed on subtype ${cmd.subtype}: ${bytes.toHexCapped(256)}", e)
        }
    }

    private fun key(type: Int, subtype: Int) = (type shl 16) or (subtype and 0xffff)
}
