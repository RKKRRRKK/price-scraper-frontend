package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.proto.xiaomi.Account
import app.kumquant.healthbridge.proto.xiaomi.Auth
import app.kumquant.healthbridge.proto.xiaomi.CompanionDevice
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.auth.CompanionInfo
import app.kumquant.healthbridge.watch.auth.XiaomiAuth
import app.kumquant.healthbridge.watch.crypto.AesCcm
import com.google.protobuf.ByteString
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.SecureRandom

/**
 * The first two tests are Gadgetbridge's XiaomiAuthServiceTest. The rest check the handshake math
 * against vectors computed independently with Python's hmac/hashlib/cryptography
 * (native/watch-lab venv), playing the watch's side by hand.
 */
class XiaomiAuthTest {
    private val nonce = byteArrayOf(
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
        0x88.toByte(), 0x99.toByte(), 0xaa.toByte(), 0xbb.toByte(),
        0xcc.toByte(), 0xdd.toByte(), 0xee.toByte(), 0xff.toByte(),
    )

    @Test
    fun nonceCommandWithDeviceId() {
        val appVerify = XiaomiAuth.buildNonceCommand(nonce, "0123456789abcdef0123456789abcdef").auth.appVerify
        assertArrayEquals(nonce, appVerify.nonce.toByteArray())
        assertTrue(appVerify.hasDeviceId())
        assertEquals("0123456789abcdef0123456789abcdef", appVerify.deviceId)
    }

    @Test
    fun nonceCommandWithoutDeviceIdIsUnchangedOnTheWire() {
        val expected = XiaomiProto.Command.newBuilder()
            .setType(XiaomiAuth.COMMAND_TYPE)
            .setSubtype(XiaomiAuth.CMD_NONCE)
            .setAuth(Account.newBuilder().setAppVerify(Auth.AppVerify.newBuilder().setNonce(ByteString.copyFrom(nonce))))
            .build()
            .toByteArray()
        for (noDeviceId in listOf(null, "")) {
            val cmd = XiaomiAuth.buildNonceCommand(nonce, noDeviceId)
            assertFalse(cmd.auth.appVerify.hasDeviceId())
            assertArrayEquals(expected, cmd.toByteArray())
        }
    }

    private val key = "000102030405060708090a0b0c0d0e0f".hexToBytes()
    private val phoneNonce = ByteArray(16) { (0x10 + it).toByte() }
    private val watchNonce = ByteArray(16) { (0x80 + it).toByte() }

    private fun fixedRandom(bytes: ByteArray) = object : SecureRandom() {
        override fun nextBytes(out: ByteArray) = System.arraycopy(bytes, 0, out, 0, out.size)
    }

    private fun newAuth() = XiaomiAuth(key, CompanionInfo(35, "Pixel", "EN"), fixedRandom(phoneNonce))

    private fun deviceVerify(hmac: ByteArray) = Auth.DeviceVerify.newBuilder()
        .setNonce(ByteString.copyFrom(watchNonce))
        .setHmac(ByteString.copyFrom(hmac))
        .build()

    @Test
    fun keyDerivationMatchesIndependentImplementation() {
        val out = XiaomiAuth.computeAuthStep3Hmac(key, phoneNonce, watchNonce)
        assertEquals(
            "c444b19878ccc1f70d1ddde0e889990acc88119eeb2353715227697805e73add" +
                "221a3f1262302558835535edb6852aa29491a38438fd005fe2edbef75eb3a616",
            out.toHex(),
        )
    }

    @Test
    fun handshakeStepsAndSessionCrypto() {
        val auth = newAuth()
        val step1 = auth.startHandshake()
        assertEquals(XiaomiAuth.CMD_NONCE, step1.subtype)
        assertArrayEquals(phoneNonce, step1.auth.appVerify.nonce.toByteArray())
        assertFalse(auth.encryptionInitialized)

        val watchHmac = "a5626f6f2d1276cfa42a8649d46941c851362226c4e1edbbf4e395bc48bfa3c8".hexToBytes()
        val step2 = auth.handleWatchNonce(deviceVerify(watchHmac))
        assertNotNull(step2)
        assertEquals(XiaomiAuth.CMD_AUTH, step2!!.subtype)
        val confirm = step2.auth.appConfirm
        assertEquals(
            "06ae8d7b9755211aab70b9426f69d1606f8c52f1049178d4e14977fc16286c98",
            confirm.encryptedNonces.toByteArray().toHex(),
        )

        // The watch can open the phone's device info with the phone->watch key and counter 0.
        val derived = XiaomiAuth.computeAuthStep3Hmac(key, phoneNonce, watchNonce)
        val encKey = derived.copyOfRange(16, 32)
        val encNonce = derived.copyOfRange(36, 40) + ByteArray(8)
        val info = CompanionDevice.parseFrom(AesCcm(encKey).decrypt(encNonce, confirm.encryptedDeviceInfo.toByteArray()))
        assertEquals("Pixel", info.phoneName)
        assertEquals("EN", info.region)
        assertEquals(35f, info.phoneApiLevel, 0f)

        // Session crypto against Python vectors.
        assertEquals("91ffed37bedb9a68b20608d45f4c60", auth.encryptV1("hello watch".toByteArray(), 0).toHex())
        assertEquals("cea3e383250a7fb380e7517c7467e3", auth.encryptV1("hello watch".toByteArray(), 5).toHex())
        assertEquals("from the watch", String(auth.decryptV1("80dc1bf9445792db789e37c181f3e861a551".hexToBytes())))
        assertEquals("1488023cd755f081b71f", auth.encryptV2("v2 message".toByteArray()).toHex())
        assertEquals("v2 from watch", String(auth.decryptV2("953ba756bfdfbe339971418b08".hexToBytes())))

        auth.markAuthenticated()
        assertTrue(auth.encryptionInitialized)
    }

    @Test
    fun wrongWatchProofMeansWrongKey() {
        val auth = newAuth()
        auth.startHandshake()
        assertNull(auth.handleWatchNonce(deviceVerify(ByteArray(32))))
    }

    @Test
    fun aMacMismatchOnDecryptThrows() {
        val auth = newAuth()
        auth.startHandshake()
        auth.handleWatchNonce(deviceVerify("a5626f6f2d1276cfa42a8649d46941c851362226c4e1edbbf4e395bc48bfa3c8".hexToBytes()))
        try {
            auth.decryptV1("80dc1bf9445792db789e37c181f3e861a552".hexToBytes())
            fail("expected a tag mismatch")
        } catch (_: java.security.GeneralSecurityException) {
        }
    }

    @Test
    fun keyParsing() {
        assertArrayEquals(key, XiaomiAuth.parseKey("000102030405060708090a0b0c0d0e0f"))
        assertArrayEquals(key, XiaomiAuth.parseKey(" 0x000102030405060708090A0B0C0D0E0F "))
        for (bad in listOf("", "0001", "zz0102030405060708090a0b0c0d0e0f", "000102030405060708090a0b0c0d0e0f00")) {
            try {
                XiaomiAuth.parseKey(bad)
                fail("accepted '$bad'")
            } catch (_: IllegalArgumentException) {
            }
        }
    }
}
