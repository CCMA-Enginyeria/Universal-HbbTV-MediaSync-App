package mediasync.core

import java.net.URI
import java.util.Locale

/** Media synchronisation transport advertised by a terminal. */
enum class SyncMode(val wireName: String) {
    NATIVE("native"),
    COMPAT("compat");

    companion object {
        /** RN stored `compat` by default; unknown values fall back to it too. */
        val DEFAULT = COMPAT
        fun fromWire(value: String?): SyncMode? = entries.firstOrNull { it.wireName == value }
    }
}

/**
 * Endpoint helpers shared by discovery, the session and the probes.
 *
 * Terminals sometimes advertise placeholder hosts (`0.0.0.0`, `localhost`,
 * `127.0.0.1` or an empty host); those are replaced by the host that answered
 * discovery, never by a guessed address.
 */
object Endpoints {
    const val DEFAULT_COMPAT_PREFIX = "hbbtv-sync"
    private val authority = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*://)([^/:?#]*)(.*)$", RegexOption.DOT_MATCHES_ALL)
    private val placeholders = setOf("", "0.0.0.0", "localhost", "127.0.0.1")

    fun hasPlaceholderHost(url: String?): Boolean {
        val match = url?.let { authority.matchEntire(it) } ?: return false
        return match.groupValues[2].lowercase(Locale.ROOT) in placeholders
    }

    fun repair(url: String?, realHost: String?): String? {
        if (url == null || realHost.isNullOrBlank()) return url
        val match = authority.matchEntire(url) ?: return url
        if (match.groupValues[2].lowercase(Locale.ROOT) !in placeholders) return url
        return match.groupValues[1] + realHost + match.groupValues[3]
    }

    /** First non-placeholder host among the discovery URLs, if any. */
    fun realHost(vararg candidates: String?): String? = candidates.firstNotNullOfOrNull { candidate ->
        runCatching { URI(candidate ?: return@runCatching null).host }.getOrNull()
            ?.takeIf { it.isNotBlank() && it.lowercase(Locale.ROOT) !in placeholders }
    }

    fun isWebSocket(url: String?): Boolean = url != null && Regex("^wss?://[^/\\s]+", RegexOption.IGNORE_CASE).containsMatchIn(url)

    fun compatUrl(app2appBase: String?, prefix: String, service: String): String? {
        if (app2appBase.isNullOrBlank()) return null
        val cleanPrefix = prefix.trim('/')
        if (cleanPrefix.isEmpty()) return null
        return "${app2appBase.trimEnd('/')}/$cleanPrefix-$service"
    }

    fun isCompatServiceUrl(url: String?, prefix: String, service: String): Boolean =
        isWebSocket(url) && url!!.trimEnd('/').endsWith("/${prefix.trim('/')}-$service")

    /** `udp://host:port` (or bare `host:port`) as used by native CSS-WC. */
    data class UdpEndpoint(val host: String, val port: Int)

    fun parseUdp(url: String?): UdpEndpoint? {
        if (url.isNullOrBlank()) return null
        val rest = when {
            url.startsWith("udp://", ignoreCase = true) -> url.substring(6)
            url.contains("://") -> return null
            else -> url
        }.substringBefore('/')
        val separator = rest.lastIndexOf(':')
        if (separator <= 0) return null
        val host = rest.substring(0, separator)
        val port = rest.substring(separator + 1).toIntOrNull() ?: return null
        if (port !in 1..65535 || host.any { it.isWhitespace() || it == '@' }) return null
        return UdpEndpoint(host, port)
    }

    /** Endpoints the session will use for a mode, or null if the terminal lacks them. */
    fun ciiUrl(mode: SyncMode, interDevSyncUrl: String?, app2appUrl: String?, prefix: String): String? = when (mode) {
        SyncMode.NATIVE -> interDevSyncUrl?.takeIf(::isWebSocket)
        SyncMode.COMPAT -> compatUrl(app2appUrl, prefix, "cii")
    }

    /** RN-compatible preference key, so migrated preferences stay attached to the same TV model. */
    fun preferenceKey(manufacturer: String?, modelName: String?, location: String?): String {
        fun normalize(value: String?) = value?.trim()?.lowercase(Locale.US)?.replace(Regex("\\s+"), " ") ?: ""
        fun encode(value: String) = java.net.URLEncoder.encode(value, "UTF-8")
            .replace("+", "%20").replace("%7E", "~")
            .replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")")
        val prefix = "@universal-mediasync/mode/v1"
        val maker = normalize(manufacturer)
        val model = normalize(modelName)
        if (maker.isNotEmpty() || model.isNotEmpty()) return "$prefix/model/${encode(maker)}/${encode(model)}"
        return "$prefix/device/${encode(normalize(location).ifEmpty { "unknown" })}"
    }
}
