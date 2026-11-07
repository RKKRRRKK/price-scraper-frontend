package app.kumquant.healthbridge.legacy

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Turns Health Connect records into the JSON health_ingest() takes
 * (see supabase/health_schema.sql for the shape).
 */
object Payload {

    /** A numeric record → { id, metric, source, points: [[start, end|null, value]] }, or null. */
    fun sample(record: Record): JSONObject? = when (record) {
        is StepsRecord -> sample(record, "steps", listOf(Triple(record.startTime, record.endTime, record.count.toDouble())))
        is HeartRateRecord -> sample(record, "heart_rate", record.samples.map { Triple(it.time, null, it.beatsPerMinute.toDouble()) })
        is RestingHeartRateRecord -> sample(record, "resting_heart_rate", listOf(Triple(record.time, null, record.beatsPerMinute.toDouble())))
        is OxygenSaturationRecord -> sample(record, "spo2", listOf(Triple(record.time, null, record.percentage.value)))
        is HeartRateVariabilityRmssdRecord -> sample(record, "hrv_rmssd", listOf(Triple(record.time, null, record.heartRateVariabilityMillis)))
        is RespiratoryRateRecord -> sample(record, "respiratory_rate", listOf(Triple(record.time, null, record.rate)))
        is ActiveCaloriesBurnedRecord -> sample(record, "active_kcal", listOf(Triple(record.startTime, record.endTime, record.energy.inKilocalories)))
        is TotalCaloriesBurnedRecord -> sample(record, "total_kcal", listOf(Triple(record.startTime, record.endTime, record.energy.inKilocalories)))
        is DistanceRecord -> sample(record, "distance_m", listOf(Triple(record.startTime, record.endTime, record.distance.inMeters)))
        is FloorsClimbedRecord -> sample(record, "floors", listOf(Triple(record.startTime, record.endTime, record.floors)))
        is WeightRecord -> sample(record, "weight_kg", listOf(Triple(record.time, null, record.weight.inKilograms)))
        is Vo2MaxRecord -> sample(record, "vo2max", listOf(Triple(record.time, null, record.vo2MillilitersPerMinuteKilogram)))
        else -> null
    }

    /** A sleep or exercise record → { id, kind, source, start, end, title, ... }, or null. */
    fun session(record: Record): JSONObject? = when (record) {
        is SleepSessionRecord -> base(record, "sleep", record.startTime, record.endTime, record.title)
            .put("stages", JSONArray(record.stages.map {
                JSONObject()
                    .put("stage", stageName(it.stage))
                    .put("start", it.startTime.toString())
                    .put("end", it.endTime.toString())
            }))
        is ExerciseSessionRecord -> base(record, "exercise", record.startTime, record.endTime, record.title)
            .put("exercise_type", record.exerciseType)
        else -> null
    }

    private fun sample(record: Record, metric: String, points: List<Triple<Instant, Instant?, Double>>) =
        JSONObject()
            .put("id", record.metadata.id)
            .put("metric", metric)
            .put("source", record.metadata.dataOrigin.packageName)
            .put("points", JSONArray(points.map { (start, end, value) ->
                JSONArray().put(start.toString()).put(end?.toString() ?: JSONObject.NULL).put(value)
            }))

    private fun base(record: Record, kind: String, start: Instant, end: Instant, title: String?) =
        JSONObject()
            .put("id", record.metadata.id)
            .put("kind", kind)
            .put("source", record.metadata.dataOrigin.packageName)
            .put("start", start.toString())
            .put("end", end.toString())
            .put("title", title ?: JSONObject.NULL)

    private fun stageName(stage: Int) = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awake_in_bed"
        else -> "unknown"
    }
}
