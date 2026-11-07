package app.kumquant.healthbridge.data

import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** One day (or other fixed-width bucket) of samples of a metric, aggregated in SQL. */
data class DayAgg(val bucket: Long, val total: Double, val n: Int, val lo: Double, val hi: Double)

/** Which metrics have data and when the newest point is. */
data class MetricInfo(val metric: String, val lastMs: Long, val n: Int)

/** Sample counts per heart-rate zone: z0 below the first bound ... z5 at or above the last. */
data class ZoneCounts(val z0: Int, val z1: Int, val z2: Int, val z3: Int, val z4: Int, val z5: Int)

/** Read-only queries for the health screens. */
@Dao
interface HealthQueries {
    @Query("SELECT * FROM samples WHERE metric = :metric AND start >= :from AND start < :to ORDER BY start")
    fun samples(metric: String, from: Long, to: Long): Flow<List<SampleEntity>>

    @Query("SELECT * FROM sessions WHERE kind = :kind AND `end` > :from AND start < :to ORDER BY start")
    fun sessions(kind: String, from: Long, to: Long): Flow<List<SessionEntity>>

    /**
     * Per-day sum / count / min / max. `bucket` is the local day number: `(start + offset) / 86400000`
     * with `offset` the zone's UTC offset in ms, so the caller splits a range wherever the offset changes (DST).
     */
    @Query(
        "SELECT (start + :offset) / 86400000 AS bucket, SUM(value) AS total, COUNT(*) AS n, MIN(value) AS lo, MAX(value) AS hi " +
            "FROM samples WHERE metric = :metric AND start >= :from AND start < :to AND value >= :minValue " +
            "GROUP BY bucket ORDER BY bucket"
    )
    fun dailyAgg(metric: String, from: Long, to: Long, offset: Long, minValue: Double): Flow<List<DayAgg>>

    /** Sum of an interval metric between two instants (a day's steps, a workout's calories). */
    @Query("SELECT COALESCE(SUM(value), 0) FROM samples WHERE metric = :metric AND start >= :from AND start < :to")
    fun total(metric: String, from: Long, to: Long): Flow<Double>

    @Query(
        "SELECT COALESCE(SUM(CASE WHEN value < :b1 THEN 1 END), 0) AS z0, " +
            "COALESCE(SUM(CASE WHEN value >= :b1 AND value < :b2 THEN 1 END), 0) AS z1, " +
            "COALESCE(SUM(CASE WHEN value >= :b2 AND value < :b3 THEN 1 END), 0) AS z2, " +
            "COALESCE(SUM(CASE WHEN value >= :b3 AND value < :b4 THEN 1 END), 0) AS z3, " +
            "COALESCE(SUM(CASE WHEN value >= :b4 AND value < :b5 THEN 1 END), 0) AS z4, " +
            "COALESCE(SUM(CASE WHEN value >= :b5 THEN 1 END), 0) AS z5 " +
            "FROM samples WHERE metric = 'heart_rate' AND start >= :from AND start < :to AND value > 0"
    )
    fun hrZoneCounts(from: Long, to: Long, b1: Double, b2: Double, b3: Double, b4: Double, b5: Double): Flow<ZoneCounts>

    @Query("SELECT * FROM samples WHERE metric = :metric ORDER BY start DESC LIMIT 1")
    fun latest(metric: String): Flow<SampleEntity?>

    @Query("SELECT * FROM samples WHERE metric = :metric AND start < :before ORDER BY start DESC LIMIT :n")
    fun latestBefore(metric: String, before: Long, n: Int): Flow<List<SampleEntity>>

    /** The newest [n] points of a metric, newest first. */
    @Query("SELECT * FROM samples WHERE metric = :metric ORDER BY start DESC LIMIT :n")
    fun lastN(metric: String, n: Int): Flow<List<SampleEntity>>

    @Query("SELECT metric, MAX(start) AS lastMs, COUNT(*) AS n FROM samples GROUP BY metric")
    fun metricInfo(): Flow<List<MetricInfo>>

    @Query("SELECT * FROM sessions WHERE kind = :kind ORDER BY start DESC LIMIT 1")
    fun lastSession(kind: String): Flow<SessionEntity?>

    @Query("SELECT * FROM sessions WHERE kind = :kind AND `end` >= :from AND `end` < :to ORDER BY start")
    fun sessionsEndingIn(kind: String, from: Long, to: Long): Flow<List<SessionEntity>>

    @Query("SELECT * FROM sessions WHERE kind = :kind ORDER BY start DESC LIMIT :limit")
    fun recentSessions(kind: String, limit: Int): Flow<List<SessionEntity>>

    @Query("SELECT * FROM sessions WHERE id = :id")
    fun session(id: String): Flow<SessionEntity?>
}
