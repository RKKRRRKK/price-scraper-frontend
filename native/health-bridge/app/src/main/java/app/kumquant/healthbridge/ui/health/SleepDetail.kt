package app.kumquant.healthbridge.ui.health

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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

private val STACK_ORDER = listOf("deep", "light", "rem", "awake")

@Composable
fun SleepScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    PeriodScreen("Sleep", Hb.sleep, Period.entries, onBack) { span ->
        if (span.period == Period.Day) SleepDay(repo, span) else SleepRange(repo, span)
    }
}

@Composable
private fun SleepDay(repo: HealthRepository, span: Span) {
    val nights by remember(span) { repo.nights(span.from, span.to) }.collectAsStateWithLifecycle(null)
    val list = nights ?: return
    if (list.isEmpty()) { Hint("No sleep recorded for this night."); return }
    val main = list.maxBy { it.inBedMin }
    val naps = list.filter { it !== main }

    HbCard(Modifier.fillMaxWidth()) {
        Text("Asleep", style = Hb.Type.caption, color = Hb.text3)
        BigValue(fmtDuration(main.asleepMin), null)
        Text("${fmtClock(main.start)} to ${fmtClock(main.end)} · ${fmtDuration(main.inBedMin)} in bed", style = Hb.Type.caption, color = Hb.text2)
    }
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Stages", trailing = if (main.hasStages) null else "no stage data")
        Hypnogram(main)
    }
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Breakdown")
        if (!main.hasStages) { Hint("This night has no stage data."); return@HbCard }
        SegmentBar(STACK_ORDER.map { main.mins.getValue(it) to stageColor(it) }.reversed(), Modifier.padding(bottom = 8.dp))
        for (s in listOf("awake", "rem", "light", "deep")) {
            val m = main.mins.getValue(s)
            LegendRow(stageColor(s), stageLabel(s), null, fmtDuration(m), "${(m / main.inBedMin * 100).roundToInt()} %")
        }
    }
    if (naps.isNotEmpty()) HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Naps")
        for (n in naps) Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${fmtClock(n.start)} to ${fmtClock(n.end)}", style = Hb.Type.body, color = Hb.text, modifier = Modifier.weight(1f))
            Text(fmtDuration(n.inBedMin), style = Hb.Type.bodyStrong, color = Hb.text)
        }
    }
}

@Composable
private fun SleepRange(repo: HealthRepository, span: Span) {
    val nights by remember(span) { repo.nights(span.from, span.to) }.collectAsStateWithLifecycle(null)
    val list = nights ?: return
    if (list.isEmpty()) { Hint("No sleep recorded in this period."); return }
    val buckets = remember(span) { span.buckets() }
    val year = span.period == Period.Year
    // one main sleep per wake-up day
    val mains = remember(list) { list.groupBy { it.date }.map { (_, v) -> v.maxBy { it.inBedMin } } }
    val perBucket = remember(mains, buckets) { buckets.map { b -> mains.filter { it.date >= b.from && it.date < b.to } } }

    fun avgMin(l: List<SleepNight>, stage: String) = if (l.isEmpty()) 0.0 else l.map { it.mins.getValue(stage) }.average()
    val totals = perBucket.map { l -> if (l.isEmpty()) 0.0 else l.map { it.inBedMin }.average() }
    val ticks = zeroBasedTicks(totals.max() / 60.0).let { t -> if (t.size > 6) t.filterIndexed { i, _ -> i % 2 == 0 } else t }

    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(if (year) "Average night by month" else "Each night", trailing = "hours")
        BarChart(
            bars = perBucket.mapIndexed { i, l ->
                val segs = STACK_ORDER.map { avgMin(l, it) to stageColor(it) }
                BarSpec(
                    totals[i], Hb.sleep, buckets[i].tip,
                    if (l.isEmpty()) "No sleep" else fmtDuration(l.map { it.asleepMin }.average()) + " asleep",
                    buckets[i].label, segs,
                )
            },
            yMax = ticks.last() * 60, yTicks = ticks.map { it * 60 }, yFormat = { "${(it / 60).roundToInt()}h" },
        )
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(14.dp)) {
            for (s in listOf("deep", "light", "rem", "awake")) Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(stageColor(s), 8.dp)
                Text(" ${stageLabel(s)}", style = Hb.Type.caption, color = Hb.text2)
            }
        }
    }

    val nightsCount = mains.size
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Averages")
        StatGrid(
            Triple("Asleep", fmtDuration(mains.map { it.asleepMin }.average()), null),
            Triple("Bedtime", clockFromShifted(mains.map { shiftedMinutes(it.start) }.average()), null),
            Triple("Wake-up", clockFromShifted(mains.map { shiftedMinutes(it.end) }.average()), null),
            Triple("Deep", fmtDuration(mains.map { it.mins.getValue("deep") }.average()), null),
            Triple("REM", fmtDuration(mains.map { it.mins.getValue("rem") }.average()), null),
            Triple("Nights", "$nightsCount", null),
        )
    }

    val bed = perBucket.map { l -> if (l.isEmpty()) null else l.map { shiftedMinutes(it.start) }.average() }
    val wake = perBucket.map { l -> if (l.isEmpty()) null else l.map { shiftedMinutes(it.end) }.average() }
    val all = (bed + wake).filterNotNull()
    val lo = floor((all.min() - 30) / 60) * 60
    val hi = ceil((all.max() + 30) / 60) * 60
    val step = if (hi - lo > 600) 180.0 else 120.0
    val yTicks = generateSequence(lo) { it + step }.takeWhile { it <= hi }.toList()
    fun dots(v: List<Double?>) = v.mapIndexedNotNull { i, y -> y?.let { Pt(i.toDouble(), it) } }
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("Bedtime and wake-up", trailing = if (year) "monthly average" else "per night")
        LineChart(
            series = listOf(
                LineSpec(dots(wake), Hb.sleepAwake, 1.2.dp, fill = false, dots = true, dotRadius = if (buckets.size > 14) 2.6.dp else 3.6.dp),
                LineSpec(dots(bed), Hb.sleepDeep, 1.2.dp, fill = false, dots = true, dotRadius = if (buckets.size > 14) 2.6.dp else 3.6.dp),
            ),
            xMin = -0.5, xMax = buckets.size - 0.5, yMin = lo, yMax = hi, yTicks = yTicks,
            xTicks = buckets.mapIndexedNotNull { i, b -> b.label?.let { i.toDouble() to it } },
            yFormat = { clockFromShifted(it) },
            tipText = { p, _ ->
                val i = p.x.toInt().coerceIn(buckets.indices)
                buckets[i].tip to "Up ${clockFromShifted(p.y)}" + (bed.getOrNull(i)?.let { " · bed ${clockFromShifted(it)}" } ?: "")
            },
        )
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Dot(Hb.sleepAwake, 8.dp); Text(" Wake-up", style = Hb.Type.caption, color = Hb.text2) }
            Row(verticalAlignment = Alignment.CenterVertically) { Dot(Hb.sleepDeep, 8.dp); Text(" Bedtime", style = Hb.Type.caption, color = Hb.text2) }
        }
    }
}
