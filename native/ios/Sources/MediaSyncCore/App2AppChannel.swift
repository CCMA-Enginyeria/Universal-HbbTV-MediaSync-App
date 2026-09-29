import Foundation

/// Bidirectional `<prefix>-app` App2App channel. Payloads are relayed verbatim. Serial, not thread-safe.
public final class App2AppChannel: TransportEvents {
    public struct Limits {
        public var maxInboundChars = 262_144
        public var maxOutboundChars = 65_536
        public var maxQueuedMessages = 32
        public var maxRetainedTypes = 32
        public var maxTypeLength = 128
        public var maxReconnectAttempts = 5
        public init() {}
    }

    public enum State: String { case closed, connecting, open, paired, recovering, failed }

    /// An application envelope; `raw` is the verbatim JSON object text.
    public struct Message {
        public let type: String
        public let id: String?
        public let retained: Bool
        public let raw: String
    }

    public static let version = 1
    public static let pairingFrame = "pairingcompleted"

    public static func url(app2appBase: String?, prefix: String) -> String? {
        Endpoints.compatUrl(app2appBase, prefix: prefix, service: "app")
    }

    public static func envelope(type: String, payload: Any?, id: String?) -> String {
        "{\"version\":\(version),\"type\":\(JsonInput.escape(type)),\"id\":\(id.map(JsonInput.escape) ?? "null"),\"payload\":\(JsonInput.serialize(payload))}"
    }

    public let url: String
    private let transport: Transport
    private let limits: Limits
    public var onState: ((State) -> Void)?
    public var onMessage: ((Message) -> Void)?
    public private(set) var state = State.closed
    private var socket: Int64?
    private var timer: Int64?
    private let backoff = Backoff(initialMs: 2_000, maxMs: 30_000)
    private var queue: [String] = []
    private var retainedMessages: [String: Message] = [:]
    private var retainedOrder: [String] = []
    public var retained: [Message] { retainedOrder.compactMap { retainedMessages[$0] } }

    public init(url: String, transport: Transport, limits: Limits = Limits()) {
        self.url = url
        self.transport = transport
        self.limits = limits
    }

    public func open() {
        guard state != .connecting, state != .open, state != .paired else { return }
        connect(.connecting)
    }

    public func close() {
        if let socket = socket { transport.close(socket) }
        if let timer = timer { transport.cancel(timer) }
        socket = nil
        timer = nil
        queue.removeAll()
        retainedMessages.removeAll()
        retainedOrder.removeAll()
        backoff.reset()
        setState(.closed)
    }

    @discardableResult
    public func send(type: String, payload: Any?, id: String?) -> Bool {
        guard !type.isEmpty, type.count <= limits.maxTypeLength, (id?.count ?? 0) <= 256,
              state != .closed, state != .failed else { return false }
        let text = App2AppChannel.envelope(type: type, payload: payload, id: id)
        guard text.count <= limits.maxOutboundChars else { return false }
        if state == .paired, let socket = socket, transport.sendText(socket, text) { return true }
        guard queue.count < limits.maxQueuedMessages else { return false }
        queue.append(text)
        return true
    }

    public func onOpened(_ token: Int64) {
        guard token == socket else { return }
        backoff.reset()
        setState(.open)
    }

    public func onText(_ token: Int64, _ text: String) {
        guard token == socket else { return }
        if text == App2AppChannel.pairingFrame {
            setState(.paired)
            while let first = queue.first, transport.sendText(token, first) { queue.removeFirst() }
            return
        }
        guard let message = parse(text) else { return }
        if message.retained, retainedMessages[message.type] != nil || retainedMessages.count < limits.maxRetainedTypes {
            if retainedMessages[message.type] == nil { retainedOrder.append(message.type) }
            retainedMessages[message.type] = message
        }
        onMessage?(message)
    }

    public func onClosed(_ token: Int64, failed: Bool) {
        guard token == socket else { return }
        socket = nil
        if backoff.attempts >= limits.maxReconnectAttempts {
            setState(.failed)
            return
        }
        setState(.recovering)
        let next = Tokens.next()
        timer = next
        transport.schedule(next, delayMs: backoff.nextDelayMs(), events: self)
    }

    public func onTimer(_ token: Int64) {
        guard token == timer else { return }
        timer = nil
        connect(.recovering)
    }

    public func parse(_ text: String) -> Message? {
        guard let json = JsonInput.parseObject(text, maxChars: limits.maxInboundChars),
              let type = JsonInput.string(json["type"]), !type.isEmpty, type.count <= limits.maxTypeLength else { return nil }
        let retained = (json["retained"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
        return Message(type: type, id: JsonInput.string(json["id"]), retained: retained, raw: text)
    }

    private func connect(_ next: State) {
        let token = Tokens.next()
        socket = token
        setState(next)
        transport.openWebSocket(token, url: url, events: self)
    }

    private func setState(_ next: State) {
        guard state != next else { return }
        state = next
        onState?(next)
    }
}
