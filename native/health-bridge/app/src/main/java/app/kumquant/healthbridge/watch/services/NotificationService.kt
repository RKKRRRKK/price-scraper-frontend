package app.kumquant.healthbridge.watch.services

import app.kumquant.healthbridge.proto.xiaomi.Notification
import app.kumquant.healthbridge.proto.xiaomi.Notification2
import app.kumquant.healthbridge.proto.xiaomi.Notification3
import app.kumquant.healthbridge.proto.xiaomi.NotificationDismiss
import app.kumquant.healthbridge.proto.xiaomi.NotificationId
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.CommandChannel
import app.kumquant.healthbridge.watch.PhoneNotification
import app.kumquant.healthbridge.watch.WatchListener
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.XiaomiService
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Phone notifications and calls on the watch (command type 7). Ported from the relevant parts of
 * Gadgetbridge's XiaomiNotificationService.
 *
 * The watch identifies notifications by a numeric id, the phone by `StatusBarNotification` key, so
 * this keeps a bounded id-to-key map to translate dismissals coming back from the watch.
 * App icons (the watch's icon query and upload) are not served; the watch shows its generic icon.
 */
internal class NotificationService(
    private val channel: CommandChannel,
    private val listener: WatchListener,
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) : XiaomiService(COMMAND_TYPE) {

    private class Sent(val key: String, val packageName: String)

    private val sent = object : LinkedHashMap<Int, Sent>(16, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Sent>?) = size > MAX_TRACKED
    }
    private var nextId = 1

    fun send(n: PhoneNotification) {
        val id: Int
        synchronized(sent) {
            id = nextId++
            sent[id] = Sent(n.key, n.packageName)
        }
        channel.send(sendCommand(n, id, zone()))
    }

    /** Dismisses every notification previously sent for [key]. */
    fun dismiss(key: String) {
        val ids: List<Pair<Int, Sent>>
        synchronized(sent) {
            ids = sent.entries.filter { it.value.key == key }.map { it.key to it.value }
            ids.forEach { sent.remove(it.first) }
        }
        if (ids.isEmpty()) {
            WatchLog.d("dismiss: nothing sent for key $key")
            return
        }
        channel.send(dismissCommand(ids.map { (id, s) -> NotificationId.newBuilder().setId(id).setPackage(s.packageName).setKey(s.key).build() }))
    }

    fun incomingCall(callerName: String?, number: String?) =
        channel.send(callCommand(callerName, number, zone()))

    fun callEnded() = channel.send(dismissCommand(listOf(NotificationId.newBuilder().setId(CALL_ID).setPackage(CALL_PACKAGE).build())))

    override fun handle(cmd: XiaomiProto.Command) {
        when (cmd.subtype) {
            CMD_NOTIFICATION_DISMISS -> {
                val ids = cmd.notification.notificationDismiss.notificationIdList
                WatchLog.i("watch dismissed ${ids.size} notification(s)")
                for (id in ids) {
                    val key = synchronized(sent) { sent.remove(id.id)?.key }
                    if (key != null) listener.onNotificationDismissed(key) else WatchLog.d("watch dismissed unknown notification id ${id.id}")
                }
            }
            CMD_CALL_REJECT -> {
                WatchLog.i("watch rejected the call")
                listener.onCallAction(reject = true)
            }
            CMD_CALL_IGNORE -> {
                WatchLog.i("watch muted the call")
                listener.onCallAction(reject = false)
            }
            CMD_CALL_REPLY_SEND -> {
                // We announce calls as not replyable, so this should not happen; refuse politely.
                WatchLog.w("watch sent a canned call reply, which is not supported: ${cmd.notification.notificationReply}")
                channel.send(
                    XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_CALL_REPLY_ACK)
                        .setNotification(Notification.newBuilder().setNotificationReplyStatus(1))
                        .build(),
                )
            }
            CMD_OPEN_ON_PHONE -> WatchLog.i("watch asked to open notification ${cmd.notification.openOnPhone.id} on the phone (not handled)")
            CMD_NOTIFICATION_ICON_QUERY, CMD_NOTIFICATION_ICON_REQUEST ->
                WatchLog.d("watch wants an app icon (${cmd.notification.notificationIconQuery.`package`}), not served")
            CMD_SCREEN_ON_ON_NOTIFICATIONS_GET, CMD_CANNED_MESSAGES_GET, CMD_NOTIFICATION_SEND, CMD_SCREEN_ON_ON_NOTIFICATIONS_SET, CMD_CANNED_MESSAGES_SET ->
                WatchLog.d("notification service reply ${cmd.subtype}, status=${if (cmd.hasStatus()) cmd.status else 0}")
            else -> WatchLog.w("unhandled notification command ${cmd.subtype}: $cmd")
        }
    }

    companion object {
        const val COMMAND_TYPE = 7

        const val CMD_NOTIFICATION_SEND = 0
        const val CMD_NOTIFICATION_DISMISS = 1
        const val CMD_CALL_REJECT = 2
        const val CMD_CALL_IGNORE = 5
        const val CMD_SCREEN_ON_ON_NOTIFICATIONS_GET = 6
        const val CMD_SCREEN_ON_ON_NOTIFICATIONS_SET = 7
        const val CMD_OPEN_ON_PHONE = 8
        const val CMD_CANNED_MESSAGES_GET = 9
        const val CMD_CANNED_MESSAGES_SET = 12
        const val CMD_CALL_REPLY_SEND = 13
        const val CMD_CALL_REPLY_ACK = 14
        const val CMD_NOTIFICATION_ICON_REQUEST = 15
        const val CMD_NOTIFICATION_ICON_QUERY = 16

        const val CALL_ID = 0
        const val CALL_PACKAGE = "phone"
        private const val MAX_TRACKED = 128

        private val TIMESTAMP = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss", Locale.ROOT)

        private fun timestamp(epochMs: Long, zone: ZoneId) = TIMESTAMP.format(Instant.ofEpochMilli(epochMs).atZone(zone))

        /**
         * The watch shows nothing for a notification without a body, so title and body are always set,
         * empty if need be. `key` plus `openOnPhone` give the "open on phone" action.
         */
        fun sendCommand(n: PhoneNotification, id: Int, zone: ZoneId): XiaomiProto.Command {
            val n3 = Notification3.newBuilder()
                .setId(id)
                .setUnknown4("")
                .setTimestamp(timestamp(n.postedAt, zone))
                .setPackage(n.packageName)
                .setAppName(n.appName.ifBlank { n.packageName })
                .setTitle(WatchEmoji.filter(n.title))
                .setBody(WatchEmoji.filter(n.body))
                .setKey(n.key)
                .setOpenOnPhone(true)
            return wrap(CMD_NOTIFICATION_SEND, Notification.newBuilder().setNotification2(Notification2.newBuilder().setNotification3(n3)))
        }

        fun callCommand(name: String?, number: String?, zone: ZoneId, nowMs: Long = System.currentTimeMillis()): XiaomiProto.Command {
            val n3 = Notification3.newBuilder()
                .setId(CALL_ID)
                .setUnknown4("")
                .setIsCall(true)
                .setRepliesAllowed(false)
                .setTimestamp(timestamp(nowMs, zone))
                .setPackage(CALL_PACKAGE)
                .setAppName(CALL_PACKAGE)
                .setTitle(WatchEmoji.filter(name?.takeIf { it.isNotBlank() } ?: "?"))
                .setBody(number?.takeIf { it.isNotBlank() } ?: "?")
            return wrap(CMD_NOTIFICATION_SEND, Notification.newBuilder().setNotification2(Notification2.newBuilder().setNotification3(n3)))
        }

        fun dismissCommand(ids: List<NotificationId>): XiaomiProto.Command =
            wrap(CMD_NOTIFICATION_DISMISS, Notification.newBuilder().setNotificationDismiss(NotificationDismiss.newBuilder().addAllNotificationId(ids)))

        private fun wrap(subtype: Int, notification: Notification.Builder): XiaomiProto.Command =
            XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(subtype).setNotification(notification).build()
    }
}
