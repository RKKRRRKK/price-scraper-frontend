package app.kumquant.healthbridge.watch.activity

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The 7-byte id Xiaomi watches give every activity file. Ported from Gadgetbridge's
 * XiaomiActivityFileId.
 *
 * Wire layout (little endian): u32 timestamp (epoch s) | i8 timezone (15 minute blocks) | i8 version |
 * flags, where flags = type << 7 | subtype << 2 | detailType.
 * The timestamp is already UTC; the timezone byte only matters for display.
 */
data class ActivityFileId(
    val timestamp: Long,
    val timezone: Int,
    val version: Int,
    val type: Int,
    val subtype: Int,
    val detailType: Int,
) {
    fun toBytes(): ByteArray {
        val buf = ByteBuffer.allocate(SIZE).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(timestamp.toInt())
        buf.put(timezone.toByte())
        buf.put(version.toByte())
        buf.put(((type shl 7) or (subtype shl 2) or detailType).toByte())
        return buf.array()
    }

    /** The 7 id bytes as lowercase hex; the key of `raw_files`. */
    val hex: String get() = toBytes().joinToString("") { "%02x".format(it) }

    val typeName: String get() = when (type) {
        TYPE_ACTIVITY -> "ACTIVITY"
        TYPE_SPORTS -> "SPORTS"
        else -> "UNKNOWN_%02X".format(type)
    }

    val subtypeName: String get() = (if (type == TYPE_SPORTS) SPORTS_SUBTYPES else ACTIVITY_SUBTYPES)[subtype]
        ?: "UNKNOWN_%02X".format(subtype)

    val detailTypeName: String get() = when (detailType) {
        DETAIL_DETAILS -> "DETAILS"
        DETAIL_SUMMARY -> "SUMMARY"
        DETAIL_GPS_TRACK -> "GPS_TRACK"
        else -> "UNKNOWN_%02X".format(detailType)
    }

    /** Fetch priority: summary first so workout data exists before the details/GPS files are merged in. */
    val fetchOrder: Int get() = when (detailType) {
        DETAIL_SUMMARY -> 0
        DETAIL_DETAILS -> 1
        DETAIL_GPS_TRACK -> 2
        else -> 3
    }

    fun describe(): String =
        "$typeName/$subtypeName/$detailTypeName v$version ts=$timestamp tz=$timezone id=$hex"

    companion object {
        const val SIZE = 7

        const val TYPE_ACTIVITY = 0
        const val TYPE_SPORTS = 1

        const val DETAIL_DETAILS = 0
        const val DETAIL_SUMMARY = 1
        const val DETAIL_GPS_TRACK = 2

        // Activity subtypes
        const val ACTIVITY_DAILY = 0x00
        const val ACTIVITY_SLEEP_STAGES = 0x03
        const val ACTIVITY_MANUAL_SAMPLES = 0x06
        const val ACTIVITY_SLEEP = 0x08

        // Sports subtypes
        const val SPORTS_OUTDOOR_RUNNING = 0x01
        const val SPORTS_OUTDOOR_WALKING_V1 = 0x02
        const val SPORTS_TREADMILL = 0x03
        const val SPORTS_OUTDOOR_CYCLING_V2 = 0x06
        const val SPORTS_INDOOR_CYCLING = 0x07
        const val SPORTS_FREESTYLE = 0x08
        const val SPORTS_POOL_SWIMMING = 0x09
        const val SPORTS_ELLIPTICAL = 0x0B
        const val SPORTS_ROWING = 0x0D
        const val SPORTS_JUMP_ROPING = 0x0E
        const val SPORTS_HIIT = 0x10
        const val SPORTS_OUTDOOR_WALKING_V2 = 0x16
        const val SPORTS_OUTDOOR_CYCLING = 0x17

        private val ACTIVITY_SUBTYPES = mapOf(
            ACTIVITY_DAILY to "ACTIVITY_DAILY",
            ACTIVITY_SLEEP_STAGES to "ACTIVITY_SLEEP_STAGES",
            ACTIVITY_MANUAL_SAMPLES to "ACTIVITY_MANUAL_SAMPLES",
            ACTIVITY_SLEEP to "ACTIVITY_SLEEP",
        )

        private val SPORTS_SUBTYPES = mapOf(
            SPORTS_OUTDOOR_RUNNING to "SPORTS_OUTDOOR_RUNNING",
            SPORTS_OUTDOOR_WALKING_V1 to "SPORTS_OUTDOOR_WALKING_V1",
            SPORTS_TREADMILL to "SPORTS_TREADMILL",
            SPORTS_OUTDOOR_CYCLING_V2 to "SPORTS_OUTDOOR_CYCLING_V2",
            SPORTS_INDOOR_CYCLING to "SPORTS_INDOOR_CYCLING",
            SPORTS_FREESTYLE to "SPORTS_FREESTYLE",
            SPORTS_POOL_SWIMMING to "SPORTS_POOL_SWIMMING",
            SPORTS_ELLIPTICAL to "SPORTS_ELLIPTICAL",
            SPORTS_ROWING to "SPORTS_ROWING",
            SPORTS_JUMP_ROPING to "SPORTS_JUMP_ROPING",
            SPORTS_HIIT to "SPORTS_HIIT",
            SPORTS_OUTDOOR_WALKING_V2 to "SPORTS_OUTDOOR_WALKING_V2",
            SPORTS_OUTDOOR_CYCLING to "SPORTS_OUTDOOR_CYCLING",
        )

        /** Reads the id from the first 7 bytes at [offset]. */
        fun fromBytes(bytes: ByteArray, offset: Int = 0): ActivityFileId {
            require(bytes.size - offset >= SIZE) { "Activity file id needs $SIZE bytes, got ${bytes.size - offset}" }
            val buf = ByteBuffer.wrap(bytes, offset, SIZE).order(ByteOrder.LITTLE_ENDIAN)
            val ts = buf.getInt().toLong() and 0xFFFFFFFFL
            val tz = buf.get().toInt()
            val version = buf.get().toInt()
            val flags = buf.get().toInt() and 0xFF
            return ActivityFileId(
                timestamp = ts,
                timezone = tz,
                version = version,
                type = (flags shr 7) and 1,
                subtype = (flags and 127) shr 2,
                detailType = flags and 3,
            )
        }
    }
}
