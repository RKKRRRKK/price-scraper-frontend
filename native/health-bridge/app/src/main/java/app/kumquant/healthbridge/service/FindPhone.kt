package app.kumquant.healthbridge.service

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import app.kumquant.healthbridge.HealthBridgeApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * "Find my phone": rings the alarm stream at full volume (so silent mode and Do Not Disturb
 * don't mute it) in a loop with a vibration pattern, shows [FindPhoneActivity] over the lock
 * screen, and stops on request or after [TIMEOUT_MS].
 */
object FindPhone {
    private const val TAG = "HbFindPhone"
    private const val TIMEOUT_MS = 5 * 60_000L
    const val NOTIFICATION_ID = 22

    private val main = Handler(Looper.getMainLooper())
    private val _ringing = MutableStateFlow(false)
    val ringing: StateFlow<Boolean> = _ringing

    private var player: MediaPlayer? = null
    private var savedVolume = -1
    private var savedFilter = -1
    private val timeout = Runnable { stop(HealthBridgeApp.instance) }

    fun start(context: Context) = main.post { startNow(context.applicationContext) }

    /** [fromWatch] = the watch ended the search itself; otherwise the watch's "finding phone" screen is cleared too. */
    fun stop(context: Context, fromWatch: Boolean = false) = main.post {
        if (_ringing.value && !fromWatch) BridgeService.current?.stopFindPhoneOnWatch()
        stopNow(context.applicationContext)
    }

    private fun startNow(context: Context) {
        if (_ringing.value) return
        _ringing.value = true

        val audio = context.getSystemService(AudioManager::class.java)
        val nm = context.getSystemService(NotificationManager::class.java)

        if (nm.isNotificationPolicyAccessGranted && nm.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_NONE) {
            savedFilter = nm.currentInterruptionFilter
            runCatching { nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS) }
        }
        savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }

        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(attrs)
                setDataSource(context, uri)
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Log.w(TAG, "Alarm sound failed: ${it.message}") }.getOrNull()

        vibrator(context)?.let { v ->
            @Suppress("DEPRECATION")
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0), attrs)
        }

        nm.notify(NOTIFICATION_ID, notification(context))
        runCatching { context.startActivity(activityIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        main.postDelayed(timeout, TIMEOUT_MS)
        Log.i(TAG, "Ringing")
    }

    private fun stopNow(context: Context) {
        if (!_ringing.value) return
        _ringing.value = false
        main.removeCallbacks(timeout)

        player?.let { runCatching { it.stop(); it.release() } }
        player = null
        vibrator(context)?.cancel()

        val audio = context.getSystemService(AudioManager::class.java)
        if (savedVolume >= 0) runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0) }
        savedVolume = -1

        val nm = context.getSystemService(NotificationManager::class.java)
        if (savedFilter >= 0) runCatching { nm.setInterruptionFilter(savedFilter) }
        savedFilter = -1
        nm.cancel(NOTIFICATION_ID)
        Log.i(TAG, "Stopped")
    }

    private fun vibrator(context: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

    private fun activityIntent(context: Context) = Intent(context, FindPhoneActivity::class.java)

    private fun notification(context: Context): android.app.Notification {
        val open = PendingIntent.getActivity(
            context, 0, activityIntent(context), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            context, 1,
            Intent(context, BridgeService::class.java).setAction(BridgeService.ACTION_STOP_FIND_PHONE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(context, HealthBridgeApp.CHANNEL_ALARM)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Your watch is looking for this phone")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .addAction(0, "Stop", stop)
            .build()
    }
}
