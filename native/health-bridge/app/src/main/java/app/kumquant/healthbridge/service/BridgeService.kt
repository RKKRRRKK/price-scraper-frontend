package app.kumquant.healthbridge.service

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.BridgeState
import app.kumquant.healthbridge.BuildConfig
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.MainActivity
import app.kumquant.healthbridge.scale.BodyProfile
import app.kumquant.healthbridge.scale.ScaleHistory
import app.kumquant.healthbridge.scale.ScaleScanner
import app.kumquant.healthbridge.upload.UploadWorker
import app.kumquant.healthbridge.watch.HealthSettings
import app.kumquant.healthbridge.watch.LinkState
import app.kumquant.healthbridge.watch.MusicCommand
import app.kumquant.healthbridge.watch.NowPlaying
import app.kumquant.healthbridge.watch.PhoneNotification
import app.kumquant.healthbridge.watch.SyncSummary
import app.kumquant.healthbridge.watch.WatchClient
import app.kumquant.healthbridge.watch.WatchInfo
import app.kumquant.healthbridge.watch.WatchListener
import app.kumquant.healthbridge.weather.WeatherProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The always-on watch link: a connectedDevice foreground service that keeps a [WatchClient]
 * connected (backing off from 5 s to 5 min), syncs time, health settings and weather on every
 * connect, fetches activity on a timer and kicks the upload afterwards. It also runs the
 * scale scanner and the call monitor, and is the single entry point other parts of the app
 * use to talk to the watch.
 */
class BridgeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val prefs get() = HealthBridgeApp.prefs
    private val db get() = HealthBridgeApp.db

    @Volatile private var client: WatchClient? = null
    private var loop: Job? = null
    private val nudge = Channel<Unit>(Channel.CONFLATED)
    private val fetchLock = Mutex()
    private var wakeLock: PowerManager.WakeLock? = null

    private var scanner: ScaleScanner? = null
    private var scanning = false
    private var calls: CallMonitor? = null
    private var locationForeground = false
    private var liveHrWanted = false
    private var liveHrCap: Job? = null
    private val gps = WorkoutGps(this) { on -> setLocationForeground(on) }

    val isConnected: Boolean get() = client?.state?.value == LinkState.CONNECTED

    private val listener = object : WatchListener {
        override fun onState(state: LinkState, detail: String?) {
            BridgeState.setLink(state)
            if (state == LinkState.AUTH_FAILED) BridgeState.error(detail ?: "The watch rejected the auth key.")
            else if (detail != null) Log.i(TAG, "Link $state: $detail")
        }

        override fun onInfo(info: WatchInfo) = BridgeState.setInfo(info)

        override fun onFindPhone(start: Boolean) {
            if (start) FindPhone.start(this@BridgeService) else FindPhone.stop(this@BridgeService, fromWatch = true)
        }

        override fun onMusicCommand(command: MusicCommand) {
            val music = NotificationForwarder.current?.music
            if (music != null) music.command(command) else MusicBridge.fallback(this@BridgeService, command)
        }

        override fun onCallAction(reject: Boolean) {
            if (reject) calls?.reject() else calls?.silence()
        }

        override fun onNotificationDismissed(key: String) {
            NotificationForwarder.current?.dismissFromWatch(key)
        }

        override fun onWeatherRequested() {
            scope.launch { refreshWeather() }
        }

        override fun onMusicInfoRequested() {
            val np = NotificationForwarder.current?.music?.nowPlaying()
                ?: NowPlaying(false, null, null, null, null, null, null)
            nowPlaying(np)
        }

        override fun onActivitySynced(summary: SyncSummary) = recordSync(summary)
    }

    private val timeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.i(TAG, "Clock changed (${intent.action}); re-syncing watch time")
            withClient { syncTime() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        current = this
        if (!enterForeground()) {
            stopSelf()
            return
        }

        ContextCompat.registerReceiver(
            this, timeReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_TIMEZONE_CHANGED)
                addAction(Intent.ACTION_TIME_CHANGED)
            },
            ContextCompat.RECEIVER_EXPORTED,
        )

        scope.launch {
            combine(BridgeState.link, BridgeState.info) { l, i -> l to i }.distinctUntilChanged().collect { updateNotification() }
        }
        prefs.watchAddress?.let { observePresence(this, it) }
        startScale()
        calls = CallMonitor(this).also { it.start() }
        startLoop()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_FIND_PHONE -> FindPhone.stop(this)
            ACTION_RECONNECT -> startLoop()
            ACTION_REPARSE -> reparse()
            ACTION_SCALE_HISTORY -> scaleHistory()
            else -> nudge.trySend(Unit)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (current === this) current = null
        runCatching { unregisterReceiver(timeReceiver) }
        scanner?.stop()
        calls?.stop()
        loop?.cancel()
        client?.close()
        BridgeState.setLiveHrOn(false)
        scope.cancel()
        wakeLock?.takeIf { it.isHeld }?.release()
        BridgeState.setLink(LinkState.DISCONNECTED)
        super.onDestroy()
    }

    // ---- connection ----------------------------------------------------------------------

    fun startLoop() {
        loop?.cancel()
        client?.close()
        loop = scope.launch { connectLoop() }
    }

    private suspend fun connectLoop() {
        var backoff = MIN_BACKOFF
        while (true) {
            val address = prefs.watchAddress
            if (address == null) {
                BridgeState.setLink(LinkState.DISCONNECTED)
                stopSelf()
                return
            }
            val key = BuildConfig.WATCH_AUTH_KEY
            if (key.isBlank()) {
                BridgeState.error("No watch auth key. Add watch.authKey to health.properties and rebuild.")
                return
            }
            if (!hasBluetoothPermission(this)) {
                BridgeState.error("Bluetooth permission is missing.")
            } else {
                val c = WatchClient(this, address, key, db, listener, gps)
                client = c
                var authFailed = false
                val mirror = scope.launch {
                    launch { c.state.collect { BridgeState.setLink(it) } }
                    launch { c.info.collect { BridgeState.setInfo(it) } }
                    launch { c.liveHeartRate.collect { BridgeState.setLiveHr(it) } }
                    launch { c.liveWorkout.collect { BridgeState.setLiveWorkout(it) } }
                }
                try {
                    c.connect()
                    backoff = MIN_BACKOFF
                    BridgeState.error(null)
                    coroutineScope {
                        val session = launch { runConnected(c) }
                        c.awaitDisconnect()
                        session.cancel()
                    }
                    Log.i(TAG, "Link dropped")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Connect failed: ${e.message}")
                    if (c.state.value == LinkState.AUTH_FAILED) {
                        authFailed = true
                        BridgeState.error("The watch rejected the auth key. Check watch.authKey in health.properties.")
                        problem("Watch key rejected", "Health Bridge stopped retrying. Fix the key, then tap Reconnect.")
                        return
                    }
                    BridgeState.error(e.message ?: e.javaClass.simpleName)
                } finally {
                    mirror.cancel()
                    BridgeState.setLiveHr(null)
                    BridgeState.setLiveWorkout(null)
                    c.close()
                    if (client === c) client = null
                    BridgeState.setLink(if (authFailed) LinkState.AUTH_FAILED else LinkState.DISCONNECTED)
                }
            }
            withTimeoutOrNull(backoff) { nudge.receive() }
            backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF)
        }
    }

    /** Everything that happens once per connection, until it drops. */
    private suspend fun runConnected(c: WatchClient) = coroutineScope {
        step("sync time") { c.syncTime() }
        if (liveHrWanted) step("live heart rate") { c.startLiveHeartRate() }
        step("health settings") { applySettings(c) }
        step("weather") { refreshWeather(c) }
        fetch(c)

        launch {
            while (true) {
                delay(prefs.syncIntervalMin.coerceAtLeast(1) * 60_000L)
                fetch(c)
            }
        }
        launch {
            while (true) {
                delay(WEATHER_INTERVAL)
                step("weather") { refreshWeather(c) }
            }
        }
    }

    private suspend fun step(name: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "$name failed: ${e.message}")
            BridgeState.error("$name failed: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    // ---- activity sync -------------------------------------------------------------------

    private suspend fun fetch(c: WatchClient) = fetchLock.withLock {
        val wl = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "healthbridge:fetch")
        wl.acquire(FETCH_WAKELOCK_MS)
        BridgeState.setSyncing(true)
        try {
            recordSync(c.fetchActivity())
            UploadWorker.kick(this)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Fetch failed: ${e.message}", e)
            BridgeState.error("Sync failed: ${e.message ?: e.javaClass.simpleName}")
        } finally {
            BridgeState.setSyncing(false)
            if (wl.isHeld) wl.release()
        }
    }

    private fun recordSync(summary: SyncSummary) = BridgeState.synced(System.currentTimeMillis(), summary)

    /** Sync now (button). */
    fun syncNow() {
        val c = client?.takeIf { isConnected } ?: return
        scope.launch { fetch(c) }
    }

    /** The phone stopped ringing on its own (Stop button, timeout): clear "finding phone" on the watch. */
    fun stopFindPhoneOnWatch() {
        val c = client?.takeIf { isConnected } ?: return
        scope.launch { runCatching { c.stopFindPhone() }.onFailure { Log.w(TAG, "stop find-phone on watch: ${it.message}") } }
    }

    /** Re-run the parsers over stored raw files (debug action); needs no watch link. */
    /**
     * Debug: imports `files/zepp_body.csv` (a Zepp Life BODY export pushed over adb) if present, then
     * recomputes the scale's own weigh-ins with the current formulas.
     */
    private fun scaleHistory() {
        scope.launch {
            try {
                val file = java.io.File(filesDir, ZEPP_IMPORT_FILE)
                if (file.exists()) {
                    val result = ScaleHistory.importZepp(db, file.readText())
                    Log.i(TAG, "Zepp Life import: $result")
                    file.delete()
                }
                BodyProfile.fromBuildConfig()?.let { Log.i(TAG, "recomputed ${ScaleHistory.recompute(db, it)} weigh-in(s)") }
                UploadWorker.kick(this@BridgeService)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "scale history failed", e)
            }
        }
    }

    fun reparse() {
        val c = client ?: offlineClient(this)
        scope.launch {
            fetchLock.withLock {
                BridgeState.setSyncing(true)
                try {
                    recordSync(c.reparseStoredFiles())
                    UploadWorker.kick(this@BridgeService)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    BridgeState.error("Re-parse failed: ${e.message ?: e.javaClass.simpleName}")
                } finally {
                    BridgeState.setSyncing(false)
                }
            }
        }
    }

    // ---- watch settings ------------------------------------------------------------------

    private suspend fun applySettings(c: WatchClient) {
        // Fill choices the user hasn't made yet from the watch, then push ours.
        c.readHealthSettings()?.let { cur ->
            if (prefs.sleepHighAccuracy == null) prefs.sleepHighAccuracy = cur.sleepHighAccuracy
            if (prefs.stressMonitoring == null) prefs.stressMonitoring = cur.stressMonitoring
            if (prefs.spo2AllDay == null) prefs.spo2AllDay = cur.spo2AllDay
        }
        c.applyHealthSettings(
            HealthSettings(
                hrIntervalMin = prefs.hrIntervalMin,
                sleepHighAccuracy = prefs.sleepHighAccuracy,
                stressMonitoring = prefs.stressMonitoring,
                spo2AllDay = prefs.spo2AllDay,
            )
        )
    }

    /** Pushes the stored health settings to the watch if connected; otherwise they apply on the next connect. */
    fun applySettings() {
        val c = client?.takeIf { isConnected } ?: return
        scope.launch { step("health settings") { applySettings(c) } }
    }

    // ---- weather -------------------------------------------------------------------------

    private suspend fun refreshWeather(c: WatchClient? = client?.takeIf { isConnected }) {
        c ?: return
        val report = WeatherProvider(this).report()
        if (report == null) {
            Log.i(TAG, "No location yet; weather skipped")
            return
        }
        c.sendWeather(report)
    }

    fun refreshWeatherNow() {
        scope.launch { step("weather") { refreshWeather() } }
    }

    // ---- scale ---------------------------------------------------------------------------

    private fun startScale() {
        scope.launch { prefs.observe { scaleEnabled }.collect { evalScale() } }
    }

    /** Starts or stops the scale scan to match the toggle and the scan permission. */
    @Synchronized
    private fun evalScale() {
        if (prefs.scaleEnabled && hasScanPermission(this)) {
            if (scanner == null) {
                val s = ScaleScanner(this, db, BodyProfile.fromBuildConfig(), prefs)
                scanner = s
                scope.launch {
                    s.lastWeighIn.collect { w ->
                        BridgeState.setWeighIn(w)
                        if (w != null) UploadWorker.kick(this@BridgeService)
                    }
                }
            }
            if (!scanning) { scanner?.start(); scanning = true }
        } else if (scanning) {
            scanner?.stop()
            scanning = false
        }
    }

    /** Called after the user grants a permission, so scanning and call alerts pick it up without a restart. */
    fun onPermissionsChanged() {
        evalScale()
        calls?.stop()
        calls = CallMonitor(this).also { it.start() }
    }

    // ---- live heart rate (the Exercises tab) -----------------------------------------------

    /** Starts the watch's realtime heart-rate stream; it also resumes after a reconnect until [stopLiveHeartRate]. */
    fun startLiveHeartRate() {
        liveHrWanted = true
        BridgeState.setLiveHrOn(true)
        liveHrCap?.cancel()
        // Safety net: the stream drains the watch, so it never outlives a forgotten screen.
        liveHrCap = scope.launch {
            delay(LIVE_HR_CAP)
            stopLiveHeartRate()
        }
        withClient { startLiveHeartRate() }
    }

    fun stopLiveHeartRate() {
        liveHrWanted = false
        BridgeState.setLiveHrOn(false)
        liveHrCap?.cancel()
        BridgeState.setLiveHr(null)
        client?.stopLiveHeartRate()
    }

    // ---- calls to the watch (used by the listeners and the UI) ---------------------------

    private fun withClient(block: suspend WatchClient.() -> Unit) {
        val c = client?.takeIf { isConnected } ?: return
        scope.launch {
            try {
                c.block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Watch command failed: ${e.message}")
            }
        }
    }

    fun forward(n: PhoneNotification) = withClient { sendNotification(n) }
    fun dismiss(key: String) = withClient { dismissNotification(key) }
    private var lastNowPlaying: NowPlaying? = null
    private var lastNowPlayingAt = 0L

    /** Media callbacks and the watch's own requests often fire in bursts; identical info goes out once a second at most. */
    @Synchronized
    fun nowPlaying(np: NowPlaying) {
        val now = SystemClock.elapsedRealtime()
        if (np == lastNowPlaying && now - lastNowPlayingAt < 1_000) return
        lastNowPlaying = np
        lastNowPlayingAt = now
        withClient { sendNowPlaying(np) }
    }
    fun incomingCall(name: String?, number: String?) = withClient { incomingCall(name, number) }
    fun callEnded() = withClient { callEnded() }
    fun findWatch(start: Boolean) = withClient { findWatch(start) }

    // ---- notification --------------------------------------------------------------------

    private fun enterForeground(): Boolean = try {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), foregroundType())
        true
    } catch (e: Exception) {
        Log.w(TAG, "Could not start in the foreground: ${e.message}")
        false
    }

    /** `location` is added only while a GPS workout runs and the permission is granted; Android throws otherwise. */
    private fun foregroundType(): Int {
        if (Build.VERSION.SDK_INT < 29) return 0
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        if (locationForeground && WorkoutGps.hasFineLocation(this)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        return type
    }

    /** Widens or narrows the foreground type for a GPS workout; false if Android refused the wider one. */
    @Synchronized
    private fun setLocationForeground(on: Boolean): Boolean {
        if (locationForeground == on) return true
        if (Build.VERSION.SDK_INT < 29) return on
        locationForeground = on
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), foregroundType())
            Log.i(TAG, "Foreground type ${if (on) "now includes" else "no longer includes"} location")
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not change the foreground type: ${e.message}")
            locationForeground = false
            if (on) runCatching { ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), foregroundType()) }
            false
        }
    }

    private fun buildNotification(): Notification {
        val link = BridgeState.link.value
        val battery = BridgeState.info.value.batteryPct
        val text = when (link) {
            LinkState.CONNECTED -> "Connected" + (battery?.let { " · watch $it%" } ?: "")
            LinkState.CONNECTING, LinkState.AUTHENTICATING -> "Connecting to the watch…"
            LinkState.AUTH_FAILED -> "The watch rejected the key"
            LinkState.DISCONNECTED -> "Waiting for the watch"
        }
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, HealthBridgeApp.CHANNEL_LINK)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("Health Bridge")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
    }

    private fun problem(title: String, text: String) {
        val open = PendingIntent.getActivity(
            this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, HealthBridgeApp.CHANNEL_PROBLEMS)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(PROBLEM_ID, n) }
    }

    companion object {
        private const val TAG = "HbBridge"
        const val ACTION_STOP_FIND_PHONE = "app.kumquant.healthbridge.STOP_FIND_PHONE"
        const val ACTION_RECONNECT = "app.kumquant.healthbridge.RECONNECT"
        /** Debug: `adb shell am start -n app.kumquant.healthbridge/.MainActivity --es hb_debug reparse` */
        const val ACTION_REPARSE = "app.kumquant.healthbridge.REPARSE"
        /** Debug: `adb shell am start -n app.kumquant.healthbridge/.MainActivity --es hb_debug scale_history` */
        const val ACTION_SCALE_HISTORY = "app.kumquant.healthbridge.SCALE_HISTORY"
        const val ZEPP_IMPORT_FILE = "zepp_body.csv"
        private const val NOTIFICATION_ID = 20
        private const val PROBLEM_ID = 23
        private const val MIN_BACKOFF = 5_000L
        private const val MAX_BACKOFF = 5 * 60_000L
        private const val WEATHER_INTERVAL = 60 * 60_000L
        private const val FETCH_WAKELOCK_MS = 10 * 60_000L
        private const val LIVE_HR_CAP = 15 * 60_000L

        @Volatile var current: BridgeService? = null
            private set

        /** A client that never connects; re-parsing only touches the local DB. */
        private fun offlineClient(context: Context) =
            WatchClient(context, "", "", HealthBridgeApp.db, object : WatchListener {})

        /** Re-parses stored raw files when the service isn't running (no watch paired or in range). */
        suspend fun reparseOffline(context: Context) {
            BridgeState.setSyncing(true)
            try {
                BridgeState.synced(System.currentTimeMillis(), offlineClient(context).reparseStoredFiles())
                UploadWorker.kick(context)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                BridgeState.error("Re-parse failed: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                BridgeState.setSyncing(false)
            }
        }

        /** Starts the service if a watch is associated. Safe to call from anywhere; failures are logged. */
        fun start(context: Context, action: String? = null) {
            if (HealthBridgeApp.prefs.watchAddress == null) return
            try {
                ContextCompat.startForegroundService(context, Intent(context, BridgeService::class.java).setAction(action))
            } catch (e: Exception) {
                Log.w(TAG, "Could not start the service: ${e.message}")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, BridgeService::class.java))
        }

        /** Drops the current link and connects again from scratch (also clears an AUTH_FAILED stop). */
        fun reconnect(context: Context) {
            val running = current
            if (running != null) running.startLoop() else start(context, ACTION_RECONNECT)
        }

        fun hasBluetoothPermission(context: Context) =
            Build.VERSION.SDK_INT < 31 ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

        fun hasScanPermission(context: Context) =
            if (Build.VERSION.SDK_INT >= 31) {
                ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
            } else {
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            }

        /** Android 12+: have the system wake us when the associated watch comes in range. */
        fun observePresence(context: Context, address: String) {
            if (Build.VERSION.SDK_INT < 31) return
            runCatching {
                context.getSystemService(android.companion.CompanionDeviceManager::class.java).startObservingDevicePresence(address)
            }.onFailure { Log.w(TAG, "startObservingDevicePresence failed: ${it.message}") }
        }
    }
}
