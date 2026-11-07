package app.kumquant.healthbridge.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.BridgeState
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.service.BridgeService
import app.kumquant.healthbridge.ui.BodyText
import app.kumquant.healthbridge.ui.HbButton
import app.kumquant.healthbridge.ui.LinkRow
import app.kumquant.healthbridge.ui.SectionTitle
import app.kumquant.healthbridge.ui.ToggleRow
import app.kumquant.healthbridge.ui.health.HbCard
import app.kumquant.healthbridge.ui.health.Segmented
import app.kumquant.healthbridge.ui.setup.SetupChecks
import app.kumquant.healthbridge.ui.theme.Hb
import app.kumquant.healthbridge.upload.UploadWorker

private val syncOptions = listOf(5, 10, 15, 30)

/** Toggles, upload status and the links to the setup checklist and the notification filter. */
@Composable
fun SettingsScreen(onSetup: () -> Unit, onFilter: () -> Unit) {
    val context = LocalContext.current
    val prefs = HealthBridgeApp.prefs
    val forward by prefs.observe { forwardNotifications }.collectAsStateWithLifecycle(prefs.forwardNotifications)
    val calls by prefs.observe { callAlerts }.collectAsStateWithLifecycle(prefs.callAlerts)
    val scale by prefs.observe { scaleEnabled }.collectAsStateWithLifecycle(prefs.scaleEnabled)
    val interval by prefs.observe { syncIntervalMin }.collectAsStateWithLifecycle(prefs.syncIntervalMin)

    val uploadError by BridgeState.uploadError.collectAsStateWithLifecycle()

    val phone = rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()) {
        BridgeService.current?.onPermissionsChanged()
    }
    val scan = rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()) {
        BridgeService.current?.onPermissionsChanged()
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Settings", style = Hb.Type.display, color = Hb.text)

        HbCard(Modifier.fillMaxWidth()) {
            SectionTitle("Watch")
            ToggleRow("Forward notifications", forward, { prefs.forwardNotifications = it })
            LinkRow("Choose apps", onFilter, text = "Pick which apps may notify the watch.")
            ToggleRow("Call alerts", calls, {
                prefs.callAlerts = it
                if (it) SetupChecks.missing(context, SetupChecks.phonePermissions).takeIf { m -> m.isNotEmpty() }?.let(phone::launch)
            })
            ToggleRow("Weigh-ins from the scale", scale, {
                prefs.scaleEnabled = it
                if (it) SetupChecks.missing(context, SetupChecks.bluetoothPermissions).takeIf { m -> m.isNotEmpty() }?.let(scan::launch)
            })
            Spacer(Modifier.height(6.dp))
            BodyText("How often to fetch activity from the watch.")
            Spacer(Modifier.height(8.dp))
            Segmented(syncOptions, interval, { "$it min" }, { prefs.syncIntervalMin = it }, Hb.hr)
        }

        uploadError?.let {
            HbCard(Modifier.fillMaxWidth()) {
                SectionTitle("Upload failed")
                BodyText(it, color = Hb.bad)
                Spacer(Modifier.height(8.dp))
                HbButton("Retry upload", { UploadWorker.kick(context) })
            }
        }

        HbCard(Modifier.fillMaxWidth()) {
            LinkRow("Setup checklist", onSetup, text = "Permissions and phone settings the bridge needs.")
        }
    }
}
