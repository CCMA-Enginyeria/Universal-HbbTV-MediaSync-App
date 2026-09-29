package mediasync.core

import org.w3c.dom.Element
import org.w3c.dom.Node

data class Cue(val startS: Double, val endS: Double, val text: String)

/** Parsers for the TTML (EBU-TT-D) and WebVTT subsets used by current broadcasters. */
object Subtitles {
    const val MAX_DOCUMENT_CHARS = 2 * 1_048_576
    const val MAX_CUES = 5_000
    private const val TTP = "http://www.w3.org/ns/ttml#parameter"

    fun parseTtml(xml: String): List<Cue> {
        val root = SafeXml.parse(xml, MAX_DOCUMENT_CHARS) ?: return emptyList()
        if (root.localName != "tt") return emptyList()
        val frameRate = root.getAttributeNS(TTP, "frameRate").toDoubleOrNull()?.takeIf { it > 0 } ?: 25.0
        val multiplier = root.getAttributeNS(TTP, "frameRateMultiplier").split(' ')
            .mapNotNull { it.toDoubleOrNull() }.takeIf { it.size == 2 && it[1] != 0.0 }?.let { it[0] / it[1] } ?: 1.0
        val tickRate = root.getAttributeNS(TTP, "tickRate").toDoubleOrNull()?.takeIf { it > 0 } ?: frameRate
        val timing = Timing(frameRate * multiplier, tickRate)
        val cues = mutableListOf<Cue>()
        val body = SafeXml.child(root, "body") ?: return emptyList()
        walk(body, 0.0, timing, cues)
        return cues.sortedBy { it.startS }
    }

    private class Timing(val frameRate: Double, val tickRate: Double)

    private fun walk(element: Element, parentBegin: Double, timing: Timing, cues: MutableList<Cue>) {
        if (cues.size >= MAX_CUES) return
        val begin = parentBegin + (parseTime(element.getAttribute("begin"), timing) ?: 0.0)
        if (element.localName == "p") {
            val end = parseTime(element.getAttribute("end"), timing)?.let { parentBegin + it }
                ?: parseTime(element.getAttribute("dur"), timing)?.let { begin + it }
                ?: return
            val text = text(element).lines().joinToString("\n") { it.replace(Regex("\\s+"), " ").trim() }.trim()
            if (text.isNotEmpty() && end > begin) cues.add(Cue(begin, end, text))
            return
        }
        val nodes = element.childNodes
        for (index in 0 until nodes.length) {
            val child = nodes.item(index) as? Element ?: continue
            if (child.localName == "div" || child.localName == "p") walk(child, begin, timing, cues)
        }
    }

    private fun text(node: Node): String {
        val builder = StringBuilder()
        val nodes = node.childNodes
        for (index in 0 until nodes.length) {
            val child = nodes.item(index)
            when {
                child.nodeType == Node.TEXT_NODE || child.nodeType == Node.CDATA_SECTION_NODE ->
                    builder.append(child.nodeValue.replace('\n', ' ').replace('\r', ' '))
                child is Element && child.localName == "br" -> builder.append('\n')
                child is Element && child.localName == "span" -> builder.append(text(child))
            }
        }
        return builder.toString()
    }

    private val clockTime = Regex("^(\\d+):(\\d{2}):(\\d{2})(?:\\.(\\d+))?$")
    private val frameTime = Regex("^(\\d+):(\\d{2}):(\\d{2}):(\\d+)(?:\\.(\\d+))?$")
    private val offsetTime = Regex("^(\\d+(?:\\.\\d+)?)(h|ms|m|s|f|t)$")

    private fun parseTime(value: String?, timing: Timing): Double? {
        val text = value?.trim()?.ifEmpty { null } ?: return null
        clockTime.matchEntire(text)?.let { match ->
            val (h, m, s, fraction) = match.destructured
            return h.toLong() * 3600 + m.toLong() * 60 + s.toLong() + (if (fraction.isEmpty()) 0.0 else "0.$fraction".toDouble())
        }
        frameTime.matchEntire(text)?.let { match ->
            val (h, m, s, frames, sub) = match.destructured
            val frameValue = frames.toDouble() + (if (sub.isEmpty()) 0.0 else "0.$sub".toDouble())
            return h.toLong() * 3600 + m.toLong() * 60 + s.toLong() + frameValue / timing.frameRate
        }
        offsetTime.matchEntire(text)?.let { match ->
            val amount = match.groupValues[1].toDouble()
            return when (match.groupValues[2]) {
                "h" -> amount * 3600
                "m" -> amount * 60
                "s" -> amount
                "ms" -> amount / 1000
                "f" -> amount / timing.frameRate
                else -> amount / timing.tickRate
            }
        }
        return null
    }

    private val vttTiming = Regex("((?:\\d+:)?\\d{2}:\\d{2}[.,]\\d{3})\\s*-->\\s*((?:\\d+:)?\\d{2}:\\d{2}[.,]\\d{3})")

    fun parseVtt(text: String): List<Cue> {
        if (text.length > MAX_DOCUMENT_CHARS) return emptyList()
        val lines = text.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val cues = mutableListOf<Cue>()
        var index = 0
        while (index < lines.size && cues.size < MAX_CUES) {
            val match = vttTiming.find(lines[index])
            index++
            if (match == null) continue
            val body = mutableListOf<String>()
            while (index < lines.size && lines[index].isNotBlank()) body += lines[index++]
            val cueText = cleanVtt(body.joinToString("\n"))
            val start = vttTime(match.groupValues[1])
            val end = vttTime(match.groupValues[2])
            if (cueText.isNotEmpty() && end > start) cues += Cue(start, end, cueText)
        }
        return cues.sortedBy { it.startS }
    }

    private fun vttTime(value: String): Double {
        val parts = value.replace(',', '.').split(':')
        val seconds = parts.last().toDouble()
        val minutes = parts[parts.size - 2].toLong()
        val hours = if (parts.size == 3) parts[0].toLong() else 0
        return hours * 3600 + minutes * 60 + seconds
    }

    private fun cleanVtt(text: String): String = text.replace(Regex("<[^>]+>"), "")
        .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&").trim()

    /**
     * Extracts the TTML document from the `mdat` box of an fMP4 (`stpp`)
     * segment. Handles 64-bit and to-end box sizes; returns null otherwise.
     */
    fun extractTtmlFromMp4(bytes: ByteArray): String? {
        var offset = 0L
        val length = bytes.size.toLong()
        while (offset + 8 <= length) {
            var size = uint32(bytes, offset.toInt())
            val type = String(bytes, offset.toInt() + 4, 4, Charsets.ISO_8859_1)
            var header = 8L
            if (size == 1L) {
                if (offset + 16 > length) return null
                size = (uint32(bytes, offset.toInt() + 8) shl 32) or uint32(bytes, offset.toInt() + 12)
                header = 16
            } else if (size == 0L) {
                size = length - offset
            }
            if (size < header || offset + size > length) return null
            if (type == "mdat") {
                val xml = String(bytes, (offset + header).toInt(), (size - header).toInt(), Charsets.UTF_8).trim()
                return xml.takeIf { it.startsWith("<") }
            }
            offset += size
        }
        return null
    }

    private fun uint32(bytes: ByteArray, offset: Int): Long =
        ((bytes[offset].toLong() and 0xFF) shl 24) or ((bytes[offset + 1].toLong() and 0xFF) shl 16) or
            ((bytes[offset + 2].toLong() and 0xFF) shl 8) or (bytes[offset + 3].toLong() and 0xFF)
}

/** Sorted cue list with overlap-aware lookup. One visible track at a time. */
class CueTrack(cues: List<Cue> = emptyList()) {
    private val sorted = cues.sortedBy { it.startS }
    val size: Int get() = sorted.size

    fun activeText(timeS: Double?): String? {
        if (timeS == null || sorted.isEmpty()) return null
        var low = 0
        var high = sorted.size
        while (low < high) {
            val mid = (low + high) ushr 1
            if (sorted[mid].startS <= timeS) low = mid + 1 else high = mid
        }
        return sorted.subList(0, low).filter { timeS < it.endS }.takeLast(4).joinToString("\n") { it.text }.ifEmpty { null }
    }
}

/**
 * Plans which segmented-TTML segments to download (live by wall clock, VOD by
 * position) and keeps a bounded cue buffer. I/O is done by the caller.
 */
class TextSegmentSchedule(
    private val template: SegmentTemplate,
    private val baseUrl: String,
    private val isLive: Boolean,
    private val availabilityStartTimeMs: Long?,
    private val representationId: String? = null,
    private val maxSegments: Int = 20,
) {
    private val buffer = ArrayDeque<Pair<Long, List<Cue>>>()
    private var lastFetched: Long? = null

    fun currentSegment(nowEpochMs: Long, positionS: Double?): Long {
        val elapsed = (positionS ?: if (isLive && availabilityStartTimeMs != null) (nowEpochMs - availabilityStartTimeMs) / 1000.0 else 0.0) - template.periodStartS
        if (elapsed < 0) return template.startNumber
        if (template.segments.isNotEmpty()) {
            val time = elapsed * template.timescale + template.presentationTimeOffset
            val index = template.segments.indexOfLast { it.time <= time }.coerceAtLeast(0)
            return template.startNumber + index
        }
        return template.startNumber + Math.floor(elapsed / template.segmentSeconds).toLong()
    }

    /** Segments not fetched yet up to the current one, starting one before it. */
    fun pending(nowEpochMs: Long, positionS: Double?): List<Long> {
        val current = currentSegment(nowEpochMs, positionS)
        if (lastFetched?.let { it > current || current - it > maxSegments } == true) reset()
        val last = lastFetched
        val start = if (last == null || last > current || current - last > maxSegments) current - 1 else last + 1
        return (maxOf(start, template.startNumber)..current).toList().takeLast(maxSegments)
    }

    fun url(number: Long): String? {
        val segment = if (template.segments.isEmpty()) null else template.segments.getOrNull((number - template.startNumber).toInt()) ?: return null
        if (segment?.url != null) return MpdParser.resolve(baseUrl, segment.url)
        val path = Regex("\\$(Number|Time|RepresentationID)(%0(\\d+)d)?\\$").replace(template.media) { match ->
            when (match.groupValues[1]) {
                "Time" -> (segment?.time ?: ((number - template.startNumber) * template.duration)).toString()
                "Number" -> match.groupValues[3].toIntOrNull()?.let { width -> number.toString().padStart(width.coerceAtMost(12), '0') }
                    ?: number.toString()
                else -> representationId.orEmpty()
            }
        }.replace("$$", "$")
        return MpdParser.resolve(baseUrl, path)
    }

    /** Records a fetched segment; cues are shifted by the presentation time offset. */
    fun complete(number: Long, cues: List<Cue>) {
        lastFetched = maxOf(lastFetched ?: number, number)
        buffer.removeAll { it.first == number }
        if (cues.isEmpty()) return
        val offset = template.presentationTimeOffsetSeconds - template.periodStartS
        buffer.addLast(number to cues.map { it.copy(startS = it.startS - offset, endS = it.endS - offset) })
        while (buffer.size > maxSegments) buffer.removeFirst()
    }

    fun cues(): List<Cue> = buffer.flatMap { it.second }

    fun reset() {
        buffer.clear()
        lastFetched = null
    }
}
