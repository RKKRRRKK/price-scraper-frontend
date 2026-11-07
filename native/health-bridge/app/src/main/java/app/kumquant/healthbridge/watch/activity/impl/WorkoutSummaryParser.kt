package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SessionEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity
import org.json.JSONObject
import kotlin.math.roundToLong

/** The summary fields we keep; [OTHER] stands in for typed fields that are read to stay aligned but not used. */
internal enum class F {
    OTHER,
    TIME_START, TIME_END, ACTIVE_SECONDS, WORKOUT_TYPE,
    CALORIES_BURNT, CALORIES_TOTAL, DISTANCE_METERS, DISTANCE_METERS_CALIBRATED,
    PACE_AVG, PACE_MAX, PACE_MIN, SPEED_AVG, SPEED_MAX,
    STEPS, STROKES, STEP_RATE_AVG, STEP_RATE_MAX, CADENCE_AVG, CADENCE_MAX, STROKE_RATE_AVG, STROKE_RATE_MAX,
    HR_AVG, HR_MAX, HR_MIN,
    ELEVATION_GAIN, ELEVATION_LOSS,
    TRAINING_EFFECT_AEROBIC, TRAINING_EFFECT_ANAEROBIC, VO2MAX, RECOVERY_TIME, WORKOUT_LOAD, VITALITY_GAIN,
    HR_ZONE_EXTREME, HR_ZONE_ANAEROBIC, HR_ZONE_AEROBIC, HR_ZONE_FAT_BURN, HR_ZONE_WARM_UP,
}

/**
 * Workout summary (SPORTS / any subtype / SUMMARY). Ported from Gadgetbridge's WorkoutSummaryParser: one field
 * layout per subtype and version (see [parserFor]); an unknown subtype or version throws.
 *
 * Session: kind `exercise`, id `hb:exercise:<file id timestamp>`, start = the file id timestamp, end = the
 * summary's end time (start + active seconds if that is missing). `exerciseType` is a Health Connect
 * `EXERCISE_TYPE_*` int from [XiaomiSports]; `title` is the Xiaomi sport name only when Health Connect has no
 * exact match. `detailsJson` carries the Metrics.kt workout keys that are present (zero values are left out, as
 * Gadgetbridge does), plus `active_s`, `kcal_total`, `training_effect_anaerobic`, `max_cadence`, `max_speed_kmh`,
 * `best_pace_s_per_km`, `strokes` and `vitality_gain`.
 *
 * Also emits `vo2max` (instant at the workout end) when the summary has one.
 */
internal object WorkoutSummaryParser {
    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val parser = parserFor(id)
        val buf = littleEndian(data)
        buf.skipFileId()
        val v = parser.parse(buf)

        val startMs = id.timestamp * 1000L
        val active = (v[F.ACTIVE_SECONDS] ?: 0.0).toLong()
        val rawEnd = (v[F.TIME_END] ?: 0.0).toLong() and 0xFFFFFFFFL
        val endMs = when {
            rawEnd * 1000L > startMs -> rawEnd * 1000L
            active > 0 -> startMs + active * 1000L
            else -> startMs
        }

        val code = v[F.WORKOUT_TYPE]?.toInt()?.takeIf { it > 0 }
        val sport = code?.let { XiaomiSports.of(it) } ?: XiaomiSports.ofSubtype(id.subtype)
            ?: XiaomiSport(-1, "Workout", XiaomiSports.OTHER_WORKOUT, false)

        val details = details(v, sport)
        val session = SessionEntity(
            id = exerciseId(id.timestamp),
            kind = Metrics.KIND_EXERCISE,
            start = startMs,
            end = endMs,
            title = if (sport.exact) null else sport.name,
            exerciseType = sport.hcType,
            detailsJson = details.toString(),
        )
        val samples = v[F.VO2MAX]?.takeIf { it > 0 }?.let { listOf(instant(Metrics.VO2MAX, endMs, it)) } ?: emptyList()
        return ParsedActivity(samples, listOf(session))
    }

    fun exerciseId(timestampSec: Long) = "hb:exercise:$timestampSec"

    private fun details(v: Map<F, Double>, sport: XiaomiSport): JSONObject {
        val o = JSONObject()
        fun put(key: String, f: F) {
            val x = v[f] ?: return
            if (x != 0.0 && x.isFinite()) o.put(key, num(x))
        }
        if (sport.code > 0) o.put("xiaomi_type", sport.code)
        put("kcal", F.CALORIES_BURNT)
        put("kcal_total", F.CALORIES_TOTAL)
        put("active_s", F.ACTIVE_SECONDS)
        val calibrated = v[F.DISTANCE_METERS_CALIBRATED] ?: 0.0
        if (calibrated > 0) o.put("distance_m", num(calibrated)) else put("distance_m", F.DISTANCE_METERS)
        put("steps", F.STEPS)
        put("strokes", F.STROKES)
        put("avg_hr", F.HR_AVG)
        put("max_hr", F.HR_MAX)
        put("min_hr", F.HR_MIN)
        put("best_pace_s_per_km", F.PACE_MAX)
        put("max_speed_kmh", F.SPEED_MAX)
        put("elevation_gain_m", F.ELEVATION_GAIN)
        put("elevation_loss_m", F.ELEVATION_LOSS)
        put("vo2max", F.VO2MAX)
        put("training_load", F.WORKOUT_LOAD)
        put("training_effect_aerobic", F.TRAINING_EFFECT_AEROBIC)
        put("training_effect_anaerobic", F.TRAINING_EFFECT_ANAEROBIC)
        put("recovery_h", F.RECOVERY_TIME)
        put("vitality_gain", F.VITALITY_GAIN)

        // Cadence: steps per minute, or stroke rate for rowing
        val avgCadence = v[F.CADENCE_AVG] ?: v[F.STEP_RATE_AVG] ?: v[F.STROKE_RATE_AVG]
        val maxCadence = v[F.CADENCE_MAX] ?: v[F.STEP_RATE_MAX] ?: v[F.STROKE_RATE_MAX]
        if (avgCadence != null && avgCadence > 0) o.put("avg_cadence", num(avgCadence))
        if (maxCadence != null && maxCadence > 0) o.put("max_cadence", num(maxCadence))

        // Average pace and speed: the file's own, else derived from distance over active time
        val distance = (if (calibrated > 0) calibrated else v[F.DISTANCE_METERS]) ?: 0.0
        val active = v[F.ACTIVE_SECONDS] ?: 0.0
        val avgPace = v[F.PACE_AVG]?.takeIf { it > 0 }
            ?: if (distance >= 100 && active > 0 && isFootSport(sport.hcType)) active / (distance / 1000.0) else null
        if (avgPace != null) o.put("avg_pace_s_per_km", num(avgPace))
        val avgSpeed = v[F.SPEED_AVG]?.takeIf { it > 0 } ?: if (distance >= 100 && active > 0) distance / active * 3.6 else null
        if (avgSpeed != null) o.put("avg_speed_kmh", num(avgSpeed))

        val zones = listOf(
            "warmup" to v[F.HR_ZONE_WARM_UP], "fatburn" to v[F.HR_ZONE_FAT_BURN], "aerobic" to v[F.HR_ZONE_AEROBIC],
            "anaerobic" to v[F.HR_ZONE_ANAEROBIC], "extreme" to v[F.HR_ZONE_EXTREME],
        ).filter { it.second != null }
        if (zones.sumOf { it.second!! } > 0) {
            val z = JSONObject()
            for ((name, secs) in zones) z.put(name, num(secs!!))
            o.put("hr_zones_s", z)
        }
        return o
    }

    private fun isFootSport(hcType: Int) = hcType == 56 || hcType == 57 || hcType == 79 || hcType == 37

    /** Whole numbers as integers, others rounded to 2 decimals (float noise like 4.2000003 goes). */
    private fun num(x: Double): Any {
        val r = (x * 100).roundToLong() / 100.0
        return if (r == Math.floor(r) && Math.abs(r) < 1e15) r.toLong() else r
    }

    private class B(headerSize: Int) {
        private val b = SimpleParser.Builder<F>(headerSize)
        fun byte(k: F) = apply { b.byte(k) }
        fun short(k: F, mult: Double = 1.0) = apply { b.short(k, mult) }
        fun int(k: F) = apply { b.int(k) }
        fun float(k: F) = apply { b.float(k) }
        fun unknown(n: Int) = apply { b.unknown(n) }
        fun unknownIfPreviousByte(n: Int, p: (Int) -> Boolean) = apply { b.unknownIfPreviousByte(n, p) }
        fun zones() = apply {
            int(F.HR_ZONE_EXTREME).int(F.HR_ZONE_ANAEROBIC).int(F.HR_ZONE_AEROBIC).int(F.HR_ZONE_FAT_BURN).int(F.HR_ZONE_WARM_UP)
        }
        fun hr() = apply { byte(F.HR_AVG).byte(F.HR_MAX).byte(F.HR_MIN) }
        fun timesAndDuration() = apply { int(F.TIME_START).int(F.TIME_END).int(F.ACTIVE_SECONDS) }
        fun build() = b.build()
    }

    private fun parserFor(id: ActivityFileId): SimpleParser<F> {
        val version = id.version
        fun unsupported(): Nothing = fail("unsupported workout summary version $version for ${id.subtypeName}")
        return when (id.subtype) {
            ActivityFileId.SPORTS_OUTDOOR_WALKING_V1, ActivityFileId.SPORTS_OUTDOOR_RUNNING -> when (version) {
                3 -> outdoorV3(true)
                4 -> B(4).timesAndDuration()
                    .int(F.DISTANCE_METERS).int(F.CALORIES_BURNT).int(F.PACE_MAX).int(F.PACE_MIN)
                    .unknown(4).int(F.STEPS).unknown(2).hr().unknown(20)
                    .float(F.TRAINING_EFFECT_ANAEROBIC).unknown(9).byte(F.RECOVERY_TIME).unknown(2)
                    .zones().int(F.OTHER).build()
                else -> unsupported()
            }
            ActivityFileId.SPORTS_INDOOR_CYCLING -> {
                val header = when (version) { 8 -> 7; 9 -> 8; else -> unsupported() }
                B(header).timesAndDuration()
                    .unknown(4).short(F.CALORIES_BURNT).unknown(4).hr()
                    .float(F.TRAINING_EFFECT_AEROBIC).unknown(1).unknown(1).short(F.RECOVERY_TIME).zones()
                    .unknown(2).unknown(4).float(F.TRAINING_EFFECT_ANAEROBIC).unknown(3)
                    .int(F.OTHER).short(F.OTHER).short(F.OTHER) // time goal, calorie goal, max calorie goal
                    .unknown(28).short(F.WORKOUT_LOAD).unknown(24).byte(F.OTHER).unknown(13).build()
            }
            ActivityFileId.SPORTS_FREESTYLE -> freestyle(version)
            ActivityFileId.SPORTS_POOL_SWIMMING -> poolSwimming(version)
            ActivityFileId.SPORTS_HIIT -> {
                if (version != 5 && version != 6) unsupported()
                B(4).timesAndDuration().short(F.CALORIES_BURNT).hr()
                    .float(F.TRAINING_EFFECT_AEROBIC).unknown(1).unknown(1).short(F.RECOVERY_TIME).zones().build()
            }
            ActivityFileId.SPORTS_ELLIPTICAL -> elliptical(version)
            ActivityFileId.SPORTS_OUTDOOR_WALKING_V2 -> outdoorWalkingV2(version)
            ActivityFileId.SPORTS_OUTDOOR_CYCLING_V2 -> when (version) {
                3 -> outdoorV3(false)
                4 -> B(5).timesAndDuration()
                    .int(F.DISTANCE_METERS).short(F.CALORIES_BURNT).unknown(8).float(F.SPEED_MAX).hr().unknown(28)
                    .zones().unknown(18).unknown(2).unknown(6).build()
                else -> unsupported()
            }
            ActivityFileId.SPORTS_OUTDOOR_CYCLING -> outdoorCycling(version)
            ActivityFileId.SPORTS_TREADMILL -> treadmill(version)
            ActivityFileId.SPORTS_ROWING -> rowing(version)
            ActivityFileId.SPORTS_JUMP_ROPING -> jumpRoping(version)
            else -> fail("no workout summary parser for ${id.subtypeName}")
        }
    }

    private fun freestyle(version: Int): SimpleParser<F> {
        val header = when (version) {
            5 -> 3
            7 -> 5
            8, 9, 10 -> 6
            11 -> 7
            else -> fail("unsupported freestyle summary version $version")
        }
        val b = B(header).timesAndDuration().short(F.CALORIES_BURNT).hr()
        if (version > 5) b.unknown(6)
        b.float(F.TRAINING_EFFECT_AEROBIC)
        if (version > 6) b.unknown(1)
        b.unknown(1).short(F.RECOVERY_TIME).zones()
        if (version == 5) {
            b.unknown(10).short(F.WORKOUT_TYPE).unknown(2).int(F.OTHER).short(F.OTHER)
        } else if (version >= 11) {
            // Watch S5: 5 new bytes after the zones. Checked against a real file (total kcal above the burnt
            // kcal, the active seconds repeated, a sane anaerobic effect); what follows doesn't line up with
            // v10's goals / load / vitality, so it is left unread.
            b.unknown(5).short(F.CALORIES_TOTAL).unknown(4).float(F.TRAINING_EFFECT_ANAEROBIC)
        } else {
            b.short(F.CALORIES_TOTAL).unknown(4).float(F.TRAINING_EFFECT_ANAEROBIC).unknown(1)
                .short(F.WORKOUT_TYPE).unknown(2).int(F.OTHER).short(F.OTHER).short(F.WORKOUT_LOAD).unknown(1)
            if (version > 7) {
                b.byte(F.VITALITY_GAIN).short(F.OTHER).short(F.OTHER).short(F.OTHER).short(F.OTHER).unknown(7) // punches
            }
            if (version >= 10) {
                b.short(F.OTHER).short(F.OTHER).short(F.OTHER).unknown(1) // throws low / medium / high
            }
        }
        return b.build()
    }

    private fun poolSwimming(version: Int): SimpleParser<F> {
        val header = when (version) {
            6 -> 4
            7 -> 5
            8 -> 8
            else -> fail("unsupported pool swimming summary version $version")
        }
        val b = B(header).timesAndDuration().int(F.DISTANCE_METERS).short(F.CALORIES_BURNT)
        if (version >= 7) b.int(F.PACE_AVG)
        b.int(F.PACE_MAX).int(F.PACE_MIN).unknown(1).short(F.RECOVERY_TIME).short(F.STROKES)
            .byte(F.OTHER) // swim style
        if (version >= 7) b.byte(F.STROKE_RATE_AVG)
        b.byte(F.STROKE_RATE_MAX).short(F.OTHER).short(F.OTHER).short(F.OTHER).byte(F.OTHER) // laps, swolf avg / min, pool length
            .short(F.CALORIES_TOTAL).unknown(4)
            .int(F.OTHER).short(F.OTHER).int(F.OTHER).int(F.OTHER).short(F.OTHER) // goals
            .float(F.TRAINING_EFFECT_AEROBIC).unknown(1).float(F.TRAINING_EFFECT_ANAEROBIC).unknown(1)
            .short(F.WORKOUT_LOAD).unknown(1).byte(F.VITALITY_GAIN)
        return b.build()
    }

    private fun elliptical(version: Int): SimpleParser<F> {
        if (version !in 3..6) fail("unsupported elliptical summary version $version")
        val b = B(4).timesAndDuration().short(F.CALORIES_BURNT).int(F.STEPS)
        if (version >= 6) b.short(F.CADENCE_AVG)
        b.short(F.CADENCE_MAX).hr().float(F.TRAINING_EFFECT_AEROBIC)
        if (version >= 4) b.unknown(1)
        b.unknown(1).short(F.RECOVERY_TIME).zones()
        return b.build()
    }

    private fun rowing(version: Int): SimpleParser<F> {
        val header = when (version) {
            4 -> 4
            6, 7 -> 5
            8 -> 6
            else -> fail("unsupported rowing summary version $version")
        }
        val b = B(header).timesAndDuration().short(F.CALORIES_BURNT).hr()
        if (version >= 7) {
            b.float(F.TRAINING_EFFECT_AEROBIC).unknown(2).short(F.RECOVERY_TIME)
        } else {
            b.unknown(7)
            if (version > 4) b.unknown(1)
        }
        b.zones()
        if (version >= 8) b.unknown(5)
        if (version >= 7) b.short(F.CALORIES_TOTAL) else b.unknown(2)
        b.int(F.STROKES).int(F.STROKE_RATE_AVG)
        if (version >= 7) {
            b.int(F.STROKE_RATE_MAX).unknown(12).byte(F.OTHER).unknown(4)
                .float(F.TRAINING_EFFECT_ANAEROBIC).unknown(3)
                .int(F.OTHER).short(F.OTHER).short(F.OTHER).short(F.WORKOUT_LOAD).unknown(1).byte(F.VITALITY_GAIN)
        } else {
            b.unknown(4)
        }
        return b.build()
    }

    private fun treadmill(version: Int): SimpleParser<F> {
        val header = when (version) {
            5 -> 4
            9 -> 6
            10 -> 8
            11 -> 9
            else -> fail("unsupported treadmill summary version $version")
        }
        val b = B(header).timesAndDuration().int(F.DISTANCE_METERS).short(F.CALORIES_BURNT)
        if (version >= 10) b.int(F.PACE_AVG)
        b.int(F.PACE_MAX).int(F.PACE_MIN).int(F.STEPS)
        if (version >= 10) b.short(F.OTHER).short(F.CADENCE_AVG) // step length, average cadence
        b.short(F.CADENCE_MAX).hr().float(F.TRAINING_EFFECT_AEROBIC)
        if (version == 9) {
            b.unknown(4)
        } else {
            if (version >= 10) b.unknown(1)
            b.byte(F.VO2MAX)
            if (version >= 10) b.byte(F.OTHER) // VO2max level
            b.unknown(1)
        }
        b.short(F.RECOVERY_TIME).zones()
        if (version == 9) {
            b.unknown(39).short(F.WORKOUT_LOAD).unknown(7).byte(F.VITALITY_GAIN)
        }
        if (version >= 11) {
            b.short(F.CALORIES_TOTAL).unknown(4).float(F.TRAINING_EFFECT_ANAEROBIC).unknown(5)
                .int(F.OTHER).short(F.OTHER).int(F.OTHER).int(F.OTHER).float(F.OTHER).short(F.OTHER) // goals
                .int(F.DISTANCE_METERS_CALIBRATED).short(F.WORKOUT_LOAD).unknown(7)
                .short(F.OTHER).short(F.OTHER).short(F.OTHER).short(F.OTHER) // projected 5k, 10k, marathon, half
                .byte(F.VITALITY_GAIN).unknown(18).short(F.OTHER).short(F.OTHER).unknown(7)
        }
        return b.build()
    }

    private fun jumpRoping(version: Int): SimpleParser<F> {
        if (version != 3 && version != 5) fail("unsupported jump roping summary version $version")
        val b = B(5).timesAndDuration().short(F.CALORIES_BURNT).hr().float(F.TRAINING_EFFECT_AEROBIC)
        if (version == 3) b.unknown(3) else b.unknown(2).short(F.RECOVERY_TIME)
        b.zones().unknown(2).int(F.OTHER).short(F.OTHER).unknown(2).short(F.OTHER) // jumps, average and max rate
        if (version == 3) {
            b.unknown(43).unknown(2).unknown(2)
        } else {
            b.unknown(27).unknown(4).float(F.TRAINING_EFFECT_ANAEROBIC).unknown(3)
                .int(F.OTHER).short(F.OTHER).int(F.OTHER).short(F.WORKOUT_LOAD).unknown(1).byte(F.VITALITY_GAIN)
        }
        return b.build()
    }

    private fun outdoorV3(withSteps: Boolean): SimpleParser<F> {
        val b = B(4).timesAndDuration().int(F.DISTANCE_METERS).short(F.CALORIES_BURNT)
            .int(F.PACE_MAX).int(F.PACE_MIN).float(F.SPEED_MAX)
        if (withSteps) b.int(F.STEPS).short(F.CADENCE_MAX)
        b.hr().float(F.ELEVATION_GAIN).float(F.ELEVATION_LOSS)
            .float(F.OTHER).float(F.OTHER).float(F.OTHER) // altitude avg / max / min
            .float(F.TRAINING_EFFECT_AEROBIC).byte(F.VO2MAX).unknown(1).short(F.RECOVERY_TIME).zones()
            .short(F.CALORIES_TOTAL).unknown(4).float(F.TRAINING_EFFECT_ANAEROBIC)
        return b.build()
    }

    private fun outdoorCycling(version: Int): SimpleParser<F> {
        val header = when (version) {
            4, 5 -> 6
            6 -> 7
            8 -> 8
            else -> fail("unsupported outdoor cycling summary version $version")
        }
        val b = B(header).short(F.WORKOUT_TYPE).int(F.TIME_START).int(F.TIME_END).int(F.ACTIVE_SECONDS).unknown(4)
            .int(F.DISTANCE_METERS).short(F.CALORIES_TOTAL).short(F.CALORIES_BURNT).int(F.PACE_MAX).int(F.PACE_MIN)
        if (version >= 5) b.float(F.SPEED_AVG)
        b.float(F.SPEED_MAX).hr().float(F.ELEVATION_GAIN).float(F.ELEVATION_LOSS)
            .float(F.OTHER).float(F.OTHER).float(F.OTHER) // altitude avg / max / min
            .float(F.TRAINING_EFFECT_AEROBIC).unknown(1).float(F.TRAINING_EFFECT_ANAEROBIC).unknown(1)
        if (version >= 7) b.unknown(5)
        b.byte(F.VO2MAX).unknown(1).unknown(1).short(F.RECOVERY_TIME).unknown(1).zones()
        if (version >= 6) {
            if (version >= 7) b.unknown(5)
            b.int(F.OTHER).short(F.OTHER).int(F.OTHER).float(F.OTHER) // time, calorie, distance and speed goals
                .unknown(1) // route byte: 0xFC, 0xFD or 0xFF when the ride follows a route, then 8 more bytes
                .unknownIfPreviousByte(8) { it == 0xFC || it == 0xFD || it == 0xFF }
                .short(F.WORKOUT_LOAD).unknown(15).byte(F.VITALITY_GAIN).unknown(5)
            if (version >= 7) b.unknown(2)
            if (version >= 8) b.unknown(1)
        }
        return b.build()
    }

    private fun outdoorWalkingV2(version: Int): SimpleParser<F> {
        val header = when (version) {
            1 -> 5
            2 -> 6
            4 -> 7
            5, 6 -> 9
            9 -> 13
            else -> fail("unsupported outdoor walking/running v2 summary version $version")
        }
        val b = B(header).short(F.WORKOUT_TYPE).timesAndDuration().unknown(4) // valid duration, paused time excluded
            .int(F.DISTANCE_METERS).short(F.CALORIES_TOTAL).short(F.CALORIES_BURNT)
        if (version >= 5) b.int(F.PACE_AVG)
        b.int(F.PACE_MAX).int(F.PACE_MIN)
        if (version >= 5) b.float(F.SPEED_AVG)
        b.float(F.SPEED_MAX).int(F.STEPS)
        if (version >= 5) b.short(F.OTHER).short(F.STEP_RATE_AVG) // step length, average step rate
        b.short(F.STEP_RATE_MAX).hr().unknown(20).float(F.TRAINING_EFFECT_AEROBIC)
        if (version == 1) {
            b.unknown(9)
        } else {
            b.unknown(1).float(F.TRAINING_EFFECT_ANAEROBIC)
            if (version >= 9) b.unknown(6) else b.unknown(1)
            b.byte(F.VO2MAX).unknown(2).short(F.RECOVERY_TIME).unknown(1)
        }
        b.zones()
        if (version == 6) {
            b.int(F.OTHER).short(F.OTHER).int(F.OTHER).int(F.OTHER).float(F.OTHER).short(F.OTHER) // goals
                .unknown(1).short(F.WORKOUT_LOAD).unknown(7)
                .short(F.OTHER).short(F.OTHER).short(F.OTHER).short(F.OTHER) // projected times
                .byte(F.VITALITY_GAIN).unknown(18).short(F.OTHER).short(F.OTHER).unknown(7)
        }
        if (version >= 9) {
            b.unknown(46).short(F.WORKOUT_LOAD).unknown(15).short(F.OTHER).unknown(17) // active score after the load
                .short(F.OTHER).short(F.OTHER).unknown(6) // ground contact times
                .short(F.OTHER).short(F.OTHER).short(F.OTHER).short(F.OTHER).short(F.OTHER) // vertical ratio / oscillation
        }
        return b.build()
    }
}
