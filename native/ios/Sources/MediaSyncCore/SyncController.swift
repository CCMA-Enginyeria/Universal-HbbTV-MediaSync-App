public final class SyncController {
    public struct Options {
        public var emaAlpha = 0.25
        public var enterBandS = 0.1
        public var exitBandS = 0.02
        public var horizonS = 3.0
        public var deadTimeS = 0.35
        public var maxRateDelta = 0.05
        public var rateEps = 0.002
        public var seekThresholdS = 2.0

        public init() {}
    }

    public enum Action: String { case none, rate, seek }
    public enum Mode: String { case locked, correcting }

    public struct Decision {
        public let action: Action
        public let rate: Double
        public let drift: Double
        public let filteredDrift: Double
    }

    public let options: Options
    public private(set) var filteredDrift: Double?
    public private(set) var currentRate = 1.0
    public private(set) var mode = Mode.locked

    public init(options: Options = Options()) {
        self.options = options
    }

    public func reset() {
        filteredDrift = nil
        currentRate = 1.0
        mode = .locked
    }

    public func update(playerTime: Double, tvTime: Double, seekThresholdS: Double? = nil) -> Decision {
        let drift = playerTime - tvTime
        if abs(drift) > (seekThresholdS ?? options.seekThresholdS) {
            filteredDrift = 0
            currentRate = 1.0
            mode = .locked
            return Decision(action: .seek, rate: 1.0, drift: drift, filteredDrift: 0)
        }

        let filtered = filteredDrift.map {
            options.emaAlpha * drift + (1 - options.emaAlpha) * $0
        } ?? drift
        filteredDrift = filtered

        if mode == .locked {
            if abs(filtered) > options.enterBandS { mode = .correcting }
        } else if abs(filtered) < options.exitBandS {
            mode = .locked
        }

        if mode == .locked {
            let action: Action = currentRate != 1.0 ? .rate : .none
            currentRate = 1.0
            return Decision(action: action, rate: 1.0, drift: drift, filteredDrift: filtered)
        }

        let driftAtApply = filtered + (currentRate - 1.0) * options.deadTimeS
        let rateDelta = max(-options.maxRateDelta, min(options.maxRateDelta, -driftAtApply / options.horizonS))
        let newRate = 1.0 + rateDelta
        if abs(newRate - currentRate) > options.rateEps {
            currentRate = newRate
            return Decision(action: .rate, rate: newRate, drift: drift, filteredDrift: filtered)
        }
        return Decision(action: .none, rate: currentRate, drift: drift, filteredDrift: filtered)
    }
}