package mediasync.app.subtitles

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mediasync.core.Cue
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SubtitleEnvelopeTest {
    @Test
    fun carriesCuesAndSkipsNonFiniteTimes() {
        val envelope = Json.parseToJsonElement(SubtitleEnvelope.cues(true, listOf(
            Cue(1.5, 3.0, "line \"one\"\n<two>"),
            Cue(Double.NaN, 4.0, "broken"),
        ))).jsonObject
        assertEquals(1, envelope.getValue("version").jsonPrimitive.int)
        assertEquals("subtitle-cues", envelope.getValue("type").jsonPrimitive.content)
        assertTrue(envelope.getValue("active").jsonPrimitive.boolean)
        val cue = envelope.getValue("cues").jsonArray.single().jsonObject
        assertEquals(1.5, cue.getValue("start").jsonPrimitive.double)
        assertEquals(3.0, cue.getValue("end").jsonPrimitive.double)
        assertEquals("line \"one\"\n<two>", cue.getValue("text").jsonPrimitive.content)
    }

    @Test
    fun inactiveTrackHasNoCues() {
        val envelope = Json.parseToJsonElement(SubtitleEnvelope.cues(false, emptyList())).jsonObject
        assertFalse(envelope.getValue("active").jsonPrimitive.boolean)
        assertTrue(envelope.getValue("cues").jsonArray.isEmpty())
    }
}
