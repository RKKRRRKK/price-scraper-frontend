package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.ui.theme.Hb
import app.kumquant.healthbridge.ui.theme.HealthBridgeTheme
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.roundToInt

private val TILE_H = 158.dp

/** The tile grid. Tiles with no data are absent; a lone half-width tile widens to fill its row. */
@Composable
fun HealthHome(onOpen: (String) -> Unit, vm: HomeViewModel = viewModel()) {
    val tiles by vm.tiles.collectAsStateWithLifecycle()
    val updated by vm.updated.collectAsStateWithLifecycle()
    HealthHomeContent(tiles, updated, onOpen)
}

@Composable
fun HealthHomeContent(tiles: List<TileData>?, updated: Long?, onOpen: (String) -> Unit) {
    val rows = packRows(tiles.orEmpty())
    LazyColumn(
        Modifier.fillMaxSize().background(Hb.bg),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(Modifier.padding(bottom = 4.dp)) {
                Text("Health", style = Hb.Type.display, color = Hb.text)
                if (updated != null) Text("Updated ${fmtAgo(updated)}", style = Hb.Type.caption, color = Hb.text3)
            }
        }
        if (tiles != null && tiles.isEmpty()) item { Hint("No health data yet. Tiles appear once the watch has synced.") }
        items(rows, key = { r -> r.joinToString { it.key } }) { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (t in row) Tile(t, wide = row.size == 1, Modifier.weight(1f).height(TILE_H), onOpen)
            }
        }
    }
}

private fun packRows(tiles: List<TileData>): List<List<TileData>> {
    val rows = ArrayList<List<TileData>>()
    var pending: TileData? = null
    for (t in tiles) {
        if (t.wide) {
            pending?.let { rows += listOf(it) }; pending = null
            rows += listOf(t)
        } else if (pending == null) pending = t
        else { rows += listOf(pending, t); pending = null }
    }
    pending?.let { rows += listOf(it) }
    return rows
}

@Composable
private fun Tile(t: TileData, wide: Boolean, modifier: Modifier, onOpen: (String) -> Unit) {
    val today = LocalDate.now()
    when (t) {
        is HrTile -> TileCard("Heart rate", Hb.hr, modifier, { onOpen(Routes.HR) }) {
            Row(verticalAlignment = Alignment.Bottom) {
                BigValue("${t.latest.value.roundToInt()}", "bpm")
                Spacer(Modifier.size(10.dp))
                Text(
                    "${dayWord(t.date, today)} · ${fmtClock(t.latest.start)}",
                    style = Hb.Type.caption, color = Hb.text3, modifier = Modifier.padding(bottom = 5.dp), maxLines = 1,
                )
            }
            Text(
                (if (t.resting != null) "Resting ${t.resting.roundToInt()} bpm · " else "") + "range ${t.lo.roundToInt()}-${t.hi.roundToInt()} bpm",
                style = Hb.Type.caption, color = Hb.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spark(t.spark, Hb.hr, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp), gap = 20 * 60_000.0)
        }

        is SleepTile -> TileCard("Sleep", Hb.sleep, modifier, { onOpen(Routes.SLEEP) }) {
            val n = t.night
            Row(verticalAlignment = Alignment.Bottom) {
                BigValue(fmtDuration(n.asleepMin), null)
                Spacer(Modifier.size(10.dp))
                Text("asleep · ${dayWord(n.date, today)}", style = Hb.Type.caption, color = Hb.text3, modifier = Modifier.padding(bottom = 5.dp), maxLines = 1)
            }
            Text("${fmtClock(n.start)} to ${fmtClock(n.end)}", style = Hb.Type.caption, color = Hb.text2)
            Spacer(Modifier.weight(1f))
            StageBar(n)
            Spacer(Modifier.height(4.dp))
            if (n.hasStages) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    for (s in listOf("deep", "rem", "light")) Row(verticalAlignment = Alignment.CenterVertically) {
                        Dot(stageColor(s), 6.dp); Spacer(Modifier.size(4.dp))
                        Text("${stageLabel(s)} ${fmtDuration(n.mins.getValue(s))}", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
                    }
                }
            }
        }

        is StepsTile -> TileCard("Steps", Hb.steps, modifier, { onOpen(Routes.STEPS) }) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(78.dp), contentAlignment = Alignment.Center) {
                    ProgressRing((t.steps / Hb.STEP_GOAL).toFloat(), Hb.steps, Modifier.fillMaxSize(), 7.dp)
                    Text(fmtInt(t.steps), style = Hb.Type.bodyStrong, color = Hb.text, maxLines = 1)
                }
                Text(
                    if (t.date == today) "of ${fmtInt(Hb.STEP_GOAL.toDouble())} today" else "of ${fmtInt(Hb.STEP_GOAL.toDouble())} · ${dayWord(t.date, today)}",
                    style = Hb.Type.caption, color = Hb.text2, modifier = Modifier.padding(top = 4.dp), maxLines = 1,
                )
            }
        }

        is KcalTile -> TileCard("Calories", Hb.kcal, modifier, { onOpen(Routes.KCAL) }) {
            BigValue(fmtInt(t.total), "kcal")
            Text("Active · ${dayWord(t.date, today).lowercase()}", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            MiniBars(t.hourly, listOf(Hb.kcal), Modifier.fillMaxWidth().weight(1f).padding(top = 8.dp))
        }

        is ActivityTile -> TileCard("Activity", Hb.distance, modifier, { onOpen(Routes.DISTANCE) }) {
            BigValue(fmtKm(t.distanceM), "km")
            Text("${t.activeMin} active min", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            MiniBars(t.hourly, listOf(Hb.distance), Modifier.fillMaxWidth().weight(1f).padding(top = 8.dp))
        }

        is StressTile -> TileCard("Stress", Hb.stress, modifier, { onOpen(Routes.STRESS) }) {
            BigValue("${t.avg.roundToInt()}", "avg")
            Text("Now ${t.latest.roundToInt()} · ${stressLabel(t.latest)}", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            MiniBars(t.hourly, t.hourly.map { stressColor(it ?: 0.0) }, Modifier.fillMaxWidth().weight(1f).padding(top = 8.dp), max = 100.0)
        }

        is Spo2Tile -> TileCard("Blood oxygen", Hb.spo2, modifier, { onOpen(Routes.SPO2) }) {
            BigValue("${t.latest.roundToInt()}", "%")
            Text("Range ${t.lo.roundToInt()}-${t.hi.roundToInt()} %", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            Spark(t.spark, Hb.spo2, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp), yMin = 85.0, yMax = 100.0, fill = false)
        }

        is EnergyTile -> TileCard("Body energy", Hb.energy, modifier, { onOpen(Routes.ENERGY) }) {
            BigValue("${t.latest.roundToInt()}", "of 100")
            Text("Low ${t.lo.roundToInt()} · high ${t.hi.roundToInt()}", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            Spark(t.spark, Hb.energy, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp), yMin = 0.0, yMax = 100.0, smooth = true)
        }

        is RestingTile -> TileCard(if (t.resting != null) "Resting HR" else "HRV", Hb.resting, modifier, { onOpen(Routes.RESTING) }) {
            if (t.resting != null) {
                BigValue("${t.resting.roundToInt()}", "bpm")
                Text(if (t.hrv != null) "HRV ${t.hrv.roundToInt()} ms" else "Last 14 readings", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            } else {
                BigValue("${t.hrv!!.roundToInt()}", "ms")
                Text("Latest HRV", style = Hb.Type.caption, color = Hb.text2, maxLines = 1)
            }
            Spark(t.trend, Hb.resting, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp), fill = false, smooth = true)
        }

        is BodyTile -> TileCard("Weight", Hb.weight, modifier, { onOpen(Routes.BODY) }) {
            BigValue("%.1f".format(t.weightKg), "kg")
            val d = t.deltaKg
            Text(
                listOfNotNull(
                    t.fatPct?.let { "Fat %.1f %%".format(it) },
                    d?.takeIf { abs(it) >= 0.05 }?.let { "%+.1f kg".format(it) },
                ).joinToString(" · ").ifEmpty { "30-day trend" },
                style = Hb.Type.caption, color = Hb.text2, maxLines = 1,
            )
            Spark(t.trend, Hb.weight, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp), fill = false, smooth = true)
        }

        is WorkoutTile -> TileCard("Workout", Hb.kcal, modifier, { onOpen(Routes.WORKOUTS) }) {
            val w = t.workout
            Row(verticalAlignment = Alignment.Bottom) {
                Text(w.name, style = Hb.Type.title, color = Hb.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.size(8.dp))
                Text(dayWord(w.date, today), style = Hb.Type.caption, color = Hb.text3, modifier = Modifier.padding(bottom = 2.dp), maxLines = 1)
            }
            Text(
                listOfNotNull(
                    fmtDuration(w.durationMin),
                    w.distanceM?.let { "${fmtKm(it)} km" },
                    w.avgHr?.let { "avg ${it.roundToInt()} bpm" },
                ).joinToString(" · "),
                style = Hb.Type.caption, color = Hb.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spark(t.hr, Hb.hr, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp))
        }
    }
}

/** Mini stage bar: one segment per stage in time order. */
@Composable
fun StageBar(n: SleepNight, modifier: Modifier = Modifier) {
    val parts = if (n.hasStages) n.stages.map { it.minutes to stageColor(it.stage) } else listOf(n.inBedMin to Hb.sleepLight)
    SegmentBar(parts, modifier, 12.dp)
}

// ── Previews ─────────────────────────────────────────────────────────────

private fun sampleSpark(n: Int, base: Double, amp: Double) = (0 until n).map { Pt(it.toDouble(), base + amp * Math.sin(it / 9.0) + amp * 0.4 * Math.sin(it / 2.3)) }

@Preview(showBackground = true, widthDp = 380, heightDp = 1100)
@Composable
private fun HomePreview() = HealthBridgeTheme {
    val d = LocalDate.now()
    val night = SleepNight(
        "p", 0, 7 * 3_600_000L,
        listOf(Stage("light", 0, 3_000_000), Stage("deep", 3_000_000, 7_000_000), Stage("rem", 7_000_000, 11_000_000), Stage("awake", 11_000_000, 11_600_000), Stage("light", 11_600_000, 25_200_000)),
    )
    HealthHomeContent(
        listOf(
            HrTile(d, SampleEntity("heart_rate", System.currentTimeMillis(), null, 72.0), sampleSpark(120, 74.0, 14.0), 56.0, 48.0, 141.0),
            SleepTile(night),
            StepsTile(d, 5420.0),
            KcalTile(d, 312.0, (0 until 24).map { if (it in 7..20) 10.0 + it * 2 else 0.0 }),
            ActivityTile(d, 4200.0, 38, (0 until 24).map { if (it in 7..20) 300.0 + it * 20 else 0.0 }),
            StressTile(d, 32.0, 28.0, (0 until 24).map { if (it in 6..22) 15.0 + it * 3.0 else null }),
            Spo2Tile(d, 97.0, 94.0, 99.0, sampleSpark(30, 96.5, 1.5)),
            EnergyTile(d, 72.0, 31.0, 90.0, sampleSpark(80, 60.0, 25.0)),
            RestingTile(56.0, sampleSpark(14, 57.0, 2.0), 48.0),
            BodyTile(74.2, -0.3, 18.4, sampleSpark(12, 74.5, 0.4)),
        ),
        System.currentTimeMillis() - 5 * 60_000, {},
    )
}
