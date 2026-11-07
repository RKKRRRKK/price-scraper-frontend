package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SessionEntity
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Sleep details / stages files, the shared session id, and [ActivityParsers.mergeSession]. */
class SleepAndMergeTest {
    private val bed = 1_700_000_000L
    private val wake = bed + 130 * 60

    private val detailsId = ActivityFileId(bed - 3600, 4, 2, 0, ActivityFileId.ACTIVITY_SLEEP, ActivityFileId.DETAIL_DETAILS)
    private val stagesId = ActivityFileId(bed - 7200, 4, 2, 0, ActivityFileId.ACTIVITY_SLEEP_STAGES, ActivityFileId.DETAIL_DETAILS)

    private fun packet(type: Int, ts: Long, data: ByteArray) =
        Bytes().raw(0xfb, 0xfa, 0xfc, 0xff).u8(17).i64(ts).u8(0).u8(type).be16(data.size).raw(data).toByteArray()

    private fun stagePacket(): ByteArray {
        // (raw stage, minutes): 1 light, 2 deep, 3 REM, 0 awake
        val d = Bytes()
        for ((stage, min) in listOf(1 to 30, 2 to 60, 3 to 30, 0 to 10)) d.be16((stage shl 12) or min)
        return packet(17, bed, d.toByteArray())
    }

    private fun details(isAwake: Int = 1, packets: ByteArray): ByteArray = T.file(
        detailsId,
        Bytes().u8(0x18).u8(isAwake).i32(bed.toInt()).i32(wake.toInt())
            // heart rate: unit 60 s, 3 values from bed + 60 s (the 0 is a missed reading)
            .u16(60).u16(3).i32((bed + 60).toInt()).raw(55, 0, 60)
            // SpO2: 2 values
            .u16(60).u16(2).i32((bed + 60).toInt()).raw(96, 0)
            .raw(packets).toByteArray(),
    )

    private fun iso(sec: Long) = Instant.ofEpochSecond(sec).toString()

    private fun stages(json: String): List<Triple<String, String, String>> {
        val a = JSONArray(json)
        return (0 until a.length()).map { a.getJSONObject(it).let { o -> Triple(o.getString("stage"), o.getString("start"), o.getString("end")) } }
    }

    private val expectedStages = listOf(
        Triple("light", iso(bed), iso(bed + 30 * 60)),
        Triple("deep", iso(bed + 30 * 60), iso(bed + 90 * 60)),
        Triple("rem", iso(bed + 90 * 60), iso(bed + 120 * 60)),
        Triple("awake", iso(bed + 120 * 60), iso(wake)),
    )

    @Test
    fun sleepDetailsYieldsSessionStagesAndSamples() {
        val resp = packet(0xa, (bed + 600) * 1_000_000_000L, byteArrayOf(0, 16, 0, 0, 0, 18, 0, 0))
        val flag = packet(0x2, bed, ByteArray(0))
        val out = ActivityParsers.parse(detailsId, details(packets = stagePacket() + flag + resp))

        val s = out.sessions.single()
        assertEquals("hb:sleep:$bed", s.id)
        assertEquals(Metrics.KIND_SLEEP, s.kind)
        assertEquals(bed * 1000, s.start)
        assertEquals(wake * 1000, s.end)
        assertEquals(expectedStages, stages(s.stagesJson))
        assertNull(s.detailsJson)
        assertNull(s.exerciseType)

        val byMetric = out.samples.groupBy { it.metric }
        assertEquals(listOf((bed + 60) * 1000, (bed + 180) * 1000), byMetric.getValue(Metrics.HEART_RATE).map { it.start })
        assertEquals(listOf(55.0, 60.0), byMetric.getValue(Metrics.HEART_RATE).map { it.value })
        assertEquals(listOf(96.0), byMetric.getValue(Metrics.SPO2).map { it.value })
        assertEquals(listOf(bed * 1000 + 200_000, bed * 1000 + 400_000), byMetric.getValue(Metrics.RESPIRATORY_RATE).map { it.start })
        assertEquals(listOf(16.0, 18.0), byMetric.getValue(Metrics.RESPIRATORY_RATE).map { it.value })
    }

    @Test
    fun sleepSeriesOutsideTheNightAreDropped() {
        val raw = details(packets = stagePacket())
        // shift the HR first-record time 5 hours after the wake-up: implausible, so the series goes
        val bad = raw.copyOf()
        val off = 8 + 1 + 1 + 4 + 4 + 2 + 2
        val t = (wake + 5 * 3600).toInt()
        for (i in 0 until 4) bad[off + i] = (t shr (8 * i)).toByte()
        val out = ActivityParsers.parse(detailsId, bad)
        assertTrue(out.samples.none { it.metric == Metrics.HEART_RATE })
        assertEquals(1, out.sessions.size)
    }

    @Test
    fun sleepStagesFileProducesTheSameSessionId() {
        val payload = Bytes().zeros(7).u16(130).i32(bed.toInt()).i32(wake.toInt()).zeros(3)
            .u16(60).u16(30).u16(30).u16(10).u8(0)
            .i32(bed.toInt()).u8(3)
            .i32((bed + 30 * 60).toInt()).u8(2)
            .i32((bed + 90 * 60).toInt()).u8(4)
            .i32((bed + 120 * 60).toInt()).u8(5)
            .toByteArray()
        val fromStages = ActivityParsers.parse(stagesId, T.file(stagesId, payload)).sessions.single()
        val fromDetails = ActivityParsers.parse(detailsId, details(packets = stagePacket())).sessions.single()
        assertEquals(fromDetails.id, fromStages.id)
        assertEquals(expectedStages, stages(fromStages.stagesJson))
        assertEquals(fromDetails, ActivityParsers.mergeSession(fromDetails, fromStages).copy(detailsJson = null))
    }

    @Test
    fun sleepStagesFileWithNoDataYieldsNothing() {
        val out = ActivityParsers.parse(stagesId, T.file(stagesId, ByteArray(40)))
        assertTrue(out.sessions.isEmpty() && out.samples.isEmpty())
    }

    @Test
    fun unfinishedNightYieldsNoSessionYet() {
        // wake-up still equal to bedtime while the night runs
        val payload = Bytes().u8(0x00).u8(0).i32(bed.toInt()).i32(bed.toInt()).toByteArray()
        val out = ActivityParsers.parse(detailsId, T.file(detailsId, payload))
        assertTrue(out.sessions.isEmpty())
    }

    @Test
    fun stageInEffectAtBedtimeIsClippedNotDropped() {
        // first stage change 10 min before bedtime (deep for 40 min), then light
        val d = Bytes().be16((2 shl 12) or 40).be16((1 shl 12) or 90)
        val out = ActivityParsers.parse(detailsId, details(packets = packet(17, bed - 600, d.toByteArray())))
        val st = stages(out.sessions.single().stagesJson)
        assertEquals(Triple("deep", iso(bed), iso(bed + 30 * 60)), st[0])
        assertEquals("light", st[1].first)
    }

    @Test
    fun truncatedPacketThrows() {
        val data = details(packets = stagePacket())
        val cut = data.copyOf(data.size - 10) // cuts into the stage payload
        val e = runCatching { ActivityParsers.parse(detailsId, cut) }.exceptionOrNull()
        assertTrue(e is ActivityParseException)
    }

    // ---- mergeSession ----

    private fun exercise(
        start: Long, end: Long, details: String?, title: String? = null, type: Int? = null,
    ) = SessionEntity("hb:exercise:1", Metrics.KIND_EXERCISE, start, end, title, type, "[]", details)

    @Test
    fun mergeWithNothingStoredReturnsIncoming() {
        val s = exercise(1, 2, "{\"kcal\":1}")
        assertEquals(s, ActivityParsers.mergeSession(null, s))
    }

    @Test
    fun mergeCombinesDetailsKeysAndKeepsWidestRange() {
        val summary = exercise(1000, 9000, "{\"kcal\":300,\"avg_hr\":140}", "Frisbee", 31)
        val details = exercise(1200, 8800, "{\"hr\":[[1200,100],[1201,101]]}")
        val gps = exercise(1300, 9500, "{\"gps\":[[1300,1.5,2.5,null]]}")

        val a = ActivityParsers.mergeSession(ActivityParsers.mergeSession(summary, details), gps)
        val b = ActivityParsers.mergeSession(ActivityParsers.mergeSession(gps, details), summary)
        assertEquals(1000L, a.start)
        assertEquals(9500L, a.end)
        assertEquals("Frisbee", a.title)
        assertEquals(31, a.exerciseType)
        val d = JSONObject(a.detailsJson!!)
        assertEquals(setOf("avg_hr", "gps", "hr", "kcal"), d.keys().asSequence().toSet())
        assertEquals(300, d.getInt("kcal"))
        // order of arrival does not change the result
        assertEquals(a, b)
    }

    @Test
    fun incomingNonNullWinsButEmptyArrayNeverReplaces() {
        val existing = exercise(1, 2, "{\"hr\":[[1,100]],\"kcal\":10,\"gps\":[]}", "Old", 8)
        val incoming = exercise(1, 2, "{\"hr\":[],\"kcal\":20,\"gps\":[[1,2.0,3.0,null]],\"vo2max\":null}", "New", null)
        val m = ActivityParsers.mergeSession(existing, incoming)
        val d = JSONObject(m.detailsJson!!)
        assertEquals(1, d.getJSONArray("hr").length())
        assertEquals(20, d.getInt("kcal"))
        assertEquals(1, d.getJSONArray("gps").length())
        assertTrue(!d.has("vo2max"))
        assertEquals("New", m.title)
        assertEquals(8, m.exerciseType)
    }

    @Test
    fun mergeKeepsTheStagesWithMoreCoverage() {
        fun stagesOf(minutes: Long) = JSONArray().put(
            JSONObject().put("stage", "light").put("start", iso(bed)).put("end", iso(bed + minutes * 60)),
        ).toString()
        fun sleep(wakeMin: Long, stages: String) =
            SessionEntity("hb:sleep:$bed", Metrics.KIND_SLEEP, bed * 1000, (bed + wakeMin * 60) * 1000, stagesJson = stages)

        val full = sleep(130, stagesOf(130))
        val partial = sleep(60, stagesOf(60))
        val m = ActivityParsers.mergeSession(full, partial)
        assertEquals(full.stagesJson, m.stagesJson)
        assertEquals(full.end, m.end)
        // the other way round the richer incoming one wins, and a tie takes the incoming
        assertEquals(full.stagesJson, ActivityParsers.mergeSession(partial, full).stagesJson)
        val tie = sleep(130, stagesOf(130).replace("light", "deep"))
        assertEquals(tie.stagesJson, ActivityParsers.mergeSession(full, tie).stagesJson)
    }
}
