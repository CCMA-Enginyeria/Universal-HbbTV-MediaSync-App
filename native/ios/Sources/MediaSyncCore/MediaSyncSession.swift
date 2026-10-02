import Foundation

/// Values inherited from the former React Native app (`src/utils/config.js`).
public struct SyncTuning {
    public var native: SyncController.Options = {
        var options = SyncController.Options()
        options.emaAlpha = 0.25; options.enterBandS = 0.1; options.exitBandS = 0.01; options.horizonS = 3.0
        options.deadTimeS = 0.35; options.maxRateDelta = 0.05; options.rateEps = 0.002; options.seekThresholdS = 2.0
        return options
    }()
    public var compat: SyncController.Options
    public var seekThresholdLiveS = 5.0
    public var compatSeekThresholdLiveS = 20.0
    public var seekCooldownMs: Int64 = 1_500
    public var seekLeadS = 0.4
    public var minCorrectionIntervalMs: Int64 = 80
    public var progressIntervalMs: Int64 = 250
    public var nativeToleranceMs = 100.0
    public var compatToleranceMs = 500.0
    public var wallClockIntervalMs: Int64 = 1_000
    public var noContentTimeoutMs: Int64 = 5_000
    public var wallClockTimeoutMs: Int64 = 10_000
    public var probeTimeoutMs: Int64 = 2_000

    public init() {
        compat = native
        compat.enterBandS = 0.25
        compat.exitBandS = 0.02
        compat.seekThresholdS = 20
    }

    public func controllerOptions(_ mode: SyncMode) -> SyncController.Options { mode == .compat ? compat : native }
    public func toleranceMs(_ mode: SyncMode) -> Double { mode == .compat ? compatToleranceMs : nativeToleranceMs }
    public func seekThresholdS(_ mode: SyncMode, live: Bool) -> Double {
        switch (mode, live) {
        case (.compat, true): return compatSeekThresholdLiveS
        case (.compat, false): return compat.seekThresholdS
        case (.native, true): return seekThresholdLiveS
        case (.native, false): return native.seekThresholdS
        }
    }
}

/// Owner of one DVB-CSS session (CII, WC, TS and App2App). Pure and serial; every
/// socket and timer has its own token so events from a replaced generation are ignored.
public final class MediaSyncSession: TransportEvents {
    public struct Config {
        public var mode: SyncMode
        public var interDevSyncUrl: String?
        public var app2appUrl: String?
        public var realHost: String?
        public var timelineSelector = TimelineProtocol.pts
        public var compatPrefix = Endpoints.defaultCompatPrefix

        public init(mode: SyncMode, interDevSyncUrl: String?, app2appUrl: String?, realHost: String?,
                    timelineSelector: String = TimelineProtocol.pts, compatPrefix: String = Endpoints.defaultCompatPrefix) {
            self.mode = mode
            self.interDevSyncUrl = interDevSyncUrl
            self.app2appUrl = app2appUrl
            self.realHost = realHost
            self.timelineSelector = timelineSelector
            self.compatPrefix = compatPrefix
        }
    }

    public enum State: String { case disconnected, connecting, waitingContent, synchronising, synchronised, recovering, error }

    public enum Issue: String {
        case none, noEndpoint, ciiUnreachable, connectionLost, invalidEndpoints, noContent
        case presentationFault, unsupportedTimeline, timelineUnavailable, wallClockUnsynchronised
    }

    public struct Snapshot: Equatable {
        public let generation: Int64
        public let state: State
        public let issue: Issue
        public let mode: SyncMode?
        public let contentId: String?
        public let timelineSelector: String?
        public let appChannel: App2AppChannel.State
    }

    public var onSnapshot: ((Snapshot) -> Void)?
    /// New (or cleared) contentId: everything derived from the old one is stale.
    public var onContentChanged: ((Int64, String?) -> Void)?
    public var onTimelineChanged: ((Int64) -> Void)?
    public var onAppMessage: ((Int64, App2AppChannel.Message) -> Void)?

    private enum TimerKind { case noContent, wcPoll, wcTimeout, ciiRetry, wcRetry, tsRetry }

    private let transport: Transport
    private let clock: RebasedClock
    private let tuning: SyncTuning
    private var config: Config?
    private var running = false
    public private(set) var generation: Int64 = 0
    private let tracker = CiiTracker()
    private let estimator = WallClockEstimator()
    private var ciiUrl: String?
    private var ciiToken: Int64?
    private var ciiOpened = false
    private var everOpened = false
    private var wcToken: Int64?
    private var wcUrl: String?
    private var wcOpen = false
    private var tsToken: Int64?
    private var tsUrl: String?
    private var selector: String?
    private var timestamp: ControlTimestamp?
    private var timestampAt: Int64 = 0
    private var timelineUnavailable = false
    private var invalidEndpoints = false
    private var noContentExpired = false
    private var wallClockExpired = false
    private var timers: [Int64: TimerKind] = [:]
    private let ciiBackoff = Backoff()
    private let wcBackoff = Backoff()
    private let tsBackoff = Backoff()
    private var pendingUdp: [(originate: Int64, sentAt: Int64)] = []
    private var pendingJson: [(id: Int64, sentAt: Int64)] = []
    private var wcCounter: Int64 = 0
    private var appChannel: App2AppChannel?
    private var lastSnapshot: Snapshot?

    public init(transport: Transport, clock: @escaping MonotonicClock, tuning: SyncTuning = SyncTuning()) {
        self.transport = transport
        self.clock = RebasedClock(clock)
        self.tuning = tuning
    }

    public var mode: SyncMode? { config?.mode }
    public var cii: CiiState { tracker.state }
    public var wallClockStats: WallClockEstimator.Stats { estimator.stats() }
    public var retainedAppMessages: [App2AppChannel.Message] { appChannel?.retained ?? [] }

    public func start(_ config: Config) {
        stop()
        generation += 1
        self.config = config
        running = true
        ciiUrl = Endpoints.repair(Endpoints.ciiUrl(mode: config.mode, interDevSyncUrl: config.interDevSyncUrl,
            app2appUrl: config.app2appUrl, prefix: config.compatPrefix), realHost: config.realHost)
        if let url = App2AppChannel.url(app2appBase: Endpoints.repair(config.app2appUrl, realHost: config.realHost), prefix: config.compatPrefix) {
            let owner = generation
            let channel = App2AppChannel(url: url, transport: transport)
            channel.onState = { [weak self] _ in if self?.generation == owner { self?.publish() } }
            channel.onMessage = { [weak self] message in
                guard let self = self, self.generation == owner else { return }
                self.onAppMessage?(owner, message)
            }
            appChannel = channel
            channel.open()
        }
        guard ciiUrl != nil else {
            publish()
            return
        }
        openCii()
    }

    public func stop() {
        guard running || config != nil else { return }
        running = false
        closeCii()
        appChannel?.close()
        appChannel = nil
        timers.keys.forEach(transport.cancel)
        timers.removeAll()
        // A restart may receive an identical CII; stale state would hide it as "unchanged".
        tracker.reset()
        estimator.reset()
        noContentExpired = false
        wallClockExpired = false
        ciiBackoff.reset()
        wcBackoff.reset()
        tsBackoff.reset()
        everOpened = false
        config = nil
        generation += 1
        publish()
    }

    @discardableResult
    public func sendAppMessage(type: String, payload: Any?, id: String?) -> Bool {
        appChannel?.send(type: type, payload: payload, id: id) ?? false
    }

    public func position() -> TimelinePosition? {
        guard let ct = timestamp, let selector = selector, let mode = config?.mode else { return nil }
        let now = clock.nanos()
        guard let wall = estimator.wallClockNanos(now),
              let tickRate = TimelineProtocol.tickRate(selector, advertised: tracker.state.timelines) else { return nil }
        let uncertainty = estimator.dispersionNanos(now) / 1e6
        return TimelinePosition(seconds: TimelineMath.positionSeconds(ct, wallNowNanos: wall, tickRate: tickRate),
                                speed: ct.speed, uncertaintyMs: uncertainty,
                                timestampAgeMs: Double(now - timestampAt) / 1e6,
                                reliable: uncertainty <= tuning.toleranceMs(mode))
    }

    public func onOpened(_ token: Int64) {
        if token == ciiToken {
            ciiOpened = true
            everOpened = true
            ciiBackoff.reset()
            noContentExpired = false
            schedule(.noContent, tuning.noContentTimeoutMs)
        } else if token == wcToken {
            wcOpen = true
            wcBackoff.reset()
            sendWallClockRequest()
            schedule(.wcPoll, tuning.wallClockIntervalMs)
            schedule(.wcTimeout, tuning.wallClockTimeoutMs)
        } else if token == tsToken {
            tsBackoff.reset()
            sendSetup(token)
        } else {
            return
        }
        publish()
    }

    public func onText(_ token: Int64, _ text: String) {
        if text == App2AppChannel.pairingFrame {
            if token == wcToken { sendWallClockRequest() } else if token == tsToken { sendSetup(token) }
            return
        }
        if token == ciiToken {
            if let update = tracker.apply(text) { handleCii(update) }
        } else if token == wcToken {
            handleJsonWallClock(text)
        } else if token == tsToken {
            handleTimeline(text)
        }
    }

    public func onDatagram(_ token: Int64, _ data: Data, receivedAtNanos: Int64) {
        guard token == wcToken, let message = WallClockMessage.decode(data),
              let index = pendingUdp.firstIndex(where: { $0.originate == message.originateNanos }) else { return }
        let sentAt = pendingUdp[index].sentAt
        if message.type != WallClockMessage.typeResponseWithFollowup { pendingUdp.remove(at: index) }
        let now = clock.nanos()
        let received = receivedAtNanos > 0 ? min(max(clock.fromSource(receivedAtNanos), sentAt), now) : now
        acceptSample(WallClockEstimator.Sample(localSendNanos: message.originateNanos, remoteReceiveNanos: message.receiveNanos,
            remoteTransmitNanos: message.transmitNanos, localReceiveNanos: received,
            remoteMaxFreqErrorPpm: Double(message.maxFreqError) / 256))
    }

    public func onClosed(_ token: Int64, failed: Bool) {
        if token == ciiToken {
            ciiToken = nil
            closeCii()
            tracker.reset()
            onContentChanged?(generation, nil)
            schedule(.ciiRetry, ciiBackoff.nextDelayMs())
        } else if token == wcToken {
            closeWallClock()
            schedule(.wcRetry, wcBackoff.nextDelayMs())
        } else if token == tsToken {
            closeTimeline()
            onTimelineChanged?(generation)
            schedule(.tsRetry, tsBackoff.nextDelayMs())
        } else {
            return
        }
        publish()
    }

    public func onTimer(_ token: Int64) {
        guard let kind = timers.removeValue(forKey: token), running else { return }
        switch kind {
        case .noContent: noContentExpired = true
        case .wcPoll:
            sendWallClockRequest()
            schedule(.wcPoll, tuning.wallClockIntervalMs)
        case .wcTimeout:
            // Re-armed: UDP never reports a close, so responses that stop later must still surface.
            wallClockExpired = !wallClockSynchronised()
            schedule(.wcTimeout, tuning.wallClockTimeoutMs)
        case .ciiRetry: if ciiToken == nil { openCii() }
        case .wcRetry: if wcToken == nil { reconcileEndpoints() }
        case .tsRetry: if tsToken == nil { maybeOpenTimeline() }
        }
        publish()
    }

    private func openCii() {
        guard let url = ciiUrl else { return }
        let token = Tokens.next()
        ciiToken = token
        ciiOpened = false
        transport.openWebSocket(token, url: url, events: self)
        publish()
    }

    private func closeCii() {
        if let token = ciiToken { transport.close(token) }
        ciiToken = nil
        ciiOpened = false
        cancelTimers([.noContent])
        closeWallClock()
        closeTimeline()
        wcUrl = nil
        tsUrl = nil
        selector = nil
        invalidEndpoints = false
    }

    private func handleCii(_ update: CiiTracker.Update) {
        if update.changed.contains(.contentId) {
            timestamp = nil
            timelineUnavailable = false
            if update.state.contentId != nil {
                cancelTimers([.noContent])
                noContentExpired = false
            }
            onContentChanged?(generation, update.state.contentId)
            onTimelineChanged?(generation)
        }
        if !update.changed.isDisjoint(with: [.wcUrl, .tsUrl, .timelines]) { reconcileEndpoints() }
        publish()
    }

    private func reconcileEndpoints() {
        guard let config = config else { return }
        let state = tracker.state
        guard state.wcUrl != nil || state.tsUrl != nil else {
            // The TV withdrew both endpoints: stop syncing against the old ones.
            closeWallClock(); wcUrl = nil
            closeTimeline(); tsUrl = nil
            return
        }
        let wc = Endpoints.repair(state.wcUrl, realHost: config.realHost)
        let ts = Endpoints.repair(state.tsUrl, realHost: config.realHost)
        let valid: Bool
        switch config.mode {
        case .compat:
            valid = Endpoints.isCompatServiceUrl(wc, prefix: config.compatPrefix, service: "wc") &&
                Endpoints.isCompatServiceUrl(ts, prefix: config.compatPrefix, service: "ts")
        case .native:
            valid = Endpoints.parseUdp(wc) != nil && Endpoints.isWebSocket(ts)
        }
        invalidEndpoints = !valid
        guard valid else {
            closeWallClock(); wcUrl = nil
            closeTimeline(); tsUrl = nil
            return
        }
        let nextSelector = TimelineProtocol.select(configured: config.timelineSelector, advertised: state.timelines)
        if wc != wcUrl || wcToken == nil {
            closeWallClock()
            if wc != wcUrl { estimator.reset() }
            wcUrl = wc
            openWallClock()
        }
        if ts != tsUrl || nextSelector != selector {
            closeTimeline()
            tsUrl = ts
            selector = nextSelector
            onTimelineChanged?(generation)
        }
        maybeOpenTimeline()
    }

    private func openWallClock() {
        guard let url = wcUrl else { return }
        let token = Tokens.next()
        wcToken = token
        wcOpen = false
        wallClockExpired = false
        if config?.mode == .native {
            guard let endpoint = Endpoints.parseUdp(url) else { return }
            transport.openUdp(token, host: endpoint.host, port: endpoint.port, events: self)
        } else {
            transport.openWebSocket(token, url: url, events: self)
        }
    }

    private func closeWallClock() {
        if let token = wcToken { transport.close(token) }
        wcToken = nil
        wcOpen = false
        pendingUdp.removeAll()
        pendingJson.removeAll()
        cancelTimers([.wcPoll, .wcTimeout, .wcRetry])
    }

    private func sendWallClockRequest() {
        guard let token = wcToken, wcOpen else { return }
        let now = clock.nanos()
        let expiry = now - 5_000_000_000
        pendingUdp.removeAll { $0.sentAt < expiry }
        pendingJson.removeAll { $0.sentAt < expiry }
        if config?.mode == .native {
            if pendingUdp.count >= 16 { pendingUdp.removeFirst() }
            pendingUdp.append((now, now))
            transport.sendDatagram(token, WallClockMessage.request(originateNanos: now))
        } else {
            wcCounter += 1
            if pendingJson.count >= 16 { pendingJson.removeFirst() }
            pendingJson.append((wcCounter, now))
            transport.sendText(token, "{\"v\":0,\"t\":0,\"p\":-50,\"mfe\":50,\"id\":\(wcCounter),\"ot\":\(now)}")
        }
    }

    private func handleJsonWallClock(_ text: String) {
        guard let message = JsonInput.parseObject(text, maxChars: 4_096), let type = JsonInput.long(message["t"]),
              (1...3).contains(type), let id = JsonInput.long(message["id"]),
              let index = pendingJson.firstIndex(where: { $0.id == id }) else { return }
        let sentAt = pendingJson.remove(at: index).sentAt
        guard let receive = JsonInput.long(message["rt"]), let transmit = JsonInput.long(message["tt"]) else { return }
        let ppm = min(max(JsonInput.double(message["mfe"]) ?? 0, 0), 10_000)
        acceptSample(WallClockEstimator.Sample(localSendNanos: sentAt, remoteReceiveNanos: receive,
            remoteTransmitNanos: transmit, localReceiveNanos: clock.nanos(), remoteMaxFreqErrorPpm: ppm))
    }

    private func acceptSample(_ sample: WallClockEstimator.Sample) {
        guard estimator.accept(sample, now: clock.nanos()) else { return }
        if wallClockSynchronised() { wallClockExpired = false }
        maybeOpenTimeline()
        publish()
    }

    private func wallClockSynchronised() -> Bool {
        guard let mode = config?.mode else { return false }
        return estimator.isSynchronized(clock.nanos(), toleranceMs: tuning.toleranceMs(mode))
    }

    private func maybeOpenTimeline() {
        guard tsToken == nil, running, !invalidEndpoints, let url = tsUrl, selector != nil, wallClockSynchronised() else { return }
        let token = Tokens.next()
        tsToken = token
        transport.openWebSocket(token, url: url, events: self)
    }

    private func sendSetup(_ token: Int64) {
        if let selector = selector { transport.sendText(token, TimelineProtocol.setupMessage(timelineSelector: selector)) }
    }

    private func closeTimeline() {
        if let token = tsToken { transport.close(token) }
        tsToken = nil
        timestamp = nil
        timelineUnavailable = false
        cancelTimers([.tsRetry])
    }

    private func handleTimeline(_ text: String) {
        guard let message = TimelineProtocol.parse(text) else { return }
        switch message {
        case .available(let value):
            timestamp = value
            timestampAt = clock.nanos()
            timelineUnavailable = false
        case .unavailable:
            timestamp = nil
            timelineUnavailable = true
        }
        onTimelineChanged?(generation)
        publish()
    }

    private func schedule(_ kind: TimerKind, _ delayMs: Int64) {
        cancelTimers([kind])
        let token = Tokens.next()
        timers[token] = kind
        transport.schedule(token, delayMs: delayMs, events: self)
    }

    private func cancelTimers(_ kinds: Set<TimerKind>) {
        for (token, kind) in timers where kinds.contains(kind) {
            transport.cancel(token)
            timers.removeValue(forKey: token)
        }
    }

    private func computeState() -> State {
        if !running { return .disconnected }
        if ciiUrl == nil { return .error }
        if !ciiOpened { return everOpened || ciiBackoff.attempts > 0 ? .recovering : .connecting }
        if tracker.state.contentId == nil { return .waitingContent }
        return timestamp != nil && wallClockSynchronised() ? .synchronised : .synchronising
    }

    private func computeIssue() -> Issue {
        if !running { return .none }
        if ciiUrl == nil { return .noEndpoint }
        if !ciiOpened && ciiBackoff.attempts > 0 { return everOpened ? .connectionLost : .ciiUnreachable }
        if invalidEndpoints { return .invalidEndpoints }
        if tracker.state.isPresentationFault { return .presentationFault }
        if tracker.state.contentId == nil && noContentExpired { return .noContent }
        if tracker.state.contentId != nil && tsUrl != nil && selector == nil { return .unsupportedTimeline }
        if timelineUnavailable { return .timelineUnavailable }
        if wallClockExpired { return .wallClockUnsynchronised }
        return .none
    }

    private func publish() {
        let snapshot = Snapshot(generation: generation, state: computeState(), issue: computeIssue(), mode: config?.mode,
                                contentId: tracker.state.contentId, timelineSelector: selector,
                                appChannel: appChannel?.state ?? .closed)
        guard snapshot != lastSnapshot else { return }
        lastSnapshot = snapshot
        onSnapshot?(snapshot)
    }
}
