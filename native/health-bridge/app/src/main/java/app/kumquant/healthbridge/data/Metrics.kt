package app.kumquant.healthbridge.data

/**
 * Metric names shared by the watch parsers, the scale, the phone screens, the
 * uploader and the web dashboard (`health_samples.metric`). Free text on the
 * server, so a new one needs no schema change, but add it here first.
 *
 * WORKOUT DETAILS (SessionEntity.detailsJson for kind = "exercise"), every field optional:
 * {
 *   "xiaomi_type": 1,                 // the watch's own sport id
 *   "kcal": 312, "distance_m": 5200, "steps": 6100,
 *   "avg_hr": 142, "max_hr": 171, "min_hr": 92,
 *   "avg_pace_s_per_km": 345, "avg_speed_kmh": 10.4, "avg_cadence": 168,
 *   "elevation_gain_m": 40, "elevation_loss_m": 38,
 *   "vo2max": 47, "training_load": 120, "training_effect_aerobic": 3.1, "recovery_h": 18,
 *   "hr_zones_s": { "warmup": 60, "fatburn": 300, "aerobic": 900, "anaerobic": 400, "extreme": 30 },
 *   "hr": [[epochSeconds, bpm], ...],                 // per-sample curve from the workout details file
 *   "gps": [[epochSeconds, lat, lon, altM|null], ...] // when the workout recorded GPS
 * }
 */
object Metrics {
    /** `health_samples.source` / `health_sessions.source` for everything Health Bridge v2 produces. */
    const val SOURCE = "healthbridge"

    // Watch: per-minute series from the daily-details activity file
    const val HEART_RATE = "heart_rate"          // bpm, instant
    const val STEPS = "steps"                    // count, interval
    const val ACTIVE_KCAL = "active_kcal"        // kcal, interval
    const val DISTANCE_M = "distance_m"          // metres, interval
    const val SPO2 = "spo2"                      // %, instant
    const val STRESS = "stress"                  // 0–100, instant
    const val BODY_ENERGY = "body_energy"        // 0–100 ("Energy" on the watch), instant

    // Watch: daily summary / manual measurements / workouts
    const val RESTING_HEART_RATE = "resting_heart_rate" // bpm, instant (one per day)
    const val PAI = "pai"                        // PAI score, instant (one per day)
    const val VO2MAX = "vo2max"                  // ml/kg/min, instant
    const val SKIN_TEMP_C = "skin_temp_c"        // °C, instant
    const val HRV_RMSSD = "hrv_rmssd"            // ms, instant (only if the watch provides it)
    const val RESPIRATORY_RATE = "respiratory_rate" // breaths/min, instant (only if provided)

    // Scale (Mi Body Composition Scale 2), one point per weigh-in
    const val WEIGHT_KG = "weight_kg"
    const val BODY_FAT_PCT = "body_fat_pct"
    const val MUSCLE_KG = "muscle_kg"
    const val WATER_PCT = "water_pct"
    const val BONE_KG = "bone_kg"
    const val VISCERAL_FAT = "visceral_fat"
    const val BMR_KCAL = "bmr_kcal"
    const val BMI = "bmi"
    const val IMPEDANCE = "impedance"           // ohms

    val SCALE = listOf(WEIGHT_KG, BODY_FAT_PCT, MUSCLE_KG, WATER_PCT, BONE_KG, VISCERAL_FAT, BMR_KCAL, BMI, IMPEDANCE)

    // Session kinds
    const val KIND_SLEEP = "sleep"
    const val KIND_EXERCISE = "exercise"

    // Sleep stage names in stagesJson (same as the Health Connect path used)
    const val STAGE_AWAKE = "awake"
    const val STAGE_LIGHT = "light"
    const val STAGE_DEEP = "deep"
    const val STAGE_REM = "rem"
}
