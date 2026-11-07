package app.kumquant.healthbridge.weather

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.util.Log
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.watch.WeatherReport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.coroutines.resume

/**
 * Builds the weather report for the watch: a coarse location fix (or the last good one,
 * cached in prefs so the hourly refresh needs no background location), its place name,
 * then Open-Meteo.
 */
class WeatherProvider(private val context: Context) {
    private val prefs = HealthBridgeApp.prefs

    /** Null when there has never been a location. */
    suspend fun report(): WeatherReport? {
        val here = locate()
        val lat: Double
        val lon: Double
        if (here != null) {
            lat = here.latitude
            lon = here.longitude
        } else {
            lat = prefs.weatherLat ?: return null
            lon = prefs.weatherLon ?: return null
        }
        val place = placeName(lat, lon)
        prefs.weatherLat = lat
        prefs.weatherLon = lon
        prefs.weatherPlace = place
        return OpenMeteo.report(lat, lon, place)
    }

    @SuppressLint("MissingPermission")
    private suspend fun locate(): Location? {
        if (!hasLocationPermission(context)) return null
        val lm = context.getSystemService(LocationManager::class.java)
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
            .filter { runCatching { lm.isProviderEnabled(it) || it == LocationManager.PASSIVE_PROVIDER }.getOrDefault(false) }

        if (Build.VERSION.SDK_INT >= 30) {
            val first = providers.firstOrNull { it != LocationManager.PASSIVE_PROVIDER }
            if (first != null) {
                val fresh = withTimeoutOrNull(15_000) {
                    suspendCancellableCoroutine<Location?> { cont ->
                        val signal = CancellationSignal()
                        cont.invokeOnCancellation { signal.cancel() }
                        lm.getCurrentLocation(first, signal, Executors.newSingleThreadExecutor()) { cont.resume(it) }
                    }
                }
                if (fresh != null) return fresh
            }
        }
        return providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
    }

    private suspend fun placeName(lat: Double, lon: Double): String {
        val cachedLat = prefs.weatherLat
        val cachedLon = prefs.weatherLon
        val cachedName = prefs.weatherPlace
        if (cachedName != null && cachedLat != null && cachedLon != null &&
            kotlin.math.abs(cachedLat - lat) < 0.05 && kotlin.math.abs(cachedLon - lon) < 0.05
        ) return cachedName

        if (!Geocoder.isPresent()) return FALLBACK
        return runCatching { geocode(lat, lon) }
            .onFailure { Log.w(TAG, "Geocoder failed: ${it.message}") }
            .getOrNull() ?: FALLBACK
    }

    private suspend fun geocode(lat: Double, lon: Double): String? {
        val geocoder = Geocoder(context, Locale.getDefault())
        val address = if (Build.VERSION.SDK_INT >= 33) {
            withTimeoutOrNull(10_000) {
                suspendCancellableCoroutine<android.location.Address?> { cont ->
                    geocoder.getFromLocation(lat, lon, 1, object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<android.location.Address>) = cont.resume(addresses.firstOrNull())
                        override fun onError(errorMessage: String?) = cont.resume(null)
                    })
                }
            }
        } else {
            withContext(Dispatchers.IO) {
                @Suppress("DEPRECATION") geocoder.getFromLocation(lat, lon, 1)?.firstOrNull()
            }
        }
        return address?.let { it.locality ?: it.subAdminArea ?: it.adminArea }
    }

    companion object {
        private const val TAG = "HbWeather"
        private const val FALLBACK = "Current location"

        fun hasLocationPermission(context: Context) =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
