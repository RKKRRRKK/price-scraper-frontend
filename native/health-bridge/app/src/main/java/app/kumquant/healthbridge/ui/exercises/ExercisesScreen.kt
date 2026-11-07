package app.kumquant.healthbridge.ui.exercises

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.BridgeState
import app.kumquant.healthbridge.service.BridgeService
import app.kumquant.healthbridge.ui.HbButton
import app.kumquant.healthbridge.ui.StatusPill
import app.kumquant.healthbridge.ui.health.BigValue
import app.kumquant.healthbridge.ui.health.Dot
import app.kumquant.healthbridge.ui.health.HbCard
import app.kumquant.healthbridge.ui.health.Hint
import app.kumquant.healthbridge.ui.health.StatGrid
import app.kumquant.healthbridge.ui.health.fmtInt
import app.kumquant.healthbridge.ui.health.fmtKm
import app.kumquant.healthbridge.ui.health.fmtPace
import app.kumquant.healthbridge.ui.health.groupWeeks
import app.kumquant.healthbridge.ui.health.rememberRepo
import app.kumquant.healthbridge.ui.health.sportChips
import app.kumquant.healthbridge.ui.health.sportCounts
import app.kumquant.healthbridge.ui.health.workoutWeeks
import app.kumquant.healthbridge.ui.health.zoneOf
import app.kumquant.healthbridge.ui.theme.Hb
import app.kumquant.healthbridge.watch.LinkState
import app.kumquant.healthbridge.watch.LiveWorkout
import app.kumquant.healthbridge.watch.WorkoutPhase
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.merge
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The Exercises tab: a live card that stays one line tall until live heart rate or a watch workout is
 * running (then heart rate, zone and elapsed time are shown large), then the workout history (sport
 * chips, week groups) as a lazy list.
 */
@Composable
fun ExercisesScreen(onOpen: (String) -> Unit) {
    StopLiveHeartRateWhenAway()
    val repo = rememberRepo()
    val list by remember { repo.workouts(1000) }.collectAsStateWithLifecycle(null)
    var sport by rememberSaveable { mutableStateOf<String?>(null) }
    val today = remember { LocalDate.now() }
    val counts = remember(list) { list?.let(::sportCounts).orEmpty() }
    val chosen = sport?.takeIf { s -> counts.any { it.first == s } }
    val weeks = remember(list, chosen) { list?.let { groupWeeks(it, chosen) }.orEmpty() }

    LazyColumn(
        Modifier.fillMaxSize().background(Hb.bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "title") { Text("Exercises", style = Hb.Type.display, color = Hb.text, modifier = Modifier.padding(bottom = 4.dp)) }
        item(key = "live") { LiveCard() }
        if (list?.isEmpty() == true) item(key = "empty") { Hint("No workouts yet; they appear after the next sync.") }
        sportChips(counts, list?.size ?: 0, chosen) { sport = it }
        workoutWeeks(weeks, today, onOpen)
    }
}

/** The stream drains the watch, so it ends as soon as the screen is left or the app is backgrounded. */
@Composable
private fun StopLiveHeartRateWhenAway() {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) BridgeService.current?.stopLiveHeartRate()
        }
        owner.lifecycle.addObserver(observer)
        onDispose {
            owner.lifecycle.removeObserver(observer)
            BridgeService.current?.stopLiveHeartRate()
        }
    }
}

@Composable
private fun LiveCard() {
    val link by BridgeState.link.collectAsStateWithLifecycle()
    val workout by BridgeState.liveWorkout.collectAsStateWithLifecycle()
    val on by BridgeState.liveHrOn.collectAsStateWithLifecycle()
    val connected = link == LinkState.CONNECTED
    HbCard(Modifier.fillMaxWidth().animateContentSize()) {
        when {
            workout != null || on -> LiveBody(workout, streaming = on)
            !connected -> Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(Hb.text3)
                Spacer(Modifier.width(8.dp))
                Text("Connect the watch to see live heart rate.", style = Hb.Type.body, color = Hb.text2)
            }
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(Hb.hr)
                Spacer(Modifier.width(8.dp))
                Text("Live heart rate", style = Hb.Type.title, color = Hb.text, modifier = Modifier.weight(1f))
                HbButton("Start", { BridgeService.current?.startLiveHeartRate() }, primary = true)
            }
        }
    }
}

/** Running totals since the live card opened: seconds per zone, time-weighted average, peak. */
private class LiveSession {
    var startMs by mutableLongStateOf(0L)
        private set
    var bpm by mutableIntStateOf(0)
        private set
    var avg by mutableIntStateOf(0)
        private set
    var peak by mutableIntStateOf(0)
        private set
    val zoneS = mutableStateListOf(*Array(Hb.zones.size) { 0.0 })
    private var lastT = 0L
    private var sum = 0.0
    private var weight = 0.0

    fun add(t: Long, value: Int) {
        if (startMs == 0L) startMs = t
        if (lastT > 0 && t > lastT) {
            // A gap (watch out of range) counts for at most 10 s
            val dt = ((t - lastT) / 1000.0).coerceAtMost(10.0)
            zoneS[zoneIndex(bpm)] += dt
            sum += bpm * dt
            weight += dt
        }
        avg = if (weight > 0) (sum / weight).roundToInt() else value
        peak = max(peak, value)
        bpm = value
        lastT = t
    }
}

/** 0 is "Relaxed" (below zone 1), 1-5 are zones 1-5. */
private fun zoneIndex(bpm: Int) = Hb.zones.indexOf(zoneOf(bpm.toDouble()))

private val heroNumber = Hb.Type.display.copy(fontSize = 92.sp, lineHeight = 92.sp, fontWeight = FontWeight.Bold, letterSpacing = (-3).sp)
private val zoneNumber = Hb.Type.display.copy(fontSize = 56.sp, lineHeight = 56.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp)

private val CYCLING_SPORTS = setOf(6, 7, 206, 324)

/**
 * Heart rate and zone big enough to read mid-exercise, then elapsed / average / peak, the zone ladder and
 * the scrolling chart. Readings come from the live stream and, during a watch workout, from its stats.
 * Elapsed is the watch's own clock during a workout, else the time since the first reading.
 */
@Composable
private fun LiveBody(w: LiveWorkout?, streaming: Boolean) {
    val series = remember { LiveSeries() }
    val session = remember { LiveSession() }
    LaunchedEffect(Unit) {
        merge(
            BridgeState.liveHr.mapNotNull { r -> r?.takeIf { it.bpm > 0 }?.let { it.at to it.bpm } },
            BridgeState.liveWorkout.mapNotNull { x -> x?.hr?.takeIf { it > 0 }?.let { System.currentTimeMillis() to it } },
        ).collect { (t, bpm) ->
            series.add(t, bpm)
            session.add(t, bpm)
        }
    }
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(1000)
            value = System.currentTimeMillis()
        }
    }
    val bpm = session.bpm
    val zi = if (bpm > 0) zoneIndex(bpm) else -1
    val zone = Hb.zones.getOrNull(zi)
    val color by animateColorAsState(zone?.color ?: Hb.text3, label = "zone")
    val elapsedS = w?.elapsedS ?: if (session.startMs > 0) ((now - session.startMs) / 1000).toInt() else 0

    Row(verticalAlignment = Alignment.CenterVertically) {
        Dot(color)
        Spacer(Modifier.width(8.dp))
        Text(w?.sport ?: "Live heart rate", style = Hb.Type.label, color = Hb.text2, modifier = Modifier.weight(1f))
        if (w?.phoneGps == true) StatusPill("Phone GPS", Hb.sync)
        if (w?.phase == WorkoutPhase.PAUSED) {
            Spacer(Modifier.width(6.dp))
            StatusPill("Paused", Hb.warn)
        }
        if (streaming) {
            Spacer(Modifier.width(8.dp))
            HbButton("Stop", { BridgeService.current?.stopLiveHeartRate() })
        }
    }

    Row(
        Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(color.copy(alpha = 0.10f))
            .padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(if (bpm > 0) "$bpm" else "--", style = heroNumber, color = color)
                Text("bpm", style = Hb.Type.title, color = color, modifier = Modifier.padding(start = 6.dp, bottom = 14.dp))
            }
            if (bpm > 0) Text("${(bpm * 100f / Hb.MAX_HR).roundToInt()}% of max", style = Hb.Type.label, color = Hb.text2)
        }
        Column(horizontalAlignment = Alignment.End) {
            if (zi >= 1) {
                Text("ZONE", style = Hb.Type.label, color = color)
                Text("$zi", style = zoneNumber, color = color)
            }
            Text(zone?.label ?: "Waiting", style = Hb.Type.bodyStrong, color = color)
        }
    }

    Row(Modifier.padding(top = 14.dp).fillMaxWidth()) {
        LiveStat("Elapsed", fmtElapsed(elapsedS), null, Modifier.weight(1.2f))
        LiveStat("Average", if (session.avg > 0) "${session.avg}" else "--", "bpm", Modifier.weight(1f))
        LiveStat("Peak", if (session.peak > 0) "${session.peak}" else "--", "bpm", Modifier.weight(1f))
    }

    ZoneLadder(bpm, zi, session.zoneS, Modifier.padding(top = 16.dp))
    LiveHrChart(series, running = true, modifier = Modifier.padding(top = 12.dp))

    if (w != null) {
        val cycling = w.sportCode in CYCLING_SPORTS
        val dist = w.distanceM
        val items = listOfNotNull(
            dist?.let { Triple("Distance", fmtKm(it.toDouble()), "km") },
            if (dist != null && dist >= 50 && w.elapsedS > 0) {
                if (cycling) Triple("Avg speed", "%.1f".format(dist / 1000.0 / (w.elapsedS / 3600.0)), "km/h")
                else Triple("Avg pace", fmtPace(w.elapsedS / (dist / 1000.0)), "/km")
            } else null,
            w.kcal?.let { Triple("Energy", fmtInt(it.toDouble()), "kcal") },
            w.steps?.takeIf { it > 0 }?.let { Triple("Steps", fmtInt(it.toDouble()), null) },
            w.steps?.takeIf { it > 0 && w.elapsedS >= 60 }?.let { Triple("Cadence", "${(it * 60f / w.elapsedS).roundToInt()}", "spm") },
        )
        if (items.isNotEmpty()) Column(Modifier.padding(top = 12.dp)) { StatGrid(*items.toTypedArray()) }
    }
}

@Composable
private fun LiveStat(label: String, value: String, unit: String?, modifier: Modifier) {
    Column(modifier) {
        Text(label, style = Hb.Type.label, color = Hb.text3)
        BigValue(value, unit)
    }
}

/** Zones 1-5 as five equal segments with a marker at the current heart rate, and the time spent in each. */
@Composable
private fun ZoneLadder(bpm: Int, current: Int, zoneS: List<Double>, modifier: Modifier = Modifier) {
    // 0..1 along the five segments; below zone 1 the marker rests at the left edge
    val pos = if (bpm <= 0) null else {
        val seg = (current - 1).coerceAtLeast(0)
        val z = Hb.zones[seg + 1]
        val top = if (z.to.isInfinite()) 1.0 else z.to
        val within = if (current < 1) 0.0 else ((bpm.toDouble() / Hb.MAX_HR - z.from) / (top - z.from)).coerceIn(0.0, 1.0)
        ((seg + within) / 5.0).toFloat()
    }
    val animPos by animateFloatAsState(pos ?: 0f, label = "zonePos")
    val markerColor = Hb.zones.getOrNull(current)?.color ?: Hb.text3
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(18.dp)) {
            val gap = 4.dp.toPx()
            val segW = (size.width - gap * 4) / 5
            val barH = 8.dp.toPx()
            val y = (size.height - barH) / 2
            for (i in 1..5) {
                drawRoundRect(
                    Hb.zones[i].color.copy(alpha = if (i == current) 1f else 0.25f),
                    Offset((i - 1) * (segW + gap), y), Size(segW, barH), CornerRadius(barH / 2),
                )
            }
            if (pos != null) {
                val seg = (animPos * 5).toInt().coerceIn(0, 4)
                val x = seg * (segW + gap) + (animPos * 5 - seg) * segW
                val r = size.height / 2
                val c = Offset(x.coerceIn(r, size.width - r), r)
                drawCircle(Hb.panel, r, c)
                drawCircle(markerColor, r - 3.dp.toPx(), c)
            }
        }
        Row(Modifier.padding(top = 4.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (i in 1..5) {
                val on = i == current
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Z$i", style = Hb.Type.label, color = if (on) Hb.zones[i].color else Hb.text3)
                    Text(fmtElapsed(zoneS[i].roundToInt()), style = Hb.Type.caption, color = if (on) Hb.text else Hb.text3)
                }
            }
        }
    }
}

private fun fmtElapsed(s: Int): String {
    val h = s / 3600
    val m = s / 60 % 60
    val sec = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%02d:%02d".format(m, sec)
}
