package app.kumquant.healthbridge.legacy

import androidx.health.connect.client.permission.HealthPermission
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
import kotlin.reflect.KClass

/**
 * Every Health Connect type the bridge reads (keep in step with the manifest).
 * Mi Fitness only writes some of them; the rest simply stay empty.
 */
val RECORD_TYPES: Set<KClass<out Record>> = setOf(
    StepsRecord::class,
    HeartRateRecord::class,
    RestingHeartRateRecord::class,
    OxygenSaturationRecord::class,
    HeartRateVariabilityRmssdRecord::class,
    RespiratoryRateRecord::class,
    ActiveCaloriesBurnedRecord::class,
    TotalCaloriesBurnedRecord::class,
    DistanceRecord::class,
    FloorsClimbedRecord::class,
    WeightRecord::class,
    Vo2MaxRecord::class,
    SleepSessionRecord::class,
    ExerciseSessionRecord::class,
)

/** Lets the periodic worker read while the app is closed (Health Connect 2024+). */
const val PERMISSION_BACKGROUND = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"

val READ_PERMISSIONS: Set<String> = RECORD_TYPES.map { HealthPermission.getReadPermission(it) }.toSet()

val ALL_PERMISSIONS: Set<String> = READ_PERMISSIONS + PERMISSION_BACKGROUND
