package app.kumquant.healthbridge.scale

import app.kumquant.healthbridge.data.Metrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** Fixtures are the regression values from openScale's MiScaleLibTest.kt; same cases as test_scale.py. */
class BodyCompositionTest {
    private val eps = 1e-3

    private fun check(
        sex: Sex, age: Int, height: Double, weight: Double, imp: Double,
        bmi: Double, fat: Double, bone: Double, lbm: Double, musclePct: Double, water: Double, visceral: Double,
    ) {
        val lib = MiScaleLib(sex, age, height)
        assertEquals(bmi, lib.bmi(weight), eps)
        assertEquals(fat, lib.bodyFat(weight, imp), eps)
        assertEquals(bone, lib.boneMass(weight, imp), eps)
        assertEquals(lbm, lib.lbm(weight, imp), eps)
        assertEquals(musclePct, lib.skeletalMusclePct(weight, imp), eps)
        assertEquals(water, lib.water(weight, imp), eps)
        assertEquals(visceral, lib.visceralFat(weight), eps)
    }

    @Test fun male30y180cm80kg() =
        check(Sex.MALE, 30, 180.0, 80.0, 500.0, 24.691359, 23.315107, 3.1254203, 58.222496, 40.977253, 52.605835, 13.359997)

    @Test fun female28y165cm60kg() =
        check(Sex.FEMALE, 28, 165.0, 60.0, 520.0, 22.038567, 30.361998, 2.4865808, 39.29622, 40.181103, 49.72153, -36.555004)

    @Test fun male45y175cm95kg() =
        check(Sex.MALE, 45, 175.0, 95.0, 430.0, 31.020409, 32.41778, 3.2726917, 60.93042, 36.096416, 48.2537, 24.462498)

    private val user = BodyProfile(177.0, LocalDate.of(1998, 4, 3), Sex.MALE)

    @Test fun age() {
        assertEquals(27, BodyComposition.ageOn(user.birthDate, LocalDate.of(2026, 4, 2)))
        assertEquals(28, BodyComposition.ageOn(user.birthDate, LocalDate.of(2026, 4, 3)))
    }

    @Test fun composeUserProfile() {
        val c = BodyComposition.compose(75.35, 512, user, 28)
        assertEquals(24.0512, c.bmi, 1e-3)
        assertEquals(877.8 + 75.35 * 14.916 - 177.0 * 0.726 - 28 * 8.976, c.bmrKcal, 1e-6)
        assertEquals(21.809, c.bodyFatPct!!, 1e-2)
        assertEquals(53.639, c.waterPct!!, 1e-2)
        assertEquals(3.000, c.boneKg!!, 1e-2)
        assertEquals(10.0, c.visceralFat, 0.0)
        assertEquals(75.35 - c.bodyFatPct!! * 0.01 * 75.35 - c.boneKg!!, c.muscleKg!!, 1e-9)
    }

    /** The user's weigh-in of 2026-11-06 19:25 as both this app and Zepp Life (from its export) computed it. */
    @Test fun matchesZeppLifeForTheSameWeighIn() {
        val c = BodyComposition.compose(76.15, 555, user, 28)
        assertEquals(22.67865, c.bodyFatPct!!, 0.01)
        assertEquals(53.042446, c.waterPct!!, 0.01)
        assertEquals(2.9981363, c.boneKg!!, 0.01)
        assertEquals(55.882072, c.muscleKg!!, 0.01)
        assertEquals(1633.0, c.bmrKcal, 1.0)
        assertEquals(10.0, c.visceralFat, 0.0)
        assertEquals(24.3, c.bmi, 0.01)
    }

    @Test fun composeWithoutUsableImpedance() {
        val none = BodyComposition.compose(75.35, null, user, 28)
        assertNull(none.bodyFatPct)
        assertNull(none.muscleKg)
        assertTrue(none.bmi > 0)
        assertNull(BodyComposition.compose(75.35, 5, user, 28).bodyFatPct)
    }

    @Test fun zeppVisceralFatSaneForLightWomen() {
        assertTrue(MiScaleLib(Sex.FEMALE, 28, 165.0).visceralFatZepp(60.0) >= 1.0)
    }

    private val zone = ZoneId.of("Europe/Berlin")
    private val t = LocalDateTime.of(2026, 11, 5, 7, 30, 15).atZone(zone).toInstant().toEpochMilli()

    @Test fun weighInHasEveryScaleMetric() {
        val w = BodyComposition.weighIn(Reading(t, 75.35, 512), user, zone)
        assertEquals(Metrics.SCALE.toSet(), w.samples.map { it.metric }.toSet())
        assertTrue(w.samples.all { it.start == t && it.end == null })
        assertEquals(75.35, w.samples.first { it.metric == Metrics.WEIGHT_KG }.value, 1e-9)
        assertEquals(512.0, w.samples.first { it.metric == Metrics.IMPEDANCE }.value, 1e-9)
        assertEquals(1621.89, w.samples.first { it.metric == Metrics.BMR_KCAL }.value, 1e-9)
        assertEquals(t, w.time)
    }

    @Test fun weighInWithoutImpedanceOrProfile() {
        val weightOnly = BodyComposition.weighIn(Reading(t, 75.35, null), user, zone)
        assertEquals(setOf(Metrics.WEIGHT_KG, Metrics.VISCERAL_FAT, Metrics.BMR_KCAL, Metrics.BMI), weightOnly.samples.map { it.metric }.toSet())
        val noProfile = BodyComposition.weighIn(Reading(t, 75.35, 512), null, zone)
        assertEquals(setOf(Metrics.WEIGHT_KG, Metrics.IMPEDANCE), noProfile.samples.map { it.metric }.toSet())
    }

    @Test fun profileParsing() {
        val p = BodyProfile.parse("177", "1998-04-03", "male")
        assertNotNull(p)
        assertEquals(Sex.MALE, p!!.sex)
        assertEquals(177.0, p.heightCm, 0.0)
        assertNull(BodyProfile.parse("", "1998-04-03", "male"))
        assertNull(BodyProfile.parse("177", "", "male"))
        assertNull(BodyProfile.parse("177", "1998-04-03", ""))
        assertNull(BodyProfile.parse("177", "04/03/1998", "male"))
        assertEquals(Sex.FEMALE, BodyProfile.parse("165", "1990-01-01", "Female")!!.sex)
    }
}
