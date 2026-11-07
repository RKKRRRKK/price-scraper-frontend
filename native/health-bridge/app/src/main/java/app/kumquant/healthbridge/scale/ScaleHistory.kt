package app.kumquant.healthbridge.scale

import app.kumquant.healthbridge.data.HealthDatabase
import app.kumquant.healthbridge.data.HealthStore
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/**
 * The scale's history beyond live weigh-ins: telling the user's weigh-ins from other people's,
 * importing a Zepp Life data export, and recomputing stored weigh-ins after a formula change.
 */
object ScaleHistory {
    /** `source` of weigh-ins imported from Zepp Life. */
    const val ZEPP_SOURCE = "zepplife"

    /**
     * Other people use the scale too (their 46-59 kg weigh-ins sit in the user's Zepp history next to
     * the user's 69-82 kg). A weigh-in further than this from the user's previous one is someone else's.
     */
    const val SAME_PERSON = 0.12

    /** Weigh-ins this close together are one weigh-in synced twice. */
    private const val SAME_WEIGHIN_MS = 120_000L

    fun isUser(weightKg: Double, previousKg: Double?): Boolean =
        previousKg == null || abs(weightKg - previousKg) <= previousKg * SAME_PERSON

    /** One row of Zepp Life's `BODY/BODY_<id>.csv`, values already under our metric names. */
    internal data class ZeppRow(val timeMs: Long, val values: Map<String, Double>) {
        val weight: Double get() = values.getValue(Metrics.WEIGHT_KG)
    }

    private val ZEPP_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ssZ")

    /** Zepp column → our metric. "muscleRate" holds kg (it equals our muscle_kg for the same weigh-in). */
    private val ZEPP_COLUMNS = mapOf(
        "weight" to Metrics.WEIGHT_KG, "bmi" to Metrics.BMI, "fatRate" to Metrics.BODY_FAT_PCT,
        "bodyWaterRate" to Metrics.WATER_PCT, "boneMass" to Metrics.BONE_KG, "metabolism" to Metrics.BMR_KCAL,
        "muscleRate" to Metrics.MUSCLE_KG, "visceralFat" to Metrics.VISCERAL_FAT,
    )

    /** Parses the CSV (header `time,weight,height,bmi,fatRate,...`, time like `2026-01-01 06:09:29+0000`). */
    internal fun parseZeppBody(text: String): List<ZeppRow> {
        val lines = text.removePrefix("﻿").lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return emptyList()
        val header = lines.first().split(',').map { it.trim() }
        val timeIdx = header.indexOf("time")
        require(timeIdx >= 0 && "weight" in header) { "not a Zepp Life BODY export: $header" }
        return lines.drop(1).mapNotNull { line ->
            val cells = line.split(',')
            val time = cells.getOrNull(timeIdx)?.trim() ?: return@mapNotNull null
            val ms = runCatching { OffsetDateTime.parse(time, ZEPP_TIME).toInstant().toEpochMilli() }.getOrNull()
                ?: return@mapNotNull null
            val values = header.withIndex().mapNotNull { (i, column) ->
                val metric = ZEPP_COLUMNS[column] ?: return@mapNotNull null
                val v = cells.getOrNull(i)?.trim()?.toDoubleOrNull()?.takeIf { it > 0.0 } ?: return@mapNotNull null
                metric to v
            }.toMap()
            if (Metrics.WEIGHT_KG in values) ZeppRow(ms, values) else null
        }
    }

    /**
     * The user's rows: walking back in time from [anchorKg] (their latest known weight; the median when
     * unknown), each row must be within [SAME_PERSON] of the last one kept. A burst of rows for one
     * weigh-in keeps only its latest.
     */
    internal fun usersRows(rows: List<ZeppRow>, anchorKg: Double?): List<ZeppRow> {
        val newestFirst = rows.sortedByDescending { it.timeMs }
        var anchor = anchorKg ?: rows.map { it.weight }.sorted().let { it.getOrNull(it.size / 2) } ?: return emptyList()
        var lastKeptMs = Long.MAX_VALUE
        val kept = ArrayList<ZeppRow>()
        for (row in newestFirst) {
            if (!isUser(row.weight, anchor)) continue
            anchor = row.weight
            if (lastKeptMs - row.timeMs < SAME_WEIGHIN_MS) continue
            kept += row
            lastKeptMs = row.timeMs
        }
        return kept.reversed()
    }

    data class ImportResult(val rows: Int, val imported: Int, val othersSkipped: Int, val duplicatesSkipped: Int)

    /** Imports the user's weigh-ins from a Zepp Life BODY export; ones the scale already gave us are skipped. */
    suspend fun importZepp(db: HealthDatabase, csv: String): ImportResult {
        val rows = parseZeppBody(csv)
        val sync = db.sync()
        val anchor = sync.latestBefore(Metrics.WEIGHT_KG, Long.MAX_VALUE)?.value
        val users = usersRows(rows, anchor)
        val own = sync.samplesFrom(Metrics.WEIGHT_KG, Metrics.SOURCE).map { it.start }
        val fresh = users.filter { row -> own.none { abs(it - row.timeMs) < SAME_WEIGHIN_MS } }
        val samples = fresh.flatMap { row ->
            row.values.map { (metric, v) -> SampleEntity(metric, row.timeMs, null, Math.round(v * 1000) / 1000.0, ZEPP_SOURCE) }
        }
        HealthStore(db).write(samples = samples)
        return ImportResult(rows.size, fresh.size, rows.size - users.size, users.size - fresh.size)
    }

    /** Recomputes the scale's own weigh-ins (those with impedance) with the current formulas; returns how many. */
    suspend fun recompute(db: HealthDatabase, profile: BodyProfile): Int {
        val sync = db.sync()
        var n = 0
        for (w in sync.samplesFrom(Metrics.WEIGHT_KG, Metrics.SOURCE)) {
            val impedance = sync.samplesIn(Metrics.IMPEDANCE, w.start, w.start + 1).firstOrNull()?.value?.toInt()
            val weighIn = BodyComposition.weighIn(Reading(w.start, w.value, impedance), profile)
            HealthStore(db).write(samples = weighIn.samples)
            n++
        }
        return n
    }
}
