package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.roundToInt

/** What differs between SpO2, stress and body energy on a "reading through the day" screen. */
class Vital(
    val title: String,
    val metric: String,
    val color: Color,
    val unit: String,
    val yMin: Double,
    val yMax: Double,
    val ticks: List<Double>,
    val bands: List<Band> = emptyList(),
    /** Colour of a value, for range capsules and the readout. */
    val levelColor: ((Double) -> Color)? = null,
    val levelLabel: ((Double) -> String)? = null,
    /** Readings are sparse spot checks: draw dots, not a continuous line. */
    val spot: Boolean = false,
    /** Lowest value that is a real reading. */
    val minValid: Double = 0.0,
)

val Spo2Vital = Vital("Blood oxygen", Metrics.SPO2, Hb.spo2, "%", 85.0, 100.0, listOf(85.0, 90.0, 95.0, 100.0), spot = true, minValid = 50.0)
val StressVital = Vital(
    "Stress", Metrics.STRESS, Hb.stress, "", 0.0, 100.0, listOf(0.0, 25.0, 50.0, 75.0, 100.0),
    bands = STRESS_BANDS, levelColor = ::stressColor, levelLabel = ::stressLabel, minValid = 1.0,
)
val EnergyVital = Vital("Body energy", Metrics.BODY_ENERGY, Hb.energy, "", 0.0, 100.0, listOf(0.0, 25.0, 50.0, 75.0, 100.0), minValid = 0.0)

@Composable
fun VitalScreen(v: Vital, onBack: () -> Unit) {
    val repo = rememberRepo()
    PeriodScreen(v.title, v.color, Period.entries, onBack) { span ->
        if (span.period == Period.Day) VitalDay(repo, v, span) else VitalRange(repo, v, span)
    }
}

private fun Vital.fmt(x: Double) = "${x.roundToInt()}${if (unit.isNotEmpty()) " $unit" else ""}"

@Composable
private fun VitalDay(repo: HealthRepository, v: Vital, span: Span) {
    val samples by remember(span) { repo.samples(v.metric, span.from, span.to) }.collectAsStateWithLifecycle(null)
    val all = samples ?: return
    val s = all.filter { it.value >= v.minValid }
    if (s.isEmpty()) { Hint("No readings this day."); return }
    val day0 = repo.ms(span.from).toDouble()
    val day1 = repo.ms(span.to).toDouble()
    val last = s.last()
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Through the day", trailing = v.unit.ifEmpty { "0-100" })
        LineChart(
            series = listOf(
                if (v.spot) LineSpec(s.pts(), v.color, 1.4.dp, fill = false, dots = true, gap = 2 * 3_600_000.0, dotRadius = 3.dp)
                else LineSpec(downsample(s.pts(), 300), v.color, 2.dp, fill = v.bands.isEmpty(), smooth = false, gap = 45 * 60_000.0),
            ),
            xMin = day0, xMax = day1, yMin = v.yMin, yMax = v.yMax, height = 220.dp, yTicks = v.ticks,
            xTicks = dayTicks(repo.ms(span.from), 3), bands = v.bands,
            tipText = { p, _ -> fmtClock(p.x.toLong()) to (v.fmt(p.y) + (v.levelLabel?.let { " · ${it(p.y)}" } ?: "")) },
        )
        StatRow(Modifier.padding(top = 14.dp)) {
            Stat("Lowest", v.fmt(s.minOf { it.value }), null, Modifier.weight(1f))
            Stat("Average", v.fmt(s.map { it.value }.average()), null, Modifier.weight(1f))
            Stat("Highest", v.fmt(s.maxOf { it.value }), null, Modifier.weight(1f))
        }
    }
    if (v.levelLabel != null) {
        val bands = v.bands
        val counts = bands.map { b -> s.count { it.value > b.lo && it.value <= b.hi || (b.lo == 0.0 && it.value == 0.0) } }
        HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Share of readings", trailing = "latest ${last.value.roundToInt()} · ${v.levelLabel.invoke(last.value)}")
            SegmentBar(bands.mapIndexed { i, b -> counts[i].toDouble() to b.color }, Modifier.padding(bottom = 8.dp))
            Column {
                for (i in bands.indices.reversed()) {
                    val b = bands[i]
                    LegendRow(b.color, b.label ?: "", "${b.lo.roundToInt() + if (i == 0) 0 else 1}-${b.hi.roundToInt()}", "${(counts[i] * 100.0 / s.size).roundToInt()} %", null)
                }
            }
        }
    } else {
        HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Latest reading", trailing = fmtClock(last.start))
            BigValue(last.value.roundToInt().toString(), v.unit.ifEmpty { "of 100" })
        }
    }
}

@Composable
private fun VitalRange(repo: HealthRepository, v: Vital, span: Span) {
    val stats by remember(span) { repo.daily(v.metric, span.from, span.to, v.minValid) }.collectAsStateWithLifecycle(null)
    val s = stats ?: return
    if (s.isEmpty()) { Hint("No readings in this period."); return }
    val buckets = remember(span) { span.buckets() }
    val aggs = remember(s, buckets) { aggregate(s, buckets) }
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(if (span.period == Period.Year) "Range by month" else "Range by day", trailing = v.unit.ifEmpty { "0-100" })
        RangeChart(
            items = aggs.mapIndexed { i, a ->
                RangeSpec(
                    a?.lo, a?.hi, a?.avg, a?.let { v.levelColor?.invoke(it.avg) } ?: v.color, buckets[i].tip,
                    if (a == null) "No data" else "${a.lo.roundToInt()}-${a.hi.roundToInt()}${if (v.unit.isNotEmpty()) " ${v.unit}" else ""}, avg ${a.avg.roundToInt()}",
                    buckets[i].label,
                )
            },
            yMin = v.yMin, yMax = v.yMax, yTicks = v.ticks, bands = v.bands, height = 210.dp,
        )
        StatRow(Modifier.padding(top = 14.dp)) {
            Stat("Lowest", v.fmt(s.minOf { it.lo }), null, Modifier.weight(1f))
            val avg = s.sumOf { it.sum } / s.sumOf { it.n }
            Stat("Average", v.fmt(avg), null, Modifier.weight(1f), v.levelColor?.invoke(avg) ?: Hb.text)
            Stat("Highest", v.fmt(s.maxOf { it.hi }), null, Modifier.weight(1f))
        }
    }
}
