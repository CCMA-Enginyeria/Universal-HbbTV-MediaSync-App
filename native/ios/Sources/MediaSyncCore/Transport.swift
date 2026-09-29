import Foundation

/// Callbacks delivered by a platform `Transport`, serially on the owner's context.
public protocol TransportEvents: AnyObject {
    func onOpened(_ token: Int64)
    func onText(_ token: Int64, _ text: String)
    func onDatagram(_ token: Int64, _ data: Data, receivedAtNanos: Int64)
    func onClosed(_ token: Int64, failed: Bool)
    func onTimer(_ token: Int64)
}

public extension TransportEvents {
    func onOpened(_ token: Int64) {}
    func onText(_ token: Int64, _ text: String) {}
    func onDatagram(_ token: Int64, _ data: Data, receivedAtNanos: Int64) {}
    func onClosed(_ token: Int64, failed: Bool) {}
    func onTimer(_ token: Int64) {}
}

/// Platform I/O used by the pure session state machines; `close`/`cancel` are idempotent.
public protocol Transport: AnyObject {
    func openWebSocket(_ token: Int64, url: String, events: TransportEvents)
    func openUdp(_ token: Int64, host: String, port: Int, events: TransportEvents)
    @discardableResult func sendText(_ token: Int64, _ text: String) -> Bool
    @discardableResult func sendDatagram(_ token: Int64, _ data: Data) -> Bool
    func close(_ token: Int64)
    func schedule(_ token: Int64, delayMs: Int64, events: TransportEvents)
    func cancel(_ token: Int64)
}

/// Local monotonic clock in nanoseconds; never wall-clock time.
public typealias MonotonicClock = () -> Int64

public enum Tokens {
    private static let lock = NSLock()
    private static var nextValue: Int64 = 1

    public static func next() -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        let value = nextValue
        nextValue += 1
        return value
    }
}

/// Bounded exponential backoff without randomness, so tests are deterministic.
public final class Backoff {
    private let initialMs: Int64
    private let maxMs: Int64
    private let factor: Double
    public private(set) var attempts = 0

    public init(initialMs: Int64 = 1_000, maxMs: Int64 = 30_000, factor: Double = 2) {
        self.initialMs = initialMs
        self.maxMs = maxMs
        self.factor = factor
    }

    public func nextDelayMs() -> Int64 {
        let delay = min(Int64(Double(initialMs) * pow(factor, Double(min(attempts, 30)))), maxMs)
        attempts += 1
        return delay
    }

    public func reset() { attempts = 0 }
}

/// Monotonic nanoseconds rebased so CSS-WC 32-bit seconds never overflow or go negative.
public final class RebasedClock {
    private let source: MonotonicClock
    private let origin: Int64

    public init(_ source: @escaping MonotonicClock) {
        self.source = source
        origin = source() - 1_000_000_000
    }

    public func nanos() -> Int64 { source() - origin }
    public func fromSource(_ sourceNanos: Int64) -> Int64 { sourceNanos - origin }
}
