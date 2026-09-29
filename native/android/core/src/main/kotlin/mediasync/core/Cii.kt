package mediasync.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Bounded JSON helpers used at every network boundary. */
internal object JsonInput {
    const val MAX_MESSAGE_CHARS = 262_144
    const val MAX_DEPTH = 32

    fun parseObject(text: String, maxChars: Int = MAX_MESSAGE_CHARS): JsonObject? {
        if (text.length > maxChars) return null
        val element = runCatching { Json.parseToJsonElement(text) }.getOrNull() ?: return null
        if (depth(element) > MAX_DEPTH) return null
        return element as? JsonObject
    }

    fun depth(element: JsonElement, current: Int = 1): Int = when (element) {
        is JsonObject -> if (current > MAX_DEPTH) current else element.values.maxOfOrNull { depth(it, current + 1) } ?: current
        is JsonArray -> if (current > MAX_DEPTH) current else element.maxOfOrNull { depth(it, current + 1) } ?: current
        else -> current
    }

    fun string(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /**
     * Integer from a JSON number or decimal string, without going through
     * Double. Fractions (sent by some App2App compatibility servers) are rounded.
     */
    fun long(element: JsonElement?): Long? {
        val primitive = element as? JsonPrimitive ?: return null
        if (primitive is JsonNull) return null
        val text = primitive.content.trim()
        if (text.length > 64) return null
        return text.toLongOrNull() ?: text.toBigDecimalOrNull()
            ?.takeIf { it.scale() <= 64 && it.precision() - it.scale() <= 19 }
            ?.setScale(0, java.math.RoundingMode.HALF_UP)?.toBigInteger()
            ?.takeIf { it.bitLength() < 64 }?.toLong()
    }

    fun double(element: JsonElement?): Double? {
        val primitive = element as? JsonPrimitive ?: return null
        if (primitive is JsonNull || primitive.isString) return null
        return primitive.content.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    fun escape(value: String): String = JsonPrimitive(value).toString()
}

data class TimelineOption(val selector: String, val unitsPerTick: Long?, val unitsPerSecond: Long?) {
    /** Ticks per second derived from CII timelineProperties, when advertised. */
    val tickRate: Double?
        get() = if (unitsPerTick != null && unitsPerSecond != null && unitsPerTick > 0 && unitsPerSecond > 0)
            unitsPerSecond.toDouble() / unitsPerTick else null
}

/** Accumulated CSS-CII state; omitted properties keep their previous value. */
data class CiiState(
    val protocolVersion: String? = null,
    val contentId: String? = null,
    val contentIdStatus: String? = null,
    val presentationStatus: List<String> = emptyList(),
    val mrsUrl: String? = null,
    val wcUrl: String? = null,
    val tsUrl: String? = null,
    val teUrl: String? = null,
    val timelines: List<TimelineOption> = emptyList(),
) {
    val isPresentationFault: Boolean get() = presentationStatus.firstOrNull() == "fault"
}

class CiiTracker {
    enum class Field { CONTENT_ID, CONTENT_ID_STATUS, PRESENTATION_STATUS, WC_URL, TS_URL, TIMELINES, OTHER }
    data class Update(val state: CiiState, val changed: Set<Field>)

    var state = CiiState()
        private set

    fun reset() { state = CiiState() }

    /** Applies a CII message; null means the frame was not a valid CII object. */
    fun apply(text: String): Update? {
        val message = JsonInput.parseObject(text, 65_536) ?: return null
        var next = state
        val changed = mutableSetOf<Field>()
        fun <T> field(name: String, field: Field, read: (JsonElement) -> T?, update: (T?) -> CiiState) {
            val value = message[name] ?: return
            val parsed = if (value is JsonNull) null else read(value) ?: return
            val candidate = update(parsed)
            if (candidate != next) { next = candidate; changed.add(field) }
        }
        field("protocolVersion", Field.OTHER, JsonInput::string) { next.copy(protocolVersion = it) }
        field("contentId", Field.CONTENT_ID, JsonInput::string) { next.copy(contentId = it?.takeIf { v -> v.length <= 4096 }) }
        field("contentIdStatus", Field.CONTENT_ID_STATUS, JsonInput::string) { next.copy(contentIdStatus = it) }
        field("presentationStatus", Field.PRESENTATION_STATUS, ::presentation) { next.copy(presentationStatus = it ?: emptyList()) }
        field("mrsUrl", Field.OTHER, JsonInput::string) { next.copy(mrsUrl = it) }
        field("wcUrl", Field.WC_URL, JsonInput::string) { next.copy(wcUrl = it) }
        field("tsUrl", Field.TS_URL, JsonInput::string) { next.copy(tsUrl = it) }
        field("teUrl", Field.OTHER, JsonInput::string) { next.copy(teUrl = it) }
        field("timelines", Field.TIMELINES, ::timelines) { next.copy(timelines = it ?: emptyList()) }
        state = next
        return Update(next, changed)
    }

    private fun presentation(element: JsonElement): List<String>? = when (element) {
        is JsonArray -> element.mapNotNull(JsonInput::string).take(8)
        is JsonPrimitive -> JsonInput.string(element)?.split(' ')?.filter { it.isNotEmpty() }?.take(8)
        else -> null
    }

    private fun timelines(element: JsonElement): List<TimelineOption>? {
        val array = element as? JsonArray ?: return null
        return array.take(32).mapNotNull { item ->
            val entry = item as? JsonObject ?: return@mapNotNull null
            val selector = JsonInput.string(entry["timelineSelector"])?.takeIf { it.length <= 512 } ?: return@mapNotNull null
            val properties = entry["timelineProperties"] as? JsonObject
            TimelineOption(selector, JsonInput.long(properties?.get("unitsPerTick")), JsonInput.long(properties?.get("unitsPerSecond")))
        }
    }
}
