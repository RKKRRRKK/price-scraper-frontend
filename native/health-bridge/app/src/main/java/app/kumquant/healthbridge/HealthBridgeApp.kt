package app.kumquant.healthbridge

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.room.InvalidationTracker
import app.kumquant.healthbridge.data.HealthDatabase
import app.kumquant.healthbridge.legacy.SyncWorker
import app.kumquant.healthbridge.upload.UploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** App-wide singletons (settings, database), notification channels and the periodic upload. */
class HealthBridgeApp : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = AppPrefs(this)
        BridgeState.restore(prefs)
        createChannels()

        scope.launch {
            db.invalidationTracker.addObserver(object : InvalidationTracker.Observer("upload_queue") {
                override fun onInvalidated(tables: Set<String>) {
                    scope.launch { BridgeState.setPending(db.sync().pendingCount()) }
                }
            })
            BridgeState.setPending(db.sync().pendingCount())
        }

        UploadWorker.schedule(this)
        applyLegacySetting(this)
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_LINK, "Watch link", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while Health Bridge is connected to the watch."
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALARM, "Find my phone", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Rings when the watch is looking for this phone."
                setSound(null, null)
                enableVibration(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROBLEMS, "Problems", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Something needs attention, for example the watch key was rejected."
            }
        )
    }

    companion object {
        const val CHANNEL_LINK = "watch_link"
        const val CHANNEL_ALARM = "find_phone"
        const val CHANNEL_PROBLEMS = "problems"

        lateinit var instance: HealthBridgeApp
            private set
        lateinit var prefs: AppPrefs
            private set

        val db: HealthDatabase get() = HealthDatabase.get(instance)

        /** Process-wide scope for work that must outlive a screen. */
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        /** Schedules or cancels the legacy Health Connect worker to match the Settings toggle. */
        fun applyLegacySetting(context: android.content.Context) {
            if (prefs.readHealthConnect) SyncWorker.schedule(context) else SyncWorker.cancel(context)
        }
    }
}
