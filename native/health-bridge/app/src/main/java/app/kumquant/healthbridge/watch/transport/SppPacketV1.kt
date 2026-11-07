package app.kumquant.healthbridge.watch.transport

import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.toHex
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

/** Logical channels of the Xiaomi SPP link, shared by protocol v1 and v2. */
internal enum class Channel { Unknown, Version, ProtobufCommand, Activity, Data, Authentication }

/**
 * SPP protocol v1 frame: `ba dc fe | channel | flags | len(le16) | opcode | serial | dataType | payload | ef`.
 * `len` counts the 3 header bytes after it plus the payload. Ported from Gadgetbridge's XiaomiSppPacketV1.
 */
internal class SppPacketV1(
    val channel: Channel,
    val rawChannel: Int,
    val flag: Boolean,
    val needsResponse: Boolean,
    val opCode: Int,
    val frameSerial: Int,
    val dataType: Int,
    val payload: ByteArray,
) {
    /** Payload as plaintext: decrypted when it is typed encrypted and the session keys exist. */
    fun decryptedPayload(crypto: PacketCrypto?): ByteArray {
        if (crypto == null) return payload
        if (dataType != DATA_TYPE_ENCRYPTED) return payload
        if (!crypto.encryptionInitialized) {
            WatchLog.w("v1: encrypted packet before encryption is ready, passing through: ${payload.toHex()}")
            return payload
        }
        return crypto.decryptV1(payload)
    }

    /**
     * Wire bytes. Command-channel payloads typed encrypted get `counter(le16) || ccm(payload)` with the
     * counter taken from [encryptionCounter]; other encrypted payloads use counter 0 and no prefix.
     */
    fun encode(crypto: PacketCrypto?, encryptionCounter: AtomicInteger?): ByteArray {
        var body = payload
        if (dataType == DATA_TYPE_ENCRYPTED && channel == Channel.ProtobufCommand) {
            val counter = encryptionCounter!!.incrementAndGet()
            val encrypted = crypto!!.encryptV1(payload, counter)
            body = ByteBuffer.allocate(2 + encrypted.size).order(ByteOrder.LITTLE_ENDIAN)
                .putShort(counter.toShort())
                .put(encrypted)
                .array()
        } else if (dataType == DATA_TYPE_ENCRYPTED) {
            body = crypto!!.encryptV1(payload, 0)
        }

        val buf = ByteBuffer.allocate(11 + body.size).order(ByteOrder.LITTLE_ENDIAN)
        buf.put(PREAMBLE)
        buf.put((getRawChannel(channel, tx = true) and 0xf).toByte())
        buf.put(((if (flag) 0x80 else 0) or (if (needsResponse) 0x40 else 0)).toByte())
        buf.putShort((body.size + 3).toShort())
        buf.put((opCode and 0xff).toByte())
        buf.put((frameSerial and 0xff).toByte())
        buf.put((dataType and 0xff).toByte())
        buf.put(body)
        buf.put(EPILOGUE)
        return buf.array()
    }

    override fun toString() =
        "SppPacketV1{channel=$channel raw=$rawChannel flag=$flag needsResponse=$needsResponse " +
            "opCode=0x${opCode.toString(16)} serial=0x${frameSerial.toString(16)} dataType=0x${dataType.toString(16)} payload=${payload.size}B}"

    companion object {
        val PREAMBLE = byteArrayOf(0xba.toByte(), 0xdc.toByte(), 0xfe.toByte())
        val EPILOGUE = byteArrayOf(0xef.toByte())

        const val CHANNEL_VERSION = 0
        const val CHANNEL_PROTO_RX = 1
        const val CHANNEL_PROTO_TX = 2
        const val CHANNEL_FITNESS = 3
        const val CHANNEL_VOICE = 4
        const val CHANNEL_MASS = 5
        const val CHANNEL_OTA = 7

        const val DATA_TYPE_PLAIN = 0
        const val DATA_TYPE_ENCRYPTED = 1
        const val DATA_TYPE_AUTH = 2

        const val OPCODE_READ = 0
        const val OPCODE_SEND = 2

        /** Smallest valid frame: preamble 3 + channel 1 + flags 1 + len 2 + header 3 + epilogue 1. */
        const val MIN_SIZE = 11

        fun getDataTypeForChannel(channel: Channel): Int = when (channel) {
            Channel.Authentication -> DATA_TYPE_AUTH
            Channel.ProtobufCommand, Channel.Version, Channel.Data -> DATA_TYPE_ENCRYPTED
            else -> DATA_TYPE_PLAIN
        }

        fun getRawChannel(channel: Channel, tx: Boolean): Int = when (channel) {
            Channel.Version -> CHANNEL_VERSION
            Channel.Authentication, Channel.ProtobufCommand -> if (tx) CHANNEL_PROTO_TX else CHANNEL_PROTO_RX
            Channel.Activity -> CHANNEL_FITNESS
            Channel.Data -> CHANNEL_MASS
            else -> {
                WatchLog.w("v1: raw channel for $channel unknown")
                -1
            }
        }

        fun getChannel(rawChannel: Int): Channel = when (rawChannel and 0xff) {
            CHANNEL_PROTO_RX, CHANNEL_PROTO_TX -> Channel.ProtobufCommand
            CHANNEL_FITNESS -> Channel.Activity
            CHANNEL_MASS -> Channel.Data
            CHANNEL_VERSION -> Channel.Version
            else -> {
                WatchLog.w("v1: cannot convert raw channel ${rawChannel and 0xff} to a known channel")
                Channel.Unknown
            }
        }

        fun create(
            channel: Channel,
            opCode: Int,
            frameSerial: Int,
            dataType: Int,
            payload: ByteArray = ByteArray(0),
            needsResponse: Boolean = false,
            flag: Boolean = true,
        ) = SppPacketV1(channel, getRawChannel(channel, tx = true), flag, needsResponse, opCode, frameSerial, dataType, payload)

        /** Decodes one complete frame; null (after logging) if it is incomplete or malformed. */
        fun decode(packet: ByteArray): SppPacketV1? {
            if (packet.size < MIN_SIZE) {
                WatchLog.w("v1: cannot decode incomplete packet (${packet.size}B): ${packet.toHex()}")
                return null
            }
            val buf = ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN)
            val preamble = ByteArray(3).also { buf.get(it) }
            if (!preamble.contentEquals(PREAMBLE)) {
                WatchLog.w("v1: preamble mismatch, expected ${PREAMBLE.toHex()}, got ${preamble.toHex()}")
                return null
            }

            var channel = buf.get().toInt()
            if (channel and 0xf0 != 0) {
                WatchLog.w("v1: reserved bits set in channel byte 0x${(channel and 0xff).toString(16)}")
                channel = 0x0f
            }
            val flags = buf.get().toInt() and 0xff
            if (flags and 0x0f != 0) WatchLog.w("v1: reserved bits set in flags byte 0x${flags.toString(16)}")

            val payloadLength = (buf.short.toInt() and 0xffff) - 3
            if (payloadLength < 0 || payloadLength + MIN_SIZE > packet.size) {
                WatchLog.w("v1: packet incomplete, expected ${payloadLength + MIN_SIZE}B, have ${packet.size}B")
                return null
            }
            val opCode = buf.get().toInt() and 0xff
            val frameSerial = buf.get().toInt() and 0xff
            val dataType = buf.get().toInt() and 0xff
            val payload = ByteArray(payloadLength).also { buf.get(it) }
            val epilogue = buf.get()
            if (epilogue != EPILOGUE[0]) {
                WatchLog.w("v1: epilogue mismatch, expected ef, got ${"%02x".format(epilogue)}")
                return null
            }
            return SppPacketV1(
                channel = getChannel(channel),
                rawChannel = channel,
                flag = flags and 0x80 != 0,
                needsResponse = flags and 0x40 != 0,
                opCode = opCode,
                frameSerial = frameSerial,
                dataType = dataType,
                payload = payload,
            )
        }
    }
}
