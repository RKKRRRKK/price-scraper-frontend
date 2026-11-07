package app.kumquant.healthbridge.watch.health

import app.kumquant.healthbridge.proto.xiaomi.ActivitySyncRequestToday
import app.kumquant.healthbridge.proto.xiaomi.AdvancedMonitoring
import app.kumquant.healthbridge.proto.xiaomi.Health
import app.kumquant.healthbridge.proto.xiaomi.HeartRate
import app.kumquant.healthbridge.proto.xiaomi.RelaxReminder
import app.kumquant.healthbridge.proto.xiaomi.SpO2
import app.kumquant.healthbridge.proto.xiaomi.Spo2AlarmLow
import app.kumquant.healthbridge.proto.xiaomi.Spo2Mode
import app.kumquant.healthbridge.proto.xiaomi.Stress
import app.kumquant.healthbridge.proto.xiaomi.WorkoutLocation
import app.kumquant.healthbridge.proto.xiaomi.WorkoutOpenReply
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.CommandChannel
import app.kumquant.healthbridge.watch.HealthSettings
import app.kumquant.healthbridge.watch.LiveHeartRate
import app.kumquant.healthbridge.watch.LiveWorkout
import app.kumquant.healthbridge.watch.LocationFix
import app.kumquant.healthbridge.watch.PhoneGps
import app.kumquant.healthbridge.watch.WatchException
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.WatchTimeoutException
import app.kumquant.healthbridge.watch.XiaomiService
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.send
import app.kumquant.healthbridge.watch.toHex
import app.kumquant.healthbridge.watch.toHexCapped
import com.google.protobuf.ByteString
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.EnumSet
import java.util.concurrent.atomic.AtomicInteger

/**
 * Health settings, activity-file transfer, the realtime heart-rate stream and live workouts (command
 * type 8). Ported from the relevant parts of Gadgetbridge's XiaomiHealthService and
 * XiaomiActivityFileFetcher. Goals, standing reminders, vitality score and Sleep-as-Android are not ported.
 *
 * Live state goes out through [liveHeartRate] and [liveWorkout]; the per-second values are never stored.
 * When the watch opens an outdoor workout and [phoneGps] can deliver fixes, the phone answers "GPS
 * available" with its first fix and then streams fixes until the workout ends, as Gadgetbridge does;
 * otherwise (or if no fix arrives in time) it answers "no phone GPS" and the watch uses its own.
 */
internal class HealthService(
    private val channel: CommandChannel,
    private val scope: CoroutineScope,
    private val phoneGps: PhoneGps? = null,
    private val liveHeartRate: MutableStateFlow<LiveHeartRate?> = MutableStateFlow(null),
    private val liveWorkout: MutableStateFlow<LiveWorkout?> = MutableStateFlow(null),
    private val clock: () -> Long = System::currentTimeMillis,
) : XiaomiService(COMMAND_TYPE) {

    private val receiver = ActivityFileReceiver()
    private val chunkCount = AtomicInteger(0)

    @Volatile
    private var pendingFile: CompletableDeferred<ActivityFileReceiver.Result>? = null

    /** The band has one realtime stream; it runs while any consumer wants it. */
    internal enum class RealtimeConsumer { UI, ONE_SHOT }

    private val realtimeConsumers = EnumSet.noneOf(RealtimeConsumer::class.java)

    private val lock = Any()
    private val workout = WorkoutLive(clock)
    private var gpsStarted = false
    private var gpsFixAcquired = false
    private var workoutStarted = false
    private var locationRequested = false
    private var locationWorkoutOpen = false
    private var openTimer: Job? = null
    private var ticker: Job? = null
    private var phoneStatsLogged = 0

    override fun handle(cmd: XiaomiProto.Command) {
        when (cmd.subtype) {
            CMD_ACTIVITY_FETCH_TODAY, CMD_ACTIVITY_FETCH_PAST -> Unit // consumed by the request() waiting for it
            CMD_ACTIVITY_FETCH_REQUEST, CMD_ACTIVITY_FETCH_ACK, CMD_SET_USER_INFO, CMD_CONFIG_SPO2_SET,
            CMD_CONFIG_HEART_RATE_SET, CMD_CONFIG_STRESS_SET, CMD_REALTIME_STATS_START, CMD_REALTIME_STATS_STOP ->
                WatchLog.d("health reply ${cmd.subtype}, status=${if (cmd.hasStatus()) cmd.status else 0}")
            CMD_CONFIG_SPO2_GET, CMD_CONFIG_HEART_RATE_GET, CMD_CONFIG_STRESS_GET, CMD_CONFIG_STANDING_REMINDER_GET,
            CMD_CONFIG_GOAL_NOTIFICATION_GET, CMD_CONFIG_GOALS_GET, CMD_CONFIG_VITALITY_SCORE_GET ->
                WatchLog.d("health config ${cmd.subtype} received")
            CMD_WORKOUT_WATCH_OPEN -> handleWorkoutOpen(cmd)
            CMD_WORKOUT_WATCH_STATUS -> handleWorkoutStatus(cmd)
            CMD_WORKOUT_WATCH_STATUS_V2 -> handleWorkoutStatusV2(cmd)
            CMD_REALTIME_STATS_EVENT -> handleRealtimeStats(cmd)
            CMD_WEAR_SPORT_DATA_V2A -> handleWorkoutStats(cmd)
            CMD_WORKOUT_STATS_PHONE ->
                if (phoneStatsLogged++ < 3) WatchLog.i("workout stats 49: ${cmd.toByteArray().toHexCapped(64)}")
            CMD_RAW_SENSOR_BATCH, CMD_WORKOUT_LOCATION -> Unit
            else -> WatchLog.w("unhandled health command ${cmd.subtype}: ${cmd.toByteArray().toHexCapped(64)}")
        }
    }

    override fun onDisconnect() {
        synchronized(lock) {
            endLocationWorkout()
            ticker?.cancel()
            ticker = null
            workout.clear()
        }
        synchronized(realtimeConsumers) { realtimeConsumers.clear() }
        liveHeartRate.value = null
        liveWorkout.value = null
    }

    // --- realtime heart rate ---

    /** Starts or stops the live heart-rate stream on behalf of the UI. */
    fun enableRealtimeStats(enable: Boolean) = setRealtimeConsumer(RealtimeConsumer.UI, enable)

    /** A single measurement: the stream runs until the first valid reading. */
    fun heartRateTest() = setRealtimeConsumer(RealtimeConsumer.ONE_SHOT, true)

    private fun setRealtimeConsumer(consumer: RealtimeConsumer, enable: Boolean) {
        val streaming: Boolean
        synchronized(realtimeConsumers) {
            val was = realtimeConsumers.isNotEmpty()
            val changed = if (enable) realtimeConsumers.add(consumer) else realtimeConsumers.remove(consumer)
            streaming = realtimeConsumers.isNotEmpty()
            if (!changed || was == streaming) return
        }
        WatchLog.i("realtime stats ${if (streaming) "start" else "stop"} (consumer $consumer ${if (enable) "on" else "off"})")
        if (!streaming) liveHeartRate.value = null
        sendRealtime(streaming)
    }

    private fun sendRealtime(enable: Boolean) =
        channel.send(COMMAND_TYPE, if (enable) CMD_REALTIME_STATS_START else CMD_REALTIME_STATS_STOP)

    private fun handleRealtimeStats(cmd: XiaomiProto.Command) {
        if (!cmd.hasHealth() || !cmd.health.hasRealTimeStats()) {
            WatchLog.w("realtime event without stats: ${cmd.toByteArray().toHexCapped(64)}")
            return
        }
        val stats = cmd.health.realTimeStats
        val noConsumers: Boolean
        val oneShot: Boolean
        synchronized(realtimeConsumers) {
            noConsumers = realtimeConsumers.isEmpty()
            oneShot = RealtimeConsumer.ONE_SHOT in realtimeConsumers
        }
        if (noConsumers) {
            // Out of sync with the watch (e.g. the app died while streaming): ask it to stop.
            WatchLog.w("realtime stats with no consumer, stopping the stream")
            sendRealtime(false)
            return
        }
        if (oneShot) {
            if (stats.heartRate <= MIN_VALID_BPM) return
            setRealtimeConsumer(RealtimeConsumer.ONE_SHOT, false)
        }
        WatchLog.d("live hr=${stats.heartRate} steps=${stats.steps} kcal=${stats.calories}")
        liveHeartRate.value = LiveHeartRate(
            bpm = if (stats.heartRate > MIN_VALID_BPM && stats.heartRate < 255) stats.heartRate else 0,
            steps = stats.steps,
            kcal = stats.calories,
            at = clock(),
        )
    }

    // --- live workouts ---

    private fun handleWorkoutStatus(cmd: XiaomiProto.Command) {
        val st = cmd.health.workoutStatusWatch
        WatchLog.i("workout status ${st.status} sport=${st.sport} raw=${cmd.toByteArray().toHexCapped(64)}")
        onWorkoutStatus(st.status, if (st.hasSport()) st.sport else null)
    }

    private fun handleWorkoutStatusV2(cmd: XiaomiProto.Command) {
        val st = cmd.health.workoutStatusWatchV2
        WatchLog.i("workout status v2 ${st.status} sport=${st.sport.type} raw=${cmd.toByteArray().toHexCapped(64)}")
        onWorkoutStatus(WorkoutLive.fromV2(st.status), if (st.hasSport()) st.sport.type else null)
    }

    internal fun onWorkoutStatus(status: Int, sport: Int?) {
        synchronized(lock) {
            liveWorkout.value = workout.onStatus(status, sport)
            when (status) {
                WorkoutLive.STARTED -> {
                    locationWorkoutOpen = locationRequested
                    locationRequested = false
                    workoutStarted = true
                    openTimer?.cancel()
                    // The open screen may have outlasted the open timer; the workout needs fixes now.
                    if (locationWorkoutOpen && !gpsStarted) startLocation()
                    startTicker()
                }
                WorkoutLive.FINISHED -> {
                    endLocationWorkout()
                    ticker?.cancel()
                    ticker = null
                }
            }
        }
    }

    private fun handleWorkoutStats(cmd: XiaomiProto.Command) {
        if (!cmd.hasHealth() || !cmd.health.hasWorkoutStatsWatch()) {
            WatchLog.w("workout stats without payload: ${cmd.toByteArray().toHexCapped(64)}")
            return
        }
        val x = cmd.health.workoutStatsWatch
        synchronized(lock) {
            liveWorkout.value = workout.onStats(
                heartRate = if (x.hasHeartRate()) x.heartRate else null,
                calories = if (x.hasCalories()) x.calories else null,
                stepCount = if (x.hasSteps()) x.steps else null,
                distance = if (x.hasDistance()) x.distance else null,
            )
            if (workout.isActive) {
                // A workout joined mid-way (after a reconnect) never sent a start status.
                if (ticker == null) startTicker()
                if (!workoutStarted && locationWorkoutOpen && canLocate()) {
                    WatchLog.i("watch is running a workout, resuming phone GPS")
                    workoutStarted = true
                    openTimer?.cancel()
                    startLocation()
                }
            }
        }
    }

    /** Advances elapsed time between stats, and ends a workout the watch has gone silent on. */
    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                delay(1_000)
                synchronized(lock) {
                    if (!workout.isActive) {
                        ticker = null
                        return@launch
                    }
                    if (clock() - workout.lastStatsAt > WORKOUT_ALIVE_TIMEOUT_MS) {
                        WatchLog.i("no workout stats for ${WORKOUT_ALIVE_TIMEOUT_MS / 1000} s, treating the workout as over")
                        workout.clear()
                        endLocationWorkout()
                        liveWorkout.value = null
                        ticker = null
                        return@launch
                    }
                    liveWorkout.value = workout.tick()
                }
            }
        }
    }

    private fun handleWorkoutOpen(cmd: XiaomiProto.Command) {
        val open = cmd.health.workoutOpenWatch
        WatchLog.i("watch opening workout sport=${open.sport} versions=${open.supportedVersions} raw=${cmd.toByteArray().toHexCapped(64)}")
        synchronized(lock) {
            if (!canLocate()) {
                WatchLog.i("no phone GPS available, telling the watch")
                channel.send(workoutOpenReply())
                return
            }
            locationRequested = true
            locationWorkoutOpen = true
            if (!startLocation()) {
                locationRequested = false
                locationWorkoutOpen = false
                channel.send(workoutOpenReply())
                return
            }
            if (!workoutStarted) armOpenTimer()
        }
    }

    private fun canLocate(): Boolean = phoneGps?.canLocate() == true

    /** Caller holds [lock]. */
    private fun startLocation(): Boolean {
        if (gpsStarted) return true
        val gps = phoneGps ?: return false
        gpsFixAcquired = false
        gpsStarted = gps.start(::onFix)
        if (gpsStarted) WatchLog.i("phone GPS started for the watch workout")
        return gpsStarted
    }

    /** Caller holds [lock]. */
    private fun stopLocation() {
        openTimer?.cancel()
        openTimer = null
        val was = gpsStarted
        gpsStarted = false
        gpsFixAcquired = false
        workoutStarted = false
        workout.phoneGps = false
        if (was) {
            phoneGps?.stop()
            WatchLog.i("phone GPS stopped")
        }
    }

    /** Caller holds [lock]. */
    private fun endLocationWorkout() {
        stopLocation()
        locationRequested = false
        locationWorkoutOpen = false
    }

    /**
     * Gives the phone a few seconds for a first fix; without one the watch is told there is no phone
     * GPS, as before GPS was ported, so it does not wait. Once a fix is in, a workout that never starts
     * is dropped after a longer idle time. Caller holds [lock].
     */
    private fun armOpenTimer() {
        openTimer?.cancel()
        openTimer = scope.launch {
            delay(if (gpsFixAcquired) OPEN_IDLE_MS else FIX_TIMEOUT_MS)
            synchronized(lock) {
                if (workoutStarted) return@launch
                if (!gpsFixAcquired) {
                    WatchLog.w("no phone GPS fix in ${FIX_TIMEOUT_MS / 1000} s, telling the watch to use its own")
                    channel.send(workoutOpenReply())
                }
                endLocationWorkout()
            }
        }
    }

    /** A fix from the phone (any thread): the first answers the watch's open, later ones go as locations. */
    private fun onFix(fix: LocationFix) {
        val first: Boolean
        val stream: Boolean
        synchronized(lock) {
            if (!gpsStarted) return
            first = !gpsFixAcquired
            gpsFixAcquired = true
            stream = workoutStarted
            if (first) {
                workout.phoneGps = true
                if (workout.isActive) liveWorkout.value = workout.tick()
                if (!workoutStarted) armOpenTimer()
            }
        }
        if (first) {
            WatchLog.i("first phone GPS fix, telling the watch GPS is available")
            channel.send(workoutOpenOkReply())
        }
        if (stream) channel.send(locationCommand(fix))
    }

    // --- activity files ---

    /** Called for every Activity-channel payload. Never blocks. */
    fun onActivityChunk(chunk: ByteArray) {
        chunkCount.incrementAndGet()
        val result = receiver.addChunk(chunk)
        if (result !is ActivityFileReceiver.Result.Partial) pendingFile?.complete(result)
    }

    /**
     * Ids of every file the watch holds: today's, then the past ones (two requests, as in
     * Gadgetbridge), oldest first with summaries before details and GPS tracks.
     * @throws WatchTimeoutException if the watch does not answer the first request
     */
    suspend fun listFiles(): List<ActivityFileId> {
        val today = channel.request(
            XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_ACTIVITY_FETCH_TODAY)
                .setHealth(Health.newBuilder().setActivitySyncRequestToday(ActivitySyncRequestToday.newBuilder().setUnknown1(0)))
                .build(),
            LIST_TIMEOUT_MS,
        )
        val past = try {
            channel.request(XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_ACTIVITY_FETCH_PAST).build(), LIST_TIMEOUT_MS)
        } catch (e: WatchTimeoutException) {
            WatchLog.w("no reply to the past-files request, syncing today's files only")
            null
        }
        val ids = parseFileIds(today) + (past?.let { parseFileIds(it) } ?: emptyList())
        return ids.distinct().sortedWith(FETCH_ORDER)
    }

    /**
     * Asks for one file and waits for its chunks; the wait restarts with each chunk, so only a stall of
     * [CHUNK_TIMEOUT_MS] gives up.
     */
    suspend fun download(id: ActivityFileId): ActivityFileReceiver.Result {
        val waiter = CompletableDeferred<ActivityFileReceiver.Result>()
        receiver.reset()
        pendingFile = waiter
        try {
            channel.send(
                XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_ACTIVITY_FETCH_REQUEST)
                    .setHealth(Health.newBuilder().setActivityRequestFileIds(ByteString.copyFrom(id.toBytes())))
                    .build(),
            )
            while (true) {
                val before = chunkCount.get()
                val result = withTimeoutOrNull(CHUNK_TIMEOUT_MS) { waiter.await() }
                if (result != null) return result
                if (chunkCount.get() == before) {
                    return ActivityFileReceiver.Result.Rejected("timed out waiting for ${id.describe()}", null)
                }
            }
        } finally {
            pendingFile = null
        }
    }

    /** Tells the watch it can delete the file. Only send once the bytes are safely stored. */
    fun ack(id: ActivityFileId) = channel.send(
        XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_ACTIVITY_FETCH_ACK)
            .setHealth(Health.newBuilder().setActivitySyncAckFileIds(ByteString.copyFrom(id.toBytes())))
            .build(),
    )

    // --- settings ---

    /** Reads the watch's heart-rate, SpO2 and stress config; null if it answers none of them. */
    suspend fun readSettings(): HealthSettings? {
        val hr = fetchConfig(CMD_CONFIG_HEART_RATE_GET)?.health?.takeIf { it.hasHeartRate() }?.heartRate
        val spo2 = fetchConfig(CMD_CONFIG_SPO2_GET)?.health?.takeIf { it.hasSpo2() }?.spo2
        val stress = fetchConfig(CMD_CONFIG_STRESS_GET)?.health?.takeIf { it.hasStress() }?.stress
        if (hr == null && spo2 == null && stress == null) return null
        return toSettings(hr, spo2, stress)
    }

    /**
     * Applies the non-null fields of [settings]. Each config is read from the watch first and written
     * back with only the wanted fields changed, so the watch's other options are preserved.
     */
    suspend fun applySettings(settings: HealthSettings) {
        if (settings.hrIntervalMin != null || settings.sleepHighAccuracy != null) {
            val base = fetchConfig(CMD_CONFIG_HEART_RATE_GET)?.health?.takeIf { it.hasHeartRate() }?.heartRate
            val hr = buildHeartRate(base, settings.hrIntervalMin, settings.sleepHighAccuracy)
            setConfig(CMD_CONFIG_HEART_RATE_SET, Health.newBuilder().setHeartRate(hr))
        }
        if (settings.spo2AllDay != null) {
            val base = fetchConfig(CMD_CONFIG_SPO2_GET)?.health?.takeIf { it.hasSpo2() }?.spo2
            if (base != null && base.allDayCapable == 0) {
                WatchLog.w("watch reports it cannot do all-day SpO2, not changing it")
            } else {
                setConfig(CMD_CONFIG_SPO2_SET, Health.newBuilder().setSpo2(buildSpo2(base, settings.spo2AllDay)))
            }
        }
        if (settings.stressMonitoring != null) {
            val base = fetchConfig(CMD_CONFIG_STRESS_GET)?.health?.takeIf { it.hasStress() }?.stress
            setConfig(CMD_CONFIG_STRESS_SET, Health.newBuilder().setStress(buildStress(base, settings.stressMonitoring)))
        }
    }

    private suspend fun fetchConfig(subtype: Int): XiaomiProto.Command? = try {
        channel.request(XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(subtype).build())
    } catch (e: WatchException) {
        WatchLog.w("health config $subtype not answered: ${e.message}")
        null
    }

    private suspend fun setConfig(subtype: Int, health: Health.Builder) {
        val reply = channel.request(
            XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(subtype).setHealth(health).build(),
        )
        if (reply.hasStatus() && reply.status != 0) throw WatchException("watch refused health config $subtype, status ${reply.status}")
        WatchLog.i("health config $subtype applied")
    }

    companion object {
        const val COMMAND_TYPE = 8

        const val CMD_SET_USER_INFO = 0
        const val CMD_ACTIVITY_FETCH_TODAY = 1
        const val CMD_ACTIVITY_FETCH_PAST = 2
        const val CMD_ACTIVITY_FETCH_REQUEST = 3
        const val CMD_ACTIVITY_FETCH_ACK = 5
        const val CMD_CONFIG_SPO2_GET = 8
        const val CMD_CONFIG_SPO2_SET = 9
        const val CMD_CONFIG_HEART_RATE_GET = 10
        const val CMD_CONFIG_HEART_RATE_SET = 11
        const val CMD_CONFIG_STANDING_REMINDER_GET = 12
        const val CMD_CONFIG_STRESS_GET = 14
        const val CMD_CONFIG_STRESS_SET = 15
        const val CMD_CONFIG_GOAL_NOTIFICATION_GET = 21
        const val CMD_WORKOUT_WATCH_STATUS = 26
        const val CMD_WORKOUT_WATCH_STATUS_V2 = 29
        const val CMD_WORKOUT_WATCH_OPEN = 30
        const val CMD_CONFIG_VITALITY_SCORE_GET = 35
        const val CMD_CONFIG_GOALS_GET = 42
        const val CMD_REALTIME_STATS_START = 45
        const val CMD_REALTIME_STATS_STOP = 46
        const val CMD_REALTIME_STATS_EVENT = 47
        const val CMD_WORKOUT_LOCATION = 48
        const val CMD_WORKOUT_STATS_PHONE = 49
        const val CMD_WEAR_SPORT_DATA_V2A = 50
        const val CMD_RAW_SENSOR_BATCH = 53

        const val WORKOUT_OPEN_OK = 0
        const val WORKOUT_OPEN_NO_PERMISSION = 3
        const val WORKOUT_PROTOCOL_VERSION = 2
        const val GPS_ACCURACY_HIGH = 2
        const val GPS_ACCURACY_UNKNOWN = 10

        /** The watch pushes stats every second while a workout is open; this long without any means it is over. */
        const val WORKOUT_ALIVE_TIMEOUT_MS = 60_000L
        const val FIX_TIMEOUT_MS = 8_000L
        const val OPEN_IDLE_MS = 120_000L

        /** Heart-rate readings at or below this are the sensor still measuring. */
        const val MIN_VALID_BPM = 10

        const val LIST_TIMEOUT_MS = 10_000L
        const val CHUNK_TIMEOUT_MS = 5_000L

        /** Gadgetbridge's order: time, then zone, type, subtype, summary before details before GPS, version. */
        val FETCH_ORDER: Comparator<ActivityFileId> = compareBy<ActivityFileId>(
            { it.timestamp }, { it.timezone }, { it.type }, { it.subtype }, { it.fetchOrder }, { it.version },
        )

        /** Splits the reply's concatenated 7-byte ids, skipping the empty placeholder id (no timestamp and no version). */
        fun parseFileIds(reply: XiaomiProto.Command): List<ActivityFileId> {
            val bytes = reply.health.activityRequestFileIds.toByteArray()
            if (bytes.size % ActivityFileId.SIZE != 0) {
                WatchLog.w("file id list of ${bytes.size}B is not a multiple of 7, ignoring: ${bytes.toHex()}")
                return emptyList()
            }
            return (bytes.indices step ActivityFileId.SIZE)
                .map { ActivityFileId.fromBytes(bytes, it) }
                .filter { id ->
                    (id.timestamp != 0L || id.version != 0).also { if (!it) WatchLog.w("skipping file id with no timestamp and version") }
                }
        }

        private fun workoutOpenReply(code: Int, accuracy: Int): XiaomiProto.Command =
            XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_WORKOUT_WATCH_OPEN)
                .setHealth(
                    Health.newBuilder().setWorkoutOpenReply(
                        WorkoutOpenReply.newBuilder()
                            .setCode(code)
                            .setSelectedVersion(WORKOUT_PROTOCOL_VERSION)
                            .setGpsAccuracy(accuracy),
                    ),
                )
                .build()

        /** The phone has no GPS to offer, so the watch uses its own. */
        fun workoutOpenReply(): XiaomiProto.Command = workoutOpenReply(WORKOUT_OPEN_NO_PERMISSION, GPS_ACCURACY_UNKNOWN)

        /** The phone has a GPS fix and will stream locations. */
        fun workoutOpenOkReply(): XiaomiProto.Command = workoutOpenReply(WORKOUT_OPEN_OK, GPS_ACCURACY_HIGH)

        fun locationCommand(fix: LocationFix): XiaomiProto.Command =
            XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_WORKOUT_LOCATION)
                .setHealth(
                    Health.newBuilder().setWorkoutLocation(
                        WorkoutLocation.newBuilder()
                            .setUnknown1(2)
                            .setTimestamp((fix.timeMs / 1000).toInt())
                            .setLongitude(fix.longitude)
                            .setLatitude(fix.latitude)
                            .setAltitude(fix.altitude)
                            .setSpeed(fix.speed)
                            .setBearing(fix.bearing),
                    ),
                )
                .build()

        /**
         * Heart-rate interval in minutes: 0 is the watch's "smart" mode, 1 is every minute. A disabled
         * monitor has no [HealthSettings] value and reads as null.
         */
        fun toSettings(hr: HeartRate?, spo2: SpO2?, stress: Stress?) = HealthSettings(
            hrIntervalMin = hr?.takeUnless { it.disabled }?.interval,
            sleepHighAccuracy = hr?.advancedMonitoring?.enabled,
            stressMonitoring = stress?.allDayTracking,
            spo2AllDay = spo2?.let { it.mode == Spo2Mode.SPO2_MODE_ALL_DAY },
        )

        fun buildHeartRate(base: HeartRate?, intervalMin: Int?, sleepHighAccuracy: Boolean?): HeartRate {
            val b = base?.toBuilder() ?: HeartRate.newBuilder().setUnknown7(1)
            if (intervalMin != null) b.setDisabled(false).setInterval(intervalMin.coerceAtLeast(0))
            if (sleepHighAccuracy != null) b.setAdvancedMonitoring(AdvancedMonitoring.newBuilder().setEnabled(sleepHighAccuracy))
            if (base == null && intervalMin == null) b.setDisabled(false).setInterval(0)
            return b.build()
        }

        fun buildSpo2(base: SpO2?, allDay: Boolean): SpO2 {
            val b = base?.toBuilder() ?: SpO2.newBuilder().setAllDayCapable(1).setAlarmLow(Spo2AlarmLow.newBuilder().setAlarmLowEnabled(false))
            // "off" rather than sleep-only when switching away from all-day, as Gadgetbridge's plain switch does
            return b.setMode(if (allDay) Spo2Mode.SPO2_MODE_ALL_DAY else Spo2Mode.SPO2_MODE_OFF).build()
        }

        fun buildStress(base: Stress?, allDay: Boolean): Stress {
            val b = base?.toBuilder() ?: Stress.newBuilder().setRelaxReminder(RelaxReminder.newBuilder().setEnabled(false).setUnknown2(0))
            return b.setAllDayTracking(allDay).build()
        }
    }
}
