package app.kumquant.healthbridge.ui.health

import androidx.compose.ui.graphics.Color
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.ceil

/** Xiaomi's 0-100 stress bands. */
fun stressColor(v: Double): Color = when {
    v <= 25 -> Hb.stressRelaxed
    v <= 50 -> Hb.stressMild
    v <= 75 -> Hb.stressModerate
    else -> Hb.stressHigh
}

fun stressLabel(v: Double): String = when {
    v <= 25 -> "Relaxed"
    v <= 50 -> "Mild"
    v <= 75 -> "Moderate"
    else -> "High"
}

val STRESS_BANDS = listOf(
    Band(0.0, 25.0, Hb.stressRelaxed, "Relaxed"),
    Band(25.0, 50.0, Hb.stressMild, "Mild"),
    Band(50.0, 75.0, Hb.stressModerate, "Moderate"),
    Band(75.0, 100.0, Hb.stressHigh, "High"),
)

/** Averages consecutive points so a dense series draws as at most [max] points. */
fun downsample(pts: List<Pt>, max: Int): List<Pt> {
    if (pts.size <= max) return pts
    val step = ceil(pts.size / max.toDouble()).toInt()
    return pts.chunked(step).map { c -> Pt(c.sumOf { it.x } / c.size, c.sumOf { it.y } / c.size) }
}

fun List<SampleEntity>.pts(minValue: Double = Double.NEGATIVE_INFINITY): List<Pt> =
    filter { it.value >= minValue }.map { Pt(it.start.toDouble(), it.value) }

/** Hour-of-day tick labels for a 0-24 h axis anchored at local midnight [dayStartMs]. */
fun dayTicks(dayStartMs: Long, everyH: Int = 6): List<Pair<Double, String>> =
    (0..24 step everyH).map { (dayStartMs + it * 3_600_000.0) to "%02d".format(it % 24) }
