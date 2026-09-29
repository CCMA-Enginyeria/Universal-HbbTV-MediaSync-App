import Foundation

public enum Availability: String { case unknown, checking, available, unavailable }

/// Confirms a transport exposes a real CII with usable WC/TS endpoints, without starting WC/TS.
public final class TransportProbe: TransportEvents {
    public let mode: SyncMode
    private let transport: Transport
    private let interDevSyncUrl: String?
    private let app2appUrl: String?
    private let realHost: String?
    private let compatPrefix: String
    private let timeoutMs: Int64
    private let onResult: (Bool) -> Void
    private var socket: Int64?
    private var timer: Int64?
    private var settled = false
    private let tracker = CiiTracker()

    public init(transport: Transport, mode: SyncMode, interDevSyncUrl: String?, app2appUrl: String?, realHost: String?,
                compatPrefix: String = Endpoints.defaultCompatPrefix, timeoutMs: Int64 = 2_000, onResult: @escaping (Bool) -> Void) {
        self.transport = transport
        self.mode = mode
        self.interDevSyncUrl = interDevSyncUrl
        self.app2appUrl = app2appUrl
        self.realHost = realHost
        self.compatPrefix = compatPrefix
        self.timeoutMs = timeoutMs
        self.onResult = onResult
    }

    public func start() {
        precondition(socket == nil && !settled, "A probe can only run once")
        let url = Endpoints.repair(Endpoints.ciiUrl(mode: mode, interDevSyncUrl: interDevSyncUrl, app2appUrl: app2appUrl,
                                                    prefix: compatPrefix), realHost: realHost)
        guard let target = url, Endpoints.isWebSocket(target) else {
            finish(false)
            return
        }
        let socketToken = Tokens.next()
        socket = socketToken
        transport.openWebSocket(socketToken, url: target, events: self)
        let timerToken = Tokens.next()
        timer = timerToken
        transport.schedule(timerToken, delayMs: timeoutMs, events: self)
    }

    /// Stops without reporting a result (terminal or mode abandoned).
    public func cancel() {
        settled = true
        release()
    }

    public func onText(_ token: Int64, _ text: String) {
        guard token == socket, let state = tracker.apply(text)?.state else { return }
        let wc = Endpoints.repair(state.wcUrl, realHost: realHost)
        let ts = Endpoints.repair(state.tsUrl, realHost: realHost)
        let usable: Bool
        switch mode {
        case .compat:
            usable = Endpoints.isCompatServiceUrl(wc, prefix: compatPrefix, service: "wc") &&
                Endpoints.isCompatServiceUrl(ts, prefix: compatPrefix, service: "ts")
        case .native:
            usable = Endpoints.parseUdp(wc) != nil && Endpoints.isWebSocket(ts)
        }
        if usable { finish(true) }
    }

    public func onClosed(_ token: Int64, failed: Bool) {
        guard token == socket else { return }
        socket = nil
        finish(false)
    }

    public func onTimer(_ token: Int64) {
        guard token == timer else { return }
        timer = nil
        finish(false)
    }

    private func finish(_ available: Bool) {
        guard !settled else { return }
        settled = true
        release()
        onResult(available)
    }

    private func release() {
        if let socket = socket { transport.close(socket) }
        if let timer = timer { transport.cancel(timer) }
        socket = nil
        timer = nil
    }
}

/// Mode rules shared by both apps (PRD-006-R03/R04).
public enum ModeSelection {
    public static func effective(preferred: SyncMode, availability: [SyncMode: Availability]) -> SyncMode? {
        let fallback: SyncMode = preferred == .native ? .compat : .native
        if availability[preferred] == .available { return preferred }
        if availability[preferred] == .unavailable && availability[fallback] == .available { return fallback }
        return nil
    }

    public static func available(_ availability: [SyncMode: Availability]) -> [SyncMode] {
        SyncMode.allCases.filter { availability[$0] == .available }
    }

    public static func allUnavailable(_ availability: [SyncMode: Availability]) -> Bool {
        SyncMode.allCases.allSatisfy { availability[$0] == .unavailable }
    }
}
