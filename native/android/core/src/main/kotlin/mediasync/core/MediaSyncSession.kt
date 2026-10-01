package mediasync.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Values used by the React Native reference (`src/utils/config.js`). */
data class SyncTuning(
    val native: SyncController.Options = SyncController.Options(
        emaAlpha = 0.25, enterBandS = 0.1, exitBandS = 0.01, horizonS = 3.0,
        deadTimeS = 0.35, maxRateDelta = 0.05, rateEps = 0.002, seekThresholdS = 2.0,
    ),
    val compat: SyncController.Options = native.copy(enterBandS = 0.25, exitBandS = 0.02, seekThresholdS = 20.0),
    val seekThresholdLiveS: Double = 5.0,
    val compatSeekThresholdLiveS: Double = 20.0,
    val seekCooldownMs: Long = 1_500,
    val seekLeadS: Double = 0.4,
    val minCorrectionIntervalMs: Long = 80,
    val progressIntervalMs: Long = 250,
    val nativeToleranceMs: Double = 100.0,
    val compatToleranceMs: Double = 500.0,
    val wallClockIntervalMs: Long = 1_000,
    val noContentTimeoutMs: Long = 5_000,
    val wallClockTimeoutMs: Long = 10_000,
    val probeTimeoutMs: Long = 2_000,
) {
    fun controllerOptions(mode: SyncMode) = if (mode == SyncMode.COMPAT) compat else native
    fun toleranceMs(mode: SyncMode) = if (mode == SyncMode.COMPAT) compatToleranceMs else nativeToleranceMs
    fun seekThresholdS(mode: SyncMode, live: Boolean) = when {
        mode == SyncMode.COMPAT && live -> compatSeekThresholdLiveS
        mode == SyncMode.COMPAT -> compat.seekThresholdS
        live -> seekThresholdLiveS
        else -> native.seekThresholdS
    }
}

/**
 * Owner of one DVB-CSS session (CII, WC, TS and the App2App channel). Pure and
 * serial: all I/O goes through [Transport]; every socket and timer has its own
 * token so events from a replaced generation can never alter the new one.
 */
class MediaSyncSession(
    private val transport: Transport,
    clock: MonotonicClock,
    private val listener: Listener,
    private val tuning: SyncTuning = SyncTuning(),
) : TransportEvents {
    data class Config(
        val mode: SyncMode,
        val interDevSyncUrl: String?,
        val app2appUrl: String?,
        val realHost: String?,
        val timelineSelector: String = TimelineProtocol.PTS,
        val compatPrefix: String = Endpoints.DEFAULT_COMPAT_PREFIX,
    )

    enum class State { DISCONNECTED, CONNECTING, WAITING_CONTENT, SYNCHRONISING, SYNCHRONISED, RECOVERING, ERROR }

    enum class Issue {
        NONE, NO_ENDPOINT, CII_UNREACHABLE, CONNECTION_LOST, INVALID_ENDPOINTS, NO_CONTENT,
        PRESENTATION_FAULT, UNSUPPORTED_TIMELINE, TIMELINE_UNAVAILABLE, WALL_CLOCK_UNSYNCHRONISED,
    }

    data class Snapshot(
        val generation: Long,
        val state: State,
        val issue: Issue,
        val mode: SyncMode?,
        val contentId: String?,
        val timelineSelector: String?,
        val appChannel: App2AppChannel.State,
    )

    interface Listener {
        fun onSnapshot(snapshot: Snapshot) {}
        /** New (or cleared) contentId: every catalog/playback derived from the old one is stale. */
        fun onContentChanged(generation: Long, contentId: String?) {}
        /** A control timestamp arrived or the timeline became unavailable. */
        fun onTimelineChanged(generation: Long) {}
        fun onAppMessage(generation: Long, message: App2AppChannel.Message) {}
    }

    private enum class TimerKind { NO_CONTENT, WC_POLL, WC_TIMEOUT, CII_RETRY, WC_RETRY, TS_RETRY }

    private val clock = RebasedClock(clock)
    private var config: Config? = null
    private var running = false
    var generation = 0L
        private set
    private val tracker = CiiTracker()
    private val estimator = WallClockEstimator()
    private var ciiUrl: String? = null
    private var ciiToken: Long? = null
    private var ciiOpened = false
    private var everOpened = false
    private var wcToken: Long? = null
    private var wcUrl: String? = null
    private var wcOpen = false
    private var tsToken: Long? = null
    private var tsUrl: String? = null
    private var selector: String? = null
    private var timestamp: ControlTimestamp? = null
    private var timestampAt = 0L
    private var timelineUnavailable = false
    private var invalidEndpoints = false
    private var noContentExpired = false
    private var wallClockExpired = false
    private val timers = mutableMapOf<Long, TimerKind>()
    private val ciiBackoff = Backoff()
    private val wcBackoff = Backoff()
    private val tsBackoff = Backoff()
    private val pendingUdp = LinkedHashMap<Long, Long>()
    private val pendingJson = LinkedHashMap<Long, Long>()
    private var wcCounter = 0L
    private var appChannel: App2AppChannel? = null
    private var lastSnapshot: Snapshot? = null

    val mode: SyncMode? get() = config?.mode
    val cii: CiiState get() = tracker.state
    val wallClockStats: WallClockEstimator.Stats get() = estimator.stats()

    fun start(config: Config) {
        stop()
        generation++
        this.config = config
        running = true
        ciiUrl = Endpoints.repair(Endpoints.ciiUrl(config.mode, config.interDevSyncUrl, config.app2appUrl, config.compatPrefix), config.realHost)
        App2AppChannel.url(Endpoints.repair(config.app2appUrl, config.realHost), config.compatPrefix)?.let { url ->
            appChannel = App2AppChannel(url, transport, appListener(generation)).also { it.open() }
        }
        if (ciiUrl == null) {
            publish()
            return
        }
        openCii()
    }

    fun stop() {
        if (!running && config == null) return
        running = false
        closeCii()
        appChannel?.close()
        appChannel = null
        timers.keys.toList().forEach(transport::cancel)
        timers.clear()
        // A restart may receive an identical CII; stale state would hide it as "unchanged".
        tracker.reset()
        estimator.reset()
        noContentExpired = false
        wallClockExpired = false
        ciiBackoff.reset()
        wcBackoff.reset()
        tsBackoff.reset()
        everOpened = false
        config = null
        generation++
        publish()
    }

    fun sendAppMessage(type: String, payload: JsonElement?, id: String?): Boolean =
        appChannel?.send(type, payload, id) ?: false

    val retainedAppMessages: List<App2AppChannel.Message> get() = appChannel?.retained ?: emptyList()

    /** TV position now, or null without both a wall-clock correlation and a timeline. */
    fun position(): TimelinePosition? {
        val ct = timestamp ?: return null
        val selector = selector ?: return null
        val mode = config?.mode ?: return null
        val now = clock.nanos()
        val wall = estimator.wallClockNanos(now) ?: return null
        val tickRate = TimelineProtocol.tickRate(selector, tracker.state.timelines) ?: return null
        val uncertainty = estimator.dispersionNanos(now) / 1e6
        return TimelinePosition(
            seconds = TimelineMath.positionSeconds(ct, wall, tickRate),
            speed = ct.speed,
            uncertaintyMs = uncertainty,
            timestampAgeMs = (now - timestampAt) / 1e6,
            reliable = uncertainty <= tuning.toleranceMs(mode),
        )
    }

    override fun onOpened(token: Long) {
        when (token) {
            ciiToken -> {
                ciiOpened = true
                everOpened = true
                ciiBackoff.reset()
                noContentExpired = false
                schedule(TimerKind.NO_CONTENT, tuning.noContentTimeoutMs)
            }
            wcToken -> {
                wcOpen = true
                wcBackoff.reset()
                sendWallClockRequest()
                schedule(TimerKind.WC_POLL, tuning.wallClockIntervalMs)
                schedule(TimerKind.WC_TIMEOUT, tuning.wallClockTimeoutMs)
            }
            tsToken -> {
                tsBackoff.reset()
                sendSetup(token)
            }
            else -> return
        }
        publish()
    }

    override fun onText(token: Long, text: String) {
        if (text == App2AppChannel.PAIRING_FRAME) {
            when (token) {
                wcToken -> sendWallClockRequest()
                tsToken -> sendSetup(token)
            }
            return
        }
        when (token) {
            ciiToken -> tracker.apply(text)?.let(::handleCii)
            wcToken -> handleJsonWallClock(text)
            tsToken -> handleTimeline(text)
        }
    }

    override fun onDatagram(token: Long, data: ByteArray, receivedAtNanos: Long) {
        if (token != wcToken) return
        val message = WallClockMessage.decode(data) ?: return
        val sentAt = if (message.type == WallClockMessage.TYPE_RESPONSE_WITH_FOLLOWUP) pendingUdp[message.originateNanos]
        else pendingUdp.remove(message.originateNanos)
        if (sentAt == null) return
        val now = clock.nanos()
        val received = if (receivedAtNanos > 0) clock.fromSource(receivedAtNanos).coerceIn(sentAt, now) else now
        acceptSample(WallClockEstimator.Sample(message.originateNanos, message.receiveNanos, message.transmitNanos,
            received, message.maxFreqError / 256.0))
    }

    override fun onClosed(token: Long, failed: Boolean) {
        when (token) {
            ciiToken -> {
                ciiToken = null
                closeCii()
                tracker.reset()
                listener.onContentChanged(generation, null)
                schedule(TimerKind.CII_RETRY, ciiBackoff.nextDelayMs())
            }
            wcToken -> {
                closeWallClock()
                schedule(TimerKind.WC_RETRY, wcBackoff.nextDelayMs())
            }
            tsToken -> {
                closeTimeline()
                listener.onTimelineChanged(generation)
                schedule(TimerKind.TS_RETRY, tsBackoff.nextDelayMs())
            }
            else -> return
        }
        publish()
    }

    override fun onTimer(token: Long) {
        val kind = timers.remove(token) ?: return
        if (!running) return
        when (kind) {
            TimerKind.NO_CONTENT -> noContentExpired = true
            TimerKind.WC_POLL -> {
                sendWallClockRequest()
                schedule(TimerKind.WC_POLL, tuning.wallClockIntervalMs)
            }
            TimerKind.WC_TIMEOUT -> {
                // Re-armed: UDP never reports a close, so responses that stop later must still surface.
                wallClockExpired = !wallClockSynchronised()
                schedule(TimerKind.WC_TIMEOUT, tuning.wallClockTimeoutMs)
            }
            TimerKind.CII_RETRY -> if (ciiToken == null) openCii()
            TimerKind.WC_RETRY -> if (wcToken == null) reconcileEndpoints()
            TimerKind.TS_RETRY -> if (tsToken == null) maybeOpenTimeline()
        }
        publish()
    }

    private fun appListener(owner: Long) = object : App2AppChannel.Listener {
        override fun onAppChannelState(state: App2AppChannel.State) { if (owner == generation) publish() }
        override fun onAppMessage(message: App2AppChannel.Message) {
            if (owner == generation) listener.onAppMessage(owner, message)
        }
    }

    private fun openCii() {
        val url = ciiUrl ?: return
        val token = Tokens.next()
        ciiToken = token
        ciiOpened = false
        transport.openWebSocket(token, url, this)
        publish()
    }

    private fun closeCii() {
        ciiToken?.let(transport::close)
        ciiToken = null
        ciiOpened = false
        cancelTimers(TimerKind.NO_CONTENT)
        closeWallClock()
        closeTimeline()
        wcUrl = null
        tsUrl = null
        selector = null
        invalidEndpoints = false
    }

    private fun handleCii(update: CiiTracker.Update) {
        if (CiiTracker.Field.CONTENT_ID in update.changed) {
            timestamp = null
            timelineUnavailable = false
            if (update.state.contentId != null) {
                cancelTimers(TimerKind.NO_CONTENT)
                noContentExpired = false
            }
            listener.onContentChanged(generation, update.state.contentId)
            listener.onTimelineChanged(generation)
        }
        if (update.changed.any { it == CiiTracker.Field.WC_URL || it == CiiTracker.Field.TS_URL || it == CiiTracker.Field.TIMELINES }) {
            reconcileEndpoints()
        }
        publish()
    }

    private fun reconcileEndpoints() {
        val config = config ?: return
        val state = tracker.state
        if (state.wcUrl == null && state.tsUrl == null) {
            // The TV withdrew both endpoints: stop syncing against the old ones.
            closeWallClock(); wcUrl = null
            closeTimeline(); tsUrl = null
            return
        }
        val wc = Endpoints.repair(state.wcUrl, config.realHost)
        val ts = Endpoints.repair(state.tsUrl, config.realHost)
        val valid = when (config.mode) {
            SyncMode.COMPAT -> Endpoints.isCompatServiceUrl(wc, config.compatPrefix, "wc") &&
                Endpoints.isCompatServiceUrl(ts, config.compatPrefix, "ts")
            SyncMode.NATIVE -> Endpoints.parseUdp(wc) != null && Endpoints.isWebSocket(ts)
        }
        invalidEndpoints = !valid
        if (!valid) {
            closeWallClock(); wcUrl = null
            closeTimeline(); tsUrl = null
            return
        }
        val nextSelector = TimelineProtocol.select(config.timelineSelector, state.timelines)
        if (wc != wcUrl || wcToken == null) {
            closeWallClock()
            if (wc != wcUrl) estimator.reset()
            wcUrl = wc
            openWallClock()
        }
        if (ts != tsUrl || nextSelector != selector) {
            closeTimeline()
            tsUrl = ts
            selector = nextSelector
            listener.onTimelineChanged(generation)
        }
        maybeOpenTimeline()
    }

    private fun openWallClock() {
        val url = wcUrl ?: return
        val token = Tokens.next()
        wcToken = token
        wcOpen = false
        wallClockExpired = false
        if (config?.mode == SyncMode.NATIVE) {
            val endpoint = Endpoints.parseUdp(url) ?: return
            transport.openUdp(token, endpoint.host, endpoint.port, this)
        } else {
            transport.openWebSocket(token, url, this)
        }
    }

    private fun closeWallClock() {
        wcToken?.let(transport::close)
        wcToken = null
        wcOpen = false
        pendingUdp.clear()
        pendingJson.clear()
        cancelTimers(TimerKind.WC_POLL, TimerKind.WC_TIMEOUT, TimerKind.WC_RETRY)
    }

    private fun sendWallClockRequest() {
        val token = wcToken ?: return
        if (!wcOpen) return
        val now = clock.nanos()
        val expiry = now - 5_000_000_000L
        pendingUdp.entries.removeIf { it.value < expiry }
        pendingJson.entries.removeIf { it.value < expiry }
        if (config?.mode == SyncMode.NATIVE) {
            if (pendingUdp.size >= 16) pendingUdp.remove(pendingUdp.keys.first())
            pendingUdp[now] = now
            transport.sendDatagram(token, WallClockMessage.request(now))
        } else {
            val id = ++wcCounter
            if (pendingJson.size >= 16) pendingJson.remove(pendingJson.keys.first())
            pendingJson[id] = now
            transport.sendText(token, buildJsonObject {
                put("v", 0); put("t", 0); put("p", -50); put("mfe", 50); put("id", id); put("ot", now)
            }.toString())
        }
    }

    private fun handleJsonWallClock(text: String) {
        val message = JsonInput.parseObject(text, 4_096) ?: return
        val type = JsonInput.long(message["t"]) ?: return
        if (type !in 1L..3L) return
        val id = JsonInput.long(message["id"]) ?: return
        val sentAt = pendingJson.remove(id) ?: return
        val receive = JsonInput.long(message["rt"]) ?: return
        val transmit = JsonInput.long(message["tt"]) ?: return
        val ppm = (JsonInput.double(message["mfe"]) ?: 0.0).coerceIn(0.0, 10_000.0)
        acceptSample(WallClockEstimator.Sample(sentAt, receive, transmit, clock.nanos(), ppm))
    }

    private fun acceptSample(sample: WallClockEstimator.Sample) {
        if (!estimator.accept(sample, clock.nanos())) return
        if (wallClockSynchronised()) wallClockExpired = false
        maybeOpenTimeline()
        publish()
    }

    private fun wallClockSynchronised(): Boolean {
        val mode = config?.mode ?: return false
        return estimator.isSynchronized(clock.nanos(), tuning.toleranceMs(mode))
    }

    private fun maybeOpenTimeline() {
        if (tsToken != null || !running || invalidEndpoints) return
        val url = tsUrl ?: return
        if (selector == null || !wallClockSynchronised()) return
        val token = Tokens.next()
        tsToken = token
        transport.openWebSocket(token, url, this)
    }

    private fun sendSetup(token: Long) {
        selector?.let { transport.sendText(token, TimelineProtocol.setupMessage(it)) }
    }

    private fun closeTimeline() {
        tsToken?.let(transport::close)
        tsToken = null
        timestamp = null
        timelineUnavailable = false
        cancelTimers(TimerKind.TS_RETRY)
    }

    private fun handleTimeline(text: String) {
        when (val message = TimelineProtocol.parse(text) ?: return) {
            is TimelineMessage.Available -> {
                timestamp = message.timestamp
                timestampAt = clock.nanos()
                timelineUnavailable = false
            }
            TimelineMessage.Unavailable -> {
                timestamp = null
                timelineUnavailable = true
            }
        }
        listener.onTimelineChanged(generation)
        publish()
    }

    private fun schedule(kind: TimerKind, delayMs: Long) {
        cancelTimers(kind)
        val token = Tokens.next()
        timers[token] = kind
        transport.schedule(token, delayMs, this)
    }

    private fun cancelTimers(vararg kinds: TimerKind) {
        val matching = timers.filterValues { it in kinds }.keys
        matching.forEach { transport.cancel(it); timers.remove(it) }
    }

    private fun computeState(): State = when {
        !running -> State.DISCONNECTED
        ciiUrl == null -> State.ERROR
        !ciiOpened -> if (everOpened || ciiBackoff.attempts > 0) State.RECOVERING else State.CONNECTING
        tracker.state.contentId == null -> State.WAITING_CONTENT
        timestamp != null && wallClockSynchronised() -> State.SYNCHRONISED
        else -> State.SYNCHRONISING
    }

    private fun computeIssue(): Issue = when {
        !running -> Issue.NONE
        ciiUrl == null -> Issue.NO_ENDPOINT
        !ciiOpened && ciiBackoff.attempts > 0 -> if (everOpened) Issue.CONNECTION_LOST else Issue.CII_UNREACHABLE
        invalidEndpoints -> Issue.INVALID_ENDPOINTS
        tracker.state.isPresentationFault -> Issue.PRESENTATION_FAULT
        tracker.state.contentId == null && noContentExpired -> Issue.NO_CONTENT
        tracker.state.contentId != null && tsUrl != null && selector == null -> Issue.UNSUPPORTED_TIMELINE
        timelineUnavailable -> Issue.TIMELINE_UNAVAILABLE
        wallClockExpired -> Issue.WALL_CLOCK_UNSYNCHRONISED
        else -> Issue.NONE
    }

    private fun publish() {
        val snapshot = Snapshot(generation, computeState(), computeIssue(), config?.mode, tracker.state.contentId,
            selector, appChannel?.state ?: App2AppChannel.State.CLOSED)
        if (snapshot == lastSnapshot) return
        lastSnapshot = snapshot
        listener.onSnapshot(snapshot)
    }
}
