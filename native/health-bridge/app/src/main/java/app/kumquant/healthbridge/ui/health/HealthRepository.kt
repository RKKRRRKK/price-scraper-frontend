package app.kumquant.healthbridge.ui.health

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import app.kumquant.healthbridge.data.HealthDatabase
import app.kumquant.healthbridge.data.MetricInfo
import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.data.SessionEntity
import app.kumquant.healthbridge.ui.theme.Hb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transform
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Lets a burst of database invalidations (a sync writing many files) collapse into one recomputation. */
fun <T> Flow<T>.throttled(ms: Long = 1000): Flow<T> = conflate().transform { emit(it); delay(ms) }

/** Aggregates of one local day (or one month, for the year view). `date` is the first day covered. */
data class DayStat(val date: LocalDate, val sum: Double, val n: Int, val lo: Double, val hi: Double) {
    val avg: Double get() = if (n == 0) 0.0 else sum / n
}

data class Stage(val stage: String, val start: Long, val end: Long) {
    val minutes: Double get() = (end - start) / 60000.0
}

/** One sleep session. `date` is the local day of waking up, which is what a night is filed under. */
data class SleepNight(val id: String, val start: Long, val end: Long, val stages: List<Stage>) {
    val date: LocalDate = Instant.ofEpochMilli(end).atZone(ZoneId.systemDefault()).toLocalDate()
    val inBedMin: Double = (end - start) / 60000.0
    val hasStages: Boolean = stages.isNotEmpty()
    val mins: Map<String, Double> = run {
        val m = linkedMapOf("awake" to 0.0, "rem" to 0.0, "light" to 0.0, "deep" to 0.0)
        if (stages.isEmpty()) m["light"] = inBedMin else stages.forEach { m[it.stage] = (m[it.stage] ?: 0.0) + it.minutes }
        m
    }
    val awakeMin: Double get() = mins.getValue("awake")
    val asleepMin: Double get() = (inBedMin - awakeMin).coerceAtLeast(0.0)
}

/** A workout as listed: everything the list and tile need, parsed once from the details JSON. */
data class WorkoutSummary(
    val id: String,
    val start: Long,
    val end: Long,
    val type: Int?,
    val title: String?,
    val kcal: Double?,
    val distanceM: Double?,
    val avgHr: Double?,
    val maxHr: Double?,
    val paceSPerKm: Double?,
    val elevGain: Double?,
) {
    val name: String get() = title?.takeIf { it.isNotBlank() } ?: exerciseName(type)
    val durationMin: Double get() = (end - start) / 60000.0
    val date: LocalDate get() = Instant.ofEpochMilli(start).atZone(ZoneId.systemDefault()).toLocalDate()
}

data class GpsPoint(val t: Long, val lat: Double, val lon: Double, val alt: Double?)

class WorkoutDetail(
    val summary: WorkoutSummary,
    /** (epoch ms, bpm) */
    val hr: List<Pair<Long, Double>>,
    val gps: List<GpsPoint>,
    val zonesS: Map<String, Double>,
    private val d: JSONObject?,
) {
    fun num(key: String): Double? = d?.takeIf { it.has(key) && !it.isNull(key) }?.optDouble(key)?.takeIf { !it.isNaN() }
}

/** Health Connect EXERCISE_TYPE_* names; same table as the web's EXERCISE_TYPES (src/lib/health/metrics.js). */
fun exerciseName(type: Int?): String = when (type) {
    0 -> "Workout"; 2 -> "Badminton"; 4 -> "Baseball"; 5 -> "Basketball"; 8 -> "Cycling"; 9 -> "Indoor cycling"
    11 -> "Boxing"; 13 -> "Calisthenics"; 14 -> "Cricket"; 16 -> "Dancing"; 25 -> "Elliptical"
    26 -> "Exercise class"; 27 -> "Fencing"; 28 -> "American football"; 31 -> "Frisbee"; 32 -> "Golf"
    34 -> "Gymnastics"; 35 -> "Handball"; 36 -> "HIIT"; 37 -> "Hiking"; 38 -> "Ice hockey"; 39 -> "Ice skating"
    44 -> "Martial arts"; 46 -> "Paddling"; 47 -> "Paragliding"; 48 -> "Pilates"; 51 -> "Rock climbing"
    53 -> "Rowing"; 54 -> "Rowing machine"; 56 -> "Running"; 57 -> "Treadmill"; 58 -> "Sailing"
    59 -> "Scuba diving"; 60 -> "Skating"; 61 -> "Skiing"; 62 -> "Snowboarding"; 64 -> "Football"
    65 -> "Softball"; 66 -> "Squash"; 68 -> "Stair climbing"; 69 -> "Stair machine"; 70 -> "Strength training"
    71 -> "Stretching"; 72 -> "Surfing"; 73 -> "Open-water swim"; 74 -> "Pool swim"; 75 -> "Table tennis"
    76 -> "Tennis"; 78 -> "Volleyball"; 79 -> "Walking"; 80 -> "Water polo"; 81 -> "Weightlifting"; 83 -> "Yoga"
    else -> "Workout"
}

private fun JSONObject.numOrNull(key: String): Double? =
    if (has(key) && !isNull(key)) optDouble(key).takeIf { !it.isNaN() } else null

private fun normaliseStage(s: String): String = when (s.lowercase()) {
    "awake", "out_of_bed", "wake" -> "awake"
    "rem" -> "rem"
    "deep" -> "deep"
    else -> "light"
}

fun parseStages(json: String): List<Stage> = try {
    val a = JSONArray(json)
    (0 until a.length()).mapNotNull { i ->
        val o = a.getJSONObject(i)
        val s = OffsetDateTime.parse(o.getString("start")).toInstant().toEpochMilli()
        val e = OffsetDateTime.parse(o.getString("end")).toInstant().toEpochMilli()
        if (e > s) Stage(normaliseStage(o.optString("stage", "light")), s, e) else null
    }.sortedBy { it.start }
} catch (_: Exception) {
    emptyList()
}

fun SessionEntity.toNight() = SleepNight(id, start, end, parseStages(stagesJson))

fun SessionEntity.toWorkoutSummary(): WorkoutSummary {
    val d = try { detailsJson?.let { JSONObject(it) } } catch (_: Exception) { null }
    return WorkoutSummary(
        id = id, start = start, end = end, type = exerciseType, title = title,
        kcal = d?.numOrNull("kcal"), distanceM = d?.numOrNull("distance_m"),
        avgHr = d?.numOrNull("avg_hr"), maxHr = d?.numOrNull("max_hr"),
        paceSPerKm = d?.numOrNull("avg_pace_s_per_km"), elevGain = d?.numOrNull("elevation_gain_m"),
    )
}

/** Splits [hr] into the six [Hb.zones] and returns seconds per zone key. */
fun zoneSeconds(hr: List<Pair<Long, Double>>, maxHr: Int = Hb.MAX_HR): Map<String, Double> {
    val out = Hb.zones.associate { it.key to 0.0 }.toMutableMap()
    for (i in 0 until hr.size - 1) {
        val dt = ((hr[i + 1].first - hr[i].first) / 1000.0).coerceIn(0.0, 60.0)
        val z = zoneOf(hr[i].second, maxHr)
        out[z.key] = out.getValue(z.key) + dt
    }
    return out
}

fun zoneOf(bpm: Double, maxHr: Int = Hb.MAX_HR): Hb.Zone =
    Hb.zones.lastOrNull { bpm >= it.from * maxHr } ?: Hb.zones.first()

/** Reads the local Room DB for the health screens. Day boundaries are the phone's local midnight. */
class HealthRepository(private val db: HealthDatabase) {
    private val q = db.queries()

    private fun zone(): ZoneId = ZoneId.systemDefault()
    fun ms(date: LocalDate): Long = date.atStartOfDay(zone()).toInstant().toEpochMilli()
    fun today(): LocalDate = LocalDate.now(zone())
    fun dateOf(ms: Long): LocalDate = Instant.ofEpochMilli(ms).atZone(zone()).toLocalDate()

    val info: Flow<Map<String, MetricInfo>> = q.metricInfo().map { l -> l.associateBy { it.metric } }

    fun samples(metric: String, from: LocalDate, to: LocalDate): Flow<List<SampleEntity>> = q.samples(metric, ms(from), ms(to))
    fun samplesMs(metric: String, from: Long, to: Long): Flow<List<SampleEntity>> = q.samples(metric, from, to)
    fun latest(metric: String) = q.latest(metric)
    fun lastN(metric: String, n: Int) = q.lastN(metric, n)
    fun total(metric: String, from: LocalDate, to: LocalDate) = q.total(metric, ms(from), ms(to))

    /** Per-day aggregates over [from, to), exact across DST changes. */
    fun daily(metric: String, from: LocalDate, to: LocalDate, minValue: Double = -1e18): Flow<List<DayStat>> {
        val z = zone()
        val fromMs = ms(from)
        val toMs = ms(to)
        val segs = ArrayList<Triple<Long, Long, Long>>()
        var cur = fromMs
        while (cur < toMs) {
            val offset = z.rules.getOffset(Instant.ofEpochMilli(cur)).totalSeconds * 1000L
            val next = z.rules.nextTransition(Instant.ofEpochMilli(cur))?.instant?.toEpochMilli()?.takeIf { it < toMs } ?: toMs
            segs += Triple(cur, next, offset)
            cur = next
        }
        val flows = segs.map { (a, b, off) -> q.dailyAgg(metric, a, b, off, minValue) }
        return combine(flows) { parts ->
            val by = sortedMapOf<Long, DayStat>()
            for (part in parts) for (r in part) {
                val prev = by[r.bucket]
                by[r.bucket] = if (prev == null) DayStat(LocalDate.ofEpochDay(r.bucket), r.total, r.n, r.lo, r.hi)
                else DayStat(prev.date, prev.sum + r.total, prev.n + r.n, minOf(prev.lo, r.lo), maxOf(prev.hi, r.hi))
            }
            by.values.toList()
        }.flowOn(Dispatchers.Default).throttled()
    }

    /** Minutes per zone, assuming one reading per minute. */
    fun hrZoneMinutes(from: LocalDate, to: LocalDate, maxHr: Int = Hb.MAX_HR): Flow<List<Int>> {
        val b = (1..5).map { Hb.zones[it].from * maxHr }
        return q.hrZoneCounts(ms(from), ms(to), b[0], b[1], b[2], b[3], b[4]).map { listOf(it.z0, it.z1, it.z2, it.z3, it.z4, it.z5) }.throttled()
    }

    /** Sleep sessions whose wake-up falls in [from, to). */
    fun nights(from: LocalDate, to: LocalDate): Flow<List<SleepNight>> =
        q.sessionsEndingIn(Metrics.KIND_SLEEP, ms(from), ms(to)).map { l -> l.map { it.toNight() } }.flowOn(Dispatchers.Default)

    fun lastNight(): Flow<SleepNight?> = q.lastSession(Metrics.KIND_SLEEP).map { it?.toNight() }

    fun workouts(limit: Int = 300): Flow<List<WorkoutSummary>> =
        q.recentSessions(Metrics.KIND_EXERCISE, limit).map { l -> l.map { it.toWorkoutSummary() } }.flowOn(Dispatchers.Default)

    fun lastWorkout(): Flow<WorkoutSummary?> = q.lastSession(Metrics.KIND_EXERCISE).map { it?.toWorkoutSummary() }

    /** A workout with its HR curve (from the details, else the minute readings in its window) and GPS track. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun workout(id: String): Flow<WorkoutDetail?> = q.session(id).flatMapLatest { s ->
        if (s == null) flowOf(null)
        else q.samples(Metrics.HEART_RATE, s.start, s.end + 1).map { buildWorkout(s, it) }
    }.flowOn(Dispatchers.Default)

    private fun buildWorkout(s: SessionEntity, minuteHr: List<SampleEntity>): WorkoutDetail {
        val d = try { s.detailsJson?.let { JSONObject(it) } } catch (_: Exception) { null }
        val hrArr = d?.optJSONArray("hr")
        val hr = if (hrArr != null && hrArr.length() > 1) {
            (0 until hrArr.length()).mapNotNull { i ->
                val p = hrArr.optJSONArray(i) ?: return@mapNotNull null
                if (p.length() < 2) null else (p.getLong(0) * 1000) to p.getDouble(1)
            }
        } else minuteHr.filter { it.value > 0 }.map { it.start to it.value }
        val gpsArr = d?.optJSONArray("gps")
        val gps = if (gpsArr == null) emptyList() else (0 until gpsArr.length()).mapNotNull { i ->
            val p = gpsArr.optJSONArray(i) ?: return@mapNotNull null
            if (p.length() < 3) null
            else GpsPoint(p.getLong(0) * 1000, p.getDouble(1), p.getDouble(2), if (p.length() > 3 && !p.isNull(3)) p.getDouble(3) else null)
        }
        val zj = d?.optJSONObject("hr_zones_s")
        val zones = if (zj != null) {
            val m = Hb.zones.associate { it.key to 0.0 }.toMutableMap()
            zj.keys().forEach { k ->
                val key = when (k) { "extreme" -> "max"; else -> k }
                m[key] = (m[key] ?: 0.0) + zj.optDouble(k, 0.0)
            }
            m
        } else zoneSeconds(hr)
        return WorkoutDetail(s.toWorkoutSummary(), hr, gps, zones, d)
    }

    /** Hourly sums of an interval metric over one local day. */
    fun hourly(metric: String, date: LocalDate): Flow<DoubleArray> =
        q.samples(metric, ms(date), ms(date.plusDays(1))).map { l ->
            val out = DoubleArray(24)
            val z = zone()
            for (s in l) out[ZonedDateTime.ofInstant(Instant.ofEpochMilli(s.start), z).hour] += s.value
            out
        }.flowOn(Dispatchers.Default)
}

/** Shared by every screen; owns the repository so flows survive configuration changes. */
class HealthViewModel(app: Application) : AndroidViewModel(app) {
    val repo = HealthRepository(HealthDatabase.get(app))
}
