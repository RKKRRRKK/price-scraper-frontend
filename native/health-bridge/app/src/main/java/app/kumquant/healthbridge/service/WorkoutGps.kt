package app.kumquant.healthbridge.service

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.watch.LocationFix
import app.kumquant.healthbridge.watch.PhoneGps

/**
 * The phone's GPS for a watch workout: fixes about once a second from the GPS provider and, on
 * Android 12+, the fused provider as a fallback while the GPS has not locked. [onForeground] asks the
 * service to add or drop the `location` foreground-service type around the stream.
 */
class WorkoutGps(
    private val context: Context,
    private val onForeground: (Boolean) -> Boolean,
) : PhoneGps {
    private val lm by lazy { context.getSystemService(LocationManager::class.java) }
    private var listener: LocationListener? = null
    private var lastGpsFixAt = 0L

    override fun canLocate(): Boolean = hasFineLocation(context) && runCatching { lm.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)

    @SuppressLint("MissingPermission")
    @Synchronized
    override fun start(onFix: (LocationFix) -> Unit): Boolean {
        if (listener != null) return true
        if (!canLocate()) return false
        if (!onForeground(true)) return false
        val l = LocationListener { loc -> accept(loc, onFix) }
        return try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000L, 0f, l, Looper.getMainLooper())
            if (Build.VERSION.SDK_INT >= 31 && lm.getAllProviders().contains(LocationManager.FUSED_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.FUSED_PROVIDER, 1_000L, 0f, l, Looper.getMainLooper())
            }
            listener = l
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not start location updates: ${e.message}")
            runCatching { lm.removeUpdates(l) }
            onForeground(false)
            false
        }
    }

    @Synchronized
    override fun stop() {
        listener?.let { runCatching { lm.removeUpdates(it) } }
        listener = null
        lastGpsFixAt = 0L
        onForeground(false)
    }

    /** Not synchronized while calling [onFix]: it takes the health service's lock, which [stop] is called under. */
    private fun accept(loc: Location, onFix: (LocationFix) -> Unit) {
        val gps = loc.provider == LocationManager.GPS_PROVIDER
        val now = SystemClock.elapsedRealtime()
        val skip = synchronized(this) {
            if (gps) lastGpsFixAt = now
            !gps && now - lastGpsFixAt < GPS_PREFERRED_MS
        }
        if (skip) return
        onFix(
            LocationFix(
                timeMs = loc.time.takeIf { it > 0 } ?: System.currentTimeMillis(),
                latitude = loc.latitude,
                longitude = loc.longitude,
                altitude = if (loc.hasAltitude()) loc.altitude else 0.0,
                speed = if (loc.hasSpeed()) loc.speed else 0f,
                bearing = if (loc.hasBearing()) loc.bearing else 0f,
            ),
        )
    }

    companion object {
        private const val TAG = "HbBridge"
        private const val GPS_PREFERRED_MS = 3_000L

        fun hasFineLocation(context: Context) =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
