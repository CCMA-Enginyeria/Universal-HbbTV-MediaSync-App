package mediasync.core

import kotlin.math.abs

class SyncController(val options: Options = Options()) {
    data class Options(
        val emaAlpha: Double = 0.25,
        val enterBandS: Double = 0.1,
        val exitBandS: Double = 0.02,
        val horizonS: Double = 3.0,
        val deadTimeS: Double = 0.35,
        val maxRateDelta: Double = 0.05,
        val rateEps: Double = 0.002,
        val seekThresholdS: Double = 2.0,
    )

    enum class Action { NONE, RATE, SEEK }
    enum class Mode { LOCKED, CORRECTING }

    data class Decision(
        val action: Action,
        val rate: Double,
        val drift: Double,
        val filteredDrift: Double,
    )

    var filteredDrift: Double? = null
        private set
    var currentRate: Double = 1.0
        private set
    var mode: Mode = Mode.LOCKED
        private set

    fun reset() {
        filteredDrift = null
        currentRate = 1.0
        mode = Mode.LOCKED
    }

    fun update(
        playerTime: Double,
        tvTime: Double,
        seekThresholdS: Double = options.seekThresholdS,
    ): Decision {
        val drift = playerTime - tvTime
        if (abs(drift) > seekThresholdS) {
            filteredDrift = 0.0
            currentRate = 1.0
            mode = Mode.LOCKED
            return Decision(Action.SEEK, 1.0, drift, 0.0)
        }

        val filtered = filteredDrift?.let {
            options.emaAlpha * drift + (1 - options.emaAlpha) * it
        } ?: drift
        filteredDrift = filtered

        if (mode == Mode.LOCKED) {
            if (abs(filtered) > options.enterBandS) mode = Mode.CORRECTING
        } else if (abs(filtered) < options.exitBandS) {
            mode = Mode.LOCKED
        }

        if (mode == Mode.LOCKED) {
            val action = if (currentRate != 1.0) Action.RATE else Action.NONE
            currentRate = 1.0
            return Decision(action, 1.0, drift, filtered)
        }

        val driftAtApply = filtered + (currentRate - 1.0) * options.deadTimeS
        val rateDelta = (-driftAtApply / options.horizonS)
            .coerceIn(-options.maxRateDelta, options.maxRateDelta)
        val newRate = 1.0 + rateDelta
        if (abs(newRate - currentRate) > options.rateEps) {
            currentRate = newRate
            return Decision(Action.RATE, newRate, drift, filtered)
        }
        return Decision(Action.NONE, currentRate, drift, filtered)
    }
}