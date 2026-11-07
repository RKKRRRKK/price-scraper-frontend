package app.kumquant.healthbridge.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.kumquant.healthbridge.ui.device.WatchScreen
import app.kumquant.healthbridge.ui.health.EXERCISES_ROUTE
import app.kumquant.healthbridge.ui.health.HEALTH_ROUTE
import app.kumquant.healthbridge.ui.health.Routes
import app.kumquant.healthbridge.ui.health.healthGraph
import app.kumquant.healthbridge.ui.settings.NotificationFilterScreen
import app.kumquant.healthbridge.ui.settings.SettingsScreen
import app.kumquant.healthbridge.ui.setup.SetupChecks
import app.kumquant.healthbridge.ui.setup.SetupScreen
import app.kumquant.healthbridge.ui.setup.rememberResumeTick
import app.kumquant.healthbridge.ui.theme.Hb

private const val WATCH_ROUTE = "watch"
private const val SETTINGS_ROUTE = "settings"
private const val FILTER_ROUTE = "settings/filter"
private const val SETUP_ROUTE = "setup"

private enum class Tab(val label: String, val route: String) {
    Health("Health", HEALTH_ROUTE),
    Exercises("Exercises", EXERCISES_ROUTE),
    Watch("Watch", WATCH_ROUTE),
    Settings("Settings", SETTINGS_ROUTE),
}

/** Bottom navigation (Health / Exercises / Watch / Settings) over one NavHost; the health graph is health-ui's. */
@Composable
fun AppScaffold() {
    val nav = rememberNavController()
    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    val tab = when (route) {
        EXERCISES_ROUTE -> Tab.Exercises
        // A workout opened from the Exercises tab (or the Workout tile) keeps that tab selected.
        Routes.WORKOUT -> if (nav.previousBackStackEntry?.destination?.route == EXERCISES_ROUTE) Tab.Exercises else Tab.Health
        WATCH_ROUTE -> Tab.Watch
        SETTINGS_ROUTE, FILTER_ROUTE, SETUP_ROUTE -> Tab.Settings
        else -> Tab.Health
    }
    val context = LocalContext.current
    val resume = rememberResumeTick()
    val missing = remember(resume, route) { SetupChecks.requiredMissing(context) }

    Scaffold(
        containerColor = Hb.bg,
        bottomBar = {
            NavigationBar(containerColor = Hb.panel, tonalElevation = 0.dp) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = t == tab,
                        onClick = { goTab(nav, t) },
                        icon = { TabIcon(t, if (t == tab) Hb.hr else Hb.text3) },
                        label = { Text(t.label, style = Hb.Type.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedTextColor = Hb.hr, unselectedTextColor = Hb.text3, indicatorColor = Hb.hr.copy(alpha = 0.10f),
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            if (route == HEALTH_ROUTE && missing) SetupBanner { nav.navigate(SETUP_ROUTE) }
            NavHost(nav, startDestination = HEALTH_ROUTE, modifier = Modifier.weight(1f)) {
                healthGraph(nav)
                composable(WATCH_ROUTE) { WatchScreen() }
                composable(SETTINGS_ROUTE) {
                    SettingsScreen(onSetup = { nav.navigate(SETUP_ROUTE) }, onFilter = { nav.navigate(FILTER_ROUTE) })
                }
                composable(FILTER_ROUTE) { NotificationFilterScreen(onBack = { nav.popBackStack() }) }
                composable(SETUP_ROUTE) {
                    SetupScreen(onBack = { nav.popBackStack() }, onPairWatch = { goTab(nav, Tab.Watch) })
                }
            }
        }
    }
}

private fun goTab(nav: NavHostController, tab: Tab) {
    nav.navigate(tab.route) {
        popUpTo(HEALTH_ROUTE) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun SetupBanner(onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(14.dp))
            .background(Hb.warn.copy(alpha = 0.12f)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Setup isn't finished.", style = Hb.Type.bodyStrong, color = Hb.warn, modifier = Modifier.weight(1f))
        Text("Open checklist", style = Hb.Type.label, color = Hb.warn)
    }
}

/** Small hand-drawn glyphs; the project has no icon library. */
@Composable
private fun TabIcon(tab: Tab, color: Color) {
    Canvas(Modifier.size(22.dp)) {
        val w = size.width
        val stroke = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
        when (tab) {
            Tab.Health -> {
                drawCircle(color, radius = w * 0.40f, style = stroke)
                drawCircle(color, radius = w * 0.12f)
            }
            Tab.Exercises -> {
                val pulse = Path().apply {
                    moveTo(w * 0.06f, w * 0.56f); lineTo(w * 0.28f, w * 0.56f); lineTo(w * 0.4f, w * 0.18f)
                    lineTo(w * 0.58f, w * 0.84f); lineTo(w * 0.7f, w * 0.44f); lineTo(w * 0.76f, w * 0.56f); lineTo(w * 0.94f, w * 0.56f)
                }
                drawPath(pulse, color, style = Stroke(stroke.width, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            Tab.Watch -> {
                drawRoundRect(color, Offset(w * 0.22f, w * 0.22f), Size(w * 0.56f, w * 0.56f), CornerRadius(w * 0.16f), stroke)
                drawLine(color, Offset(w * 0.38f, w * 0.06f), Offset(w * 0.62f, w * 0.06f), stroke.width, StrokeCap.Round)
                drawLine(color, Offset(w * 0.38f, w * 0.94f), Offset(w * 0.62f, w * 0.94f), stroke.width, StrokeCap.Round)
            }
            Tab.Settings -> {
                for (i in 0..2) {
                    val y = w * (0.25f + 0.25f * i)
                    drawLine(color, Offset(w * 0.12f, y), Offset(w * 0.88f, y), stroke.width, StrokeCap.Round)
                }
            }
        }
    }
}
