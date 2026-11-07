package app.kumquant.healthbridge.scale

import java.time.DateTimeException
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * The 13-byte service data (UUID 0x181B) the Mi Body Composition Scale 2 advertises while awake.
 * Layout and flag bits ported from openScale's MiScaleHandler.kt (parseLive13), which reads the
 * same frame from the GATT history characteristic:
 *
 *     0     control 0   bit0 = weight in lb
 *     1     control 1   bit1 = impedance present, bit5 = stabilised, bit6 = weight in jin (0.5 kg),
 *                       bit7 = weight removed (stepped off)
 *     2-3   year (u16 LE)
 *     4..8  month, day, hour, minute, second (the scale's local clock)
 *     9-10  impedance, ohm (u16 LE)
 *     11-12 weight (u16 LE): /200 = kg, /100 = lb or jin
 */
class MiScaleAdvert(
    val raw: ByteArray,
    val unit: String,
    val stabilized: Boolean,
    val hasImpedance: Boolean,
    val removed: Boolean,
    /** The scale's own clock (local time, no zone). */
    val time: LocalDateTime,
    /** 0 when none. */
    val impedance: Int,
    val weightKg: Double,
) {
    val hex: String get() = raw.toHex()

    override fun toString(): String {
        val flags = listOfNotNull("stable".takeIf { stabilized }, "imp".takeIf { hasImpedance }, "removed".takeIf { removed })
        return "$time ${"%.2f".format(weightKg)} kg imp=$impedance [${flags.joinToString(",").ifEmpty { "-" }}] $hex"
    }

    companion object {
        const val FRAME_LEN = 13
        private const val LB_TO_KG = 0.45359237

        /** Throws IllegalArgumentException (with the hex) on anything unexpected. */
        fun decode(data: ByteArray): MiScaleAdvert {
            require(data.size == FRAME_LEN) { "expected $FRAME_LEN bytes, got ${data.size}: ${data.toHex()}" }
            fun u8(i: Int) = data[i].toInt() and 0xFF
            fun u16(i: Int) = u8(i) or (u8(i + 1) shl 8)
            val c0 = u8(0)
            val c1 = u8(1)
            val time = try {
                LocalDateTime.of(u16(2), u8(4), u8(5), u8(6), u8(7), u8(8))
            } catch (e: DateTimeException) {
                throw IllegalArgumentException("bad timestamp (${e.message}): ${data.toHex()}")
            }
            val w = u16(11)
            val (unit, kg) = when {
                c0 and 0x01 != 0 -> "lb" to w / 100.0 * LB_TO_KG
                c1 and 0x40 != 0 -> "jin" to w / 100.0 * 0.5
                else -> "kg" to w / 200.0
            }
            return MiScaleAdvert(
                raw = data.copyOf(), unit = unit, stabilized = c1 and 0x20 != 0, hasImpedance = c1 and 0x02 != 0,
                removed = c1 and 0x80 != 0, time = time, impedance = u16(9), weightKg = kg,
            )
        }

        fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
    }
}

/** A finished weigh-in. `impedance` is null when the scale gave none (socks, shoes). `timeMs` is epoch ms. */
data class Reading(val timeMs: Long, val weightKg: Double, val impedance: Int?)

/**
 * Turns the stream of adverts into one [Reading] per weigh-in. Same logic as `ReadingTracker`
 * in `watchlab/scale.py`.
 *
 * A reading is final when a stabilised frame carries impedance, or when a stabilised weight has
 * waited [graceMs] (or the user stepped off) without any impedance arriving. A late impedance
 * frame for the same weigh-in re-emits the reading with the same time, so the store overwrites
 * the weight-only rows. Byte-identical repeated adverts are dropped. Not thread-safe.
 *
 * After the user steps off, the scale keeps advertising the result for a few minutes with the
 * "removed" flag. Such a frame is a reading too when its own timestamp is fresh (see [freshTimeMs]),
 * so a weigh-in the phone only heard afterwards still counts; one the live frames already gave is
 * not repeated. Older "removed" frames (replays) are ignored.
 */
class WeighInTracker(private val graceMs: Long = GRACE_MS) {
    private class Cluster(val timeMs: Long, val weight: Double) {
        var lastMs = timeMs
        var since: Long? = null
        var sentWeight = false
        var sentFull = false
    }

    private var cluster: Cluster? = null
    private val seen = ArrayDeque<String>()
    private var lastFinal: Reading? = null

    /** `monoMs`: a monotonic clock; `receivedMs`: wall-clock epoch ms when the advert arrived. */
    fun feed(a: MiScaleAdvert, monoMs: Long, receivedMs: Long): List<Reading> {
        if (a.hex in seen) return poll(monoMs)
        seen.addLast(a.hex)
        if (seen.size > 64) seen.removeFirst()
        val out = mutableListOf<Reading>()
        if (a.removed) {
            out += flush()
            cluster = null
            out += steppedOff(a, receivedMs)
            return out.onEach { lastFinal = it }
        }
        if (!a.stabilized) return poll(monoMs)
        val t = resolveTimeMs(a, receivedMs)
        var c = cluster
        if (c == null || Math.abs(c.weight - a.weightKg) > SAME_WEIGHT_KG || Math.abs(t - c.lastMs) > SAME_WEIGHIN_MS) {
            out += flush()
            c = Cluster(t, a.weightKg)
            cluster = c
        }
        c.lastMs = t
        if (a.hasImpedance && a.impedance > 0) {
            if (!c.sentFull) {
                c.sentFull = true
                out += Reading(c.timeMs, a.weightKg, a.impedance)
            }
        } else if (c.since == null) {
            c.since = monoMs
        }
        return (out + poll(monoMs)).onEach { lastFinal = it }
    }

    /** The result a "removed" frame carries, unless it is stale or this weigh-in was already given. */
    private fun steppedOff(a: MiScaleAdvert, receivedMs: Long): List<Reading> {
        if (!a.stabilized) return emptyList()
        val t = freshTimeMs(a, receivedMs) ?: return emptyList()
        val impedance = a.impedance.takeIf { a.hasImpedance && it > 0 }
        val prev = lastFinal
        if (prev != null && Math.abs(prev.timeMs - t) <= FRESH_MS && Math.abs(prev.weightKg - a.weightKg) <= SAME_WEIGHT_KG) {
            // Already given; only an impedance the live frames missed is news
            return if (prev.impedance == null && impedance != null) listOf(prev.copy(impedance = impedance)) else emptyList()
        }
        return listOf(Reading(t, a.weightKg, impedance))
    }

    /**
     * The true time of a frame stamped by the scale's clock, if that is within [FRESH_MS] before
     * arrival. The clock runs a whole number of hours off (a time zone: the user's is an hour behind),
     * so whole hours of difference are taken off first.
     */
    internal fun freshTimeMs(a: MiScaleAdvert, receivedMs: Long): Long? {
        val scaleMs = a.time.toEpochSecond(ZoneOffset.UTC) * 1000
        val hours = Math.round((receivedMs - scaleMs) / HOUR_MS.toDouble())
        if (Math.abs(hours) > 14) return null
        val t = scaleMs + hours * HOUR_MS
        return t.takeIf { receivedMs - it in -60_000L..FRESH_MS }
    }

    /** Call about once a second so a weight-only reading is released after the grace period. */
    fun poll(monoMs: Long): List<Reading> {
        val since = cluster?.since ?: return emptyList()
        return if (monoMs - since >= graceMs) flush() else emptyList()
    }

    /** Emits a weight-only reading that is still waiting for impedance (scan stopped). */
    fun flush(): List<Reading> {
        val c = cluster ?: return emptyList()
        if (c.since == null || c.sentWeight || c.sentFull) return emptyList()
        c.sentWeight = true
        return listOf(Reading(c.timeMs, c.weight, null).also { lastFinal = it })
    }

    /**
     * When the advert arrived. The scale's own clock isn't trusted: the user's runs exactly an hour behind
     * (seen 2026-11-06), and only live frames get here (replayed old weigh-ins carry `removed`), so the
     * arrival time is the true time to within a second or two.
     */
    @Suppress("UNUSED_PARAMETER")
    fun resolveTimeMs(a: MiScaleAdvert, receivedMs: Long): Long = receivedMs

    companion object {
        const val GRACE_MS = 6_000L
        const val SAME_WEIGHT_KG = 0.3
        const val SAME_WEIGHIN_MS = 120_000L
        const val FRESH_MS = 5 * 60_000L
        private const val HOUR_MS = 3_600_000L
    }
}
