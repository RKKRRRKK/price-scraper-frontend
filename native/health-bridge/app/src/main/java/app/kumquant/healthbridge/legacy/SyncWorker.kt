package app.kumquant.healthbridge.legacy

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.kumquant.healthbridge.HealthBridgeApp
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit
import kotlin.reflect.KClass

/**
 * Pushes new Health Connect data to Supabase. Legacy path: scheduled only
 * while Settings → "Also read Health Connect" is on.
 *
 * First run: takes a changes token, then backfills the last 30 days (the most
 * Health Connect lets an app read without the history permission). After that:
 * only the change feed since the stored token, so late writes (last night's
 * sleep landing at 9am) and deletions arrive too. The token only advances once
 * its changes are uploaded, so a failed run replays them next time.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        if (!HealthBridgeApp.prefs.readHealthConnect) return Result.success()
        val prefs = LegacyPrefs(applicationContext)
        return try {
            val out = lock.withLock { sync(prefs) }
            prefs.addTotals(out.sentSamples, out.sentSessions)
            prefs.recordResult("OK — ${out.summary()}")
            Result.success()
        } catch (e: SecurityException) {
            prefs.recordResult("Health Connect access missing: ${e.message}")
            Result.failure()
        } catch (e: Exception) {
            prefs.recordResult("Failed: ${e.message}")
            Result.retry()
        }
    }

    private suspend fun sync(prefs: LegacyPrefs): Uploader {
        val client = HealthConnectClient.getOrCreate(applicationContext)
        val granted = client.permissionController.getGrantedPermissions()
        val types = RECORD_TYPES.filter { HealthPermission.getReadPermission(it) in granted }.toSet()
        if (types.isEmpty()) throw SecurityException("no data types granted")

        // A token only covers the types it was made for; granting more means a new backfill.
        val signature = types.mapNotNull { it.simpleName }.sorted().joinToString(",")
        val out = Uploader()
        var token = prefs.changesToken.takeIf { prefs.tokenTypes == signature }

        while (true) {
            if (token == null) {
                // Take the token before reading so anything written mid-backfill still arrives as a change.
                val fresh = client.getChangesToken(ChangesTokenRequest(types))
                backfill(client, types, out)
                out.flush()
                prefs.saveToken(fresh, signature)
                token = fresh
            }

            val res = client.getChanges(token!!)
            if (res.changesTokenExpired) {
                token = null
                continue
            }
            for (change in res.changes) {
                when (change) {
                    is UpsertionChange -> out.add(change.record)
                    is DeletionChange -> out.delete(change.recordId)
                }
            }
            out.flush()
            token = res.nextChangesToken
            prefs.saveToken(token, signature)
            if (!res.hasMore) break
        }

        out.pingIfIdle()
        return out
    }

    private suspend fun backfill(client: HealthConnectClient, types: Set<KClass<out Record>>, out: Uploader) {
        val end = Instant.now()
        val range = TimeRangeFilter.between(end.minus(BACKFILL_DAYS, ChronoUnit.DAYS), end)
        for (type in types) {
            @Suppress("UNCHECKED_CAST")
            val recordType = type as KClass<Record>
            var page: String? = null
            do {
                val res = client.readRecords(
                    ReadRecordsRequest(recordType, range, pageSize = 1000, pageToken = page)
                )
                res.records.forEach { out.add(it) }
                page = res.pageToken
            } while (page != null)
        }
    }

    companion object {
        private const val PERIODIC = "health-sync"
        private const val NOW = "health-sync-now"
        private const val BACKFILL_DAYS = 30L

        /** The periodic run and a "Sync now" share one changes token, so never overlap them. */
        private val lock = Mutex()

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(online)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(NOW)
        }

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
        }
    }
}
