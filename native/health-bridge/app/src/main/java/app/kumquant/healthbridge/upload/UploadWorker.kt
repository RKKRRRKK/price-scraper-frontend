package app.kumquant.healthbridge.upload

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.kumquant.healthbridge.BridgeState
import app.kumquant.healthbridge.BuildConfig
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.data.HealthStore
import app.kumquant.healthbridge.data.PendingUpload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit

/**
 * Drains `upload_queue` to health_ingest(): every queued metric-day is sent whole
 * under `hb:<metric>:<day>` and every queued session under its own id, so replays
 * are harmless. Items leave the queue only after their request succeeded.
 *
 * Like the legacy Uploader, a record id is never split across requests and a
 * request carries about [BATCH_WEIGHT] points.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = lock.withLock {
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.HEALTH_TOKEN.isBlank()) {
            BridgeState.uploadFailed("health.properties was missing at build time.")
            return@withLock Result.failure()
        }
        try {
            val sent = drain()
            if (sent > 0) BridgeState.uploaded(System.currentTimeMillis())
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            BridgeState.uploadFailed(e.message ?: e.javaClass.simpleName)
            Result.retry()
        }
    }

    /** Sends everything queued; returns how many queue items were uploaded. */
    private suspend fun drain(): Int {
        val dao = HealthBridgeApp.db.sync()
        var total = 0
        while (true) {
            val items = dao.pending(PAGE)
            if (items.isEmpty()) return total

            var batch = Batch()
            for (item in items) {
                val record = build(item)
                if (record == null) {
                    dao.done(item.key, item.queuedAt)
                    continue
                }
                batch.add(item, record)
                if (batch.weight >= BATCH_WEIGHT) {
                    total += send(batch)
                    batch = Batch()
                }
            }
            total += send(batch)
        }
    }

    private suspend fun send(batch: Batch): Int {
        if (batch.items.isEmpty()) return 0
        val dao = HealthBridgeApp.db.sync()
        try {
            IngestClient.post(JSONObject().put("samples", batch.samples).put("sessions", batch.sessions))
        } catch (e: Exception) {
            batch.items.forEach { dao.failed(it.key) }
            throw e
        }
        batch.items.forEach { dao.done(it.key, it.queuedAt) }
        return batch.items.size
    }

    /** The JSON for one queue item, tagged with where it goes; null if its data no longer exists. */
    private suspend fun build(item: PendingUpload): Record? {
        val dao = HealthBridgeApp.db.sync()
        val key = item.key
        if (key.startsWith("s:")) {
            val body = key.removePrefix("s:")
            val cut = body.lastIndexOf(':')
            val metric = body.substring(0, cut)
            val day = body.substring(cut + 1)
            val from = LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            val samples = dao.samplesIn(metric, from, from + DAY_MS)
            if (samples.isEmpty()) return null
            // One record per source (e.g. imported Zepp Life weigh-ins next to the scale's own), each under its own id.
            val jsons = samples.groupBy { it.source }.map { (source, rows) ->
                val points = JSONArray()
                rows.forEach {
                    points.put(
                        JSONArray()
                            .put(Instant.ofEpochMilli(it.start).toString())
                            .put(it.end?.let { end -> Instant.ofEpochMilli(end).toString() } ?: JSONObject.NULL)
                            .put(it.value)
                    )
                }
                JSONObject()
                    .put("id", HealthStore.sampleRecordId(metric, day, source))
                    .put("metric", metric)
                    .put("source", source)
                    .put("points", points)
            }
            return Record(jsons, isSession = false, weight = samples.size)
        }
        if (key.startsWith("x:")) {
            val s = dao.session(key.removePrefix("x:")) ?: return null
            val json = JSONObject()
                .put("id", s.id)
                .put("kind", s.kind)
                .put("source", s.source)
                .put("start", Instant.ofEpochMilli(s.start).toString())
                .put("end", Instant.ofEpochMilli(s.end).toString())
                .put("title", s.title ?: JSONObject.NULL)
                .put("stages", JSONArray(s.stagesJson))
            s.exerciseType?.let { json.put("exercise_type", it) }
            s.detailsJson?.let { json.put("details", JSONObject(it)) }
            return Record(listOf(json), isSession = true, weight = SESSION_WEIGHT + (s.detailsJson?.length ?: 0) / 20)
        }
        return null
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, HealthBridgeApp.CHANNEL_LINK)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Uploading health data")
            .setOngoing(true)
            .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private class Record(val jsons: List<JSONObject>, val isSession: Boolean, val weight: Int)

    private class Batch {
        val items = mutableListOf<PendingUpload>()
        val samples = JSONArray()
        val sessions = JSONArray()
        var weight = 0

        fun add(item: PendingUpload, record: Record) {
            items += item
            record.jsons.forEach { (if (record.isSession) sessions else samples).put(it) }
            weight += record.weight
        }
    }

    companion object {
        private const val PERIODIC = "upload-periodic"
        private const val NOW = "upload-now"
        private const val NOTIFICATION_ID = 21
        private const val PAGE = 200
        private const val DAY_MS = 86_400_000L
        private const val SESSION_WEIGHT = 20

        /** Roughly one point per unit; ~3000 keeps a request well under 1 MB. */
        private const val BATCH_WEIGHT = 3000

        /** The periodic run and an expedited kick share the queue, so never overlap them. */
        private val lock = Mutex()

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(online)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Uploads now (as soon as there is a network) instead of waiting for the periodic run. */
        fun kick(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(online)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
        }
    }
}
