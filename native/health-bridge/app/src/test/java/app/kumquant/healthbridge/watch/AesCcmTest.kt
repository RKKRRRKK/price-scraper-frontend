package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.watch.crypto.AesCcm
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.security.GeneralSecurityException

class AesCcmTest {
    private fun hex(s: String) = s.replace(" ", "").hexToBytes()

    /** RFC 3610 packet vector #1: 13-byte nonce, 8 bytes of AAD, 8-byte tag. */
    @Test
    fun rfc3610Vector1() {
        val ccm = AesCcm(hex("C0C1C2C3C4C5C6C7C8C9CACBCCCDCECF"))
        val nonce = hex("00000003020100A0A1A2A3A4A5")
        val aad = hex("0001020304050607")
        val plain = hex("08090A0B0C0D0E0F101112131415161718191A1B1C1D1E")
        val expected = hex("588C979A61C663D2F066D0C2C0F989806D5F6B61DAC384 17E8D12CFDF926E0")
        assertArrayEquals(expected, ccm.encrypt(nonce, plain, aad, 8))
        assertArrayEquals(plain, ccm.decrypt(nonce, expected, aad, 8))
    }

    /** NIST SP 800-38C example 1: 7-byte nonce, 4-byte tag. */
    @Test
    fun nistExample1() {
        val ccm = AesCcm(hex("404142434445464748494a4b4c4d4e4f"))
        val nonce = hex("10111213141516")
        val aad = hex("0001020304050607")
        val plain = hex("20212223")
        val expected = hex("7162015b4dac255d")
        assertArrayEquals(expected, ccm.encrypt(nonce, plain, aad, 4))
        assertArrayEquals(plain, ccm.decrypt(nonce, expected, aad, 4))
    }

    /** Vectors from Python's cryptography AESCCM with the 12-byte nonce and 4-byte tag Gadgetbridge uses. */
    @Test
    fun twelveByteNonceFourByteTag() {
        val ccm = AesCcm(ByteArray(16) { it.toByte() })
        val nonce = ByteArray(12) { (100 + it).toByte() }
        val cases = mapOf(
            "" to "5291abb8",
            "68656c6c6f" to "c82cfb4dd28ee16d2f",
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2021222324252627" to
                "a0489522b91efde0d8f1b0e2b1ccaa456e2886e09148e4e13450a76f077873e8348033b31a0e948e1fe84e08",
        )
        for ((plain, cipher) in cases) {
            assertEquals(cipher, ccm.encrypt(nonce, plain.hexToBytes()).toHex())
            assertEquals(plain, ccm.decrypt(nonce, cipher.hexToBytes()).toHex())
        }
    }

    @Test
    fun aadWithEightByteTag() {
        val ccm = AesCcm(ByteArray(16) { it.toByte() })
        val nonce = ByteArray(12) { (100 + it).toByte() }
        val expected = "d028ee4dd27a9fc7b281ce8ccee07df45824b41573fc"
        assertEquals(expected, ccm.encrypt(nonce, "payload bytes!".toByteArray(), "header".toByteArray(), 8).toHex())
    }

    @Test
    fun tamperedCiphertextOrTagIsRejected() {
        val ccm = AesCcm(ByteArray(16) { it.toByte() })
        val nonce = ByteArray(12) { (100 + it).toByte() }
        val good = ccm.encrypt(nonce, "hello".toByteArray())
        for (i in good.indices) {
            val bad = good.copyOf().also { it[i] = (it[i].toInt() xor 1).toByte() }
            try {
                ccm.decrypt(nonce, bad)
                fail("byte $i flipped but decrypt succeeded")
            } catch (_: GeneralSecurityException) {
            }
        }
    }

    /** Gadgetbridge's `checkDecryptionMac = false` path: the last 4 bytes are dropped without being checked. */
    @Test
    fun unverifiedDecryptIgnoresTheTag() {
        val ccm = AesCcm(ByteArray(16) { it.toByte() })
        val nonce = ByteArray(12) { (100 + it).toByte() }
        val good = ccm.encrypt(nonce, "hello".toByteArray())
        val badTag = good.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 0x55).toByte() }
        assertEquals("hello", String(ccm.decryptUnverified(nonce, badTag)))
    }
}
