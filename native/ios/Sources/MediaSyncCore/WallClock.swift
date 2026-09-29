import Foundation

/// DVB-CSS CSS-WC binary message (32 bytes, big-endian); timestamps kept as Int64 nanoseconds.
public struct WallClockMessage: Equatable {
    public static let size = 32
    public static let typeRequest = 0
    public static let typeResponse = 1
    public static let typeResponseWithFollowup = 2
    public static let typeFollowup = 3
    private static let nanos: Int64 = 1_000_000_000
    private static let maxSeconds: Int64 = 0xFFFF_FFFF

    public let version: Int
    public let type: Int
    public let precision: Int
    /// Maximum frequency error in units of 1/256 ppm.
    public let maxFreqError: Int64
    public let originateNanos: Int64
    public let receiveNanos: Int64
    public let transmitNanos: Int64

    public static func request(originateNanos: Int64, precision: Int = 0, maxFreqError: Int64 = 0) -> Data {
        precondition(originateNanos >= 0 && originateNanos / nanos <= maxSeconds, "Timestamp out of range")
        var bytes = [UInt8](repeating: 0, count: size)
        bytes[1] = UInt8(typeRequest)
        bytes[2] = UInt8(bitPattern: Int8(clamping: precision))
        put(&bytes, 4, maxFreqError)
        put(&bytes, 8, originateNanos / nanos)
        put(&bytes, 12, originateNanos % nanos)
        return Data(bytes)
    }

    /// Returns nil for truncated, unknown-version, request or out-of-range packets.
    public static func decode(_ data: Data) -> WallClockMessage? {
        let bytes = [UInt8](data)
        guard bytes.count >= size else { return nil }
        let version = Int(bytes[0])
        let type = Int(bytes[1])
        guard version == 0, (typeResponse...typeFollowup).contains(type) else { return nil }
        func timestamp(_ offset: Int) -> Int64? {
            let fraction = uint32(bytes, offset + 4)
            guard fraction < nanos else { return nil }
            return uint32(bytes, offset) * nanos + fraction
        }
        guard let originate = timestamp(8), let receive = timestamp(16), let transmit = timestamp(24) else { return nil }
        return WallClockMessage(version: version, type: type, precision: Int(Int8(bitPattern: bytes[2])),
                                maxFreqError: uint32(bytes, 4), originateNanos: originate, receiveNanos: receive, transmitNanos: transmit)
    }

    private static func uint32(_ bytes: [UInt8], _ offset: Int) -> Int64 {
        (Int64(bytes[offset]) << 24) | (Int64(bytes[offset + 1]) << 16) | (Int64(bytes[offset + 2]) << 8) | Int64(bytes[offset + 3])
    }

    private static func put(_ bytes: inout [UInt8], _ offset: Int, _ value: Int64) {
        bytes[offset] = UInt8(truncatingIfNeeded: value >> 24)
        bytes[offset + 1] = UInt8(truncatingIfNeeded: value >> 16)
        bytes[offset + 2] = UInt8(truncatingIfNeeded: value >> 8)
        bytes[offset + 3] = UInt8(truncatingIfNeeded: value)
    }
}

/// Wall-clock correlation from NTP-style samples; dispersion grows with elapsed time.
public final class WallClockEstimator {
    public struct Sample {
        public let localSendNanos: Int64
        public let remoteReceiveNanos: Int64
        public let remoteTransmitNanos: Int64
        public let localReceiveNanos: Int64
        public let remoteMaxFreqErrorPpm: Double

        public init(localSendNanos: Int64, remoteReceiveNanos: Int64, remoteTransmitNanos: Int64,
                    localReceiveNanos: Int64, remoteMaxFreqErrorPpm: Double = 0) {
            self.localSendNanos = localSendNanos
            self.remoteReceiveNanos = remoteReceiveNanos
            self.remoteTransmitNanos = remoteTransmitNanos
            self.localReceiveNanos = localReceiveNanos
            self.remoteMaxFreqErrorPpm = remoteMaxFreqErrorPpm
        }

        public var roundTripNanos: Int64 { (localReceiveNanos - localSendNanos) - (remoteTransmitNanos - remoteReceiveNanos) }
        public var offsetNanos: Int64 {
            let sum = (remoteReceiveNanos - localSendNanos) + (remoteTransmitNanos - localReceiveNanos)
            return sum >= 0 ? sum / 2 : -((-sum + 1) / 2)
        }
    }

    public struct Stats {
        public let samples: Int
        public let accepted: Int
        public let rejected: Int
        public let avgRoundTripMs: Double?
        public let minRoundTripMs: Double?
        public let maxRoundTripMs: Double?
    }

    private let localMaxFreqErrorPpm: Double
    private var offsetNanos: Int64?
    private var baseDispersionNanos = 0.0
    private var sampleLocalNanos: Int64 = 0
    private var growthPerNano = 0.0
    private var samples = 0, accepted = 0, rejected = 0
    private var avgRtt: Double?, minRtt: Double?, maxRtt: Double?

    public init(localMaxFreqErrorPpm: Double = 500) { self.localMaxFreqErrorPpm = localMaxFreqErrorPpm }

    public var hasCorrelation: Bool { offsetNanos != nil }

    public func reset() {
        offsetNanos = nil
        baseDispersionNanos = 0
        samples = 0; accepted = 0; rejected = 0
        avgRtt = nil; minRtt = nil; maxRtt = nil
    }

    @discardableResult
    public func accept(_ sample: Sample, now: Int64? = nil) -> Bool {
        let now = now ?? sample.localReceiveNanos
        samples += 1
        let rtt = sample.roundTripNanos
        guard rtt >= 0, sample.localReceiveNanos >= sample.localSendNanos,
              sample.remoteTransmitNanos >= sample.remoteReceiveNanos, now >= sample.localReceiveNanos else {
            rejected += 1
            return false
        }
        let rttMs = Double(rtt) / 1e6
        avgRtt = avgRtt.map { 0.2 * rttMs + 0.8 * $0 } ?? rttMs
        minRtt = min(minRtt ?? rttMs, rttMs)
        maxRtt = max(maxRtt ?? rttMs, rttMs)
        let growth = (localMaxFreqErrorPpm + max(sample.remoteMaxFreqErrorPpm, 0)) * 1e-6
        let candidate = Double(rtt) / 2 + Double(now - sample.localReceiveNanos) * growth
        if offsetNanos != nil && candidate > dispersionNanos(now) {
            rejected += 1
            return false
        }
        offsetNanos = sample.offsetNanos
        baseDispersionNanos = Double(rtt) / 2
        sampleLocalNanos = sample.localReceiveNanos
        growthPerNano = growth
        accepted += 1
        return true
    }

    public func wallClockNanos(_ local: Int64) -> Int64? { offsetNanos.map { local + $0 } }

    public func dispersionNanos(_ local: Int64) -> Double {
        guard offsetNanos != nil else { return .infinity }
        return baseDispersionNanos + Double(abs(local - sampleLocalNanos)) * growthPerNano
    }

    public func isSynchronized(_ local: Int64, toleranceMs: Double) -> Bool { dispersionNanos(local) <= toleranceMs * 1e6 }

    public func stats() -> Stats { Stats(samples: samples, accepted: accepted, rejected: rejected,
                                        avgRoundTripMs: avgRtt, minRoundTripMs: minRtt, maxRoundTripMs: maxRtt) }
}
