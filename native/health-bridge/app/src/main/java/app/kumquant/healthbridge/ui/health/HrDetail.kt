package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

private val ZONE_BANDS = Hb.zones.map { Band(it.from * Hb.MAX_HR, if (it.to.isInfinite()) 260.0 else it.to * Hb.MAX_HR, it.color, it.label) }

@Composable
fun HrScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    PeriodScreen("Heart rate", Hb.hr, Period.entries, onBack) { span ->
        if (span.period == Period.Day) HrDay(repo, span) else HrRange(repo, span)
    }
}

@Composable
private fun HrDay(repo: HealthRepository, span: Span) {
    val samples by remember(span) { repo.samples(Metrics.HEART_RATE, span.from, span.to) }.collectAsStateWithLifecycle(null)
    val resting by remember(span) { repo.samples(Metrics.RESTING_HEART_RATE, span.from, span.to) }.collectAsStateWithLifecycle(null)
    val trend by remember(span) { repo.daily(Metrics.RESTING_HEART_RATE, span.from.minusDays(13), span.to, 1.0) }.collectAsStateWithLifecycle(null)
    val all = samples ?: return
    val s = all.filter { it.value > 0 }
    if (s.isEmpty()) { Hint("No heart-rate readings this day."); return }
    val day0 = repo.ms(span.from).toDouble()
    val day1 = repo.ms(span.to).toDouble()
    val hi = ceil((s.maxOf { it.value } + 8) / 20) * 20
    val lo = floor((s.minOf { it.value } - 8) / 20) * 20
    val yMin = minOf(lo, 40.0)
    val ticks = (yMin.toInt()..hi.toInt() step if (hi - yMin > 120) 40 else 20).map { it.toDouble() }

    val zoom = remember(span) { DayZoom(day0, day1) }
    val pts = remember(s) { s.pts() }
    // Lowest/average/highest follow the visible window while zoomed.
    val shown = if (zoom.zoomed) pts.filter { it.x >= zoom.v0 && it.x < zoom.v0 + zoom.span } else pts

    HbCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (zoom.zoomed) "${fmtClock(zoom.v0.toLong())} - ${fmtClock((zoom.v0 + zoom.span).toLong())}" else "Through the day",
                style = Hb.Type.label, color = Hb.text2, modifier = Modifier.weight(1f))
            if (zoom.zoomed) Text("Whole day", style = Hb.Type.label, color = Hb.hr, modifier = Modifier.clickable { zoom.reset() })
            else Text("bpm", style = Hb.Type.caption, color = Hb.text3)
        }
        HrDayChart(pts, zoom, yMin, hi, ticks, ZONE_BANDS)
        StatRow(Modifier.padding(top = 14.dp)) {
            Stat("Lowest", shown.minOfOrNull { it.y }?.roundToInt()?.toString() ?: "-", "bpm", Modifier.weight(1f))
            Stat("Average", if (shown.isEmpty()) "-" else "${shown.map { it.y }.average().roundToInt()}", "bpm", Modifier.weight(1f))
            Stat("Highest", shown.maxOfOrNull { it.y }?.roundToInt()?.toString() ?: "-", "bpm", Modifier.weight(1f))
            Stat("Resting", resting?.lastOrNull()?.value?.roundToInt()?.toString() ?: "-", if (resting?.isNotEmpty() == true) "bpm" else null, Modifier.weight(1f))
        }
    }
    val mins = DoubleArray(Hb.zones.size)
    for (x in s) mins[Hb.zones.indexOf(zoneOf(x.value))] += 1.0
    ZoneCard(mins.toList())
    RestingTrendCard(span.from.minusDays(13), span.to, trend ?: emptyList(), "Resting heart rate, 14 days")
}

@Composable
private fun RestingTrendCard(from: java.time.LocalDate, to: java.time.LocalDate, stats: List<DayStat>, title: String) {
    val buckets = remember(from, to) { dayBuckets(from, to) }
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(title, trailing = "bpm")
        TrendChart(buckets, bucketAverages(stats, buckets), Hb.resting, "bpm", minSpan = 8.0)
    }
}

@Composable
private fun HrRange(repo: HealthRepository, span: Span) {
    val stats by remember(span) { repo.daily(Metrics.HEART_RATE, span.from, span.to, 1.0) }.collectAsStateWithLifecycle(null)
    val restingStats by remember(span) { repo.daily(Metrics.RESTING_HEART_RATE, span.from, span.to, 1.0) }.collectAsStateWithLifecycle(null)
    val zoneMin by remember(span) { repo.hrZoneMinutes(span.from, span.to) }.collectAsStateWithLifecycle(null)
    val s = stats ?: return
    if (s.isEmpty()) { Hint("No heart-rate readings in this period."); return }
    val buckets = remember(span) { span.buckets() }
    val aggs = remember(s, buckets) { aggregate(s, buckets) }
    val lo = floor((s.minOf { it.lo } - 6) / 10) * 10
    val hi = ceil((s.maxOf { it.hi } + 6) / 10) * 10
    val ticks = niceTicks(lo, hi, 4)

    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(if (span.period == Period.Year) "Range by month" else "Range by day", trailing = "bpm")
        RangeChart(
            items = aggs.mapIndexed { i, a ->
                RangeSpec(a?.lo, a?.hi, a?.avg, Hb.hr, buckets[i].tip, if (a == null) "No data" else "${a.lo.roundToInt()}-${a.hi.roundToInt()} bpm, avg ${a.avg.roundToInt()}", buckets[i].label)
            },
            yMin = lo, yMax = hi, yTicks = ticks, height = 210.dp,
        )
        StatRow(Modifier.padding(top = 14.dp)) {
            Stat("Lowest", "${s.minOf { it.lo }.roundToInt()}", "bpm", Modifier.weight(1f))
            Stat("Average", "${(s.sumOf { it.sum } / s.sumOf { it.n }).roundToInt()}", "bpm", Modifier.weight(1f))
            Stat("Highest", "${s.maxOf { it.hi }.roundToInt()}", "bpm", Modifier.weight(1f))
        }
    }

    val rs = restingStats.orEmpty()
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(if (rs.isNotEmpty()) "Resting heart rate" else "Lowest heart rate", trailing = "bpm")
        TrendChart(
            buckets,
            if (rs.isNotEmpty()) bucketAverages(rs, buckets) else aggs.map { it?.lo },
            Hb.resting, "bpm", minSpan = 8.0,
        )
    }
    zoneMin?.let { z -> ZoneCard(z.map { it.toDouble() }) }
}
