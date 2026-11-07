package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.roundToInt

/** What differs between steps, calories and distance on an "adds up over time" screen. */
class Accumulator(
    val title: String,
    val metric: String,
    val color: Color,
    val unit: String,
    /** Metric value to displayed value (metres to km). */
    val scale: Double = 1.0,
    val decimals: Int = 0,
    val goal: Double? = null,
    val showActiveMinutes: Boolean = false,
)

val StepsAcc = Accumulator("Steps", Metrics.STEPS, Hb.steps, "steps", goal = Hb.STEP_GOAL.toDouble())
val KcalAcc = Accumulator("Active calories", Metrics.ACTIVE_KCAL, Hb.kcal, "kcal")
val DistanceAcc = Accumulator("Distance", Metrics.DISTANCE_M, Hb.distance, "km", scale = 0.001, decimals = 2, showActiveMinutes = true)

private fun Accumulator.fmt(v: Double) = "%,.${decimals}f".format(v * scale)

@Composable
fun AccumulatorScreen(acc: Accumulator, onBack: () -> Unit) {
    val repo = rememberRepo()
    PeriodScreen(acc.title, acc.color, Period.entries, onBack) { span ->
        if (span.period == Period.Day) AccumulatorDay(repo, acc, span) else AccumulatorRange(repo, acc, span)
    }
}

@Composable
private fun AccumulatorDay(repo: HealthRepository, acc: Accumulator, span: Span) {
    val hourly by remember(span) { repo.hourly(acc.metric, span.from) }.collectAsStateWithLifecycle(null)
    val active by remember(span) { repo.daily(Metrics.STEPS, span.from, span.to, HomeViewModel.ACTIVE_STEPS_PER_MIN) }.collectAsStateWithLifecycle(null)
    val h = hourly
    if (h == null) return
    val total = h.sum()
    if (total <= 0) { Hint("Nothing recorded this day."); return }
    HbCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Total", style = Hb.Type.caption, color = Hb.text3)
                BigValue(acc.fmt(total), acc.unit, big = true)
                if (acc.goal != null) Text(
                    if (total >= acc.goal) "Goal of ${fmtInt(acc.goal)} reached" else "${fmtInt(acc.goal - total)} to the ${fmtInt(acc.goal)} goal",
                    style = Hb.Type.caption, color = Hb.text2,
                )
            }
            if (acc.goal != null) Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) {
                ProgressRing((total / acc.goal).toFloat(), acc.color, Modifier.fillMaxSize(), 7.dp)
                Text("${(total / acc.goal * 100).roundToInt()} %", style = Hb.Type.bodyStrong, color = Hb.text)
            }
        }
    }
    val peak = h.indices.maxByOrNull { h[it] } ?: 0
    val ticks = zeroBasedTicks(h.max() * acc.scale)
    HbCard(Modifier.fillMaxWidth()) {
        CardTitle("By hour", trailing = acc.unit)
        BarChart(
            bars = h.mapIndexed { i, v ->
                BarSpec(v * acc.scale, acc.color, "%02d:00 - %02d:00".format(i, (i + 1) % 24), "${acc.fmt(v)} ${acc.unit}", if (i % 6 == 0) "%02d".format(i) else null)
            },
            yMax = ticks.last(), yTicks = ticks, yFormat = { "%,.${if (acc.decimals > 0 && it < 10) 1 else 0}f".format(it) },
            goal = null,
        )
        StatRow(Modifier.padding(top = 12.dp)) {
            Stat("Busiest hour", "%02d:00".format(peak), null, Modifier.weight(1f))
            Stat("There", acc.fmt(h[peak]), acc.unit, Modifier.weight(1f))
            val hoursActive = h.count { it > 0 }
            Stat("Hours with activity", "$hoursActive", "h", Modifier.weight(1f))
        }
    }
    if (acc.showActiveMinutes) {
        HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Active minutes")
            BigValue("${active?.firstOrNull()?.n ?: 0}", "min")
            Text("Minutes with at least ${HomeViewModel.ACTIVE_STEPS_PER_MIN.roundToInt()} steps.", style = Hb.Type.caption, color = Hb.text3)
        }
    }
}

@Composable
private fun AccumulatorRange(repo: HealthRepository, acc: Accumulator, span: Span) {
    val stats by remember(span) { repo.daily(acc.metric, span.from, span.to) }.collectAsStateWithLifecycle(null)
    val active by remember(span) { repo.daily(Metrics.STEPS, span.from, span.to, HomeViewModel.ACTIVE_STEPS_PER_MIN) }.collectAsStateWithLifecycle(null)
    val s = stats ?: return
    if (s.isEmpty()) { Hint("Nothing recorded in this period."); return }
    val buckets = remember(span) { span.buckets() }
    val aggs = remember(s, buckets) { aggregate(s, buckets) }
    val year = span.period == Period.Year
    val value: (Agg?) -> Double = { a -> if (a == null) 0.0 else if (year) a.perDay else a.sum }
    val vals = aggs.map(value)
    val total = s.sumOf { it.sum }
    val daysWith = s.count { it.sum > 0 }
    val bestIdx = vals.indices.maxByOrNull { vals[it] } ?: 0
    val goal = if (year) acc.goal else acc.goal
    val ticks = zeroBasedTicks(maxOf(vals.max(), goal ?: 0.0) * acc.scale)

    HbCard(Modifier.fillMaxWidth()) {
        CardTitle(if (year) "Daily average by month" else "By day", trailing = acc.unit)
        BarChart(
            bars = vals.mapIndexed { i, v ->
                val reached = goal != null && v >= goal
                BarSpec(
                    v * acc.scale, if (reached) acc.color else acc.color.copy(alpha = if (goal != null) 0.62f else 1f),
                    buckets[i].tip, if (aggs[i] == null) "No data" else "${acc.fmt(v)} ${acc.unit}${if (year) " / day" else ""}",
                    buckets[i].label,
                )
            },
            yMax = ticks.last(), yTicks = ticks,
            yFormat = { "%,.${if (acc.decimals > 0 && it < 10) 1 else 0}f".format(it) },
            goal = goal?.times(acc.scale), goalLabel = goal?.let { "Goal ${fmtInt(it)}" },
        )
    }
    HbCard(Modifier.fillMaxWidth()) {
        StatGrid(
            Triple("Total", acc.fmt(total), acc.unit),
            Triple("Daily average", acc.fmt(total / daysWith.coerceAtLeast(1)), acc.unit),
            Triple(if (year) "Best month" else "Best day", acc.fmt(vals[bestIdx]), acc.unit),
            *listOfNotNull(
                goal?.let { g -> Triple("Days at goal", "${s.count { it.sum >= g }}", "of $daysWith") },
                if (acc.showActiveMinutes) Triple("Active time", fmtDuration((active ?: emptyList()).sumOf { it.n }.toDouble()), null) else null,
            ).toTypedArray(),
        )
    }
}
