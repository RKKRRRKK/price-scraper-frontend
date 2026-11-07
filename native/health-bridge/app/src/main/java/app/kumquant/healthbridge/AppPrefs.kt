package app.kumquant.healthbridge

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

/** Everything the user chose or the app remembers between runs (the watch, toggles, cached location). */
class AppPrefs(context: Context) {
    val sp: SharedPreferences = context.getSharedPreferences("hb-app", Context.MODE_PRIVATE)

    var watchAddress: String?
        get() = sp.getString("watch_address", null)
        set(v) = sp.edit().putString("watch_address", v).apply()

    var watchName: String?
        get() = sp.getString("watch_name", null)
        set(v) = sp.edit().putString("watch_name", v).apply()

    /** The Mi scale's Bluetooth address, learned from its first advert. */
    var scaleAddress: String?
        get() = sp.getString("scale_address", null)
        set(v) = sp.edit().putString("scale_address", v).apply()

    var forwardNotifications by bool("forward_notifications", true)
    var callAlerts by bool("call_alerts", true)
    var scaleEnabled by bool("scale_enabled", true)
    var readHealthConnect by bool("read_health_connect", false)

    /** Minutes between activity fetches while connected. */
    var syncIntervalMin: Int
        get() = sp.getInt("sync_interval_min", 10)
        set(v) = sp.edit().putInt("sync_interval_min", v).apply()

    /** Heart-rate interval in minutes; 0 = automatic. Defaults to every minute. */
    var hrIntervalMin: Int
        get() = sp.getInt("hr_interval_min", 1)
        set(v) = sp.edit().putInt("hr_interval_min", v).apply()

    /** Null until chosen or read from the watch; null is sent as "leave unchanged". */
    var sleepHighAccuracy by optBool("sleep_high_accuracy")
    var stressMonitoring by optBool("stress_monitoring")
    var spo2AllDay by optBool("spo2_all_day")

    /** Packages the user switched off in the notification filter. */
    var disabledApps: Set<String>
        get() = sp.getStringSet("disabled_apps", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("disabled_apps", v.toSet()).apply()

    var lastSyncAt: Long
        get() = sp.getLong("last_sync_at", 0)
        set(v) = sp.edit().putLong("last_sync_at", v).apply()

    var lastSyncSummary: String?
        get() = sp.getString("last_sync_summary", null)
        set(v) = sp.edit().putString("last_sync_summary", v).apply()

    var lastError: String?
        get() = sp.getString("last_error", null)
        set(v) = sp.edit().putString("last_error", v).apply()

    var lastUploadAt: Long
        get() = sp.getLong("last_upload_at", 0)
        set(v) = sp.edit().putLong("last_upload_at", v).apply()

    var lastUploadError: String?
        get() = sp.getString("last_upload_error", null)
        set(v) = sp.edit().putString("last_upload_error", v).apply()

    /** Last good weather location, so the hourly refresh works without background location. */
    var weatherLat: Double?
        get() = sp.getString("weather_lat", null)?.toDoubleOrNull()
        set(v) = sp.edit().putString("weather_lat", v?.toString()).apply()

    var weatherLon: Double?
        get() = sp.getString("weather_lon", null)?.toDoubleOrNull()
        set(v) = sp.edit().putString("weather_lon", v?.toString()).apply()

    var weatherPlace: String?
        get() = sp.getString("weather_place", null)
        set(v) = sp.edit().putString("weather_place", v).apply()

    /** Emits the current value of [read] now and after every preference change. */
    fun <T> observe(read: AppPrefs.() -> T): Flow<T> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> trySend(read()) }
        sp.registerOnSharedPreferenceChangeListener(listener)
        trySend(read())
        awaitClose { sp.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    private fun bool(key: String, default: Boolean) = object : ReadWriteProperty<Any?, Boolean> {
        override fun getValue(thisRef: Any?, property: KProperty<*>) = sp.getBoolean(key, default)
        override fun setValue(thisRef: Any?, property: KProperty<*>, value: Boolean) =
            sp.edit().putBoolean(key, value).apply()
    }

    private fun optBool(key: String) = object : ReadWriteProperty<Any?, Boolean?> {
        override fun getValue(thisRef: Any?, property: KProperty<*>) =
            if (sp.contains(key)) sp.getBoolean(key, false) else null

        override fun setValue(thisRef: Any?, property: KProperty<*>, value: Boolean?) {
            sp.edit().apply { if (value == null) remove(key) else putBoolean(key, value) }.apply()
        }
    }
}
