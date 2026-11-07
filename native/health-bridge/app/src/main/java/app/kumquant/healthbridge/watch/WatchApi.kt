package app.kumquant.healthbridge.watch

import java.time.LocalDate

/**
 * The boundary between the watch protocol (package `watch`, implemented by
 * [WatchClient]) and the rest of the app (service, notifications, weather, UI).
 * Keep these types plain so either side can change its internals freely.
 */

enum class LinkState { DISCONNECTED, CONNECTING, AUTHENTICATING, CONNECTED, AUTH_FAILED }

data class WatchInfo(
    val model: String? = null,
    val firmware: String? = null,
    val serial: String? = null,
    val batteryPct: Int? = null,
    val charging: Boolean? = null,
)

/** A phone notification to mirror on the watch. `key` is the StatusBarNotification key. */
data class PhoneNotification(
    val key: String,
    val packageName: String,
    val appName: String,
    val title: String,
    val body: String,
    val postedAt: Long,
)

/** Weather as the phone fetched it (Open-Meteo); the watch layer maps WMO codes to Xiaomi's. */
data class WeatherReport(
    val locationName: String,
    val fetchedAt: Long,
    val current: CurrentWeather,
    val hourly: List<HourWeather>,
    val daily: List<DayWeather>,
)

data class CurrentWeather(
    val tempC: Double,
    val feelsLikeC: Double?,
    val wmoCode: Int,
    val humidityPct: Int?,
    val windKph: Double?,
    val windDirDeg: Int?,
    val pressureHpa: Double?,
    val uvIndex: Double?,
    val aqi: Int?,
    val isDay: Boolean,
)

data class HourWeather(val time: Long, val tempC: Double, val wmoCode: Int, val precipProbPct: Int?, val windKph: Double?)

data class DayWeather(
    val date: LocalDate,
    val minC: Double,
    val maxC: Double,
    val wmoCode: Int,
    val sunrise: Long?,
    val sunset: Long?,
    val precipProbPct: Int?,
    val uvIndexMax: Double?,
)

enum class MusicCommand { PLAY, PAUSE, PLAY_PAUSE, NEXT, PREVIOUS, VOLUME_UP, VOLUME_DOWN }

data class NowPlaying(
    val playing: Boolean,
    val artist: String?,
    val title: String?,
    val album: String?,
    val durationMs: Long?,
    val positionMs: Long?,
    val volumePct: Int?,
)

/** Result of one activity sync (files fetched from the watch and parsed into the local DB). */
data class SyncSummary(val files: Int, val samples: Int, val sessions: Int, val failed: Int)

/** Watch health settings this app manages. Null = unknown / leave unchanged. */
data class HealthSettings(
    /** Heart-rate measurement interval in minutes; 0 = smart/auto, 1 = every minute. */
    val hrIntervalMin: Int? = null,
    val sleepHighAccuracy: Boolean? = null,
    val stressMonitoring: Boolean? = null,
    val spo2AllDay: Boolean? = null,
)

/** One realtime reading from the watch's heart-rate stream. `bpm` is 0 while the sensor is still measuring. */
data class LiveHeartRate(val bpm: Int, val steps: Int, val kcal: Int, val at: Long)

/** Whether the workout the watch is running is going or paused. */
enum class WorkoutPhase { RUNNING, PAUSED }

/**
 * The workout the watch is running right now. Fields the watch has not sent are null. `elapsedS`
 * excludes paused time; the watch pushes its own stats once a second.
 */
data class LiveWorkout(
    val sportCode: Int?,
    val sport: String,
    val phase: WorkoutPhase,
    val startedAt: Long,
    val elapsedS: Int,
    val hr: Int? = null,
    val distanceM: Int? = null,
    val kcal: Int? = null,
    val steps: Int? = null,
    /** True while this phone is feeding the watch GPS fixes for the workout. */
    val phoneGps: Boolean = false,
)

/** A location fix as the watch wants it. `speed` in m/s, `bearing` in degrees. */
data class LocationFix(
    val timeMs: Long,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double,
    val speed: Float,
    val bearing: Float,
)

/** The phone's GPS, which the watch borrows for an outdoor workout. Implemented by the service. */
interface PhoneGps {
    /** True if fixes can be delivered right now: permission granted and a GPS provider enabled. */
    fun canLocate(): Boolean

    /** Starts delivering fixes (about once a second) to [onFix]; false if it could not start. */
    fun start(onFix: (LocationFix) -> Unit): Boolean

    fun stop()
}

/** Events from the watch. Called on a background thread. */
interface WatchListener {
    fun onState(state: LinkState, detail: String? = null) {}
    fun onInfo(info: WatchInfo) {}
    fun onFindPhone(start: Boolean) {}
    fun onMusicCommand(command: MusicCommand) {}
    /** The user acted on an incoming-call alert: reject = true hangs up, false just silences. */
    fun onCallAction(reject: Boolean) {}
    fun onNotificationDismissed(key: String) {}
    /** The watch asked for fresh weather (opened the weather app, or its data went stale). */
    fun onWeatherRequested() {}
    /** The watch asked for now-playing info (opened its music app). */
    fun onMusicInfoRequested() {}
    fun onActivitySynced(summary: SyncSummary) {}
}
