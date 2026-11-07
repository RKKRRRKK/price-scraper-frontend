package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.theme.Hb
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

/** One week of workouts, newest first. */
class WeekGroup(val monday: LocalDate, val items: List<WorkoutSummary>) {
    val minutes: Double = items.sumOf { it.durationMin }
    val distanceM: Double = items.sumOf { it.distanceM ?: 0.0 }
}

/** The sports present in [list], most frequent first, with how many workouts each has. */
fun sportCounts(list: List<WorkoutSummary>): List<Pair<String, Int>> =
    list.groupingBy { it.name }.eachCount().entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .map { it.key to it.value }

/** Workouts of [sport] (all if null), grouped by week, newest week first. */
fun groupWeeks(list: List<WorkoutSummary>, sport: String?): List<WeekGroup> =
    list.filter { sport == null || it.name == sport }
        .groupBy { it.date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)) }
        .map { (monday, ws) -> WeekGroup(monday, ws.sortedByDescending { it.start }) }
        .sortedByDescending { it.monday }

private fun weekHeading(monday: LocalDate, today: LocalDate): String {
    val thisMonday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    return when (monday) {
        thisMonday -> "This week"
        thisMonday.minusWeeks(1) -> "Last week"
        else -> "${monday.dayOfMonth} ${monthName(monday.monthValue)} - ${monday.plusDays(6).dayOfMonth} ${monthName(monday.plusDays(6).monthValue)}"
    }
}

/** Sport filter chips; the lazy list item is only emitted when there is more than one sport to choose from. */
fun LazyListScope.sportChips(counts: List<Pair<String, Int>>, total: Int, selected: String?, onSelect: (String?) -> Unit) {
    if (counts.size < 2) return
    item(key = "chips", contentType = "chips") {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "all") { SportChip("All", total, selected == null, Hb.hr) { onSelect(null) } }
            items(counts, key = { it.first }) { (name, n) ->
                SportChip(name, n, selected == name, Hb.hr) { onSelect(if (selected == name) null else name) }
            }
        }
    }
}

@Composable
private fun SportChip(label: String, count: Int, on: Boolean, accent: Color, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Surface(
        shape = shape,
        color = if (on) accent.copy(alpha = 0.12f) else Hb.panel,
        border = BorderStroke(1.dp, if (on) accent.copy(alpha = 0.5f) else Hb.border2),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = Hb.Type.label, color = if (on) accent else Hb.text, maxLines = 1)
            Text("$count", style = Hb.Type.caption, color = if (on) accent else Hb.text3, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

/** The week headers and workout rows. [weeks] comes from [groupWeeks]; rows are lazy, so hundreds are fine. */
fun LazyListScope.workoutWeeks(weeks: List<WeekGroup>, today: LocalDate, onOpen: (String) -> Unit) {
    for (week in weeks) {
        item(key = "week-${week.monday}", contentType = "week") { WeekHeader(week, today) }
        items(week.items, key = { it.id }, contentType = { "workout" }) { w -> WorkoutRow(w, today) { onOpen(w.id) } }
    }
}

@Composable
private fun WeekHeader(week: WeekGroup, today: LocalDate) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp, start = 4.dp), verticalAlignment = Alignment.Bottom) {
        Text(weekHeading(week.monday, today), style = Hb.Type.bodyStrong, color = Hb.text, modifier = Modifier.weight(1f))
        Text(
            listOfNotNull(
                "${week.items.size} ${if (week.items.size == 1) "workout" else "workouts"}",
                fmtDuration(week.minutes),
                week.distanceM.takeIf { it > 0 }?.let { "${fmtKm(it)} km" },
            ).joinToString(" · "),
            style = Hb.Type.caption, color = Hb.text3, maxLines = 1,
        )
    }
}

@Composable
private fun WorkoutRow(w: WorkoutSummary, today: LocalDate, onClick: () -> Unit) {
    HbCard(Modifier.fillMaxWidth(), onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SportIcon(w.type, Modifier.padding(end = 12.dp))
            Column(Modifier.weight(1f)) {
                Text(w.name, style = Hb.Type.title, color = Hb.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${dayWord(w.date, today)} · ${fmtClock(w.start)}", style = Hb.Type.caption, color = Hb.text3)
            }
            Chevron(1, Hb.text3, Modifier.padding(start = 8.dp).size(16.dp))
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Stat("Time", fmtDuration(w.durationMin), null, Modifier.weight(1f))
            Stat("Distance", w.distanceM?.let { fmtKm(it) } ?: "-", if (w.distanceM != null) "km" else null, Modifier.weight(1f))
            Stat("Avg HR", w.avgHr?.roundToInt()?.toString() ?: "-", if (w.avgHr != null) "bpm" else null, Modifier.weight(1f))
            Stat("Energy", w.kcal?.let { fmtInt(it) } ?: "-", if (w.kcal != null) "kcal" else null, Modifier.weight(1f))
        }
    }
}

/** What the sport icon draws; picked from the Health Connect exercise type. */
enum class SportKind(val color: Color) {
    Run(Hb.kcal), Walk(Hb.steps), Cycle(Hb.distance), Swim(Hb.spo2), Strength(Hb.hrv), Mind(Hb.energy), Other(Hb.weight)
}

fun sportKind(type: Int?): SportKind = when (type) {
    56, 57 -> SportKind.Run
    79, 37 -> SportKind.Walk
    8, 9 -> SportKind.Cycle
    73, 74 -> SportKind.Swim
    70, 81, 13, 36, 11, 44 -> SportKind.Strength
    83, 48, 71 -> SportKind.Mind
    else -> SportKind.Other
}

/** A rounded tile in the sport's colour with a hand-drawn glyph. */
@Composable
fun SportIcon(type: Int?, modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 40.dp) {
    val kind = sportKind(type)
    Box(modifier.size(size).background(kind.color.copy(alpha = 0.13f), RoundedCornerShape(size * 0.3f)), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size * 0.6f)) { drawSport(kind, kind.color) }
    }
}

private fun DrawScope.drawSport(kind: SportKind, c: Color) {
    val w = size.width
    val sw = w * 0.1f
    val line = Stroke(sw, cap = StrokeCap.Round, join = StrokeJoin.Round)
    fun p(x: Float, y: Float) = Offset(w * x, w * y)
    fun seg(a: Offset, b: Offset) = drawLine(c, a, b, sw, StrokeCap.Round)
    when (kind) {
        SportKind.Run -> {
            drawCircle(c, w * 0.09f, p(0.62f, 0.14f))
            seg(p(0.55f, 0.28f), p(0.42f, 0.55f))
            seg(p(0.42f, 0.55f), p(0.62f, 0.68f)); seg(p(0.62f, 0.68f), p(0.56f, 0.92f))
            seg(p(0.42f, 0.55f), p(0.26f, 0.72f)); seg(p(0.26f, 0.72f), p(0.12f, 0.66f))
            seg(p(0.55f, 0.32f), p(0.8f, 0.42f)); seg(p(0.52f, 0.34f), p(0.3f, 0.34f))
        }
        SportKind.Walk -> {
            drawCircle(c, w * 0.09f, p(0.5f, 0.12f))
            seg(p(0.5f, 0.26f), p(0.5f, 0.6f))
            seg(p(0.5f, 0.6f), p(0.34f, 0.92f)); seg(p(0.5f, 0.6f), p(0.68f, 0.92f))
            seg(p(0.5f, 0.34f), p(0.3f, 0.52f)); seg(p(0.5f, 0.34f), p(0.7f, 0.52f))
        }
        SportKind.Cycle -> {
            drawCircle(c, w * 0.2f, p(0.2f, 0.68f), style = line); drawCircle(c, w * 0.2f, p(0.8f, 0.68f), style = line)
            val path = Path().apply { moveTo(w * 0.2f, w * 0.68f); lineTo(w * 0.42f, w * 0.34f); lineTo(w * 0.7f, w * 0.34f); lineTo(w * 0.8f, w * 0.68f); moveTo(w * 0.42f, w * 0.34f); lineTo(w * 0.52f, w * 0.68f); lineTo(w * 0.7f, w * 0.34f) }
            drawPath(path, c, style = line)
            seg(p(0.36f, 0.26f), p(0.5f, 0.26f))
        }
        SportKind.Swim -> {
            drawCircle(c, w * 0.09f, p(0.7f, 0.28f))
            for (row in 0..1) {
                val y = w * (0.56f + row * 0.26f)
                val path = Path()
                for (i in 0..24) {
                    val x = w * (0.05f + 0.9f * i / 24f)
                    val yy = y + sin(i / 24f * 2 * PI * 1.5).toFloat() * w * 0.07f
                    if (i == 0) path.moveTo(x, yy) else path.lineTo(x, yy)
                }
                drawPath(path, c, style = line)
            }
            seg(p(0.2f, 0.4f), p(0.58f, 0.34f))
        }
        SportKind.Strength -> {
            seg(p(0.22f, 0.5f), p(0.78f, 0.5f))
            seg(p(0.2f, 0.28f), p(0.2f, 0.72f)); seg(p(0.8f, 0.28f), p(0.8f, 0.72f))
            seg(p(0.06f, 0.4f), p(0.06f, 0.6f)); seg(p(0.94f, 0.4f), p(0.94f, 0.6f))
        }
        SportKind.Mind -> {
            drawCircle(c, w * 0.09f, p(0.5f, 0.16f))
            seg(p(0.5f, 0.3f), p(0.5f, 0.58f))
            seg(p(0.5f, 0.42f), p(0.22f, 0.56f)); seg(p(0.5f, 0.42f), p(0.78f, 0.56f))
            val path = Path().apply { moveTo(w * 0.12f, w * 0.84f); quadraticTo(w * 0.5f, w * 0.52f, w * 0.88f, w * 0.84f) }
            drawPath(path, c, style = line)
        }
        SportKind.Other -> {
            drawCircle(c, w * 0.34f, p(0.5f, 0.56f), style = line)
            seg(p(0.5f, 0.56f), p(0.5f, 0.36f)); seg(p(0.5f, 0.56f), p(0.62f, 0.64f))
            seg(p(0.42f, 0.08f), p(0.58f, 0.08f))
        }
    }
}
