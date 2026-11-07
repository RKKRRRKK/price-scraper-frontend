package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.ui.theme.Hb
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.math.roundToInt

private val CYCLING = setOf(8, 9)

@Composable
fun WorkoutDetailScreen(id: String, onBack: () -> Unit) {
    val repo = rememberRepo()
    val detail by remember(id) { repo.workout(id) }.collectAsStateWithLifecycle(null)
    val today = remember { LocalDate.now() }
    val d = detail
    PlainScreen(d?.summary?.name ?: "Workout", Hb.kcal, onBack) {
        if (d == null) return@PlainScreen
        val w = d.summary
        val cycling = w.type in CYCLING

        HbCard(Modifier.fillMaxWidth()) {
            Text("${dayWord(w.date, today)} · ${fmtClock(w.start)} to ${fmtClock(w.end)}", style = Hb.Type.caption, color = Hb.text3)
            BigValue(fmtDuration(w.durationMin), null, Modifier.padding(top = 2.dp, bottom = 12.dp))
            val pace = w.paceSPerKm ?: w.distanceM?.takeIf { it > 100 }?.let { w.durationMin * 60 / (it / 1000) }
            val speed = d.num("avg_speed_kmh") ?: w.distanceM?.takeIf { it > 100 }?.let { it / 1000 / (w.durationMin / 60) }
            StatGrid(
                *listOfNotNull(
                    w.distanceM?.let { Triple("Distance", fmtKm(it), "km") },
                    if (cycling) speed?.let { Triple("Speed", "%.1f".format(it), "km/h") } else pace?.let { Triple("Pace", fmtPace(it), "/km") },
                    w.kcal?.let { Triple("Energy", fmtInt(it), "kcal") },
                    w.avgHr?.let { Triple("Average HR", "${it.roundToInt()}", "bpm") },
                    w.maxHr?.let { Triple("Max HR", "${it.roundToInt()}", "bpm") },
                    d.num("steps")?.let { Triple("Steps", fmtInt(it), null) },
                    d.num("avg_cadence")?.let { Triple("Cadence", "${it.roundToInt()}", "spm") },
                    d.num("elevation_gain_m")?.let { Triple("Climb", "${it.roundToInt()}", "m") },
                ).toTypedArray(),
            )
        }

        if (d.hr.size > 1) {
            val t0 = d.hr.first().first.toDouble()
            val t1 = d.hr.last().first.toDouble()
            val pts = downsample(d.hr.map { Pt(it.first.toDouble(), it.second) }, 400)
            val lo = (pts.minOf { it.y } / 10).toInt() * 10 - 10.0
            val hi = (pts.maxOf { it.y } / 10).toInt() * 10 + 20.0
            val spanMin = (t1 - t0) / 60000
            val stepMin = listOf(5, 10, 15, 30, 60).firstOrNull { spanMin / it <= 6 } ?: 120
            val ticks = generateSequence(0) { it + stepMin }.takeWhile { it <= spanMin }.map { t0 + it * 60000.0 to if (it == 0) "0" else "$it min" }.toList()
            HbCard(Modifier.fillMaxWidth()) {
                CardTitle("Heart rate", trailing = "bpm")
                LineChart(
                    series = listOf(LineSpec(pts, Hb.hr, 1.8.dp, fill = false)),
                    xMin = t0, xMax = t1, yMin = lo, yMax = hi, height = 210.dp,
                    yTicks = niceTicks(lo, hi, 4), xTicks = ticks, bands = ZoneBandsFor(),
                    tipText = { p, _ -> "${fmtDuration((p.x - t0) / 60000)} in" to "${p.y.roundToInt()} bpm · ${zoneOf(p.y).label}" },
                )
            }
            ZoneCard(Hb.zones.map { (d.zonesS[it.key] ?: 0.0) / 60.0 })
        }

        if (d.gps.size > 1) {
            HbCard(Modifier.fillMaxWidth()) {
                CardTitle("Route", trailing = w.distanceM?.let { "${fmtKm(it)} km" })
                RouteMap(d.gps)
            }
            val alts = d.gps.filter { it.alt != null }
            if (alts.size > 3) {
                val dist = gpsDistances(d.gps)
                val smooth = d.gps.indices.filter { d.gps[it].alt != null }.map { i ->
                    val win = (maxOf(0, i - 4)..minOf(d.gps.size - 1, i + 4)).mapNotNull { d.gps[it].alt }
                    Pt(dist[i] / 1000, win.average())
                }
                val (yMin, yMax, yt) = paddedAxis(smooth.minOf { it.y }, smooth.maxOf { it.y }, 20.0)
                HbCard(Modifier.fillMaxWidth()) {
                    CardTitle("Elevation", trailing = "m")
                    LineChart(
                        series = listOf(LineSpec(smooth, Hb.distance, 1.8.dp)),
                        xMin = 0.0, xMax = smooth.last().x.coerceAtLeast(0.1), yMin = yMin, yMax = yMax, yTicks = yt,
                        xTicks = niceTicks(0.0, smooth.last().x, 4).map { it to "%.0f km".format(it) },
                        tipText = { p, _ -> "%.2f km".format(p.x) to "${p.y.roundToInt()} m" },
                        height = 150.dp,
                    )
                    val gain = d.num("elevation_gain_m"); val loss = d.num("elevation_loss_m")
                    if (gain != null || loss != null) StatRow(Modifier.padding(top = 12.dp)) {
                        Stat("Climb", gain?.roundToInt()?.toString() ?: "-", "m", Modifier.weight(1f))
                        Stat("Descent", loss?.roundToInt()?.toString() ?: "-", "m", Modifier.weight(1f))
                        Stat("Highest", "${smooth.maxOf { it.y }.roundToInt()}", "m", Modifier.weight(1f))
                    }
                }
            }
        }

        val training = listOfNotNull(
            d.num("training_effect_aerobic")?.let { Triple("Aerobic effect", "%.1f".format(it), "of 5") },
            d.num("training_load")?.let { Triple("Training load", "${it.roundToInt()}", null) },
            d.num("vo2max")?.let { Triple("VO2 max", "${it.roundToInt()}", "ml/kg/min") },
            d.num("recovery_h")?.let { Triple("Recovery", "${it.roundToInt()}", "h") },
        )
        if (training.isNotEmpty()) HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Training")
            StatGrid(*training.toTypedArray())
        }
    }
}

private fun ZoneBandsFor() = Hb.zones.map { Band(it.from * Hb.MAX_HR, if (it.to.isInfinite()) 260.0 else it.to * Hb.MAX_HR, it.color, it.label) }
