package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ported from Gadgetbridge's WorkoutSummaryParserTest: every vector is the verbatim contents of a SUMMARY file
 * pulled from a real workout (see resources/summary_vectors.json), so these pin the layouts against real bytes.
 */
class WorkoutSummaryParserTest {
    private class Parsed(val session: app.kumquant.healthbridge.data.SessionEntity, val d: JSONObject, val samples: List<app.kumquant.healthbridge.data.SampleEntity>) {
        fun n(key: String): Double {
            assertTrue("missing $key in $d", d.has(key))
            return d.getDouble(key)
        }
    }

    private fun parse(name: String): Parsed {
        val bytes = T.summaryVector(name)
        val out = ActivityParsers.parse(ActivityFileId.fromBytes(bytes), bytes)
        val s = out.sessions.single()
        return Parsed(s, JSONObject(s.detailsJson!!), out.samples)
    }

    private fun Parsed.eq(expected: Double, key: String, delta: Double = 0.001) = assertEquals(key, expected, n(key), delta)

    @Test
    fun treadmillV11() {
        val p = parse("TREADMILL_V11_24APR")
        p.eq(4500.0, "distance_m") // the calibrated distance displaces the raw 4479
        p.eq(4.2, "training_effect_aerobic", 0.01)
        p.eq(167.0, "avg_hr")
        p.eq(163.0, "avg_cadence")
        p.eq(1.8, "training_effect_anaerobic", 0.01)
        p.eq(104.0, "training_load")
        p.eq(12.0, "vitality_gain")
        assertEquals(57, p.session.exerciseType) // treadmill
        assertNull(p.session.title)
    }

    @Test
    fun treadmillV9() {
        val p = parse("TREADMILL_V9_21JUN")
        p.eq(192.0, "kcal")
        p.eq(2720.0, "distance_m")
        p.eq(3216.0, "steps")
        p.eq(135.0, "avg_hr")
        p.eq(180.0, "max_cadence")
        p.eq(1.9, "training_effect_aerobic", 0.01)
        p.eq(32.0, "recovery_h")
        p.eq(28.0, "training_load")
        p.eq(15.0, "vitality_gain")
        // v9 has no pace field: the average is distance over active time
        p.eq(p.n("active_s") / 2.72, "avg_pace_s_per_km", 0.01)
    }

    @Test
    fun rowingV7() {
        val p = parse("ROWING_V7_20APR")
        p.eq(142.0, "avg_hr")
        p.eq(2549.0, "active_s")
        p.eq(1208.0, "strokes")
        p.eq(28.0, "avg_cadence")
        p.eq(3.4, "training_effect_aerobic", 0.01)
        p.eq(0.4, "training_effect_anaerobic", 0.01)
        p.eq(71.0, "max_cadence")
        p.eq(23.0, "recovery_h")
        p.eq(69.0, "training_load")
        assertFalse("a zero vitality gain is left out", p.d.has("vitality_gain"))
        assertEquals(54, p.session.exerciseType) // rowing machine
    }

    @Test
    fun rowingV7SecondFile() {
        val p = parse("ROWING_V7_15APR")
        p.eq(1.1, "training_effect_anaerobic", 0.01)
        p.eq(3.5, "training_effect_aerobic", 0.01)
        p.eq(41.0, "max_cadence")
    }

    @Test
    fun rowingV8InsertsFiveBytesAfterTheZones() {
        val p = parse("ROWING_V8_22AUG")
        p.eq(147.0, "active_s")
        p.eq(129.0, "avg_hr")
        p.eq(145.0, "max_hr")
        p.eq(106.0, "min_hr")
        p.eq(46.0, "strokes")
        p.eq(18.0, "avg_cadence")
        p.eq(27.0, "max_cadence")
        val z = p.d.getJSONObject("hr_zones_s")
        val sum = listOf("warmup", "fatburn", "aerobic", "anaerobic", "extreme").sumOf { z.getDouble(it) }
        assertEquals("zones add up to the active seconds", 147.0, sum, 0.001)
    }

    @Test
    fun freestyleV10Frisbee() {
        val p = parse("FREESTYLE_V10_FRISBEE")
        p.eq(2.6, "training_effect_anaerobic", 0.01)
        p.eq(4.0, "training_effect_aerobic", 0.01)
        p.eq(807.0, "xiaomi_type")
        assertEquals(31, p.session.exerciseType) // frisbee disc
        assertNull("exact Health Connect match needs no title", p.session.title)
    }

    @Test
    fun outdoorCyclingV8() {
        val p = parse("OUTDOOR_CYCLING_V8_23SEP")
        assertEquals(8, p.session.exerciseType)
        p.eq(1579.0, "active_s")
        p.eq(5282.0, "distance_m")
        p.eq(166.0, "kcal_total")
        p.eq(127.0, "kcal")
        p.eq(76.0, "best_pace_s_per_km")
        p.eq(12.04, "avg_speed_kmh", 0.01)
        p.eq(46.93, "max_speed_kmh", 0.01)
        p.eq(133.0, "avg_hr")
        p.eq(168.0, "max_hr")
        p.eq(80.0, "min_hr")
        p.eq(2.3, "training_effect_aerobic", 0.01)
        p.eq(0.8, "training_effect_anaerobic", 0.01)
        p.eq(13.0, "recovery_h")
        val z = p.d.getJSONObject("hr_zones_s")
        assertEquals(95.0, z.getDouble("anaerobic"), 0.0)
        assertEquals(814.0, z.getDouble("aerobic"), 0.0)
        assertEquals(340.0, z.getDouble("fatburn"), 0.0)
        assertEquals(283.0, z.getDouble("warmup"), 0.0)
        p.eq(28.0, "training_load")
        p.eq(7.0, "vitality_gain")
    }

    @Test
    fun outdoorCyclingV6() {
        val p = parse("OUTDOOR_CYCLING_V6_23MAY")
        p.eq(11982.0, "distance_m")
        p.eq(538.0, "kcal_total")
        p.eq(439.0, "kcal")
        p.eq(104.0, "best_pace_s_per_km")
        p.eq(34.48, "max_speed_kmh", 0.01)
        val z = p.d.getJSONObject("hr_zones_s")
        assertEquals(10.0, z.getDouble("aerobic"), 0.0)
        assertEquals(97.0, z.getDouble("fatburn"), 0.0)
        assertEquals(1110.0, z.getDouble("warmup"), 0.0)
        p.eq(5.0, "training_load")
    }

    /** A route ride carries 8 more bytes after the route byte at offset 0x8D; load and vitality must stay aligned. */
    @Test
    fun outdoorCyclingV8RouteRideKeepsLoadAligned() {
        val plain = T.summaryVector("OUTDOOR_CYCLING_V8_23SEP")
        val at = 0x8D
        val route = plain.copyOfRange(0, at) + byteArrayOf(0xFF.toByte()) + ByteArray(8) { 0x5A } + plain.copyOfRange(at + 1, plain.size)
        val out = ActivityParsers.parse(ActivityFileId.fromBytes(route), route)
        val d = JSONObject(out.sessions.single().detailsJson!!)
        assertEquals(28.0, d.getDouble("training_load"), 0.0)
        assertEquals(7.0, d.getDouble("vitality_gain"), 0.0)
    }

    @Test
    fun outdoorRunV5MatchesItsDetails() {
        val p = parse("OUTDOOR_RUN_V5_30SEP")
        assertEquals(56, p.session.exerciseType) // running
        p.eq(1704.0, "active_s")
        p.eq(4189.0, "distance_m")
        p.eq(119.0, "min_hr")
        p.eq(200.0, "max_hr")
        p.eq(162.0, "avg_hr")
        p.eq(395.0, "best_pace_s_per_km")
        p.eq(178.0, "max_cadence")
        // the file carries its own average pace (v5+), close to 1704 s / 4.189 km
        p.eq(406.0, "avg_pace_s_per_km")
    }

    @Test
    fun walkingV6() {
        val p = parse("WALKING_V6_29MAY")
        assertEquals(79, p.session.exerciseType)
        p.eq(1912.0, "active_s")
        p.eq(131.0, "min_hr")
        p.eq(192.0, "max_hr")
        p.eq(149.0, "avg_hr")
    }

    @Test
    fun walkingV9() {
        val p = parse("WALKING_V9_04JAN")
        p.eq(99.0, "min_hr")
        p.eq(163.0, "max_hr")
        p.eq(135.0, "avg_hr")
    }

    @Test
    fun indoorCyclingV9() {
        val p = parse("INDOOR_CYCLING_V9_22FEB")
        assertEquals(9, p.session.exerciseType)
        p.eq(94.0, "min_hr")
        p.eq(150.0, "max_hr")
        p.eq(135.0, "avg_hr")
    }

    @Test
    fun ellipticalV6() {
        val p = parse("ELLIPTICAL_V6_10FEB")
        assertEquals(25, p.session.exerciseType)
        p.eq(118.0, "min_hr")
        p.eq(156.0, "max_hr")
        p.eq(147.0, "avg_hr")
    }

    @Test
    fun outdoorCyclingV2V3MiWatchColorSport() {
        val bytes = T.summaryVector("OUTDOOR_CYCLING_V2_V3_04OCT")
        val out = ActivityParsers.parse(ActivityFileId.fromBytes(bytes), bytes)
        val s = out.sessions.single()
        assertEquals(1791123696000L, s.end)
        assertEquals(8, s.exerciseType)
        val d = JSONObject(s.detailsJson!!)
        assertEquals(6502.0, d.getDouble("active_s"), 0.0)
        assertEquals(18090.0, d.getDouble("distance_m"), 0.0)
        assertEquals(586.0, d.getDouble("kcal"), 0.0)
        assertEquals(199.0, d.getDouble("best_pace_s_per_km"), 0.0)
        assertEquals(34.79, d.getDouble("max_speed_kmh"), 0.01)
        assertEquals(122.0, d.getDouble("avg_hr"), 0.0)
        assertEquals(198.0, d.getDouble("max_hr"), 0.0)
        assertEquals(59.0, d.getDouble("min_hr"), 0.0)
        assertEquals(461.7, d.getDouble("elevation_gain_m"), 0.1)
        assertEquals(452.4, d.getDouble("elevation_loss_m"), 0.1)
        assertEquals(3.0, d.getDouble("training_effect_aerobic"), 0.01)
        assertEquals(50.0, d.getDouble("vo2max"), 0.0)
        assertEquals(30.0, d.getDouble("recovery_h"), 0.0)
        assertEquals(729.0, d.getDouble("kcal_total"), 0.0)
        assertEquals(85.0, d.getJSONObject("hr_zones_s").getDouble("extreme"), 0.0)
        assertEquals(1959.0, d.getJSONObject("hr_zones_s").getDouble("warmup"), 0.0)
        // vo2max is also an instant at the end of the workout
        val v = out.samples.single()
        assertEquals(Metrics.VO2MAX, v.metric)
        assertEquals(50.0, v.value, 0.0)
        assertEquals(s.end, v.start)
    }

    @Test
    fun outdoorWalkingV1V3MiWatchColorSport() {
        val p = parse("OUTDOOR_WALKING_V1_V3_03OCT")
        assertEquals(79, p.session.exerciseType)
        p.eq(2040.0, "active_s")
        p.eq(1484.0, "distance_m")
        p.eq(82.0, "kcal")
        p.eq(815.0, "best_pace_s_per_km")
        p.eq(5.65, "max_speed_kmh", 0.01)
        p.eq(2224.0, "steps")
        p.eq(150.0, "max_cadence")
        p.eq(86.0, "avg_hr")
        p.eq(109.0, "max_hr")
        p.eq(71.0, "min_hr")
        p.eq(2.0, "elevation_gain_m", 0.1)
        p.eq(54.8, "elevation_loss_m", 0.1)
        p.eq(0.3, "training_effect_aerobic", 0.01)
        p.eq(127.0, "kcal_total")
    }

    @Test
    fun sessionIdStartAndEndComeFromTheFile() {
        val bytes = T.summaryVector("OUTDOOR_CYCLING_V8_23SEP")
        val id = ActivityFileId.fromBytes(bytes)
        val s = ActivityParsers.parse(id, bytes).sessions.single()
        assertEquals("hb:exercise:${id.timestamp}", s.id)
        assertEquals(id.timestamp * 1000, s.start)
        assertTrue(s.end > s.start)
        assertEquals(Metrics.KIND_EXERCISE, s.kind)
        assertEquals("[]", s.stagesJson)
    }

    @Test
    fun unsupportedVersionThrowsSoTheRawFileIsKept() {
        val bytes = T.summaryVector("OUTDOOR_CYCLING_V8_23SEP")
        bytes[5] = 99
        val e = runCatching { ActivityParsers.parse(ActivityFileId.fromBytes(bytes), bytes) }.exceptionOrNull()
        assertTrue(e is ActivityParseException)
        assertTrue(e!!.message!!.contains("version 99"))
    }

    @Test
    fun sportTableMapsToHealthConnectTypes() {
        // kayaking has no exact Health Connect type: paddling, with the Xiaomi name as the title
        val kayak = app.kumquant.healthbridge.watch.activity.impl.XiaomiSports.of(105)
        assertEquals(46, kayak.hcType)
        assertFalse(kayak.exact)
        val unknown = app.kumquant.healthbridge.watch.activity.impl.XiaomiSports.of(4242)
        assertEquals(0, unknown.hcType)
        assertEquals("Workout 4242", unknown.name)
    }
}
