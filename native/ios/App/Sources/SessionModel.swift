import Foundation
import MediaSyncCore
import UIKit

/// A companion page transport (WKWebView) that receives protocol envelopes.
protocol CompanionSink: AnyObject {
    func deliver(_ envelope: String)
}

/**
 * Single owner of the active TV (PRD-004-R02/R03): probes, DVB-CSS session,
 * catalog, player, subtitles and companion pages. Main thread only; every
 * asynchronous result is checked against the generation that requested it.
 * iOS cannot play MPEG-DASH natively, so DASH tracks use the brand web player.
 */
final class SessionModel: ObservableObject {
    struct WebPage: Equatable {
        let url: String
        let title: String?
    }

    enum Failure { case format, protected, manifest }

    enum Content: Equatable {
        case none, loading
        case media(MediaManifest, ContentKind)
        case web(WebPage)
        case failed(Failure)
    }

    @Published private(set) var terminal: DialTerminal?
    @Published private(set) var preferredMode = SyncMode.defaultMode
    @Published private(set) var availability: [SyncMode: Availability] = [.native: .unknown, .compat: .unknown]
    @Published private(set) var effectiveMode: SyncMode?
    @Published private(set) var snapshot: MediaSyncSession.Snapshot?
    @Published private(set) var content = Content.none
    @Published private(set) var selected: MediaTrack?
    @Published private(set) var subtitle: MediaTrack?
    @Published private(set) var subtitleText: String?
    @Published private(set) var status = PlaybackCorrector.Status.waiting
    @Published private(set) var rate = 1.0
    @Published private(set) var positionS: Double?
    @Published private(set) var playerRetrying = false
    @Published private(set) var playerFailed = false
    @Published private(set) var suspendedBySystem = false
    @Published private(set) var webGone = false
    @Published private(set) var webPlayerUrl: String?
    @Published private(set) var volume: Float = 1

    var availableModes: [SyncMode] { ModeSelection.available(availability) }
    var probing: Bool { availability.values.contains(.checking) }
    var noModes: Bool { ModeSelection.allUnavailable(availability) }
    var isActive: Bool { selected != nil }

    let playerOwner = PlayerOwner()
    private let transport: AppleTransport
    private let loader: ContentLoader
    private let diagnostics: Diagnostics
    private let tuning = SyncTuning()
    private let corrector: PlaybackCorrector
    private let feed = CompanionFeedThrottle()
    private var generation = 0
    private var probes: [TransportProbe] = []
    private var session: MediaSyncSession?
    private var sessionMode: SyncMode?
    private var contentTask: Task<Void, Never>?
    private var subtitleTask: Task<Void, Never>?
    private var cues = CueTrack()
    private var intent: PlaybackIntent?
    private var companions: [ObjectIdentifier: CompanionSink] = [:]
    private var lastPositionEnvelope: String?
    private var ticker: Timer?
    private var lastSyncLog = Date.distantPast

    static let timelineSelector = "urn:dvb:css:timeline:mpd:period:rel:1000"

    init(transport: AppleTransport, loader: ContentLoader, diagnostics: Diagnostics) {
        self.transport = transport
        self.loader = loader
        self.diagnostics = diagnostics
        corrector = PlaybackCorrector(tuning: tuning)
        playerOwner.onSeekCompleted = { [weak self] in self?.corrector.onSeekCompleted() }
        playerOwner.onPlaybackError = { [weak self] retrying in
            guard let self = self else { return }
            self.diagnostics.log("player", "error", ["retrying": retrying])
            self.playerRetrying = retrying
            self.playerFailed = !retrying
            if !retrying { self.stopPlayback() }
        }
        playerOwner.onSystemPause = { [weak self] in self?.suspendedBySystem = true }
    }

    private func key(_ terminal: DialTerminal) -> String {
        Endpoints.preferenceKey(manufacturer: terminal.device.manufacturer, modelName: terminal.device.modelName, location: terminal.device.location)
    }

    func select(_ terminal: DialTerminal) {
        guard self.terminal != terminal else { return }
        stop()
        generation += 1
        self.terminal = terminal
        preferredMode = Preferences.mode(key(terminal))
        availability = [.native: .checking, .compat: .checking]
        diagnostics.log("session", "select", ["generation": generation, "hbbtv": terminal.supportsHbbtv])
        guard terminal.supportsMediaSync else {
            availability = [.native: .unavailable, .compat: .unavailable]
            return
        }
        let current = generation
        let realHost = Endpoints.realHost(terminal.device.location, terminal.device.applicationUrl)
        for mode in SyncMode.allCases {
            let probe = TransportProbe(transport: transport, mode: mode, interDevSyncUrl: terminal.application?.interDeviceSyncUrl,
                                       app2appUrl: terminal.application?.app2AppUrl, realHost: realHost,
                                       timeoutMs: tuning.probeTimeoutMs) { [weak self] available in
                guard let self = self, current == self.generation else { return }
                self.diagnostics.log("session", "probe", ["mode": mode.rawValue, "available": available])
                self.availability[mode] = available ? .available : .unavailable
                self.reconcileMode()
            }
            probes.append(probe)
            probe.start()
        }
    }

    func setPreferredMode(_ mode: SyncMode) {
        guard let terminal = terminal else { return }
        Preferences.setMode(mode, key: key(terminal))
        preferredMode = mode
        reconcileMode()
    }

    func leaveDetail() {
        if !playerOwner.isActive && companions.isEmpty && webPlayerUrl == nil { stop() }
    }

    func retry() {
        guard let terminal = terminal else { return }
        self.terminal = nil
        select(terminal)
    }

    func stop() {
        generation += 1
        probes.forEach { $0.cancel() }
        probes.removeAll()
        session?.stop()
        session = nil
        sessionMode = nil
        contentTask?.cancel()
        intent = nil
        stopPlayback()
        selectSubtitle(nil)
        companions.removeAll()
        stopTicker()
        terminal = nil
        availability = [.native: .unknown, .compat: .unknown]
        effectiveMode = nil
        snapshot = nil
        content = .none
        webGone = false
        playerFailed = false
    }

    func play(_ track: MediaTrack) {
        guard case .media(let manifest, let kind) = content else { return }
        if selected == track {
            intent = nil
            stopPlayback()
            return
        }
        intent = PlaybackIntent(track)
        startTrack(manifest, kind, track)
    }

    func selectSubtitle(_ track: MediaTrack?) {
        subtitleTask?.cancel()
        cues = CueTrack()
        subtitle = track
        subtitleText = nil
        playerOwner.selectSubtitle(nil)
        guard case .media(let manifest, let kind) = content, let track = track else { return }
        startTicker()
        if kind == .hls {
            playerOwner.selectSubtitle(track)
            return
        }
        let loader = self.loader
        if let template = track.segmentTemplate, let base = track.baseUrl {
            let schedule = TextSegmentSchedule(template: template, baseUrl: base, isLive: manifest.isLive,
                                               availabilityStartTimeMs: manifest.availabilityStartTimeMs, representationId: track.representationId)
            subtitleTask = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    let now = Int64(Date().timeIntervalSince1970 * 1000)
                    for number in schedule.pending(nowEpochMs: now, positionS: self?.positionS) {
                        guard let url = schedule.url(number) else { continue }
                        let data = try? await loader.dataOrNil(url, maxBytes: 1_048_576)
                        if Task.isCancelled { return }
                        guard let data = data else { break }
                        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                        let document = text.hasPrefix("<") ? text : Subtitles.extractTtmlFromMp4(data)
                        let parsed = track.textFormat == "vtt" ? Subtitles.parseVtt(text) : document.map(Subtitles.parseTtml) ?? []
                        schedule.complete(number, cues: parsed)
                    }
                    self?.cues = CueTrack(schedule.cues())
                    let delay = manifest.isLive ? min(max(template.segmentSeconds, 1), 10) : 1
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1e9))
                }
            }
        } else if let url = track.textUrl {
            subtitleTask = Task { @MainActor [weak self] in
                guard let text = try? await loader.text(url, maxBytes: Subtitles.maxDocumentChars), !Task.isCancelled else { return }
                self?.cues = CueTrack(track.textFormat == "vtt" ? Subtitles.parseVtt(text) : Subtitles.parseTtml(text))
            }
        }
    }

    func setVolume(_ value: Float) {
        volume = min(max(value, 0), 1)
        playerOwner.setVolume(volume)
    }

    func resumeAfterSystemPause() {
        playerOwner.resumeAfterSystemPause()
        suspendedBySystem = false
    }

    func closeWebPlayer() {
        webPlayerUrl = nil
        intent = nil
        selected = nil
        if companions.isEmpty { stopTicker() }
    }

    func attachCompanion(_ sink: CompanionSink) {
        companions[ObjectIdentifier(sink)] = sink
        feed.reset()
        startTicker()
    }

    func detachCompanion(_ sink: CompanionSink) {
        companions.removeValue(forKey: ObjectIdentifier(sink))
    }

    func seedCompanion(_ sink: CompanionSink) {
        if case .web(let page) = content { sink.deliver(CompanionProtocol.initMessage(contentId: page.url)) }
        else { sink.deliver(CompanionProtocol.initMessage(contentId: nil)) }
        if let envelope = lastPositionEnvelope ?? positionEnvelope() { sink.deliver(envelope) }
        session?.retainedAppMessages.forEach { sink.deliver(CompanionProtocol.appMessage(rawMessage: $0.raw)) }
    }

    func onCompanionMessage(_ inbound: CompanionProtocol.Inbound) {
        switch inbound {
        case .appMessage(let type, let id, let payload): session?.sendAppMessage(type: type, payload: payload, id: id)
        case .syncAck: diagnostics.log("companion", "sync-ack")
        }
    }

    private func reconcileMode() {
        let effective = ModeSelection.effective(preferred: preferredMode, availability: availability)
        if effective == sessionMode && (effective == nil || session != nil) { return }
        startSession(effective)
    }

    private func startSession(_ mode: SyncMode?) {
        session?.stop()
        session = nil
        sessionMode = mode
        effectiveMode = mode
        snapshot = nil
        guard let terminal = terminal, let mode = mode else { return }
        let created = MediaSyncSession(transport: transport, clock: monotonicNanos, tuning: tuning)
        created.onSnapshot = { [weak self, weak created] snapshot in
            guard let self = self, self.session === created else { return }
            self.snapshot = snapshot
        }
        created.onContentChanged = { [weak self, weak created] _, contentId in
            guard let self = self, self.session === created else { return }
            self.handleContent(contentId)
        }
        created.onTimelineChanged = { [weak self, weak created] _ in
            guard let self = self, self.session === created else { return }
            self.tick()
        }
        created.onAppMessage = { [weak self, weak created] _, message in
            guard let self = self, self.session === created else { return }
            let envelope = CompanionProtocol.appMessage(rawMessage: message.raw)
            self.companions.values.forEach { $0.deliver(envelope) }
        }
        session = created
        diagnostics.log("session", "start", ["mode": mode.rawValue])
        created.start(MediaSyncSession.Config(mode: mode, interDevSyncUrl: terminal.application?.interDeviceSyncUrl,
            app2appUrl: terminal.application?.app2AppUrl,
            realHost: Endpoints.realHost(terminal.device.location, terminal.device.applicationUrl),
            timelineSelector: Self.timelineSelector))
    }

    private func handleContent(_ contentId: String?) {
        contentTask?.cancel()
        selectSubtitle(nil)
        var hadWeb = false
        if case .web = content { hadWeb = true }
        let resolved = ContentClassifier.resolve(contentId, brandFallback: BrandConfig.defaultContentUrl)
        let kind = ContentClassifier.classify(resolved)
        diagnostics.log("content", "changed", ["kind": kind.rawValue])
        webGone = hadWeb && kind != .web
        switch kind {
        case .none:
            stopPlayback()
            content = .none
        case .unsupported:
            stopPlayback()
            content = .failed(.format)
        case .web:
            intent = nil
            stopPlayback()
            let url = resolved!
            content = .web(WebPage(url: url, title: nil))
            let requested = generation
            contentTask = Task { @MainActor [weak self] in
                guard let metadata = await self?.loader.webMetadata(url), let self = self, requested == self.generation,
                      case .web(let page) = self.content, page.url == url else { return }
                self.content = .web(WebPage(url: url, title: metadata.title))
            }
        case .dash, .hls:
            content = .loading
            let url = resolved!
            let requested = generation
            contentTask = Task { @MainActor [weak self] in
                guard let self = self else { return }
                let manifest = try? await self.loader.manifest(url, kind: kind)
                guard requested == self.generation, !Task.isCancelled else { return }
                guard let manifest = manifest else {
                    self.stopPlayback()
                    self.content = .failed(.manifest)
                    return
                }
                if manifest.isProtected {
                    self.stopPlayback()
                    self.content = .failed(.protected)
                    return
                }
                self.content = .media(manifest, kind)
                if let resume = self.intent?.match(manifest.tracks.filter { $0.kind != .text && !$0.isProtected }) {
                    self.startTrack(manifest, kind, resume)
                } else {
                    self.stopPlayback()
                }
                await self.refreshCatalog(manifest, kind: kind, requested: requested)
            }
        }
    }

    private func startTrack(_ manifest: MediaManifest, _ kind: ContentKind, _ track: MediaTrack) {
        corrector.reset()
        playerFailed = false
        playerRetrying = false
        suspendedBySystem = false
        selected = track
        if kind == .dash {
            // AVPlayer cannot play MPEG-DASH: the brand web player follows the TV through the companion protocol.
            playerOwner.stop()
            guard let base = BrandConfig.syncWebPlayerUrl else {
                content = .failed(.format)
                return
            }
            let sameKind = manifest.tracks.filter { $0.kind == track.kind }
            webPlayerUrl = CompanionProtocol.webPlayerUrl(base: base, mpdUrl: manifest.url, audio: track.kind == .audio, track: track,
                trackIndex: sameKind.firstIndex(of: track) ?? -1, volume: Double(volume), isLive: manifest.isLive, tuning: tuning, telemetry: false)
            diagnostics.log("player", "web", ["kind": track.kind.rawValue])
        } else {
            webPlayerUrl = nil
            playerOwner.play(url: manifest.url, track: track, startPositionS: session?.position()?.seconds, isLive: manifest.isLive, volume: volume)
            playerOwner.selectSubtitle(subtitle)
            diagnostics.log("player", "start", ["kind": track.kind.rawValue, "live": manifest.isLive])
        }
        startTicker()
    }

    @MainActor private func refreshCatalog(_ initial: MediaManifest, kind: ContentKind, requested: Int) async {
        var current = initial
        while let interval = current.refreshDelayMs {
            do { try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000) }
            catch { return }
            let refreshed = try? await loader.manifest(current.url, kind: kind)
            guard !Task.isCancelled, requested == generation else { return }
            guard let refreshed = refreshed, !refreshed.isProtected else {
                selectSubtitle(nil)
                stopPlayback()
                content = .failed(refreshed?.isProtected == true ? .protected : .manifest)
                return
            }
            let nextTrack = refreshed.refreshedTrack(selected)
            let nextText = refreshed.refreshedTrack(subtitle)
            current = refreshed
            content = .media(refreshed, kind)
            selected = nextTrack
            if nextTrack == nil && (playerOwner.isActive || webPlayerUrl != nil) { stopPlayback() }
            if nextText != subtitle { selectSubtitle(nextText) }
        }
    }

    private func stopPlayback() {
        playerOwner.stop()
        corrector.reset()
        selected = nil
        webPlayerUrl = nil
        status = .waiting
        rate = 1
        playerRetrying = false
    }

    private func positionEnvelope() -> String? {
        guard let position = session?.position() else { return nil }
        var manifest: MediaManifest?
        if case .media(let value, _) = content { manifest = value }
        return CompanionProtocol.position(CompanionProtocol.Position(positionSeconds: position.seconds, isPlaying: position.isPlaying,
            speed: position.speed, isLive: manifest?.isLive == true, liveEpochSeconds: liveEpoch(manifest, position.seconds),
            generatedAtMs: Int64(Date().timeIntervalSince1970 * 1000)))
    }

    private func liveEpoch(_ manifest: MediaManifest?, _ positionS: Double) -> Double? {
        guard let manifest = manifest, manifest.isLive, let start = manifest.availabilityStartTimeMs else { return nil }
        return Double(start) / 1000 + positionS
    }

    private func tick() {
        let position = session?.position()
        let nowMs = Int64(ProcessInfo.processInfo.systemUptime * 1000)
        if playerOwner.isActive, let mode = sessionMode, case .media(let manifest, _) = content {
            if playerOwner.suspendedBySystem {
                status = .paused
            } else {
                let tv = position.map { PlaybackCorrector.Tv(positionS: $0.seconds, liveEpochS: liveEpoch(manifest, $0.seconds),
                                                             isPlaying: $0.isPlaying, reliable: $0.reliable) }
                let sample = PlaybackCorrector.Player(mediaTimeS: playerOwner.positionS, liveEpochS: playerOwner.liveEpochS,
                                                      isPlaying: playerOwner.wantsToPlay, isBuffering: playerOwner.isBuffering, rate: playerOwner.rate)
                let result = corrector.update(nowMs: nowMs, tv: tv, player: sample, mode: mode, isLive: manifest.isLive)
                result.commands.forEach(playerOwner.apply)
                status = result.status
                if Date().timeIntervalSince(lastSyncLog) >= 1 {
                    lastSyncLog = Date()
                    let drift: Any = result.filteredDriftMs.map { $0 as Any } ?? NSNull()
                    let dispersion: Any = position.map { Int($0.uncertaintyMs) as Any } ?? NSNull()
                    diagnostics.log("sync", "tick", ["st": result.status.rawValue, "fdMs": drift,
                        "rate": result.rate, "wcMs": dispersion, "mode": mode.rawValue])
                }
            }
        }
        if !companions.isEmpty, let position = position,
           feed.shouldSend(nowMs: nowMs, isPlaying: position.isPlaying, speed: position.speed), let envelope = positionEnvelope() {
            lastPositionEnvelope = envelope
            companions.values.forEach { $0.deliver(envelope) }
        }
        if subtitle == nil || position == nil {
            subtitleText = nil
        } else if case .media(_, .hls) = content {
            subtitleText = playerOwner.subtitleText
        } else {
            subtitleText = cues.activeText(position?.seconds)
        }
        positionS = position?.seconds
        rate = playerOwner.rate
        suspendedBySystem = playerOwner.suspendedBySystem
        if !playerOwner.isActive && companions.isEmpty && webPlayerUrl == nil && subtitle == nil { stopTicker() }
    }

    private func startTicker() {
        guard ticker == nil else { return }
        let timer = Timer(timeInterval: Double(tuning.progressIntervalMs) / 1000, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }
}

/// Versioned preferences: only the per-model sync mode; nothing survives as session state.
enum Preferences {
    private static let store = UserDefaults.standard
    private static let schemaKey = "mediasync.schema"
    private static let schema = 1

    static func mode(_ key: String) -> SyncMode {
        migrateIfNeeded()
        return store.string(forKey: key).flatMap(SyncMode.init(rawValue:)) ?? .defaultMode
    }

    static func setMode(_ mode: SyncMode, key: String) { store.set(mode.rawValue, forKey: key) }

    /// Imports the React Native AsyncStorage modes once (same bundle id), PRD-014-R04.
    private static func migrateIfNeeded() {
        guard store.integer(forKey: schemaKey) < schema else { return }
        defer { store.set(schema, forKey: schemaKey) }
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
              let bundle = Bundle.main.bundleIdentifier else { return }
        let manifest = support.appendingPathComponent(bundle).appendingPathComponent("RCTAsyncLocalStorage_V1/manifest.json")
        guard let data = try? Data(contentsOf: manifest), data.count < 1_048_576,
              let entries = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        for (key, value) in entries where key.hasPrefix("@universal-mediasync/mode/v1/") && key.count <= 512 {
            if let mode = (value as? String).flatMap(SyncMode.init(rawValue:)), store.string(forKey: key) == nil {
                store.set(mode.rawValue, forKey: key)
            }
        }
    }
}
