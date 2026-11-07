package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.data.Metrics
import app.kumquant.healthbridge.data.SampleEntity
import app.kumquant.healthbridge.data.SessionEntity
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.activity.ParsedActivity
import org.json.JSONArray
import org.json.JSONObject
import java.nio.BufferUnderflowException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.Instant

/** One stretch of a night in a single stage. */
internal data class SleepStage(val stage: String, val startMs: Long, val endMs: Long)

internal object Sleep {
    /** Session id for a night: the bedtime (epoch s) both the details and the stages file carry. */
    fun sessionId(bedTimeSec: Long) = "hb:sleep:$bedTimeSec"

    fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

    fun stagesJson(stages: List<SleepStage>): String {
        val arr = JSONArray()
        for (s in stages) {
            arr.put(JSONObject().put("stage", s.stage).put("start", iso(s.startMs)).put("end", iso(s.endMs)))
        }
        return arr.toString()
    }

    /** Milliseconds a stagesJson covers; the richer of two versions of a night wins a merge. */
    fun coverageMs(stagesJson: String): Long {
        return try {
            val arr = JSONArray(stagesJson)
            var total = 0L
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                total += Instant.parse(o.getString("end")).toEpochMilli() - Instant.parse(o.getString("start")).toEpochMilli()
            }
            total
        } catch (e: Exception) {
            0L
        }
    }

    /** Raw stage codes: 2 deep, 3 light, 4 REM, 5 awake. 0 (not asleep) and 1 (unknown) count as awake. */
    fun stageName(code: Int) = when (code) {
        2 -> Metrics.STAGE_DEEP
        3 -> Metrics.STAGE_LIGHT
        4 -> Metrics.STAGE_REM
        else -> Metrics.STAGE_AWAKE
    }

    /**
     * Gadgetbridge's SleepSessionProvider.sanitizeStages: each stage runs until the next one starts, the last
     * until wake-up; zero-length stages go, touching stages of one kind merge, and the time before the first
     * stage is light sleep. Unlike Gadgetbridge a stage that started before bedtime and is still running at it
     * is clipped to start at bedtime instead of being dropped.
     */
    fun sanitize(changes: List<Pair<Long, String>>, startMs: Long, endMs: Long): List<SleepStage> {
        val sorted = changes.sortedBy { it.first }
        // The stage in effect at bedtime is the last change before it
        val before = sorted.lastOrNull { it.first < startMs }
        val inside = sorted.filter { it.first in startMs..endMs }
        val list = if (before != null && inside.firstOrNull()?.first != startMs) listOf(startMs to before.second) + inside else inside

        val out = ArrayList<SleepStage>()
        val firstStart = list.firstOrNull()?.first
        if (firstStart != null && firstStart > startMs) out += SleepStage(Metrics.STAGE_LIGHT, startMs, firstStart)
        for ((i, change) in list.withIndex()) {
            val end = if (i < list.lastIndex) list[i + 1].first else endMs
            val start = maxOf(change.first, out.lastOrNull()?.endMs ?: change.first)
            if (start >= end) continue
            val last = out.lastOrNull()
            if (last != null && last.stage == change.second && last.endMs == start) {
                out[out.size - 1] = SleepStage(change.second, last.startMs, end)
            } else {
                out += SleepStage(change.second, start, end)
            }
        }
        if (out.isEmpty()) out += SleepStage(Metrics.STAGE_LIGHT, startMs, endMs)
        return out
    }

    fun session(bedSec: Long, wakeSec: Long, changes: List<Pair<Long, String>>): SessionEntity {
        val startMs = bedSec * 1000L
        val endMs = wakeSec * 1000L
        return SessionEntity(
            id = sessionId(bedSec),
            kind = Metrics.KIND_SLEEP,
            start = startMs,
            end = endMs,
            stagesJson = stagesJson(sanitize(changes, startMs, endMs)),
        )
    }
}

/**
 * Sleep details (ACTIVITY / ACTIVITY_SLEEP, versions 1-6; seen as both DETAILS and SUMMARY). Ported from
 * Gadgetbridge's SleepDetailsParser. Layout: header bitmap, "awake" flag, bedtime, wake-up time, (v4+ quality,
 * v5+ 17 more bytes, v6+ 24 more), heart rate / SpO2 / snore series, then a stream of 0xfffcfafb-framed packets
 * of which type 17 carries the stages, type 16 the totals and type 0x0a the respiration rate. v6 (the Watch S5)
 * isn't in Gadgetbridge: its 3-byte header, the 24 extra bytes and u16 snore values come from a real capture.
 *
 * Session: kind `sleep`, id `hb:sleep:<bedtime epoch s>`. A night with wake-up <= bedtime yields no session
 * (still asleep, nothing known yet); the next sync carries the finished night under the same id.
 *
 * Samples: `respiratory_rate` from the type 0x0a packets, and `heart_rate` / `spo2` from the series blocks.
 * Gadgetbridge skips those two blocks; their layout is (u16 unit, u16 count, v2+ u32 first time, count bytes) and
 * the sample time is first + unit * index. The unit is assumed to be seconds, and a series whose times fall
 * outside the night (+- 1 h) is dropped as a sign the assumption is wrong.
 */
internal object SleepDetailsParser {
    private const val PACKET_MAGIC = 0xfffcfafb.toInt()
    private const val SLACK_S = 3600L

    /** Bytes v6 inserts after the v5 block (Watch S5, Nov 2026); all zero in the first capture, meaning unknown. */
    private const val V6_EXTRA = 24

    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        val version = id.version
        val headerSize = when (version) {
            1, 2, 3, 4 -> 1
            5 -> 2
            6 -> 3
            else -> unsupportedVersion("sleep details", version)
        }
        var headerIdx = 0

        val buf = littleEndian(data)
        buf.skipFileId()
        val header = ByteArray(headerSize)
        buf.get(header)

        buf.u8() // isAwake: 0 while the night is still running
        headerIdx++
        val bedSec = buf.getInt().toLong() and 0xFFFFFFFFL
        headerIdx++
        val wakeSec = buf.getInt().toLong() and 0xFFFFFFFFL
        headerIdx++

        if (version >= 4) {
            if (validData(header, headerIdx)) buf.get() // sleep quality
            headerIdx++
        }
        if (version >= 5) {
            buf.skip(9 + 4 + 4) // counter and padding, then into-bed time and wake-up time again
            headerIdx += 5
        }
        if (version >= 6) buf.skip(V6_EXTRA)

        val samples = ArrayList<SampleEntity>()
        val plausibleFrom = bedSec - SLACK_S
        val plausibleTo = wakeSec + SLACK_S

        // The series are best effort: if a layout guess is off, fall back to finding the stage packets.
        val seriesStart = buf.position()
        var hr = emptyList<Pair<Long, Int>>()
        var spo2 = emptyList<Pair<Long, Int>>()
        try {
            hr = readSeries(buf, validData(header, headerIdx), version, bedSec, 1)
            headerIdx++
            spo2 = readSeries(buf, validData(header, headerIdx), version, bedSec, 1)
            headerIdx++
            if (version >= 3) {
                // snore levels, unused: floats up to v5, u16 from v6
                if (validData(header, headerIdx)) readSeries(buf, true, version, bedSec, if (version >= 6) 2 else 4)
                headerIdx++
            }
        } catch (e: BufferUnderflowException) {
            hr = emptyList()
            spo2 = emptyList()
            buf.position(seriesStart)
        }
        if (wakeSec > bedSec) {
            addSeries(samples, Metrics.HEART_RATE, hr, plausibleFrom, plausibleTo) { validHeartRate(it) }
            addSeries(samples, Metrics.SPO2, spo2, plausibleFrom, plausibleTo) { it in 1..100 }
        }

        val changes = ArrayList<Pair<Long, String>>()
        try {
            readPackets(buf, changes, samples)
        } catch (e: BufferUnderflowException) {
            fail("sleep details truncated inside the packet stream at offset ${buf.position()}")
        }

        val sessions = if (bedSec > 0 && wakeSec > bedSec) listOf(Sleep.session(bedSec, wakeSec, changes)) else emptyList()
        return ParsedActivity(samples, sessions)
    }

    /** (time s, value) pairs; empty when the block is absent or empty. */
    private fun readSeries(buf: ByteBuffer, present: Boolean, version: Int, bedSec: Long, itemSize: Int): List<Pair<Long, Int>> {
        if (!present) return emptyList()
        val unit = buf.u16()
        val count = buf.u16()
        if (count <= 0) return emptyList()
        val first = if (version >= 2) buf.getInt().toLong() and 0xFFFFFFFFL else bedSec
        if (itemSize != 1) {
            buf.skip(count * itemSize)
            return emptyList()
        }
        val out = ArrayList<Pair<Long, Int>>(count)
        for (i in 0 until count) out += (first + unit.toLong() * i) to buf.u8()
        return out
    }

    private fun addSeries(
        out: MutableList<SampleEntity>,
        metric: String,
        series: List<Pair<Long, Int>>,
        from: Long,
        to: Long,
        valid: (Int) -> Boolean,
    ) {
        if (series.isEmpty()) return
        if (series.first().first < from || series.last().first > to) return
        for ((t, v) in series) if (valid(v)) out += instant(metric, t * 1000L, v.toDouble())
    }

    private fun readPackets(buf: ByteBuffer, changes: MutableList<Pair<Long, String>>, samples: MutableList<SampleEntity>) {
        while (buf.remaining() >= 17) {
            if (!seekPacket(buf)) break
            buf.u8() // header length, always 17
            val ts = buf.getLong()
            buf.u8() // parity
            val type = buf.u8()
            val dataLen = (buf.u8() shl 8) or buf.u8()

            // Flag-only packets: the length bytes are flags and no payload follows
            if (type == 0x2 || type == 0x3 || type == 0x9 || type == 0xc || type == 0xd || type == 0xe || type == 0xf || type == 0x12) continue

            val payload = ByteArray(dataLen)
            buf.get(payload)
            val d = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)

            when (type) {
                17 -> { // stages: u16 = stage << 12 | minutes until the next change
                    var t = ts * 1000L
                    for (i in 0 until dataLen / 2) {
                        val v = d.getShort().toInt() and 0xFFFF
                        changes += t to Sleep.stageName(decodeStage(v shr 12))
                        t += (v and 0xFFF) * 60_000L
                    }
                }
                0xa -> { // respiration: 4-byte records every 10 minutes, ts in nanoseconds
                    val records = dataLen / 4
                    if (records > 0) {
                        val windowMs = 10L * 60L * 1000L
                        val windowStart = Math.round(ts / 1_000_000.0) - windowMs
                        for (i in 0 until records) {
                            d.get()
                            val rate = d.get().toInt() and 0xFF
                            d.get()
                            d.get()
                            if (rate < 1 || rate > 40) continue
                            val t = windowStart + ((i + 1).toLong() * windowMs) / (records + 1)
                            samples += instant(Metrics.RESPIRATORY_RATE, t, rate.toDouble())
                        }
                    }
                }
            }
        }
    }

    private fun seekPacket(buf: ByteBuffer): Boolean {
        while (buf.remaining() >= 17) {
            if (buf.getInt() == PACKET_MAGIC) return true
            buf.position(buf.position() - 3)
        }
        return false
    }

    /** Raw stage code of the details stream to the stage code the stages file uses (Gadgetbridge's decodeStage). */
    private fun decodeStage(raw: Int) = when (raw) {
        0 -> 5
        1 -> 3
        2 -> 2
        3 -> 4
        4 -> 0
        else -> 1
    }
}

/**
 * Sleep stages (ACTIVITY / ACTIVITY_SLEEP_STAGES / DETAILS, version 2 only, older bands). Ported from
 * Gadgetbridge's SleepStagesParser: a fixed header with bedtime and wake-up, then (u32 time, u8 phase) records.
 * The session id is the same `hb:sleep:<bedtime epoch s>` as the details file's. An all-zero file (no sleep
 * recorded) yields nothing.
 */
internal object SleepStagesParser {
    fun parse(id: ActivityFileId, data: ByteArray): ParsedActivity {
        if (id.version != 2) unsupportedVersion("sleep stages", id.version)
        val buf = littleEndian(data).dropCrc()
        buf.skipFileId()

        buf.skip(7)
        val sleepDuration = buf.getShort().toInt()
        val bedSec = buf.getInt().toLong() and 0xFFFFFFFFL
        val wakeSec = buf.getInt().toLong() and 0xFFFFFFFFL
        buf.skip(3)
        buf.skip(8) // deep, light, REM, awake minutes
        if (bedSec == 0L || wakeSec == 0L || sleepDuration == 0) return ParsedActivity(emptyList(), emptyList())

        buf.get() // unknown
        val changes = ArrayList<Pair<Long, String>>()
        while (buf.hasRemaining()) {
            val time = buf.getInt().toLong() and 0xFFFFFFFFL
            val phase = buf.u8()
            changes += time * 1000L to Sleep.stageName(phase)
        }
        if (wakeSec <= bedSec) return ParsedActivity(emptyList(), emptyList())
        return ParsedActivity(emptyList(), listOf(Sleep.session(bedSec, wakeSec, changes)))
    }
}
