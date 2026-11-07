package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** A real Watch S5 freestyle workout (10 min, 2026-11-07): summary v11 and details v4, both newer than Gadgetbridge. */
class FreestyleS5CaptureTest {
    private fun file(name: String) = javaClass.classLoader!!.getResourceAsStream(name)!!.readBytes()

    @Test
    fun parsesTheSummary() {
        val data = file("freestyle_summary_v11_watch_s5.bin")
        val id = ActivityFileId.fromBytes(data)
        assertEquals(11, id.version)
        val s = ActivityParsers.parse(id, data).sessions.single()
        assertEquals("hb:exercise:1794081295", s.id)
        assertEquals(Metrics.KIND_EXERCISE, s.kind)
        assertEquals(627L, (s.end - s.start) / 1000)

        val d = JSONObject(s.detailsJson!!)
        assertEquals(623, d.getInt("active_s"))
        assertEquals(71, d.getInt("kcal"))
        assertEquals(87, d.getInt("kcal_total"))
        assertEquals(131, d.getInt("avg_hr"))
        assertEquals(159, d.getInt("max_hr"))
        assertEquals(88, d.getInt("min_hr"))
        assertEquals(1.7, d.getDouble("training_effect_aerobic"), 1e-9)
        assertEquals(0.3, d.getDouble("training_effect_anaerobic"), 1e-9)
        assertEquals(7, d.getInt("recovery_h"))
        val z = d.getJSONObject("hr_zones_s")
        assertEquals(listOf(40, 236, 269, 53, 0), listOf("warmup", "fatburn", "aerobic", "anaerobic", "extreme").map { z.getInt(it) })
    }

    @Test
    fun parsesTheDetails() {
        val data = file("freestyle_details_v4_watch_s5.bin")
        val id = ActivityFileId.fromBytes(data)
        assertEquals(4, id.version)
        val s = ActivityParsers.parse(id, data).sessions.single()
        assertEquals("hb:exercise:1794081295", s.id)

        val hr = JSONObject(s.detailsJson!!).getJSONArray("hr")
        assertEquals(623, hr.length())
        assertEquals(listOf(1794081295L, 89L), hr.getJSONArray(0).let { listOf(it.getLong(0), it.getLong(1)) })
        val bpm = (0 until hr.length()).map { (hr[it] as JSONArray).getInt(1) }
        assertEquals(88, bpm.min())
        assertEquals(159, bpm.max())
    }
}
