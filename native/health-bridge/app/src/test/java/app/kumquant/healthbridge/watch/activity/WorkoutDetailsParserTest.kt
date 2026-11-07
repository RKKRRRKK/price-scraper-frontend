package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.watch.activity.impl.WorkoutDetailsParser
import app.kumquant.healthbridge.watch.activity.impl.WorkoutRecord
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ported from Gadgetbridge's WorkoutDetailsParserTest (synthetic per-version builders) and
 * WorkoutDetailsSummaryConsistencyTest (real DETAILS/SUMMARY pairs).
 */
class WorkoutDetailsParserTest {
    private val fileTs = 1_700_000_000L

    private fun id(version: Int, subtype: Int = ActivityFileId.SPORTS_OUTDOOR_RUNNING) =
        ActivityFileId(fileTs, 0, version, ActivityFileId.TYPE_SPORTS, subtype, ActivityFileId.DETAIL_DETAILS)

    private class Segment(val startTs: Int, val records: List<IntArray>, val phase: Int = 0, val strokes: Int = 0)

    /** A DETAILS payload (after id + padding) for [version] with the given segments. */
    private fun payload(version: Int, vararg segments: Segment): ByteArray {
        val signature: IntArray
        val headerSize: Int
        val tsPos: Int
        when (version) {
            2 -> { signature = intArrayOf(0xC0); headerSize = 9; tsPos = 4 }
            3 -> { signature = intArrayOf(0xCC, 0xCC, 0xC0); headerSize = 17; tsPos = 8 }
            4 -> { signature = intArrayOf(0xFF, 0xFF); headerSize = 13; tsPos = 4 }
            5 -> { signature = intArrayOf(0xEC, 0xCC, 0xC0, 0x0C, 0xC0); headerSize = 17; tsPos = 8 }
            6 -> { signature = intArrayOf(0xFF, 0xFF, 0x8B, 0xFF); headerSize = 13; tsPos = 4 }
            9 -> { signature = intArrayOf(0xFF, 0xFF, 0xF8, 0xBF, 0xFB, 0xBB, 0xBF); headerSize = 27; tsPos = 8 }
            else -> error("version $version")
        }
        val b = Bytes().raw(*signature)
        for (seg in segments) {
            val hdr = ByteArray(headerSize)
            fun put(pos: Int, v: Int) { for (i in 0 until 4) hdr[pos + i] = (v shr (8 * i)).toByte() }
            put(tsPos - 4, seg.records.size)
            put(tsPos, seg.startTs)
            if (version == 4) { hdr[8] = seg.phase.toByte(); put(9, seg.strokes) }
            b.raw(hdr)
            for (r in seg.records) when (version) {
                2 -> b.u8(r[0]).u8(r[1]) // hr, calories
                3 -> b.u8(r[0]).u8(r[1]).i32(r[2]) // calories, hr, speed
                4 -> b.u8(r[0]).u8(r[1]).u8(r[2]) // hr, events, stroke rate
                5 -> b.u8(r[0]).u8(r[1]).u8(r[2]).u8(r[3]).u8(r[4]).u8(r[5]).u16(r[6]) // steps, hr, events, kcal, spo2, cadence, pace
                6 -> b.u8(r[0]).u8(r[1]).u8(r[2]).u8(r[3]).i32(0).u8(0).u8(r[4]).u16(r[5]) // steps, hr, dist dm, stride, cadence, pace
                9 -> b.u8(r[0]).u8(r[1]).zeros(23)
            }
        }
        return b.toByteArray()
    }

    private fun records(version: Int, subtype: Int, vararg segments: Segment): List<WorkoutRecord> {
        val i = id(version, subtype)
        return WorkoutDetailsParser.records(i, T.file(i, payload(version, *segments)))
    }

    @Test
    fun v2SingleSegment() {
        val r = records(2, ActivityFileId.SPORTS_OUTDOOR_RUNNING, Segment(1_700_000_100, listOf(intArrayOf(72, 5), intArrayOf(85, 6), intArrayOf(90, 7))))
        assertEquals(listOf(72, 85, 90), r.map { it.hr })
        assertEquals(listOf(1_700_000_100, 1_700_000_101, 1_700_000_102), r.map { it.ts })
    }

    @Test
    fun v2MultiSegmentRestartsTheClock() {
        val r = records(
            2, ActivityFileId.SPORTS_OUTDOOR_RUNNING,
            Segment(1_700_003_000, listOf(intArrayOf(70, 1), intArrayOf(71, 1))),
            Segment(1_700_003_600, listOf(intArrayOf(80, 1))),
        )
        assertEquals(listOf(1_700_003_000, 1_700_003_001, 1_700_003_600), r.map { it.ts })
        assertEquals(listOf(70, 71, 80), r.map { it.hr })
    }

    @Test
    fun v3KeepsRawSpeed() {
        val r = records(3, ActivityFileId.SPORTS_OUTDOOR_RUNNING, Segment(1_700_001_000, listOf(intArrayOf(10, 120, 500), intArrayOf(12, 135, 520))))
        assertEquals(listOf(120, 135), r.map { it.hr })
        assertEquals(listOf(500, 520), r.map { it.speedRaw })
    }

    @Test
    fun v5HasStepsSpo2AndCadence() {
        val r = records(
            5, ActivityFileId.SPORTS_OUTDOOR_RUNNING,
            Segment(1_700_002_000, listOf(intArrayOf(3, 155, 0, 8, 98, 170, 360), intArrayOf(4, 160, 0, 9, 97, 172, 355))),
        )
        assertEquals(listOf(155, 160), r.map { it.hr })
        assertEquals(listOf(3, 4), r.map { it.steps })
        assertEquals(listOf(98, 97), r.map { it.spo2 })
        assertEquals(listOf(170, 172), r.map { it.cadence })
    }

    @Test
    fun v4RowingHasStrokeRateAsCadence() {
        val r = records(
            4, ActivityFileId.SPORTS_ROWING,
            Segment(1_700_004_000, listOf(intArrayOf(120, 0, 30), intArrayOf(125, 1, 34)), phase = 0x81, strokes = 2),
            Segment(1_700_004_100, listOf(intArrayOf(110, 0, 0)), phase = 0x82),
        )
        assertEquals(listOf(120, 125, 110), r.map { it.hr })
        assertEquals(listOf(30, 34, 0), r.map { it.cadence })
    }

    @Test
    fun v6TreadmillSpeedFollowsDistance() {
        // 1 m (10 dm) per second with a steady pace of 360 s/km (2.78 m/s): speed is scaled to cover the segment distance
        val rec = List(10) { intArrayOf(2, 130, 10, 80, 150, 360) }
        val r = records(6, ActivityFileId.SPORTS_TREADMILL, Segment(1_700_005_000, rec))
        assertEquals(10, r.size)
        assertEquals(10, r.sumOf { it.steps!! } / 2)
        assertEquals(150, r[0].cadence)
        assertEquals(10.0, r.sumOf { it.speedMps!!.toDouble() }, 0.01) // 10 records of 1 m/s = 10 m
    }

    @Test
    fun v9WalkingTakesStepsAndHr() {
        val r = records(9, ActivityFileId.SPORTS_OUTDOOR_WALKING_V2, Segment(1_700_006_000, listOf(intArrayOf(0x35, 99), intArrayOf(0x32, 110))))
        assertEquals(listOf(99, 110), r.map { it.hr })
        assertEquals(listOf(5, 2), r.map { it.steps }) // low nibble only
    }

    @Test
    fun wrongSignatureThrows() {
        val i = id(2)
        val bad = T.file(i, Bytes().raw(0xAA).zeros(20).toByteArray())
        val e = runCatching { ActivityParsers.parse(i, bad) }.exceptionOrNull()
        assertTrue(e is ActivityParseException)
        assertTrue(e!!.message!!.contains("signature"))
    }

    @Test
    fun unknownVersionThrows() {
        val i = id(42)
        val e = runCatching { ActivityParsers.parse(i, T.file(i, ByteArray(30))) }.exceptionOrNull()
        assertTrue(e is ActivityParseException)
        assertTrue(e!!.message!!.contains("workout details version 42"))
    }

    @Test
    fun parseBuildsTheHrSeriesAndASessionOnTheExerciseId() {
        val i = id(5)
        val data = T.file(
            i,
            payload(
                5,
                Segment(1_700_002_000, listOf(intArrayOf(3, 155, 0, 8, 98, 170, 360), intArrayOf(4, 0, 0, 9, 97, 0, 355), intArrayOf(4, 255, 0, 9, 97, 172, 355), intArrayOf(4, 161, 0, 9, 97, 172, 355))),
            ),
        )
        val out = ActivityParsers.parse(i, data)
        val s = out.sessions.single()
        assertEquals("hb:exercise:$fileTs", s.id)
        assertEquals(1_700_002_000_000L, s.start)
        assertEquals(1_700_002_003_000L, s.end)
        assertNull(s.exerciseType)
        val d = JSONObject(s.detailsJson!!)
        // HR 0 and 255 are not readings
        assertEquals(listOf(1_700_002_000L to 155.0, 1_700_002_003L to 161.0), T.series(d.getJSONArray("hr")))
        assertEquals(listOf(1_700_002_000L to 170.0, 1_700_002_002L to 172.0, 1_700_002_003L to 172.0), T.series(d.getJSONArray("cadence")))
    }

    @Test
    fun treadmillV5SpeedIsTenthsOfKmh() {
        // belt at 7.2 km/h = 2 m/s: raw 72 / 36
        val i = id(5, ActivityFileId.SPORTS_TREADMILL)
        val hdr = ByteArray(115).also { it[2] = 0x80.toByte() } // ts at offset 2 below
        val ts = 1_700_007_000
        for (k in 0 until 4) hdr[2 + k] = (ts shr (8 * k)).toByte()
        val rec = Bytes().u8(0).u8(120).u8(0).u8(72).i32(0).toByteArray()
        val data = T.file(i, Bytes().raw(0xEC, 0xCC, 0x80, 0x28, 0x06).raw(hdr).raw(rec).raw(rec).toByteArray())
        val d = JSONObject(ActivityParsers.parse(i, data).sessions.single().detailsJson!!)
        assertEquals(listOf(ts.toLong() to 2.0, ts + 1L to 2.0), T.series(d.getJSONArray("speed_mps")))
    }

    // ---- real DETAILS / SUMMARY pairs: the totals must agree ----

    @Test
    fun detailsAgreeWithTheirSummaries() {
        val vectors = org.json.JSONArray(T.resource("consistency_vectors.json"))
        assertEquals(3, vectors.length())
        for (n in 0 until vectors.length()) {
            val v = vectors.getJSONObject(n)
            val label = v.getString("label")
            val file = T.hex(v.getString("fileId")) + byteArrayOf(0) + T.hex(v.getString("bitmap")) +
                v.getJSONArray("headers").let { h ->
                    (0 until h.length()).map { i -> T.hex(h.getString(i)) + T.b64(v.getJSONArray("records").getString(i)) }.reduce { a, b -> a + b }
                }
            val data = file + Bytes().i32(T.crc(file, file.size)).toByteArray()
            val id = ActivityFileId.fromBytes(data)
            val records = WorkoutDetailsParser.records(id, data)
            assertTrue("$label: decoded", records.isNotEmpty())

            val summaryBytes = T.b64(v.getString("summary"))
            val summary = JSONObject(ActivityParsers.parse(ActivityFileId.fromBytes(summaryBytes), summaryBytes).sessions.single().detailsJson!!)

            val steps = records.mapNotNull { it.steps }.sum()
            if (records.any { it.steps != null } && summary.has("steps")) {
                assertWithin("$label steps", steps.toDouble(), summary.getDouble("steps"))
            }
            if (records.any { it.distanceDm != null && it.speedMps != null } && summary.has("distance_m")) {
                assertWithin("$label distance from speed", records.sumOf { (it.speedMps ?: 0f).toDouble() }, summary.getDouble("distance_m"))
            }
            if (summary.has("max_cadence")) {
                val maxCadence = records.mapNotNull { it.cadence }.maxOrNull()
                assertNotNull("$label: cadence", maxCadence)
                assertTrue("$label max cadence $maxCadence vs ${summary.getDouble("max_cadence")}", Math.abs(maxCadence!! - summary.getDouble("max_cadence")) <= 1)
            }
        }
    }

    private fun assertWithin(label: String, actual: Double, expected: Double) {
        assertTrue("$label: $actual vs $expected", Math.abs(actual - expected) <= Math.max(2.0, expected * 0.03))
    }

    // ---- GPS ----

    private fun gpsId(version: Int) =
        ActivityFileId(fileTs, 0, version, ActivityFileId.TYPE_SPORTS, ActivityFileId.SPORTS_OUTDOOR_RUNNING, ActivityFileId.DETAIL_GPS_TRACK)

    @Test
    fun gpsV1() {
        val p = Bytes().u8(0)
            .i32(1_700_000_010).f32(13.4f).f32(52.5f)
            .i32(1_700_000_011).f32(13.5f).f32(52.6f)
            .toByteArray()
        val s = ActivityParsers.parse(gpsId(1), T.file(gpsId(1), p)).sessions.single()
        assertEquals("hb:exercise:$fileTs", s.id)
        assertEquals(1_700_000_010_000L, s.start)
        assertEquals(1_700_000_011_000L, s.end)
        val gps = JSONObject(s.detailsJson!!).getJSONArray("gps")
        assertEquals(2, gps.length())
        val p0 = gps.getJSONArray(0)
        assertEquals(1_700_000_010L, p0.getLong(0))
        assertEquals(52.5, p0.getDouble(1), 1e-6) // [t, lat, lon, alt]
        assertEquals(13.4, p0.getDouble(2), 1e-5)
        assertTrue(p0.isNull(3))
    }

    @Test
    fun gpsV2SkipsAccuracyAndSpeed() {
        val p = Bytes().u8(0)
            .i32(1_700_000_010).f32(13.4f).f32(52.5f).f32(4.0f).u16(0x0150)
            .i32(1_700_000_011).f32(13.5f).f32(52.6f).f32(4.0f).u16(0x0150)
            .toByteArray()
        val gps = JSONObject(ActivityParsers.parse(gpsId(2), T.file(gpsId(2), p)).sessions.single().detailsJson!!).getJSONArray("gps")
        assertEquals(52.6, gps.getJSONArray(1).getDouble(1), 1e-5)
        assertTrue(gps.getJSONArray(1).isNull(3))
    }

    @Test
    fun gpsV3HasAltitude() {
        val p = Bytes().u8(0)
            .i32(1_700_000_010).f32(13.4f).f32(52.5f).f32(4.0f).u16(0x0150).f32(123.46f).f32(1.1f)
            .toByteArray()
        val gps = JSONObject(ActivityParsers.parse(gpsId(3), T.file(gpsId(3), p)).sessions.single().detailsJson!!).getJSONArray("gps")
        assertEquals(123.5, gps.getJSONArray(0).getDouble(3), 0.01)
    }

    @Test
    fun gpsNullIslandAndPlaceholderYieldNothing() {
        val nullIsland = Bytes().u8(0).i32(1_700_000_010).f32(0f).f32(0f).i32(1_700_000_011).f32(0f).f32(0f).toByteArray()
        assertTrue(ActivityParsers.parse(gpsId(1), T.file(gpsId(1), nullIsland)).sessions.isEmpty())
        // the 13-byte shell for indoor workouts: id, padding, header byte, CRC
        val placeholder = T.file(gpsId(1), byteArrayOf(0))
        assertEquals(13, placeholder.size)
        assertTrue(ActivityParsers.parse(gpsId(1), placeholder).sessions.isEmpty())
    }

    @Test
    fun gpsAndDetailsAndSummaryMergeIntoOneSession() {
        val summaryBytes = T.summaryVector("OUTDOOR_RUN_V5_30SEP")
        val sid = ActivityFileId.fromBytes(summaryBytes)
        val summary = ActivityParsers.parse(sid, summaryBytes).sessions.single()

        val dId = sid.copy(detailType = ActivityFileId.DETAIL_DETAILS, version = 2)
        val dData = T.file(dId, payload(2, Segment((sid.timestamp + 5).toInt(), listOf(intArrayOf(150, 1), intArrayOf(151, 1)))))
        val details = ActivityParsers.parse(dId, dData).sessions.single()

        val gId = sid.copy(detailType = ActivityFileId.DETAIL_GPS_TRACK, version = 1)
        val gData = T.file(gId, Bytes().u8(0).i32((sid.timestamp + 5).toInt()).f32(13.4f).f32(52.5f).toByteArray())
        val gps = ActivityParsers.parse(gId, gData).sessions.single()

        assertEquals(summary.id, details.id)
        assertEquals(summary.id, gps.id)
        val merged = listOf(details, gps).fold(summary) { acc, s -> ActivityParsers.mergeSession(acc, s) }
        val d = JSONObject(merged.detailsJson!!)
        assertTrue(d.has("hr") && d.has("gps") && d.has("avg_hr") && d.has("distance_m"))
        assertEquals(summary.start, merged.start)
        assertEquals(summary.end, merged.end)
        assertEquals(56, merged.exerciseType)
    }
}
