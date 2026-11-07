package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Dispatch of [ActivityParsers.parse], the failure messages, and the daily details file. */
class XiaomiActivityParserTest {
    private fun parseError(id: ActivityFileId, data: ByteArray): String {
        val e = runCatching { ActivityParsers.parse(id, data) }.exceptionOrNull()
        assertTrue("expected ActivityParseException, got $e", e is ActivityParseException)
        return e!!.message!!
    }

    @Test
    fun unknownTypeOrSubtypeThrowsNamingTheFile() {
        val id = ActivityFileId(1_700_000_000, 0, 1, 0, 0x1F, 0)
        val msg = parseError(id, T.file(id, ByteArray(8)))
        assertTrue(msg, msg.contains("no parser"))
        assertTrue(msg, msg.contains("UNKNOWN_1F"))
        assertTrue("includes the bytes", msg.contains("bytes:"))
    }

    @Test
    fun unsupportedDetailTypeThrows() {
        val id = ActivityFileId(1_700_000_000, 0, 1, 0, ActivityFileId.ACTIVITY_SLEEP_STAGES, ActivityFileId.DETAIL_SUMMARY)
        assertTrue(parseError(id, T.file(id, ByteArray(8))).contains("no parser"))
        val unk = ActivityFileId(1_700_000_000, 0, 1, 1, 1, 3)
        assertTrue(parseError(unk, T.file(unk, ByteArray(8))).contains("no parser"))
    }

    @Test
    fun tooShortFileThrows() {
        val id = ActivityFileId(1_700_000_000, 0, 1, 0, 0, 0)
        assertTrue(parseError(id, ByteArray(9)).contains("too short"))
    }

    @Test
    fun unknownVersionsNameTheVersion() {
        val cases = listOf(
            ActivityFileId(1_700_000_000, 0, 9, 0, ActivityFileId.ACTIVITY_DAILY, ActivityFileId.DETAIL_DETAILS),
            ActivityFileId(1_700_000_000, 0, 9, 0, ActivityFileId.ACTIVITY_SLEEP, ActivityFileId.DETAIL_DETAILS),
            ActivityFileId(1_700_000_000, 0, 9, 0, ActivityFileId.ACTIVITY_SLEEP_STAGES, ActivityFileId.DETAIL_DETAILS),
            ActivityFileId(1_700_000_000, 0, 9, 0, ActivityFileId.ACTIVITY_MANUAL_SAMPLES, ActivityFileId.DETAIL_DETAILS),
            ActivityFileId(1_700_000_000, 0, 99, 1, ActivityFileId.SPORTS_FREESTYLE, ActivityFileId.DETAIL_SUMMARY),
            ActivityFileId(1_700_000_000, 0, 99, 1, ActivityFileId.SPORTS_FREESTYLE, ActivityFileId.DETAIL_DETAILS),
            ActivityFileId(1_700_000_000, 0, 99, 1, ActivityFileId.SPORTS_FREESTYLE, ActivityFileId.DETAIL_GPS_TRACK),
        )
        for (id in cases) {
            val msg = parseError(id, T.file(id, ByteArray(24)))
            assertTrue("$id: $msg", msg.contains("version ${id.version}"))
        }
    }

    // ---- daily details ----

    private val ts = 1_700_000_040L // not on a minute boundary on purpose: the first record sits exactly at ts

    private fun dailyId(version: Int) = ActivityFileId(ts, 4, version, 0, ActivityFileId.ACTIVITY_DAILY, ActivityFileId.DETAIL_DETAILS)

    /** Version 3: 5 header bytes, every group present with all three values valid. */
    private fun dailyV3(vararg minutes: ByteArray): ByteArray =
        T.file(dailyId(3), Bytes().raw(0xFF, 0xFF, 0xFF, 0xFF, 0xFF).also { b -> minutes.forEach { b.raw(it) } }.toByteArray())

    private fun minute(
        steps: Int, extra: Int = 0, kcal: Int, dist: Int, hr: Int, energy: Int, spo2: Int, stress: Int,
    ): ByteArray = Bytes()
        .u16((extra shl 14) or steps).u8(kcal).u8(0).u16(dist).u8(hr).u8(energy).u16(0).u8(spo2).u8(stress)
        .also { if (extra == 1) it.u8(0xAA) }
        .toByteArray()

    @Test
    fun dailyDetailsEmitsPerMinuteSamples() {
        val data = dailyV3(
            minute(steps = 20, kcal = 3, dist = 15, hr = 72, energy = 80, spo2 = 97, stress = 30),
            minute(steps = 0, kcal = 0, dist = 0, hr = 0, energy = 0, spo2 = 0, stress = 255),
            minute(steps = 5, extra = 1, kcal = 1, dist = 0, hr = 255, energy = 0, spo2 = 0, stress = 255),
            minute(steps = 7, kcal = 0, dist = 3, hr = 60, energy = 70, spo2 = 95, stress = 12),
        )
        val out = ActivityParsers.parse(dailyId(3), data)
        val t0 = ts * 1000
        fun s(metric: String, minuteIdx: Int) =
            out.samples.singleOrNull { it.metric == metric && it.start == t0 + minuteIdx * 60_000L }

        assertEquals(SampleEntity(Metrics.STEPS, t0, t0 + 60_000, 20.0), s(Metrics.STEPS, 0))
        assertEquals(3.0, s(Metrics.ACTIVE_KCAL, 0)!!.value, 0.0)
        assertEquals(15.0, s(Metrics.DISTANCE_M, 0)!!.value, 0.0)
        assertEquals(t0 + 60_000, s(Metrics.DISTANCE_M, 0)!!.end)
        assertEquals(SampleEntity(Metrics.HEART_RATE, t0, null, 72.0), s(Metrics.HEART_RATE, 0))
        assertEquals(80.0, s(Metrics.BODY_ENERGY, 0)!!.value, 0.0)
        assertEquals(97.0, s(Metrics.SPO2, 0)!!.value, 0.0)
        assertEquals(30.0, s(Metrics.STRESS, 0)!!.value, 0.0)

        // minute 1 is idle: nothing at all
        assertTrue(out.samples.none { it.start == t0 + 60_000 })

        // minute 2: steps only; HR 255 and stress 255 are not-measured, and the extra byte was consumed
        assertEquals(listOf(Metrics.STEPS, Metrics.ACTIVE_KCAL), out.samples.filter { it.start == t0 + 120_000 }.map { it.metric })

        // minute 3 still lines up after the extra byte
        assertEquals(60.0, s(Metrics.HEART_RATE, 3)!!.value, 0.0)
        assertEquals(12.0, s(Metrics.STRESS, 3)!!.value, 0.0)
        assertEquals(7.0, s(Metrics.STEPS, 3)!!.value, 0.0)
    }

    @Test
    fun dailyDetailsVersion2HasNoSpo2OrStress() {
        // 4 header bytes; groups: 16,8,8,16,8,8,16 = 7 groups, only the first 8 nibbles exist
        val payload = Bytes().raw(0xFF, 0xFF, 0xFF, 0xFF)
            .u16(9).u8(2).u8(0).u16(4).u8(88).u8(50).u16(0)
            .toByteArray()
        val id = dailyId(2)
        val out = ActivityParsers.parse(id, T.file(id, payload))
        assertEquals(
            setOf(Metrics.STEPS, Metrics.ACTIVE_KCAL, Metrics.DISTANCE_M, Metrics.HEART_RATE, Metrics.BODY_ENERGY),
            out.samples.map { it.metric }.toSet(),
        )
    }
}
