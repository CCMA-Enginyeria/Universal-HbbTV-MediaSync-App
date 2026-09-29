package mediasync.core

import java.io.StringReader
import java.net.URI
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import org.xml.sax.InputSource
import org.xml.sax.SAXException
import org.xml.sax.SAXParseException
import org.xml.sax.helpers.DefaultHandler

enum class ContentKind { NONE, DASH, HLS, WEB, UNSUPPORTED }

object ContentClassifier {
    private val web = Regex("\\.html?(\\?|#|$)", RegexOption.IGNORE_CASE)
    private val dash = Regex("\\.mpd(\\?|#|$)", RegexOption.IGNORE_CASE)
    private val hls = Regex("\\.m3u8(\\?|#|$)", RegexOption.IGNORE_CASE)

    /** Only absolute HTTP(S) URLs can be fetched; anything else is shown as unsupported. */
    fun classify(contentId: String?): ContentKind {
        if (contentId.isNullOrBlank()) return ContentKind.NONE
        val uri = runCatching { URI(contentId) }.getOrNull()
        val scheme = uri?.scheme?.lowercase(Locale.ROOT)
        if (uri == null || (scheme != "http" && scheme != "https") || uri.host.isNullOrBlank() || uri.rawUserInfo != null) {
            return ContentKind.UNSUPPORTED
        }
        return when {
            web.containsMatchIn(contentId) -> ContentKind.WEB
            dash.containsMatchIn(contentId) -> ContentKind.DASH
            hls.containsMatchIn(contentId) -> ContentKind.HLS
            else -> ContentKind.UNSUPPORTED
        }
    }

    /** Brand fallback only replaces missing content, never unsupported content (PRD-007-R07). */
    fun resolve(contentId: String?, brandFallback: String?): String? =
        if (contentId.isNullOrBlank()) brandFallback?.takeIf { classify(it) != ContentKind.UNSUPPORTED } else contentId
}

enum class TrackKind { AUDIO, VIDEO, TEXT }

data class MediaTrack(
    /** Stable within a manifest: period + adaptation set identity, never a display index. */
    val id: String,
    val kind: TrackKind,
    val language: String?,
    val role: String?,
    val label: String?,
    val codecs: String?,
    val mimeType: String?,
    val bandwidth: Long,
    val width: Int?,
    val height: Int?,
    val audioDescription: Boolean = false,
    val signLanguage: Boolean = false,
    val protected: Boolean = false,
    /** Text only: direct URL or segment template. */
    val textFormat: String? = null,
    val textUrl: String? = null,
    val segmentTemplate: SegmentTemplate? = null,
    val baseUrl: String? = null,
    val representationId: String? = null,
) {
    /** Identity that survives manifest refreshes and content changes (RN auto-resume rule). */
    val intentKey: String get() = "${kind.name}:${language.orEmpty()}:${role.orEmpty()}"
}

data class TextSegment(val time: Long, val duration: Long, val url: String? = null)

data class SegmentTemplate(
    val initialization: String?,
    val media: String,
    val timescale: Long,
    val duration: Long,
    val startNumber: Long,
    val presentationTimeOffset: Long,
    val segments: List<TextSegment> = emptyList(),
    val periodStartS: Double = 0.0,
) {
    val segmentSeconds: Double get() = duration.toDouble() / timescale
    val presentationTimeOffsetSeconds: Double get() = presentationTimeOffset.toDouble() / timescale
}

data class MediaManifest(
    val url: String,
    val isLive: Boolean,
    val availabilityStartTimeMs: Long?,
    val timeShiftBufferDepthS: Double?,
    val minimumUpdatePeriodS: Double?,
    val suggestedPresentationDelayS: Double?,
    val durationS: Double?,
    val tracks: List<MediaTrack>,
) {
    val audio: List<MediaTrack> get() = tracks.filter { it.kind == TrackKind.AUDIO }
    val video: List<MediaTrack> get() = tracks.filter { it.kind == TrackKind.VIDEO }
    val text: List<MediaTrack> get() = tracks.filter { it.kind == TrackKind.TEXT }
    val isProtected: Boolean get() = tracks.isNotEmpty() && tracks.filter { it.kind != TrackKind.TEXT }.all { it.protected }
    val refreshDelayMs: Long?
        get() = if (isLive || ContentClassifier.classify(url) == ContentKind.HLS) {
            ((minimumUpdatePeriodS?.takeIf { it.isFinite() } ?: 5.0).coerceIn(1.0, 60.0) * 1000).toLong()
        } else null

    fun refreshedTrack(previous: MediaTrack?): MediaTrack? {
        previous ?: return null
        val playable = tracks.filter { !it.protected }
        val intent = PlaybackIntent.of(previous)
        return playable.firstOrNull { it.id == previous.id && it.kind == previous.kind &&
            it.language == previous.language && it.role.orEmpty() == previous.role.orEmpty() }
            ?: intent.match(playable)
    }
}

class ManifestException(message: String) : Exception(message)

/** Remembers what the user was playing so a reconnect or new content resumes the same role/language. */
data class PlaybackIntent(val kind: TrackKind, val language: String?, val role: String?) {
    fun match(tracks: List<MediaTrack>): MediaTrack? =
        tracks.firstOrNull { it.kind == kind && it.language == language && it.role.orEmpty() == role.orEmpty() }

    companion object {
        fun of(track: MediaTrack) = PlaybackIntent(track.kind, track.language, track.role)
    }
}

object MpdParser {
    const val MAX_BYTES = 4 * 1_048_576

    fun parse(xml: String, manifestUrl: String): MediaManifest {
        val root = SafeXml.parse(xml, MAX_BYTES) ?: throw ManifestException("Malformed MPD")
        if (root.localName != "MPD") throw ManifestException("Missing MPD root")
        val isLive = root.getAttribute("type") == "dynamic"
        val mpdBase = resolve(manifestUrl, SafeXml.childText(root, "BaseURL")) ?: manifestUrl
        val tracks = mutableListOf<MediaTrack>()
        var inferredStart = 0.0
        SafeXml.children(root, "Period").forEachIndexed { periodIndex, period ->
            val periodId = period.getAttribute("id").ifEmpty { "p$periodIndex" }
            val periodBase = resolve(mpdBase, SafeXml.childText(period, "BaseURL")) ?: mpdBase
            val start = if (period.getAttribute("start") == "PT0S") 0.0 else parseDuration(period.getAttribute("start")) ?: inferredStart
            val duration = parseDuration(period.getAttribute("duration"))
            inferredStart = start + (duration ?: 0.0)
            SafeXml.children(period, "AdaptationSet").forEachIndexed { index, set ->
                track(set, periodId, index, periodBase, start, duration)?.let(tracks::add)
            }
        }
        return MediaManifest(
            url = manifestUrl,
            isLive = isLive,
            availabilityStartTimeMs = parseDateTime(root.getAttribute("availabilityStartTime")),
            timeShiftBufferDepthS = parseDuration(root.getAttribute("timeShiftBufferDepth")),
            minimumUpdatePeriodS = parseDuration(root.getAttribute("minimumUpdatePeriod")),
            suggestedPresentationDelayS = parseDuration(root.getAttribute("suggestedPresentationDelay")),
            durationS = if (isLive) null else parseDuration(root.getAttribute("mediaPresentationDuration")),
            tracks = tracks,
        )
    }

    private fun track(set: Element, periodId: String, index: Int, periodBase: String, periodStart: Double, periodDuration: Double?): MediaTrack? {
        val representations = SafeXml.children(set, "Representation")
        val best = representations.maxByOrNull { it.getAttribute("bandwidth").toLongOrNull() ?: 0 }
        fun attribute(name: String) = set.getAttribute(name).ifEmpty { best?.getAttribute(name).orEmpty() }.ifEmpty { null }
        val mime = attribute("mimeType")?.lowercase(Locale.ROOT).orEmpty()
        val contentType = set.getAttribute("contentType").lowercase(Locale.ROOT)
        val codecs = attribute("codecs")
        val lowerCodecs = codecs?.lowercase(Locale.ROOT).orEmpty()
        val kind = when {
            contentType == "audio" || mime.startsWith("audio/") -> TrackKind.AUDIO
            contentType == "video" || mime.startsWith("video/") -> TrackKind.VIDEO
            contentType == "text" || mime.contains("ttml") || mime.contains("vtt") || mime.contains("subtitle") ||
                (mime == "application/mp4" && (lowerCodecs.contains("stpp") || lowerCodecs.contains("wvtt"))) -> TrackKind.TEXT
            else -> return null
        }
        val roles = SafeXml.children(set, "Role").map { it.getAttribute("value") }
        val accessibility = SafeXml.children(set, "Accessibility").map { it.getAttribute("value") }
        val rawRole = roles.firstOrNull()?.ifEmpty { null }
        val description = kind == TrackKind.AUDIO && (rawRole == "description" || accessibility.isNotEmpty())
        val sign = kind == TrackKind.VIDEO && (rawRole == "sign" || accessibility.isNotEmpty())
        val role = when {
            description -> "description"
            kind == TrackKind.VIDEO -> rawRole ?: "main"
            else -> rawRole
        }
        val label = SafeXml.childText(set, "Label") ?: set.getAttribute("label").ifEmpty { null }
        val lang = set.getAttribute("lang").ifEmpty { null }
        val setBase = resolve(periodBase, SafeXml.childText(set, "BaseURL")) ?: periodBase
        val setId = set.getAttribute("id").ifEmpty { "as$index" }
        val isProtected = SafeXml.children(set, "ContentProtection").isNotEmpty() ||
            representations.any { SafeXml.children(it, "ContentProtection").isNotEmpty() }
        var textFormat: String? = null
        var textUrl: String? = null
        var template: SegmentTemplate? = null
        if (kind == TrackKind.TEXT) {
            textFormat = when {
                mime.contains("vtt") || lowerCodecs.contains("wvtt") -> "vtt"
                mime.contains("ttml") || lowerCodecs.contains("stpp") -> "ttml"
                else -> null
            }
            val ancestors = listOfNotNull(best, set, set.parentNode as? Element)
            val listElement = ancestors.firstNotNullOfOrNull { SafeXml.child(it, "SegmentList") }
            val templates = ancestors.mapNotNull { SafeXml.child(it, "SegmentTemplate") }
            val templateElement = templates.firstOrNull()
            template = try {
                if (listElement != null) segmentTemplate(listOf(listElement), periodStart, periodDuration, true)
                else templates.takeIf { it.isNotEmpty() }?.let { segmentTemplate(it, periodStart, periodDuration, false) }
            } catch (_: ManifestException) { return null }
            val repBase = best?.let { SafeXml.childText(it, "BaseURL") }
            textUrl = when {
                repBase != null -> resolve(setBase, repBase)
                template == null && templateElement != null ->
                    resolve(setBase, templateElement.getAttribute("initialization").ifEmpty { templateElement.getAttribute("media") })
                else -> null
            }
            if (textUrl == null && template == null) return null
        }
        val representationId = best?.getAttribute("id")?.ifEmpty { null }
        return MediaTrack(
            id = "$periodId/$setId",
            kind = kind,
            language = lang,
            role = role,
            label = label,
            codecs = codecs,
            mimeType = mime.ifEmpty { null },
            bandwidth = best?.getAttribute("bandwidth")?.toLongOrNull() ?: 0,
            width = attribute("width")?.toIntOrNull(),
            height = attribute("height")?.toIntOrNull(),
            audioDescription = description,
            signLanguage = sign,
            protected = isProtected,
            textFormat = textFormat,
            textUrl = textUrl,
            segmentTemplate = template,
            baseUrl = best?.let { resolve(setBase, SafeXml.childText(it, "BaseURL")) } ?: setBase,
            representationId = representationId,
        )
    }

    private fun segmentTemplate(elements: List<Element>, periodStart: Double, periodDuration: Double?, isList: Boolean): SegmentTemplate? {
        fun attribute(name: String) = elements.firstOrNull { it.hasAttribute(name) }?.getAttribute(name).orEmpty()
        val media = attribute("media").ifEmpty { if (isList) "" else return null }
        val timescale = attribute("timescale").toLongOrNull()?.takeIf { it > 0 } ?: 1
        val offset = attribute("presentationTimeOffset").toLongOrNull() ?: 0
        val timeline = elements.firstNotNullOfOrNull { SafeXml.child(it, "SegmentTimeline") }
        val entries = timeline?.let { SafeXml.children(it, "S") }.orEmpty()
        val segments = mutableListOf<TextSegment>()
        var time = 0L
        for ((index, entry) in entries.withIndex()) {
            time = entry.getAttribute("t").toLongOrNull() ?: time
            val duration = entry.getAttribute("d").toLongOrNull()?.takeIf { it > 0 }
                ?: throw ManifestException("Invalid text segment duration")
            val repeat = entry.getAttribute("r").toLongOrNull() ?: 0
            val count = if (repeat >= 0) repeat.toDouble() + 1 else {
                val end = entries.getOrNull(index + 1)?.getAttribute("t")?.toLongOrNull()?.toDouble()
                    ?: periodDuration?.let { it * timescale + offset }
                    ?: throw ManifestException("Unbounded text segment timeline")
                kotlin.math.ceil((end - time) / duration)
            }
            if (!count.isFinite() || count < 1 || count > 10_000 - segments.size) throw ManifestException("Text timeline exceeds limit")
            repeat(count.toInt()) {
                segments += TextSegment(time, duration)
                time = try { Math.addExact(time, duration) } catch (_: ArithmeticException) { throw ManifestException("Text timeline overflow") }
            }
        }
        val duration = attribute("duration").toLongOrNull()?.takeIf { it > 0 } ?: segments.firstOrNull()?.duration ?: return null
        if (isList) {
            val urls = SafeXml.children(elements.first(), "SegmentURL")
            if (urls.size > 10_000 || (segments.isNotEmpty() && urls.size != segments.size)) throw ManifestException("Invalid text segment list")
            for ((index, entry) in urls.withIndex()) {
                if (entry.hasAttribute("mediaRange")) throw ManifestException("Text byte ranges are unsupported")
                val path = entry.getAttribute("media").ifEmpty { throw ManifestException("Missing text segment URL") }
                if (timeline == null) {
                    val start = try { Math.multiplyExact(index.toLong(), duration) } catch (_: ArithmeticException) { throw ManifestException("Text timeline overflow") }
                    segments += TextSegment(start, duration, path)
                } else segments[index] = segments[index].copy(url = path)
            }
        }
        return SegmentTemplate(
            attribute("initialization").ifEmpty { null }, media, timescale, duration,
            attribute("startNumber").toLongOrNull() ?: 1, offset, segments, periodStart,
        )
    }

    /** RFC 3986 resolution; only HTTP(S) results are accepted. */
    fun resolve(base: String, relative: String?): String? {
        if (relative.isNullOrBlank()) return null
        return runCatching {
            val resolved = URI(base).resolve(URI(relative.trim()))
            resolved.takeIf { it.scheme?.lowercase(Locale.ROOT) in setOf("http", "https") && it.rawUserInfo == null }?.toString()
        }.getOrNull()
    }

    private val durationPattern = Regex(
        "^P(?:(\\d+(?:\\.\\d+)?)Y)?(?:(\\d+(?:\\.\\d+)?)M)?(?:(\\d+(?:\\.\\d+)?)D)?" +
            "(?:T(?:(\\d+(?:\\.\\d+)?)H)?(?:(\\d+(?:\\.\\d+)?)M)?(?:(\\d+(?:\\.\\d+)?)S)?)?$",
    )

    fun parseDuration(value: String?): Double? {
        val match = value?.trim()?.let(durationPattern::matchEntire) ?: return null
        val factors = listOf(31_536_000.0, 2_592_000.0, 86_400.0, 3_600.0, 60.0, 1.0)
        val total = match.groupValues.drop(1).zip(factors).sumOf { (part, factor) -> (part.toDoubleOrNull() ?: 0.0) * factor }
        return total.takeIf { it > 0 }
    }

    fun parseDateTime(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }
}

/** Minimal HLS multivariant parser: renditions and variants (PRD-007-R06). */
object HlsParser {
    fun parse(text: String, playlistUrl: String): MediaManifest {
        if (text.length > MpdParser.MAX_BYTES || !text.trimStart().startsWith("#EXTM3U")) throw ManifestException("Malformed HLS playlist")
        val tracks = mutableListOf<MediaTrack>()
        val lines = text.lineSequence().map { it.trim() }.toList()
        var ended = false
        var variantIndex = 0
        lines.forEachIndexed { index, line ->
            when {
                line.startsWith("#EXT-X-ENDLIST") || line == "#EXT-X-PLAYLIST-TYPE:VOD" -> ended = true
                line.startsWith("#EXT-X-MEDIA:") -> {
                    val attributes = attributes(line.substringAfter(':'))
                    val kind = when (attributes["TYPE"]) {
                        "AUDIO" -> TrackKind.AUDIO
                        "SUBTITLES" -> TrackKind.TEXT
                        "VIDEO" -> TrackKind.VIDEO
                        else -> return@forEachIndexed
                    }
                    val characteristics = attributes["CHARACTERISTICS"].orEmpty()
                    val description = characteristics.contains("public.accessibility.describes-video")
                    val name = attributes["NAME"]
                    tracks += MediaTrack(
                        id = "${attributes["GROUP-ID"].orEmpty()}/${name.orEmpty()}",
                        kind = kind,
                        language = attributes["LANGUAGE"],
                        role = if (description) "description" else if (attributes["DEFAULT"] == "YES") "main" else "alternate",
                        label = name,
                        codecs = null,
                        mimeType = null,
                        bandwidth = 0,
                        width = null,
                        height = null,
                        audioDescription = description,
                        textFormat = if (kind == TrackKind.TEXT) "vtt" else null,
                        textUrl = attributes["URI"]?.let { MpdParser.resolve(playlistUrl, it) },
                    )
                }
                line.startsWith("#EXT-X-STREAM-INF:") && tracks.none { it.kind == TrackKind.VIDEO && it.id.startsWith("variant") } -> {
                    val attributes = attributes(line.substringAfter(':'))
                    val resolution = attributes["RESOLUTION"]?.split('x')
                    if (lines.getOrNull(index + 1)?.startsWith("#") == false) {
                        tracks += MediaTrack(
                            id = "variant${variantIndex++}", kind = TrackKind.VIDEO, language = null, role = "main",
                            label = null, codecs = attributes["CODECS"], mimeType = null,
                            bandwidth = attributes["BANDWIDTH"]?.toLongOrNull() ?: 0,
                            width = resolution?.getOrNull(0)?.toIntOrNull(), height = resolution?.getOrNull(1)?.toIntOrNull(),
                        )
                    }
                }
            }
        }
        val mediaPlaylist = lines.none { it.startsWith("#EXT-X-STREAM-INF") } && lines.any { it.startsWith("#EXTINF") }
        if (mediaPlaylist) tracks += MediaTrack("media", TrackKind.AUDIO, null, "main", null, null, null, 0, null, null)
        // A multivariant playlist carries no liveness; the player reports it once media loads.
        return MediaManifest(playlistUrl, mediaPlaylist && !ended, null, null, null, null, null, tracks)
    }

    private fun attributes(list: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        Regex("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)").findAll(list).forEach {
            result[it.groupValues[1]] = it.groupValues[2].removeSurrounding("\"")
        }
        return result
    }
}

/** DOM parsing without DTDs or external entities, for untrusted XML. */
internal object SafeXml {
    fun parse(xml: String, maxChars: Int): Element? {
        if (xml.length > maxChars || xml.contains("<!DOCTYPE", ignoreCase = true) || '\u0000' in xml) return null
        return try {
            val factory = DocumentBuilderFactory.newInstance()
            factory.isNamespaceAware = true
            factory.isExpandEntityReferences = false
            runCatching { factory.isXIncludeAware = false }
            runCatching { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
            val builder = factory.newDocumentBuilder()
            builder.setEntityResolver { _, _ -> throw SAXException("External entities are not allowed") }
            builder.setErrorHandler(object : DefaultHandler() {
                override fun error(exception: SAXParseException) { throw exception }
                override fun fatalError(exception: SAXParseException) { throw exception }
            })
            builder.parse(InputSource(StringReader(xml))).documentElement
        } catch (_: Exception) { null }
    }

    fun children(parent: Element, name: String): List<Element> {
        val nodes = parent.childNodes
        return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }.filter { (it.localName ?: it.nodeName) == name }
    }

    fun child(parent: Element, name: String): Element? = children(parent, name).firstOrNull()

    fun childText(parent: Element, name: String): String? = child(parent, name)?.textContent?.trim()?.ifEmpty { null }
}
