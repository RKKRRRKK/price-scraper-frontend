package app.kumquant.healthbridge.legacy

import android.os.Build
import app.kumquant.healthbridge.BuildConfig
import androidx.health.connect.client.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Collects records and posts them to health_ingest() in batches.
 *
 * A record is never split across two requests: the server replaces everything
 * it holds for each record id in a batch, so a split heart-rate series would
 * have its first half wiped by the second.
 */
class Uploader {
    private var samples = JSONArray()
    private var sessions = JSONArray()
    private var deleted = JSONArray()
    private var weight = 0

    var sentSamples = 0
        private set
    var sentSessions = 0
        private set
    var sentDeleted = 0
        private set
    private var requests = 0

    suspend fun add(record: Record) {
        Payload.sample(record)?.let {
            samples.put(it)
            weight += it.getJSONArray("points").length()
        } ?: Payload.session(record)?.let {
            sessions.put(it)
            weight += 20
        }
        if (weight >= BATCH_WEIGHT) flush()
    }

    suspend fun delete(recordId: String) {
        deleted.put(recordId)
        weight += 1
        if (weight >= BATCH_WEIGHT) flush()
    }

    suspend fun flush() {
        if (weight == 0) return
        send(JSONObject().put("samples", samples).put("sessions", sessions).put("deleted", deleted))
        samples = JSONArray()
        sessions = JSONArray()
        deleted = JSONArray()
        weight = 0
    }

    /** An empty call still stamps last_used_at, which the web app shows as "last sync". */
    suspend fun pingIfIdle() {
        if (requests == 0) send(JSONObject())
    }

    fun summary() = "$sentSamples samples, $sentSessions sessions, $sentDeleted deletions"

    private suspend fun send(payload: JSONObject) = withContext(Dispatchers.IO) {
        val anonKey = BuildConfig.SUPABASE_ANON_KEY
        val url = URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/rest/v1/rpc/health_ingest")
        val body = JSONObject()
            .put("p_token", BuildConfig.HEALTH_TOKEN)
            .put("p_device", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("p_payload", payload)
            .toString()

        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("apikey", anonKey)
            conn.setRequestProperty("Authorization", "Bearer $anonKey")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray()) }

            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw IOException("HTTP $code: ${text.take(300)}")

            val result = JSONObject(text)
            sentSamples += result.optInt("samples")
            sentSessions += result.optInt("sessions")
            sentDeleted += result.optInt("deleted")
            requests++
        } finally {
            conn.disconnect()
        }
    }

    private companion object {
        /** Roughly one point per unit; ~3000 keeps a request well under 1 MB. */
        const val BATCH_WEIGHT = 3000
    }
}
