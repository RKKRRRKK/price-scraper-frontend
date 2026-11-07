package app.kumquant.healthbridge.service

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.util.Log
import android.view.KeyEvent
import app.kumquant.healthbridge.watch.MusicCommand
import app.kumquant.healthbridge.watch.NowPlaying

/**
 * Tracks the active media session (needs notification access) and mirrors it to the watch;
 * executes the watch's music commands on it, or as media keys when no session is visible.
 */
class MusicBridge(
    private val context: Context,
    private val listener: ComponentName,
    private val onChange: (NowPlaying) -> Unit,
) {
    private val sessions = context.getSystemService(MediaSessionManager::class.java)
    private val audio = context.getSystemService(AudioManager::class.java)
    private var controller: MediaController? = null

    private val activeListener = MediaSessionManager.OnActiveSessionsChangedListener { pick(it.orEmpty()) }

    private val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = onChange(nowPlaying())
        override fun onMetadataChanged(metadata: MediaMetadata?) = onChange(nowPlaying())
        override fun onSessionDestroyed() { pick(active()) }
    }

    fun start() {
        try {
            sessions.addOnActiveSessionsChangedListener(activeListener, listener)
            pick(active())
        } catch (e: SecurityException) {
            Log.w(TAG, "No notification access for media sessions: ${e.message}")
        }
    }

    fun stop() {
        runCatching { sessions.removeOnActiveSessionsChangedListener(activeListener) }
        controller?.unregisterCallback(callback)
        controller = null
    }

    private fun active(): List<MediaController> =
        runCatching { sessions.getActiveSessions(listener) }.getOrDefault(emptyList())

    private fun pick(list: List<MediaController>) {
        val next = list.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: list.firstOrNull()
        if (next?.sessionToken == controller?.sessionToken) return
        controller?.unregisterCallback(callback)
        controller = next
        next?.registerCallback(callback)
        onChange(nowPlaying())
    }

    fun nowPlaying(): NowPlaying {
        val c = controller
        val meta = c?.metadata
        val state = c?.playbackState
        return NowPlaying(
            playing = state?.state == PlaybackState.STATE_PLAYING,
            artist = meta?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: meta?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST),
            title = meta?.getString(MediaMetadata.METADATA_KEY_TITLE),
            album = meta?.getString(MediaMetadata.METADATA_KEY_ALBUM),
            durationMs = meta?.getLong(MediaMetadata.METADATA_KEY_DURATION)?.takeIf { it > 0 },
            positionMs = state?.position?.takeIf { it >= 0 },
            volumePct = volumePct(audio),
        )
    }

    fun command(command: MusicCommand) {
        val tc = controller?.transportControls
        when (command) {
            MusicCommand.PLAY -> tc?.play() ?: key(KeyEvent.KEYCODE_MEDIA_PLAY)
            MusicCommand.PAUSE -> tc?.pause() ?: key(KeyEvent.KEYCODE_MEDIA_PAUSE)
            MusicCommand.PLAY_PAUSE ->
                if (tc == null) key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
                else if (controller?.playbackState?.state == PlaybackState.STATE_PLAYING) tc.pause() else tc.play()
            MusicCommand.NEXT -> tc?.skipToNext() ?: key(KeyEvent.KEYCODE_MEDIA_NEXT)
            MusicCommand.PREVIOUS -> tc?.skipToPrevious() ?: key(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            MusicCommand.VOLUME_UP, MusicCommand.VOLUME_DOWN -> {
                adjustVolume(context, command == MusicCommand.VOLUME_UP)
                onChange(nowPlaying())
            }
        }
    }

    private fun key(code: Int) = sendKey(context, code)

    companion object {
        private const val TAG = "HbMusic"

        fun volumePct(audio: AudioManager): Int {
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
            return audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100 / max
        }

        fun adjustVolume(context: Context, up: Boolean) {
            context.getSystemService(AudioManager::class.java).adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                if (up) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER,
                0,
            )
        }

        fun sendKey(context: Context, code: Int) {
            val audio = context.getSystemService(AudioManager::class.java)
            audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
            audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        }

        /** Handles a command when no [MusicBridge] exists (notification access missing). */
        fun fallback(context: Context, command: MusicCommand) {
            when (command) {
                MusicCommand.PLAY -> sendKey(context, KeyEvent.KEYCODE_MEDIA_PLAY)
                MusicCommand.PAUSE -> sendKey(context, KeyEvent.KEYCODE_MEDIA_PAUSE)
                MusicCommand.PLAY_PAUSE -> sendKey(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
                MusicCommand.NEXT -> sendKey(context, KeyEvent.KEYCODE_MEDIA_NEXT)
                MusicCommand.PREVIOUS -> sendKey(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS)
                MusicCommand.VOLUME_UP -> adjustVolume(context, true)
                MusicCommand.VOLUME_DOWN -> adjustVolume(context, false)
            }
        }
    }
}
