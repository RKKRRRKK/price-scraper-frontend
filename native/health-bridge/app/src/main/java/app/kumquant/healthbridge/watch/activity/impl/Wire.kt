package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.watch.activity.ActivityParseException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Shared byte plumbing for the activity parsers. */

internal fun fail(message: String): Nothing = throw ActivityParseException(message)

internal fun littleEndian(bytes: ByteArray): ByteBuffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

internal fun ByteBuffer.u8(): Int = get().toInt() and 0xFF
internal fun ByteBuffer.u16(): Int = getShort().toInt() and 0xFFFF
internal fun ByteBuffer.skip(n: Int) { position(position() + n) }

/** Skips the 7 file id bytes and the padding byte that follows them. */
internal fun ByteBuffer.skipFileId() {
    if (remaining() < 8) fail("file shorter than its id and padding (${remaining()} bytes)")
    skip(8)
}

/** Drops the trailing CRC32 from the readable range. */
internal fun ByteBuffer.dropCrc(): ByteBuffer {
    if (limit() < position() + 4) fail("file shorter than its CRC")
    limit(limit() - 4)
    return this
}

/** MSB-first validity bit [i] of a header bitmap, as Gadgetbridge's XiaomiActivityParser.validData. */
internal fun validData(header: ByteArray, i: Int): Boolean =
    (header[i / 8].toInt() and (1 shl (7 - (i % 8)))) != 0

internal fun unsupportedVersion(what: String, version: Int): Nothing =
    fail("unsupported $what version $version")

/** Port of Gadgetbridge's XiaomiComplexActivityParser: a nibble per group says which of its (up to 3) values exist. */
internal class ComplexGroupReader(private val header: ByteArray, private val buf: ByteBuffer) {
    private var currentGroup = -1
    private var currentGroupBits = 0
    private var currentVal = 0

    fun reset() {
        currentGroup = -1
        currentGroupBits = 0
        currentVal = 0
    }

    /** Starts the next group of [nBits] bits; false when the group is absent (nothing is consumed then). */
    fun nextGroup(nBits: Int): Boolean {
        currentGroup++
        if (currentGroup >= header.size * 2) {
            // Header too small: consume so the buffer still advances, as Gadgetbridge does
            consume(nBits)
            return false
        }
        if ((nibble() and 8) == 0) return false
        currentGroupBits = nBits
        currentVal = consume(nBits)
        return (nibble() and 8) != 0
    }

    private fun consume(nBits: Int): Int = when (nBits) {
        8 -> buf.u8()
        16 -> buf.u16()
        32 -> buf.getInt()
        else -> throw IllegalArgumentException("Unsupported number of bits $nBits")
    }

    private fun nibble(): Int {
        val b = header[currentGroup / 2].toInt()
        return if (currentGroup % 2 == 0) (b and 0xF0) shr 4 else b and 0x0F
    }

    fun hasFirst() = isValid(0)
    fun hasSecond() = isValid(1)
    fun hasThird() = isValid(2)

    fun isValid(idx: Int): Boolean {
        require(idx in 0..2) { "Invalid idx $idx" }
        return (nibble() and (1 shl (2 - idx))) != 0
    }

    fun get(idx: Int, nBits: Int): Int {
        val shift = currentGroupBits - idx - nBits
        return (currentVal and (((1 shl nBits) - 1) shl shift)) ushr shift
    }
}

/** One field of a [SimpleParser]: [key] null means skipped bytes. */
internal class SimpleField<K : Any>(val key: K?, val multiplier: Double = 1.0, val read: (ByteBuffer) -> Number?) {
    fun get(buf: ByteBuffer): Number? {
        val value = read(buf) ?: return null
        return if (multiplier != 1.0) value.toDouble() * multiplier else value
    }
}

/**
 * Port of Gadgetbridge's XiaomiSimpleActivityParser. A header bitmap of [headerSize] bytes is followed by
 * fixed-size fields in order. Gadgetbridge ignores the validity bits (the field sizes are not all known),
 * and so do we.
 */
internal class SimpleParser<K : Any>(private val headerSize: Int, private val fields: List<SimpleField<K>>) {
    fun parse(buf: ByteBuffer): Map<K, Double> {
        val header = ByteArray(headerSize)
        buf.get(header)
        val out = LinkedHashMap<K, Double>()
        for (field in fields) {
            val value = field.get(buf) ?: continue
            val key = field.key ?: continue
            out[key] = value.toDouble()
        }
        return out
    }

    class Builder<K : Any>(private val headerSize: Int) {
        private val fields = mutableListOf<SimpleField<K>>()

        fun byte(key: K) = apply { fields += SimpleField(key) { it.u8() } }
        fun short(key: K, multiplier: Double = 1.0) = apply { fields += SimpleField(key, multiplier) { it.getShort() } }
        fun int(key: K) = apply { fields += SimpleField(key) { it.getInt() } }
        fun float(key: K) = apply { fields += SimpleField(key) { it.getFloat() } }
        fun unknown(size: Int) = apply { fields += SimpleField<K>(null) { it.skip(size); null } }

        /** Skips [size] bytes only when the byte read just before this entry satisfies [present]. */
        fun unknownIfPreviousByte(size: Int, present: (Int) -> Boolean) = apply {
            fields += SimpleField<K>(null) {
                if (present(it.get(it.position() - 1).toInt() and 0xFF)) it.skip(size)
                null
            }
        }

        fun build() = SimpleParser(headerSize, fields.toList())
    }
}

internal fun instant(metric: String, startMs: Long, value: Double) = SampleEntity(metric, startMs, null, value)

internal fun interval(metric: String, startMs: Long, endMs: Long, value: Double) =
    SampleEntity(metric, startMs, endMs, value)

/** Heart rate the watch could not measure is 0 or 255; anything else is a reading. */
internal fun validHeartRate(bpm: Int) = bpm in 1..254

