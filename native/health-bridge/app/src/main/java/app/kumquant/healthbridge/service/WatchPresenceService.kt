package app.kumquant.healthbridge.service

import android.companion.AssociationInfo
import android.companion.CompanionDeviceService
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Android 12+: the system binds this while the associated watch is in range, which also
 * exempts us from background-start limits, so the bridge comes up when the watch appears.
 */
@RequiresApi(Build.VERSION_CODES.S)
class WatchPresenceService : CompanionDeviceService() {

    @Deprecated("Replaced by the AssociationInfo overload on Android 13+")
    override fun onDeviceAppeared(address: String) {
        Log.i(TAG, "Watch appeared")
        BridgeService.start(this)
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    override fun onDeviceAppeared(associationInfo: AssociationInfo) {
        Log.i(TAG, "Watch appeared")
        BridgeService.start(this)
    }

    @Deprecated("Replaced by the AssociationInfo overload on Android 13+")
    override fun onDeviceDisappeared(address: String) {
        Log.i(TAG, "Watch out of range")
    }

    private companion object {
        const val TAG = "HbPresence"
    }
}
