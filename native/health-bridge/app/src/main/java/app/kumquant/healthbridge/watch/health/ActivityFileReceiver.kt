package app.kumquant.healthbridge.watch.health

import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.toHex
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32

/**
 * Reassembles one activity file from the chunks the watch sends on the Activity channel. Ported
 * from the chunk handling of Gadgetbridge's XiaomiActivityFileFetcher.
 *
 * Chunk layout: `total(le16) | number(le16) | data`, numbered from 1. A chunk numbered 1 starts a
 * new file. The finished file is `fileId(7) | body | crc32(le32)` where the CRC covers everything
 * before it; that whole array (header and CRC included) is what the parsers get.
 */
internal class ActivityFileReceiver {

    sealed interface Result {
        /** More chunks to come. */
        data object Partial : Result

        data class Complete(val id: ActivityFileId, val data: ByteArray) : Result

        /** The file arrived but is unusable; it must not be acked so the watch offers it again. */
        data class Rejected(val reason: String, val data: ByteArray?) : Result
    }

    private var buffer = ByteArrayOutputStream()

    fun reset() {
        buffer = ByteArrayOutputStream()
    }

    fun addChunk(chunk: ByteArray): Result {
        if (chunk.size < 4) return Result.Rejected("chunk of ${chunk.size}B has no header: ${chunk.toHex()}", null)
        val header = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN)
        val total = header.short.toInt() and 0xffff
        val number = header.short.toInt() and 0xffff
        if (number == 1) reset()
        WatchLog.d("activity chunk $number/$total (${chunk.size - 4}B)")
        buffer.write(chunk, 4, chunk.size - 4)
        if (number != total) return Result.Partial

        val data = buffer.toByteArray()
        reset()
        return validate(data)
    }

    companion object {
        /** Header 7, flags 1, CRC 4 at least, as in Gadgetbridge. */
        const val MIN_FILE_SIZE = 13

        fun validate(data: ByteArray): Result {
            if (data.size < MIN_FILE_SIZE) return Result.Rejected("file of ${data.size}B is too short: ${data.toHex()}", data)
            val crc = CRC32().apply { update(data, 0, data.size - 4) }.value
            val expected = ByteBuffer.wrap(data, data.size - 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
            if (crc != expected) {
                return Result.Rejected("CRC mismatch, got %08X expected %08X".format(crc, expected), data)
            }
            if (data[7].toInt() != 0) WatchLog.w("activity file byte 7 is 0x%02x, parsing may fail".format(data[7]))
            return Result.Complete(ActivityFileId.fromBytes(data), data)
        }
    }
}
