package app.kumquant.healthbridge.watch.transport

/**
 * What the SPP packet layers need from the session keys. Implemented by `XiaomiAuth`; tests
 * can swap in a fake.
 */
internal interface PacketCrypto {
    /** True once the auth handshake finished; before that, encrypted-typed packets pass through untouched. */
    val encryptionInitialized: Boolean

    /** SPP v1: AES-CCM with the packet counter in the nonce. */
    fun encryptV1(payload: ByteArray, counter: Int): ByteArray

    /** SPP v1: AES-CCM with counter 0; throws if the tag does not verify. */
    fun decryptV1(payload: ByteArray): ByteArray

    /** SPP v2: AES-CTR with the key doubling as IV. */
    fun encryptV2(payload: ByteArray): ByteArray

    fun decryptV2(payload: ByteArray): ByteArray
}
