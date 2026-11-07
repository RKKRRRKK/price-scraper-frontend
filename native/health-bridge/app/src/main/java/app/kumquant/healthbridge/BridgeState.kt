package app.kumquant.healthbridge

import app.kumquant.healthbridge.scale.WeighIn
import app.kumquant.healthbridge.watch.LinkState
import app.kumquant.healthbridge.watch.LiveHeartRate
import app.kumquant.healthbridge.watch.LiveWorkout
import app.kumquant.healthbridge.watch.SyncSummary
import app.kumquant.healthbridge.watch.WatchInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the screens show about the running bridge; written by the service and the upload worker. */
object BridgeState {
    private val _link = MutableStateFlow(LinkState.DISCONNECTED)
    private val _info = MutableStateFlow(WatchInfo())
    private val _syncing = MutableStateFlow(false)
    private val _lastSyncAt = MutableStateFlow(0L)
    private val _lastSummary = MutableStateFlow<SyncSummary?>(null)
    private val _lastError = MutableStateFlow<String?>(null)
    private val _pending = MutableStateFlow(0)
    private val _lastWeighIn = MutableStateFlow<WeighIn?>(null)
    private val _uploadAt = MutableStateFlow(0L)
    private val _uploadError = MutableStateFlow<String?>(null)
    private val _liveHr = MutableStateFlow<LiveHeartRate?>(null)
    private val _liveWorkout = MutableStateFlow<LiveWorkout?>(null)
    private val _liveHrOn = MutableStateFlow(false)

    val link: StateFlow<LinkState> = _link.asStateFlow()
    val info: StateFlow<WatchInfo> = _info.asStateFlow()
    val syncing: StateFlow<Boolean> = _syncing.asStateFlow()
    val lastSyncAt: StateFlow<Long> = _lastSyncAt.asStateFlow()
    val lastSummary: StateFlow<SyncSummary?> = _lastSummary.asStateFlow()
    val lastError: StateFlow<String?> = _lastError.asStateFlow()
    val pending: StateFlow<Int> = _pending.asStateFlow()
    val lastWeighIn: StateFlow<WeighIn?> = _lastWeighIn.asStateFlow()
    val uploadAt: StateFlow<Long> = _uploadAt.asStateFlow()
    val uploadError: StateFlow<String?> = _uploadError.asStateFlow()

    /** Latest reading of the live heart-rate view (null unless it is on); never persisted. */
    val liveHr: StateFlow<LiveHeartRate?> = _liveHr.asStateFlow()

    /** The workout the watch is running now, if any; never persisted. */
    val liveWorkout: StateFlow<LiveWorkout?> = _liveWorkout.asStateFlow()

    /** Whether the user switched the live heart-rate view on. */
    val liveHrOn: StateFlow<Boolean> = _liveHrOn.asStateFlow()

    /** Restores what survived a restart. */
    fun restore(prefs: AppPrefs) {
        _lastSyncAt.value = prefs.lastSyncAt
        _lastSummary.value = prefs.lastSyncSummary?.split(',')?.mapNotNull { it.toIntOrNull() }
            ?.takeIf { it.size == 4 }?.let { SyncSummary(it[0], it[1], it[2], it[3]) }
        _lastError.value = prefs.lastError
        _uploadAt.value = prefs.lastUploadAt
        _uploadError.value = prefs.lastUploadError
    }

    fun setLink(state: LinkState) { _link.value = state }
    fun setInfo(info: WatchInfo) { _info.value = info }
    fun setSyncing(on: Boolean) { _syncing.value = on }
    fun setPending(n: Int) { _pending.value = n }
    fun setWeighIn(w: WeighIn?) { _lastWeighIn.value = w }
    fun setLiveHr(v: LiveHeartRate?) { _liveHr.value = v }
    fun setLiveWorkout(v: LiveWorkout?) { _liveWorkout.value = v }
    fun setLiveHrOn(on: Boolean) { _liveHrOn.value = on }

    fun synced(at: Long, summary: SyncSummary) {
        _lastSyncAt.value = at
        _lastSummary.value = summary
        HealthBridgeApp.prefs.apply {
            lastSyncAt = at
            lastSyncSummary = "${summary.files},${summary.samples},${summary.sessions},${summary.failed}"
        }
    }

    fun error(message: String?) {
        _lastError.value = message
        HealthBridgeApp.prefs.lastError = message
    }

    fun uploaded(at: Long) {
        _uploadAt.value = at
        _uploadError.value = null
        HealthBridgeApp.prefs.apply { lastUploadAt = at; lastUploadError = null }
    }

    fun uploadFailed(message: String) {
        _uploadError.value = message
        HealthBridgeApp.prefs.lastUploadError = message
    }
}
