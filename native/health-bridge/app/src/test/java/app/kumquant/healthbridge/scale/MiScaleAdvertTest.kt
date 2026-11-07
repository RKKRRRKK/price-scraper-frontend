package app.kumquant.healthbridge.scale

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Adverts are hand-built from the layout documented on [MiScaleAdvert] (openScale's
 * parseLive13); openScale ships no advert bytes. Same cases as `watch-lab/tests/test_scale.py`.
 */
class MiScaleAdvertTest {
    private val zone = ZoneId.of("Europe/Berlin")
    private val when0 = LocalDateTime.of(2026, 11, 5, 7, 30, 15)
    private val t0 = when0.atZone(zone).toInstant().toEpochMilli()
    private val nowMs = t0 // readings carry the arrival time, which matches the scale's stamp here

    private fun frame(
        rawWeight: Int = 15070, impedance: Int = 0, c0: Int = 0x00, c1: Int = 0x20, at: LocalDateTime = when0,
    ): ByteArray = intArrayOf(
        c0, c1, at.year and 0xFF, at.year shr 8, at.monthValue, at.dayOfMonth, at.hour, at.minute, at.second,
        impedance and 0xFF, impedance shr 8, rawWeight and 0xFF, rawWeight shr 8,
    ).map { it.toByte() }.toByteArray()

    private fun adv(rawWeight: Int = 15070, impedance: Int = 0, c0: Int = 0, c1: Int = 0x20, at: LocalDateTime = when0) =
        MiScaleAdvert.decode(frame(rawWeight, impedance, c0, c1, at))

    private fun tracker(graceMs: Long = 6000) = WeighInTracker(graceMs)

    @Test fun kgStabilisedWithImpedance() {
        val a = adv(c1 = 0x22, impedance = 512)
        assertEquals("kg", a.unit)
        assertTrue(a.stabilized && a.hasImpedance && !a.removed)
        assertEquals(when0, a.time)
        assertEquals(512, a.impedance)
        assertEquals(75.35, a.weightKg, 1e-9)
    }

    @Test fun rawBytes() {
        assertEquals("0022ea070b05071e0f0002de3a", frame(c1 = 0x22, impedance = 512).let { with(MiScaleAdvert) { it.toHex() } })
    }

    @Test fun lbAndJin() {
        val lb = adv(c0 = 0x01, rawWeight = 16610)
        assertEquals("lb", lb.unit)
        assertEquals(166.10 * 0.45359237, lb.weightKg, 1e-9)
        val jin = adv(c1 = 0x60, rawWeight = 15070)
        assertEquals("jin", jin.unit)
        assertEquals(75.35, jin.weightKg, 1e-9)
    }

    @Test fun flags() {
        assertFalse(adv(c1 = 0x00).stabilized)
        assertTrue(adv(c1 = 0xA0).removed)
        assertTrue(adv(c1 = 0x02).hasImpedance)
        assertEquals(76.17, adv(c1 = 0x00, rawWeight = 15234).weightKg, 1e-9)
    }

    @Test fun rejectsWrongLengthAndBadDate() {
        try {
            MiScaleAdvert.decode(frame().copyOf(10))
            fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("13 bytes"))
        }
        val bad = frame().also { it[4] = 13 }
        try {
            MiScaleAdvert.decode(bad)
            fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("bad timestamp"))
        }
    }

    @Test fun unstableFramesGiveNothing() {
        val tr = tracker()
        assertEquals(emptyList<Reading>(), tr.feed(adv(c1 = 0x00, rawWeight = 14000), 0, nowMs))
        assertEquals(emptyList<Reading>(), tr.feed(adv(c1 = 0x00, rawWeight = 15000), 0, nowMs))
    }

    @Test fun stabilisedWithImpedanceIsFinalOnce() {
        val tr = tracker()
        val a = adv(c1 = 0x22, impedance = 512)
        assertEquals(listOf(Reading(t0, 75.35, 512)), tr.feed(a, 0, nowMs))
        assertEquals(emptyList<Reading>(), tr.feed(a, 1000, nowMs))
        assertEquals(emptyList<Reading>(), tr.feed(adv(c1 = 0x22, impedance = 512, at = when0.plusSeconds(1)), 2000, nowMs))
    }

    @Test fun weightOnlyAfterGrace() {
        val tr = tracker(6000)
        assertEquals(emptyList<Reading>(), tr.feed(adv(c1 = 0x20), 0, nowMs))
        assertEquals(emptyList<Reading>(), tr.poll(5900))
        assertEquals(listOf(Reading(t0, 75.35, null)), tr.poll(6000))
        assertEquals(emptyList<Reading>(), tr.poll(20000))
    }

    @Test fun impedanceBeforeGraceWins() {
        val tr = tracker(6000)
        tr.feed(adv(c1 = 0x20), 0, nowMs)
        val out = tr.feed(adv(c1 = 0x22, impedance = 498, at = when0.plusSeconds(4)), 3000, nowMs)
        assertEquals(listOf(Reading(t0, 75.35, 498)), out) // keeps the first stable frame's time
        assertEquals(emptyList<Reading>(), tr.poll(30000))
    }

    @Test fun lateImpedanceUpgradesSameTime() {
        val tr = tracker(6000)
        tr.feed(adv(c1 = 0x20), 0, nowMs)
        assertEquals(1, tr.poll(7000).size)
        val out = tr.feed(adv(c1 = 0x22, impedance = 498, at = when0.plusSeconds(10)), 10000, nowMs)
        assertEquals(listOf(Reading(t0, 75.35, 498)), out)
    }

    @Test fun stepOffFlushesWeightOnly() {
        val tr = tracker(6000)
        tr.feed(adv(c1 = 0x20), 0, nowMs)
        assertEquals(listOf(Reading(t0, 75.35, null)), tr.feed(adv(c1 = 0xA0, at = when0.plusSeconds(5)), 2000, nowMs))
    }

    @Test fun freshRemovedFrameIsTheResult() {
        // Heard 2 min after the weigh-in; the scale's stamp gives the time
        val out = tracker().feed(adv(c1 = 0xA2, impedance = 512), 0, nowMs + 120_000)
        assertEquals(listOf(Reading(t0, 75.35, 512)), out)
    }

    @Test fun removedFrameWithClockAnHourBehind() {
        // The user's scale: real 22:48, scale says 21:48, heard at 22:50
        val out = tracker().feed(adv(c1 = 0xA2, impedance = 480, at = when0.minusHours(1)), 0, nowMs + 120_000)
        assertEquals(listOf(Reading(t0, 75.35, 480)), out)
    }

    @Test fun staleRemovedFrameIsIgnored() {
        assertEquals(emptyList<Reading>(), tracker().feed(adv(c1 = 0xA2, impedance = 512), 0, nowMs + 20 * 60_000))
        assertEquals(emptyList<Reading>(), tracker().feed(adv(c1 = 0xA2, impedance = 512, at = LocalDateTime.of(2000, 1, 1, 0, 0)), 0, nowMs))
    }

    @Test fun removedFrameAfterLiveReadingIsNotRepeated() {
        val tr = tracker()
        assertEquals(1, tr.feed(adv(c1 = 0x22, impedance = 512), 0, nowMs).size)
        assertEquals(emptyList<Reading>(), tr.feed(adv(c1 = 0xA2, impedance = 512, at = when0.plusSeconds(8)), 9000, nowMs + 9000))
    }

    @Test fun removedFrameAddsMissingImpedance() {
        val tr = tracker(6000)
        tr.feed(adv(c1 = 0x20), 0, nowMs)
        assertEquals(listOf(Reading(t0, 75.35, null)), tr.poll(7000))
        val out = tr.feed(adv(c1 = 0xA2, impedance = 498, at = when0.plusSeconds(9)), 10000, nowMs + 10000)
        assertEquals(listOf(Reading(t0, 75.35, 498)), out)
    }

    @Test fun twoWeighInsAreSeparate() {
        val tr = tracker()
        val later = LocalDateTime.of(2026, 11, 5, 19, 0, 0)
        val first = tr.feed(adv(c1 = 0x22, impedance = 512), 0, nowMs)
        val second = tr.feed(adv(c1 = 0x22, impedance = 500, rawWeight = 15100, at = later), 100000,
            later.atZone(zone).toInstant().toEpochMilli())
        assertEquals(1, first.size)
        assertEquals(1, second.size)
        assertTrue(first[0].timeMs != second[0].timeMs)
    }

    @Test fun unsyncedScaleClockUsesReceiveTime() {
        val out = tracker().feed(adv(c1 = 0x22, impedance = 512, at = LocalDateTime.of(2000, 1, 1, 0, 0, 5)), 0, nowMs)
        assertEquals(nowMs, out[0].timeMs)
        assertNull(tracker().feed(adv(c1 = 0x00), 0, nowMs).firstOrNull())
    }
}
