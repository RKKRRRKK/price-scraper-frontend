package app.kumquant.healthbridge.ui.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

private val clock = DateTimeFormatter.ofPattern("HH:mm")
private val dayFmt = DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())

fun fmtClock(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(clock)

/** "7h 05m" / "42m" */
fun fmtDuration(min: Double): String {
    val total = min.roundToInt()
    val h = total / 60
    val m = total % 60
    return if (h > 0) "${h}h ${m.toString().padStart(2, '0')}m" else "${m}m"
}

fun fmtInt(v: Double): String = "%,d".format(v.roundToInt())

fun fmtKm(m: Double): String = "%.${if (m >= 10000) 1 else 2}f".format(m / 1000)

/** Pace as "5:45" per km. */
fun fmtPace(secPerKm: Double): String {
    val s = secPerKm.roundToInt()
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

fun fmtDay(d: LocalDate): String = d.format(dayFmt)

fun dayWord(d: LocalDate, today: LocalDate): String = when (d) {
    today -> "Today"
    today.minusDays(1) -> "Yesterday"
    else -> fmtDay(d)
}

fun fmtAgo(ms: Long, now: Long = System.currentTimeMillis()): String {
    val min = ((now - ms) / 60000).toInt()
    return when {
        min < 1 -> "just now"
        min < 60 -> "$min min ago"
        min < 48 * 60 -> "${min / 60} h ago"
        else -> "${min / 1440} days ago"
    }
}

fun monthName(m: Int): String = java.time.Month.of(m).getDisplayName(TextStyle.SHORT, Locale.getDefault())

/** Minutes since 18:00 (so a bedtime after midnight keeps rising) rendered back as a clock time. */
fun clockFromShifted(min: Double): String {
    val t = ((min.roundToInt() + 18 * 60) % (24 * 60) + 24 * 60) % (24 * 60)
    return "%02d:%02d".format(t / 60, t % 60)
}

fun shiftedMinutes(ms: Long): Double {
    val z = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault())
    val m = z.hour * 60 + z.minute
    return if (m < 18 * 60) (m + 6 * 60).toDouble() else (m - 18 * 60).toDouble()
}
