package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity

/**
 * Manual measurements (ACTIVITY / ACTIVITY_MANUAL_SAMPLES / DETAILS, versions 1 and 2): readings the wearer
 * triggered on the watch. Ported from Gadgetbridge's ManualSamplesParser.
 *
 * Emitted as instants: `heart_rate` (type 0x11), `spo2` (0x12), `stress` (0x13) and `skin_temp_c` (0x44, the low
 * 16 bits in 0.01 degC; the high half is a body temperature that is always 0). Zero values are skipped.
 * Version 1 (Mi Band 9 Active) uses types 2 (SpO2) and 3 (stress) and rejects the whole file on anything odd.
 */
internal object ManualSamplesParser {
    const val TYPE_HR = 0x11
    const val TYPE_SPO2 = 0x12
    const val TYPE_STRESS = 0x13
    const val TYPE_TEMPERATURE = 0x44

    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity = when (id.version) {
        1 -> ParsedActivity(decodeVersion1(data), emptyList())
        2 -> ParsedActivity(decodeVersion2(data), emptyList())
        else -> unsupportedVersion("manual samples", id.version)
    }

    private fun decodeVersion1(data: ByteArray): List<SampleEntity> {
        // 7 id bytes, a padding byte, a 0xff header, 6-byte samples (u32 ts, type, value) and the CRC
        if (data.size < 19) fail("manual samples v1 too short: ${data.size} bytes")
        val buf = littleEndian(data).dropCrc()
        buf.skip(7)
        if (buf.get().toInt() != 0) fail("manual samples v1: expected 0 padding after the file id")
        val header = buf.u8()
        if (header != 0xFF) fail("manual samples v1: unexpected header $header")
        if (buf.remaining() == 0 || buf.remaining() % 6 != 0) fail("manual samples v1: payload of ${buf.remaining()} bytes")

        val out = ArrayList<SampleEntity>()
        while (buf.hasRemaining()) {
            val ts = buf.getInt().toLong() and 0xFFFFFFFFL
            val type = buf.u8()
            val value = buf.u8()
            val metric = when (type) {
                0x02 -> Metrics.SPO2
                0x03 -> Metrics.STRESS
                else -> fail("manual samples v1: unknown type $type")
            }
            if (value == 0 || value > 100) fail("manual samples v1: invalid value $value for type $type")
            out += instant(metric, ts * 1000L, value.toDouble())
        }
        return out
    }

    private fun decodeVersion2(data: ByteArray): List<SampleEntity> {
        val buf = littleEndian(data).dropCrc()
        buf.skipFileId()
        // No header: samples start right away. The type byte really is two nibbles (length + type), see
        // Gadgetbridge issue 3517; only the types seen so far are known.
        val out = ArrayList<SampleEntity>()
        while (buf.hasRemaining()) {
            val ts = buf.getInt().toLong() and 0xFFFFFFFFL
            val type = buf.u8()
            val value = when (type) {
                TYPE_HR, TYPE_SPO2, TYPE_STRESS -> buf.u8()
                TYPE_TEMPERATURE -> buf.getInt()
                else -> fail("manual samples: unknown sample type 0x${"%02x".format(type)} at offset ${buf.position() - 1}, size unknown")
            }
            if (value == 0) continue
            val start = ts * 1000L
            when (type) {
                TYPE_HR -> if (validHeartRate(value)) out += instant(Metrics.HEART_RATE, start, value.toDouble())
                TYPE_SPO2 -> if (value in 1..100) out += instant(Metrics.SPO2, start, value.toDouble())
                TYPE_STRESS -> if (value in 1..100) out += instant(Metrics.STRESS, start, value.toDouble())
                TYPE_TEMPERATURE -> {
                    val celsius = (value and 0xFFFF) / 100.0
                    if (celsius > 0 && celsius <= 60) out += instant(Metrics.SKIN_TEMP_C, start, celsius)
                }
            }
        }
        return out
    }
}
