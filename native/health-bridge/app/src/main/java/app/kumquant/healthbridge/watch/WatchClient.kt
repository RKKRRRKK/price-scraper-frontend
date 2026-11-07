package app.kumquant.healthbridge.watch

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Build
import android.text.format.DateFormat
import app.kumquant.healthbridge.data.HealthDatabase
import app.kumquant.healthbridge.data.HealthStore
import app.kumquant.healthbridge.data.RawFileEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ActivityParsers
import app.kumquant.healthbridge.watch.auth.AuthService
import app.kumquant.healthbridge.watch.auth.CompanionInfo
import app.kumquant.healthbridge.watch.auth.XiaomiAuth
import app.kumquant.healthbridge.watch.health.ActivityFileReceiver
import app.kumquant.healthbridge.watch.health.HealthService
import app.kumquant.healthbridge.watch.services.MusicService
import app.kumquant.healthbridge.watch.services.NotificationService
import app.kumquant.healthbridge.watch.services.SystemService
import app.kumquant.healthbridge.watch.services.WeatherService
import app.kumquant.healthbridge.watch.transport.Channel
import app.kumquant.healthbridge.watch.transport.Rfcomm
import app.kumquant.healthbridge.watch.transport.SppTransport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.time.ZonedDateTime
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Xiaomi Watch S5 over Bluetooth Classic SPP, speaking the protocol Gadgetbridge reverse
 * engineered. One instance is one connection: [connect] once, use it, [close] it, and build a new
 * client to reconnect.
 *
 * The connection sequence: RFCOMM socket, protocol version negotiation (v1 or v2), the encrypted
 * auth handshake with the 32-hex key from Xiaomi's servers, then clock sync and device info /
 * battery requests. Everything is logged under the tag `HB.watch`; the key never is.
 *
 * Methods that talk to the watch throw [WatchException] (an [IOException]) when the link is down
 * or the watch does not answer. The [listener] is called on background threads.
 */
class WatchClient(
    context: Context,
    private val address: String,
    private val authKeyHex: String,
    private val db: HealthDatabase,
    private val listener: WatchListener,
    private val phoneGps: PhoneGps? = null,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _state = MutableStateFlow(LinkState.DISCONNECTED)
    val state: StateFlow<LinkState> = _state.asStateFlow()

    private val _info = MutableStateFlow(WatchInfo())
    val info: StateFlow<WatchInfo> = _info.asStateFlow()

    private val _liveHeartRate = MutableStateFlow<LiveHeartRate?>(null)

    /** Per-second readings while [startLiveHeartRate] is on; null otherwise. Never stored. */
    val liveHeartRate: StateFlow<LiveHeartRate?> = _liveHeartRate.asStateFlow()

    private val _liveWorkout = MutableStateFlow<LiveWorkout?>(null)

    /** The workout the watch is running now, null when there is none. Never stored. */
    val liveWorkout: StateFlow<LiveWorkout?> = _liveWorkout.asStateFlow()

    private val started = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private val disconnected = CompletableDeferred<Unit>()
    private val fetchMutex = Mutex()

    @Volatile
    private var link: Link? = null

    /** Everything that exists only while a connection is up. */
    private class Link(
        val socket: BluetoothSocket,
        val transport: SppTransport,
        val session: CommandSession,
        val authService: AuthService,
        val system: SystemService,
        val notifications: NotificationService,
        val weather: WeatherService,
        val music: MusicService,
        val health: HealthService,
    )

    /**
     * Opens the link, authenticates and syncs the clock; returns once [state] is CONNECTED.
     * @throws WatchAuthException (state AUTH_FAILED) if the key is malformed or the watch rejects it
     * @throws WatchException on any other failure; the client is closed then
     */
    suspend fun connect() {
        check(started.compareAndSet(false, true)) { "a WatchClient connects only once; create a new one" }
        setState(LinkState.CONNECTING)
        scope.launch { _info.drop(1).collect { listener.onInfo(it) } }
        try {
            val key = try {
                XiaomiAuth.parseKey(authKeyHex)
            } catch (e: IllegalArgumentException) {
                throw WatchAuthException("the auth key is not 32 hex characters")
            }
            val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
            if (adapter == null || !adapter.isEnabled) throw WatchException("Bluetooth is off or unavailable")

            val socket = Rfcomm.open(adapter, address)
            val auth = XiaomiAuth(key, CompanionInfo(Build.VERSION.SDK_INT, Build.MODEL ?: "Android", region()))
            val transport = SppTransport(socket.inputStream, socket.outputStream, auth, scope)
            val session = CommandSession(transport) { block -> scope.launch { runCatching { block() }.onFailure { WatchLog.w("background task failed", it) } } }
            val authService = AuthService(session, auth)
            val system = SystemService(session, _info, listener)
            val weather = WeatherService(session, listener)
            val notifications = NotificationService(session, listener)
            val music = MusicService(session, listener)
            val health = HealthService(session, scope, phoneGps, _liveHeartRate, _liveWorkout)
            listOf(authService, system, weather, notifications, music, health).forEach(session::register)

            transport.onPayload = { channel, payload ->
                when (channel) {
                    Channel.ProtobufCommand -> session.handleCommandBytes(payload)
                    Channel.Activity -> health.onActivityChunk(payload)
                    else -> WatchLog.w("unhandled payload on $channel: ${payload.toHexCapped(128)}")
                }
            }
            transport.onHandshakeReady = { authService.start() }
            transport.onClosed = { cause -> onLinkClosed(cause, authService) }
            link = Link(socket, transport, session, authService, system, notifications, weather, music, health)

            setState(LinkState.AUTHENTICATING)
            transport.start()
            withTimeoutOrNull(AUTH_TIMEOUT_MS) { authService.result.await() }
                ?: throw WatchTimeoutException("the watch did not complete authentication within ${AUTH_TIMEOUT_MS / 1000} s")

            initialise(system, weather, session)
            setState(LinkState.CONNECTED)
            scope.launch { pollBattery(system) }
        } catch (e: CancellationException) {
            teardown()
            throw e
        } catch (e: WatchAuthException) {
            WatchLog.e("connect failed: ${e.message}")
            teardown()
            setState(LinkState.AUTH_FAILED, e.message)
            throw e
        } catch (e: Exception) {
            WatchLog.e("connect failed: ${e.message}", e)
            teardown()
            setState(LinkState.DISCONNECTED, e.message)
            throw if (e is WatchException) e else WatchException(e.message ?: e.javaClass.simpleName, e)
        }
    }

    /** Returns when the link has dropped or [close] was called. */
    suspend fun awaitDisconnect() = disconnected.await()

    /** Ends the connection and releases the socket and all coroutines. Safe to call more than once. */
    fun close() {
        teardown()
        if (_state.value != LinkState.AUTH_FAILED) setState(LinkState.DISCONNECTED)
    }

    suspend fun syncTime() = requireLink().system.setTime(ZonedDateTime.now(), DateFormat.is24HourFormat(appContext))

    suspend fun sendNotification(n: PhoneNotification) = requireLink().notifications.send(n)

    suspend fun dismissNotification(key: String) = requireLink().notifications.dismiss(key)

    suspend fun incomingCall(callerName: String?, number: String?) = requireLink().notifications.incomingCall(callerName, number)

    suspend fun callEnded() = requireLink().notifications.callEnded()

    suspend fun sendWeather(report: WeatherReport) = requireLink().weather.send(report)

    suspend fun sendNowPlaying(np: NowPlaying) = requireLink().music.send(np)

    suspend fun findWatch(start: Boolean) = requireLink().system.findWatch(start)

    /** Clears the "find my phone" screen on the watch once the phone stopped ringing. */
    suspend fun stopFindPhone() = requireLink().system.stopFindPhoneOnWatch()

    /** Starts the watch's realtime heart-rate stream; readings arrive on [liveHeartRate]. */
    fun startLiveHeartRate() = requireLink().health.enableRealtimeStats(true)

    /** Stops the realtime stream. Safe when the link is already gone. */
    fun stopLiveHeartRate() {
        _liveHeartRate.value = null
        link?.health?.enableRealtimeStats(false)
    }

    suspend fun readHealthSettings(): HealthSettings? = requireLink().health.readSettings()

    suspend fun applyHealthSettings(settings: HealthSettings) = requireLink().health.applySettings(settings)

    /**
     * Fetches every activity file the watch holds, oldest first. For each: the raw bytes are stored in
     * `raw_files` first, then the watch is told to delete its copy (as Gadgetbridge does once the CRC
     * checks out), then the file is parsed and written through [HealthStore]. A file that fails to parse
     * stays in `raw_files` with its error and never blocks the others; a file that fails its CRC is not
     * acked, so the watch offers it again next time.
     *
     * [SyncSummary.files] counts files parsed and written; `failed` counts files that did not arrive
     * intact or did not parse.
     */
    suspend fun fetchActivity(): SyncSummary = fetchMutex.withLock {
        val health = requireLink().health
        val ids = health.listFiles()
        WatchLog.i("activity: watch offers ${ids.size} file(s)")
        val tally = Tally()
        for (offered in ids) {
            requireLink()
            when (val result = health.download(offered)) {
                is ActivityFileReceiver.Result.Complete -> {
                    val raw = RawFileEntity(
                        fileId = result.id.hex,
                        timestamp = result.id.timestamp,
                        type = result.id.type,
                        subtype = result.id.subtype,
                        detailType = result.id.detailType,
                        version = result.id.version,
                        fetchedAt = System.currentTimeMillis(),
                        bytes = result.data,
                        parsed = false,
                    )
                    val stored = try {
                        db.sync().putRawFile(raw)
                        true
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        WatchLog.e("cannot store raw file ${result.id.describe()}, not acking it", e)
                        false
                    }
                    if (stored) {
                        health.ack(result.id)
                        processRaw(raw, result.id, tally)
                    } else {
                        tally.failed++
                    }
                }
                is ActivityFileReceiver.Result.Rejected -> {
                    tally.failed++
                    WatchLog.w("activity: ${offered.describe()} rejected, not acked: ${result.reason} ${result.data?.toHexCapped(64).orEmpty()}")
                }
                ActivityFileReceiver.Result.Partial -> tally.failed++
            }
        }
        tally.summary().also {
            WatchLog.i("activity sync done: $it")
            listener.onActivitySynced(it)
        }
    }

    /** Runs the parsers again over every stored raw file, e.g. after a parser fix. Needs no watch connection. */
    suspend fun reparseStoredFiles(): SyncSummary = fetchMutex.withLock {
        val tally = Tally()
        val ids = db.sync().rawFileIds()
            .mapNotNull { hex -> runCatching { hex to ActivityFileId.fromBytes(hex.hexToBytes()) }.getOrNull() }
            .sortedWith(compareBy(HealthService.FETCH_ORDER) { it.second })
        for ((hex, id) in ids) {
            val raw = db.sync().rawFile(hex) ?: continue
            processRaw(raw, id, tally)
        }
        tally.summary().also { WatchLog.i("reparse done: $it") }
    }

    private class Tally(var files: Int = 0, var samples: Int = 0, var sessions: Int = 0, var failed: Int = 0) {
        fun summary() = SyncSummary(files, samples, sessions, failed)
    }

    /** Parses [raw], writes the result, and records success or the parse error on the raw row. */
    private suspend fun processRaw(raw: RawFileEntity, id: ActivityFileId, tally: Tally) {
        try {
            val parsed = withContext(Dispatchers.Default) { ActivityParsers.parse(id, raw.bytes) }
            val sessions = parsed.sessions.map { ActivityParsers.mergeSession(db.sync().session(it.id), it) }
            HealthStore(db).write(parsed.samples, sessions)
            db.sync().putRawFile(raw.copy(parsed = true, parseError = null))
            tally.files++
            tally.samples += parsed.samples.size
            tally.sessions += sessions.size
            WatchLog.d("parsed ${id.describe()}: ${parsed.samples.size} samples, ${sessions.size} sessions")
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            tally.failed++
            WatchLog.e("cannot parse ${id.describe()} (${raw.bytes.size}B): ${raw.bytes.toHexCapped(128)}", e)
            try {
                db.sync().putRawFile(raw.copy(parsed = false, parseError = "${e.javaClass.simpleName}: ${e.message}".take(500)))
            } catch (inner: Exception) {
                if (inner is CancellationException) throw inner
                WatchLog.e("cannot record the parse error for ${id.describe()}", inner)
            }
        }
    }

    // --- connection internals ---

    private suspend fun initialise(system: SystemService, weather: WeatherService, session: CommandSession) {
        system.setTime(ZonedDateTime.now(), DateFormat.is24HourFormat(appContext))
        weather.initialize()
        // Device info and battery are best effort: a slow answer must not fail the connection.
        for (subtype in listOf(SystemService.CMD_DEVICE_INFO, SystemService.CMD_BATTERY)) {
            try {
                session.request(SystemService.COMMAND_TYPE, subtype)
            } catch (e: WatchTimeoutException) {
                WatchLog.w("no reply to system command $subtype during init")
            }
        }
        system.requestBattery()
    }

    private suspend fun pollBattery(system: SystemService) {
        while (link != null) {
            delay(BATTERY_POLL_MS)
            if (link != null) system.requestBattery()
        }
    }

    private fun onLinkClosed(cause: Throwable?, authService: AuthService) {
        WatchLog.i("link closed${cause?.message?.let { ": $it" } ?: ""}")
        authService.result.completeExceptionally(WatchException("link closed${cause?.message?.let { ": $it" } ?: ""}", cause))
        link?.session?.onDisconnect()
        link = null
        _liveHeartRate.value = null
        _liveWorkout.value = null
        if (_state.value != LinkState.AUTH_FAILED) setState(LinkState.DISCONNECTED, cause?.message)
        disconnected.complete(Unit)
    }

    private fun teardown() {
        if (!closed.compareAndSet(false, true)) return
        val l = link
        link = null
        l?.transport?.close()
        try {
            l?.socket?.close()
        } catch (_: IOException) {
        }
        scope.cancel()
        disconnected.complete(Unit)
    }

    private fun requireLink(): Link {
        val l = link
        if (l == null || _state.value != LinkState.CONNECTED) throw WatchException("the watch is not connected")
        return l
    }

    private fun setState(state: LinkState, detail: String? = null) {
        val changed = _state.value != state
        _state.value = state
        if (changed || detail != null) {
            WatchLog.i("state -> $state${detail?.let { " ($it)" } ?: ""}")
            listener.onState(state, detail)
        }
    }

    private fun region(): String = Locale.getDefault().language.take(2).uppercase(Locale.ROOT).ifEmpty { "EN" }

    private companion object {
        const val AUTH_TIMEOUT_MS = 25_000L
        const val BATTERY_POLL_MS = 10 * 60_000L
    }
}
