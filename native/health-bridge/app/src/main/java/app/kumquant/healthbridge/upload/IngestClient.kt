package app.kumquant.healthbridge.upload

import android.os.Build
import app.kumquant.healthbridge.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** POSTs one payload to PostgREST `rpc/health_ingest`, with the same endpoint and headers as the legacy uploader. */
object IngestClient {

    suspend fun post(payload: JSONObject) = withContext(Dispatchers.IO) {
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
        } finally {
            conn.disconnect()
        }
    }
}
