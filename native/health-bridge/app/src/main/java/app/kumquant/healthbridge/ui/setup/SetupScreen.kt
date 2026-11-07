package app.kumquant.healthbridge.ui.setup

import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.kumquant.healthbridge.service.BridgeService
import app.kumquant.healthbridge.ui.HbButton
import app.kumquant.healthbridge.ui.StatusPill
import app.kumquant.healthbridge.ui.health.HbCard
import app.kumquant.healthbridge.ui.health.PlainScreen
import app.kumquant.healthbridge.ui.theme.Hb

/** Bumps every time the app returns to the foreground, so statuses re-read after a trip to system settings. */
@Composable
fun rememberResumeTick(): Int {
    var tick by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) tick++ }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return tick
}

private class SetupRow(
    val title: String,
    val text: String,
    /** Null when the state cannot be detected. */
    val done: Boolean?,
    val action: String?,
    val onAction: () -> Unit,
)

/** One screen of rows, each with a status and an action. */
@Composable
fun SetupScreen(onBack: () -> Unit, onPairWatch: () -> Unit) {
    val context = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    val resume = rememberResumeTick()

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        tick++
        BridgeService.current?.onPermissionsChanged() ?: BridgeService.start(context)
    }
    fun ask(list: Array<String>) = permissions.launch(SetupChecks.missing(context, list).ifEmpty { list })
    fun open(intent: Intent) {
        runCatching { context.startActivity(intent) }
            .onFailure { runCatching { context.startActivity(SetupChecks.appDetailsIntent(context)) } }
    }

    val refresh = tick + resume
    val rows = remember(refresh) { listOf(
        SetupRow(
            "Bluetooth", "Lets the app find and talk to the watch and the scale.",
            SetupChecks.bluetooth(context), "Allow",
        ) { ask(SetupChecks.bluetoothPermissions) },
        SetupRow(
            "Notifications", "Shows the connection status and the find-my-phone alarm.",
            SetupChecks.postNotifications(context), "Allow",
        ) { ask(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS)) },
        SetupRow(
            "Notification access", "Needed to send phone notifications and music to the watch.",
            SetupChecks.notificationAccess(context), "Open",
        ) { open(SetupChecks.notificationAccessIntent(context)) },
        SetupRow(
            "Battery optimisation", "Stops the phone putting the watch link to sleep.",
            SetupChecks.batteryExempt(context), "Allow",
        ) { open(SetupChecks.batteryIntent(context)) },
        SetupRow(
            "Auto-launch and background activity", "OPPO and ColorOS kill background apps unless both are allowed. This can't be checked from here.",
            null, "Open",
        ) { SetupChecks.openColorOsSettings(context) },
        SetupRow(
            "Location", "Used only for the watch's weather; approximate is enough.",
            SetupChecks.location(context), "Allow",
        ) { ask(SetupChecks.locationPermissions) },
        SetupRow(
            "Do Not Disturb access", "Lets find-my-phone ring even in Do Not Disturb.",
            SetupChecks.dndAccess(context), "Open",
        ) { open(SetupChecks.dndIntent()) },
        SetupRow(
            "Phone and contacts", "Shows who is calling on the watch and lets you reject from it.",
            SetupChecks.phone(context), "Allow",
        ) { ask(SetupChecks.phonePermissions) },
        SetupRow(
            "Watch", "Pair the Xiaomi Watch S5 once; it then reconnects by itself.",
            SetupChecks.paired(), "Pair",
        ) { onPairWatch() },
    ) + listOfNotNull(
        SetupRow("Watch key", "The app was built without the watch's key.", false, null) {}.takeIf { !SetupChecks.authKey() },
    ) }

    PlainScreen("Setup checklist", Hb.hr, onBack) {
        rows.forEach { SetupItem(it) }
    }
}

@Composable
private fun SetupItem(row: SetupRow) {
    HbCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(row.title, style = Hb.Type.bodyStrong, color = Hb.text, modifier = Modifier.weight(1f))
            when (row.done) {
                true -> StatusPill("Done", Hb.sync)
                false -> StatusPill("Needs setup", Hb.warn)
                null -> StatusPill("Not checked", Hb.text3)
            }
        }
        if (row.done == true) return@HbCard
        Spacer(Modifier.height(4.dp))
        Text(row.text, style = Hb.Type.body, color = Hb.text2)
        if (row.action != null) {
            Spacer(Modifier.height(10.dp))
            HbButton(row.action, row.onAction, primary = row.done == false)
        }
    }
}
