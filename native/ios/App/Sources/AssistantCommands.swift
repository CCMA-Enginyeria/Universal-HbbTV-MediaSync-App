import Foundation
import MediaSyncCore

/**
 * Assistant-facing facade (Siri, Shortcuts, Spotlight) over discovery and the session. It drives
 * the same models as the UI, so a voice command and a tap have the same effect, and it never
 * keeps state of its own. Commands wait a bounded time for the models (an assistant expects an
 * answer in seconds) and reply with localized text. Main thread only, like the models.
 */
@MainActor
final class AssistantCommands {
    static let shared = AssistantCommands(model: AppModel.shared)

    /// A discovered TV as the assistant shows it; `id` is the stable device identity.
    struct Tv: Equatable {
        let id: String
        let name: String
        let model: String?
        let syncCapable: Bool
    }

    enum Failure: Error {
        case noNetwork, permission, noTvs, noCompatibleTvs, tvNotFound, noSync, noModes

        var message: String {
            switch self {
            case .noNetwork: return L10n.t("native.discovery.noNetwork")
            case .permission: return L10n.t("native.discovery.permissionMessage")
            case .noTvs: return L10n.t("native.assistant.tvs.none")
            case .noCompatibleTvs: return L10n.t("native.assistant.tvs.noneCompatible")
            case .tvNotFound: return L10n.t("native.assistant.errors.tvNotFound")
            case .noSync: return L10n.t("native.discovery.noSyncSupport")
            case .noModes: return L10n.t("native.terminal.noModes")
            }
        }
    }

    /// Upper bound for collecting scan results; the scan itself keeps running for the UI.
    static let discoveryWaitS = 4.0
    /// Upper bound for the probes and the DVB-CSS session to reach a stable state.
    static let connectWaitS = 10.0
    /// Upper bound for the TV's content (and its manifest) after connecting.
    static let contentWaitS = 10.0
    private static let pollNs: UInt64 = 200_000_000

    private let model: AppModel
    private var discovery: DiscoveryModel { model.discovery }
    private var session: SessionModel { model.session }

    init(model: AppModel) {
        self.model = model
    }

    /// The open TV, which commands without an explicit TV apply to.
    var currentTvId: String? { session.terminal?.device.id }

    /// TVs on the local network. Running or recent scan results are reused unless `refresh`.
    func tvs(refresh: Bool = false) async throws -> [Tv] {
        if discovery.phase != .searching && (refresh || discovery.terminals.isEmpty) { discovery.start() }
        if discovery.phase == .searching || discovery.problem == .noNetwork {
            // Right after launch the path monitor has not reported yet; discovery restarts once it does.
            _ = await waitUntil(Self.discoveryWaitS) { self.discovery.phase == .finished && self.discovery.problem != .noNetwork }
        }
        model.diagnostics.log("assistant", "tvs", ["found": discovery.terminals.count])
        if discovery.terminals.isEmpty {
            switch discovery.problem {
            case .noNetwork: throw Failure.noNetwork
            case .permission: throw Failure.permission
            default: break
            }
        }
        return discovery.terminals.map(Self.tv)
    }

    /// The TVs that offer synchronization; fails when there is none to choose from.
    func compatibleTvs() async throws -> [Tv] {
        let all = try await tvs()
        let capable = all.filter(\.syncCapable)
        if capable.isEmpty { throw all.isEmpty ? Failure.noTvs : Failure.noCompatibleTvs }
        return capable
    }

    func tv(_ id: String) async -> Tv? {
        await terminal(id).map(Self.tv)
    }

    /// Spoken summary of a scan: the TVs that can be synchronized, or why there are none.
    func tvsSummary(_ tvs: [Tv]) -> String {
        let capable = tvs.filter(\.syncCapable)
        if capable.isEmpty { return (tvs.isEmpty ? Failure.noTvs : Failure.noCompatibleTvs).message }
        return L10n.t("native.assistant.tvs.found", ListFormatter.localizedString(byJoining: capable.map(\.name)))
    }

    /// Which TV is open, its synchronization state, what plays and which companion pages it offers.
    func status() -> String {
        guard let terminal = session.terminal else { return L10n.t("native.assistant.status.idle") }
        var parts = [L10n.t("native.assistant.status.connected", Self.name(terminal))]
        if !terminal.supportsMediaSync {
            parts.append(L10n.t("native.discovery.noSyncSupport"))
        } else if session.noModes {
            parts.append(L10n.t("native.terminal.noModes"))
        } else if session.snapshot == nil && session.probing {
            parts.append(L10n.t("native.terminal.probing"))
        } else if let state = Labels.session(session.snapshot) {
            parts.append(state)
        }
        if let track = session.audio ?? session.video {
            parts.append(L10n.t("native.assistant.status.listening", Labels.title(track)))
        }
        for page in session.webPages {
            parts.append(L10n.t("native.assistant.status.webPage", page.title ?? L10n.t("discovery.webAvailableTitle")))
        }
        return parts.joined(separator: " ")
    }

    /// Opens the TV (as tapping it in the list does) and waits for the session to settle.
    func connect(_ id: String, mode: SyncMode? = nil) async throws -> String {
        let terminal = try await open(id, mode: mode)
        let settled = await waitUntil(Self.connectWaitS) { self.isConnected || self.session.noModes }
        if session.noModes { throw Failure.noModes }
        let name = Self.name(session.terminal ?? terminal)
        return settled ? L10n.t("native.assistant.status.connected", name) : L10n.t("native.assistant.connect.pending", name)
    }

    /// Something to look at: a video track of the programme or a page it offers.
    struct Visual: Equatable {
        let id: String
        let title: String
    }

    /// Opens the TV and waits for its content; the audio tracks this device can play, in manifest order.
    func audioTracks(_ id: String) async throws -> [MediaTrack] {
        _ = try await openContent(id)
        return playableAudio
    }

    /// Opens the TV and waits for its content; what there is to watch.
    func visuals(_ id: String) async throws -> [Visual] {
        _ = try await openContent(id)
        return visuals
    }

    /// Video tracks this device can play, then the pages the content offers.
    var visuals: [Visual] {
        var items: [Visual] = []
        if case .media(let manifest, _) = session.content {
            items += manifest.tracks.filter { $0.kind == .video && !$0.isProtected }.map { Visual(id: "video:\($0.id)", title: Labels.title($0)) }
        }
        return items + session.webPages.map { Visual(id: "page:\($0.url)", title: Self.title($0)) }
    }

    /// Spoken question that lists what there is to watch.
    func visualChoice(_ items: [Visual]) -> String {
        L10n.t("native.assistant.watch.choose", ListFormatter.localizedString(byJoining: items.map(\.title)))
    }

    /// Opens the TV and tells which audio, video, subtitles and pages its programme offers.
    func contentSummary(_ id: String) async throws -> String {
        let name = try await openContent(id)
        var groups: [String] = []
        if case .media(let manifest, _) = session.content {
            let playable = manifest.tracks.filter { !$0.isProtected }
            for (kind, key) in [(TrackKind.audio, "audio"), (.video, "video"), (.text, "subtitles")] {
                let titles = playable.filter { $0.kind == kind }.map(Labels.title)
                if !titles.isEmpty {
                    groups.append(L10n.t("native.assistant.content.\(key)", ListFormatter.localizedString(byJoining: titles)))
                }
            }
        }
        groups += session.webPages.map { L10n.t("native.assistant.content.page", Self.title($0)) }
        if !groups.isEmpty { return L10n.t("native.assistant.content.available", name, groups.joined(separator: "; ")) }
        return contentSettled ? L10n.t("native.assistant.content.none", name) : pending(name)
    }

    /// Opens the TV and shows `visualId`, or else the first video or page.
    func watch(_ id: String, visualId: String? = nil) async throws -> String {
        let name = try await openContent(id)
        let items = visuals
        guard let item = visualId.flatMap({ wanted in items.first { $0.id == wanted } }) ?? items.first else {
            return contentSettled ? L10n.t("native.assistant.watch.none", name) : pending(name)
        }
        if item.id.hasPrefix("page:") {
            model.webPageRequest = String(item.id.dropFirst("page:".count))
        } else if case .media(let manifest, _) = session.content,
                  let track = manifest.tracks.first(where: { "video:\($0.id)" == item.id }), session.video != track {
            session.toggle(track)
        }
        model.diagnostics.log("assistant", "watch", ["page": item.id.hasPrefix("page:")])
        return L10n.t("native.assistant.watch.showing", item.title)
    }

    /// Audio tracks of the open content that this device can play.
    var playableAudio: [MediaTrack] {
        guard case .media(let manifest, _) = session.content else { return [] }
        return manifest.tracks.filter { $0.kind == .audio && !$0.isProtected }
    }

    /// Spoken question that lists the audio tracks to choose from.
    func audioChoice(_ tracks: [MediaTrack]) -> String {
        L10n.t("native.assistant.listen.choose", ListFormatter.localizedString(byJoining: tracks.map(Labels.title)))
    }

    /**
     * Opens the TV and checks `trackId`, or else the audio track that best matches the user's
     * languages. With `described` it switches to audio description, and leaves playback alone
     * when there is none.
     */
    func listen(_ id: String, described: Bool = false, trackId: String? = nil) async throws -> String {
        let name = try await openContent(id)
        switch session.content {
        case .media(let manifest, _):
            let chosen = trackId.flatMap { id in playableAudio.first { $0.id == id } }
            let current = session.audio.flatMap { !described || $0.audioDescription || $0.role == "description" ? $0 : nil }
            let track = chosen ?? current ?? AudioPreference.pick(manifest.tracks, languages: Locale.preferredLanguages, described: described)
            guard let audio = track else {
                return described ? L10n.t("native.assistant.audioDescription.none", name) : L10n.t("native.assistant.listen.noAudio")
            }
            if session.audio != audio { session.toggle(audio) }
            model.diagnostics.log("assistant", "listen", ["playing": true, "described": described])
            return L10n.t("native.assistant.listen.playing", name, Labels.title(audio))
        case .failed:
            return L10n.t("native.assistant.listen.noAudio")
        case .web(let page):
            return L10n.t("native.assistant.status.webPage", Self.title(page))
        case .none, .loading:
            return pending(name)
        }
    }

    /// Unchecks the audio track; a checked video keeps playing.
    func stopAudio() -> String {
        guard let audio = session.audio else { return L10n.t("native.assistant.stopAudio.idle") }
        session.toggle(audio)
        model.diagnostics.log("assistant", "stop-audio")
        return L10n.t("native.assistant.stopAudio.done")
    }

    /// Stops everything playing and disconnects from the TV.
    func stop() -> String {
        session.stop()
        model.diagnostics.log("assistant", "stop")
        return L10n.t("native.assistant.stop.done")
    }

    // MARK: - Internals

    private var isConnected: Bool {
        guard let state = session.snapshot?.state else { return false }
        return state == .waitingContent || state == .synchronising || state == .synchronised
    }

    private var contentSettled: Bool {
        switch session.content {
        case .media, .web, .failed: return true
        case .none, .loading: return false
        }
    }

    /// Opens the TV and waits for its content to settle; the TV's name.
    private func openContent(_ id: String) async throws -> String {
        let terminal = try await open(id, mode: nil)
        _ = await waitUntil(Self.connectWaitS + Self.contentWaitS) { self.contentSettled || self.session.noModes }
        if session.noModes { throw Failure.noModes }
        return Self.name(session.terminal ?? terminal)
    }

    /// Reply while the TV has no content yet: connected and waiting, or still connecting.
    private func pending(_ name: String) -> String {
        isConnected ? L10n.t("native.assistant.listen.noContent", name) : L10n.t("native.assistant.connect.pending", name)
    }

    private static func title(_ page: SessionModel.WebPage) -> String {
        page.title ?? L10n.t("discovery.webAvailableTitle")
    }

    private func open(_ id: String, mode: SyncMode?) async throws -> DialTerminal {
        guard let terminal = await terminal(id) else { throw Failure.tvNotFound }
        guard terminal.supportsMediaSync else { throw Failure.noSync }
        if session.terminal?.device.id != terminal.device.id { session.select(terminal) }
        if let mode = mode { session.setPreferredMode(mode) }
        model.showsTerminalRequest = true
        model.diagnostics.log("assistant", "open", ["mode": mode?.rawValue ?? "preferred"])
        return terminal
    }

    /// The open TV or a discovered one; waits for a scan when the TV is not known yet.
    private func terminal(_ id: String) async -> DialTerminal? {
        if let known = lookup(id) { return known }
        if discovery.phase != .searching { discovery.start() }
        _ = await waitUntil(Self.discoveryWaitS) { self.lookup(id) != nil }
        return lookup(id)
    }

    private func lookup(_ id: String) -> DialTerminal? {
        if let open = session.terminal, open.device.id == id { return open }
        return discovery.terminals.first { $0.device.id == id }
    }

    /// Polls `condition` on the main actor; true when it held before `timeout` seconds.
    private func waitUntil(_ timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() >= deadline || Task.isCancelled { return false }
            try? await Task.sleep(nanoseconds: Self.pollNs)
        }
        return true
    }

    private static func name(_ terminal: DialTerminal) -> String {
        terminal.device.friendlyName ?? L10n.t("native.discovery.unnamedTv")
    }

    private static func tv(_ terminal: DialTerminal) -> Tv {
        let model = [terminal.device.manufacturer, terminal.device.modelName].compactMap { $0 }.joined(separator: " ")
        return Tv(id: terminal.device.id, name: name(terminal), model: model.isEmpty ? nil : model,
                  syncCapable: terminal.supportsMediaSync)
    }
}
