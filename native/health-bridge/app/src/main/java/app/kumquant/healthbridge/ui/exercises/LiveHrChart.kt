package app.kumquant.healthbridge.ui.exercises

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.health.label
import app.kumquant.healthbridge.ui.health.zoneOf
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The last couple of minutes of live readings; appended on the main thread, read by the chart's draw pass. */
class LiveSeries(private val windowMs: Long = WINDOW_MS) {
    private var t = LongArray(256)
    private var v = IntArray(256)
    var size = 0
        private set

    /** Bumped on every change, so the chart recomposes and re-targets its y range. */
    var revision by mutableIntStateOf(0)
        private set

    fun add(timeMs: Long, bpm: Int) {
        if (size > 0 && timeMs <= t[size - 1]) return
        // Drop what scrolled out (keeping one point beyond the edge so the line enters from the left).
        var drop = 0
        while (drop + 1 < size && t[drop + 1] < timeMs - windowMs - EDGE_MS) drop++
        if (drop > 0) {
            System.arraycopy(t, drop, t, 0, size - drop)
            System.arraycopy(v, drop, v, 0, size - drop)
            size -= drop
        }
        if (size == t.size) {
            t = t.copyOf(size * 2)
            v = v.copyOf(size * 2)
        }
        t[size] = timeMs
        v[size] = bpm
        size++
        revision++
    }

    fun clear() {
        size = 0
        revision++
    }

    /**
     * How far behind the clock to draw: the longest of the last few gaps between readings plus a margin,
     * so the next reading is always already in hand and the line never waits on it. The S5 sends one
     * about every 5 s, other watches every second.
     */
    fun lagMs(): Long {
        var gap = 1_000L
        for (i in max(1, size - 6) until size) gap = max(gap, t[i] - t[i - 1])
        return (gap + 400L).coerceAtMost(MAX_LAG_MS)
    }

    fun timeAt(i: Int) = t[i]
    fun bpmAt(i: Int) = v[i]

    companion object {
        const val WINDOW_MS = 120_000L
        private const val MAX_LAG_MS = 9_000L
        private const val EDGE_MS = 5_000L
    }
}

/**
 * A scrolling line of the last two minutes. It is drawn one reading interval behind the clock and
 * interpolated, so the line flows continuously instead of stepping when a reading arrives. Only the
 * draw pass reads the frame clock, so nothing recomposes per frame; [LiveSeries.revision] changes with
 * each new reading and re-targets the y range.
 */
@Composable
fun LiveHrChart(series: LiveSeries, running: Boolean, modifier: Modifier = Modifier, height: Dp = 150.dp) {
    val tm = rememberTextMeasurer()
    var frame by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(running) {
        while (running) withFrameNanos { frame = System.currentTimeMillis() }
    }

    // The y range eases toward what the visible readings need.
    var lo = 50f
    var hi = 110f
    // Reading the revision is what makes a new reading recompose this.
    if (series.revision > 0 && series.size > 0) {
        var mn = Int.MAX_VALUE
        var mx = 0
        for (i in 0 until series.size) { mn = min(mn, series.bpmAt(i)); mx = max(mx, series.bpmAt(i)) }
        lo = floor((mn - 8) / 10f) * 10f
        hi = ceil((mx + 8) / 10f) * 10f
        if (hi - lo < 40f) { val mid = (hi + lo) / 2; lo = mid - 20f; hi = mid + 20f }
    }
    val yLo by animateFloatAsState(lo, label = "yLo")
    val yHi by animateFloatAsState(hi, label = "yHi")

    Canvas(modifier.fillMaxWidth().height(height)) {
        val now = frame
        val renderT = now - series.lagMs()
        val left = 2.dp.toPx()
        val right = size.width - 30.dp.toPx()
        val top = 8.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val w = right - left
        val h = bottom - top
        val t0 = renderT - LiveSeries.WINDOW_MS
        fun px(t: Double) = left + ((t - t0) / LiveSeries.WINDOW_MS).toFloat() * w
        fun py(y: Float) = bottom - ((y - yLo) / (yHi - yLo)).coerceIn(-0.2f, 1.2f) * h

        for (z in Hb.zones) {
            val zHi = if (z.to.isInfinite()) 260f else (z.to * Hb.MAX_HR).toFloat()
            val zLo = (z.from * Hb.MAX_HR).toFloat()
            val y1 = py(min(zHi, yHi)); val y0 = py(max(zLo, yLo))
            if (y0 - y1 > 0.5f) drawRect(z.color.copy(alpha = 0.10f), Offset(left, y1), Size(w, y0 - y1))
        }
        val step = if (yHi - yLo > 80f) 20f else 10f
        var tick = ceil(yLo / step) * step
        while (tick <= yHi) {
            val y = py(tick)
            drawLine(Hb.grid, Offset(left, y), Offset(right, y), 1.dp.toPx())
            label(tm, tick.roundToInt().toString(), size.width - 1.dp.toPx(), y, Hb.text3, align = 1, vcenter = true)
            tick += step
        }
        drawLine(Hb.axis, Offset(left, bottom), Offset(right, bottom), 1.dp.toPx())
        label(tm, "2 min ago", left + 20.dp.toPx(), bottom + 4.dp.toPx(), Hb.text3)
        label(tm, "1 min", left + w / 2, bottom + 4.dp.toPx(), Hb.text3)
        label(tm, "now", right - 8.dp.toPx(), bottom + 4.dp.toPx(), Hb.text3)

        // Points up to renderT, plus an interpolated one at renderT.
        val n = series.size
        if (n == 0) return@Canvas
        val xs = FloatArray(n + 1)
        val ys = FloatArray(n + 1)
        var m = 0
        for (i in 0 until n) {
            val ti = series.timeAt(i)
            if (ti <= renderT) {
                xs[m] = px(ti.toDouble()); ys[m] = py(series.bpmAt(i).toFloat()); m++
            } else {
                if (i > 0 && m > 0) {
                    val tp = series.timeAt(i - 1)
                    val f = ((renderT - tp).toFloat() / (ti - tp)).coerceIn(0f, 1f)
                    val value = series.bpmAt(i - 1) + (series.bpmAt(i) - series.bpmAt(i - 1)) * f
                    xs[m] = px(renderT.toDouble()); ys[m] = py(value); m++
                }
                break
            }
        }
        if (m == 0) return@Canvas
        val color = Hb.hr
        val path = Path().apply {
            moveTo(xs[0], ys[0])
            for (i in 1 until m) {
                val mx = (xs[i - 1] + xs[i]) / 2
                cubicTo(mx, ys[i - 1], mx, ys[i], xs[i], ys[i])
            }
        }
        clipRect(left, 0f, right + 6.dp.toPx(), size.height) {
            if (m > 1) {
                val fill = Path().apply {
                    addPath(path)
                    lineTo(xs[m - 1], bottom)
                    lineTo(xs[0].coerceAtLeast(left), bottom)
                    close()
                }
                drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.22f), color.copy(alpha = 0f)), top, bottom))
                drawPath(path, color, style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            val hx = xs[m - 1]; val hy = ys[m - 1]
            val zc = zoneOf(series.bpmAt(series.size - 1).toDouble()).color
            drawCircle(zc.copy(alpha = 0.18f), 9.dp.toPx(), Offset(hx, hy))
            drawCircle(Hb.panel, 5.dp.toPx(), Offset(hx, hy))
            drawCircle(zc, 3.5.dp.toPx(), Offset(hx, hy))
        }
    }
}
