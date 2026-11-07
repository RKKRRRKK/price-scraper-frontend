package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.watch.activity.impl.DailySummaryParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Ported from Gadgetbridge's DailySummaryParserTest (synthetic inputs), plus our sample output. */
class DailySummaryParserTest {
    private val ts = 1_700_000_000L

    private fun id(version: Int) = ActivityFileId(ts, 4, version, 0, 0, 1)

    private fun file(version: Int, bitmap: ByteArray, body: ByteArray): ByteArray =
        id(version).toBytes() + byteArrayOf(0) + bitmap + body

    /** Every slot set to a recognisable non-zero value; 57 bytes. */
    private fun v5Body(): ByteArray = Bytes()
        .i32(12345).u16(250).u8(75).u8(60).u8(180).i32(1700001000).u8(55).i32(1700002000).u8(80)
        .u8(40).u8(90).u8(10).raw(0x01, 0x01, 0x01).u16(2200).u16(480).u8(96)
        .u8(99).i32(1700003000).u8(92).i32(1700004000).u8(95)
        .u16(130).u16(700).u8(2).u8(5).u8(25).u8(40).u16(280).u8(3).u8(30).u16(7).u16(65)
        .toByteArray()

    private fun v3Body() = v5Body().copyOfRange(0, 41)

    @Test
    fun v5AllBitsSetPersistsEverySlot() {
        val s = DailySummaryParser.decode(id(5), file(5, byteArrayOf(-1, -1, -1, -1), v5Body()))
        assertEquals(12345, s.steps)
        assertEquals(250, s.activeCalories)
        assertEquals(60, s.hrResting)
        assertEquals(180, s.hrMax)
        assertEquals(1700001000, s.hrMaxTs)
        assertEquals(55, s.hrMin)
        assertEquals(1700002000, s.hrMinTs)
        assertEquals(80, s.hrAvg)
        assertEquals(40, s.stressAvg)
        assertEquals(90, s.stressMax)
        assertEquals(10, s.stressMin)
        assertEquals(0x010101, s.standing)
        assertEquals(2200, s.calories)
        assertEquals(480, s.recoveryHours)
        assertEquals(99, s.spo2Max)
        assertEquals(1700003000, s.spo2MaxTs)
        assertEquals(92, s.spo2Min)
        assertEquals(1700004000, s.spo2MinTs)
        assertEquals(95, s.spo2Avg)
        assertEquals(130, s.trainingLoadDay)
        assertEquals(700, s.trainingLoadWeek)
        assertEquals(2, s.trainingLoadLevel)
        assertEquals(5, s.vitalityIncreaseLight)
        assertEquals(25, s.vitalityIncreaseModerate)
        assertEquals(40, s.vitalityIncreaseHigh)
        assertEquals(280, s.vitalityCurrent)
    }

    @Test
    fun v5NoBitsSetPersistsNothing() {
        val body = ByteArray(57) { -1 }
        val s = DailySummaryParser.decode(id(5), file(5, ByteArray(4), body))
        assertNull(s.steps)
        assertNull(s.hrResting)
        assertNull(s.standing)
        assertNull(s.vitalityCurrent)
    }

    @Test
    fun v5PartialVitalityInvalidBitsYieldNull() {
        // slot 0 (byte 0 bit 7) and slot 27 (byte 3 bit 4)
        val s = DailySummaryParser.decode(id(5), file(5, byteArrayOf(0x80.toByte(), 0, 0, 0x10), v5Body()))
        assertEquals(12345, s.steps)
        assertEquals(280, s.vitalityCurrent)
        assertNull(s.vitalityIncreaseLight)
        assertNull(s.vitalityIncreaseModerate)
        assertNull(s.vitalityIncreaseHigh)
        assertNull(s.activeCalories)
        assertNull(s.hrMax)
    }

    @Test
    fun v5BitmapIsMsbFirst() {
        for (slot in intArrayOf(0, 7, 8, 23)) {
            val bitmap = ByteArray(4)
            bitmap[slot / 8] = (1 shl (7 - slot % 8)).toByte()
            val s = DailySummaryParser.decode(id(5), file(5, bitmap, v5Body()))
            when (slot) {
                0 -> { assertNotNull(s.steps); assertNull(s.activeCalories) }
                7 -> { assertNotNull(s.hrMinTs); assertNull(s.hrMin) }
                8 -> { assertNotNull(s.hrAvg); assertNull(s.hrMinTs) }
                23 -> { assertNotNull(s.trainingLoadLevel); assertNull(s.trainingLoadWeek) }
            }
        }
    }

    @Test
    fun multiByteFieldsAreLittleEndian() {
        val body = ByteArray(57)
        body[0] = 1; body[1] = 2; body[2] = 3; body[3] = 4
        val slot27 = 4 + 2 + 1 + 1 + 1 + 4 + 1 + 4 + 1 + 1 + 1 + 1 + 3 + 2 + 2 + 1 + 1 + 4 + 1 + 4 + 1 + 2 + 2 + 1 + 1 + 1 + 1
        body[slot27] = 2; body[slot27 + 1] = 1
        val s = DailySummaryParser.decode(id(5), file(5, byteArrayOf(0x80.toByte(), 0, 0, 0x10), body))
        assertEquals(0x04030201, s.steps)
        assertEquals(0x0102, s.vitalityCurrent)
    }

    @Test
    fun standingPacks3BytesInto24Bits() {
        val body = ByteArray(57)
        val off = 4 + 2 + 1 + 1 + 1 + 4 + 1 + 4 + 1 + 1 + 1 + 1
        body[off] = 0xAA.toByte(); body[off + 1] = 0xBB.toByte(); body[off + 2] = 0xCC.toByte()
        val s = DailySummaryParser.decode(id(5), file(5, byteArrayOf(0, 0x08, 0, 0), body))
        assertEquals(0xCCBBAA, s.standing)
    }

    @Test
    fun v3ReadsSlots0To20Only() {
        val s = DailySummaryParser.decode(id(3), file(3, byteArrayOf(-1, -1, -1), v3Body()))
        assertEquals(12345, s.steps)
        assertEquals(95, s.spo2Avg)
        assertNull(s.trainingLoadDay)
        assertNull(s.vitalityCurrent)
    }

    @Test
    fun v3PartialBitmapGatesPerField() {
        val s = DailySummaryParser.decode(id(3), file(3, byteArrayOf(0x08, 0, 0), v3Body()))
        assertEquals(180, s.hrMax)
        assertNull(s.steps)
        assertNull(s.hrResting)
    }

    @Test
    fun unsupportedVersionThrowsWithTheVersion() {
        val data = T.file(ActivityFileId(ts, 0, 99, 0, 0, 1), ByteArray(8))
        val e = runCatching { ActivityParsers.parse(ActivityFileId(ts, 0, 99, 0, 0, 1), data) }.exceptionOrNull()
        assertTrue(e is ActivityParseException)
        assertTrue(e!!.message!!.contains("daily summary version 99"))
    }

    private fun assertTrue(b: Boolean) = org.junit.Assert.assertTrue(b)

    @Test
    fun emitsRestingHeartRateAndPaiAtTheFileTimestamp() {
        val data = T.file(id(5), byteArrayOf(-1, -1, -1, -1) + v5Body())
        val out = ActivityParsers.parse(id(5), data)
        assertEquals(emptyList<Any>(), out.sessions)
        val byMetric = out.samples.associateBy { it.metric }
        assertEquals(60.0, byMetric.getValue(Metrics.RESTING_HEART_RATE).value, 0.0)
        assertEquals(280.0, byMetric.getValue(Metrics.PAI).value, 0.0)
        assertEquals(ts * 1000, byMetric.getValue(Metrics.PAI).start)
        assertNull(byMetric.getValue(Metrics.PAI).end)
        assertEquals(2, out.samples.size)
    }

    @Test
    fun invalidRestingHeartRateIsSkipped() {
        // bit for slot 3 (resting) clear: the band stores the summary before it has a resting rate
        val data = T.file(id(5), byteArrayOf(0x80.toByte(), 0, 0, 0x10) + v5Body())
        val out = ActivityParsers.parse(id(5), data)
        assertEquals(listOf(Metrics.PAI), out.samples.map { it.metric })
    }
}
