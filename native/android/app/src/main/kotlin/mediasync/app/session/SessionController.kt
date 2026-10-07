package mediasync.app.session

import android.content.Context
import android.os.Handler
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import mediasync.app.brand.BrandConfig
import mediasync.app.content.ContentLoader
import mediasync.app.data.Preferences
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.net.AndroidTransport
import mediasync.app.net.NetworkMonitor
import mediasync.app.playback.PlayerOwner
import mediasync.app.playback.SyncService
import mediasync.app.subtitles.SubtitleController
import mediasync.app.subtitles.SubtitleEnvelope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import mediasync.core.App2AppChannel
import mediasync.core.Availability
import mediasync.core.CompanionFeedThrottle
import mediasync.core.CompanionProtocol
import mediasync.core.ContentClassifier
import mediasync.core.ContentKind
import mediasync.core.DialDiscoveryScan
import mediasync.core.DialTerminal
import mediasync.core.Endpoints
import mediasync.core.MediaManifest
import mediasync.core.MediaSyncSession
import mediasync.core.MediaTrack
import mediasync.core.ModeSelection
import mediasync.core.PlaybackCorrector
import mediasync.core.PlaybackIntent
import mediasync.core.SyncMode
import mediasync.core.SyncTuning
import mediasync.core.TrackKind
import mediasync.core.TransportProbe

/** A companion page transport (WebView or Custom Tab) that receives protocol envelopes. */
interface CompanionSink {
    fun deliver(envelope: String)
}

/**
 * Single owner of the active TV (PRD-004-R02/R03): mode probes, the DVB-CSS
 * session, the content catalog, the player and its corrector, subtitles and
 * companion pages. All state changes happen on the main looper; each
 * asynchronous result is checked against the generation that requested it.
 */
class SessionController(
    private val context: Context,
    private val transport: AndroidTransport,
    private val network: NetworkMonitor,
    private val loader: ContentLoader,
    private val preferences: Preferences,
    private val diagnostics: Diagnostics,
    private val main: Handler,
) {
    data class WebPage(val url: String, val title: String?, val iconUrl: String?, val language: String? = null)

    enum class Unsupported { FORMAT, PROTECTED, MANIFEST }

    sealed interface Content {
        data object None : Content
        data object Loading : Content
        data class Media(val manifest: MediaManifest, val kind: ContentKind) : Content
        data class Web(val page: WebPage) : Content
        data class Failed(val reason: Unsupported) : Content
    }

    data class UiState(
        val terminal: DialTerminal? = null,
        val preferredMode: SyncMode = SyncMode.DEFAULT,
        val availability: Map<SyncMode, Availability> = SyncMode.entries.associateWith { Availability.UNKNOWN },
        val effectiveMode: SyncMode? = null,
        val snapshot: MediaSyncSession.Snapshot? = null,
        val content: Content = Content.None,
        val selected: MediaTrack? = null,
        val subtitle: MediaTrack? = null,
        val subtitleText: String? = null,
        val subtitleFailed: Boolean = false,
        val status: PlaybackCorrector.Status = PlaybackCorrector.Status.WAITING,
        val rate: Double = 1.0,
        val positionS: Double? = null,
        val tvPlaying: Boolean = false,
        val playerRetrying: Boolean = false,
        val playerFailed: Boolean = false,
        val suspendedBySystem: Boolean = false,
        val webGone: Boolean = false,
        val volume: Float = 1f,
        /** Companion page the user opened last; see [openWebPage]. */
        val webUrl: String? = null,
    ) {
        val availableModes: List<SyncMode> get() = ModeSelection.available(availability)
        val probing: Boolean get() = availability.values.any { it == Availability.CHECKING }
        val noModes: Boolean get() = ModeSelection.allUnavailable(availability)
        val isActive: Boolean get() = selected != null

        /** Pages the current content offers: a web content ID or the applications announced by the manifest. */
        val webPages: List<WebPage> get() = when (val current = content) {
            is Content.Web -> listOf(current.page)
            is Content.Media -> current.manifest.applications.map { WebPage(it.url, it.name, null, it.language) }
            else -> emptyList()
        }

        /**
         * The opened page while the content still offers it. A sole page follows URL changes, so a
         * web -> web content change reloads it; null means the page is gone.
         */
        val openWebPage: WebPage? get() = webUrl?.let { opened -> webPages.firstOrNull { it.url == opened } ?: webPages.singleOrNull() }
    }

    private val tuning = SyncTuning()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state
    private var generation = 0L
    private val probes = mutableListOf<TransportProbe>()
    /** The terminal as picked from the discovery list; the state holds it with refreshed endpoints. */
    private var selected: DialTerminal? = null
    /** Re-read of the HbbTV application document that precedes every probe round. */
    private var refreshJob: Job? = null
    /** The running session was started with endpoints the TV no longer advertises. */
    private var endpointsChanged = false
    /** True while availability is re-checked for a running session that lost the TV. */
    private var reprobing = false
    private var reprobeJob: Job? = null
    private var reprobeCount = 0
    private var session: MediaSyncSession? = null
    private var sessionMode: SyncMode? = null
    private var contentJob: Job? = null
    private var metadataJob: Job? = null
    private var intent: PlaybackIntent? = null
    private val corrector = PlaybackCorrector(tuning)
    private var owner: PlayerOwner? = null
    private val subtitles = SubtitleController(loader, scope)
    private val companions = linkedSetOf<CompanionSink>()
    /** Companions that also mirror the cues of the selected subtitle track (XR subtitles). */
    private val subtitleSinks = linkedSetOf<CompanionSink>()
    private var sentCueRevision: Long? = null
    private val feed = CompanionFeedThrottle()
    private var lastPositionEnvelope: String? = null
    /** Service type the session needs (null: none) and the one actually running. */
    private var wantedService: Boolean? = null
    private var serviceMedia: Boolean? = null
    private var lastSyncLog = 0L
    private val tick = Runnable { tick() }
    private var ticking = false

    val player: androidx.media3.exoplayer.ExoPlayer? get() = owner?.player

    private fun update(change: UiState.() -> UiState) { _state.value = _state.value.change() }

    fun select(terminal: DialTerminal) = open(terminal, feedbackMs = 0)

    private fun open(terminal: DialTerminal, feedbackMs: Long) {
        if (_state.value.terminal != null && selected == terminal) return
        stop()
        selected = terminal
        generation++
        val preferred = preferences.mode(terminal)
        _state.value = UiState(terminal = terminal, preferredMode = preferred,
            availability = SyncMode.entries.associateWith { Availability.CHECKING })
        diagnostics.log("session", "select", "generation" to generation, "hbbtv" to terminal.supportsHbbtv)
        if (!terminal.supportsMediaSync) {
            update { copy(availability = SyncMode.entries.associateWith { Availability.UNAVAILABLE }) }
            return
        }
        startProbes(terminal, feedbackMs)
    }

    fun setPreferredMode(mode: SyncMode) {
        val terminal = _state.value.terminal ?: return
        preferences.setMode(terminal, mode)
        update { copy(preferredMode = mode) }
        reconcileMode()
    }

    /** Leaving the detail screen keeps an active playback or companion; otherwise releases the TV. */
    fun leaveDetail() {
        if (owner?.isActive != true && companions.isEmpty()) stop()
    }

    /** Checks the TV again; the check stays visible for a moment so the tap has feedback. */
    fun retry() {
        val terminal = selected ?: return
        _state.value = UiState()
        open(terminal, RETRY_FEEDBACK_MS)
    }

    fun stop() {
        generation++
        probes.forEach(TransportProbe::cancel)
        probes.clear()
        selected = null
        refreshJob?.cancel()
        refreshJob = null
        endpointsChanged = false
        reprobing = false
        reprobeJob?.cancel()
        reprobeJob = null
        reprobeCount = 0
        session?.stop()
        session = null
        sessionMode = null
        contentJob?.cancel()
        metadataJob?.cancel()
        intent = null
        stopPlayback()
        subtitles.select(null, null)
        companions.clear()
        subtitleSinks.clear()
        sentCueRevision = null
        stopTicking()
        stopService()
        _state.value = UiState()
    }

    fun play(track: MediaTrack) {
        val content = _state.value.content as? Content.Media ?: return
        if (_state.value.selected == track) {
            intent = null
            stopPlayback()
            return
        }
        intent = PlaybackIntent.of(track)
        startTrack(content, track)
    }

    fun selectSubtitle(track: MediaTrack?) {
        val content = _state.value.content as? Content.Media
        val nativeText = content?.kind == ContentKind.HLS
        subtitles.select(content?.manifest, track.takeUnless { nativeText })
        owner?.selectSubtitle(track.takeIf { nativeText })
        update { copy(subtitle = track, subtitleText = null, subtitleFailed = false) }
        // Subtitles are shown without audio/video too, so they need the position feed on their own.
        if (track != null) startTicking()
    }

    fun setVolume(volume: Float) {
        owner?.setVolume(volume)
        update { copy(volume = volume.coerceIn(0f, 1f)) }
    }

    fun resumeAfterSystemPause() {
        owner?.resumeAfterSystemPause()
        update { copy(suspendedBySystem = false) }
    }

    fun openWeb(url: String) {
        if (_state.value.webPages.any { it.url == url }) update { copy(webUrl = url) }
    }

    fun attachCompanion(sink: CompanionSink) {
        companions.add(sink)
        feed.reset()
        if (owner?.isActive != true) startService(media = false)
        startTicking()
    }

    fun detachCompanion(sink: CompanionSink) {
        companions.remove(sink)
        if (companions.isEmpty() && owner?.isActive != true) stopService()
    }

    /** Attaches a page that renders the subtitles itself; it gets positions and the cue list. */
    fun attachSubtitleSink(sink: CompanionSink) {
        subtitleSinks.add(sink)
        attachCompanion(sink)
    }

    fun detachSubtitleSink(sink: CompanionSink) {
        subtitleSinks.remove(sink)
        detachCompanion(sink)
    }

    /** Seeds a subtitle page with the last position and the current cue list. */
    fun seedSubtitleSink(sink: CompanionSink) {
        (lastPositionEnvelope ?: positionEnvelope())?.let(sink::deliver)
        sink.deliver(cuesEnvelope())
    }

    private fun cuesEnvelope(): String {
        val active = _state.value.subtitle != null && (_state.value.content as? Content.Media)?.kind != ContentKind.HLS
        return SubtitleEnvelope.cues(active, if (active) subtitles.cueList else emptyList())
    }

    /** Pushes init, the last position and retained TV state once a page transport is ready. */
    fun seedCompanion(sink: CompanionSink) {
        sink.deliver(CompanionProtocol.init(_state.value.openWebPage?.url))
        (lastPositionEnvelope ?: positionEnvelope())?.let(sink::deliver)
        session?.retainedAppMessages?.forEach { sink.deliver(CompanionProtocol.appMessage(it.raw)) }
    }

    fun onCompanionMessage(inbound: CompanionProtocol.Inbound) {
        when (inbound) {
            is CompanionProtocol.Inbound.AppMessage -> session?.sendAppMessage(inbound.type, inbound.payload, inbound.id)
            is CompanionProtocol.Inbound.SyncAck -> diagnostics.log("companion", "sync-ack")
        }
    }

    /**
     * Re-reads the TV's HbbTV application document, then probes both transports. A TV
     * reopens App2App and CSS-CII on new ports whenever its HbbTV application restarts, so
     * the URLs found by discovery go stale; a failed read keeps the known ones.
     */
    private fun startProbes(terminal: DialTerminal, feedbackMs: Long = 0) {
        probes.forEach(TransportProbe::cancel)
        probes.clear()
        refreshJob?.cancel()
        val current = generation
        val lan = network.state.value.network
        val options = DialDiscoveryScan.Options(durationMs = REFRESH_TIMEOUT_MS, requestTimeoutMs = REFRESH_TIMEOUT_MS,
            openConnection = lan?.let { network -> { url -> network.openConnection(url) } })
        refreshJob = scope.launch {
            val startedAt = SystemClock.elapsedRealtime()
            val fresh = withContext(Dispatchers.IO) { DialDiscoveryScan(options).use { it.fetchApplication(terminal.device) } }
            delay(feedbackMs - (SystemClock.elapsedRealtime() - startedAt))
            if (current != generation) return@launch
            refreshJob = null
            val latest = _state.value.terminal ?: return@launch
            val changed = fresh != null && fresh != latest.application
            diagnostics.log("session", "refresh", "read" to (fresh != null), "changed" to changed)
            if (changed) {
                endpointsChanged = session != null
                update { copy(terminal = latest.copy(application = fresh)) }
            }
            runProbes(_state.value.terminal ?: return@launch)
        }
    }

    /**
     * Probes both transports. The TV can switch stacks at any time (the emulator does so
     * on demand), so availability is re-checked while a session recovers or no stack is
     * available instead of only once on selection.
     */
    private fun runProbes(terminal: DialTerminal) {
        val current = generation
        val application = terminal.application
        val realHost = Endpoints.realHost(terminal.device.location, terminal.device.applicationUrl)
        var pending = SyncMode.entries.size
        for (mode in SyncMode.entries) {
            val probe = TransportProbe(transport, mode, application?.interDeviceSyncUrl, application?.app2AppUrl, realHost,
                Endpoints.DEFAULT_COMPAT_PREFIX, tuning.probeTimeoutMs) { available ->
                if (current != generation) return@TransportProbe
                diagnostics.log("session", "probe", "mode" to mode.name, "available" to available, "reprobe" to reprobing)
                update { copy(availability = availability + (mode to if (available) Availability.AVAILABLE else Availability.UNAVAILABLE)) }
                reconcileMode()
                pending--
                if (pending == 0) {
                    reprobing = false
                    watchConnection()
                }
            }
            probes += probe
            probe.start()
        }
    }

    /** Whether the TV is worth re-checking: the session lost it, or it offered no stack at all. */
    private fun needsRecheck(state: UiState): Boolean = state.terminal != null &&
        (state.snapshot?.state == MediaSyncSession.State.RECOVERING || (session == null && state.noModes))

    /** Schedules a re-check while [needsRecheck] holds; cancels it otherwise. */
    private fun watchConnection() {
        val state = _state.value
        if (!needsRecheck(state)) {
            reprobeJob?.cancel()
            reprobeJob = null
            reprobeCount = 0
            return
        }
        if (reprobing || reprobeJob != null) return
        val current = generation
        // The first re-check waits one probe timeout so a brief drop can reconnect on its own.
        val delayMs = if (reprobeCount == 0) tuning.probeTimeoutMs else REPROBE_INTERVAL_MS
        reprobeCount++
        reprobeJob = scope.launch {
            delay(delayMs)
            reprobeJob = null
            val latest = _state.value
            val terminal = latest.terminal
            if (current != generation || !needsRecheck(latest) || terminal == null) return@launch
            diagnostics.log("session", "reprobe", "mode" to (sessionMode?.name ?: "none"))
            reprobing = true
            startProbes(terminal)
        }
    }

    private fun reconcileMode() {
        val state = _state.value
        val effective = ModeSelection.effective(state.preferredMode, state.availability)
        // A failed re-check keeps the current session retrying rather than tearing it down.
        if (effective == null && reprobing && session != null) return
        // New endpoints restart a session of the same mode, which would otherwise keep the stale URLs.
        if (effective == sessionMode && (effective == null || session != null) && !(endpointsChanged && effective != null)) return
        startSession(effective)
    }

    private fun startSession(mode: SyncMode?) {
        endpointsChanged = false
        session?.stop()
        session = null
        sessionMode = mode
        update { copy(effectiveMode = mode, snapshot = null) }
        val terminal = _state.value.terminal ?: return
        if (mode == null) return
        val application = terminal.application
        lateinit var created: MediaSyncSession
        created = MediaSyncSession(transport, { System.nanoTime() }, object : MediaSyncSession.Listener {
            override fun onSnapshot(snapshot: MediaSyncSession.Snapshot) {
                if (session !== created) return
                update { copy(snapshot = snapshot) }
                watchConnection()
            }
            override fun onContentChanged(generation: Long, contentId: String?) {
                if (session === created) handleContent(contentId)
            }
            override fun onTimelineChanged(generation: Long) {
                if (session === created) tick()
            }
            override fun onAppMessage(generation: Long, message: App2AppChannel.Message) {
                if (session !== created) return
                val envelope = CompanionProtocol.appMessage(message.raw)
                companions.toList().forEach { it.deliver(envelope) }
            }
        }, tuning)
        session = created
        diagnostics.log("session", "start", "mode" to mode.name)
        created.start(MediaSyncSession.Config(
            mode = mode,
            interDevSyncUrl = application?.interDeviceSyncUrl,
            app2appUrl = application?.app2AppUrl,
            realHost = Endpoints.realHost(terminal.device.location, terminal.device.applicationUrl),
            timelineSelector = TIMELINE_SELECTOR,
        ))
    }

    private fun handleContent(contentId: String?) {
        contentJob?.cancel()
        metadataJob?.cancel()
        subtitles.select(null, null)
        owner?.selectSubtitle(null)
        val hadWeb = _state.value.webPages.isNotEmpty()
        val resolved = ContentClassifier.resolve(contentId, BrandConfig.DEFAULT_CONTENT_URL)
        val kind = ContentClassifier.classify(resolved)
        diagnostics.log("content", "changed", "kind" to kind.name)
        update { copy(subtitle = null, subtitleText = null, webGone = hadWeb && kind != ContentKind.WEB && kind != ContentKind.DASH) }
        when (kind) {
            ContentKind.NONE -> {
                stopPlayback()
                update { copy(content = Content.None) }
            }
            ContentKind.UNSUPPORTED -> {
                stopPlayback()
                update { copy(content = Content.Failed(Unsupported.FORMAT)) }
            }
            ContentKind.WEB -> {
                intent = null
                stopPlayback()
                val url = resolved!!
                update { copy(content = Content.Web(WebPage(url, null, null))) }
                val requested = generation
                metadataJob = scope.launch {
                    val metadata = loader.webMetadata(url)
                    val current = _state.value.content as? Content.Web ?: return@launch
                    if (requested == generation && current.page.url == url) {
                        update { copy(content = Content.Web(WebPage(url, metadata.title, metadata.iconUrl))) }
                    }
                }
            }
            ContentKind.DASH, ContentKind.HLS -> {
                update { copy(content = Content.Loading) }
                val url = resolved!!
                val requested = generation
                contentJob = scope.launch {
                    val manifest = runCatching { loader.manifest(url, kind) }.getOrNull()
                    if (requested != generation || !isActive) return@launch
                    when {
                        manifest == null -> {
                            stopPlayback()
                            update { copy(content = Content.Failed(Unsupported.MANIFEST)) }
                        }
                        manifest.isProtected -> {
                            stopPlayback()
                            update { copy(content = Content.Failed(Unsupported.PROTECTED)) }
                        }
                        else -> {
                            val media = Content.Media(manifest, kind)
                            update { copy(content = media) }
                            val resume = intent?.match(manifest.tracks.filter { it.kind != TrackKind.TEXT && !it.protected })
                            if (resume != null) startTrack(media, resume) else stopPlayback()
                            refreshCatalog(media, requested)
                        }
                    }
                }
            }
        }
    }

    private fun startTrack(content: Content.Media, track: MediaTrack) {
        val owner = owner ?: PlayerOwner(context, main, playerListener).also { owner = it }
        val position = session?.position()
        corrector.reset()
        owner.play(content.manifest, content.kind, track, position?.seconds, _state.value.volume)
        owner.selectSubtitle(_state.value.subtitle.takeIf { content.kind == ContentKind.HLS })
        diagnostics.log("player", "start", "kind" to track.kind.name, "live" to content.manifest.isLive)
        update { copy(selected = track, playerFailed = false, playerRetrying = false, suspendedBySystem = false) }
        startService(media = true)
        startTicking()
    }

    private suspend fun refreshCatalog(initial: Content.Media, requested: Long) {
        var current = initial
        while (true) {
            val interval = current.manifest.refreshDelayMs ?: return
            delay(interval)
            val refreshed = runCatching { loader.manifest(current.manifest.url, current.kind) }.getOrNull()
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            if (requested != generation) return
            if (refreshed == null || refreshed.isProtected) {
                selectSubtitle(null)
                stopPlayback()
                update { copy(content = Content.Failed(if (refreshed?.isProtected == true) Unsupported.PROTECTED else Unsupported.MANIFEST)) }
                return
            }
            val selected = refreshed.refreshedTrack(_state.value.selected)
            val text = refreshed.refreshedTrack(_state.value.subtitle)
            current = Content.Media(refreshed, current.kind)
            update { copy(content = current, selected = selected) }
            if (selected == null && owner?.isActive == true) stopPlayback()
            if (text != _state.value.subtitle) selectSubtitle(text)
        }
    }

    private fun stopPlayback() {
        owner?.stop()
        corrector.reset()
        update { copy(selected = null, status = PlaybackCorrector.Status.WAITING, rate = 1.0, playerRetrying = false) }
        when {
            companions.isNotEmpty() -> startService(media = false)
            // Waiting to resume (content gap, unmatched track): restarting later from the background is not allowed.
            intent != null -> Unit
            else -> stopService()
        }
    }

    private val playerListener = object : PlayerOwner.Listener {
        override fun onSeekCompleted() = corrector.onSeekCompleted()
        override fun onPlaybackError(retrying: Boolean) {
            diagnostics.log("player", "error", "retrying" to retrying)
            update { copy(playerRetrying = retrying, playerFailed = !retrying) }
            if (!retrying) stopPlayback()
        }
        override fun onSystemPause() = update { copy(suspendedBySystem = true) }
        override fun onStateChanged() = Unit
    }

    private fun positionEnvelope(): String? {
        val position = session?.position() ?: return null
        val manifest = (_state.value.content as? Content.Media)?.manifest
        return CompanionProtocol.position(CompanionProtocol.Position(position.seconds, position.isPlaying, position.speed,
            manifest?.isLive == true, liveEpoch(manifest, position.seconds), System.currentTimeMillis()))
    }

    private fun liveEpoch(manifest: MediaManifest?, positionS: Double): Double? =
        manifest?.takeIf { it.isLive }?.availabilityStartTimeMs?.let { it / 1000.0 + positionS }

    private fun tick() {
        val session = session
        val position = session?.position()
        val mode = sessionMode
        val content = _state.value.content as? Content.Media
        val owner = owner
        val now = SystemClock.elapsedRealtime()
        var status = _state.value.status
        if (owner != null && owner.isActive && mode != null && content != null) {
            if (owner.suspendedBySystem || owner.isSuppressed) {
                // No corrections against a position frozen by the system; resync once it resumes.
                status = PlaybackCorrector.Status.PAUSED
            } else {
                val tv = position?.let { PlaybackCorrector.Tv(it.seconds, liveEpoch(content.manifest, it.seconds), it.isPlaying, it.reliable) }
                val sample = PlaybackCorrector.Player(owner.positionS, owner.liveEpochS, owner.player.playWhenReady, owner.isBuffering, owner.rate)
                val result = corrector.update(now, tv, sample, mode, content.manifest.isLive)
                result.commands.forEach(owner::apply)
                status = result.status
                if (now - lastSyncLog >= 1_000) {
                    lastSyncLog = now
                    val stats = session?.wallClockStats
                    diagnostics.log("sync", "tick", "st" to status.name, "fdMs" to result.filteredDriftMs, "rate" to result.rate,
                        "wcMs" to position?.uncertaintyMs?.let { Math.round(it) }, "rttMs" to stats?.avgRoundTripMs?.let { Math.round(it) },
                        "mode" to mode.name)
                }
            }
        }
        if (companions.isNotEmpty() && position != null && feed.shouldSend(now, position.isPlaying, position.speed)) {
            positionEnvelope()?.let { envelope ->
                lastPositionEnvelope = envelope
                companions.toList().forEach { it.deliver(envelope) }
            }
        }
        if (subtitleSinks.isNotEmpty() && sentCueRevision != subtitles.revision) {
            sentCueRevision = subtitles.revision
            val envelope = cuesEnvelope()
            subtitleSinks.toList().forEach { it.deliver(envelope) }
        }
        val subtitleText = when {
            _state.value.subtitle == null || position == null -> null
            content?.kind == ContentKind.HLS -> owner?.subtitleText
            else -> subtitles.text(position.seconds)
        }
        update {
            copy(status = status, rate = owner?.rate ?: 1.0, positionS = position?.seconds, tvPlaying = position?.isPlaying == true,
                subtitleText = subtitleText, subtitleFailed = subtitles.failed, suspendedBySystem = owner?.suspendedBySystem == true)
        }
        if (owner?.isActive != true && companions.isEmpty() && _state.value.subtitle == null) stopTicking()
        if (ticking) {
            main.removeCallbacks(this.tick)
            main.postDelayed(this.tick, tuning.progressIntervalMs)
        }
    }

    private fun startTicking() {
        if (ticking) return
        ticking = true
        main.post(tick)
    }

    private fun stopTicking() {
        ticking = false
        main.removeCallbacks(tick)
    }

    private fun startService(media: Boolean) {
        wantedService = media
        if (serviceMedia == media) return
        val started = SyncService.start(context, _state.value.terminal?.device?.friendlyName ?: BrandConfig.APP_NAME, media)
        serviceMedia = if (started) media else null
        if (!started) diagnostics.log("service", "start-failed", "media" to media)
    }

    private fun stopService() {
        wantedService = null
        if (serviceMedia == null) return
        serviceMedia = null
        SyncService.stop(context)
    }

    /** Called by [SyncService] when it could not enter the foreground and stopped itself. */
    fun onServiceStartFailed() {
        serviceMedia = null
        diagnostics.log("service", "foreground-denied", "media" to wantedService)
    }

    /** Retries a service that the system refused to start while the app was in the background. */
    fun onAppForeground() {
        val media = wantedService ?: return
        if (serviceMedia != media) startService(media)
    }

    companion object {
        /** Timeline registered by the broadcaster HbbTV apps (RN `TIMELINE_SELECTOR`); PTS is used when the TV only offers it. */
        const val TIMELINE_SELECTOR = "urn:dvb:css:timeline:mpd:period:rel:1000"
        /** Pause between availability re-checks while the active session keeps recovering. */
        const val REPROBE_INTERVAL_MS = 5_000L
        /** Upper bound for re-reading the TV's HbbTV application document. */
        const val REFRESH_TIMEOUT_MS = 3_000
        /** Minimum time a manual retry shows the check in progress. */
        const val RETRY_FEEDBACK_MS = 800L
    }
}
