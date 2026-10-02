package mediasync.core

import java.net.URI
import java.util.Locale
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Companion page protocol (formerly `src/utils/companionProtocol.js` in the React Native app): versioned JSON
 * envelopes shared by WebView, WKWebView and Custom Tabs transports.
 */
object CompanionProtocol {
    const val VERSION = 1
    const val MAX_INBOUND_CHARS = 65_536

    data class Position(
        val positionSeconds: Double?,
        val isPlaying: Boolean,
        val speed: Double,
        val isLive: Boolean,
        val liveEpochSeconds: Double?,
        /** Device wall clock (epoch ms) at which the position was valid. */
        val generatedAtMs: Long,
    )

    sealed interface Inbound {
        data class SyncAck(val raw: JsonObject) : Inbound
        data class AppMessage(val type: String, val id: String?, val payload: JsonElement?) : Inbound
    }

    fun init(contentId: String?): String = buildJsonObject {
        put("version", VERSION)
        put("type", "init")
        put("contentId", contentId?.let { JsonPrimitive(it) } ?: JsonNull)
    }.toString()

    fun position(position: Position): String = buildJsonObject {
        put("version", VERSION)
        put("type", "position")
        put("positionSeconds", number(position.positionSeconds))
        put("positionMillis", number(position.positionSeconds?.times(1000)))
        put("exoPlayerPositionSeconds", number(position.liveEpochSeconds))
        put("isPlaying", position.isPlaying)
        put("speed", position.speed)
        put("isLive", position.isLive)
        put("generatedAt", position.generatedAtMs)
        put("formattedTime", TimelineMath.formatClock(position.positionSeconds))
    }.toString()

    /** Wraps a TV application envelope verbatim. */
    fun appMessage(message: JsonObject): String = buildJsonObject {
        put("version", VERSION)
        put("type", "app-message")
        put("message", message)
    }.toString()

    /** Returns null for anything that is not a valid envelope of this protocol. */
    fun parse(raw: String): Inbound? {
        val envelope = JsonInput.parseObject(raw, MAX_INBOUND_CHARS) ?: return null
        if (JsonInput.long(envelope["version"]) != VERSION.toLong() || (envelope["version"] as? JsonPrimitive)?.isString == true) return null
        return when (JsonInput.string(envelope["type"])) {
            "sync-ack" -> Inbound.SyncAck(envelope)
            "app-message" -> {
                val message = envelope["message"] as? JsonObject ?: return null
                val type = JsonInput.string(message["type"])?.takeIf { it.isNotEmpty() && it.length <= 128 } ?: return null
                Inbound.AppMessage(type, JsonInput.string(message["id"]), message["payload"]?.takeUnless { it is JsonNull })
            }
            else -> null
        }
    }

    /**
     * Script that delivers an envelope to the page. The payload is passed as an
     * escaped string literal, never as code, so TV-controlled data cannot execute.
     */
    fun webViewInjection(envelope: String): String {
        val literal = JsonInput.escape(envelope).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        return "(function(){var m=$literal;" +
            "var o=window.location.origin;" +
            "try{window.postMessage(m,(o&&o!=='null')?o:'*');}catch(e){}" +
            "try{if(window.__hbbtvSync)window.__hbbtvSync(JSON.parse(m));}catch(e){}" +
            "})(); true;"
    }

    /**
     * Page-side shim so pages written for React Native keep working without its
     * runtime. [bridge] is a JavaScript expression resolved lazily at call time.
     */
    fun reactNativeShim(bridge: String): String =
        "(function(){if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage)return;" +
            "window.ReactNativeWebView={postMessage:function(m){var b=$bridge;if(b)b.postMessage(String(m));}};})();"

    private fun number(value: Double?): JsonElement = value?.takeIf { it.isFinite() }?.let { JsonPrimitive(it) } ?: JsonNull

    /** Exact HTTPS origin for Custom Tabs Digital Asset Links, or null. */
    fun httpsOrigin(url: String?): String? = origin(url)?.takeIf { it.startsWith("https://") }

    fun origin(url: String?): String? {
        val uri = runCatching { URI(url ?: return null) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        val port = uri.port.takeIf { it != -1 && it != if (scheme == "https") 443 else 80 }
        return "$scheme://$host" + (port?.let { ":$it" } ?: "")
    }

    /** iOS DASH fallback player URL, with the same parameters as the RN app. */
    fun webPlayerUrl(base: String, mpdUrl: String, audio: Boolean, track: MediaTrack, trackIndex: Int,
                     volume: Double, isLive: Boolean, tuning: SyncTuning, telemetry: Boolean): String {
        fun encode(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        val options = tuning.native
        val query = listOf(
            "mpd" to mpdUrl, "mode" to if (audio) "audio" else "video", "iso" to track.language.orEmpty(),
            "track" to trackIndex.toString(), "role" to track.role.orEmpty(), "volume" to volume.toString(),
            "live" to if (isLive) "1" else "0", "emaAlpha" to options.emaAlpha.toString(),
            "enterBandS" to options.enterBandS.toString(), "exitBandS" to options.exitBandS.toString(),
            "horizonS" to options.horizonS.toString(), "deadTimeS" to options.deadTimeS.toString(),
            "maxRateDelta" to options.maxRateDelta.toString(), "rateEps" to options.rateEps.toString(),
            "seekCooldownMs" to tuning.seekCooldownMs.toString(), "seekLeadS" to tuning.seekLeadS.toString(),
            "correctionIntervalMs" to tuning.progressIntervalMs.toString(), "tel" to if (telemetry) "1" else "0",
        ).joinToString("&") { (key, value) -> "$key=${encode(value)}" }
        return base + (if (base.contains('?')) "&" else "?") + query
    }
}

/** Sends position corrections at a bounded cadence, immediately on play/speed changes. */
class CompanionFeedThrottle(private val intervalMs: Long = 1_000) {
    private var lastSentMs: Long? = null
    private var lastPlaying: Boolean? = null
    private var lastSpeed: Double? = null

    fun shouldSend(nowMs: Long, isPlaying: Boolean, speed: Double): Boolean {
        val changed = isPlaying != lastPlaying || speed != lastSpeed
        val last = lastSentMs
        if (!changed && last != null && nowMs - last < intervalMs) return false
        lastSentMs = nowMs
        lastPlaying = isPlaying
        lastSpeed = speed
        return true
    }

    fun reset() {
        lastSentMs = null
        lastPlaying = null
        lastSpeed = null
    }
}

/**
 * Accepts bridge messages only from the page's origin and the current page
 * generation, so messages from a previous page or another origin are dropped.
 */
class CompanionBridgeGate(pageUrl: String) {
    val allowedOrigin: String? = CompanionProtocol.origin(pageUrl)
    var pageGeneration = 0L
        private set

    fun onNavigation(): Long = ++pageGeneration

    fun accept(sourceOrigin: String?, generation: Long, text: String): CompanionProtocol.Inbound? {
        if (allowedOrigin == null || generation != pageGeneration) return null
        if (CompanionProtocol.origin(sourceOrigin) != allowedOrigin) return null
        return CompanionProtocol.parse(text)
    }
}
