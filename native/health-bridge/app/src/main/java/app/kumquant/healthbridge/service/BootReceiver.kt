package app.kumquant.healthbridge.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Brings the watch link up after a reboot or an app update, if a watch is associated. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        BridgeService.start(context)
    }
}
