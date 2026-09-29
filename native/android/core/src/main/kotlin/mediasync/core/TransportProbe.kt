package mediasync.core

enum class Availability { UNKNOWN, CHECKING, AVAILABLE, UNAVAILABLE }

/**
 * Checks that a transport exposes a real CII with usable WC/TS endpoints,
 * without starting WC/TS or the application channel. Single use and serial.
 */
class TransportProbe(
    private val transport: Transport,
    val mode: SyncMode,
    private val interDevSyncUrl: String?,
    private val app2appUrl: String?,
    private val realHost: String?,
    private val compatPrefix: String = Endpoints.DEFAULT_COMPAT_PREFIX,
    private val timeoutMs: Long = 2_000,
    private val onResult: (Boolean) -> Unit,
) : TransportEvents {
    private var socket: Long? = null
    private var timer: Long? = null
    private var settled = false
    private val tracker = CiiTracker()

    fun start() {
        check(socket == null && !settled) { "A probe can only run once" }
        val url = Endpoints.repair(Endpoints.ciiUrl(mode, interDevSyncUrl, app2appUrl, compatPrefix), realHost)
        if (url == null || !Endpoints.isWebSocket(url)) {
            finish(false)
            return
        }
        socket = Tokens.next().also { transport.openWebSocket(it, url, this) }
        timer = Tokens.next().also { transport.schedule(it, timeoutMs, this) }
    }

    /** Stops the probe without reporting a result (terminal or mode abandoned). */
    fun cancel() {
        settled = true
        release()
    }

    override fun onText(token: Long, text: String) {
        if (token != socket) return
        val state = tracker.apply(text)?.state ?: return
        val wc = Endpoints.repair(state.wcUrl, realHost)
        val ts = Endpoints.repair(state.tsUrl, realHost)
        val usable = when (mode) {
            SyncMode.COMPAT -> Endpoints.isCompatServiceUrl(wc, compatPrefix, "wc") && Endpoints.isCompatServiceUrl(ts, compatPrefix, "ts")
            SyncMode.NATIVE -> Endpoints.parseUdp(wc) != null && Endpoints.isWebSocket(ts)
        }
        if (usable) finish(true)
    }

    override fun onClosed(token: Long, failed: Boolean) {
        if (token == socket) {
            socket = null
            finish(false)
        }
    }

    override fun onTimer(token: Long) {
        if (token == timer) {
            timer = null
            finish(false)
        }
    }

    private fun finish(available: Boolean) {
        if (settled) return
        settled = true
        release()
        onResult(available)
    }

    private fun release() {
        socket?.let(transport::close)
        timer?.let(transport::cancel)
        socket = null
        timer = null
    }
}

/** Mode rules shared by both apps (PRD-006-R03/R04). */
object ModeSelection {
    /**
     * The preferred mode when confirmed; the other mode only once the preferred
     * one is known to be unavailable. While probes run, no mode is selected.
     */
    fun effective(preferred: SyncMode, availability: Map<SyncMode, Availability>): SyncMode? {
        val fallback = if (preferred == SyncMode.NATIVE) SyncMode.COMPAT else SyncMode.NATIVE
        return when {
            availability[preferred] == Availability.AVAILABLE -> preferred
            availability[preferred] == Availability.UNAVAILABLE && availability[fallback] == Availability.AVAILABLE -> fallback
            else -> null
        }
    }

    fun available(availability: Map<SyncMode, Availability>): List<SyncMode> =
        SyncMode.entries.filter { availability[it] == Availability.AVAILABLE }

    fun allUnavailable(availability: Map<SyncMode, Availability>): Boolean =
        SyncMode.entries.all { availability[it] == Availability.UNAVAILABLE }
}
