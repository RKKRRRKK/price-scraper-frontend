package app.kumquant.healthbridge.scale

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Xiaomi's body-composition regression for the Mi Body Composition Scale 2, from weight, one
 * impedance value, height, age and sex. Ported from openScale's MiScaleLib.kt (itself from
 * prototux/MIBCS-reverse-engineering) plus the Zepp Life visceral-fat formula from its
 * BodyMiScaleLib.kt and Xiaomi's BMR. Fat, water, bone, muscle, BMI, BMR and visceral fat match
 * Zepp Life's own values for the same weigh-in. Same numbers as `watchlab/bodycomp.py`.
 */
class MiScaleLib(sex: Sex, private val age: Int, private val heightCm: Double) {
    private val male = sex == Sex.MALE

    private fun lbmCoefficient(weight: Double, impedance: Double): Double {
        var lbm = (heightCm * 9.058 / 100.0) * (heightCm / 100.0)
        lbm += weight * 0.32 + 12.226
        lbm -= impedance * 0.0068
        lbm -= age * 0.0542
        return lbm
    }

    fun bmi(weight: Double): Double = weight / (((heightCm * heightCm) / 100.0) / 100.0)

    fun lbm(weight: Double, impedance: Double): Double {
        val lbm = weight - (bodyFat(weight, impedance) * 0.01 * weight) - boneMass(weight, impedance)
        return if ((!male && lbm >= 84.0) || (male && lbm >= 93.5)) 120.0 else lbm
    }

    /** openScale's current "muscle": Janssen BIA skeletal muscle as % of weight, clamped 10..60. */
    fun skeletalMusclePct(weight: Double, impedance: Double): Double {
        if (weight <= 0.0) return 0.0
        val smm = if (impedance > 0.0) {
            0.401 * (heightCm * heightCm) / impedance + (if (male) 3.825 else 0.0) - 0.071 * age + 5.102
        } else {
            lbm(weight, impedance) * (if (male) 0.52 else 0.46)
        }
        return (smm / weight * 100.0).coerceIn(10.0, 60.0)
    }

    fun water(weight: Double, impedance: Double): Double {
        val water = (100.0 - bodyFat(weight, impedance)) * 0.7
        return (if (water < 50.0) 1.02 else 0.98) * water
    }

    fun boneMass(weight: Double, impedance: Double): Double {
        val base = if (male) 0.18016894 else 0.245691014
        var bone = (base - lbmCoefficient(weight, impedance) * 0.05158) * -1.0
        bone = if (bone > 2.2) bone + 0.1 else bone - 0.1
        if ((!male && bone > 5.1) || (male && bone > 5.2)) bone = 8.0
        return bone
    }

    /** openScale's MiScaleLib version; its female low-weight branch is wrong. [BodyComposition.compose] uses [visceralFatZepp]. */
    fun visceralFat(weight: Double): Double {
        val h = heightCm
        if (!male) {
            if (weight > (13.0 - h * 0.5) * -1.0) {
                val sub = ((h * 1.45) + (h * 0.1158) * h) - 120.0
                return (weight * 500.0 / sub - 6.0) + age * 0.07
            }
            val sub = 0.691 + h * -0.0024 + h * -0.0024
            return ((h * 0.027 - sub * weight) * -1.0) + age * 0.07 - age
        }
        if (h < weight * 1.6) {
            val sub = ((h * 0.4) - (h * (h * 0.0826))) * -1.0
            return (weight * 305.0 / (sub + 48.0)) - 2.9 + age * 0.15
        }
        val sub = 0.765 + h * -0.0015
        return ((h * 0.143 - weight * sub) * -1.0) + age * 0.15 - 5.0
    }

    /** Zepp Life visceral fat (openScale BodyMiScaleLib), clamped to 1..50; Zepp shows it rounded down. */
    fun visceralFatZepp(weight: Double): Double = Math.floor(visceralFatZeppRaw(weight))

    private fun visceralFatZeppRaw(weight: Double): Double {
        val h = heightCm
        val w = weight
        val v = if (male) {
            if (h < w * 1.6 + 63.0) age * 0.15 + ((w * 305.0) / ((h * 0.0826 * h - h * 0.4) + 48.0) - 2.9)
            else age * 0.15 + (w * (h * -0.0015 + 0.765) - h * 0.143) - 5.0
        } else {
            if (w <= h * 0.5 - 13.0) age * 0.07 + (w * (h * -0.0024 + 0.691) - h * 0.027) - 10.5
            else age * 0.07 + ((w * 500.0) / ((h * 1.45 + h * 0.1158 * h) - 120.0) - 6.0)
        }
        return v.coerceIn(1.0, 50.0)
    }

    fun bodyFat(weight: Double, impedance: Double): Double {
        var lbmSub = 0.8
        if (!male && age <= 49) lbmSub = 9.25 else if (!male) lbmSub = 7.25
        var coeff = 1.0
        if (male && weight < 61.0) {
            coeff = 0.98
        } else if (!male && weight > 60.0) {
            coeff = 0.96 * (if (heightCm > 160.0) 1.03 else 1.0)
        } else if (!male && weight < 50.0) {
            coeff = 1.02 * (if (heightCm > 160.0) 1.03 else 1.0)
        }
        val fat = (1.0 - (((lbmCoefficient(weight, impedance) - lbmSub) * coeff) / weight)) * 100.0
        return if (fat > 63.0) 75.0 else fat
    }

    /**
     * Xiaomi's BMR (MIBCS), kcal/day, clamped 500..10000. Matches every one of the user's Zepp Life
     * weigh-ins to within 2 kcal (checked against their 2024-2026 export).
     */
    fun bmr(weight: Double): Double {
        val bmr = if (male) 877.8 + weight * 14.916 - heightCm * 0.726 - age * 8.976
        else 864.6 + weight * 10.2036 - heightCm * 0.39336 - age * 6.204
        return bmr.coerceIn(500.0, 10000.0)
    }
}

/** What the scale reports. Impedance-derived fields are null without a usable impedance. */
data class Composition(
    val bmi: Double,
    val bmrKcal: Double,
    val visceralFat: Double,
    val bodyFatPct: Double? = null,
    val waterPct: Double? = null,
    val boneKg: Double? = null,
    /** Weight - fat - bone: the Mi Fit / Zepp Life "muscle mass". */
    val muscleKg: Double? = null,
)

object BodyComposition {
    /** A plausible adult body is a few hundred ohms; outside this the reading is a bad contact. */
    val IMPEDANCE_RANGE = 50..3000

    fun ageOn(birth: LocalDate, day: LocalDate): Int = ChronoUnit.YEARS.between(birth, day).toInt()

    fun compose(weightKg: Double, impedance: Int?, profile: BodyProfile, age: Int): Composition {
        val lib = MiScaleLib(profile.sex, age, profile.heightCm)
        val base = Composition(lib.bmi(weightKg), lib.bmr(weightKg), lib.visceralFatZepp(weightKg))
        if (impedance == null || impedance !in IMPEDANCE_RANGE) return base
        val z = impedance.toDouble()
        val fat = lib.bodyFat(weightKg, z)
        val bone = lib.boneMass(weightKg, z)
        return base.copy(
            bodyFatPct = fat, waterPct = lib.water(weightKg, z), boneKg = bone,
            muscleKg = weightKg - fat * 0.01 * weightKg - bone,
        )
    }

    /** Every [Metrics.SCALE] row we can compute, all stamped with the weigh-in time. */
    fun weighIn(reading: Reading, profile: BodyProfile?, zone: ZoneId = ZoneId.systemDefault()): WeighIn {
        fun row(metric: String, value: Double?, decimals: Int = 2): SampleEntity? {
            if (value == null) return null
            val f = Math.pow(10.0, decimals.toDouble())
            return SampleEntity(metric, reading.timeMs, null, Math.round(value * f) / f)
        }
        val rows = mutableListOf(
            row(Metrics.WEIGHT_KG, reading.weightKg, 3),
            row(Metrics.IMPEDANCE, reading.impedance?.toDouble()),
        )
        if (profile != null) {
            val day = Instant.ofEpochMilli(reading.timeMs).atZone(zone).toLocalDate()
            val c = compose(reading.weightKg, reading.impedance, profile, ageOn(profile.birthDate, day))
            rows += listOf(
                row(Metrics.BODY_FAT_PCT, c.bodyFatPct), row(Metrics.MUSCLE_KG, c.muscleKg),
                row(Metrics.WATER_PCT, c.waterPct), row(Metrics.BONE_KG, c.boneKg),
                row(Metrics.VISCERAL_FAT, c.visceralFat), row(Metrics.BMR_KCAL, c.bmrKcal), row(Metrics.BMI, c.bmi),
            )
        }
        return WeighIn(reading.timeMs, reading.weightKg, reading.impedance, rows.filterNotNull())
    }
}
