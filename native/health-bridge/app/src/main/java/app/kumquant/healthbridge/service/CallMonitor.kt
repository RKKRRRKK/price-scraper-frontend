package app.kumquant.healthbridge.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.HealthBridgeApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Incoming-call alerts for the watch. RINGING → [BridgeService.incomingCall] (with the contact
 * name when READ_CONTACTS is granted); IDLE / OFFHOOK → [BridgeService.callEnded].
 *
 * Android 12+ gives [TelephonyCallback] no number, so a legacy listener runs beside it purely
 * to supply the number; the alert waits briefly for it.
 */
class CallMonitor(private val context: Context) {
    private val tm = context.getSystemService(TelephonyManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var lastNumber: String? = null
    private var alerting = false
    private var savedRinger = -1

    private var callback: Any? = null
    private var legacy: PhoneStateListener? = null

    fun start() {
        if (!hasPermission(context)) {
            Log.w(TAG, "READ_PHONE_STATE not granted; call alerts off")
            return
        }
        @Suppress("DEPRECATION")
        legacy = object : PhoneStateListener() {
            @Deprecated("Needed for the caller number")
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                if (!phoneNumber.isNullOrBlank()) lastNumber = phoneNumber
                if (Build.VERSION.SDK_INT < 31) handle(state)
            }
        }
        @Suppress("DEPRECATION")
        tm.listen(legacy, PhoneStateListener.LISTEN_CALL_STATE)

        if (Build.VERSION.SDK_INT >= 31) {
            val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(state: Int) = handle(state)
            }
            callback = cb
            tm.registerTelephonyCallback(ContextCompat.getMainExecutor(context), cb)
        }
    }

    fun stop() {
        @Suppress("DEPRECATION")
        legacy?.let { tm.listen(it, PhoneStateListener.LISTEN_NONE) }
        legacy = null
        if (Build.VERSION.SDK_INT >= 31) (callback as? TelephonyCallback)?.let { tm.unregisterTelephonyCallback(it) }
        callback = null
        scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    }

    private fun handle(state: Int) {
        val service = BridgeService.current ?: return
        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                if (!HealthBridgeApp.prefs.callAlerts || alerting) return
                alerting = true
                val wait = if (Build.VERSION.SDK_INT >= 31) 300L else 0L
                main.postDelayed({
                    if (!alerting) return@postDelayed
                    val number = lastNumber
                    scope.launch { service.incomingCall(contactName(number), number) }
                }, wait)
            }
            else -> {
                restoreRinger()
                if (alerting) {
                    alerting = false
                    lastNumber = null
                    service.callEnded()
                }
            }
        }
    }

    private suspend fun contactName(number: String?): String? {
        if (number.isNullOrBlank()) return null
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
                context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
                    ?.use { if (it.moveToFirst()) it.getString(0) else null }
            }.getOrNull()
        }
    }

    /** Watch → hang up. Needs ANSWER_PHONE_CALLS. */
    fun reject() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "ANSWER_PHONE_CALLS not granted; cannot reject")
            return
        }
        @Suppress("DEPRECATION")
        runCatching { context.getSystemService(TelecomManager::class.java).endCall() }
            .onFailure { Log.w(TAG, "endCall failed: ${it.message}") }
    }

    /**
     * Watch → silence the ringer. silenceRinger() is system-only for most apps, so fall back to
     * muting the ringer until the call state changes (needs Do Not Disturb access).
     */
    fun silence() {
        val ok = runCatching { context.getSystemService(TelecomManager::class.java).silenceRinger() }.isSuccess
        if (ok) return
        val audio = context.getSystemService(AudioManager::class.java)
        runCatching {
            if (savedRinger < 0) savedRinger = audio.ringerMode
            audio.ringerMode = AudioManager.RINGER_MODE_SILENT
        }.onFailure { Log.w(TAG, "Could not silence ringer: ${it.message}") }
    }

    private fun restoreRinger() {
        if (savedRinger < 0) return
        val audio = context.getSystemService(AudioManager::class.java)
        runCatching { audio.ringerMode = savedRinger }
        savedRinger = -1
    }

    companion object {
        private const val TAG = "HbCalls"

        fun hasPermission(context: Context) =
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
    }
}
