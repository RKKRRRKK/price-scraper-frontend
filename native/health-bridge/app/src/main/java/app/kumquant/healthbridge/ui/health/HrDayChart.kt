package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.theme.Hb
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val MINUTE = 60_000.0
private const val HOUR = 60 * MINUTE
private const val MIN_SPAN = 30 * MINUTE
private val TICK_STEPS_MIN = listOf(5, 10, 15, 30, 60, 120, 180, 360)

/** The visible window [v0, v0 + span) of one day [day0, day1). */
@Stable
class DayZoom(val day0: Double, val day1: Double) {
    var v0 by mutableDoubleStateOf(day0)
    var span by mutableDoubleStateOf(day1 - day0)
    val zoomed: Boolean get() = span < day1 - day0 - 1

    fun reset() { v0 = day0; span = day1 - day0 }

    /** Scale by [factor] keeping the time under [anchor] (0..1 across the plot) fixed, then shift by [shift] plot widths. */
    fun apply(factor: Float, anchor: Float, shift: Float) {
        val t = v0 + anchor * span
        span = (span / factor).coerceIn(MIN_SPAN, day1 - day0)
        v0 = (t - anchor * span - shift * span).coerceIn(day0, day1 - span)
    }
}

/** Candle width for the current zoom; null means draw the minute line. */
private fun bucketMs(span: Double): Double? = when {
    span > 12 * HOUR -> HOUR
    span > 6 * HOUR -> 30 * MINUTE
    span > 3 * HOUR -> 15 * MINUTE
    else -> null
}

private class Candle(val from: Double, val to: Double, val lo: Double, val hi: Double, val avg: Double)

private fun candles(pts: List<Pt>, day0: Double, size: Double): List<Candle> =
    pts.groupBy { ((it.x - day0) / size).toInt() }.map { (i, c) ->
        val from = day0 + i * size
        Candle(from, from + size, c.minOf { it.y }, c.maxOf { it.y }, c.sumOf { it.y } / c.size)
    }

/**
 * Minute heart rate across one day. Pinch zooms, a horizontal drag pans once zoomed (at whole-day
 * zoom it is left to the day pager). Zoomed out it draws min-max candles per hour (finer as it
 * zooms in), below 3 h the raw line. Tap or touch-and-hold reads values, as in [LineChart].
 */
@Composable
fun HrDayChart(
    pts: List<Pt>,
    zoom: DayZoom,
    yMin: Double, yMax: Double, yTicks: List<Double>,
    bands: List<Band>,
    modifier: Modifier = Modifier,
    height: Dp = 230.dp,
) {
    val tm = rememberTextMeasurer()
    val inspect = rememberInspect()
    val reveal = rememberReveal()
    val bucket = bucketMs(zoom.span)
    val bars = remember(pts, bucket) { bucket?.let { candles(pts, zoom.day0, it) } }

    Canvas(modifier.fillMaxWidth().height(height).zoomPan(zoom, inspect).inspectable(inspect)) {
        val left = 2.dp.toPx()
        val right = size.width - 30.dp.toPx()
        val top = 8.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val w = right - left
        val h = bottom - top
        val v0 = zoom.v0
        val v1 = v0 + zoom.span
        fun px(x: Double) = left + ((x - v0) / zoom.span).toFloat() * w
        fun py(y: Double) = bottom - ((y - yMin) / (yMax - yMin)).toFloat().coerceIn(-0.5f, 1.5f) * h

        for (b in bands) {
            val y1 = py(min(b.hi, yMax)); val y0 = py(max(b.lo, yMin))
            if (y0 - y1 <= 0.5f) continue
            drawRect(b.color.copy(alpha = 0.10f), Offset(left, y1), Size(w, y0 - y1))
            if (b.label != null && y0 - y1 > 14.dp.toPx()) label(tm, b.label, left + 5.dp.toPx(), y1 + 3.dp.toPx(), b.color.copy(alpha = 0.95f), align = -1)
        }
        for (t in yTicks) {
            val y = py(t)
            drawLine(Hb.grid, Offset(left, y), Offset(right, y), 1.dp.toPx())
            label(tm, t.roundToInt().toString(), size.width - 1.dp.toPx(), y, Hb.text3, align = 1, vcenter = true)
        }
        drawLine(Hb.axis, Offset(left, bottom), Offset(right, bottom), 1.dp.toPx())
        val stepMin = TICK_STEPS_MIN.first { zoom.span / (it * MINUTE) <= 8 }
        val step = stepMin * MINUTE
        var tick = zoom.day0 + kotlin.math.ceil((v0 - zoom.day0) / step) * step
        while (tick <= v1 + 1) {
            val x = px(tick)
            if (x > left + 14.dp.toPx() && x < right - 14.dp.toPx()) {
                drawLine(Hb.grid, Offset(x, bottom), Offset(x, bottom + 3.dp.toPx()), 1.dp.toPx())
                label(tm, fmtClock(tick.toLong()).let { if (stepMin >= 60) it.take(2) else it }, x, bottom + 4.dp.toPx(), Hb.text3)
            }
            tick += step
        }

        val sel = inspect.x?.let { v0 + ((it - left) / w) * zoom.span }
        clipRect(left, 0f, left + w * reveal.value, size.height) {
            if (bars != null) {
                val bw = ((px(v0 + bucket!!) - px(v0)) * 0.5f).coerceIn(3.dp.toPx(), 14.dp.toPx())
                val hit = sel?.let { t -> bars.firstOrNull { t >= it.from && t < it.to } }
                for (c in bars) {
                    if (c.to < v0 || c.from > v1) continue
                    val cx = px((c.from + c.to) / 2)
                    val dim = if (hit != null && hit !== c) 0.4f else 1f
                    val mid = (py(c.lo) + py(c.hi)) / 2
                    val half = max((py(c.lo) - py(c.hi)) / 2, bw / 2)
                    drawRoundRect(Hb.hr.copy(alpha = 0.85f * dim), Offset(cx - bw / 2, mid - half), Size(bw, half * 2), CornerRadius(bw / 2))
                    val y = py(c.avg)
                    drawCircle(Hb.panel, bw / 2 + 1.dp.toPx(), Offset(cx, y), alpha = dim)
                    drawCircle(Hb.hr.copy(alpha = dim), bw / 2 - 1.dp.toPx(), Offset(cx, y))
                    drawCircle(Hb.panel, max(bw / 2 - 2.5.dp.toPx(), 1.dp.toPx()), Offset(cx, y), alpha = dim)
                }
                if (hit != null) {
                    tip(tm, "${fmtClock(hit.from.toLong())} - ${fmtClock(hit.to.toLong())}",
                        "${hit.lo.roundToInt()}-${hit.hi.roundToInt()} bpm, avg ${hit.avg.roundToInt()}",
                        px((hit.from + hit.to) / 2), top, left, right, Hb.hr)
                }
            } else {
                val vis = pts.filter { it.x >= v0 - 20 * MINUTE && it.x <= v1 + 20 * MINUTE }
                val stroke = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
                var run = ArrayList<Pt>()
                fun flush() {
                    if (run.size == 1) drawCircle(Hb.hr, 2.dp.toPx(), Offset(px(run[0].x), py(run[0].y)))
                    else if (run.size > 1) drawPath(Path().apply {
                        moveTo(px(run[0].x), py(run[0].y))
                        for (i in 1 until run.size) lineTo(px(run[i].x), py(run[i].y))
                    }, Hb.hr, style = stroke)
                    run = ArrayList()
                }
                for (p in vis) {
                    if (run.isNotEmpty() && p.x - run.last().x > 20 * MINUTE) flush()
                    run += p
                }
                flush()
                if (sel != null && vis.isNotEmpty()) {
                    val p = vis.minBy { abs(it.x - sel) }
                    val x = px(p.x); val y = py(p.y)
                    drawLine(Hb.text3.copy(alpha = 0.5f), Offset(x, top), Offset(x, bottom), 1.dp.toPx())
                    drawCircle(Hb.panel, 6.5.dp.toPx(), Offset(x, y))
                    drawCircle(Hb.hr, 4.5.dp.toPx(), Offset(x, y))
                    tip(tm, fmtClock(p.x.toLong()), "${p.y.roundToInt()} bpm · ${zoneOf(p.y).label}", x, top, left, right, Hb.hr)
                }
            }
        }
    }
}

/**
 * Two fingers zoom and pan; a double tap zooms in 3x there. One finger pans only while zoomed and
 * only once the drag is clearly horizontal, so vertical scrolling and the day pager keep working.
 */
private fun Modifier.zoomPan(zoom: DayZoom, inspect: Inspect): Modifier = pointerInput(zoom) {
    val plotLeft = 2.dp.toPx()
    val plotW = { size.width - 30.dp.toPx() - plotLeft }
    var lastTap: PointerInputChange? = null
    awaitEachGesture {
        val first = awaitFirstDown(requireUnconsumed = false)
        var travel = Offset.Zero
        var panning = false
        var gaveUp = false
        var multi = false
        while (true) {
            val ev = awaitPointerEvent()
            val down = ev.changes.filter { it.pressed }
            if (down.isEmpty()) {
                val up = ev.changes.first()
                val tap = !multi && !panning && abs(travel.x) < viewConfiguration.touchSlop && abs(travel.y) < viewConfiguration.touchSlop &&
                    up.uptimeMillis - first.uptimeMillis < viewConfiguration.longPressTimeoutMillis
                val prev = lastTap
                if (tap && prev != null && up.uptimeMillis - prev.uptimeMillis < viewConfiguration.doubleTapTimeoutMillis &&
                    (up.position - prev.position).getDistance() < 40.dp.toPx()
                ) {
                    zoom.apply(3f, ((up.position.x - plotLeft) / plotW()).coerceIn(0f, 1f), 0f)
                    inspect.x = null
                    lastTap = null
                } else lastTap = if (tap) up else null
                break
            }
            travel += down[0].positionChange()
            if (down.any { it.isConsumed }) { gaveUp = true; continue }
            if (down.size >= 2) {
                multi = true
                val c = ev.calculateCentroid(useCurrent = true)
                val anchor = ((c.x - plotLeft) / plotW()).coerceIn(0f, 1f)
                zoom.apply(ev.calculateZoom(), anchor, ev.calculatePan().x / plotW())
                inspect.x = null
                ev.changes.forEach { it.consume() }
                continue
            }
            if (gaveUp || !zoom.zoomed) continue
            val d = down[0].positionChange()
            if (!panning) {
                if (abs(travel.y) > viewConfiguration.touchSlop && abs(travel.y) > abs(travel.x)) gaveUp = true
                else if (abs(travel.x) > viewConfiguration.touchSlop) panning = true
            }
            if (panning) {
                zoom.apply(1f, 0f, d.x / plotW())
                inspect.x = null
                down[0].consume()
            }
        }
    }
}
