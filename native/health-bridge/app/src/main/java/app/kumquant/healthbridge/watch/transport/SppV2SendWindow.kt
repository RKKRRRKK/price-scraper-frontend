package app.kumquant.healthbridge.watch.transport

/**
 * Sequence numbers and unacked frames of the data packets sent over SPP v2. Sequence numbers are
 * 8 bit and wrap. Acks are cumulative: acking a sequence number releases every frame sent up to
 * and including it. Ported from Gadgetbridge's XiaomiSppV2SendWindow.
 */
internal class SppV2SendWindow {
    private class Frame(val sequenceNumber: Int, val bytes: ByteArray)

    private val unacked = ArrayDeque<Frame>()
    private var nextSeq = 0

    @Synchronized
    fun nextSequenceNumber(): Int {
        val seq = nextSeq
        nextSeq = (nextSeq + 1) and 0xff
        return seq
    }

    /** Tracks a written frame until it is acked; past [MAX_TRACKED_FRAMES] the oldest is forgotten and can no longer be resent. */
    @Synchronized
    fun onSent(sequenceNumber: Int, frame: ByteArray) {
        unacked.addLast(Frame(sequenceNumber, frame))
        while (unacked.size > MAX_TRACKED_FRAMES) unacked.removeFirst()
    }

    /** Releases every frame up to and including [sequenceNumber]; returns how many, 0 if it matches no unacked frame. */
    @Synchronized
    fun onAck(sequenceNumber: Int): Int {
        if (unacked.none { it.sequenceNumber == sequenceNumber }) return 0
        var released = 0
        do {
            val frame = unacked.removeFirst()
            released++
        } while (frame.sequenceNumber != sequenceNumber)
        return released
    }

    /** Sequence number of the oldest unacked frame, or -1 if everything was acked. */
    @get:Synchronized
    val oldestUnacked: Int get() = unacked.firstOrNull()?.sequenceNumber ?: -1

    @Synchronized
    fun isEmpty(): Boolean = unacked.isEmpty()

    /** The unacked frames, oldest first, as they were written. */
    @Synchronized
    fun unackedFrames(): List<ByteArray> = unacked.map { it.bytes }

    @Synchronized
    fun clear() {
        unacked.clear()
        nextSeq = 0
    }

    companion object {
        /** Half the sequence space, so a sequence number identifies at most one tracked frame. */
        const val MAX_TRACKED_FRAMES = 128
    }
}
