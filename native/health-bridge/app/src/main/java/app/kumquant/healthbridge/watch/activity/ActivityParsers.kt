package app.kumquant.healthbridge.watch.activity

import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.data.SessionEntity
import app.kumquant.healthbridge.watch.activity.impl.DailyDetailsParser
import app.kumquant.healthbridge.watch.activity.impl.DailySummaryParser
import app.kumquant.healthbridge.watch.activity.impl.ManualSamplesParser
import app.kumquant.healthbridge.watch.activity.impl.Sleep
import app.kumquant.healthbridge.watch.activity.impl.SleepDetailsParser
import app.kumquant.healthbridge.watch.activity.impl.SleepStagesParser
import app.kumquant.healthbridge.watch.activity.impl.WorkoutDetailsParser
import app.kumquant.healthbridge.watch.activity.impl.WorkoutGpsParser
import app.kumquant.healthbridge.watch.activity.impl.WorkoutSummaryParser
import org.json.JSONArray
import org.json.JSONObject

/** What one activity file yields: samples to upsert and sessions to merge via [ActivityParsers.mergeSession]. */
data class ParsedActivity(val samples: List<SampleEntity>, val sessions: List<SessionEntity>)

/** Thrown for corrupt, unknown or unsupported files; the message names the file and shows its first bytes. */
class ActivityParseException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Parsers for the watch's activity files, ported from Gadgetbridge's `service/devices/xiaomi/activity`.
 * All times in the output are UTC epoch milliseconds; the file id timestamp is already UTC epoch seconds.
 * The parsers are pure (no Android APIs besides org.json, no database).
 *
 * `data` is the whole file as Gadgetbridge hands it to its parsers: the 7 id bytes, one padding byte, the
 * payload and the trailing CRC32. The CRC is not checked here (the fetcher does that).
 * An unknown subtype, detail type or version, a truncated file or an unknown layout throws
 * [ActivityParseException] so the caller keeps the raw file and can re-parse after a fix.
 *
 * Session id rules (the Python port must match):
 *  - exercise: `hb:exercise:<file id timestamp, epoch s>`, the same for the SUMMARY, DETAILS and GPS_TRACK files
 *    of one workout (they share the timestamp).
 *  - sleep: `hb:sleep:<bedtime, epoch s>`, with the bedtime read from inside the file. Both the sleep details
 *    file (ACTIVITY_SLEEP, any detail type) and the sleep stages file (ACTIVITY_SLEEP_STAGES) carry the bedtime
 *    and key Gadgetbridge's XiaomiSleepTimeSample on it too, so they converge; a night re-sent later with a
 *    later wake-up keeps the id. A night whose wake-up is not after its bedtime yields no session yet.
 *
 * Sleep stages: stage names awake / light / deep / rem; each stage runs to the next change, the last to
 * wake-up; time before the first stage is light; codes 0 (not asleep) and 1 (unknown) count as awake; the stage
 * in effect at bedtime is clipped to start there. stagesJson times are ISO-8601 UTC (`Instant.toString`).
 *
 * [mergeSession] rules (existing = stored row, incoming = freshly parsed):
 *  - id, kind, source: incoming.
 *  - start = min of both, end = max of both (a known range never shrinks).
 *  - title, exerciseType: incoming if not null, else existing.
 *  - stagesJson: the one whose stages cover more time; incoming on a tie.
 *  - detailsJson: key by key, union of both objects; incoming wins when its value is non-null and not an empty
 *    array/object, otherwise existing is kept. Keys are written in sorted order; an empty result is null.
 */
object ActivityParsers {
    private const val MIN_FILE_SIZE = 13

    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        try {
            if (data.size < MIN_FILE_SIZE) throw ActivityParseException("file too short: ${data.size} bytes")
            return dispatch(id, data)
        } catch (e: Exception) {
            val why = if (e is ActivityParseException) e.message else "${e.javaClass.simpleName}: ${e.message}"
            val head = data.take(48).joinToString(" ") { "%02x".format(it) }
            throw ActivityParseException("${id.describe()}: $why [${data.size} bytes: $head]", e)
        }
    }

    private fun dispatch(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val detail = id.detailType
        return when (id.type) {
            ActivityFileId.TYPE_ACTIVITY -> when (id.subtype) {
                ActivityFileId.ACTIVITY_DAILY -> when (detail) {
                    ActivityFileId.DETAIL_DETAILS -> DailyDetailsParser.parse(id, data)
                    ActivityFileId.DETAIL_SUMMARY -> DailySummaryParser.parse(id, data)
                    else -> noParser(id)
                }
                ActivityFileId.ACTIVITY_SLEEP_STAGES ->
                    if (detail == ActivityFileId.DETAIL_DETAILS) SleepStagesParser.parse(id, data) else noParser(id)
                ActivityFileId.ACTIVITY_MANUAL_SAMPLES ->
                    if (detail == ActivityFileId.DETAIL_DETAILS) ManualSamplesParser.parse(id, data) else noParser(id)
                ActivityFileId.ACTIVITY_SLEEP -> SleepDetailsParser.parse(id, data)
                else -> noParser(id)
            }
            ActivityFileId.TYPE_SPORTS -> when (detail) {
                ActivityFileId.DETAIL_SUMMARY -> WorkoutSummaryParser.parse(id, data)
                ActivityFileId.DETAIL_GPS_TRACK -> WorkoutGpsParser.parse(id, data)
                ActivityFileId.DETAIL_DETAILS -> WorkoutDetailsParser.parse(id, data)
                else -> noParser(id)
            }
            else -> noParser(id)
        }
    }

    private fun noParser(id: ActivityFileId): Nothing = throw ActivityParseException("no parser for this file type")

    fun mergeSession(existing: SessionEntity?, incoming: SessionEntity): SessionEntity {
        if (existing == null) return incoming
        val stages = if (Sleep.coverageMs(incoming.stagesJson) >= Sleep.coverageMs(existing.stagesJson)) {
            incoming.stagesJson
        } else {
            existing.stagesJson
        }
        return incoming.copy(
            start = minOf(existing.start, incoming.start),
            end = maxOf(existing.end, incoming.end),
            title = incoming.title ?: existing.title,
            exerciseType = incoming.exerciseType ?: existing.exerciseType,
            stagesJson = stages,
            detailsJson = mergeDetails(existing.detailsJson, incoming.detailsJson),
        )
    }

    private fun mergeDetails(existing: String?, incoming: String?): String? {
        val old = parseObject(existing)
        val new = parseObject(incoming)
        if (old == null && new == null) return null
        val keys = ((old?.keys()?.asSequence() ?: emptySequence()) + (new?.keys()?.asSequence() ?: emptySequence())).toSortedSet()
        val out = JSONObject()
        for (key in keys) {
            val inc = new?.opt(key)
            val o = old?.opt(key)
            val value = when {
                usable(inc) -> inc
                usable(o) -> o
                inc != null && inc != JSONObject.NULL -> inc
                else -> o
            }
            if (value != null && value != JSONObject.NULL) out.put(key, value)
        }
        return if (out.length() == 0) null else out.toString()
    }

    /** A value that may replace another: present, and not an empty array or object. */
    private fun usable(v: Any?): Boolean = when (v) {
        null, JSONObject.NULL -> false
        is JSONArray -> v.length() > 0
        is JSONObject -> v.length() > 0
        else -> true
    }

    private fun parseObject(json: String?): JSONObject? = try {
        if (json == null) null else JSONObject(json)
    } catch (e: Exception) {
        null
    }
}
