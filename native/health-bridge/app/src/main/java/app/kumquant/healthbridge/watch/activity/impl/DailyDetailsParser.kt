package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity

/**
 * Per-minute daily details (ACTIVITY / ACTIVITY_DAILY / DETAILS, versions 1-4). Ported from
 * Gadgetbridge's DailyDetailsParser. The first record sits at the file id timestamp (epoch s, UTC) and every
 * following record is one minute later.
 *
 * Emitted per minute: `steps`, `active_kcal`, `distance_m` (intervals, only when above 0, so an idle minute
 * writes nothing) and the instants `heart_rate`, `body_energy`, `spo2`, `stress`. Not-measured readings
 * (group absent, heart rate 0 or 255, SpO2 0, stress 0 or 255, energy 0) are skipped, as Gadgetbridge's
 * sample providers do.
 */
internal object DailyDetailsParser {
    private const val MINUTE_MS = 60_000L

    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val version = id.version
        val headerSize = when (version) {
            1, 2 -> 4
            3 -> 5
            4 -> 6
            else -> unsupportedVersion("daily details", version)
        }

        val buf = littleEndian(data).dropCrc()
        buf.skipFileId()
        val header = ByteArray(headerSize)
        buf.get(header)

        val groups = ComplexGroupReader(header, buf)
        val out = ArrayList<SampleEntity>()
        var start = id.timestamp * 1000L

        while (buf.hasRemaining()) {
            groups.reset()
            val end = start + MINUTE_MS

            var includeExtraEntry = 0
            var steps = 0
            var activeKcal = -1
            var distanceM = -1
            var heartRate = 0
            var energy = -1
            var spo2 = 0
            var stress = 0

            if (groups.nextGroup(16)) {
                if (groups.hasSecond()) includeExtraEntry = groups.get(1, 1)
                if (groups.hasThird()) steps = groups.get(2, 14)
            }
            if (groups.nextGroup(8)) {
                if (groups.hasSecond()) activeKcal = groups.get(2, 6)
            }
            groups.nextGroup(8)
            if (groups.nextGroup(16)) {
                if (groups.hasFirst()) distanceM = groups.get(0, 16)
            }
            if (groups.nextGroup(8)) {
                if (groups.hasFirst()) heartRate = groups.get(0, 8)
            }
            if (groups.nextGroup(8)) {
                if (groups.hasFirst()) energy = groups.get(0, 8)
            }
            groups.nextGroup(16)
            if (version >= 3) {
                if (groups.nextGroup(8)) {
                    if (groups.hasFirst()) spo2 = groups.get(0, 8)
                }
                if (groups.nextGroup(8)) {
                    if (groups.hasFirst()) stress = groups.get(0, 8)
                }
            }
            if (includeExtraEntry == 1) buf.get() // a byte is always present then, see Gadgetbridge #4625
            if (version >= 4) {
                groups.nextGroup(16) // light value
                groups.nextGroup(16) // body momentum
            }

            if (steps > 0) out += interval(Metrics.STEPS, start, end, steps.toDouble())
            if (activeKcal > 0) out += interval(Metrics.ACTIVE_KCAL, start, end, activeKcal.toDouble())
            if (distanceM > 0) out += interval(Metrics.DISTANCE_M, start, end, distanceM.toDouble())
            if (validHeartRate(heartRate)) out += instant(Metrics.HEART_RATE, start, heartRate.toDouble())
            if (energy in 1..100) out += instant(Metrics.BODY_ENERGY, start, energy.toDouble())
            if (spo2 in 1..100) out += instant(Metrics.SPO2, start, spo2.toDouble())
            if (stress in 1..100) out += instant(Metrics.STRESS, start, stress.toDouble())

            start = end
        }
        return ParsedActivity(out, emptyList())
    }
}
