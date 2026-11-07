package app.kumquant.healthbridge.watch.auth

import app.kumquant.healthbridge.proto.xiaomi.Account
import app.kumquant.healthbridge.proto.xiaomi.Auth
import app.kumquant.healthbridge.proto.xiaomi.CompanionDevice
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.crypto.AesCcm
import app.kumquant.healthbridge.watch.hexToBytes
import app.kumquant.healthbridge.watch.toHex
import app.kumquant.healthbridge.watch.transport.PacketCrypto
import com.google.protobuf.ByteString
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** What the watch is told about the phone during auth step 2 (cosmetic, but the field is required). */
data class CompanionInfo(val apiLevel: Int, val phoneName: String, val region: String)

/**
 * The Xiaomi encrypted handshake and the session crypto it yields. Ported from Gadgetbridge's
 * XiaomiAuthService.
 *
 * 1. Phone sends a random 16-byte nonce (command 1/26).
 * 2. Watch answers with its own nonce and an HMAC proving it knows the key; the phone checks it.
 * 3. Both derive two AES keys and two 4-byte nonces from HMAC-SHA256 over the nonces and the auth
 *    key; the phone confirms with a second HMAC plus its encrypted [CompanionInfo] (command 1/27).
 * 4. The watch's reply to step 3 means the link is authenticated and everything after is encrypted.
 *
 * The 16-byte auth key is never logged beyond its first 4 hex chars.
 */
internal class XiaomiAuth(
    authKey: ByteArray,
    private val companion: CompanionInfo,
    private val random: SecureRandom = SecureRandom(),
    /** False for watches whose CCM tags are known to be wrong; the tag is then dropped unchecked. */
    private val checkDecryptionMac: Boolean = true,
) : PacketCrypto {

    init {
        require(authKey.size == 16) { "auth key must be 16 bytes" }
    }

    private val secretKey = authKey.copyOf()
    private val nonce = ByteArray(16)
    private val encryptionKey = ByteArray(16)
    private val decryptionKey = ByteArray(16)
    private val encryptionNonce = ByteArray(4)
    private val decryptionNonce = ByteArray(4)
    private var encryptCcm: AesCcm? = null
    private var decryptCcm: AesCcm? = null

    @Volatile
    override var encryptionInitialized: Boolean = false
        private set

    /** Marks the handshake done; from here incoming encrypted packets are decrypted. */
    fun markAuthenticated() {
        encryptionInitialized = true
    }

    /** Starts (or restarts) a handshake: new nonce, encryption off. Returns the step-1 command. */
    fun startHandshake(deviceId: String? = null): XiaomiProto.Command {
        encryptionInitialized = false
        random.nextBytes(nonce)
        return buildNonceCommand(nonce, deviceId)
    }

    /**
     * Handles the watch's nonce (command 1/26 reply).
     * @return the step-2 command, or null if the watch's HMAC does not match, which means the auth key is wrong
     */
    fun handleWatchNonce(deviceVerify: Auth.DeviceVerify): XiaomiProto.Command? {
        val watchNonce = deviceVerify.nonce.toByteArray()
        val keys = computeAuthStep3Hmac(secretKey, nonce, watchNonce)
        System.arraycopy(keys, 0, decryptionKey, 0, 16)
        System.arraycopy(keys, 16, encryptionKey, 0, 16)
        System.arraycopy(keys, 32, decryptionNonce, 0, 4)
        System.arraycopy(keys, 36, encryptionNonce, 0, 4)
        encryptCcm = AesCcm(encryptionKey)
        decryptCcm = AesCcm(decryptionKey)

        val expected = hmacSha256(decryptionKey, watchNonce + nonce)
        if (!MessageDigest.isEqual(expected, deviceVerify.hmac.toByteArray())) return null

        val deviceInfo = CompanionDevice.newBuilder()
            .setUnknown1(0)
            .setPhoneApiLevel(companion.apiLevel.toFloat())
            .setPhoneName(companion.phoneName)
            .setUnknown3(224)
            .setRegion(companion.region)
            .build()
        val encryptedNonces = hmacSha256(encryptionKey, nonce + watchNonce)
        val encryptedDeviceInfo = encryptV1(deviceInfo.toByteArray(), 0)
        val confirm = Auth.AppConfirm.newBuilder()
            .setEncryptedNonces(ByteString.copyFrom(encryptedNonces))
            .setEncryptedDeviceInfo(ByteString.copyFrom(encryptedDeviceInfo))
            .build()
        return XiaomiProto.Command.newBuilder()
            .setType(COMMAND_TYPE)
            .setSubtype(CMD_AUTH)
            .setAuth(Account.newBuilder().setAppConfirm(confirm))
            .build()
    }

    override fun encryptV1(payload: ByteArray, counter: Int): ByteArray {
        val nonce = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN)
            .put(encryptionNonce).putInt(0).putInt(counter).array()
        return checkNotNull(encryptCcm) { "encrypt before handshake" }.encrypt(nonce, payload)
    }

    override fun decryptV1(payload: ByteArray): ByteArray {
        val nonce = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN)
            .put(decryptionNonce).putInt(0).putInt(0).array()
        val ccm = checkNotNull(decryptCcm) { "decrypt before handshake" }
        return if (checkDecryptionMac) ccm.decrypt(nonce, payload) else ccm.decryptUnverified(nonce, payload)
    }

    override fun encryptV2(payload: ByteArray): ByteArray = ctr(Cipher.ENCRYPT_MODE, encryptionKey, payload)

    override fun decryptV2(payload: ByteArray): ByteArray = ctr(Cipher.DECRYPT_MODE, decryptionKey, payload)

    /** SPP v2 reuses the AES key as the CTR IV for every message. */
    private fun ctr(mode: Int, key: ByteArray, payload: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/CTR/NoPadding")
        cipher.init(mode, SecretKeySpec(key, "AES"), IvParameterSpec(key))
        return cipher.doFinal(payload)
    }

    /** First 4 hex chars of the key, the most that may be logged. */
    fun keyHint(): String = secretKey.toHex().take(4)

    companion object {
        const val COMMAND_TYPE = 1
        const val CMD_SEND_USERID = 5
        const val CMD_NONCE = 26
        const val CMD_AUTH = 27

        /** Parses the 32-hex auth key, with or without a leading `0x`. */
        fun parseKey(hex: String): ByteArray {
            val s = hex.trim().removePrefix("0x").removePrefix("0X")
            require(s.length == 32) { "auth key must be 32 hex characters" }
            return try {
                s.hexToBytes()
            } catch (_: IllegalArgumentException) {
                throw IllegalArgumentException("auth key must be 32 hex characters")
            }
        }

        fun buildNonceCommand(nonce: ByteArray, deviceId: String?): XiaomiProto.Command {
            val verify = Auth.AppVerify.newBuilder().setNonce(ByteString.copyFrom(nonce))
            // Wear OS watches (Watch 5) need an identity here; Xiaomi's own OS does not.
            if (!deviceId.isNullOrEmpty()) verify.setDeviceId(deviceId)
            return XiaomiProto.Command.newBuilder()
                .setType(COMMAND_TYPE)
                .setSubtype(CMD_NONCE)
                .setAuth(Account.newBuilder().setAppVerify(verify))
                .build()
        }

        /**
         * 64 bytes of key material: decryption key, encryption key, decryption nonce, encryption nonce
         * (16 + 16 + 4 + 4 used). An HKDF-like expansion keyed by HMAC(phoneNonce || watchNonce, authKey).
         */
        fun computeAuthStep3Hmac(secretKey: ByteArray, phoneNonce: ByteArray, watchNonce: ByteArray): ByteArray {
            val label = "miwear-auth".toByteArray()
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(phoneNonce + watchNonce, "HmacSHA256"))
            val prk = mac.doFinal(secretKey)
            mac.init(SecretKeySpec(prk, "HmacSHA256"))

            val output = ByteArray(64)
            var tmp = ByteArray(0)
            var counter: Byte = 1
            var i = 0
            while (i < output.size) {
                mac.update(tmp)
                mac.update(label)
                mac.update(counter)
                tmp = mac.doFinal()
                var j = 0
                while (j < tmp.size && i < output.size) output[i++] = tmp[j++]
                counter++
            }
            return output
        }

        fun hmacSha256(key: ByteArray, input: ByteArray): ByteArray {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key, "HmacSHA256"))
            return mac.doFinal(input)
        }
    }
}
