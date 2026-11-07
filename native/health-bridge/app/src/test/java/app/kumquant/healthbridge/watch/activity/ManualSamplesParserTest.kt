package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported from Gadgetbridge's ManualSamplesParserTest (real version 1 packets) plus version 2 vectors. */
class ManualSamplesParserTest {
    private val spo2Packet = "EFB9856AF4011800FFEFB9856A0261511E4648"
    private val stress40Packet = "65C0856AF4011800FF65C0856A03288CA20578"
    private val stress27Packet = "D1C3856AF4011800FFD1C3856A031BFBF91375"

    private fun parse(packet: ByteArray) = ActivityParsers.parse(ActivityFileId.fromBytes(packet), packet)

    private fun fails(packet: ByteArray): Boolean = runCatching { parse(packet) }.exceptionOrNull() is ActivityParseException

    @Test
    fun version1Spo2() {
        val out = parse(T.hex(spo2Packet))
        assertEquals(1, out.samples.size)
        assertEquals(Metrics.SPO2, out.samples[0].metric)
        assertEquals(97.0, out.samples[0].value, 0.0)
        assertEquals(1787148783000L, out.samples[0].start)
        assertEquals(null, out.samples[0].end)
    }

    @Test
    fun version1Stress() {
        val a = parse(T.hex(stress40Packet)).samples.single()
        val b = parse(T.hex(stress27Packet)).samples.single()
        assertEquals(Metrics.STRESS, a.metric)
        assertEquals(40.0, a.value, 0.0)
        assertEquals(27.0, b.value, 0.0)
    }

    @Test
    fun version1RejectsUnknownHeader() {
        val p = T.hex(spo2Packet); p[8] = 0
        assertTrue(fails(p))
    }

    @Test
    fun version1RejectsUnknownType() {
        val p = T.hex(spo2Packet); p[13] = 0x04
        assertTrue(fails(p))
    }

    @Test
    fun version1RejectsOutOfRangeValue() {
        val p = T.hex(spo2Packet); p[14] = 101
        assertTrue(fails(p))
    }

    private val id2 = ActivityFileId(1_700_000_000, 0, 2, 0, ActivityFileId.ACTIVITY_MANUAL_SAMPLES, 0)

    @Test
    fun version2AllTypes() {
        // the layout from Gadgetbridge's comments: SpO2, stress, skin temperature 0x0E5A = 36.74 degC, heart rate, a zero
        val payload = Bytes()
            .i32(1_700_000_100).u8(0x12).u8(0x63)
            .i32(1_700_000_200).u8(0x13).u8(0x1C)
            .i32(1_700_000_300).u8(0x44).i32(0x00000E5A)
            .i32(1_700_000_400).u8(0x11).u8(72)
            .i32(1_700_000_500).u8(0x13).u8(0)
            .toByteArray()
        val out = ActivityParsers.parse(id2, T.file(id2, payload)).samples
        assertEquals(
            listOf(Metrics.SPO2, Metrics.STRESS, Metrics.SKIN_TEMP_C, Metrics.HEART_RATE),
            out.map { it.metric },
        )
        assertEquals(listOf(99.0, 28.0, 36.74, 72.0), out.map { it.value })
        assertEquals(1_700_000_300_000L, out[2].start)
    }

    @Test
    fun version2InvalidHeartRateAndSpo2AreSkipped() {
        val payload = Bytes().i32(1_700_000_100).u8(0x11).u8(255).i32(1_700_000_200).u8(0x12).u8(200).toByteArray()
        assertTrue(ActivityParsers.parse(id2, T.file(id2, payload)).samples.isEmpty())
    }

    @Test
    fun version2UnknownTypeThrowsWithItsValue() {
        val payload = Bytes().i32(1_700_000_100).u8(0x55).u8(1).toByteArray()
        val e = runCatching { ActivityParsers.parse(id2, T.file(id2, payload)) }.exceptionOrNull()
        assertTrue(e is ActivityParseException)
        assertTrue(e!!.message!!.contains("unknown sample type 0x55"))
    }
}
