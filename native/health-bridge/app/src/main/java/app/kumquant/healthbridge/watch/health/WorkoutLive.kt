package app.kumquant.healthbridge.watch.health

import app.kumquant.healthbridge.watch.LiveWorkout
import app.kumquant.healthbridge.watch.WorkoutPhase
import app.kumquant.healthbridge.watch.activity.impl.XiaomiSports

/**
 * Folds the watch's workout status messages (8/26, 8/29) and its once-a-second stats (8/50) into one
 * [LiveWorkout]. Pure state with an injectable clock; [HealthService] feeds it and publishes the result.
 * Not thread safe: callers synchronise.
 */
internal class WorkoutLive(private val clock: () -> Long = System::currentTimeMillis) {
    private var sportCode: Int? = null
    private var startedAt = 0L
    private var pausedAt: Long? = null
    private var pausedTotal = 0L
    private var hr: Int? = null
    private var distanceM: Int? = null
    private var kcal: Int? = null
    private var steps: Int? = null
    private var active = false
    private var finishedAt = 0L

    @Volatile
    var lastStatsAt = 0L
        private set

    @Volatile
    var phoneGps = false

    val isActive: Boolean get() = active

    /** [status]: 0 started, 1 paused, 2 resumed, 3 finished. Returns the new state, null once finished. */
    fun onStatus(status: Int, sport: Int?): LiveWorkout? {
        val now = clock()
        when (status) {
            STARTED -> {
                // The watch sends both status flavours for one start; the second must not reset the clock.
                if (active && now - startedAt < DUPLICATE_START_MS) {
                    if (sportCode == null) sportCode = sport
                } else begin(sport, now)
            }
            PAUSED -> if (active && pausedAt == null) pausedAt = now
            RESUMED -> resume(now)
            FINISHED -> {
                reset()
                finishedAt = now
            }
        }
        return snapshot()
    }

    /** Applies one stats message; starts a workout of unknown sport if the watch never announced one. */
    fun onStats(heartRate: Int?, calories: Int?, stepCount: Int?, distance: Int?): LiveWorkout? {
        val now = clock()
        if (!active) {
            if (now - finishedAt < LATE_STATS_MS) return null
            begin(null, now)
        }
        lastStatsAt = now
        hr = heartRate?.takeIf { it in 30..250 } ?: hr
        kcal = calories ?: kcal
        steps = stepCount ?: steps
        distanceM = distance?.takeIf { it > 0 } ?: distanceM
        return snapshot()
    }

    /** Re-reads the clock, so elapsed time advances between stats messages. */
    fun tick(): LiveWorkout? = snapshot()

    fun clear() = reset()

    private fun begin(sport: Int?, now: Long) {
        reset()
        active = true
        sportCode = sport
        startedAt = now
        lastStatsAt = now
    }

    private fun resume(now: Long) {
        val p = pausedAt ?: return
        pausedTotal += now - p
        pausedAt = null
    }

    private fun reset() {
        active = false
        sportCode = null
        startedAt = 0
        pausedAt = null
        pausedTotal = 0
        hr = null
        distanceM = null
        kcal = null
        steps = null
        lastStatsAt = 0
    }

    private fun snapshot(): LiveWorkout? {
        if (!active) return null
        val now = clock()
        val end = pausedAt ?: now
        val code = sportCode
        return LiveWorkout(
            sportCode = code,
            sport = if (code != null) XiaomiSports.of(code).name else "Workout",
            phase = if (pausedAt != null) WorkoutPhase.PAUSED else WorkoutPhase.RUNNING,
            startedAt = startedAt,
            elapsedS = ((end - startedAt - pausedTotal) / 1000).toInt().coerceAtLeast(0),
            hr = hr,
            distanceM = distanceM,
            kcal = kcal,
            steps = steps,
            phoneGps = phoneGps,
        )
    }

    companion object {
        const val STARTED = 0
        const val PAUSED = 1
        const val RESUMED = 2
        const val FINISHED = 3

        /** Status 8/29 numbers paused and resumed the other way round from 8/26. */
        fun fromV2(status: Int): Int = when (status) {
            1 -> RESUMED
            2 -> PAUSED
            else -> status
        }

        private const val DUPLICATE_START_MS = 5_000L
        private const val LATE_STATS_MS = 3_000L
    }
}
