package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SessionEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity
import org.json.JSONArray
import org.json.JSONObject
import java.nio.BufferUnderflowException
import java.nio.ByteBuffer
import kotlin.math.roundToLong

/** One per-second record of a workout details file; fields are null where the layout has none. */
internal class WorkoutRecord(
    var ts: Int = 0,
    var hr: Int = 0,
    var steps: Int? = null,
    var spo2: Int? = null,
    var cadence: Int? = null,
    var speedRaw: Int? = null,
    var speedMps: Float? = null,
    var distanceDm: Int? = null,
    var paceSecPerKm: Int? = null,
)

/**
 * Workout details (SPORTS / any subtype / DETAILS): a per-second record stream. Ported from Gadgetbridge's
 * WorkoutDetailsParser, whose layouts are keyed on the file version plus the bitmap signature at offset 8
 * (outdoor run/walk v5/v8 are driven by the bitmap itself). Anything else throws, so the raw file is kept.
 *
 * Output: a session `hb:exercise:<file id timestamp>` whose start/end are the first and last record time (the
 * summary file widens them on merge) and whose detailsJson holds `hr` [[epoch s, bpm]], and when the layout has
 * them `cadence` [[epoch s, steps or strokes per minute]] and `speed_mps` [[epoch s, m/s]]. Heart rate 0 and 255
 * are skipped. A file without a single record yields nothing.
 */
internal object WorkoutDetailsParser {
    private val RUN_WALK_GROUP_BYTES = intArrayOf(1, 1, 1, 1, 1, 4, 1, 1, 2, 2, 2, 2, 2)
    private const val GROUP_STEPS = 0
    private const val GROUP_HR = 1
    private const val GROUP_DISTANCE = 3
    private const val GROUP_CADENCE = 7
    private const val GROUP_PACE = 8
    private const val SPEED_WINDOW = 5

    private val FREESTYLE_V3_BITMAP = bytesOf(0xFF, 0xBB)
    private val OUTDOOR_CYCLING_BITMAP = bytesOf(0xDF, 0xCF, 0xFB)
    private val ELLIPTICAL_V3_BITMAP = bytesOf(0xFF, 0xFF)
    private val ROWING_V4_BITMAP = bytesOf(0xFF, 0xFF)
    private val TREADMILL_V6_BITMAP = bytesOf(0xFF, 0xFF, 0x8B, 0xFF)
    private val INDOOR_CYCLING_V6_BITMAP = bytesOf(0xDF, 0xBB, 0xBB, 0xBF)

    private fun bytesOf(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val records = records(id, data)
        if (records.isEmpty()) return ParsedActivity(emptyList(), emptyList())

        val hr = JSONArray()
        val cadence = JSONArray()
        val speed = JSONArray()
        for (r in records) {
            val t = r.ts.toLong() and 0xFFFFFFFFL
            if (validHeartRate(r.hr)) hr.put(JSONArray().put(t).put(r.hr))
            val c = r.cadence
            if (c != null && c > 0) cadence.put(JSONArray().put(t).put(c))
            pointSpeedMps(id.version, r)?.let { speed.put(JSONArray().put(t).put((it * 100.0).roundToLong() / 100.0)) }
        }
        val details = JSONObject()
        if (hr.length() > 0) details.put("hr", hr)
        if (cadence.length() > 0) details.put("cadence", cadence)
        if (speed.length() > 0) details.put("speed_mps", speed)

        val startMs = (records.minOf { it.ts }.toLong() and 0xFFFFFFFFL) * 1000L
        val endMs = (records.maxOf { it.ts }.toLong() and 0xFFFFFFFFL) * 1000L
        val session = SessionEntity(
            id = WorkoutSummaryParser.exerciseId(id.timestamp),
            kind = Metrics.KIND_EXERCISE,
            start = startMs,
            end = endMs,
            detailsJson = details.toString(),
        )
        return ParsedActivity(emptyList(), listOf(session))
    }

    /** Speed in m/s for a record, or null. Treadmill v5 stores the belt speed in 0.1 km/h (raw / 36 = m/s). */
    internal fun pointSpeedMps(version: Int, r: WorkoutRecord): Float? {
        r.speedMps?.let { return it }
        if (version != 5 || r.speedRaw == null) return null
        val v = r.speedRaw!! / 36f
        return if (v < 20f) v else null
    }

    internal fun records(id: ActivityFileId, bytes: ByteArray): List<WorkoutRecord> {
        try {
            return parseRecords(id, bytes)
        } catch (e: BufferUnderflowException) {
            fail("workout details ended inside a record")
        }
    }

    private fun hex(bytes: ByteArray, from: Int, count: Int) =
        bytes.copyOfRange(minOf(from, bytes.size), minOf(from + count, bytes.size)).joinToString(" ") { "%02x".format(it) }

    private fun hasSameFieldGroups(bytes: ByteArray, bitmap: ByteArray): Boolean {
        if (bytes.size < 8 + bitmap.size) return false
        return bitmap.indices.all { (bytes[8 + it].toInt() and 0x88) == (bitmap[it].toInt() and 0x88) }
    }

    private fun startsWith(bytes: ByteArray, bitmap: ByteArray): Boolean {
        if (bitmap.size + 8 > bytes.size) return false
        return bitmap.indices.all { bytes[8 + it] == bitmap[it] }
    }

    private fun matchesBitmap(id: ActivityFileId, bytes: ByteArray, subtype: Int, bitmap: ByteArray) =
        startsWith(bytes, bitmap) || (id.subtype == subtype && hasSameFieldGroups(bytes, bitmap))

    private fun b(bytes: ByteArray, i: Int) = bytes[i].toInt() and 0xFF

    private fun parseRecords(id: ActivityFileId, bytes: ByteArray): List<WorkoutRecord> {
        val version = id.version
        if (id.subtype == ActivityFileId.SPORTS_OUTDOOR_WALKING_V2 && (version == 5 || version == 8)) {
            return parseRunWalk(id, bytes)
        }
        var layout = version
        val segmentHeaderSize: Int
        val recordSize: Int
        val tsPosition: Int
        val nrPosition: Int
        val signature: ByteArray

        fun unknownSignature(): Nothing =
            fail("unknown v$version workout details signature ${hex(bytes, 8, 8)} for ${id.subtypeName}")

        when (version) {
            1 -> {
                if (bytes.size >= 10 && b(bytes, 8) == 0xEC && b(bytes, 9) == 0xFC) {
                    signature = bytesOf(0xEC, 0xFC); recordSize = 4; layout = 102
                } else if (bytes.size >= 10 && b(bytes, 8) == 0xCC && b(bytes, 9) == 0xF0) {
                    signature = bytesOf(0xCC, 0xF0); recordSize = 3; layout = 101
                } else unknownSignature()
                segmentHeaderSize = 12; tsPosition = 8; nrPosition = 4
            }
            2 -> {
                signature = bytesOf(0xC0); segmentHeaderSize = 9; recordSize = 2; tsPosition = 4; nrPosition = 0
            }
            3 -> {
                if (bytes.size >= 11 && b(bytes, 8) == 0xCC && b(bytes, 9) == 0xCC && b(bytes, 10) == 0xC0) {
                    signature = bytesOf(0xCC, 0xCC, 0xC0); segmentHeaderSize = 17; recordSize = 6; tsPosition = 8; nrPosition = 4
                } else if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_FREESTYLE, FREESTYLE_V3_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + FREESTYLE_V3_BITMAP.size)
                    segmentHeaderSize = 9; recordSize = 4; tsPosition = 4; nrPosition = 0; layout = 103
                } else if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_OUTDOOR_CYCLING, OUTDOOR_CYCLING_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + OUTDOOR_CYCLING_BITMAP.size)
                    segmentHeaderSize = 17; recordSize = 7; tsPosition = 8; nrPosition = 4; layout = 113
                } else if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_ELLIPTICAL, ELLIPTICAL_V3_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + ELLIPTICAL_V3_BITMAP.size)
                    segmentHeaderSize = 9; recordSize = 3; tsPosition = 4; nrPosition = 0; layout = 111
                } else unknownSignature()
            }
            4 -> {
                if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_ROWING, ROWING_V4_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + ROWING_V4_BITMAP.size)
                    segmentHeaderSize = 13; recordSize = 3; tsPosition = 4; nrPosition = 0
                } else if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_FREESTYLE, FREESTYLE_V3_BITMAP)) {
                    // Watch S5 freestyle: v3's 4-byte records behind a 13-byte segment header
                    // (count, start, flag, count again); the file ends with an empty segment
                    signature = bytes.copyOfRange(8, 8 + FREESTYLE_V3_BITMAP.size)
                    segmentHeaderSize = 13; recordSize = 4; tsPosition = 4; nrPosition = 0; layout = 103
                } else if (bytes.size >= 13 && b(bytes, 8) == 0xEC && b(bytes, 9) == 0xCC && b(bytes, 10) == 0xC8) {
                    fail("v4 walking-style workout details (signature ec cc c8) are not decoded yet")
                } else unknownSignature()
            }
            5 -> {
                if (bytes.size >= 13 && b(bytes, 8) == 0xEC && b(bytes, 9) == 0xCC && b(bytes, 10) == 0xC0 &&
                    b(bytes, 11) == 0x0C && b(bytes, 12) == 0xC0
                ) {
                    signature = bytesOf(0xEC, 0xCC, 0xC0, 0x0C, 0xC0)
                    segmentHeaderSize = 17; recordSize = 8; tsPosition = 8; nrPosition = 4
                } else if (bytes.size >= 13 && b(bytes, 8) == 0xEC && b(bytes, 9) == 0xCC && b(bytes, 10) == 0x80 &&
                    b(bytes, 11) == 0x28 && b(bytes, 12) == 0x06
                ) {
                    // Treadmill v5: no record count in the 115-byte header, so the file is one segment
                    signature = bytesOf(0xEC, 0xCC, 0x80, 0x28, 0x06)
                    segmentHeaderSize = 115; recordSize = 8; tsPosition = 2; nrPosition = 0; layout = 205
                } else if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_OUTDOOR_CYCLING, OUTDOOR_CYCLING_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + OUTDOOR_CYCLING_BITMAP.size)
                    segmentHeaderSize = 23; recordSize = 7; tsPosition = 8; nrPosition = 4; layout = 113
                } else unknownSignature()
            }
            6 -> {
                if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_TREADMILL, TREADMILL_V6_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + TREADMILL_V6_BITMAP.size)
                    segmentHeaderSize = 13; recordSize = 12; tsPosition = 4; nrPosition = 0
                } else if (matchesBitmap(id, bytes, ActivityFileId.SPORTS_INDOOR_CYCLING, INDOOR_CYCLING_V6_BITMAP)) {
                    signature = bytes.copyOfRange(8, 8 + INDOOR_CYCLING_V6_BITMAP.size)
                    segmentHeaderSize = 13; recordSize = 9; tsPosition = 4; nrPosition = 0; layout = 116
                } else unknownSignature()
            }
            9 -> {
                signature = bytesOf(0xFF, 0xFF, 0xF8, 0xBF, 0xFB, 0xBB, 0xBF)
                segmentHeaderSize = 27; recordSize = 25; tsPosition = 8; nrPosition = 4; layout = 109
            }
            else -> unsupportedVersion("workout details", version)
        }

        if (bytes.size < 8 + signature.size + 4 || !startsWith(bytes, signature)) {
            fail("unexpected v$version workout details signature ${hex(bytes, 8, signature.size)}, expected ${hex(signature, 0, signature.size)}")
        }

        val buf = littleEndian(bytes).dropCrc()
        buf.skipFileId()
        buf.skip(signature.size)

        val records = ArrayList<WorkoutRecord>()
        while (buf.hasRemaining()) {
            if (buf.remaining() < segmentHeaderSize) break // includes the v1 8-byte empty trailer
            val hdr = ByteArray(segmentHeaderSize)
            buf.get(hdr)
            val h = littleEndian(hdr)
            var nr = h.getInt(nrPosition)
            var ts = h.getInt(tsPosition)
            if (layout == 205) nr = buf.remaining() / recordSize

            val segmentFirst = records.size
            val segmentEnd = buf.position().toLong() + nr.toLong() * recordSize
            val stop = minOf(segmentEnd, buf.limit().toLong()).toInt()
            while (buf.position() < stop) {
                val r = WorkoutRecord(ts = ts)
                readRecord(layout, buf, r)
                records += r
                ts++
            }
            setSpeedFromDistance(records, segmentFirst)
        }
        return records
    }

    private fun readRecord(layout: Int, buf: ByteBuffer, r: WorkoutRecord) {
        when (layout) {
            2 -> { r.hr = buf.u8(); buf.get() }
            3 -> { buf.get(); r.hr = buf.u8(); r.speedRaw = buf.getInt() }
            4 -> { r.hr = buf.u8(); buf.get(); r.cadence = buf.u8() }
            5 -> {
                r.steps = buf.u8(); r.hr = buf.u8(); buf.get(); buf.get(); r.spo2 = buf.u8(); r.cadence = buf.u8()
                buf.getShort()
            }
            6 -> {
                r.steps = buf.u8() and 0x0F; r.hr = buf.u8(); r.distanceDm = buf.u8(); buf.get()
                buf.getInt(); buf.get(); r.cadence = buf.u8(); r.paceSecPerKm = buf.u16()
            }
            101 -> { buf.get(); r.hr = buf.u8(); buf.get() }
            102 -> { r.steps = buf.u8() and 0x0F; r.hr = buf.u8(); buf.get(); buf.get() }
            103 -> { r.hr = buf.u8(); buf.get(); buf.get(); buf.get() }
            205 -> { buf.get(); r.hr = buf.u8(); buf.get(); r.speedRaw = buf.u8(); buf.getInt() }
            111 -> { r.steps = buf.u8() and 0x0F; r.hr = buf.u8(); r.cadence = buf.u8() }
            113 -> {
                buf.get(); r.hr = buf.u8(); buf.get(); buf.get()
                r.speedMps = buf.u16() / 36f
                buf.get()
            }
            116 -> { buf.get(); r.hr = buf.u8(); buf.getInt(); buf.getShort(); buf.get() }
            109 -> { r.steps = buf.u8() and 0x0F; r.hr = buf.u8(); buf.skip(23) }
        }
    }

    /** Outdoor run/walk v5 and v8: a nibble-per-group bitmap, then segments of per-second records. */
    private fun parseRunWalk(id: ActivityFileId, bytes: ByteArray): List<WorkoutRecord> {
        val version = id.version
        val bitmapSize = if (version == 5) 5 else 7
        val groupCount = if (version == 5) 9 else RUN_WALK_GROUP_BYTES.size
        val segmentHeaderSize = if (version == 5) 17 else 27

        if (bytes.size < 8 + bitmapSize + 4) fail("run/walk v$version details too short: ${bytes.size} bytes")
        val bitmap = bytes.copyOfRange(8, 8 + bitmapSize)

        var recordSize = 0
        for (group in 0 until groupCount) {
            val nibble = (if (group % 2 == 0) bitmap[group / 2].toInt() shr 4 else bitmap[group / 2].toInt()) and 0x0F
            if ((nibble and 8) != 0) recordSize += RUN_WALK_GROUP_BYTES[group]
        }
        if (recordSize == 0) fail("run/walk v$version details bitmap ${hex(bitmap, 0, bitmap.size)} has no field groups")

        val buf = littleEndian(bytes).dropCrc()
        buf.position(8 + bitmapSize)
        val groups = ComplexGroupReader(bitmap, buf)
        val records = ArrayList<WorkoutRecord>()
        while (buf.hasRemaining()) {
            val segmentStart = buf.position()
            if (buf.remaining() < segmentHeaderSize) {
                fail("run/walk v$version details: ${buf.remaining()} trailing bytes at $segmentStart")
            }
            val nr = buf.getInt(segmentStart + 4)
            var ts = buf.getInt(segmentStart + 8)
            buf.position(segmentStart + segmentHeaderSize)
            if (nr < 0 || nr.toLong() * recordSize > buf.remaining()) {
                fail("run/walk v$version details: segment at $segmentStart claims $nr records of $recordSize bytes, ${buf.remaining()} bytes remain")
            }
            val first = records.size
            for (i in 0 until nr) {
                groups.reset()
                val r = WorkoutRecord(ts = ts++)
                for (group in 0 until groupCount) {
                    if (!groups.nextGroup(RUN_WALK_GROUP_BYTES[group] * 8)) continue
                    when (group) {
                        GROUP_STEPS -> r.steps = groups.get(4, 4)
                        GROUP_HR -> r.hr = groups.get(0, 8)
                        GROUP_DISTANCE -> r.distanceDm = groups.get(0, 8)
                        GROUP_CADENCE -> r.cadence = groups.get(0, 8)
                        GROUP_PACE -> r.paceSecPerKm = groups.get(0, 16)
                    }
                }
                records += r
            }
            setSpeedFromDistance(records, first)
        }
        return records
    }

    /**
     * Sets speedMps on one segment's records so that it integrates to the segment's per-second distance (which
     * arrives in bursts) while following the smooth but drifting pace. See Gadgetbridge's setSpeedFromDistance.
     */
    private fun setSpeedFromDistance(records: List<WorkoutRecord>, first: Int) {
        val last = records.size - 1
        if (first > last || records[first].distanceDm == null) return

        val half = SPEED_WINDOW / 2
        var remainingDistance = 0.0
        var pacedSpeedSum = 0.0
        for (i in first..last) {
            val r = records[i]
            remainingDistance += r.distanceDm!! / 10.0
            val pace = r.paceSecPerKm
            if (pace != null && pace > 0) {
                pacedSpeedSum += 1000.0 / pace
                continue
            }
            val from = maxOf(first, i - half)
            val to = minOf(last, i + half)
            var sum = 0
            for (j in from..to) sum += records[j].distanceDm!!
            val speed = sum / 10f / (to - from + 1)
            r.speedMps = speed
            remainingDistance -= speed
        }
        if (pacedSpeedSum == 0.0) return

        val scale = maxOf(0.0, remainingDistance) / pacedSpeedSum
        for (i in first..last) {
            val r = records[i]
            val pace = r.paceSecPerKm
            if (pace != null && pace > 0) r.speedMps = (1000.0 / pace * scale).toFloat()
        }
    }
}
