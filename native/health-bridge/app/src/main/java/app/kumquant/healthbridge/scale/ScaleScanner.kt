package app.kumquant.healthbridge.scale

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.AppPrefs
import app.kumquant.healthbridge.BuildConfig
import app.kumquant.healthbridge.data.HealthDatabase
import app.kumquant.healthbridge.data.HealthStore
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.LocalDate
import java.util.UUID

enum class Sex { MALE, FEMALE }

/** Height, birth date and sex for the body-composition formulas. */
data class BodyProfile(val heightCm: Double, val birthDate: LocalDate, val sex: Sex) {
    companion object {
        /** From `profile.*` in health.properties; null if any of the three is blank or unparsable. */
        fun fromBuildConfig(): BodyProfile? = parse(
            BuildConfig.PROFILE_HEIGHT_CM, BuildConfig.PROFILE_BIRTH_DATE, BuildConfig.PROFILE_SEX,
        )

        internal fun parse(height: String, birthDate: String, sex: String): BodyProfile? {
            val h = height.trim().toDoubleOrNull()?.takeIf { it > 0 } ?: return null
            val b = runCatching { LocalDate.parse(birthDate.trim()) }.getOrNull() ?: return null
            val s = when (sex.trim().lowercase()) {
                "male", "m" -> Sex.MALE
                "female", "f" -> Sex.FEMALE
                else -> return null
            }
            return BodyProfile(h, b, s)
        }
    }
}

/** One finished weigh-in. `time` is epoch ms; `samples` are the rows written to the store. */
data class WeighIn(val time: Long, val weightKg: Double, val impedance: Int?, val samples: List<SampleEntity>)

/**
 * Listens for Mi Body Composition Scale 2 advertisements (no pairing: weight and impedance ride in
 * the service data) and stores each finished weigh-in with its computed body composition.
 *
 * Android stops unfiltered scans when the screen is off, so the scan carries filters: the 0x181B
 * service data, and the advertised name "MIBFS" in case the service data sits in a packet the
 * controller filters differently. Needs BLUETOOTH_SCAN (API 31+) or location (API 28-30); without
 * it, the scan logs and stays off. The scan restarts itself after Bluetooth comes back, after a
 * failure, and every [RESTART_MS].
 */
class ScaleScanner(
    private val context: Context,
    private val db: HealthDatabase,
    private val profile: BodyProfile?,
    private val prefs: AppPrefs,
) {
    private val _lastWeighIn = MutableStateFlow<WeighIn?>(null)
    val lastWeighIn: StateFlow<WeighIn?> = _lastWeighIn

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val tracker = WeighInTracker()
    private val writeLock = Mutex()
    private var scanner: BluetoothLeScanner? = null
    private var ticker: Job? = null

    /** True between [start] and [stop]; the scan itself may be down meanwhile (Bluetooth off) and is restarted. */
    private var wanted = false
    private var watchdog: Job? = null

    /**
     * The unfiltered scan, matched in the app. On the user's OPPO the controller-side filters never
     * matched the scale (0 results all day, screen on or off), so this is what actually hears it. Android
     * pauses unfiltered scans while the screen is off, so it costs nothing then.
     */
    private val openCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = handle(result)

        override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::handle)

        override fun onScanFailed(errorCode: Int) {
            if (errorCode != SCAN_FAILED_ALREADY_STARTED) Log.w(TAG, "open scan failed, error $errorCode")
        }
    }

    private val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = handle(result)

        override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::handle)

        override fun onScanFailed(errorCode: Int) {
            if (errorCode == SCAN_FAILED_ALREADY_STARTED) return
            Log.w(TAG, "scan failed, error $errorCode; retrying in ${RETRY_MS / 1000} s")
            synchronized(this@ScaleScanner) { scanner = null }
            scope.launch {
                delay(RETRY_MS)
                startScan()
            }
        }
    }

    /** The scan dies with Bluetooth and nothing revives it, so follow the adapter state. */
    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_ON -> startScan()
                BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> stopScan()
            }
        }
    }

    @Synchronized
    fun start() {
        if (wanted) return
        wanted = true
        ContextCompat.registerReceiver(
            context, bluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED,
        )
        ticker = scope.launch {
            while (true) {
                delay(1000)
                release(synchronized(tracker) { tracker.poll(SystemClock.elapsedRealtime()) })
            }
        }
        // A fresh scan now and then: covers a scan the stack dropped without telling us, and stays
        // under Android's 30-minute limit after which a long-running scan can be downgraded.
        watchdog = scope.launch {
            while (true) {
                delay(RESTART_MS)
                restartScan()
            }
        }
        startScan()
    }

    @Synchronized
    fun stop() {
        if (!wanted) return
        wanted = false
        runCatching { context.unregisterReceiver(bluetoothReceiver) }
        ticker?.cancel()
        ticker = null
        watchdog?.cancel()
        watchdog = null
        stopScan()
        release(synchronized(tracker) { tracker.flush() })
    }

    @SuppressLint("MissingPermission")
    @Synchronized
    private fun startScan() {
        if (!wanted || scanner != null) return
        if (!hasScanPermission()) {
            Log.w(TAG, "no Bluetooth scan permission; the scale is not being listened for")
            return
        }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        val le = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner
        if (le == null) {
            Log.w(TAG, "Bluetooth is off; the scale scan resumes when it comes back on")
            return
        }
        // The scale's address, once the open scan has seen it, is the filter controllers handle best
        val filters = listOfNotNull(
            ScanFilter.Builder().setServiceData(ParcelUuid(SERVICE_UUID), byteArrayOf(0), byteArrayOf(0)).build(),
            ScanFilter.Builder().setDeviceName(DEVICE_NAME).build(),
            prefs.scaleAddress?.let { ScanFilter.Builder().setDeviceAddress(it).build() },
        )
        // Not LOW_POWER: with the screen off Android stretches that to ~0.5 s of listening every 10 s,
        // and a weigh-in only advertises for about 10 s, so it was missed about half the time.
        // BALANCED becomes ~0.2 s every 0.7 s with the screen off.
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build()
        try {
            le.startScan(filters, settings, callback)
            le.startScan(emptyList(), settings, openCallback)
        } catch (e: SecurityException) {
            Log.w(TAG, "scan refused: ${e.message}")
            return
        } catch (e: IllegalStateException) {
            Log.w(TAG, "scan refused: ${e.message}")
            return
        }
        scanner = le
        Log.i(TAG, "listening for the scale")
    }

    @SuppressLint("MissingPermission")
    @Synchronized
    private fun stopScan() {
        val le = scanner ?: return
        scanner = null
        try {
            le.stopScan(callback)
            le.stopScan(openCallback)
        } catch (e: Exception) {
            Log.w(TAG, "stopScan: ${e.message}")
        }
    }

    @Synchronized
    private fun restartScan() {
        stopScan()
        startScan()
    }

    private fun hasScanPermission(): Boolean {
        val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Manifest.permission.BLUETOOTH_SCAN
        else Manifest.permission.ACCESS_FINE_LOCATION
        return context.checkSelfPermission(needed) == PackageManager.PERMISSION_GRANTED
    }

    private fun handle(result: ScanResult) {
        val data = result.scanRecord?.getServiceData(ParcelUuid(SERVICE_UUID)) ?: return
        val advert = try {
            MiScaleAdvert.decode(data)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "undecodable scale advert from ${result.device.address}: ${e.message}")
            return
        }
        Log.d(TAG, "advert $advert")
        val address = result.device.address
        if (address != prefs.scaleAddress) {
            Log.i(TAG, "scale found at $address; adding it to the screen-off filters")
            prefs.scaleAddress = address
            scope.launch { restartScan() }
        }
        release(synchronized(tracker) { tracker.feed(advert, SystemClock.elapsedRealtime(), System.currentTimeMillis()) })
    }

    private fun release(readings: List<Reading>) {
        if (readings.isEmpty()) return
        scope.launch {
            writeLock.withLock { readings.forEach { store(it) } }
        }
    }

    private suspend fun store(reading: Reading) {
        try {
            val sync = db.sync()
            val t = reading.timeMs
            val haveWeight = sync.samplesIn(Metrics.WEIGHT_KG, t, t + 1).isNotEmpty()
            val haveImpedance = sync.samplesIn(Metrics.IMPEDANCE, t, t + 1).isNotEmpty()
            if (haveWeight && (reading.impedance == null || haveImpedance)) {
                Log.d(TAG, "weigh-in at $t already stored")
                return
            }
            val previous = sync.latestBefore(Metrics.WEIGHT_KG, t)?.value
            if (!ScaleHistory.isUser(reading.weightKg, previous)) {
                Log.i(TAG, "ignored a ${reading.weightKg} kg weigh-in: too far from the user's last $previous kg, so someone else's")
                return
            }
            val weighIn = BodyComposition.weighIn(reading, profile)
            HealthStore(db).write(samples = weighIn.samples)
            _lastWeighIn.value = weighIn
            Log.i(TAG, "weigh-in stored: ${weighIn.samples.joinToString { "${it.metric}=${it.value}" }}")
        } catch (e: Exception) {
            Log.e(TAG, "could not store weigh-in $reading", e)
        }
    }

    companion object {
        private const val TAG = "ScaleScanner"
        private const val DEVICE_NAME = "MIBFS"
        private const val RETRY_MS = 30_000L
        private const val RESTART_MS = 10 * 60_000L

        /** Body Composition service (0x181B), the service-data UUID the scale advertises. */
        val SERVICE_UUID: UUID = UUID.fromString("0000181b-0000-1000-8000-00805f9b34fb")
    }
}
