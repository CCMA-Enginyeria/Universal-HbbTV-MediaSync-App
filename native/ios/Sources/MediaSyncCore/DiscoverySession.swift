public final class DiscoverySession {
    public final class Request: @unchecked Sendable {
        public let location: String
        fileprivate init(_ location: String) { self.location = location }
    }

    private let allowNonHbbtvDevices: Bool
    private var pending: [String: Request] = [:]
    public private(set) var terminals: [DialTerminal] = []
    public private(set) var isRunning = false

    public init(allowNonHbbtvDevices: Bool = false) {
        self.allowNonHbbtvDevices = allowNonHbbtvDevices
    }

    public func start() {
        pending.removeAll()
        terminals.removeAll()
        isRunning = true
    }

    public func stop() {
        isRunning = false
        pending.removeAll()
        terminals.removeAll()
    }

    public func finish() {
        isRunning = false
        pending.removeAll()
    }

    public func accept(_ message: String) -> Request? {
        guard isRunning, let location = DialProtocol.parseResponse(message),
              pending[location] == nil, !terminals.contains(where: { $0.device.location == location })
        else { return nil }
        let request = Request(location)
        pending[location] = request
        return request
    }

    @discardableResult
    public func complete(_ request: Request, terminal: DialTerminal?) -> Bool {
        guard isRunning, pending[request.location] === request else { return false }
        pending.removeValue(forKey: request.location)
        guard let terminal = terminal, terminal.device.location == request.location,
              allowNonHbbtvDevices || terminal.supportsHbbtv else { return false }
        terminals.append(terminal)
        return true
    }
}