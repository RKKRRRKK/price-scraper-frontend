package app.kumquant.healthbridge.watch.transport

import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.toHex
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * SPP protocol v2 frame: `a5 a5 | type | seq | len(le16) | crc16(le16) | payload`. Ported from
 * Gadgetbridge's XiaomiSppPacketV2. Data packets are delivered go-back-N (see [SppProtocolV2]).
 */
internal sealed class SppPacketV2(val packetType: Int, val sequenceNumber: Int) {

    /** Empty payload; the sequence number is the next data packet the receiver expects. */
    class Nack(sequenceNumber: Int) : SppPacketV2(PACKET_TYPE_NACK, sequenceNumber)

    /** Empty payload; acks every data packet up to and including the sequence number. */
    class Ack(sequenceNumber: Int) : SppPacketV2(PACKET_TYPE_ACK, sequenceNumber)

    class SessionConfig(sequenceNumber: Int, val opCode: Int) : SppPacketV2(PACKET_TYPE_SESSION_CONFIG, sequenceNumber)

    class Data(
        sequenceNumber: Int,
        val channel: Channel,
        val opCode: Int,
        val payload: ByteArray,
    ) : SppPacketV2(PACKET_TYPE_DATA, sequenceNumber) {

        /** Payload as plaintext, decrypted when the opcode says it is encrypted. */
        fun plainPayload(crypto: PacketCrypto): ByteArray =
            if (opCode == OPCODE_SEND_ENCRYPTED) crypto.decryptV2(payload) else payload
    }

    companion object {
        val PREAMBLE = byteArrayOf(0xa5.toByte(), 0xa5.toByte())
        const val HEADER_SIZE = 8

        const val PACKET_TYPE_UNKNOWN = -1
        const val PACKET_TYPE_NACK = 0
        const val PACKET_TYPE_ACK = 1
        const val PACKET_TYPE_SESSION_CONFIG = 2
        const val PACKET_TYPE_DATA = 3

        const val OPCODE_START_SESSION_REQUEST = 1
        const val OPCODE_START_SESSION_RESPONSE = 2
        const val OPCODE_STOP_SESSION_REQUEST = 3
        const val OPCODE_STOP_SESSION_RESPONSE = 4

        const val OPCODE_UNKNOWN = -1
        const val OPCODE_SEND_PLAINTEXT = 1
        const val OPCODE_SEND_ENCRYPTED = 2

        private const val CHANNEL_PROTOBUF = 1 // encrypted after authentication
        private const val CHANNEL_DATA = 2 // not encrypted
        private const val CHANNEL_ACTIVITY = 5 // encrypted

        /**
         * Our session config, copied from a packet dump of the official app: version 1.0.0,
         * max frame 0xfc00, tx window 32, send timeout 10 s.
         */
        fun sessionConfigPayload(opCode: Int): ByteArray = byteArrayOf(
            opCode.toByte(),
            1, 0x03, 0x00, 0x01, 0x00, 0x00,
            2, 0x02, 0x00, 0x00, 0xfc.toByte(),
            3, 0x02, 0x00, 0x20, 0x00,
            4, 0x02, 0x00, 0x10, 0x27,
        )

        fun getRawChannel(channel: Channel): Int = when (channel) {
            Channel.Authentication, Channel.ProtobufCommand -> CHANNEL_PROTOBUF
            Channel.Data -> CHANNEL_DATA
            Channel.Activity -> CHANNEL_ACTIVITY
            else -> {
                WatchLog.w("v2: no raw channel for $channel")
                -1
            }
        }

        private fun channelFromRaw(raw: Int): Channel = when (raw) {
            CHANNEL_PROTOBUF -> Channel.ProtobufCommand
            CHANNEL_ACTIVITY -> Channel.Activity
            CHANNEL_DATA -> Channel.Data
            else -> {
                WatchLog.w("v2: unknown raw channel $raw")
                Channel.Unknown
            }
        }

        fun opCodeForChannel(channel: Channel): Int = when (channel) {
            Channel.Authentication, Channel.Data -> OPCODE_SEND_PLAINTEXT
            Channel.ProtobufCommand, Channel.Activity -> OPCODE_SEND_ENCRYPTED
            else -> {
                WatchLog.w("v2: no opcode for $channel")
                OPCODE_UNKNOWN
            }
        }

        /** The data-packet payload `rawChannel | opcode | body`, with the body encrypted if the opcode says so. */
        fun dataPayload(channel: Channel, body: ByteArray, crypto: PacketCrypto): ByteArray {
            val opCode = opCodeForChannel(channel)
            val encoded = if (opCode == OPCODE_SEND_ENCRYPTED) crypto.encryptV2(body) else body
            return ByteBuffer.allocate(2 + encoded.size)
                .put((getRawChannel(channel) and 0xf).toByte())
                .put((opCode and 0xff).toByte())
                .put(encoded)
                .array()
        }

        /** CRC-16/ARC (poly 0x8005, init 0, reflected in and out) over the payload. */
        fun crc16(payload: ByteArray): Int {
            var crc = 0
            for (b in payload) {
                for (j in 0 until 8) {
                    crc = crc shl 1
                    if ((((crc shr 16) and 1) xor ((b.toInt() shr j) and 1)) == 1) crc = crc xor 0x8005
                }
            }
            return Integer.reverse(crc) ushr 16
        }

        /** The checksum covers the payload only, so a payload can be encrypted before its sequence number is known. */
        fun encodeFrame(packetType: Int, sequenceNumber: Int, payload: ByteArray): ByteArray {
            val buf = ByteBuffer.allocate(HEADER_SIZE + payload.size).order(ByteOrder.LITTLE_ENDIAN)
            buf.put(PREAMBLE)
            buf.put((packetType and 0xf).toByte())
            buf.put((sequenceNumber and 0xff).toByte())
            buf.putShort(payload.size.toShort())
            buf.putShort(crc16(payload).toShort())
            buf.put(payload)
            return buf.array()
        }

        fun encodeAck(sequenceNumber: Int) = encodeFrame(PACKET_TYPE_ACK, sequenceNumber, ByteArray(0))

        /** Decodes one complete frame; null (after logging) if it is short, truncated, fails its CRC or is of an unknown type. */
        fun decode(bytes: ByteArray): SppPacketV2? {
            if (bytes.size < HEADER_SIZE) {
                WatchLog.w("v2: need at least $HEADER_SIZE bytes, got ${bytes.size}")
                return null
            }
            val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            val preamble = ByteArray(2).also { buf.get(it) }
            if (!preamble.contentEquals(PREAMBLE)) {
                WatchLog.w("v2: header mismatch, expected ${PREAMBLE.toHex()}, got ${preamble.toHex()}")
                return null
            }
            val type = buf.get().toInt() and 0xf
            val seq = buf.get().toInt() and 0xff
            val length = buf.short.toInt() and 0xffff
            val givenCrc = buf.short.toInt() and 0xffff
            if (buf.remaining() < length) {
                WatchLog.w("v2: truncated, need ${length + HEADER_SIZE}B, have ${bytes.size}B")
                return null
            }
            val payload = ByteArray(length).also { buf.get(it) }
            val crc = crc16(payload)
            if (crc != givenCrc) {
                WatchLog.w("v2: payload checksum mismatch, given $givenCrc != calculated $crc")
                return null
            }
            return when (type) {
                PACKET_TYPE_SESSION_CONFIG -> decodeSessionConfig(seq, payload)
                PACKET_TYPE_DATA -> decodeData(seq, payload)
                PACKET_TYPE_ACK -> Ack(seq)
                PACKET_TYPE_NACK -> Nack(seq)
                else -> {
                    WatchLog.w("v2: unhandled packet type $type: ${bytes.toHex()}")
                    null
                }
            }
        }

        private fun decodeSessionConfig(seq: Int, payload: ByteArray): SppPacketV2? {
            if (payload.isEmpty()) {
                WatchLog.w("v2: empty session config")
                return null
            }
            val opCode = payload[0].toInt() and 0xff
            WatchLog.d("v2: session config opcode=$opCode body=${payload.toHex()}")
            return SessionConfig(seq, opCode)
        }

        private fun decodeData(seq: Int, payload: ByteArray): SppPacketV2? {
            if (payload.size < 2) {
                WatchLog.w("v2: data packet too short: ${payload.toHex()}")
                return null
            }
            val rawChannel = payload[0].toInt() and 0xf
            val opCode = payload[1].toInt() and 0xff
            return Data(seq, channelFromRaw(rawChannel), opCode, payload.copyOfRange(2, payload.size))
        }
    }
}
