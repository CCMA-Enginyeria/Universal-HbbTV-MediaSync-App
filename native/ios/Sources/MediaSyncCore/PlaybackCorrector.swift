import Foundation

/// Drives one companion player from the TV timeline (mirrors Kotlin `PlaybackCorrector`).
public final class PlaybackCorrector {
    public struct Player {
        public let mediaTimeS: Double
        public let liveEpochS: Double?
        public let isPlaying: Bool
        public let isBuffering: Bool
        public let rate: Double
        public init(mediaTimeS: Double, liveEpochS: Double?, isPlaying: Bool, isBuffering: Bool, rate: Double) {
            self.mediaTimeS = mediaTimeS
            self.liveEpochS = liveEpochS
            self.isPlaying = isPlaying
            self.isBuffering = isBuffering
            self.rate = rate
        }
    }

    public struct Tv {
        public let positionS: Double
        public let liveEpochS: Double?
        public let isPlaying: Bool
        public let reliable: Bool
        public init(positionS: Double, liveEpochS: Double?, isPlaying: Bool, reliable: Bool) {
            self.positionS = positionS
            self.liveEpochS = liveEpochS
            self.isPlaying = isPlaying
            self.reliable = reliable
        }
    }

    public enum Command: Equatable {
        case play, pause
        case setRate(Double)
        case seek(Double)
    }

    public enum Status: String { case waiting, paused, locked, adjusting, seeking }

    public struct Result {
        public let commands: [Command]
        public let status: Status
        public let filteredDriftMs: Int64?
        public let rate: Double
    }

    private let tuning: SyncTuning
    private var mode: SyncMode?
    private var controller: SyncController
    private var seeking = false
    private var seekAtMs: Int64 = 0
    private var lastCorrectionMs = Int64.min / 2
    private var pausedByTv = false
    private var status = Status.waiting

    public init(tuning: SyncTuning = SyncTuning()) {
        self.tuning = tuning
        controller = SyncController(options: tuning.native)
    }

    public func reset() {
        controller.reset()
        seeking = false
        pausedByTv = false
        lastCorrectionMs = Int64.min / 2
        status = .waiting
    }

    public func onSeekCompleted() {
        guard seeking else { return }
        seeking = false
        controller.reset()
    }

    public func update(nowMs: Int64, tv: Tv?, player: Player, mode: SyncMode, isLive: Bool) -> Result {
        if self.mode != mode {
            self.mode = mode
            controller = SyncController(options: tuning.controllerOptions(mode))
        }
        var commands: [Command] = []
        func normalRate() { if player.rate != 1 { commands.append(.setRate(1)) } }

        guard let tv = tv else {
            if player.isPlaying { commands.append(.pause) }
            normalRate()
            controller.reset()
            seeking = false
            pausedByTv = player.isPlaying || pausedByTv
            return result(commands, .waiting)
        }
        if !tv.isPlaying {
            if player.isPlaying { commands.append(.pause) }
            normalRate()
            controller.reset()
            seeking = false
            pausedByTv = true
            return result(commands, .paused)
        }
        if !player.isPlaying {
            if pausedByTv && !isLive && tv.reliable {
                commands.append(.seek(tv.positionS))
                startSeek(nowMs)
            }
            commands.append(.play)
            pausedByTv = false
            return result(commands, seeking ? .seeking : status)
        }
        pausedByTv = false
        if seeking {
            if nowMs - seekAtMs < tuning.seekCooldownMs { return result(commands, .seeking) }
            seeking = false
            controller.reset()
        }
        if player.isBuffering || !tv.reliable { return result(commands, tv.reliable ? status : .waiting) }
        if nowMs - lastCorrectionMs < tuning.minCorrectionIntervalMs { return result(commands, status) }

        guard let tvTime = isLive ? tv.liveEpochS : tv.positionS,
              let playerTime = isLive ? player.liveEpochS : player.mediaTimeS else { return result(commands, .waiting) }
        lastCorrectionMs = nowMs
        let decision = controller.update(playerTime: playerTime, tvTime: tvTime, seekThresholdS: tuning.seekThresholdS(mode, live: isLive))
        switch decision.action {
        case .seek:
            commands.append(.seek(max(player.mediaTimeS - decision.drift + tuning.seekLeadS, 0)))
            normalRate()
            startSeek(nowMs)
            return result(commands, .seeking)
        case .rate:
            if decision.rate != player.rate { commands.append(.setRate(decision.rate)) }
        case .none:
            break
        }
        return result(commands, controller.mode == .correcting ? .adjusting : .locked)
    }

    private func startSeek(_ nowMs: Int64) {
        seeking = true
        seekAtMs = nowMs
    }

    private func result(_ commands: [Command], _ next: Status) -> Result {
        status = next
        return Result(commands: commands, status: next,
                      filteredDriftMs: controller.filteredDrift.map { Int64(($0 * 1000).rounded()) }, rate: controller.currentRate)
    }
}
