package mediasync.core

import java.io.StringReader
import java.net.URI
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import org.xml.sax.InputSource
import org.xml.sax.SAXException
import org.xml.sax.SAXParseException
import org.xml.sax.helpers.DefaultHandler

data class DialDevice(
    val location: String,
    val applicationUrl: String,
    val friendlyName: String?,
    val manufacturer: String?,
    val modelName: String?,
    val udn: String? = null,
) {
    val hbbtvUrl: String get() = "$applicationUrl/HbbTV"

    /** Stable identity: the UPnP UDN when present, otherwise the description URL. */
    val id: String get() = udn ?: location
}

data class HbbtvApplication(
    val app2AppUrl: String?,
    val interDeviceSyncUrl: String?,
    val userAgent: String?,
)

data class DialTerminal(val device: DialDevice, val application: HbbtvApplication?) {
    val supportsHbbtv: Boolean get() = application?.app2AppUrl != null
    val supportsMediaSync: Boolean
        get() = application?.interDeviceSyncUrl != null || application?.app2AppUrl != null
}

object DialProtocol {
    const val SEARCH_TARGET = "urn:dial-multiscreen-org:service:dial:1"
    const val MULTICAST_ADDRESS = "239.255.255.250"
    const val PORT = 1900
    val searchMessage = listOf(
        "M-SEARCH * HTTP/1.1", "HOST: $MULTICAST_ADDRESS:$PORT",
        "MAN: \"ssdp:discover\"", "MX: 3", "ST: $SEARCH_TARGET", "", "",
    ).joinToString("\r\n")

    fun parseResponse(message: String): String? {
        if (message.length > 65507 || '\u0000' in message) return null
        val lines = message.lineSequence().iterator()
        if (!lines.hasNext() || !Regex("HTTP/1\\.[01] 200(?: .*|)$").matches(lines.next().trimEnd())) return null
        val headers = mutableMapOf<String, String>()
        for (line in lines) {
            if (line.isBlank()) break
            val separator = line.indexOf(':')
            if (separator <= 0) return null
            val name = line.substring(0, separator).trim().lowercase(Locale.ROOT)
            if (headers.put(name, line.substring(separator + 1).trim()) != null) return null
        }
        if (headers["st"] != SEARCH_TARGET) return null
        return validUrl(headers["location"], setOf("http", "https"))
    }

    fun parseDevice(xml: String, location: String, applicationUrl: String?): DialDevice? {
        val descriptionUrl = validUrl(location, setOf("http", "https")) ?: return null
        val base = validUrl(applicationUrl?.trim()?.trimEnd('/'), setOf("http", "https")) ?: return null
        if (URI(base).rawQuery != null) return null
        val root = parseXml(xml) ?: return null
        if (root.localName != "root") return null
        val device = child(root, "device") ?: return null
        return DialDevice(descriptionUrl, base, text(device, "friendlyName"),
            text(device, "manufacturer"), text(device, "modelName"), text(device, "UDN"))
    }

    /**
     * Parses the HbbTV DIAL application document. Both App2App and the CSS-CII
     * InterDevSync endpoint are WebSocket URLs; placeholder hosts are replaced by
     * [realHost] (the host that answered discovery) before validation.
     */
    fun parseApplication(xml: String, realHost: String? = null): HbbtvApplication? {
        val root = parseXml(xml) ?: return null
        if (root.localName != "service") return null
        val additional = child(root, "additionalData") ?: return HbbtvApplication(null, null, null)
        fun endpoint(name: String) = validUrl(Endpoints.repair(text(additional, name), realHost), setOf("ws", "wss"))
        return HbbtvApplication(
            endpoint("X_HbbTV_App2AppURL"),
            endpoint("X_HbbTV_InterDevSyncURL"),
            text(additional, "X_HbbTV_UserAgent"),
        )
    }

    private fun validUrl(value: String?, schemes: Set<String>): String? {
        if (value.isNullOrBlank() || value.any { it.isWhitespace() || it.code < 32 }) return null
        return try {
            val uri = URI(value)
            if (uri.scheme?.lowercase(Locale.ROOT) !in schemes || uri.host.isNullOrBlank() ||
                uri.rawUserInfo != null || uri.rawFragment != null || uri.port !in -1..65535
            ) null else value
        } catch (_: Exception) { null }
    }

    private fun parseXml(xml: String): Element? {
        if (xml.length > 1_048_576 || xml.contains("<!DOCTYPE") || '\u0000' in xml) return null
        return try {
            val factory = DocumentBuilderFactory.newInstance()
            factory.isNamespaceAware = true
            factory.isExpandEntityReferences = false
            val builder = factory.newDocumentBuilder()
            builder.setEntityResolver { _, _ -> throw SAXException("External entities are not allowed") }
            builder.setErrorHandler(object : DefaultHandler() {
                override fun error(exception: SAXParseException) { throw exception }
                override fun fatalError(exception: SAXParseException) { throw exception }
            })
            builder.parse(InputSource(StringReader(xml))).documentElement
        } catch (_: Exception) { null }
    }

    private fun child(parent: Element, name: String): Element? {
        val children = parent.childNodes
        for (index in 0 until children.length) {
            val element = children.item(index) as? Element ?: continue
            if (element.localName == name) return element
        }
        return null
    }

    private fun text(parent: Element, name: String): String? =
        child(parent, name)?.textContent?.trim()?.takeIf { it.isNotEmpty() }
}