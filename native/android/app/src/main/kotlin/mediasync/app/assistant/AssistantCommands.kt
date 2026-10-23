package mediasync.app.assistant

import android.content.Context
import android.content.Intent
import android.icu.text.ListFormatter
import android.os.Build
import android.os.LocaleList
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import mediasync.app.MainActivity
import mediasync.app.R
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.discovery.DiscoveryController
import mediasync.app.net.NetworkMonitor
import mediasync.app.session.SessionController
import mediasync.app.ui.Labels
import kotlinx.serialization.json.JsonObject
import mediasync.core.AudioPreference
import mediasync.core.CompanionProtocol
import mediasync.core.CompanionTool
import mediasync.core.DialTerminal
import mediasync.core.MediaSyncSession
import mediasync.core.SyncMode

/**
 * Assistant-facing facade (Gemini through App Functions) over discovery and the session; the
 * counterpart of the iOS `AssistantCommands`. It drives the same controllers as the UI, so a voice
 * command and a tap have the same effect, and keeps no state of its own besides the request to
 * show the TV screen. Commands wait a bounded time (an assistant expects an answer in seconds)
 * and reply with localized text. Main thread only, like the controllers.
 */
class AssistantCommands(
    private val context: Context,
    private val discovery: DiscoveryController,
    private val session: SessionController,
    private val network: NetworkMonitor,
    private val diagnostics: Diagnostics,
) {
    /** A discovered TV as the assistant shows it; [id] is the stable device identity. */
    data class Tv(val id: String, val name: String, val model: String?, val syncCapable: Boolean)

    enum class Reason {
        NO_NETWORK, PERMISSION, NO_TVS, NO_COMPATIBLE_TVS, TV_NOT_FOUND, NO_SYNC, NO_MODES,
        NO_PAGE, TOOL_NOT_FOUND, TOOL_TIMEOUT, INVALID_ARGUMENTS, TOOL_FAILED,
    }

    /** A command that cannot proceed; [message] is localized and meant to be spoken. */
    class Failure(val reason: Reason, message: String) : Exception(message)

    private val _showsTerminalRequest = MutableStateFlow(false)
    /** Set when a command selected a TV; the activity shows the TV screen and clears it. */
    val showsTerminalRequest: StateFlow<Boolean> = _showsTerminalRequest

    fun consumeTerminalRequest() { _showsTerminalRequest.value = false }

    private val _webRequest = MutableStateFlow<String?>(null)
    /** Companion page a command needs open; the activity opens it as the "open" button does and clears it. */
    val webRequest: StateFlow<String?> = _webRequest

    fun consumeWebRequest() { _webRequest.value = null }

    private val resources get() = context.resources

    /** The open TV, which commands without an explicit TV apply to. */
    val currentTvId: String? get() = session.state.value.terminal?.device?.id

    /** TVs on the local network. Running or recent scan results are reused unless [refresh]. */
    suspend fun tvs(refresh: Boolean = false): List<Tv> {
        val initial = discovery.state.value
        if (initial.phase != DiscoveryController.Phase.SEARCHING && (refresh || initial.terminals.isEmpty())) discovery.start()
        if (discovery.state.value.problem == DiscoveryController.Problem.NO_NETWORK) {
            // Started by the system right after process start, the network callback may not have reported yet.
            if (waitFor(DISCOVERY_WAIT_MS, network.state) { it.available } != null) discovery.start()
        }
        if (discovery.state.value.phase == DiscoveryController.Phase.SEARCHING) {
            waitFor(DISCOVERY_WAIT_MS, discovery.state) { it.phase == DiscoveryController.Phase.FINISHED }
        }
        val state = discovery.state.value
        diagnostics.log("assistant", "tvs", "found" to state.terminals.size)
        if (state.terminals.isEmpty()) {
            when (state.problem) {
                DiscoveryController.Problem.NO_NETWORK -> throw failure(Reason.NO_NETWORK)
                DiscoveryController.Problem.PERMISSION -> throw failure(Reason.PERMISSION)
                else -> Unit
            }
        }
        return state.terminals.map(::tv)
    }

    /** The TVs that offer synchronization; fails when there is none to choose from. */
    suspend fun compatibleTvs(): List<Tv> {
        val all = tvs()
        return all.filter(Tv::syncCapable).ifEmpty { throw failure(if (all.isEmpty()) Reason.NO_TVS else Reason.NO_COMPATIBLE_TVS) }
    }

    /** Spoken summary of a scan: the TVs that can be synchronized, or why there are none. */
    fun tvsSummary(tvs: List<Tv>): String {
        val capable = tvs.filter(Tv::syncCapable)
        if (capable.isEmpty()) return message(if (tvs.isEmpty()) Reason.NO_TVS else Reason.NO_COMPATIBLE_TVS)
        return resources.getString(R.string.native_assistant_tvs_found, joined(capable.map(Tv::name)))
    }

    /** Which TV is open, its synchronization state, what plays and which companion pages it offers. */
    fun status(): String {
        val state = session.state.value
        val terminal = state.terminal ?: return resources.getString(R.string.native_assistant_status_idle)
        val parts = mutableListOf(resources.getString(R.string.native_assistant_status_connected, name(terminal)))
        when {
            !terminal.supportsMediaSync -> parts += resources.getString(R.string.native_discovery_noSyncSupport)
            state.noModes -> parts += resources.getString(R.string.native_terminal_noModes)
            state.snapshot == null && state.probing -> parts += resources.getString(R.string.native_terminal_probing)
            else -> Labels.session(state.snapshot)?.let { parts += resources.getString(it) }
        }
        (state.audio ?: state.video)?.let { parts += resources.getString(R.string.native_assistant_status_listening, Labels.trackTitle(resources, it)) }
        state.webPages.forEach { parts += resources.getString(R.string.native_assistant_status_webPage, it.title ?: resources.getString(R.string.discovery_webAvailableTitle)) }
        return parts.joinToString(" ")
    }

    /** Opens the TV (as tapping it in the list does) and waits for the session to settle. */
    suspend fun connect(id: String, mode: SyncMode? = null): String {
        val terminal = open(id, mode)
        val settled = waitFor(CONNECT_WAIT_MS, session.state) { isConnected(it) || it.noModes }
        if (session.state.value.noModes) throw failure(Reason.NO_MODES)
        val name = name(session.state.value.terminal ?: terminal)
        return resources.getString(if (settled != null) R.string.native_assistant_status_connected else R.string.native_assistant_connect_pending, name)
    }

    /** Opens the TV and checks the audio track that best matches the user's languages. */
    suspend fun listen(id: String): String {
        val terminal = open(id, null)
        waitFor(CONNECT_WAIT_MS + CONTENT_WAIT_MS, session.state) { contentSettled(it) || it.noModes }
        val state = session.state.value
        if (state.noModes) throw failure(Reason.NO_MODES)
        val name = name(state.terminal ?: terminal)
        return when (val content = state.content) {
            is SessionController.Content.Media -> {
                val audio = state.audio ?: AudioPreference.pick(content.manifest.tracks, userLanguages())
                    ?: return resources.getString(R.string.native_assistant_listen_noAudio)
                if (state.audio != audio) session.toggle(audio)
                diagnostics.log("assistant", "listen", "playing" to true)
                resources.getString(R.string.native_assistant_listen_playing, name, Labels.trackTitle(resources, audio))
            }
            is SessionController.Content.Failed -> resources.getString(R.string.native_assistant_listen_noAudio)
            is SessionController.Content.Web -> resources.getString(R.string.native_assistant_status_webPage,
                content.page.title ?: resources.getString(R.string.discovery_webAvailableTitle))
            SessionController.Content.None, SessionController.Content.Loading -> resources.getString(
                if (isConnected(state)) R.string.native_assistant_listen_noContent else R.string.native_assistant_connect_pending, name)
        }
    }

    /**
     * Tools the open companion page declared (PRD-015-R07). With no page open, opens the page the
     * content offers and waits for its declaration; empty when the TV offers no page.
     */
    suspend fun companionTools(): List<CompanionTool> {
        val state = session.state.value
        if (state.companionTools.isNotEmpty()) return state.companionTools
        if (!state.pageAttached) {
            val page = state.openWebPage ?: state.webPages.firstOrNull() ?: throw failure(Reason.NO_PAGE)
            _webRequest.value = page.url
            showApp()
            diagnostics.log("assistant", "open-page")
        }
        return waitFor(PAGE_WAIT_MS, session.state) { it.companionTools.isNotEmpty() }?.companionTools.orEmpty()
    }

    /** Spoken summary of the page's tools. */
    fun toolsSummary(tools: List<CompanionTool>): String =
        if (tools.isEmpty()) resources.getString(R.string.native_assistant_tools_none)
        else resources.getString(R.string.native_assistant_tools_found, joined(tools.map(CompanionTool::name)))

    /**
     * Runs a tool of the companion page with [argumentsJson] (a JSON object, or null for none) and
     * returns its answer as text; the page's own error message fails the command.
     */
    suspend fun runCompanionTool(name: String, argumentsJson: String?): String {
        val arguments = argumentsJson?.takeIf { it.isNotBlank() }
            ?.let { CompanionProtocol.toolArguments(it) ?: throw failure(Reason.INVALID_ARGUMENTS) } ?: JsonObject(emptyMap())
        val tools = companionTools()
        if (tools.none { it.name == name }) throw Failure(Reason.TOOL_NOT_FOUND, resources.getString(R.string.native_assistant_errors_toolNotFound, name))
        val answer = session.callCompanionTool(name, arguments, TOOL_WAIT_MS) ?: throw failure(Reason.TOOL_TIMEOUT)
        diagnostics.log("assistant", "tool", "failed" to (answer.error != null))
        answer.error?.let { throw Failure(Reason.TOOL_FAILED, it) }
        return answer.result?.takeIf { it.isNotBlank() } ?: resources.getString(R.string.native_assistant_tools_done)
    }

    fun stop(): String {
        session.stop()
        diagnostics.log("assistant", "stop")
        return resources.getString(R.string.native_assistant_stop_done)
    }

    fun message(reason: Reason): String = resources.getString(when (reason) {
        Reason.NO_NETWORK -> R.string.native_discovery_noNetwork
        Reason.PERMISSION -> R.string.native_discovery_permissionMessage
        Reason.NO_TVS -> R.string.native_assistant_tvs_none
        Reason.NO_COMPATIBLE_TVS -> R.string.native_assistant_tvs_noneCompatible
        Reason.TV_NOT_FOUND -> R.string.native_assistant_errors_tvNotFound
        Reason.NO_SYNC -> R.string.native_discovery_noSyncSupport
        Reason.NO_MODES -> R.string.native_terminal_noModes
        Reason.NO_PAGE -> R.string.native_assistant_errors_noPage
        Reason.TOOL_NOT_FOUND -> R.string.native_assistant_tools_none
        Reason.TOOL_TIMEOUT -> R.string.native_assistant_errors_toolTimeout
        Reason.INVALID_ARGUMENTS -> R.string.native_assistant_errors_invalidArguments
        Reason.TOOL_FAILED -> R.string.native_assistant_errors_toolTimeout
    })

    private fun failure(reason: Reason) = Failure(reason, message(reason))

    private fun isConnected(state: SessionController.UiState): Boolean = when (state.snapshot?.state) {
        MediaSyncSession.State.WAITING_CONTENT, MediaSyncSession.State.SYNCHRONISING, MediaSyncSession.State.SYNCHRONISED -> true
        else -> false
    }

    private fun contentSettled(state: SessionController.UiState): Boolean = when (state.content) {
        is SessionController.Content.Media, is SessionController.Content.Web, is SessionController.Content.Failed -> true
        SessionController.Content.None, SessionController.Content.Loading -> false
    }

    private suspend fun open(id: String, mode: SyncMode?): DialTerminal {
        val terminal = terminal(id) ?: throw failure(Reason.TV_NOT_FOUND)
        if (!terminal.supportsMediaSync) throw failure(Reason.NO_SYNC)
        if (session.state.value.terminal?.device?.id != terminal.device.id) session.select(terminal)
        mode?.let(session::setPreferredMode)
        _showsTerminalRequest.value = true
        showApp()
        diagnostics.log("assistant", "open", "mode" to (mode?.name ?: "preferred"))
        return terminal
    }

    /**
     * Brings the app to the front: playback needs its foreground service, which Android only lets
     * a visible app start. The system may refuse a launch from the background; the session still
     * runs and the service starts once the user opens the app (see `SessionController.onAppForeground`).
     */
    private fun showApp() {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        runCatching { context.startActivity(intent) }.onFailure { diagnostics.log("assistant", "launch-denied") }
    }

    /** The open TV or a discovered one; waits for a scan when the TV is not known yet. */
    private suspend fun terminal(id: String): DialTerminal? {
        lookup(id)?.let { return it }
        if (discovery.state.value.phase != DiscoveryController.Phase.SEARCHING) discovery.start()
        waitFor(DISCOVERY_WAIT_MS, discovery.state) { lookup(id) != null }
        return lookup(id)
    }

    private fun lookup(id: String): DialTerminal? =
        session.state.value.terminal?.takeIf { it.device.id == id } ?: discovery.state.value.terminals.firstOrNull { it.device.id == id }

    private fun name(terminal: DialTerminal) = terminal.device.friendlyName ?: resources.getString(R.string.native_discovery_unnamedTv)

    private fun tv(terminal: DialTerminal): Tv {
        val model = listOfNotNull(terminal.device.manufacturer, terminal.device.modelName).joinToString(" ").ifEmpty { null }
        return Tv(terminal.device.id, name(terminal), model, terminal.supportsMediaSync)
    }

    private fun joined(names: List<String>): String =
        if (Build.VERSION.SDK_INT >= 26) ListFormatter.getInstance().format(names) else names.joinToString(", ")

    private fun userLanguages(): List<String> {
        val locales = LocaleList.getDefault()
        return (0 until locales.size()).map { locales[it].toLanguageTag() }
    }

    /** The first value of [flow] that satisfies [condition] within [timeoutMs], or null. */
    private suspend fun <T> waitFor(timeoutMs: Long, flow: StateFlow<T>, condition: (T) -> Boolean): T? =
        withTimeoutOrNull(timeoutMs) { flow.first(condition) }

    companion object {
        /** Upper bound for collecting scan results; the scan itself keeps running for the UI. */
        const val DISCOVERY_WAIT_MS = 4_000L
        /** Upper bound for the probes and the DVB-CSS session to reach a stable state. */
        const val CONNECT_WAIT_MS = 10_000L
        /** Upper bound for the TV's content (and its manifest) after connecting. */
        const val CONTENT_WAIT_MS = 10_000L
        /** Upper bound for an opened companion page to load and declare its tools. */
        const val PAGE_WAIT_MS = 10_000L
        /** Upper bound for a page tool to answer; page tools may ask a remote assistant. */
        const val TOOL_WAIT_MS = 45_000L
    }
}
