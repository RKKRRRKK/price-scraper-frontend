package app.kumquant.healthbridge.ui.device

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.BridgeState
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.service.BridgeService
import app.kumquant.healthbridge.ui.BodyText
import app.kumquant.healthbridge.ui.HbButton
import app.kumquant.healthbridge.ui.KeyValue
import app.kumquant.healthbridge.ui.SectionTitle
import app.kumquant.healthbridge.ui.StatusPill
import app.kumquant.healthbridge.ui.ToggleRow
import app.kumquant.healthbridge.ui.health.HbCard
import app.kumquant.healthbridge.ui.health.Segmented
import app.kumquant.healthbridge.ui.health.fmtAgo
import app.kumquant.healthbridge.ui.setup.SetupChecks
import app.kumquant.healthbridge.ui.theme.Hb
import app.kumquant.healthbridge.watch.LinkState

private val hrOptions = listOf(1, 10, 30, 0)

/** Pairing, link status, sync controls and the watch's health settings. */
@Composable
fun WatchScreen() {
    val context = LocalContext.current
    val prefs = HealthBridgeApp.prefs
    val address by prefs.observe { watchAddress }.collectAsStateWithLifecycle(prefs.watchAddress)
    val name by prefs.observe { watchName }.collectAsStateWithLifecycle(prefs.watchName)
    var pairError by remember { mutableStateOf<String?>(null) }

    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        Pairing.fromResult(result.data)?.let { (a, n) -> Pairing.finish(context, a, n) }
    }
    fun pair() {
        pairError = null
        if (Pairing.adoptExisting(context)) return
        Pairing.associate(
            context,
            launch = { chooser.launch(IntentSenderRequest.Builder(it).build()) },
            onPaired = { a, n -> Pairing.finish(context, a, n) },
            onFailure = { pairError = it },
        )
    }
    val bluetooth = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { pair() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Watch", style = Hb.Type.display, color = Hb.text)

        if (address == null) {
            HbCard(Modifier.fillMaxWidth()) {
                SectionTitle("Pair your watch")
                BodyText("Bring the watch close and choose it from the list.")
                Spacer(Modifier.height(10.dp))
                HbButton("Pair watch", {
                    val missing = SetupChecks.missing(context, SetupChecks.bluetoothPermissions)
                    if (missing.isEmpty()) pair() else bluetooth.launch(missing)
                }, primary = true)
                pairError?.let {
                    Spacer(Modifier.height(8.dp))
                    BodyText(it, color = Hb.bad)
                }
            }
            return@Column
        }

        LinkCard(name ?: "Xiaomi Watch S5")
        SettingsCard()
    }
}

@Composable
private fun LinkCard(title: String) {
    val link by BridgeState.link.collectAsStateWithLifecycle()
    val info by BridgeState.info.collectAsStateWithLifecycle()
    val syncing by BridgeState.syncing.collectAsStateWithLifecycle()
    val lastSyncAt by BridgeState.lastSyncAt.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var finding by remember { mutableStateOf(false) }
    var confirmForget by remember { mutableStateOf(false) }
    val connected = link == LinkState.CONNECTED

    HbCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Hb.Type.title, color = Hb.text, modifier = Modifier.weight(1f))
            when (link) {
                LinkState.CONNECTED -> StatusPill("Connected", Hb.sync)
                LinkState.CONNECTING, LinkState.AUTHENTICATING -> StatusPill("Connecting", Hb.warn)
                LinkState.AUTH_FAILED -> StatusPill("Key rejected", Hb.bad)
                LinkState.DISCONNECTED -> StatusPill("Not connected", Hb.text3)
            }
        }
        Spacer(Modifier.height(6.dp))
        info.batteryPct?.let { KeyValue("Battery", "$it%" + if (info.charging == true) " (charging)" else "") }
        KeyValue("Last sync", if (lastSyncAt == 0L) "Never" else fmtAgo(lastSyncAt).replaceFirstChar { it.uppercase() })

        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HbButton(if (syncing) "Syncing…" else "Sync now", { BridgeService.current?.syncNow() }, Modifier.weight(1f), primary = true, enabled = connected && !syncing)
            HbButton(if (finding) "Stop finding" else "Find watch", {
                finding = !finding
                BridgeService.current?.findWatch(finding)
            }, Modifier.weight(1f), enabled = connected)
        }
        Spacer(Modifier.height(8.dp))
        HbButton(if (confirmForget) "Tap again to forget" else "Forget watch", {
            if (confirmForget) Pairing.forget(context) else confirmForget = true
        }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun SettingsCard() {
    val prefs = HealthBridgeApp.prefs
    val hr by prefs.observe { hrIntervalMin }.collectAsStateWithLifecycle(prefs.hrIntervalMin)
    val sleep by prefs.observe { sleepHighAccuracy }.collectAsStateWithLifecycle(prefs.sleepHighAccuracy)
    val stress by prefs.observe { stressMonitoring }.collectAsStateWithLifecycle(prefs.stressMonitoring)
    val spo2 by prefs.observe { spo2AllDay }.collectAsStateWithLifecycle(prefs.spo2AllDay)

    HbCard(Modifier.fillMaxWidth()) {
        SectionTitle("Health settings")
        BodyText("How often the watch measures heart rate.")
        Spacer(Modifier.height(8.dp))
        Segmented(hrOptions, hr, { if (it == 0) "Auto" else "$it min" }, {
            prefs.hrIntervalMin = it
            BridgeService.current?.applySettings()
        }, Hb.hr)
        Spacer(Modifier.height(8.dp))
        ToggleRow("Sleep high accuracy", sleep == true, { prefs.sleepHighAccuracy = it; BridgeService.current?.applySettings() })
        ToggleRow("Stress monitoring", stress == true, { prefs.stressMonitoring = it; BridgeService.current?.applySettings() })
        ToggleRow("Blood oxygen all day", spo2 == true, { prefs.spo2AllDay = it; BridgeService.current?.applySettings() })
    }
}
