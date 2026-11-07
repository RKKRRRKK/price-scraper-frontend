package app.kumquant.healthbridge

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.kumquant.healthbridge.service.BridgeService
import app.kumquant.healthbridge.ui.AppScaffold
import app.kumquant.healthbridge.ui.device.Pairing
import app.kumquant.healthbridge.ui.theme.HealthBridgeTheme

/** Health / Watch / Settings. Opening the app also brings the watch link up if a watch is paired. */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        setContent { HealthBridgeTheme { AppScaffold() } }
        debugCommand(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        debugCommand(intent)
    }

    override fun onStart() {
        super.onStart()
        if (BridgeService.hasBluetoothPermission(this)) Pairing.adoptExisting(this)
        if (BridgeService.current == null && BridgeService.hasBluetoothPermission(this)) BridgeService.start(this)
    }

    /**
     * Debug builds only: maintenance over adb, since the service isn't exported.
     * `adb shell am start -n app.kumquant.healthbridge/.MainActivity --es hb_debug reparse|scale_history`
     */
    private fun debugCommand(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        val action = when (intent?.getStringExtra(DEBUG_EXTRA)) {
            "reparse" -> BridgeService.ACTION_REPARSE
            "scale_history" -> BridgeService.ACTION_SCALE_HISTORY
            else -> return
        }
        startService(Intent(this, BridgeService::class.java).setAction(action))
    }

    private companion object {
        const val DEBUG_EXTRA = "hb_debug"
    }
}
