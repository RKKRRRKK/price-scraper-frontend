package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
fun rememberRepo(): HealthRepository = viewModel<HealthViewModel>().repo

/** Y ticks from 0 up to at least [max]. */
fun zeroBasedTicks(max: Double): List<Double> {
    val t = niceTicks(0.0, max(max, 1.0) * 1.08, 4)
    if (t.size < 2) return listOf(0.0, max(max, 1.0))
    val step = t[1] - t[0]
    return if (t.last() < max) t + (t.last() + step) else t
}

/** Axis range padded around data, with round ticks: (yMin, yMax, ticks). */
fun paddedAxis(lo: Double, hi: Double, minSpan: Double): Triple<Double, Double, List<Double>> {
    val pad = max((hi - lo) * 0.18, minSpan / 2)
    val a = lo - pad
    val b = hi + pad
    val ticks = niceTicks(a, b, 4)
    return Triple(min(a, ticks.firstOrNull() ?: a), max(b, ticks.lastOrNull() ?: b), ticks)
}

/** Bold value with a small coloured label dot, for legends and breakdown rows. */
@Composable
fun LegendRow(color: Color, label: String, detail: String?, value: String, pct: String?) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Dot(color, 10.dp)
        Spacer(Modifier.width(10.dp))
        Text(label, style = Hb.Type.body, color = Hb.text)
        if (detail != null) Text("  $detail", style = Hb.Type.caption, color = Hb.text3)
        Spacer(Modifier.weight(1f))
        Text(value, style = Hb.Type.bodyStrong, color = Hb.text)
        if (pct != null) Text(pct, style = Hb.Type.caption, color = Hb.text3, modifier = Modifier.width(44.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}

/** Time in each heart-rate zone; [minutes] has one entry per [Hb.zones]. */
@Composable
fun ZoneCard(minutes: List<Double>, title: String = "Time in zones", maxHr: Int = Hb.MAX_HR) {
    val total = minutes.sum()
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(title, trailing = "max HR $maxHr bpm")
        if (total <= 0) { Hint("No heart-rate readings."); return@HbCard }
        SegmentBar(Hb.zones.mapIndexed { i, z -> minutes[i] to z.color }, Modifier.padding(bottom = 8.dp))
        for (i in Hb.zones.indices.reversed()) {
            val z = Hb.zones[i]
            val lo = (z.from * maxHr).roundToInt()
            val hi = if (z.to.isInfinite()) null else (z.to * maxHr).roundToInt() - 1
            val range = when { i == 0 -> "under ${(Hb.zones[1].from * maxHr).roundToInt()} bpm"; hi == null -> "$lo+ bpm"; else -> "$lo-$hi bpm" }
            LegendRow(z.color, z.label, range, fmtDuration(minutes[i]), "${(minutes[i] / total * 100).roundToInt()} %")
        }
    }
}

/** One value per bucket as a smooth line with dots; the shared trend view (resting HR, HRV, weight). */
@Composable
fun TrendChart(
    buckets: List<Bucket>,
    values: List<Double?>,
    color: Color,
    unit: String,
    modifier: Modifier = Modifier,
    height: Dp = 170.dp,
    decimals: Int = 0,
    minSpan: Double = 6.0,
) {
    val pts = values.mapIndexedNotNull { i, v -> v?.let { Pt(i.toDouble(), it) } }
    if (pts.isEmpty()) { Hint("Nothing recorded in this period."); return }
    val (yMin, yMax, ticks) = paddedAxis(pts.minOf { it.y }, pts.maxOf { it.y }, minSpan)
    LineChart(
        series = listOf(LineSpec(pts, color, fill = false, dots = pts.size <= 40, smooth = true, dotRadius = if (pts.size > 20) 2.5.dp else 3.5.dp)),
        xMin = -0.5, xMax = buckets.size - 0.5, yMin = yMin, yMax = yMax,
        modifier = modifier, height = height, yTicks = ticks,
        xTicks = buckets.mapIndexedNotNull { i, b -> b.label?.let { i.toDouble() to it } },
        yFormat = { "%.${decimals}f".format(it) },
        tipText = { p, _ -> buckets[p.x.toInt().coerceIn(buckets.indices)].tip to "%.${decimals}f $unit".format(p.y) },
    )
}

/** Mean of per-day stats inside each bucket, for trend charts. */
fun bucketAverages(stats: List<DayStat>, buckets: List<Bucket>, pick: (DayStat) -> Double = { it.avg }): List<Double?> =
    buckets.map { b ->
        val inB = stats.filter { it.date >= b.from && it.date < b.to }
        if (inB.isEmpty()) null else inB.map(pick).average()
    }

fun floorTo(v: Double, step: Double) = floor(v / step) * step

@Composable
fun StatGrid(vararg items: Triple<String, String, String?>, color: Color = Hb.text) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items.toList().chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for ((l, v, u) in row) Stat(l, v, u, Modifier.weight(1f), color)
                repeat(3 - row.size) { Spacer(Modifier.weight(1f).size(0.dp)) }
            }
        }
    }
}
