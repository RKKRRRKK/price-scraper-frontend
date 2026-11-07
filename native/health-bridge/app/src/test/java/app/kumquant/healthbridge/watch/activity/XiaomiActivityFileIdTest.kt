package app.kumquant.healthbridge.watch.activity

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported from Gadgetbridge's XiaomiActivityFileIdTest. */
class XiaomiActivityFileIdTest {
    @Test
    fun encode() {
        // GB's constructor order is (ts, tz, type, subtype, detailType, version); this is type 3, subtype 1, detail 8
        val id = ActivityFileId(timestamp = 1697182497, timezone = 4, version = 0, type = 3, subtype = 1, detailType = 8)
        assertArrayEquals(T.hex("21F3286504008C"), id.toBytes())
    }

    @Test
    fun decode() {
        val id = ActivityFileId.fromBytes(T.hex("21F328650403A0"))
        assertEquals(1697182497L, id.timestamp)
        assertEquals(4, id.timezone)
        assertEquals(3, id.version)
        assertEquals(ActivityFileId.TYPE_SPORTS, id.type)
        assertEquals(ActivityFileId.SPORTS_FREESTYLE, id.subtype)
        assertEquals(ActivityFileId.DETAIL_DETAILS, id.detailType)
        assertEquals("SPORTS_FREESTYLE", id.subtypeName)
    }

    @Test
    fun decodeEncodeRoundTrip() {
        val bytes = T.hex("21F328650403A021F3286504008C")
        val ids = (0 until 2).map { ActivityFileId.fromBytes(bytes, it * ActivityFileId.SIZE) }
        assertArrayEquals(bytes, ids.map { it.toBytes() }.reduce { a, b -> a + b })
        assertEquals("21f328650403a0", ids[0].hex)
    }

    @Test
    fun zero() {
        val id = ActivityFileId.fromBytes(ByteArray(7))
        assertTrue(id.timestamp == 0L && id.version == 0)
    }

    @Test
    fun timezoneIsSigned() {
        // 0xF4 = -12 quarter hours, as in the manual samples vectors
        val id = ActivityFileId.fromBytes(T.hex("EFB9856AF4011800"))
        assertEquals(-12, id.timezone)
        assertEquals(ActivityFileId.TYPE_ACTIVITY, id.type)
        assertEquals(ActivityFileId.ACTIVITY_MANUAL_SAMPLES, id.subtype)
        assertEquals(ActivityFileId.DETAIL_DETAILS, id.detailType)
    }

    @Test
    fun fetchOrderPutsSummaryFirst() {
        fun order(detail: Int) = ActivityFileId(0, 0, 1, 1, 1, detail).fetchOrder
        assertTrue(order(ActivityFileId.DETAIL_SUMMARY) < order(ActivityFileId.DETAIL_DETAILS))
        assertTrue(order(ActivityFileId.DETAIL_DETAILS) < order(ActivityFileId.DETAIL_GPS_TRACK))
    }

    @Test(expected = IllegalArgumentException::class)
    fun tooShort() {
        ActivityFileId.fromBytes(ByteArray(6))
    }
}
