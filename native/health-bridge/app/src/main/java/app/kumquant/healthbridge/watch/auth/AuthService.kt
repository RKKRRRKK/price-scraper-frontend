package app.kumquant.healthbridge.watch.auth

import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.CommandChannel
import app.kumquant.healthbridge.watch.WatchAuthException
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.XiaomiService
import kotlinx.coroutines.CompletableDeferred

/**
 * Drives the handshake over the command channel (command type 1) on top of [XiaomiAuth].
 * [result] completes when the watch confirms, or fails with [WatchAuthException] if the watch's
 * proof does not match the configured key.
 */
internal class AuthService(
    private val channel: CommandChannel,
    private val auth: XiaomiAuth,
) : XiaomiService(XiaomiAuth.COMMAND_TYPE) {

    val result = CompletableDeferred<Unit>()

    /** Sends step 1; call once the transport reports the protocol session is ready. */
    fun start() {
        WatchLog.i("auth: starting handshake (key ${auth.keyHint()}...)")
        channel.send(auth.startHandshake())
    }

    override fun handle(cmd: XiaomiProto.Command) {
        when (cmd.subtype) {
            XiaomiAuth.CMD_NONCE -> {
                if (!cmd.hasAuth() || !cmd.auth.hasDeviceVerify()) {
                    fail("watch answered the nonce without a proof (status=${if (cmd.hasStatus()) cmd.status else -1})")
                    return
                }
                val reply = auth.handleWatchNonce(cmd.auth.deviceVerify)
                if (reply == null) {
                    fail("the watch's HMAC does not match, so the auth key is wrong")
                } else {
                    channel.send(reply)
                }
            }
            XiaomiAuth.CMD_AUTH, XiaomiAuth.CMD_SEND_USERID -> {
                if (cmd.subtype == XiaomiAuth.CMD_AUTH || cmd.auth.status == 1) {
                    if (cmd.hasStatus() && cmd.status != 0) WatchLog.w("auth: confirm carried status ${cmd.status}")
                    auth.markAuthenticated()
                    WatchLog.i("auth: authenticated, further traffic is encrypted")
                    result.complete(Unit)
                } else {
                    fail("authentication rejected, subtype=${cmd.subtype} status=${cmd.auth.status}")
                }
            }
            else -> WatchLog.w("auth: unknown subtype ${cmd.subtype}")
        }
    }

    private fun fail(reason: String) {
        WatchLog.e("auth failed: $reason")
        result.completeExceptionally(WatchAuthException(reason))
    }
}
