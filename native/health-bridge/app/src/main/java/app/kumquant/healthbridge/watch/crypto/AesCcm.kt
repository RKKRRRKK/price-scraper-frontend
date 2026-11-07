package app.kumquant.healthbridge.watch.crypto

import java.security.GeneralSecurityException
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/**
 * AES-CCM (RFC 3610 / NIST SP 800-38C) over `AES/ECB/NoPadding`, so no BouncyCastle is needed.
 * [encrypt] returns `ciphertext || tag`, the layout BouncyCastle's CCMBlockCipher produces and
 * the Xiaomi watches use. Gadgetbridge calls it with a 12-byte nonce (L = 3) and a 4-byte tag.
 */
class AesCcm(key: ByteArray) {
    private val cipher: Cipher = Cipher.getInstance("AES/ECB/NoPadding")

    init {
        require(key.size == 16 || key.size == 24 || key.size == 32) { "bad AES key size ${key.size}" }
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
    }

    /** Encrypts [plaintext] and appends a [tagLen]-byte tag. */
    @Synchronized
    fun encrypt(nonce: ByteArray, plaintext: ByteArray, aad: ByteArray = EMPTY, tagLen: Int = 4): ByteArray {
        checkParams(nonce, tagLen)
        val tag = cbcMac(nonce, plaintext, aad, tagLen)
        val out = ByteArray(plaintext.size + tagLen)
        ctr(nonce, plaintext, out)
        val s0 = keystreamBlock(nonce, 0)
        for (i in 0 until tagLen) out[plaintext.size + i] = (tag[i].toInt() xor s0[i].toInt()).toByte()
        return out
    }

    /**
     * Decrypts `ciphertext || tag` and verifies the tag in constant time.
     * @throws GeneralSecurityException if the tag does not match
     */
    @Synchronized
    fun decrypt(nonce: ByteArray, input: ByteArray, aad: ByteArray = EMPTY, tagLen: Int = 4): ByteArray {
        checkParams(nonce, tagLen)
        if (input.size < tagLen) throw GeneralSecurityException("ciphertext shorter than the tag")
        val len = input.size - tagLen
        val plain = ByteArray(len)
        ctr(nonce, input.copyOf(len), plain)
        val s0 = keystreamBlock(nonce, 0)
        val expected = cbcMac(nonce, plain, aad, tagLen)
        val actual = ByteArray(tagLen) { (input[len + it].toInt() xor s0[it].toInt()).toByte() }
        if (!MessageDigest.isEqual(expected, actual)) throw GeneralSecurityException("CCM tag mismatch")
        return plain
    }

    /**
     * Decrypts and drops the trailing [tagLen] bytes without checking them. Gadgetbridge does this
     * for devices whose tags are known to be wrong (it hands BouncyCastle a zero-length MAC).
     */
    @Synchronized
    fun decryptUnverified(nonce: ByteArray, input: ByteArray, tagLen: Int = 4): ByteArray {
        checkParams(nonce, tagLen)
        val len = (input.size - tagLen).coerceAtLeast(0)
        val plain = ByteArray(len)
        ctr(nonce, input.copyOf(len), plain)
        return plain
    }

    private fun checkParams(nonce: ByteArray, tagLen: Int) {
        require(nonce.size in 7..13) { "CCM nonce must be 7..13 bytes, got ${nonce.size}" }
        require(tagLen in 4..16 && tagLen % 2 == 0) { "CCM tag length must be 4..16 and even, got $tagLen" }
    }

    private fun aes(block: ByteArray): ByteArray = cipher.doFinal(block)

    /** Counter-mode keystream block A_[counter]. */
    private fun keystreamBlock(nonce: ByteArray, counter: Int): ByteArray {
        val l = 15 - nonce.size
        val a = ByteArray(16)
        a[0] = (l - 1).toByte()
        System.arraycopy(nonce, 0, a, 1, nonce.size)
        var c = counter
        for (i in 15 downTo 16 - l) {
            a[i] = (c and 0xff).toByte()
            c = c ushr 8
        }
        return aes(a)
    }

    private fun ctr(nonce: ByteArray, src: ByteArray, dst: ByteArray) {
        var counter = 1
        var pos = 0
        while (pos < src.size) {
            val ks = keystreamBlock(nonce, counter++)
            val n = minOf(16, src.size - pos)
            for (i in 0 until n) dst[pos + i] = (src[pos + i].toInt() xor ks[i].toInt()).toByte()
            pos += n
        }
    }

    /** CBC-MAC over B0, the encoded AAD and the zero-padded message; the first [tagLen] bytes. */
    private fun cbcMac(nonce: ByteArray, message: ByteArray, aad: ByteArray, tagLen: Int): ByteArray {
        val l = 15 - nonce.size
        require(l >= 4 || message.size.toLong() < (1L shl (8 * l))) { "message too long for CCM with L=$l" }
        val b0 = ByteArray(16)
        b0[0] = ((if (aad.isNotEmpty()) 0x40 else 0) or (((tagLen - 2) / 2) shl 3) or (l - 1)).toByte()
        System.arraycopy(nonce, 0, b0, 1, nonce.size)
        var q = message.size
        for (i in 15 downTo 16 - l) {
            b0[i] = (q and 0xff).toByte()
            q = q ushr 8
        }
        var x = aes(b0)

        if (aad.isNotEmpty()) {
            val header = if (aad.size < 0xff00) {
                byteArrayOf((aad.size ushr 8).toByte(), aad.size.toByte())
            } else {
                byteArrayOf(
                    0xff.toByte(), 0xfe.toByte(),
                    (aad.size ushr 24).toByte(), (aad.size ushr 16).toByte(), (aad.size ushr 8).toByte(), aad.size.toByte(),
                )
            }
            x = macBlocks(x, header + aad)
        }
        if (message.isNotEmpty()) x = macBlocks(x, message)
        return x.copyOf(tagLen)
    }

    /** Feeds [data], zero padded to whole blocks, through the CBC chain starting at [start]. */
    private fun macBlocks(start: ByteArray, data: ByteArray): ByteArray {
        var x = start
        var pos = 0
        while (pos < data.size) {
            val block = ByteArray(16)
            val n = minOf(16, data.size - pos)
            for (i in 0 until 16) block[i] = (x[i].toInt() xor (if (i < n) data[pos + i].toInt() else 0)).toByte()
            x = aes(block)
            pos += n
        }
        return x
    }

    private companion object {
        val EMPTY = ByteArray(0)
    }
}
