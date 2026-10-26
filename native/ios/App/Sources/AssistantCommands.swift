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

    /// Opens the TV and checks the audio track that best matches the user's languages.
    func listen(_ id: String) async throws -> String {
        let terminal = try await open(id, mode: nil)
        _ = await waitUntil(Self.connectWaitS + Self.contentWaitS) { self.contentSettled || self.session.noModes }
        if session.noModes { throw Failure.noModes }
        let name = Self.name(session.terminal ?? terminal)
        switch session.content {
        case .media(let manifest, _):
            let track = session.audio ?? AudioPreference.pick(manifest.tracks, languages: Locale.preferredLanguages)
            guard let audio = track else { return L10n.t("native.assistant.listen.noAudio") }
            if session.audio != audio { session.toggle(audio) }
            model.diagnostics.log("assistant", "listen", ["playing": true])
            return L10n.t("native.assistant.listen.playing", name, Labels.title(audio))
        case .failed:
            return L10n.t("native.assistant.listen.noAudio")
        case .web(let page):
            return L10n.t("native.assistant.status.webPage", page.title ?? L10n.t("discovery.webAvailableTitle"))
        case .none, .loading:
            return isConnected ? L10n.t("native.assistant.listen.noContent", name) : L10n.t("native.assistant.connect.pending", name)
        }
    }

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
