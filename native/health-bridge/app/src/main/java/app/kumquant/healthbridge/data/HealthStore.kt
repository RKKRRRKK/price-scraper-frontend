package app.kumquant.healthbridge.data

import androidx.room.withTransaction
import java.time.Instant
import java.time.ZoneOffset

/**
 * The one way to put health data on the phone: stores it and queues the
 * affected metric-days / sessions for upload in the same transaction.
 */
class HealthStore(private val db: HealthDatabase) {

    suspend fun write(samples: List<SampleEntity> = emptyList(), sessions: List<SessionEntity> = emptyList()) {
        if (samples.isEmpty() && sessions.isEmpty()) return
        val now = System.currentTimeMillis()
        val keys = samples.map { sampleKey(it.metric, it.start) }.toSet() + sessions.map { "x:${it.id}" }
        db.withTransaction {
            if (samples.isNotEmpty()) db.sync().upsertSamples(samples)
            if (sessions.isNotEmpty()) db.sync().upsertSessions(sessions)
            db.sync().enqueue(keys.map { PendingUpload(it, now) })
        }
    }

    companion object {
        /** UTC day of an epoch-ms time, "yyyy-mm-dd". */
        fun utcDay(epochMs: Long): String = Instant.ofEpochMilli(epochMs).atOffset(ZoneOffset.UTC).toLocalDate().toString()

        fun sampleKey(metric: String, start: Long) = "s:$metric:${utcDay(start)}"

        /** Server record id for a metric-day of samples from one source ("hb:" for Health Bridge's own). */
        fun sampleRecordId(metric: String, utcDay: String, source: String = Metrics.SOURCE) =
            if (source == Metrics.SOURCE) "hb:$metric:$utcDay" else "$source:$metric:$utcDay"
    }
}
