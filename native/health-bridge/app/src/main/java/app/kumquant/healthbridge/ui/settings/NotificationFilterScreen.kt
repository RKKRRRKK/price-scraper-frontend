package app.kumquant.healthbridge.ui.settings

import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.ui.HbButton
import app.kumquant.healthbridge.ui.health.DetailBar
import app.kumquant.healthbridge.ui.theme.Hb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize

private class AppEntry(val pkg: String, val label: String, val icon: androidx.compose.ui.graphics.ImageBitmap?)

/** Launchable apps with a switch each: on means their notifications go to the watch. */
@Composable
fun NotificationFilterScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val prefs = HealthBridgeApp.prefs
    var apps by remember { mutableStateOf<List<AppEntry>?>(null) }
    var disabled by remember { mutableStateOf(prefs.disabledApps) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) { loadApps(context.packageManager, context.packageName) }
    }

    fun update(next: Set<String>) {
        disabled = next
        prefs.disabledApps = next
    }

    Column(Modifier.fillMaxSize().background(Hb.bg)) {
        DetailBar("Notification apps", Hb.hr, onBack)
        val all = apps
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchField(query) { query = it }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HbButton("All on", { update(emptySet()) }, Modifier.weight(1f))
                HbButton("All off", { update(all?.map { it.pkg }?.toSet().orEmpty()) }, Modifier.weight(1f))
            }
        }
        if (all == null) {
            Text("Loading apps…", style = Hb.Type.body, color = Hb.text2, modifier = Modifier.padding(16.dp))
        } else {
            val shown = all.filter { it.label.contains(query, ignoreCase = true) }
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(shown, key = { it.pkg }) { entry ->
                    AppRow(entry, entry.pkg !in disabled) { on ->
                        update(if (on) disabled - entry.pkg else disabled + entry.pkg)
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit) {
    BasicTextField(
        value = query,
        onValueChange = onChange,
        singleLine = true,
        textStyle = Hb.Type.body.copy(color = Hb.text),
        cursorBrush = SolidColor(Hb.hr),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(Hb.panel)
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text("Search apps", style = Hb.Type.body, color = Hb.text3)
                    inner()
                }
            }
        },
    )
}

@Composable
private fun AppRow(entry: AppEntry, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (entry.icon != null) Image(entry.icon, null, Modifier.size(36.dp)) else Spacer(Modifier.size(36.dp))
        Spacer(Modifier.width(12.dp))
        Text(entry.label, style = Hb.Type.body, color = Hb.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Switch(
            checked = on,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Hb.hr, checkedThumbColor = Color.White,
                uncheckedTrackColor = Hb.panel2, uncheckedThumbColor = Hb.text3, uncheckedBorderColor = Hb.border2,
            ),
        )
    }
}

private fun loadApps(pm: PackageManager, own: String): List<AppEntry> {
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.packageName to it }
        .distinctBy { it.first }
        .filter { it.first != own }
        .map { (pkg, info) ->
            AppEntry(pkg, info.loadLabel(pm).toString(), runCatching { info.loadIcon(pm).asBitmap() }.getOrNull())
        }
        .sortedBy { it.label.lowercase() }
}

private fun Drawable.asBitmap() = toBitmap(96, 96).asImageBitmap()
