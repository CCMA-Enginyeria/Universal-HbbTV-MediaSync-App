package mediasync.app.discovery

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.SystemClock
import android.system.ErrnoException
import android.system.OsConstants
import java.io.IOException
import kotlin.concurrent.thread
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.net.NetworkMonitor
import mediasync.core.DialDiscoveryScan
import mediasync.core.DialTerminal

/**
 * Owns at most one DIAL scan. Results are published incrementally; every
 * callback is tagged with the scan generation so a replaced scan can never
 * change the current list.
 */
class DiscoveryController(
    context: Context,
    private val network: NetworkMonitor,
    private val diagnostics: Diagnostics,
    private val main: Handler,
) {
    enum class Phase { IDLE, SEARCHING, FINISHED }
    enum class Problem { NO_NETWORK, PERMISSION, SEND_FAILED }

    data class State(
        val phase: Phase = Phase.IDLE,
        val terminals: List<DialTerminal> = emptyList(),
        val problem: Problem? = null,
    ) {
        val syncCapable: List<DialTerminal> get() = terminals.filter { it.supportsMediaSync }
        val others: List<DialTerminal> get() = terminals.filterNot { it.supportsMediaSync }
    }

    private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var scan: DialDiscoveryScan? = null
    private var generation = 0L

    /** Must be called on the main thread. */
    fun start() {
        cancel()
        val current = ++generation
        val local = network.state.value
        if (!local.available) {
            _state.value = State(Phase.FINISHED, problem = Problem.NO_NETWORK)
            return
        }
        val options = DialDiscoveryScan.Options(
            allowNonHbbtvDevices = ALLOW_NON_HBBTV_DEVICES,
            networkInterface = local.networkInterface(),
        )
        val scan = DialDiscoveryScan(options)
        this.scan = scan
        _state.value = State(Phase.SEARCHING)
        val startedAt = SystemClock.elapsedRealtime()
        diagnostics.log("discovery", "start", "generation" to current, "vpn" to local.vpnActive)
        thread(name = "dial-scan", isDaemon = true) {
            val lock = runCatching { wifi?.createMulticastLock("mediasync-discovery")?.apply { setReferenceCounted(false); acquire() } }.getOrNull()
            var problem: Problem? = null
            var result: DialDiscoveryScan.Result? = null
            try {
                result = scan.run { terminal ->
                    val latency = SystemClock.elapsedRealtime() - startedAt
                    main.post {
                        if (current != generation) return@post
                        diagnostics.log("discovery", "found", "generation" to current, "latencyMs" to latency)
                        _state.value = _state.value.copy(terminals = _state.value.terminals + terminal)
                    }
                }
            } catch (error: IOException) {
                problem = if ((error.cause as? ErrnoException)?.errno == OsConstants.EPERM || error.message?.contains("EPERM") == true)
                    Problem.PERMISSION else Problem.SEND_FAILED
            } finally {
                runCatching { lock?.release() }
            }
            main.post {
                if (current != generation) return@post
                this.scan = null
                diagnostics.log("discovery", "finish", "generation" to current, "found" to (result?.terminals?.size ?: 0),
                    "failures" to (result?.failures?.size ?: 0), "problem" to problem?.name)
                _state.value = _state.value.copy(phase = Phase.FINISHED, problem = problem)
            }
        }
    }

    fun cancel() {
        generation++
        scan?.close()
        scan = null
        if (_state.value.phase == Phase.SEARCHING) _state.value = _state.value.copy(phase = Phase.FINISHED)
    }

    companion object {
        /**
         * The RN reference lists DIAL devices without HbbTV under "other
         * devices"; they are shown with a notice and never offered for sync.
         */
        const val ALLOW_NON_HBBTV_DEVICES = true
    }
}
