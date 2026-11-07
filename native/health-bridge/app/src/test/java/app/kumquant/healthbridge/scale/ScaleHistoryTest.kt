package app.kumquant.healthbridge.scale

import app.kumquant.healthbridge.data.Metrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Zepp Life BODY export parsing and telling the user's weigh-ins from other people's (rows shaped like a real export). */
class ScaleHistoryTest {
    private val csv = """
        ﻿time,weight,height,bmi,fatRate,bodyWaterRate,boneMass,metabolism,muscleRate,visceralFat
        2024-06-16 11:30:30+0000,70.0,null,null,null,null,null,null,null,null
        2024-06-16 11:33:49+0000,70.05,177.0,22.3,18.344316,56.0158,2.911461,1560.0,54.28835,8.0
        2024-06-16 20:41:00+0000,48.95,177.0,15.6,24.68,52.1,2.1,1121.0,34.9,2.0
        2025-11-20 08:00:00+0000,75.4,177.0,24.1,22.0,53.4,3.0,1640.0,55.8,10.0
        2026-08-31 21:18:00+0000,58.95,177.0,18.8,26.52,51.0,2.4,1225.0,40.9,3.0
        2026-09-02 07:00:00+0000,80.35,177.0,25.6,24.1,52.0,3.1,1696.0,57.9,11.0
        2026-11-06 11:08:07+0000,76.1,177.0,24.2,22.452288,53.19773,3.0050273,1633.0,56.00878,10.0
        2026-11-06 11:08:15+0000,76.0,177.0,24.2,22.392357,53.238842,3.0033767,1631.0,55.97843,10.0
    """.trimIndent()

    @Test fun parsesNullsAndUnits() {
        val rows = ScaleHistory.parseZeppBody(csv)
        assertEquals(8, rows.size)
        assertEquals(setOf(Metrics.WEIGHT_KG), rows[0].values.keys)
        assertEquals(1718537430_000L, rows[0].timeMs)
        assertEquals(54.28835, rows[1].values.getValue(Metrics.MUSCLE_KG), 1e-9) // "muscleRate" is kg
        assertEquals(1560.0, rows[1].values.getValue(Metrics.BMR_KCAL), 0.0)
    }

    @Test fun keepsOnlyTheUserAndOneRowPerWeighIn() {
        val kept = ScaleHistory.usersRows(ScaleHistory.parseZeppBody(csv), anchorKg = 76.15)
        // The 48.95 and 58.95 kg weigh-ins are other people; the two 11:08 rows are one weigh-in.
        assertEquals(listOf(70.0, 70.05, 75.4, 80.35, 76.0), kept.map { it.weight })
    }

    @Test fun sameWeighInWithinTwoMinutesCollapses() {
        val kept = ScaleHistory.usersRows(ScaleHistory.parseZeppBody(csv), anchorKg = null)
        assertTrue(kept.none { it.weight == 76.1 })
    }

    @Test fun isUser() {
        assertTrue(ScaleHistory.isUser(76.0, null))
        assertTrue(ScaleHistory.isUser(80.0, 76.15))
        assertFalse(ScaleHistory.isUser(58.95, 76.15))
    }
}
