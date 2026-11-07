package app.kumquant.healthbridge.legacy

import android.content.Context
import android.content.SharedPreferences

/** Health Connect sync state that survives restarts: the changes token and the last result. */
class LegacyPrefs(context: Context) {
    val prefs: SharedPreferences = context.getSharedPreferences("health-bridge", Context.MODE_PRIVATE)

    val changesToken: String? get() = prefs.getString(KEY_TOKEN, null)
    val tokenTypes: String? get() = prefs.getString(KEY_TOKEN_TYPES, null)
    val lastResult: String? get() = prefs.getString(KEY_RESULT, null)
    val lastAt: Long get() = prefs.getLong(KEY_AT, 0)
    val totalSamples: Long get() = prefs.getLong(KEY_TOTAL_SAMPLES, 0)
    val totalSessions: Long get() = prefs.getLong(KEY_TOTAL_SESSIONS, 0)

    fun saveToken(token: String, types: String) {
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_TOKEN_TYPES, types).apply()
    }

    /** Running totals, so a quiet run ("0 samples") doesn't hide what earlier runs sent. */
    fun addTotals(samples: Int, sessions: Int) {
        prefs.edit()
            .putLong(KEY_TOTAL_SAMPLES, totalSamples + samples)
            .putLong(KEY_TOTAL_SESSIONS, totalSessions + sessions)
            .apply()
    }

    fun recordResult(text: String) {
        prefs.edit().putString(KEY_RESULT, text).putLong(KEY_AT, System.currentTimeMillis()).apply()
    }

    companion object {
        private const val KEY_TOKEN = "changes_token"
        private const val KEY_TOKEN_TYPES = "changes_token_types"
        const val KEY_RESULT = "last_result"
        private const val KEY_AT = "last_at"
        private const val KEY_TOTAL_SAMPLES = "total_samples"
        private const val KEY_TOTAL_SESSIONS = "total_sessions"
    }
}
