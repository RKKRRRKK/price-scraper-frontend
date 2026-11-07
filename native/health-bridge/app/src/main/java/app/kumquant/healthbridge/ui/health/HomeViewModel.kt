package app.kumquant.healthbridge.ui.health

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.kumquant.healthbridge.data.HealthDatabase
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.time.LocalDate

/** What one home tile shows. `wide` tiles take the full row. */
sealed interface TileData {
    val key: String
    val wide: Boolean get() = false
}

data class HrTile(val date: LocalDate, val latest: SampleEntity, val spark: List<Pt>, val resting: Double?, val lo: Double, val hi: Double) : TileData {
    override val key get() = "hr"
    override val wide get() = true
}

data class SleepTile(val night: SleepNight) : TileData {
    override val key get() = "sleep"
    override val wide get() = true
}

data class StepsTile(val date: LocalDate, val steps: Double) : TileData { override val key get() = "steps" }
data class KcalTile(val date: LocalDate, val total: Double, val hourly: List<Double>) : TileData { override val key get() = "kcal" }
data class ActivityTile(val date: LocalDate, val distanceM: Double, val activeMin: Int, val hourly: List<Double>) : TileData { override val key get() = "activity" }
data class Spo2Tile(val date: LocalDate, val latest: Double, val lo: Double, val hi: Double, val spark: List<Pt>) : TileData { override val key get() = "spo2" }
data class StressTile(val date: LocalDate, val avg: Double, val latest: Double, val hourly: List<Double?>) : TileData { override val key get() = "stress" }
data class EnergyTile(val date: LocalDate, val latest: Double, val lo: Double, val hi: Double, val spark: List<Pt>) : TileData { override val key get() = "energy" }
data class RestingTile(val resting: Double?, val trend: List<Pt>, val hrv: Double?) : TileData { override val key get() = "resting" }
data class BodyTile(val weightKg: Double, val deltaKg: Double?, val fatPct: Double?, val trend: List<Pt>) : TileData { override val key get() = "body" }
data class WorkoutTile(val workout: WorkoutSummary, val hr: List<Pt>) : TileData {
    override val key get() = "workouts"
    override val wide get() = true
}

/** Builds the home tiles from the local DB; a tile whose metric has no data simply is not emitted. */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = HealthRepository(HealthDatabase.get(app))

    /** The reference day of a metric's tile is the day of its newest reading (today, normally). */
    private fun <T> byDay(metric: String, build: (LocalDate) -> Flow<T?>): Flow<T?> =
        repo.info.map { it[metric]?.lastMs?.let(repo::dateOf) }.distinctUntilChanged()
            .flatMapLatest { d -> if (d == null) flowOf(null) else build(d) }

    private val hr: Flow<TileData?> = byDay(Metrics.HEART_RATE) { d ->
        combine(repo.samples(Metrics.HEART_RATE, d, d.plusDays(1)), repo.latest(Metrics.RESTING_HEART_RATE)) { s, rest ->
            val valid = s.filter { it.value > 0 }
            if (valid.isEmpty()) null
            else HrTile(d, valid.last(), downsample(valid.pts(), 180), rest?.value, valid.minOf { it.value }, valid.maxOf { it.value })
        }
    }

    private val sleep: Flow<TileData?> = repo.lastNight().map { n -> n?.let { SleepTile(it) } }

    private val steps: Flow<TileData?> = byDay(Metrics.STEPS) { d ->
        repo.total(Metrics.STEPS, d, d.plusDays(1)).map { StepsTile(d, it) }
    }

    private val kcal: Flow<TileData?> = byDay(Metrics.ACTIVE_KCAL) { d ->
        repo.hourly(Metrics.ACTIVE_KCAL, d).map { KcalTile(d, it.sum(), it.toList()) }
    }

    private val activity: Flow<TileData?> = byDay(Metrics.DISTANCE_M) { d ->
        combine(repo.hourly(Metrics.DISTANCE_M, d), repo.daily(Metrics.STEPS, d, d.plusDays(1), minValue = ACTIVE_STEPS_PER_MIN)) { h, a ->
            ActivityTile(d, h.sum(), a.firstOrNull()?.n ?: 0, h.toList())
        }
    }

    private val spo2: Flow<TileData?> = byDay(Metrics.SPO2) { d ->
        repo.samples(Metrics.SPO2, d, d.plusDays(1)).map { l ->
            val v = l.filter { it.value > 0 }
            if (v.isEmpty()) null else Spo2Tile(d, v.last().value, v.minOf { it.value }, v.maxOf { it.value }, v.pts())
        }
    }

    private val stress: Flow<TileData?> = byDay(Metrics.STRESS) { d ->
        repo.samples(Metrics.STRESS, d, d.plusDays(1)).map { l ->
            val v = l.filter { it.value > 0 }
            if (v.isEmpty()) null else {
                val z = java.time.ZoneId.systemDefault()
                val by = v.groupBy { java.time.Instant.ofEpochMilli(it.start).atZone(z).hour }
                StressTile(d, v.map { it.value }.average(), v.last().value, (0 until 24).map { h -> by[h]?.map { it.value }?.average() })
            }
        }
    }

    private val energy: Flow<TileData?> = byDay(Metrics.BODY_ENERGY) { d ->
        repo.samples(Metrics.BODY_ENERGY, d, d.plusDays(1)).map { l ->
            val v = l.filter { it.value >= 0 }
            if (v.isEmpty()) null else EnergyTile(d, v.last().value, v.minOf { it.value }, v.maxOf { it.value }, downsample(v.pts(), 120))
        }
    }

    private val resting: Flow<TileData?> =
        combine(repo.lastN(Metrics.RESTING_HEART_RATE, 14), repo.lastN(Metrics.HRV_RMSSD, 1)) { r, h ->
            if (r.isEmpty() && h.isEmpty()) null
            else RestingTile(r.firstOrNull()?.value, r.reversed().pts(), h.firstOrNull()?.value)
        }

    private val body: Flow<TileData?> =
        combine(repo.lastN(Metrics.WEIGHT_KG, 40), repo.latest(Metrics.BODY_FAT_PCT)) { w, fat ->
            if (w.isEmpty()) null
            else {
                val cutoff = w.first().start - 30L * 86_400_000
                val recent = w.filter { it.start >= cutoff }.reversed()
                val trend = recent.pts()
                BodyTile(w.first().value, w.getOrNull(1)?.let { w.first().value - it.value }, fat?.value, trend)
            }
        }

    private val workouts: Flow<TileData?> = repo.lastWorkout().flatMapLatest { w ->
        if (w == null) flowOf(null)
        else repo.workout(w.id).map { d -> WorkoutTile(w, downsample(d?.hr?.map { Pt(it.first.toDouble(), it.second) } ?: emptyList(), 120)) }
    }

    val tiles: StateFlow<List<TileData>?> =
        combine(listOf(hr, sleep, steps, kcal, activity, stress, spo2, energy, resting, body, workouts)) { arr -> arr.filterNotNull() }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /** Time of the newest reading of any metric. */
    val updated: StateFlow<Long?> = repo.info.map { m -> m.values.maxOfOrNull { it.lastMs } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    companion object {
        /** A minute with at least this many steps counts as active. */
        const val ACTIVE_STEPS_PER_MIN = 40.0
    }
}
