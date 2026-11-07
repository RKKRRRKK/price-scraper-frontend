package app.kumquant.healthbridge.ui.device

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanResult
import android.companion.AssociationInfo
import android.companion.AssociationRequest
import android.companion.BluetoothDeviceFilter
import android.companion.CompanionDeviceManager
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.service.BridgeService
import java.util.regex.Pattern

/** CompanionDeviceManager association with the Xiaomi Watch S5 (Bluetooth Classic) and its removal. */
object Pairing {
    private const val TAG = "HbPairing"
    private val WATCH_NAME = Pattern.compile("^Xiaomi Watch S5 .*")

    /**
     * Starts the system chooser. [launch] must start the given IntentSender for a result and pass
     * that result's Intent to [fromResult]; [onFailure] gets a short reason.
     * On Android 13+ [onPaired] can also fire straight from the callback.
     */
    fun associate(context: Context, launch: (IntentSender) -> Unit, onPaired: (String, String?) -> Unit, onFailure: (String) -> Unit) {
        val cdm = context.getSystemService(CompanionDeviceManager::class.java)
        val request = AssociationRequest.Builder()
            .addDeviceFilter(BluetoothDeviceFilter.Builder().setNamePattern(WATCH_NAME).build())
            .setSingleDevice(false)
            .build()

        if (Build.VERSION.SDK_INT >= 33) {
            cdm.associate(request, ContextCompat.getMainExecutor(context), object : CompanionDeviceManager.Callback() {
                override fun onAssociationPending(intentSender: IntentSender) = launch(intentSender)
                override fun onAssociationCreated(associationInfo: AssociationInfo) {
                    val address = associationInfo.deviceMacAddress?.toString()
                    if (address != null) onPaired(address.uppercase(), associationInfo.displayName?.toString())
                }
                override fun onFailure(errorMessage: CharSequence?) = onFailure(errorMessage?.toString() ?: "Pairing failed.")
            })
        } else {
            @Suppress("DEPRECATION")
            cdm.associate(request, object : CompanionDeviceManager.Callback() {
                override fun onDeviceFound(chooserLauncher: IntentSender) = launch(chooserLauncher)
                override fun onFailure(error: CharSequence?) = onFailure(error?.toString() ?: "Pairing failed.")
            }, null)
        }
    }

    /**
     * Uses a watch the phone already knows instead of the chooser, which only lists devices that
     * advertise (a watch bonded to the phone doesn't). Tries this app's existing CDM association,
     * then a bonded device named like the watch. Returns true if one was adopted.
     */
    fun adoptExisting(context: Context): Boolean {
        if (HealthBridgeApp.prefs.watchAddress != null) return false
        val cdm = context.getSystemService(CompanionDeviceManager::class.java)
        val associated = runCatching {
            if (Build.VERSION.SDK_INT >= 33) cdm.myAssociations.firstNotNullOfOrNull { it.deviceMacAddress?.toString() }
            else @Suppress("DEPRECATION") cdm.associations.firstOrNull()
        }.getOrNull()
        val bonded = runCatching {
            context.getSystemService(BluetoothManager::class.java).adapter?.bondedDevices
                ?.firstOrNull { WATCH_NAME.matcher(it.name.orEmpty()).matches() }
        }.getOrNull()
        val address = associated ?: bonded?.address ?: return false
        val name = bonded?.takeIf { it.address.equals(address, ignoreCase = true) }?.let { runCatching { it.name }.getOrNull() }
        Log.i(TAG, "Adopting ${if (associated != null) "associated" else "bonded"} watch ${address.take(8)}…")
        finish(context, address, name)
        return true
    }

    /** Address and name from the chooser's result Intent, or null if it was cancelled. */
    @Suppress("DEPRECATION")
    fun fromResult(data: Intent?): Pair<String, String?>? {
        data ?: return null
        if (Build.VERSION.SDK_INT >= 33) {
            val info = data.getParcelableExtra(CompanionDeviceManager.EXTRA_ASSOCIATION, AssociationInfo::class.java)
            info?.deviceMacAddress?.toString()?.let { return it.uppercase() to info.displayName?.toString() }
        }
        return when (val device = data.getParcelableExtra<android.os.Parcelable>(CompanionDeviceManager.EXTRA_DEVICE)) {
            is BluetoothDevice -> device.address to device.name
            is ScanResult -> device.device.address to device.device.name
            else -> null
        }
    }

    /** Remembers the watch, asks Android 12+ to wake us when it appears, and brings the link up. */
    fun finish(context: Context, address: String, name: String?) {
        val prefs = HealthBridgeApp.prefs
        prefs.watchAddress = address.uppercase()
        prefs.watchName = name
        Log.i(TAG, "Associated ${name ?: "watch"} ${address.take(8)}…")
        BridgeService.observePresence(context, address)
        BridgeService.reconnect(context)
    }

    /** Drops the association and everything tied to the watch address. */
    fun forget(context: Context) {
        val prefs = HealthBridgeApp.prefs
        val address = prefs.watchAddress
        BridgeService.stop(context)
        if (address != null) {
            val cdm = context.getSystemService(CompanionDeviceManager::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= 31) cdm.stopObservingDevicePresence(address)
            }
            runCatching {
                if (Build.VERSION.SDK_INT >= 33) {
                    cdm.myAssociations.filter { it.deviceMacAddress?.toString().equals(address, ignoreCase = true) }
                        .forEach { cdm.disassociate(it.id) }
                } else {
                    @Suppress("DEPRECATION") cdm.disassociate(address)
                }
            }.onFailure { Log.w(TAG, "Disassociate failed: ${it.message}") }
        }
        prefs.watchAddress = null
        prefs.watchName = null
    }
}
