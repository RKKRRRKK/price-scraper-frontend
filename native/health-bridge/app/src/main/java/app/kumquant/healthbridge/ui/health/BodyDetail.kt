package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.abs

private class Comp(val metric: String, val label: String, val unit: String?, val decimals: Int, val color: Color)

private val COMPS = listOf(
    Comp(Metrics.BODY_FAT_PCT, "Body fat", "%", 1, Hb.kcal),
    Comp(Metrics.MUSCLE_KG, "Muscle", "kg", 1, Hb.steps),
    Comp(Metrics.WATER_PCT, "Water", "%", 1, Hb.spo2),
    Comp(Metrics.BONE_KG, "Bone", "kg", 1, Hb.weight),
    Comp(Metrics.VISCERAL_FAT, "Visceral fat", null, 0, Hb.hr),
    Comp(Metrics.BMR_KCAL, "Basal metabolism", "kcal", 0, Hb.hrv),
    Comp(Metrics.BMI, "BMI", null, 1, Hb.vo2),
)

@Composable
fun BodyScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    PeriodScreen("Weight and body", Hb.weight, listOf(Period.Month, Period.Year), onBack) { span -> BodyPage(repo, span) }
}

@Composable
private fun BodyPage(repo: HealthRepository, span: Span) {
    val weights by remember(span) { repo.samples(Metrics.WEIGHT_KG, span.from, span.to) }.collectAsStateWithLifecycle(null)
    val latest by remember { repo.lastN(Metrics.WEIGHT_KG, 2) }.collectAsStateWithLifecycle(null)
    val info by remember { repo.info }.collectAsStateWithLifecycle(emptyMap())
    val w = weights ?: return
    val buckets = remember(span) { span.buckets() }
    // The weigh-in tapped on the chart; the cards below follow it (latest when nothing is selected).
    var selectedIdx by remember(span) { mutableStateOf<Int?>(null) }
    val selected = selectedIdx?.let { w.getOrNull(it) }

    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Weight", trailing = "kg")
        if (w.isEmpty()) Hint("No weigh-ins in this period.")
        else {
            val pts = w.map { Pt(it.start.toDouble(), it.value) }
            val (yMin, yMax, ticks) = paddedAxis(pts.minOf { it.y }, pts.maxOf { it.y }, 2.0)
            LineChart(
                series = listOf(LineSpec(pts, Hb.weight, 2.dp, fill = true, dots = true, smooth = true, dotRadius = 3.5.dp)),
                xMin = repo.ms(span.from).toDouble(), xMax = repo.ms(span.to).toDouble(), yMin = yMin, yMax = yMax, yTicks = ticks,
                xTicks = buckets.mapNotNull { b -> b.label?.let { repo.ms(b.from) + 43_200_000.0 to it } },
                yFormat = { "%.1f".format(it) }, height = 200.dp,
                tipText = { p, _ -> fmtDay(repo.dateOf(p.x.toLong())) to "%.1f kg".format(p.y) },
                onSelect = { selectedIdx = it },
            )
            StatRow(Modifier.padding(top = 14.dp)) {
                Stat("Change", "%+.1f".format(pts.last().y - pts.first().y), "kg", Modifier.weight(1f))
                Stat("Lowest", "%.1f".format(pts.minOf { it.y }), "kg", Modifier.weight(1f))
                Stat("Highest", "%.1f".format(pts.maxOf { it.y }), "kg", Modifier.weight(1f))
            }
        }
    }
    (selected ?: latest?.firstOrNull())?.let { l ->
        HbCard(Modifier.fillMaxWidth()) {
            val which = if (selected != null) "Selected weigh-in" else "Latest weigh-in"
            Text("$which · ${fmtDay(repo.dateOf(l.start))}, ${fmtClock(l.start)}", style = Hb.Type.caption, color = Hb.text3)
            BigValue("%.1f".format(l.value), "kg")
        }
    }
    val shown = COMPS.filter { info[it.metric] != null }
    for (row in shown.chunked(2)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (c in row) CompCard(repo, c, span, selected?.start, Modifier.weight(1f))
            if (row.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

/** One component at [at] (a weigh-in's time) or, when null, its latest value; the change is against the reading before. */
@Composable
private fun CompCard(repo: HealthRepository, c: Comp, span: Span, at: Long?, modifier: Modifier) {
    val last by remember { repo.lastN(c.metric, 2) }.collectAsStateWithLifecycle(null)
    val inSpan by remember(span) { repo.samples(c.metric, span.from, span.to) }.collectAsStateWithLifecycle(null)
    val series = inSpan.orEmpty()
    val (cur, prev) = if (at == null) {
        (last?.firstOrNull() ?: return) to last?.getOrNull(1)
    } else {
        val i = series.indexOfFirst { it.start == at }
        series.getOrNull(i) to series.getOrNull(i - 1)
    }
    HbCard(modifier.height(140.dp)) {
        Text(c.label, style = Hb.Type.label, color = Hb.text2, maxLines = 1)
        if (cur == null) {
            BigValue("–", c.unit)
            Text("Not measured that time", style = Hb.Type.caption, color = Hb.text3, maxLines = 1)
        } else {
            BigValue("%.${c.decimals}f".format(cur.value), c.unit)
            val d = prev?.let { cur.value - it.value }
            Text(
                if (d == null || abs(d) < 0.05) "Same as before" else "%+.${c.decimals}f since the one before".format(d),
                style = Hb.Type.caption, color = Hb.text3, maxLines = 1,
            )
        }
        Spark(series.pts(), c.color, Modifier.fillMaxWidth().weight(1f).padding(top = 6.dp), fill = false, smooth = true)
    }
}

@Composable
fun RestingScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    PeriodScreen("Resting HR and HRV", Hb.resting, listOf(Period.Week, Period.Month, Period.Year), onBack) { span ->
        val rest by remember(span) { repo.daily(Metrics.RESTING_HEART_RATE, span.from, span.to, 1.0) }.collectAsStateWithLifecycle(null)
        val hrv by remember(span) { repo.daily(Metrics.HRV_RMSSD, span.from, span.to, 1.0) }.collectAsStateWithLifecycle(null)
        val buckets = remember(span) { span.buckets() }
        val r = rest
        val h = hrv
        if (r == null || h == null) return@PeriodScreen
        if (r.isEmpty() && h.isEmpty()) { Hint("No readings in this period."); return@PeriodScreen }
        if (r.isNotEmpty()) HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Resting heart rate", trailing = "bpm")
            TrendChart(buckets, bucketAverages(r, buckets), Hb.resting, "bpm", minSpan = 8.0)
            StatRow(Modifier.padding(top = 14.dp)) {
                Stat("Lowest", "%.0f".format(r.minOf { it.lo }), "bpm", Modifier.weight(1f))
                Stat("Average", "%.0f".format(r.sumOf { it.sum } / r.sumOf { it.n }), "bpm", Modifier.weight(1f))
                Stat("Highest", "%.0f".format(r.maxOf { it.hi }), "bpm", Modifier.weight(1f))
            }
        }
        if (h.isNotEmpty()) HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Heart-rate variability", trailing = "ms")
            TrendChart(buckets, bucketAverages(h, buckets), Hb.hrv, "ms", minSpan = 20.0)
            StatRow(Modifier.padding(top = 14.dp)) {
                Stat("Lowest", "%.0f".format(h.minOf { it.lo }), "ms", Modifier.weight(1f))
                Stat("Average", "%.0f".format(h.sumOf { it.sum } / h.sumOf { it.n }), "ms", Modifier.weight(1f))
                Stat("Highest", "%.0f".format(h.maxOf { it.hi }), "ms", Modifier.weight(1f))
            }
        }
    }
}
