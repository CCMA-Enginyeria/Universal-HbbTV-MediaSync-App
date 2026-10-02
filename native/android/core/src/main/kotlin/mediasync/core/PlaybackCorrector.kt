package mediasync.core

/**
 * Drives one companion player from the TV timeline: follows TV play/pause,
 * applies [SyncController] decisions and suppresses corrections while a seek
 * or rebuffer settles. Owned by the player's owner; serial, not thread-safe.
 */
class PlaybackCorrector(private val tuning: SyncTuning = SyncTuning()) {
    data class Player(
        /** Position in the player's own seekable timebase, seconds. */
        val mediaTimeS: Double,
        /** Live: position in the same epoch timebase as [Tv.liveEpochS]; null when unknown. */
        val liveEpochS: Double?,
        val isPlaying: Boolean,
        val isBuffering: Boolean,
        val rate: Double,
    )

    data class Tv(val positionS: Double, val liveEpochS: Double?, val isPlaying: Boolean, val reliable: Boolean)

    sealed interface Command {
        data object Play : Command
        data object Pause : Command
        data class SetRate(val rate: Double) : Command
        data class Seek(val mediaTimeS: Double) : Command
    }

    enum class Status { WAITING, PAUSED, LOCKED, ADJUSTING, SEEKING }

    data class Result(val commands: List<Command>, val status: Status, val filteredDriftMs: Long?, val rate: Double)

    private var mode: SyncMode? = null
    private var controller = SyncController(tuning.native)
    private var seeking = false
    private var seekAtMs = 0L
    private var lastCorrectionMs = Long.MIN_VALUE / 2
    private var pausedByTv = false
    private var status = Status.WAITING

    fun reset() {
        controller.reset()
        seeking = false
        pausedByTv = false
        lastCorrectionMs = Long.MIN_VALUE / 2
        status = Status.WAITING
    }

    /** Call when the player reports that the requested seek completed. */
    fun onSeekCompleted() {
        if (!seeking) return
        seeking = false
        controller.reset()
    }

    fun update(nowMs: Long, tv: Tv?, player: Player, mode: SyncMode, isLive: Boolean): Result {
        if (this.mode != mode) {
            this.mode = mode
            controller = SyncController(tuning.controllerOptions(mode))
        }
        val commands = mutableListOf<Command>()
        fun normalRate() { if (player.rate != 1.0) commands.add(Command.SetRate(1.0)) }

        if (tv == null) {
            if (player.isPlaying) commands.add(Command.Pause)
            normalRate()
            controller.reset()
            seeking = false
            pausedByTv = player.isPlaying || pausedByTv
            return result(commands, Status.WAITING)
        }
        if (!tv.isPlaying) {
            if (player.isPlaying) commands.add(Command.Pause)
            normalRate()
            controller.reset()
            seeking = false
            pausedByTv = true
            return result(commands, Status.PAUSED)
        }
        if (!player.isPlaying) {
            if (pausedByTv && !isLive && tv.reliable) {
                commands.add(Command.Seek(tv.positionS))
                startSeek(nowMs)
            }
            commands.add(Command.Play)
            pausedByTv = false
            return result(commands, if (seeking) Status.SEEKING else status)
        }
        pausedByTv = false
        if (seeking) {
            if (nowMs - seekAtMs < tuning.seekCooldownMs) return result(commands, Status.SEEKING)
            seeking = false
            controller.reset()
        }
        if (player.isBuffering || !tv.reliable) return result(commands, if (tv.reliable) status else Status.WAITING)
        if (nowMs - lastCorrectionMs < tuning.minCorrectionIntervalMs) return result(commands, status)

        val tvTime = if (isLive) tv.liveEpochS else tv.positionS
        val playerTime = if (isLive) player.liveEpochS else player.mediaTimeS
        if (tvTime == null || playerTime == null) return result(commands, Status.WAITING)
        lastCorrectionMs = nowMs
        val decision = controller.update(playerTime, tvTime, tuning.seekThresholdS(mode, isLive))
        when (decision.action) {
            SyncController.Action.SEEK -> {
                commands.add(Command.Seek((player.mediaTimeS - decision.drift + tuning.seekLeadS).coerceAtLeast(0.0)))
                normalRate()
                startSeek(nowMs)
                return result(commands, Status.SEEKING)
            }
            // NONE still converges the player: a controller created on a mode switch assumes 1.0.
            SyncController.Action.RATE, SyncController.Action.NONE ->
                if (decision.rate != player.rate) commands.add(Command.SetRate(decision.rate))
        }
        val next = if (controller.mode == SyncController.Mode.CORRECTING) Status.ADJUSTING else Status.LOCKED
        return result(commands, next)
    }

    private fun startSeek(nowMs: Long) {
        seeking = true
        seekAtMs = nowMs
    }

    private fun result(commands: List<Command>, next: Status): Result {
        status = next
        return Result(commands, next, controller.filteredDrift?.let { Math.round(it * 1000) }, controller.currentRate)
    }
}
