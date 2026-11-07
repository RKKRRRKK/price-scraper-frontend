package app.kumquant.healthbridge.service

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.watch.PhoneNotification

/**
 * Mirrors phone notifications to the watch, and also hosts the media-session tracking
 * ([MusicBridge]) because only a notification listener may read other apps' sessions.
 */
class NotificationForwarder : NotificationListenerService() {

    /** Keys already sent, so a removal is only forwarded for something the watch has. */
    private val sent = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val lastSeen = HashMap<String, Pair<String, Long>>()
    private val appNames = HashMap<String, String>()

    var music: MusicBridge? = null
        private set

    override fun onListenerConnected() {
        current = this
        music = MusicBridge(this, ComponentName(this, NotificationForwarder::class.java)) { np ->
            BridgeService.current?.nowPlaying(np)
        }.also { it.start() }
        Log.i(TAG, "Listener connected")
    }

    override fun onListenerDisconnected() {
        music?.stop()
        music = null
        if (current === this) current = null
    }

    override fun onDestroy() {
        music?.stop()
        if (current === this) current = null
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val service = BridgeService.current ?: return
        val prefs = HealthBridgeApp.prefs
        if (!prefs.forwardNotifications || !service.isConnected) return

        val n = sbn.notification
        if (sbn.packageName == packageName || sbn.isOngoing) return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (n.category == Notification.CATEGORY_CALL || n.category == Notification.CATEGORY_TRANSPORT) return
        if (n.extras.getString(Notification.EXTRA_TEMPLATE)?.contains("MediaStyle") == true) return
        if (sbn.packageName in prefs.disabledApps) return

        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val body = (n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString().orEmpty()
        if (title.isBlank() && body.isBlank()) return

        val text = "$title\u0000$body"
        val now = System.currentTimeMillis()
        val prev = lastSeen[sbn.key]
        if (prev != null && prev.first == text && now - prev.second < DUPLICATE_MS) return
        lastSeen[sbn.key] = text to now

        sent += sbn.key
        service.forward(PhoneNotification(sbn.key, sbn.packageName, appName(sbn.packageName), title, body, sbn.postTime))
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        lastSeen.remove(sbn.key)
        if (sent.remove(sbn.key)) BridgeService.current?.dismiss(sbn.key)
    }

    /** The watch dismissed it: clear it here too. */
    fun dismissFromWatch(key: String) {
        sent.remove(key)
        runCatching { cancelNotification(key) }
    }

    private fun appName(pkg: String) = appNames.getOrPut(pkg) {
        runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }
            .getOrDefault(pkg)
    }

    companion object {
        private const val TAG = "HbNotifications"
        private const val DUPLICATE_MS = 2_000L

        @Volatile var current: NotificationForwarder? = null
            private set

        fun hasAccess(context: android.content.Context) =
            androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }
}
