package app.kumquant.healthbridge.ui.health

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

enum class Period(val label: String) { Day("Day"), Week("Week"), Month("Month"), Year("Year") }

/** A calendar window [from, to) at a negative-or-zero offset from the current one. */
data class Span(val period: Period, val offset: Int, val from: LocalDate, val to: LocalDate, val today: LocalDate) {
    val days: Int get() = ChronoUnit.DAYS.between(from, to).toInt()
    val isCurrent: Boolean get() = offset == 0

    val title: String
        get() = when (period) {
            Period.Day -> dayWord(from, today)
            Period.Week -> "${from.dayOfMonth} ${monthName(from.monthValue)} - ${to.minusDays(1).dayOfMonth} ${monthName(to.minusDays(1).monthValue)}"
            Period.Month -> "${java.time.Month.of(from.monthValue).getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault())} ${from.year}"
            Period.Year -> "${from.year}"
        }

    val subtitle: String?
        get() = when {
            period == Period.Day && offset != 0 && offset != -1 -> null
            period == Period.Day -> fmtDay(from)
            offset == 0 -> "This ${period.label.lowercase()}"
            else -> null
        }
}

fun pageCount(p: Period): Int = when (p) {
    Period.Day -> 730
    Period.Week -> 156
    Period.Month -> 60
    Period.Year -> 10
}

fun spanOf(period: Period, offset: Int, today: LocalDate): Span {
    val (from, to) = when (period) {
        Period.Day -> today.plusDays(offset.toLong()).let { it to it.plusDays(1) }
        Period.Week -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).plusWeeks(offset.toLong()).let { it to it.plusDays(7) }
        Period.Month -> today.withDayOfMonth(1).plusMonths(offset.toLong()).let { it to it.plusMonths(1) }
        Period.Year -> today.withDayOfYear(1).plusYears(offset.toLong()).let { it to it.plusYears(1) }
    }
    return Span(period, offset, from, to, today)
}

/** One bar/capsule slot of a week (7 days), month (its days) or year (12 months). */
class Bucket(val from: LocalDate, val to: LocalDate, val label: String?, val tip: String)

fun Span.buckets(): List<Bucket> = when (period) {
    Period.Year -> (0 until 12).map { m ->
        val a = from.plusMonths(m.toLong())
        Bucket(a, a.plusMonths(1), monthName(m + 1).take(1), java.time.Month.of(m + 1).getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault()))
    }
    Period.Week -> (0 until 7).map { d ->
        val a = from.plusDays(d.toLong())
        Bucket(a, a.plusDays(1), a.dayOfWeek.getDisplayName(java.time.format.TextStyle.NARROW, java.util.Locale.getDefault()), fmtDay(a))
    }
    else -> dayBuckets(from, to)
}

fun dayBuckets(from: LocalDate, to: LocalDate): List<Bucket> =
    (0 until ChronoUnit.DAYS.between(from, to).toInt()).map { d ->
        val a = from.plusDays(d.toLong())
        Bucket(a, a.plusDays(1), if (a.dayOfMonth == 1 || a.dayOfMonth % 7 == 1 && a.dayOfMonth < 29) a.dayOfMonth.toString() else null, fmtDay(a))
    }

/** Day stats merged into one bucket. */
data class Agg(val sum: Double, val n: Int, val lo: Double, val hi: Double, val days: Int) {
    val avg: Double get() = if (n == 0) 0.0 else sum / n
    val perDay: Double get() = if (days == 0) 0.0 else sum / days
}

fun aggregate(stats: List<DayStat>, buckets: List<Bucket>): List<Agg?> = buckets.map { b ->
    val inB = stats.filter { it.date >= b.from && it.date < b.to }
    if (inB.isEmpty()) null
    else Agg(inB.sumOf { it.sum }, inB.sumOf { it.n }, inB.minOf { it.lo }, inB.maxOf { it.hi }, inB.size)
}
