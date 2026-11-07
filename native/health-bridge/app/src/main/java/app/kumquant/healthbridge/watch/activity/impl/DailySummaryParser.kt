package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity
import java.nio.ByteBuffer

/** Every field of a daily summary; null where the file marked the slot invalid. */
internal data class DailySummary(
    var steps: Int? = null,
    var activeCalories: Int? = null,
    var hrResting: Int? = null,
    var hrMax: Int? = null,
    var hrMaxTs: Int? = null,
    var hrMin: Int? = null,
    var hrMinTs: Int? = null,
    var hrAvg: Int? = null,
    var stressAvg: Int? = null,
    var stressMax: Int? = null,
    var stressMin: Int? = null,
    var standing: Int? = null,
    var calories: Int? = null,
    var recoveryHours: Int? = null,
    var spo2Max: Int? = null,
    var spo2MaxTs: Int? = null,
    var spo2Min: Int? = null,
    var spo2MinTs: Int? = null,
    var spo2Avg: Int? = null,
    var trainingLoadDay: Int? = null,
    var trainingLoadWeek: Int? = null,
    var trainingLoadLevel: Int? = null,
    var vitalityIncreaseLight: Int? = null,
    var vitalityIncreaseModerate: Int? = null,
    var vitalityIncreaseHigh: Int? = null,
    var vitalityCurrent: Int? = null,
)

/**
 * Daily summary (ACTIVITY / ACTIVITY_DAILY / SUMMARY, versions 3-5). Ported from Gadgetbridge's
 * DailySummaryParser: a validity bitmap (MSB first) gates 21 slots (versions 3 and 4) or 32 slots (version 5);
 * a slot always consumes its bytes, only the value is gated.
 *
 * Emitted, as instants at the file id timestamp (one per day, overwritten on every re-sync): `resting_heart_rate`
 * when the slot is valid and above 0, and `pai` (the running PAI score, "vitality current"). The remaining
 * fields are sums or aggregates of the minute data and are not emitted.
 */
internal object DailySummaryParser {
    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val s = decode(id, data)
        val ts = id.timestamp * 1000L
        val out = ArrayList<SampleEntity>()
        s.hrResting?.let { if (validHeartRate(it)) out += instant(Metrics.RESTING_HEART_RATE, ts, it.toDouble()) }
        s.vitalityCurrent?.let { out += instant(Metrics.PAI, ts, it.toDouble()) }
        return ParsedActivity(out, emptyList())
    }

    fun decode(id: ActivityFileId, data: ByteArray): DailySummary {
        val (headerSize, slotCount) = when (id.version) {
            3, 4 -> 3 to 21
            5 -> 4 to 32
            else -> unsupportedVersion("daily summary", id.version)
        }
        val buf = littleEndian(data)
        buf.skipFileId()
        val header = ByteArray(headerSize)
        buf.get(header)

        val s = DailySummary()
        for (i in 0 until slotCount) readSlot(i, buf, s, validData(header, i))
        return s
    }

    private fun readSlot(slot: Int, b: ByteBuffer, s: DailySummary, v: Boolean) {
        when (slot) {
            0 -> b.getInt().let { if (v) s.steps = it }
            1 -> b.u16().let { if (v) s.activeCalories = it }
            2 -> b.get()
            3 -> b.u8().let { if (v) s.hrResting = it }
            4 -> b.u8().let { if (v) s.hrMax = it }
            5 -> b.getInt().let { if (v) s.hrMaxTs = it }
            6 -> b.u8().let { if (v) s.hrMin = it }
            7 -> b.getInt().let { if (v) s.hrMinTs = it }
            8 -> b.u8().let { if (v) s.hrAvg = it }
            9 -> b.u8().let { if (v) s.stressAvg = it }
            10 -> b.u8().let { if (v) s.stressMax = it }
            11 -> b.u8().let { if (v) s.stressMin = it }
            12 -> {
                // 24 bits, one per hour standing up, from 00:00
                val sb = ByteArray(3)
                b.get(sb)
                val packed = (sb[0].toInt() and 0xFF) or ((sb[1].toInt() and 0xFF) shl 8) or ((sb[2].toInt() and 0xFF) shl 16)
                if (v) s.standing = packed
            }
            13 -> b.u16().let { if (v) s.calories = it }
            14 -> b.u16().let { if (v) s.recoveryHours = it }
            15 -> b.get()
            16 -> b.u8().let { if (v) s.spo2Max = it }
            17 -> b.getInt().let { if (v) s.spo2MaxTs = it }
            18 -> b.u8().let { if (v) s.spo2Min = it }
            19 -> b.getInt().let { if (v) s.spo2MinTs = it }
            20 -> b.u8().let { if (v) s.spo2Avg = it }
            21 -> b.u16().let { if (v) s.trainingLoadDay = it }
            22 -> b.u16().let { if (v) s.trainingLoadWeek = it }
            23 -> b.u8().let { if (v) s.trainingLoadLevel = it }
            24 -> b.u8().let { if (v) s.vitalityIncreaseLight = it }
            25 -> b.u8().let { if (v) s.vitalityIncreaseModerate = it }
            26 -> b.u8().let { if (v) s.vitalityIncreaseHigh = it }
            27 -> b.u16().let { if (v) s.vitalityCurrent = it }
            28, 29 -> b.get()
            30, 31 -> b.getShort()
        }
    }
}
