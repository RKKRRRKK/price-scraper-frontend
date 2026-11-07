package app.kumquant.healthbridge.ui.health

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.theme.Hb
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** A chart point; `x` is whatever the chart's x axis is (epoch ms, night index, km). */
data class Pt(val x: Double, val y: Double)

/**
 * Horizontal touch position inside one chart. A tap pins it (tap near it again to clear);
 * touch-and-hold then drag scrubs, so swiping between periods is never stolen.
 */
@Stable
class Inspect {
    var x by mutableStateOf<Float?>(null)
}

@Composable
fun rememberInspect() = remember { Inspect() }

fun Modifier.inspectable(state: Inspect): Modifier = this
    .pointerInput(state) {
        detectTapGestures { off ->
            val cur = state.x
            state.x = if (cur != null && abs(cur - off.x) < 24.dp.toPx()) null else off.x
        }
    }
    .pointerInput(state) {
        detectDragGesturesAfterLongPress(
            onDragStart = { state.x = it.x },
            onDrag = { change, _ -> change.consume(); state.x = change.position.x },
        )
    }

/** 0 to 1 once per composition, ease-out; drawn charts read it inside the draw lambda. */
@Composable
fun rememberReveal(ms: Int = 750): State<Float> {
    val preview = LocalInspectionMode.current
    val a = remember { Animatable(if (preview) 1f else 0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(ms, easing = FastOutSlowInEasing)) }
    return a.asState()
}

/** 3 to 6 round tick values covering [lo, hi]. */
fun niceTicks(lo: Double, hi: Double, count: Int = 4): List<Double> {
    if (hi <= lo) return listOf(lo)
    val raw = (hi - lo) / count
    val mag = 10.0.pow(floor(log10(raw)))
    val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.first { it >= raw }
    val out = ArrayList<Double>()
    var v = ceil(lo / step) * step
    while (v <= hi + step * 1e-6) { out += v; v += step }
    return out
}

fun DrawScope.label(
    tm: TextMeasurer, text: String, x: Float, y: Float, color: Color,
    style: TextStyle = Hb.Type.axis, align: Int = 0, vcenter: Boolean = false,
) {
    val l = tm.measure(text, style)
    val tx = when (align) { -1 -> x; 1 -> x - l.size.width; else -> x - l.size.width / 2f }
    drawText(l, color, Offset(tx, if (vcenter) y - l.size.height / 2f else y))
}

/** A small floating readout: grey title above a bold value, clamped inside [minX, maxX]. */
fun DrawScope.tip(tm: TextMeasurer, title: String, value: String, anchorX: Float, top: Float, minX: Float, maxX: Float, accent: Color) {
    val t = tm.measure(title, Hb.Type.caption.copy(color = Hb.text3))
    val v = tm.measure(value, Hb.Type.bodyStrong.copy(color = Hb.text))
    val padX = 10.dp.toPx()
    val padY = 7.dp.toPx()
    val w = max(t.size.width, v.size.width) + padX * 2
    val h = t.size.height + v.size.height + padY * 2 - 1.dp.toPx()
    val x = (anchorX - w / 2).coerceIn(minX, max(minX, maxX - w))
    drawRoundRect(Color(0x1A0F172A), Offset(x, top + 2.dp.toPx()), Size(w, h), CornerRadius(10.dp.toPx()))
    drawRoundRect(Hb.panel, Offset(x, top), Size(w, h), CornerRadius(10.dp.toPx()))
    drawRoundRect(Hb.border2, Offset(x, top), Size(w, h), CornerRadius(10.dp.toPx()), style = Stroke(1.dp.toPx()))
    drawRoundRect(accent, Offset(x + 5.dp.toPx(), top + 8.dp.toPx()), Size(2.5.dp.toPx(), h - 16.dp.toPx()), CornerRadius(2.dp.toPx()))
    drawText(t, topLeft = Offset(x + padX + 3.dp.toPx(), top + padY - 1.dp.toPx()))
    drawText(v, topLeft = Offset(x + padX + 3.dp.toPx(), top + padY + t.size.height - 2.dp.toPx()))
}

private fun DrawScope.dashed(from: Offset, to: Offset, color: Color, width: Float = 1.dp.toPx()) =
    drawLine(color, from, to, width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))

// ── Line chart ───────────────────────────────────────────────────────────

class LineSpec(
    val pts: List<Pt>,
    val color: Color,
    val width: Dp = 2.dp,
    val fill: Boolean = true,
    val dots: Boolean = false,
    val smooth: Boolean = false,
    /** Break the line where the x gap is larger than this. */
    val gap: Double? = null,
    val dotRadius: Dp = 3.dp,
)

class Band(val lo: Double, val hi: Double, val color: Color, val label: String? = null)

private fun segments(pts: List<Pt>, gap: Double?): List<List<Pt>> {
    if (gap == null || pts.size < 2) return listOf(pts)
    val out = ArrayList<List<Pt>>()
    var cur = ArrayList<Pt>()
    for (p in pts) {
        if (cur.isNotEmpty() && p.x - cur.last().x > gap) { out += cur; cur = ArrayList() }
        cur += p
    }
    if (cur.isNotEmpty()) out += cur
    return out
}

/**
 * Time-series line/area/dot chart with y labels on the right, optional background bands
 * (heart-rate zones, stress levels) and a touch readout for the first series.
 */
@Composable
fun LineChart(
    series: List<LineSpec>,
    xMin: Double, xMax: Double, yMin: Double, yMax: Double,
    modifier: Modifier = Modifier,
    height: Dp = 200.dp,
    yTicks: List<Double> = niceTicks(yMin, yMax),
    xTicks: List<Pair<Double, String>> = emptyList(),
    bands: List<Band> = emptyList(),
    yFormat: (Double) -> String = { it.roundToInt().toString() },
    guide: Double? = null,
    guideColor: Color = Hb.text3,
    tipText: ((Pt, Int) -> Pair<String, String>)? = null,
    /** The index into the first series of the point being inspected, or null when nothing is. */
    onSelect: ((Int?) -> Unit)? = null,
) {
    val tm = rememberTextMeasurer()
    val inspect = rememberInspect()
    val reveal = rememberReveal()
    var widthPx by remember { mutableFloatStateOf(0f) }
    if (onSelect != null) {
        val density = LocalDensity.current
        val main = series.firstOrNull()?.pts
        val selected = remember(inspect.x, widthPx, main, xMin, xMax) {
            val sel = inspect.x
            if (sel == null || main.isNullOrEmpty() || widthPx <= 0f) null
            else with(density) {
                val left = 2.dp.toPx()
                val w = widthPx - 30.dp.toPx() - left
                val dx = xMin + ((sel - left) / w) * (xMax - xMin)
                main.indices.minByOrNull { abs(main[it].x - dx) }
            }
        }
        LaunchedEffect(selected) { onSelect(selected) }
    }
    Canvas(modifier.fillMaxWidth().height(height).onSizeChanged { widthPx = it.width.toFloat() }.inspectable(inspect)) {
        val left = 2.dp.toPx()
        val right = size.width - 30.dp.toPx()
        val top = 8.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val w = right - left
        val h = bottom - top
        fun px(x: Double) = left + ((x - xMin) / (xMax - xMin)).toFloat() * w
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
            label(tm, yFormat(t), size.width - 1.dp.toPx(), y, Hb.text3, align = 1, vcenter = true)
        }
        drawLine(Hb.axis, Offset(left, bottom), Offset(right, bottom), 1.dp.toPx())
        for ((x, text) in xTicks) label(tm, text, px(x).coerceIn(left + 8.dp.toPx(), right - 8.dp.toPx()), bottom + 4.dp.toPx(), Hb.text3)
        if (guide != null) dashed(Offset(left, py(guide)), Offset(right, py(guide)), guideColor)

        clipRect(left - 4.dp.toPx(), 0f, left + w * reveal.value + 8.dp.toPx(), size.height) {
            for (s in series) {
                for (seg in segments(s.pts, s.gap)) {
                    if (seg.isEmpty()) continue
                    val path = Path()
                    seg.forEachIndexed { i, p ->
                        val x = px(p.x); val y = py(p.y)
                        if (i == 0) path.moveTo(x, y)
                        else if (s.smooth) {
                            val q = seg[i - 1]
                            val mx = (px(q.x) + x) / 2
                            path.cubicTo(mx, py(q.y), mx, y, x, y)
                        } else path.lineTo(x, y)
                    }
                    if (s.fill && seg.size > 1) {
                        val fillPath = Path().apply {
                            addPath(path)
                            lineTo(px(seg.last().x), bottom)
                            lineTo(px(seg.first().x), bottom)
                            close()
                        }
                        drawPath(fillPath, Brush.verticalGradient(listOf(s.color.copy(alpha = 0.22f), s.color.copy(alpha = 0f)), top, bottom))
                    }
                    if (seg.size > 1) drawPath(path, s.color, style = Stroke(s.width.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                    if (s.dots || seg.size == 1) for (p in seg) {
                        drawCircle(Hb.panel, s.dotRadius.toPx() + 1.5.dp.toPx(), Offset(px(p.x), py(p.y)))
                        drawCircle(s.color, s.dotRadius.toPx(), Offset(px(p.x), py(p.y)))
                    }
                }
            }
        }

        val sel = inspect.x
        val main = series.firstOrNull()?.pts
        if (sel != null && main != null && main.isNotEmpty() && tipText != null) {
            val dx = xMin + ((sel - left) / w) * (xMax - xMin)
            var best = 0
            for (i in main.indices) if (abs(main[i].x - dx) < abs(main[best].x - dx)) best = i
            val p = main[best]
            val x = px(p.x); val y = py(p.y)
            drawLine(Hb.text3.copy(alpha = 0.5f), Offset(x, top), Offset(x, bottom), 1.dp.toPx())
            drawCircle(Hb.panel, 6.5.dp.toPx(), Offset(x, y))
            drawCircle(series[0].color, 4.5.dp.toPx(), Offset(x, y))
            val (title, value) = tipText(p, best)
            tip(tm, title, value, x, top, left, right, series[0].color)
        }
    }
}

// ── Bar chart ────────────────────────────────────────────────────────────

class BarSpec(
    val value: Double,
    val color: Color,
    val tipTitle: String,
    val tipValue: String,
    val label: String? = null,
    /** Stacked segments bottom to top; `value` is their total. */
    val segs: List<Pair<Double, Color>>? = null,
)

private fun topRounded(l: Float, t: Float, r: Float, b: Float, radius: Float) = Path().apply {
    addRoundRect(RoundRect(l, t, r, b, CornerRadius(radius), CornerRadius(radius), CornerRadius(0f), CornerRadius(0f)))
}

@Composable
fun BarChart(
    bars: List<BarSpec>,
    yMax: Double,
    modifier: Modifier = Modifier,
    height: Dp = 180.dp,
    yTicks: List<Double> = niceTicks(0.0, yMax),
    yFormat: (Double) -> String = { it.roundToInt().toString() },
    goal: Double? = null,
    goalLabel: String? = null,
) {
    val tm = rememberTextMeasurer()
    val inspect = rememberInspect()
    val reveal = rememberReveal()
    Canvas(modifier.fillMaxWidth().height(height).inspectable(inspect)) {
        val left = 2.dp.toPx()
        val right = size.width - 30.dp.toPx()
        val top = 8.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val w = right - left
        val h = bottom - top
        fun py(y: Double) = bottom - (y / yMax).toFloat().coerceIn(0f, 1.05f) * h
        for (t in yTicks) {
            val y = py(t)
            drawLine(Hb.grid, Offset(left, y), Offset(right, y), 1.dp.toPx())
            label(tm, yFormat(t), size.width - 1.dp.toPx(), y, Hb.text3, align = 1, vcenter = true)
        }
        drawLine(Hb.axis, Offset(left, bottom), Offset(right, bottom), 1.dp.toPx())
        if (bars.isEmpty()) return@Canvas
        val slot = w / bars.size
        val bw = (slot * 0.62f).coerceIn(2.dp.toPx(), 30.dp.toPx())
        val sel = inspect.x?.let { ((it - left) / slot).toInt().coerceIn(0, bars.size - 1) }
        val r = min(bw / 2, 6.dp.toPx())
        bars.forEachIndexed { i, b ->
            val cx = left + slot * (i + 0.5f)
            val dim = if (sel != null && sel != i) 0.45f else 1f
            val barH = (bottom - py(b.value)) * reveal.value
            if (b.value <= 0.0) {
                drawRoundRect(Hb.border2, Offset(cx - bw / 2, bottom - 2.dp.toPx()), Size(bw, 2.dp.toPx()), CornerRadius(1.dp.toPx()))
            } else {
                val l = cx - bw / 2
                val t = bottom - max(barH, 2.dp.toPx())
                if (b.segs == null) {
                    drawPath(topRounded(l, t, l + bw, bottom, r), b.color.copy(alpha = dim))
                } else {
                    clipPath(topRounded(l, t, l + bw, bottom, r)) {
                        var acc = 0.0
                        for ((v, c) in b.segs) {
                            val y1 = bottom - (bottom - t) * (acc / b.value).toFloat()
                            acc += v
                            val y0 = bottom - (bottom - t) * (acc / b.value).toFloat()
                            drawRect(c.copy(alpha = dim), Offset(l, y0), Size(bw, y1 - y0 + 0.5f))
                        }
                    }
                }
            }
            if (b.label != null) label(tm, b.label, cx, bottom + 4.dp.toPx(), if (sel == i) Hb.text else Hb.text3)
        }
        if (goal != null) {
            dashed(Offset(left, py(goal)), Offset(right, py(goal)), Hb.text2.copy(alpha = 0.7f))
            if (goalLabel != null) label(tm, goalLabel, left + 2.dp.toPx(), py(goal) - 13.dp.toPx(), Hb.text2, align = -1)
        }
        if (sel != null) {
            val b = bars[sel]
            val cx = left + slot * (sel + 0.5f)
            tip(tm, b.tipTitle, b.tipValue, cx, top, left, right, b.color)
        }
    }
}

// ── Range chart (min..max capsules with an average dot) ──────────────────

class RangeSpec(
    val lo: Double?,
    val hi: Double?,
    val avg: Double?,
    val color: Color,
    val tipTitle: String,
    val tipValue: String,
    val label: String? = null,
)

@Composable
fun RangeChart(
    items: List<RangeSpec>,
    yMin: Double, yMax: Double,
    modifier: Modifier = Modifier,
    height: Dp = 180.dp,
    yTicks: List<Double> = niceTicks(yMin, yMax),
    bands: List<Band> = emptyList(),
    yFormat: (Double) -> String = { it.roundToInt().toString() },
) {
    val tm = rememberTextMeasurer()
    val inspect = rememberInspect()
    val reveal = rememberReveal()
    Canvas(modifier.fillMaxWidth().height(height).inspectable(inspect)) {
        val left = 2.dp.toPx()
        val right = size.width - 30.dp.toPx()
        val top = 8.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val w = right - left
        val h = bottom - top
        fun py(y: Double) = bottom - ((y - yMin) / (yMax - yMin)).toFloat().coerceIn(0f, 1f) * h
        for (b in bands) {
            val y1 = py(min(b.hi, yMax)); val y0 = py(max(b.lo, yMin))
            if (y0 - y1 > 0.5f) drawRect(b.color.copy(alpha = 0.10f), Offset(left, y1), Size(w, y0 - y1))
        }
        for (t in yTicks) {
            val y = py(t)
            drawLine(Hb.grid, Offset(left, y), Offset(right, y), 1.dp.toPx())
            label(tm, yFormat(t), size.width - 1.dp.toPx(), y, Hb.text3, align = 1, vcenter = true)
        }
        drawLine(Hb.axis, Offset(left, bottom), Offset(right, bottom), 1.dp.toPx())
        if (items.isEmpty()) return@Canvas
        val slot = w / items.size
        val bw = (slot * 0.5f).coerceIn(3.dp.toPx(), 14.dp.toPx())
        val sel = inspect.x?.let { ((it - left) / slot).toInt().coerceIn(0, items.size - 1) }
        items.forEachIndexed { i, it ->
            val cx = left + slot * (i + 0.5f)
            if (it.label != null) label(tm, it.label, cx, bottom + 4.dp.toPx(), if (sel == i) Hb.text else Hb.text3)
            if (it.lo == null || it.hi == null) return@forEachIndexed
            val dim = if (sel != null && sel != i) 0.4f else 1f
            val mid = (py(it.lo) + py(it.hi)) / 2
            val half = max((py(it.lo) - py(it.hi)) / 2, bw / 2) * reveal.value
            drawRoundRect(it.color.copy(alpha = 0.85f * dim), Offset(cx - bw / 2, mid - half), Size(bw, half * 2), CornerRadius(bw / 2))
            if (it.avg != null) {
                val y = mid + (py(it.avg) - mid) * reveal.value
                drawCircle(Hb.panel, bw / 2 + 1.dp.toPx(), Offset(cx, y), alpha = dim)
                drawCircle(it.color.copy(alpha = dim), bw / 2 - 1.dp.toPx(), Offset(cx, y))
                drawCircle(Hb.panel, max(bw / 2 - 2.5.dp.toPx(), 1.dp.toPx()), Offset(cx, y), alpha = dim)
            }
        }
        if (sel != null) {
            val it = items[sel]
            tip(tm, it.tipTitle, it.tipValue, left + slot * (sel + 0.5f), top, left, right, it.color)
        }
    }
}

// ── Sparklines and tile graphics ─────────────────────────────────────────

/** Axis-free line for tiles; ends in a dot. */
@Composable
fun Spark(
    pts: List<Pt>,
    color: Color,
    modifier: Modifier = Modifier,
    yMin: Double? = null,
    yMax: Double? = null,
    gap: Double? = null,
    fill: Boolean = true,
    smooth: Boolean = false,
) {
    val reveal = rememberReveal(900)
    Canvas(modifier) {
        if (pts.size < 2) return@Canvas
        val x0 = pts.first().x; val x1 = pts.last().x
        val lo = yMin ?: pts.minOf { it.y }
        var hi = yMax ?: pts.maxOf { it.y }
        if (hi - lo < 1e-9) hi = lo + 1
        val padY = 4.dp.toPx()
        val padX = 3.dp.toPx()
        fun px(x: Double) = padX + ((x - x0) / max(x1 - x0, 1e-9)).toFloat() * (size.width - padX * 2)
        fun py(y: Double) = size.height - padY - ((y - lo) / (hi - lo)).toFloat() * (size.height - padY * 2)
        clipRect(0f, 0f, size.width * reveal.value, size.height) {
            for (seg in segments(pts, gap)) {
                if (seg.size < 2) continue
                val path = Path()
                seg.forEachIndexed { i, p ->
                    if (i == 0) path.moveTo(px(p.x), py(p.y))
                    else if (smooth) {
                        val q = seg[i - 1]; val mx = (px(q.x) + px(p.x)) / 2
                        path.cubicTo(mx, py(q.y), mx, py(p.y), px(p.x), py(p.y))
                    } else path.lineTo(px(p.x), py(p.y))
                }
                if (fill) {
                    val f = Path().apply { addPath(path); lineTo(px(seg.last().x), size.height); lineTo(px(seg.first().x), size.height); close() }
                    drawPath(f, Brush.verticalGradient(listOf(color.copy(alpha = 0.22f), color.copy(alpha = 0f))))
                }
                drawPath(path, color, style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
        if (reveal.value > 0.98f) {
            val p = pts.last()
            drawCircle(Hb.panel, 4.dp.toPx(), Offset(px(p.x), py(p.y)))
            drawCircle(color, 2.8.dp.toPx(), Offset(px(p.x), py(p.y)))
        }
    }
}

/** Small bars for tiles; null or 0 entries draw as a faint stub so gaps read as "nothing recorded". */
@Composable
fun MiniBars(
    values: List<Double?>,
    colors: List<Color>,
    modifier: Modifier = Modifier,
    max: Double? = null,
) {
    val reveal = rememberReveal(800)
    Canvas(modifier) {
        if (values.isEmpty()) return@Canvas
        val top = values.filterNotNull().maxOrNull() ?: 1.0
        val m = max ?: top.coerceAtLeast(1e-9)
        val slot = size.width / values.size
        val bw = (slot * 0.66f).coerceAtLeast(1.5.dp.toPx())
        val r = min(bw / 2, 3.dp.toPx())
        values.forEachIndexed { i, v ->
            val cx = slot * (i + 0.5f)
            if (v == null || v <= 0.0) {
                drawRoundRect(Hb.border2, Offset(cx - bw / 2, size.height - 2.dp.toPx()), Size(bw, 2.dp.toPx()), CornerRadius(1.dp.toPx()))
            } else {
                val hh = max((v / m).toFloat() * size.height * reveal.value, 2.dp.toPx())
                drawPath(topRounded(cx - bw / 2, size.height - hh, cx + bw / 2, size.height, r), colors[i % colors.size])
            }
        }
    }
}

/** Animated progress ring; draws only the arc, put text on top. */
@Composable
fun ProgressRing(progress: Float, color: Color, modifier: Modifier = Modifier, stroke: Dp = 7.dp) {
    val reveal = rememberReveal(900)
    Canvas(modifier) {
        val sw = stroke.toPx()
        val d = min(size.width, size.height) - sw
        val tl = Offset((size.width - d) / 2, (size.height - d) / 2)
        drawArc(color.copy(alpha = 0.14f), 0f, 360f, false, tl, Size(d, d), style = Stroke(sw))
        drawArc(color, -90f, 360f * progress.coerceIn(0f, 1f) * reveal.value, false, tl, Size(d, d), style = Stroke(sw, cap = StrokeCap.Round))
    }
}

// ── Sleep ────────────────────────────────────────────────────────────────

val SLEEP_ROWS = listOf("awake", "rem", "light", "deep")

fun stageColor(stage: String): Color = when (stage) {
    "awake" -> Hb.sleepAwake
    "rem" -> Hb.sleepRem
    "deep" -> Hb.sleepDeep
    else -> Hb.sleepLight
}

fun stageLabel(stage: String): String = when (stage) {
    "awake" -> "Awake"; "rem" -> "REM"; "deep" -> "Deep"; else -> "Light"
}

/** Stage-by-time steps, awake on top and deep at the bottom. */
@Composable
fun Hypnogram(night: SleepNight, modifier: Modifier = Modifier, height: Dp = 190.dp) {
    val tm = rememberTextMeasurer()
    val inspect = rememberInspect()
    val reveal = rememberReveal(900)
    val zone = ZoneId.systemDefault()
    val stages = remember(night) { night.stages.ifEmpty { listOf(Stage("light", night.start, night.end)) } }
    Canvas(modifier.fillMaxWidth().height(height).inspectable(inspect)) {
        val left = 38.dp.toPx()
        val right = size.width - 4.dp.toPx()
        val top = 6.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val w = right - left
        val rowH = (bottom - top) / SLEEP_ROWS.size
        val t0 = night.start.toDouble(); val t1 = night.end.toDouble()
        fun px(t: Long) = left + ((t - t0) / (t1 - t0)).toFloat() * w
        SLEEP_ROWS.forEachIndexed { i, s ->
            val y = top + rowH * i
            drawLine(Hb.grid, Offset(left, y + rowH / 2), Offset(right, y + rowH / 2), 1.dp.toPx())
            label(tm, stageLabel(s), 0f, y + rowH / 2, Hb.text3, align = -1, vcenter = true)
        }
        // hour grid
        val stepH = if ((t1 - t0) / 3.6e6 > 9) 2 else 1
        var tick = ZonedDateTime.ofInstant(Instant.ofEpochMilli(night.start), zone).plusHours(1).withMinute(0).withSecond(0).withNano(0)
        while (tick.toInstant().toEpochMilli() < night.end) {
            val x = px(tick.toInstant().toEpochMilli())
            if (x > left + 14.dp.toPx() && x < right - 14.dp.toPx() && tick.hour % stepH == 0) {
                drawLine(Hb.grid, Offset(x, top), Offset(x, bottom), 1.dp.toPx())
                label(tm, "%02d:00".format(tick.hour), x, bottom + 4.dp.toPx(), Hb.text3)
            }
            tick = tick.plusHours(1)
        }
        label(tm, fmtClock(night.start), left, bottom + 4.dp.toPx(), Hb.text2, align = -1)
        label(tm, fmtClock(night.end), right, bottom + 4.dp.toPx(), Hb.text2, align = 1)

        val sel = inspect.x?.let { x -> val t = t0 + (x - left) / w * (t1 - t0); stages.firstOrNull { t >= it.start && t < it.end } }
        clipRect(left - 2.dp.toPx(), 0f, left + w * reveal.value + 2.dp.toPx(), size.height) {
            stages.forEachIndexed { i, s ->
                val row = SLEEP_ROWS.indexOf(s.stage).coerceAtLeast(0)
                val y = top + rowH * row + rowH * 0.17f
                val x0 = px(s.start); val x1 = max(px(s.end), x0 + 2.dp.toPx())
                if (i > 0) {
                    val prev = stages[i - 1]
                    val pr = SLEEP_ROWS.indexOf(prev.stage).coerceAtLeast(0)
                    if (pr != row) drawLine(stageColor(s.stage).copy(alpha = 0.35f), Offset(x0, top + rowH * (pr + 0.5f)), Offset(x0, top + rowH * (row + 0.5f)), 1.5.dp.toPx())
                }
                val dim = if (sel != null && sel !== s) 0.4f else 1f
                drawRoundRect(stageColor(s.stage).copy(alpha = dim), Offset(x0, y), Size(x1 - x0, rowH * 0.66f), CornerRadius(3.dp.toPx()))
            }
        }
        if (sel != null) {
            tip(tm, "${fmtClock(sel.start)} - ${fmtClock(sel.end)}", "${stageLabel(sel.stage)} ${fmtDuration(sel.minutes)}", (px(sel.start) + px(sel.end)) / 2, top, left, right, stageColor(sel.stage))
        }
    }
}

// ── Workout route ────────────────────────────────────────────────────────

private fun speedColor(t: Float): Color {
    val stops = listOf(Hb.spo2, Hb.steps, Hb.kcal, Hb.hr)
    val f = t.coerceIn(0f, 1f) * (stops.size - 1)
    val i = min(f.toInt(), stops.size - 2)
    return androidx.compose.ui.graphics.lerp(stops[i], stops[i + 1], f - i)
}

private fun haversineM(a: GpsPoint, b: GpsPoint): Double {
    val r = 6371000.0
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLon = Math.toRadians(b.lon - a.lon)
    val h = Math.sin(dLat / 2).pow(2) + Math.cos(Math.toRadians(a.lat)) * Math.cos(Math.toRadians(b.lat)) * Math.sin(dLon / 2).pow(2)
    return 2 * r * Math.asin(Math.sqrt(h))
}

/** Cumulative distance in metres at each GPS point. */
fun gpsDistances(pts: List<GpsPoint>): DoubleArray {
    val out = DoubleArray(pts.size)
    for (i in 1 until pts.size) out[i] = out[i - 1] + haversineM(pts[i - 1], pts[i])
    return out
}

/** The track on a plain tinted card, coloured slow to fast. No map tiles. */
@Composable
fun RouteMap(points: List<GpsPoint>, modifier: Modifier = Modifier, height: Dp = 240.dp) {
    val tm = rememberTextMeasurer()
    val inspect = rememberInspect()
    val reveal = rememberReveal(1100)
    val dist = remember(points) { gpsDistances(points) }
    val speeds = remember(points) {
        val raw = DoubleArray(points.size)
        for (i in 1 until points.size) {
            val dt = (points[i].t - points[i - 1].t) / 1000.0
            raw[i] = if (dt > 0) (dist[i] - dist[i - 1]) / dt else 0.0
        }
        if (raw.size > 1) raw[0] = raw[1]
        DoubleArray(raw.size) { i -> (max(0, i - 3)..min(raw.size - 1, i + 3)).map { raw[it] }.average() }
    }
    Canvas(modifier.fillMaxWidth().height(height).inspectable(inspect)) {
        drawRoundRect(Hb.panel2, cornerRadius = CornerRadius(16.dp.toPx()))
        if (points.size < 2) return@Canvas
        val lat0 = points.map { it.lat }.average()
        val k = cos(Math.toRadians(lat0))
        val xs = points.map { it.lon * k }; val ys = points.map { it.lat }
        val minX = xs.min(); val maxX = xs.max(); val minY = ys.min(); val maxY = ys.max()
        val pad = 22.dp.toPx()
        val sc = min((size.width - pad * 2) / max(maxX - minX, 1e-9), (size.height - pad * 2) / max(maxY - minY, 1e-9)).toFloat()
        val ox = (size.width - (maxX - minX).toFloat() * sc) / 2
        val oy = (size.height - (maxY - minY).toFloat() * sc) / 2
        fun at(i: Int) = Offset(ox + ((xs[i] - minX) * sc).toFloat(), size.height - oy - ((ys[i] - minY) * sc).toFloat())
        // faint dot grid for scale
        val gs = 28.dp.toPx()
        var gx = gs / 2
        while (gx < size.width) { var gy = gs / 2; while (gy < size.height) { drawCircle(Hb.axis, 1.dp.toPx(), Offset(gx, gy)); gy += gs }; gx += gs }
        val lo = speeds.filter { it > 0 }.minOrNull() ?: 0.0
        val hi = speeds.max().coerceAtLeast(lo + 0.1)
        val upto = ((points.size - 1) * reveal.value).toInt().coerceAtLeast(1)
        for (i in 1..upto) drawLine(Hb.panel, at(i - 1), at(i), 7.dp.toPx(), StrokeCap.Round)
        for (i in 1..upto) drawLine(speedColor(((speeds[i] - lo) / (hi - lo)).toFloat()), at(i - 1), at(i), 4.dp.toPx(), StrokeCap.Round)
        drawCircle(Hb.panel, 7.dp.toPx(), at(0)); drawCircle(Hb.steps, 5.dp.toPx(), at(0))
        if (upto == points.size - 1) { drawCircle(Hb.panel, 7.dp.toPx(), at(points.size - 1)); drawCircle(Hb.text, 5.dp.toPx(), at(points.size - 1)) }
        inspect.x?.let { sx ->
            var best = 0; var bd = Float.MAX_VALUE
            for (i in points.indices) { val d = abs(at(i).x - sx); if (d < bd) { bd = d; best = i } }
            val p = at(best)
            drawCircle(Hb.panel, 8.dp.toPx(), p); drawCircle(Hb.hr, 5.5.dp.toPx(), p)
            val pace = if (speeds[best] > 0.2) fmtPace(1000.0 / speeds[best]) else "stopped"
            tip(tm, "%.2f km".format(dist[best] / 1000), pace, p.x, 8.dp.toPx(), 4.dp.toPx(), size.width - 4.dp.toPx(), Hb.hr)
        }
        val gx0 = size.width - 62.dp.toPx()
        label(tm, "Slower", gx0 - 4.dp.toPx(), size.height - 18.dp.toPx(), Hb.text3, align = 1)
        for (j in 0 until 20) drawRect(speedColor(j / 19f), Offset(gx0 + j * 2.5.dp.toPx(), size.height - 15.dp.toPx()), Size(2.5.dp.toPx(), 5.dp.toPx()))
        label(tm, "Faster", gx0 + 54.dp.toPx(), size.height - 18.dp.toPx(), Hb.text3, align = -1)
    }
}
