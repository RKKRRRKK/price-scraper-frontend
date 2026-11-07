package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** A real Watch S5 sleep-details v6 file (a 38-minute nap, 2026-11-06), the first version Gadgetbridge lacks. */
class SleepV6CaptureTest {
    private val data = javaClass.classLoader!!.getResourceAsStream("sleep_v6_watch_s5.bin")!!.readBytes()
    private val id = ActivityFileId.fromBytes(data)

    @Test
    fun parsesTheNap() {
        assertEquals(6, id.version)
        val parsed = ActivityParsers.parse(id, data)

        val nap = parsed.sessions.single()
        assertEquals("hb:sleep:1793982900", nap.id)
        assertEquals(Metrics.KIND_SLEEP, nap.kind)
        assertEquals(38L, (nap.end - nap.start) / 60_000)
        assertTrue("stages from the type-17 packets", JSONArray(nap.stagesJson).length() > 0)

        val hr = parsed.samples.filter { it.metric == Metrics.HEART_RATE }
        assertEquals(29, hr.size)
        assertEquals(61.0, hr.first().value, 0.0)
        assertEquals(1793983620_000L, hr.first().start) // 17:47 local, one reading a minute
        assertEquals(listOf(97.0, 97.0, 97.0), parsed.samples.filter { it.metric == Metrics.SPO2 }.map { it.value })
    }
}
