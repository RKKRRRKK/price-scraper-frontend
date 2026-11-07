package app.kumquant.healthbridge.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * The phone's own copy of everything the watch and scale produce. It is the
 * source of truth: screens read it (so they work offline) and the uploader
 * mirrors it to Supabase.
 *
 * Times are epoch milliseconds (UTC).
 */

/**
 * One numeric point. Keyed by (metric, start) so re-fetching a watch file that
 * overlaps an earlier one overwrites instead of duplicating.
 * `end` is set for interval values (steps in a minute), null for instants (a heart-rate reading).
 */
@Entity(tableName = "samples", primaryKeys = ["metric", "start"])
data class SampleEntity(
    val metric: String,
    val start: Long,
    val end: Long?,
    val value: Double,
    val source: String = Metrics.SOURCE,
)

/**
 * A sleep or a workout.
 * - `id`: stable, e.g. "hb:sleep:1730851200" / "hb:exercise:1730851200" (start in epoch seconds).
 * - `exerciseType`: Health Connect EXERCISE_TYPE_* constant (the web maps these to names).
 * - `stagesJson`: [{"stage":"deep","start":"<iso>","end":"<iso>"}], same shape health_ingest takes.
 * - `detailsJson`: workout extras, see [Metrics] (WORKOUT DETAILS) for the shape; null for sleep unless noted.
 */
@Entity(tableName = "sessions", indices = [Index(value = ["kind", "start"])])
data class SessionEntity(
    @PrimaryKey val id: String,
    val kind: String,
    val start: Long,
    val end: Long,
    val title: String? = null,
    val exerciseType: Int? = null,
    val stagesJson: String = "[]",
    val detailsJson: String? = null,
    val source: String = Metrics.SOURCE,
)

/**
 * Something that changed locally and still has to reach Supabase.
 * `key` is "s:<metric>:<yyyy-mm-dd UTC>" for a metric-day of samples, or "x:<session id>".
 * The uploader sends the whole metric-day under record id "hb:<metric>:<yyyy-mm-dd>",
 * which health_ingest replaces as a unit, so replays are harmless.
 */
@Entity(tableName = "upload_queue")
data class PendingUpload(
    @PrimaryKey val key: String,
    val queuedAt: Long,
    val attempts: Int = 0,
)

/**
 * Raw activity files exactly as the watch sent them, so a parser fix can
 * re-parse history without the watch (which deletes files once acknowledged).
 * `fileId` is the 7-byte Xiaomi activity file id as lowercase hex.
 */
@Entity(tableName = "raw_files", indices = [Index(value = ["timestamp"])])
data class RawFileEntity(
    @PrimaryKey val fileId: String,
    val timestamp: Long,
    val type: Int,
    val subtype: Int,
    val detailType: Int,
    val version: Int,
    val fetchedAt: Long,
    val bytes: ByteArray,
    val parsed: Boolean,
    val parseError: String? = null,
)
