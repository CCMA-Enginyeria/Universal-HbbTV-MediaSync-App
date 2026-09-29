package mediasync.core

import kotlin.math.abs

/**
 * DVB-CSS CSS-WC binary message (ETSI TS 103 286-2, 32 bytes, big-endian).
 * Timestamps are 32-bit unsigned seconds + 32-bit nanoseconds, kept as [Long]
 * nanoseconds so no precision is lost when converting.
 */
data class WallClockMessage(
    val version: Int,
    val type: Int,
    val precision: Int,
    /** Maximum frequency error in units of 1/256 ppm. */
    val maxFreqError: Long,
    val originateNanos: Long,
    val receiveNanos: Long,
    val transmitNanos: Long,
) {
    companion object {
        const val SIZE = 32
        const val TYPE_REQUEST = 0
        const val TYPE_RESPONSE = 1
        const val TYPE_RESPONSE_WITH_FOLLOWUP = 2
        const val TYPE_FOLLOWUP = 3
        private const val NANOS = 1_000_000_000L
        private const val MAX_SECONDS = 0xFFFF_FFFFL

        fun request(originateNanos: Long, precision: Int = 0, maxFreqError: Long = 0): ByteArray {
            require(originateNanos >= 0 && originateNanos / NANOS <= MAX_SECONDS) { "Timestamp out of range" }
            require(precision in -128..127 && maxFreqError in 0..MAX_SECONDS)
            val bytes = ByteArray(SIZE)
            bytes[0] = 0
            bytes[1] = TYPE_REQUEST.toByte()
            bytes[2] = precision.toByte()
            putUInt32(bytes, 4, maxFreqError)
            putUInt32(bytes, 8, originateNanos / NANOS)
            putUInt32(bytes, 12, originateNanos % NANOS)
            return bytes
        }

        /** Returns null for truncated, unknown-version, request or out-of-range packets. */
        fun decode(bytes: ByteArray, length: Int = bytes.size): WallClockMessage? {
            if (length < SIZE || bytes.size < SIZE) return null
            val version = bytes[0].toInt() and 0xFF
            val type = bytes[1].toInt() and 0xFF
            if (version != 0 || type !in TYPE_RESPONSE..TYPE_FOLLOWUP) return null
            fun timestamp(offset: Int): Long? {
                val nanos = uint32(bytes, offset + 4)
                if (nanos >= NANOS) return null
                return uint32(bytes, offset) * NANOS + nanos
            }
            return WallClockMessage(
                version, type, bytes[2].toInt(), uint32(bytes, 4),
                timestamp(8) ?: return null, timestamp(16) ?: return null, timestamp(24) ?: return null,
            )
        }

        private fun uint32(bytes: ByteArray, offset: Int): Long =
            ((bytes[offset].toLong() and 0xFF) shl 24) or ((bytes[offset + 1].toLong() and 0xFF) shl 16) or
                ((bytes[offset + 2].toLong() and 0xFF) shl 8) or (bytes[offset + 3].toLong() and 0xFF)

        private fun putUInt32(bytes: ByteArray, offset: Int, value: Long) {
            bytes[offset] = (value ushr 24).toByte()
            bytes[offset + 1] = (value ushr 16).toByte()
            bytes[offset + 2] = (value ushr 8).toByte()
            bytes[offset + 3] = value.toByte()
        }
    }
}

/**
 * Wall-clock correlation built from NTP-style request/response samples, all in
 * nanoseconds of the injected local monotonic clock. Uncertainty (dispersion)
 * grows with the elapsed time since the sample, so an old correlation is
 * eventually replaced by a fresher sample and reported as unreliable.
 */
class WallClockEstimator(
    /** Local oscillator error bound (ppm) used to grow dispersion over time. */
    private val localMaxFreqErrorPpm: Double = 500.0,
) {
    data class Sample(
        val localSendNanos: Long,
        val remoteReceiveNanos: Long,
        val remoteTransmitNanos: Long,
        val localReceiveNanos: Long,
        val remoteMaxFreqErrorPpm: Double = 0.0,
    ) {
        val roundTripNanos: Long get() = (localReceiveNanos - localSendNanos) - (remoteTransmitNanos - remoteReceiveNanos)
        val offsetNanos: Long
            get() = Math.floorDiv(
                (remoteReceiveNanos - localSendNanos) + (remoteTransmitNanos - localReceiveNanos), 2L,
            )
    }

    data class Stats(val samples: Int, val accepted: Int, val rejected: Int, val avgRoundTripMs: Double?,
                     val minRoundTripMs: Double?, val maxRoundTripMs: Double?)

    private var offsetNanos: Long? = null
    private var baseDispersionNanos = 0.0
    private var sampleLocalNanos = 0L
    private var growthPerNano = 0.0
    private var samples = 0
    private var accepted = 0
    private var rejected = 0
    private var avgRtt: Double? = null
    private var minRtt: Double? = null
    private var maxRtt: Double? = null

    val hasCorrelation: Boolean get() = offsetNanos != null

    fun reset() {
        offsetNanos = null
        baseDispersionNanos = 0.0
        samples = 0; accepted = 0; rejected = 0
        avgRtt = null; minRtt = null; maxRtt = null
    }

    /** Returns true when the sample became the active correlation. */
    fun accept(sample: Sample, nowNanos: Long = sample.localReceiveNanos): Boolean {
        samples++
        val rtt = sample.roundTripNanos
        if (rtt < 0 || sample.localReceiveNanos < sample.localSendNanos ||
            sample.remoteTransmitNanos < sample.remoteReceiveNanos || nowNanos < sample.localReceiveNanos
        ) {
            rejected++
            return false
        }
        val rttMs = rtt / 1e6
        avgRtt = avgRtt?.let { 0.2 * rttMs + 0.8 * it } ?: rttMs
        minRtt = minOf(minRtt ?: rttMs, rttMs)
        maxRtt = maxOf(maxRtt ?: rttMs, rttMs)
        val growth = (localMaxFreqErrorPpm + sample.remoteMaxFreqErrorPpm.coerceAtLeast(0.0)) * 1e-6
        val candidate = rtt / 2.0 + (nowNanos - sample.localReceiveNanos) * growth
        if (offsetNanos != null && candidate > dispersionNanos(nowNanos)) {
            rejected++
            return false
        }
        offsetNanos = sample.offsetNanos
        baseDispersionNanos = rtt / 2.0
        sampleLocalNanos = sample.localReceiveNanos
        growthPerNano = growth
        accepted++
        return true
    }

    fun wallClockNanos(localNanos: Long): Long? = offsetNanos?.let { localNanos + it }

    fun dispersionNanos(localNanos: Long): Double =
        if (offsetNanos == null) Double.POSITIVE_INFINITY
        else baseDispersionNanos + abs(localNanos - sampleLocalNanos) * growthPerNano

    fun isSynchronized(localNanos: Long, toleranceMs: Double): Boolean = dispersionNanos(localNanos) <= toleranceMs * 1e6

    fun stats() = Stats(samples, accepted, rejected, avgRtt, minRtt, maxRtt)
}
