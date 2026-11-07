package app.kumquant.healthbridge.watch

import android.util.Log

/**
 * Logging for the watch layer under one tag. `android.util.Log` is a stub in JVM unit tests and
 * throws, so every call is guarded; the logic that gets tested never depends on it.
 */
internal object WatchLog {
    const val TAG = "HB.watch"

    fun d(msg: String) = safe { Log.d(TAG, msg) }
    fun i(msg: String) = safe { Log.i(TAG, msg) }
    fun w(msg: String, t: Throwable? = null) = safe { if (t != null) Log.w(TAG, msg, t) else Log.w(TAG, msg) }
    fun e(msg: String, t: Throwable? = null) = safe { if (t != null) Log.e(TAG, msg, t) else Log.e(TAG, msg) }

    private inline fun safe(block: () -> Unit) {
        try {
            block()
        } catch (_: RuntimeException) {
            // android.util.Log is not mocked in a unit test
        }
    }
}

private val HEX = "0123456789abcdef".toCharArray()

/** Lowercase hex of the whole array. */
internal fun ByteArray.toHex(): String {
    val out = CharArray(size * 2)
    for (i in indices) {
        val v = this[i].toInt() and 0xff
        out[i * 2] = HEX[v ushr 4]
        out[i * 2 + 1] = HEX[v and 0x0f]
    }
    return String(out)
}

/** Hex that stops after [max] bytes with the total length noted, for log lines. */
internal fun ByteArray.toHexCapped(max: Int = 96): String =
    if (size <= max) toHex() else copyOf(max).toHex() + "...(${size}B)"

internal fun String.hexToBytes(): ByteArray {
    val s = trim()
    require(s.length % 2 == 0) { "odd-length hex" }
    return ByteArray(s.length / 2) { i ->
        val hi = Character.digit(s[i * 2], 16)
        val lo = Character.digit(s[i * 2 + 1], 16)
        require(hi >= 0 && lo >= 0) { "not hex" }
        ((hi shl 4) or lo).toByte()
    }
}
