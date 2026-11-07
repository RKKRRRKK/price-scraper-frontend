package app.kumquant.healthbridge.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert

/** Writes from the watch and scale, plus the upload queue. Screens use [HealthQueries]. */
@Dao
interface SyncDao {
    @Upsert
    suspend fun upsertSamples(samples: List<SampleEntity>)

    @Upsert
    suspend fun upsertSessions(sessions: List<SessionEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(items: List<PendingUpload>)

    @Query("SELECT * FROM upload_queue ORDER BY queuedAt LIMIT :limit")
    suspend fun pending(limit: Int): List<PendingUpload>

    @Query("SELECT COUNT(*) FROM upload_queue")
    suspend fun pendingCount(): Int

    /** Removes the item only if nothing re-queued it while it was being sent. */
    @Query("DELETE FROM upload_queue WHERE `key` = :key AND queuedAt = :queuedAt")
    suspend fun done(key: String, queuedAt: Long)

    @Query("UPDATE upload_queue SET attempts = attempts + 1 WHERE `key` = :key")
    suspend fun failed(key: String)

    @Query("SELECT * FROM samples WHERE metric = :metric AND start >= :from AND start < :to ORDER BY start")
    suspend fun samplesIn(metric: String, from: Long, to: Long): List<SampleEntity>

    @Query("SELECT * FROM sessions WHERE id = :id")
    suspend fun session(id: String): SessionEntity?

    @Query("SELECT * FROM samples WHERE metric = :metric AND start < :before ORDER BY start DESC LIMIT 1")
    suspend fun latestBefore(metric: String, before: Long): SampleEntity?

    @Query("SELECT * FROM samples WHERE metric = :metric AND source = :source ORDER BY start")
    suspend fun samplesFrom(metric: String, source: String): List<SampleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putRawFile(file: RawFileEntity)

    @Query("SELECT * FROM raw_files WHERE fileId = :fileId")
    suspend fun rawFile(fileId: String): RawFileEntity?

    @Query("SELECT fileId FROM raw_files")
    suspend fun rawFileIds(): List<String>

    @Query("SELECT * FROM raw_files WHERE parsed = 0")
    suspend fun unparsedRawFiles(): List<RawFileEntity>
}
