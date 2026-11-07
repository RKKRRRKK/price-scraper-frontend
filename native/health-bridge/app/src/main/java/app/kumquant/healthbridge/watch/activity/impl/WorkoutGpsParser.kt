package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SessionEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToLong

/**
 * Workout GPS track (SPORTS / any subtype / GPS_TRACK, versions 1-3). Ported from Gadgetbridge's
 * WorkoutGpsParser. After a 1-byte header the samples are
 *  - v1 (12 B): i32 time (epoch s), f32 longitude, f32 latitude
 *  - v2 (18 B): v1 + f32 accuracy (m) + u16 speed/source
 *  - v3 (26 B): v2 + f32 altitude (m) + f32 hdop
 *
 * Output: session `hb:exercise:<file id timestamp>` with start/end = first/last fix and detailsJson
 * `gps` [[epoch s, lat, lon, alt m or null]] (6 decimals; altitude only in v3). Fixes at 0,0 ("Null Island", what
 * indoor workouts record) and NaN fixes are dropped; a file with nothing left (the 13-byte indoor placeholder)
 * yields nothing.
 */
internal object WorkoutGpsParser {
    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val sampleSize = when (id.version) {
            1 -> 12
            2 -> 18
            3 -> 26
            else -> unsupportedVersion("workout gps", id.version)
        }
        val buf = littleEndian(data).dropCrc()
        buf.skipFileId()
        buf.get() // header

        val gps = JSONArray()
        var first = Long.MAX_VALUE
        var last = Long.MIN_VALUE
        while (buf.remaining() >= sampleSize) {
            val t = buf.getInt().toLong() and 0xFFFFFFFFL
            val lon = buf.getFloat().toDouble()
            val lat = buf.getFloat().toDouble()
            var alt: Double? = null
            if (id.version == 2) {
                buf.skip(6)
            } else if (id.version == 3) {
                buf.skip(6)
                alt = buf.getFloat().toDouble()
                buf.skip(4)
            }
            if (lat.isNaN() || lon.isNaN() || (lat == 0.0 && lon == 0.0)) continue
            val point = JSONArray().put(t).put(round(lat, 1_000_000.0)).put(round(lon, 1_000_000.0))
            if (alt != null && !alt.isNaN()) point.put(round(alt, 10.0)) else point.put(JSONObject.NULL)
            gps.put(point)
            first = minOf(first, t)
            last = maxOf(last, t)
        }
        if (gps.length() == 0) return ParsedActivity(emptyList(), emptyList())

        val session = SessionEntity(
            id = WorkoutSummaryParser.exerciseId(id.timestamp),
            kind = Metrics.KIND_EXERCISE,
            start = first * 1000L,
            end = last * 1000L,
            detailsJson = JSONObject().put("gps", gps).toString(),
        )
        return ParsedActivity(emptyList(), listOf(session))
    }

    private fun round(x: Double, scale: Double) = (x * scale).roundToLong() / scale
}
