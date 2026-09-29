package mediasync.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** CSS-TS control timestamp: contentTime in timeline ticks, wallClockTime in nanoseconds. */
data class ControlTimestamp(val contentTime: Long, val wallClockTime: Long, val speed: Double)

sealed interface TimelineMessage {
    data class Available(val timestamp: ControlTimestamp) : TimelineMessage
    data object Unavailable : TimelineMessage
}

object TimelineProtocol {
    const val PTS = "urn:dvb:css:timeline:pts"
    private val mpdPeriodRel = Regex("^urn:dvb:css:timeline:mpd:period:rel:(\\d+)(?::.*)?$")
    private val temi = Regex("^urn:dvb:css:timeline:temi:\\d+:(\\d+)$")

    fun setupMessage(timelineSelector: String, contentIdStem: String = ""): String = buildJsonObject {
        put("contentIdStem", contentIdStem)
        put("timelineSelector", timelineSelector)
    }.toString()

    /** Returns null for frames that are not CSS-TS messages (including App2App control frames). */
    fun parse(text: String): TimelineMessage? {
        val message = JsonInput.parseObject(text, 16_384) ?: return null
        val speedElement = message["timelineSpeedMultiplier"]
        val content = message["contentTime"]
        val wall = message["wallClockTime"]
        if (speedElement is JsonNull || content == null || content is JsonNull || wall == null || wall is JsonNull) {
            return TimelineMessage.Unavailable
        }
        val contentTime = JsonInput.long(content) ?: return null
        val wallClockTime = JsonInput.long(wall) ?: return null
        val speed = if (speedElement == null) 1.0 else JsonInput.double(speedElement) ?: return null
        if (speed < 0 || speed > 64) return null
        return TimelineMessage.Available(ControlTimestamp(contentTime, wallClockTime, speed))
    }

    /** Ticks per second, preferring the properties advertised by CII. */
    fun tickRate(selector: String, advertised: List<TimelineOption> = emptyList()): Double? {
        advertised.firstOrNull { it.selector == selector }?.tickRate?.let { return it }
        if (selector == PTS) return 90_000.0
        mpdPeriodRel.matchEntire(selector)?.let { return it.groupValues[1].toDoubleOrNull()?.takeIf { rate -> rate > 0 } }
        temi.matchEntire(selector)?.let { return it.groupValues[1].toDoubleOrNull()?.takeIf { rate -> rate > 0 } }
        return null
    }

    /**
     * Chooses the configured selector when the TV announces it (or announces
     * nothing), otherwise the first announced timeline with a known tick rate.
     */
    fun select(configured: String, advertised: List<TimelineOption>): String? {
        if (advertised.isEmpty() || advertised.any { it.selector == configured }) {
            return configured.takeIf { tickRate(it, advertised) != null }
        }
        return advertised.firstOrNull { tickRate(it.selector, advertised) != null }?.selector
    }
}

/** TV timeline position extrapolated from a control timestamp and the wall clock. */
data class TimelinePosition(
    val seconds: Double,
    val speed: Double,
    /** Current wall-clock uncertainty, in milliseconds. */
    val uncertaintyMs: Double,
    /** Age of the control timestamp, measured on the local monotonic clock. */
    val timestampAgeMs: Double,
    val reliable: Boolean,
) {
    val isPlaying: Boolean get() = speed > 0
}

object TimelineMath {
    fun positionSeconds(timestamp: ControlTimestamp, wallNowNanos: Long, tickRate: Double): Double {
        val elapsedSeconds = (wallNowNanos - timestamp.wallClockTime) / 1e9
        return timestamp.contentTime / tickRate + if (timestamp.speed == 0.0) 0.0 else elapsedSeconds * timestamp.speed
    }

    fun formatClock(seconds: Double?): String {
        if (seconds == null || !seconds.isFinite()) return "--:--:--"
        val total = seconds.coerceAtLeast(0.0).toLong()
        return String.format(java.util.Locale.ROOT, "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}
