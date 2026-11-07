package app.kumquant.healthbridge.watch.services

import app.kumquant.healthbridge.proto.xiaomi.Music
import app.kumquant.healthbridge.proto.xiaomi.MusicInfo
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.CommandChannel
import app.kumquant.healthbridge.watch.MusicCommand
import app.kumquant.healthbridge.watch.NowPlaying
import app.kumquant.healthbridge.watch.WatchListener
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.XiaomiService

/**
 * Now-playing info to the watch's music app and its buttons back (command type 18). Ported from
 * Gadgetbridge's XiaomiMusicService; the phone-side media session lives in the app.
 */
internal class MusicService(
    private val channel: CommandChannel,
    private val listener: WatchListener,
) : XiaomiService(COMMAND_TYPE) {

    @Volatile
    private var last: NowPlaying? = null

    fun send(np: NowPlaying) {
        last = np
        channel.send(infoCommand(np))
    }

    override fun handle(cmd: XiaomiProto.Command) {
        when (cmd.subtype) {
            CMD_MUSIC_GET -> {
                WatchLog.i("watch asked for music info")
                // Answer from the cache right away so the watch is not left blank, then let the app refresh it.
                channel.send(infoCommand(last))
                listener.onMusicInfoRequested()
            }
            CMD_MUSIC_BUTTON -> {
                val key = cmd.music.mediaKey
                val command = commandFor(key.key, if (key.hasVolume()) key.volume else null, last?.volumePct)
                WatchLog.i("watch music button ${key.key} volume=${if (key.hasVolume()) key.volume else -1} -> $command")
                if (command != null) listener.onMusicCommand(command)
            }
            CMD_MUSIC_SEND -> WatchLog.d("music info acked, status=${if (cmd.hasStatus()) cmd.status else 0}")
            else -> WatchLog.w("unhandled music command ${cmd.subtype}: $cmd")
        }
    }

    companion object {
        const val COMMAND_TYPE = 18

        const val CMD_MUSIC_GET = 0
        const val CMD_MUSIC_SEND = 1
        const val CMD_MUSIC_BUTTON = 2

        const val BUTTON_PLAY = 0
        const val BUTTON_PAUSE = 1
        /**
         * Sent by the S5 on its own (not a button press; probably its music screen waking). Mapping it to
         * play/pause started the user's music unasked (2026-11-06), so it is ignored.
         */
        const val BUTTON_UNPROMPTED = 2
        const val BUTTON_PREVIOUS = 3
        const val BUTTON_NEXT = 4
        const val BUTTON_VOLUME = 5

        const val STATE_NOTHING = 0
        const val STATE_PLAYING = 1
        const val STATE_PAUSED = 2

        /**
         * A watch button as a [MusicCommand]. The volume button carries the volume the watch wants;
         * Gadgetbridge compares it with the phone's current volume, so does this (100 and 0 are the
         * watch's own up and down; with no known volume anything else counts as up).
         */
        fun commandFor(key: Int, requestedVolume: Int?, currentVolume: Int?): MusicCommand? = when (key) {
            BUTTON_PLAY -> MusicCommand.PLAY
            BUTTON_PAUSE -> MusicCommand.PAUSE
            BUTTON_UNPROMPTED -> null
            BUTTON_PREVIOUS -> MusicCommand.PREVIOUS
            BUTTON_NEXT -> MusicCommand.NEXT
            BUTTON_VOLUME -> when {
                requestedVolume == null -> null
                requestedVolume >= 100 -> MusicCommand.VOLUME_UP
                requestedVolume <= 0 -> MusicCommand.VOLUME_DOWN
                currentVolume != null && requestedVolume <= currentVolume -> MusicCommand.VOLUME_DOWN
                else -> MusicCommand.VOLUME_UP
            }
            else -> {
                WatchLog.w("unexpected media button key $key")
                null
            }
        }

        /** Position and duration go to the watch in seconds; no title and artist means nothing is playing. */
        fun infoCommand(np: NowPlaying?): XiaomiProto.Command {
            val info = MusicInfo.newBuilder().setVolume(np?.volumePct ?: 0)
            if (np == null || (np.title == null && np.artist == null)) {
                info.state = STATE_NOTHING
            } else {
                info.setState(if (np.playing) STATE_PLAYING else STATE_PAUSED)
                    .setTrack(np.title.orEmpty())
                    .setArtist(np.artist.orEmpty())
                    .setPosition(((np.positionMs ?: 0L) / 1000).toInt())
                    .setDuration(((np.durationMs ?: 0L) / 1000).toInt())
            }
            return XiaomiProto.Command.newBuilder()
                .setType(COMMAND_TYPE)
                .setSubtype(CMD_MUSIC_SEND)
                .setMusic(Music.newBuilder().setMusicInfo(info))
                .build()
        }
    }
}
