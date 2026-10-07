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
 * iOS cannot play MPEG-DASH natively, so DASH tracks use the brand web player,
 * docked at the bottom of the app like the native player.
 */
final class SessionModel: ObservableObject {
    struct WebPage: Equatable {
        let url: String
        let title: String?
        var language: String? = nil
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
    /// Audio and video the user checked; either can play without the other.
    @Published private(set) var audio: MediaTrack?
    @Published private(set) var video: MediaTrack?
    @Published private(set) var subtitle: MediaTrack?
    @Published private(set) var subtitleText: String?
    @Published private(set) var status = PlaybackCorrector.Status.waiting
    @Published private(set) var rate = 1.0
    @Published private(set) var positionS: Double?
    @Published private(set) var playerRetrying = false
    @Published private(set) var playerFailed = false
    @Published private(set) var suspendedBySystem = false
    @Published private(set) var webGone = false
    /// Companion page the user opened last; see `openWebPage`.
    @Published private(set) var webUrl: String?
    @Published private(set) var webPlayerUrl: String?
    @Published private(set) var volume: Float = 1

    var availableModes: [SyncMode] { ModeSelection.available(availability) }
    var probing: Bool { availability.values.contains(.checking) }
    var noModes: Bool { ModeSelection.allUnavailable(availability) }
    var isActive: Bool { audio != nil || video != nil }
    /// True when `PlayerDock` has something to show: checked audio/video or subtitles of the current content.
    var hasDock: Bool {
        if case .media = content { return isActive || subtitle != nil }
        return false
    }

    /// Pages the current content offers: a web content ID or the applications announced by the manifest.
    var webPages: [WebPage] {
        switch content {
        case .web(let page): return [page]
        case .media(let manifest, _): return manifest.applications.map { WebPage(url: $0.url, title: $0.name, language: $0.language) }
        default: return []
        }
    }

    /// The opened page while the content still offers it. A sole page follows URL changes, so a
    /// web -> web content change reloads it; nil means the page is gone.
    var openWebPage: WebPage? {
        guard let opened = webUrl else { return nil }
        let pages = webPages
        return pages.first { $0.url == opened } ?? (pages.count == 1 ? pages[0] : nil)
    }

    func openWeb(_ url: String) {
        if webPages.contains(where: { $0.url == url }) { webUrl = url }
    }

    let playerOwner = PlayerOwner()
    private let transport: AppleTransport
    private let loader: ContentLoader
    private let diagnostics: Diagnostics
    private let tuning = SyncTuning()
    private let corrector: PlaybackCorrector
    private let feed = CompanionFeedThrottle()
    private var generation = 0
    private var probes: [TransportProbe] = []
    /// The terminal as picked from the discovery list; `terminal` holds it with refreshed endpoints.
    private var selected: DialTerminal?
    /// Re-read of the HbbTV application document that precedes every probe round.
    private var refreshTask: Task<Void, Never>?
    /// The running session was started with endpoints the TV no longer advertises.
    private var endpointsChanged = false
    /// Upper bound for re-reading the TV's HbbTV application document.
    private static let refreshTimeoutS = 3.0
    /// Minimum time a manual retry shows the check in progress.
    private static let retryFeedbackS = 0.8
    /// True while availability is re-checked for a running session that lost the TV.
    private var reprobing = false
    private var reprobeTimer: Timer?
    private var reprobeCount = 0
    /// Pause between availability re-checks while the active session keeps recovering.
    private static let reprobeIntervalS = 5.0
    private var session: MediaSyncSession?
    private var sessionMode: SyncMode?
    private var contentTask: Task<Void, Never>?
    private var subtitleTask: Task<Void, Never>?
    private var cues = CueTrack()
    /// What the user checked, kept across content gaps so the same role/language resumes.
    private var audioIntent: PlaybackIntent?
    private var videoIntent: PlaybackIntent?
    private var wantsPlayback: Bool { audioIntent != nil || videoIntent != nil }
    private var companions: [ObjectIdentifier: CompanionSink] = [:]
    private var lastPositionEnvelope: String?
    private var ticker: Timer?
    private var lastSyncLog = Date.distantPast
    /// Background time requested while playback waits for the programme to resume (content gap).
    private var gapTask = UIBackgroundTaskIdentifier.invalid
    private var gapExpiry: DispatchWorkItem?
    /// Upper bound for holding the audio session without audio, also in the foreground.
    private static let gapHoldS = 60.0

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

    func select(_ terminal: DialTerminal) { open(terminal, feedback: 0) }

    private func open(_ terminal: DialTerminal, feedback: TimeInterval) {
        guard self.terminal == nil || selected != terminal else { return }
        stop()
        selected = terminal
        generation += 1
        self.terminal = terminal
        preferredMode = Preferences.mode(key(terminal))
        availability = [.native: .checking, .compat: .checking]
        diagnostics.log("session", "select", ["generation": generation, "hbbtv": terminal.supportsHbbtv])
        guard terminal.supportsMediaSync else {
            availability = [.native: .unavailable, .compat: .unavailable]
            return
        }
        startProbes(terminal, feedback: feedback)
    }

    /**
     * Re-reads the TV's HbbTV application document, then probes both transports. A TV
     * reopens App2App and CSS-CII on new ports whenever its HbbTV application restarts, so
     * the URLs found by discovery go stale; a failed read keeps the known ones.
     */
    private func startProbes(_ terminal: DialTerminal, feedback: TimeInterval = 0) {
        probes.forEach { $0.cancel() }
        probes.removeAll()
        refreshTask?.cancel()
        let current = generation
        refreshTask = Task { @MainActor [weak self] in
            let started = Date()
            let fresh = await DialDiscoveryScan.fetchApplication(terminal.device, timeout: Self.refreshTimeoutS)
            let remaining = feedback - Date().timeIntervalSince(started)
            if remaining > 0 { try? await Task.sleep(nanoseconds: UInt64(remaining * 1e9)) }
            guard let self = self, !Task.isCancelled, current == self.generation else { return }
            self.refreshTask = nil
            guard let latest = self.terminal else { return }
            let changed = fresh != nil && fresh != latest.application
            self.diagnostics.log("session", "refresh", ["read": fresh != nil, "changed": changed])
            if changed {
                self.endpointsChanged = self.session != nil
                self.terminal = DialTerminal(device: latest.device, application: fresh)
            }
            guard let target = self.terminal else { return }
            self.runProbes(target)
        }
    }

    /**
     * Probes both transports. The TV can switch stacks at any time (the emulator does so
     * on demand), so availability is re-checked while a session recovers or no stack is
     * available instead of only once on selection.
     */
    private func runProbes(_ terminal: DialTerminal) {
        let current = generation
        let realHost = Endpoints.realHost(terminal.device.location, terminal.device.applicationUrl)
        var pending = SyncMode.allCases.count
        for mode in SyncMode.allCases {
            let probe = TransportProbe(transport: transport, mode: mode, interDevSyncUrl: terminal.application?.interDeviceSyncUrl,
                                       app2appUrl: terminal.application?.app2AppUrl, realHost: realHost,
                                       timeoutMs: tuning.probeTimeoutMs) { [weak self] available in
                guard let self = self, current == self.generation else { return }
                self.diagnostics.log("session", "probe", ["mode": mode.rawValue, "available": available, "reprobe": self.reprobing])
                self.availability[mode] = available ? .available : .unavailable
                self.reconcileMode()
                pending -= 1
                if pending == 0 {
                    self.reprobing = false
                    self.watchConnection()
                }
            }
            probes.append(probe)
            probe.start()
        }
    }

    /// Whether the TV is worth re-checking: the session lost it, or it offered no stack at all.
    private var needsRecheck: Bool {
        terminal != nil && (snapshot?.state == .recovering || (session == nil && noModes))
    }

    /// Schedules a re-check while `needsRecheck` holds; cancels it otherwise.
    private func watchConnection() {
        guard needsRecheck else {
            reprobeTimer?.invalidate()
            reprobeTimer = nil
            reprobeCount = 0
            return
        }
        guard !reprobing, reprobeTimer == nil else { return }
        let current = generation
        // The first re-check waits one probe timeout so a brief drop can reconnect on its own.
        let delay = reprobeCount == 0 ? Double(tuning.probeTimeoutMs) / 1000 : Self.reprobeIntervalS
        reprobeCount += 1
        reprobeTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self = self, current == self.generation else { return }
            self.reprobeTimer = nil
            guard self.needsRecheck, let terminal = self.terminal else { return }
            self.diagnostics.log("session", "reprobe", ["mode": self.sessionMode?.rawValue ?? "none"])
            self.reprobing = true
            self.startProbes(terminal)
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

    /// Checks the TV again; the check stays visible for a moment so the tap has feedback.
    func retry() {
        guard let terminal = selected else { return }
        self.terminal = nil
        open(terminal, feedback: Self.retryFeedbackS)
    }

    func stop() {
        generation += 1
        probes.forEach { $0.cancel() }
        probes.removeAll()
        selected = nil
        refreshTask?.cancel()
        refreshTask = nil
        endpointsChanged = false
        reprobing = false
        reprobeTimer?.invalidate()
        reprobeTimer = nil
        reprobeCount = 0
        session?.stop()
        session = nil
        sessionMode = nil
        contentTask?.cancel()
        audioIntent = nil
        videoIntent = nil
        stopPlayback()
        lastPositionEnvelope = nil
        selectSubtitle(nil)
        companions.removeAll()
        stopTicker()
        terminal = nil
        availability = [.native: .unknown, .compat: .unknown]
        effectiveMode = nil
        snapshot = nil
        content = .none
        webGone = false
        webUrl = nil
        playerFailed = false
    }

    /// Checks or unchecks a component: one audio, one video and one subtitle track at most.
    /// Checking another track of the same kind replaces the previous one.
    func toggle(_ track: MediaTrack) {
        guard case .media(let manifest, let kind) = content else { return }
        switch track.kind {
        case .text:
            selectSubtitle(subtitle == track ? nil : track)
        case .audio, .video:
            let nextAudio = track.kind == .audio ? (audio == track ? nil : track) : audio
            let nextVideo = track.kind == .video ? (video == track ? nil : track) : video
            audioIntent = nextAudio.map { PlaybackIntent($0) }
            videoIntent = nextVideo.map { PlaybackIntent($0) }
            if nextAudio == nil && nextVideo == nil {
                stopPlayback()
            } else {
                startPlayback(manifest, kind, audio: nextAudio, video: nextVideo)
            }
        }
    }

    /// Unchecks every component of the current content.
    func stopAll() {
        audioIntent = nil
        videoIntent = nil
        stopPlayback()
        selectSubtitle(nil)
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
                                               availabilityStartTimeMs: manifest.availabilityStartTimeMs, representationId: track.representationId,
                                               lookahead: 2)
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
                    // Lookahead segments not published yet are retried soon, before the position reaches them.
                    let delay = manifest.isLive ? min(max(template.segmentSeconds / 3, 1), 2) : 1
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
        // The filter and cooldown describe the time before the interruption.
        corrector.reset()
        playerOwner.resumeAfterSystemPause()
        suspendedBySystem = false
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
        sink.deliver(CompanionProtocol.initMessage(contentId: openWebPage?.url))
        if let envelope = positionEnvelope() ?? lastPositionEnvelope { sink.deliver(envelope) }
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
        // A failed re-check keeps the current session retrying rather than tearing it down.
        if effective == nil && reprobing && session != nil { return }
        // New endpoints restart a session of the same mode, which would otherwise keep the stale URLs.
        if effective == sessionMode && (effective == nil || session != nil) && !(endpointsChanged && effective != nil) { return }
        startSession(effective)
    }

    private func startSession(_ mode: SyncMode?) {
        endpointsChanged = false
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
            self.watchConnection()
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
        let hadWeb = !webPages.isEmpty
        let resolved = ContentClassifier.resolve(contentId, brandFallback: BrandConfig.defaultContentUrl)
        let kind = ContentClassifier.classify(resolved)
        diagnostics.log("content", "changed", ["kind": kind.rawValue])
        // The previous content's position must not seed pages opened for the new one.
        lastPositionEnvelope = nil
        webGone = hadWeb && kind != .web && kind != .dash
        switch kind {
        case .none:
            stopPlayback()
            content = .none
        case .unsupported:
            stopPlayback()
            content = .failed(.format)
        case .web:
            audioIntent = nil
            videoIntent = nil
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
                let playable = manifest.tracks.filter { $0.kind != .text && !$0.isProtected }
                let audio = self.audioIntent?.match(playable)
                let video = self.videoIntent?.match(playable)
                if audio != nil || video != nil {
                    self.startPlayback(manifest, kind, audio: audio, video: video)
                } else {
                    self.stopPlayback()
                }
                await self.refreshCatalog(manifest, kind: kind, requested: requested)
            }
        }
    }

    private func startPlayback(_ manifest: MediaManifest, _ kind: ContentKind, audio: MediaTrack?, video: MediaTrack?) {
        let restart = !playerOwner.isActive
        if restart { corrector.reset() }
        playerFailed = false
        playerRetrying = false
        suspendedBySystem = false
        self.audio = audio
        self.video = video
        endGapHold(deactivate: false)
        if kind == .dash {
            // AVPlayer cannot play MPEG-DASH: the brand web player follows the TV through the companion protocol.
            guard let primary = video ?? audio else { return }
            playerOwner.stop(keepSession: true)
            playerOwner.activateForWebPlayback(video: video != nil)
            guard let base = BrandConfig.syncWebPlayerUrl else {
                content = .failed(.format)
                return
            }
            func index(_ track: MediaTrack?) -> Int {
                guard let track = track else { return -1 }
                return manifest.tracks.filter { $0.kind == track.kind }.firstIndex(of: track) ?? -1
            }
            // Video without a checked audio track plays muted, as in the native player.
            webPlayerUrl = CompanionProtocol.webPlayerUrl(base: base, mpdUrl: manifest.url, audio: video == nil, track: primary,
                trackIndex: index(primary), volume: audio == nil ? 0 : Double(volume), isLive: manifest.isLive, tuning: tuning, telemetry: false,
                audioTrack: video == nil ? nil : audio, audioTrackIndex: index(audio))
            diagnostics.log("player", "web", ["audio": audio != nil, "video": video != nil])
        } else {
            webPlayerUrl = nil
            playerOwner.play(url: manifest.url, audio: audio, video: video, startPositionS: session?.position()?.seconds,
                             isLive: manifest.isLive, volume: volume)
            if restart { playerOwner.selectSubtitle(subtitle) }
            diagnostics.log("player", "start", ["audio": audio != nil, "video": video != nil, "live": manifest.isLive])
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
            let previousAudio = audio, previousVideo = video
            let nextAudio = refreshed.refreshedTrack(previousAudio)
            let nextVideo = refreshed.refreshedTrack(previousVideo)
            let nextText = refreshed.refreshedTrack(subtitle)
            current = refreshed
            content = .media(refreshed, kind)
            audio = nextAudio
            video = nextVideo
            if nextAudio == nil && nextVideo == nil {
                if playerOwner.isActive || webPlayerUrl != nil { stopPlayback() }
            } else if (nextAudio == nil) != (previousAudio == nil) || (nextVideo == nil) != (previousVideo == nil) {
                // A component that disappeared must stop playing; a replaced one keeps playing as is.
                startPlayback(refreshed, kind, audio: nextAudio, video: nextVideo)
            }
            if nextText != subtitle { selectSubtitle(nextText) }
        }
    }

    private func stopPlayback() {
        if wantsPlayback {
            // Waiting for the programme to resume: keep the audio session and ask for background time,
            // since a deactivated session lets iOS suspend the app and its sockets.
            playerOwner.stop(keepSession: true)
            beginGapHold()
        } else {
            playerOwner.stop()
            endGapHold(deactivate: false)
        }
        corrector.reset()
        audio = nil
        video = nil
        webPlayerUrl = nil
        status = .waiting
        rate = 1
        playerRetrying = false
    }

    private func beginGapHold() {
        guard gapExpiry == nil else { return }
        gapTask = UIApplication.shared.beginBackgroundTask(withName: "mediasync.content-gap") { [weak self] in
            self?.endGapHold(deactivate: true)
        }
        let expiry = DispatchWorkItem { [weak self] in self?.endGapHold(deactivate: true) }
        gapExpiry = expiry
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.gapHoldS, execute: expiry)
        diagnostics.log("player", "gap-hold")
    }

    /// - Parameter deactivate: releases the held audio session when nothing is playing.
    private func endGapHold(deactivate: Bool) {
        gapExpiry?.cancel()
        gapExpiry = nil
        if deactivate && !playerOwner.isActive && webPlayerUrl == nil { playerOwner.deactivateSession() }
        if gapTask != .invalid {
            UIApplication.shared.endBackgroundTask(gapTask)
            gapTask = .invalid
        }
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
