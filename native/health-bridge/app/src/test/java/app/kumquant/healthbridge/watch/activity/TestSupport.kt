package app.kumquant.healthbridge.watch.activity

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.zip.CRC32

/** Little-endian byte builder for synthetic activity files. */
class Bytes {
    private val out = ByteArrayOutputStream()

    fun u8(v: Int) = apply { out.write(v and 0xFF) }
    fun u16(v: Int) = apply { u8(v); u8(v shr 8) }
    fun i32(v: Int) = apply { u16(v and 0xFFFF); u16(v ushr 16) }
    fun i64(v: Long) = apply { i32(v.toInt()); i32((v ushr 32).toInt()) }
    fun f32(v: Float) = apply { i32(java.lang.Float.floatToIntBits(v)) }
    fun be16(v: Int) = apply { u8(v shr 8); u8(v) }
    fun raw(vararg v: Int) = apply { v.forEach { u8(it) } }
    fun raw(b: ByteArray) = apply { out.write(b) }
    fun zeros(n: Int) = apply { repeat(n) { u8(0) } }
    fun toByteArray(): ByteArray = out.toByteArray()
}

object T {
    fun hex(s: String): ByteArray {
        val clean = s.filter { !it.isWhitespace() }
        return ByteArray(clean.length / 2) { clean.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    }

    fun b64(s: String): ByteArray = Base64.getDecoder().decode(s)

    fun crc(data: ByteArray, len: Int = data.size - 4): Int {
        val c = CRC32()
        c.update(data, 0, len)
        return c.value.toInt()
    }

    /** id bytes + padding + payload + CRC32, the shape of a file the watch sent. */
    fun file(id: ActivityFileId, payload: ByteArray): ByteArray {
        val body = id.toBytes() + byteArrayOf(0) + payload
        val buf = ByteBuffer.allocate(body.size + 4).order(ByteOrder.LITTLE_ENDIAN)
        buf.put(body)
        buf.putInt(crc(body, body.size))
        return buf.array()
    }

    fun id(timestamp: Long, version: Int, type: Int, subtype: Int, detail: Int, tz: Int = 0) =
        ActivityFileId(timestamp, tz, version, type, subtype, detail)

    fun resource(name: String): String =
        T::class.java.classLoader!!.getResourceAsStream(name)!!.bufferedReader().use { it.readText() }

    fun summaryVector(name: String): ByteArray = b64(JSONObject(resource("summary_vectors.json")).getString(name))

    fun details(json: String?): JSONObject = JSONObject(json!!)

    /** [[t, v], ...] as pairs of doubles. */
    fun series(a: JSONArray): List<Pair<Long, Double>> =
        (0 until a.length()).map { a.getJSONArray(it).let { p -> p.getLong(0) to p.getDouble(1) } }
}
