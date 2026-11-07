package app.kumquant.healthbridge.ui.health

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.theme.Hb
import kotlinx.coroutines.launch
import java.time.LocalDate

/** White rounded panel with a hairline border; the one surface every screen is built from. */
@Composable
fun HbCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Surface(
        modifier = modifier,
        shape = shape,
        color = Hb.panel,
        border = BorderStroke(1.dp, Hb.border),
        shadowElevation = 0.dp,
    ) {
        Column(
            Modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(16.dp),
            content = content,
        )
    }
}

@Composable
fun CardTitle(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    Row(modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = Hb.Type.label, color = Hb.text2, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = Hb.Type.caption, color = Hb.text3)
    }
}

/** A number with its unit beside it. */
@Composable
fun BigValue(value: String, unit: String?, modifier: Modifier = Modifier, color: Color = Hb.text, big: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.Bottom) {
        Text(value, style = if (big) Hb.Type.value else Hb.Type.title, color = color, maxLines = 1)
        if (unit != null) Text(unit, style = Hb.Type.unit, color = Hb.text3, modifier = Modifier.padding(start = 3.dp, bottom = if (big) 4.dp else 2.dp), maxLines = 1)
    }
}

/** Label over value; the building block of the stat rows under charts. */
@Composable
fun Stat(label: String, value: String, unit: String?, modifier: Modifier = Modifier, color: Color = Hb.text) {
    Column(modifier) {
        Text(label, style = Hb.Type.caption, color = Hb.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        BigValue(value, unit, color = color, big = false)
    }
}

@Composable
fun StatRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) { content() }
}

@Composable
fun Dot(color: Color, size: Dp = 8.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(color))
}

@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = Hb.Type.body, color = Hb.text3, modifier = modifier.fillMaxWidth().padding(vertical = 24.dp), textAlign = TextAlign.Center)
}

/** Stacked horizontal bar; weights are the segment sizes. */
@Composable
fun SegmentBar(parts: List<Pair<Double, Color>>, modifier: Modifier = Modifier, height: Dp = 10.dp) {
    val total = parts.sumOf { it.first }.takeIf { it > 0 } ?: return
    Row(modifier.fillMaxWidth().height(height), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for ((v, c) in parts) if (v > 0) Box(Modifier.weight((v / total).toFloat()).fillMaxSize().clip(RoundedCornerShape(height / 2)).background(c))
    }
}

/** A hand-drawn chevron; no icon library needed. dir: -1 left, 1 right, 2 down. */
@Composable
fun Chevron(dir: Int, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width; val h = size.height
        val p = Path()
        when (dir) {
            -1 -> { p.moveTo(w * 0.62f, h * 0.2f); p.lineTo(w * 0.34f, h * 0.5f); p.lineTo(w * 0.62f, h * 0.8f) }
            1 -> { p.moveTo(w * 0.38f, h * 0.2f); p.lineTo(w * 0.66f, h * 0.5f); p.lineTo(w * 0.38f, h * 0.8f) }
            else -> { p.moveTo(w * 0.2f, h * 0.38f); p.lineTo(w * 0.5f, h * 0.66f); p.lineTo(w * 0.8f, h * 0.38f) }
        }
        drawPath(p, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

@Composable
fun IconTap(description: String, onClick: () -> Unit, enabled: Boolean = true, content: @Composable () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape)
            .clickable(enabled = enabled, interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** Small pill group; [selected] is highlighted. */
@Composable
fun <T> Segmented(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit, accent: Color, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Hb.panel2).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (o in options) {
            val on = o == selected
            val bg by animateColorAsState(if (on) Hb.panel else Color.Transparent, label = "seg")
            val fg by animateColorAsState(if (on) accent else Hb.text2, label = "segfg")
            Box(
                Modifier.weight(1f).height(34.dp).clip(RoundedCornerShape(11.dp)).background(bg)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onSelect(o) },
                contentAlignment = Alignment.Center,
            ) { Text(label(o), style = Hb.Type.label, color = fg) }
        }
    }
}

/**
 * Scaffold of every metric detail screen: title bar, Day/Week/Month/Year tabs, a date label with
 * arrows, and a pager whose pages are consecutive periods (swipe right for earlier ones).
 */
@Composable
fun PeriodScreen(
    title: String,
    accent: Color,
    periods: List<Period>,
    onBack: () -> Unit,
    page: @Composable (Span) -> Unit,
) {
    var period by rememberSaveable { mutableStateOf(periods.first()) }
    val today = remember { LocalDate.now() }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Hb.bg)) {
        DetailBar(title, accent, onBack)
        Segmented(periods, period, { it.label }, { period = it }, accent, Modifier.padding(horizontal = 16.dp))
        key(period) {
            val count = pageCount(period)
            val pager = rememberPagerState(initialPage = count - 1) { count }
            val cur = spanOf(period, pager.currentPage - (count - 1), today)
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                IconTap("Previous ${period.label.lowercase()}", { scope.launch { pager.animateScrollToPage(pager.currentPage - 1) } }, enabled = pager.currentPage > 0) {
                    Chevron(-1, if (pager.currentPage > 0) Hb.text else Hb.border2, Modifier.size(22.dp))
                }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(cur.title, style = Hb.Type.title, color = Hb.text)
                    if (cur.subtitle != null) Text(cur.subtitle!!, style = Hb.Type.caption, color = Hb.text3)
                }
                IconTap("Next ${period.label.lowercase()}", { scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } }, enabled = pager.currentPage < count - 1) {
                    Chevron(1, if (pager.currentPage < count - 1) Hb.text else Hb.border2, Modifier.size(22.dp))
                }
            }
            HorizontalPager(pager, Modifier.weight(1f), key = { it }) { p ->
                val span = remember(period, p) { spanOf(period, p - (count - 1), today) }
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) { page(span) }
            }
        }
    }
}

@Composable
fun DetailBar(title: String, accent: Color, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTap("Back", onBack) { Chevron(-1, Hb.text, Modifier.size(24.dp)) }
        Dot(accent, 10.dp)
        Spacer(Modifier.width(8.dp))
        Text(title, style = Hb.Type.title, color = Hb.text)
    }
}

/** Detail screen without period tabs (workout list, one workout). */
@Composable
fun PlainScreen(title: String, accent: Color, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Hb.bg)) {
        DetailBar(title, accent, onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

/** A home tile: coloured dot and title on top, then whatever the metric shows. */
@Composable
fun TileCard(title: String, accent: Color, modifier: Modifier = Modifier, onClick: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    HbCard(modifier, onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(accent, 8.dp)
            Spacer(Modifier.width(7.dp))
            Text(title, style = Hb.Type.label, color = Hb.text2, modifier = Modifier.weight(1f), maxLines = 1)
            Chevron(1, Hb.text3, Modifier.size(16.dp))
        }
        Spacer(Modifier.height(8.dp))
        content()
    }
}

val ContentPadding = PaddingValues(horizontal = 16.dp)
