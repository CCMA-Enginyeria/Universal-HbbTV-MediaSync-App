package mediasync.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Shared fixtures in native/fixtures/protocol; the Swift suite asserts the same cases. */
class ProtocolFixturesTest {
    private val directory = File(System.getProperty("mediasync.fixtures"), "protocol")
    private val cases = Json.parseToJsonElement(File(directory, "cases.json").readText()).jsonObject

    private fun list(name: String) = cases.getValue(name).jsonArray.map { it.jsonObject }
    private fun JsonObject.str(name: String): String? = this[name]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content
    private fun JsonElement.isNull() = this is JsonNull
    private fun hex(value: String) = ByteArray(value.length / 2) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    @Test fun wallClockPackets() {
        for (case in list("wallClock")) {
            val decoded = WallClockMessage.decode(hex(case.str("hex")!!))
            val expect = case.getValue("expect")
            if (expect.isNull()) {
                assertNull(decoded, case.str("name"))
                continue
            }
            val e = expect.jsonObject
            assertNotNull(decoded, case.str("name"))
            assertEquals(e.str("type")!!.toInt(), decoded.type)
            assertEquals(e.str("precision")!!.toInt(), decoded.precision)
            assertEquals(e.str("maxFreqError")!!.toLong(), decoded.maxFreqError)
            assertEquals(e.str("originate")!!.toLong(), decoded.originateNanos)
            assertEquals(e.str("receive")!!.toLong(), decoded.receiveNanos)
            assertEquals(e.str("transmit")!!.toLong(), decoded.transmitNanos)
        }
    }

    @Test fun wallClockRequestRoundTrip() {
        val bytes = WallClockMessage.request(4_294_967_295_999_999_999)
        assertEquals(32, bytes.size)
        bytes[1] = 1
        assertEquals(4_294_967_295_999_999_999, WallClockMessage.decode(bytes)?.originateNanos)
    }

    @Test fun timelineMessages() {
        for (case in list("timeline")) {
            val parsed = TimelineProtocol.parse(case.str("text")!!)
            val expect = case.getValue("expect")
            when {
                expect.isNull() -> assertNull(parsed, case.str("text"))
                expect is kotlinx.serialization.json.JsonPrimitive -> assertEquals(TimelineMessage.Unavailable, parsed, case.str("text"))
                else -> {
                    val e = expect.jsonObject
                    val available = assertIs<TimelineMessage.Available>(parsed, case.str("text"))
                    assertEquals(e.str("contentTime")!!.toLong(), available.timestamp.contentTime)
                    assertEquals(e.str("wallClockTime")!!.toLong(), available.timestamp.wallClockTime)
                    assertEquals(e.str("speed")!!.toDouble(), available.timestamp.speed)
                }
            }
        }
    }

    private fun advertised(element: JsonElement?): List<TimelineOption> = (element as? JsonArray)?.map { entry ->
        when (entry) {
            is JsonArray -> TimelineOption(entry[0].jsonPrimitive.content, entry[1].jsonPrimitive.content.toLong(), entry[2].jsonPrimitive.content.toLong())
            else -> TimelineOption(entry.jsonPrimitive.content, null, null)
        }
    } ?: emptyList()

    @Test fun tickRatesAndSelection() {
        for (case in list("tickRate")) {
            val rate = TimelineProtocol.tickRate(case.str("selector")!!, advertised(case["advertised"]))
            assertEquals(case.str("expect")?.toDouble(), rate, case.toString())
        }
        for (case in list("timelineSelection")) {
            assertEquals(case.str("expect"), TimelineProtocol.select(case.str("configured")!!, advertised(case["advertised"])), case.toString())
        }
    }

    @Test fun ciiSequences() {
        for (case in list("cii")) {
            val tracker = CiiTracker()
            var last: CiiTracker.Update? = null
            case.getValue("messages").jsonArray.forEach { message -> tracker.apply(message.jsonPrimitive.content)?.let { last = it } }
            val e = case.getValue("expect").jsonObject
            val name = case.str("name")
            assertEquals(e.str("contentId"), tracker.state.contentId, name)
            assertEquals(e.getValue("presentationStatus").jsonArray.map { it.jsonPrimitive.content }, tracker.state.presentationStatus, name)
            assertEquals(e.str("wcUrl"), tracker.state.wcUrl, name)
            assertEquals(e.str("tsUrl"), tracker.state.tsUrl, name)
            assertEquals(advertised(e["timelines"]), tracker.state.timelines, name)
            val changed = e.getValue("changed").jsonArray.map { CiiTracker.Field.valueOf(it.jsonPrimitive.content) }.toSet()
            assertEquals(changed, last?.changed ?: emptySet(), name)
        }
    }

    @Test fun endpointRepairAndUdp() {
        for (case in list("endpoints")) {
            assertEquals(case.str("expect"), Endpoints.repair(case.str("url"), case.str("host")), case.toString())
        }
        for (case in list("udp")) {
            val expect = case["expect"] as? JsonArray
            val parsed = Endpoints.parseUdp(case.str("url"))
            assertEquals(expect?.let { Endpoints.UdpEndpoint(it[0].jsonPrimitive.content, it[1].jsonPrimitive.content.toInt()) }, parsed, case.toString())
        }
        for (case in list("preferenceKeys")) {
            assertEquals(case.str("expect"), Endpoints.preferenceKey(case.str("manufacturer"), case.str("modelName"), case.str("location")))
        }
    }

    @Test fun contentClassification() {
        for (case in list("classify")) {
            assertEquals(ContentKind.valueOf(case.str("expect")!!), ContentClassifier.classify(case.str("contentId")), case.toString())
        }
        assertEquals("https://x/a.mpd", ContentClassifier.resolve(null, "https://x/a.mpd"))
        assertEquals("dvb://1", ContentClassifier.resolve("dvb://1", "https://x/a.mpd"))
    }

    @Test fun manifests() {
        for (case in list("manifests")) {
            val file = case.str("file")!!
            val text = File(directory, file).readText()
            val url = case.str("url")!!
            val manifest = if (file.endsWith(".m3u8")) HlsParser.parse(text, url) else MpdParser.parse(text, url)
            val e = case.getValue("expect").jsonObject
            assertEquals(e.str("isLive")!!.toBoolean(), manifest.isLive, file)
            assertEquals(e.str("durationS")?.toDouble(), manifest.durationS, file)
            assertEquals(e.str("availabilityStartTimeMs")?.toLong(), manifest.availabilityStartTimeMs, file)
            e.str("timeShiftBufferDepthS")?.let { assertEquals(it.toDouble(), manifest.timeShiftBufferDepthS) }
            val expected = e.getValue("tracks").jsonArray.map { it.jsonObject }
            assertEquals(expected.size, manifest.tracks.size, file)
            expected.zip(manifest.tracks).forEach { (t, track) ->
                val context = "$file ${t.str("id")}"
                assertEquals(t.str("id"), track.id, context)
                assertEquals(TrackKind.valueOf(t.str("kind")!!), track.kind, context)
                assertEquals(t.str("language"), track.language, context)
                assertEquals(t.str("role"), track.role, context)
                assertEquals(t.str("label"), track.label, context)
                assertEquals(t.str("bandwidth")!!.toLong(), track.bandwidth, context)
                assertEquals(t.str("width")?.toInt(), track.width, context)
                assertEquals(t.str("height")?.toInt(), track.height, context)
                assertEquals(t.str("audioDescription")!!.toBoolean(), track.audioDescription, context)
                assertEquals(t.str("signLanguage")!!.toBoolean(), track.signLanguage, context)
                assertEquals(t.str("protected")!!.toBoolean(), track.protected, context)
                assertEquals(t.str("textFormat"), track.textFormat, context)
                assertEquals(t.str("textUrl"), track.textUrl, context)
            }
            val segments = case["segments"] as? JsonObject ?: continue
            val track = manifest.text.first()
            val schedule = TextSegmentSchedule(assertNotNull(track.segmentTemplate), track.baseUrl!!, manifest.isLive,
                manifest.availabilityStartTimeMs, track.representationId)
            val now = manifest.availabilityStartTimeMs!! + segments.str("nowOffsetMs")!!.toLong()
            assertEquals(segments.getValue("pending").jsonArray.map { it.jsonPrimitive.content.toLong() }, schedule.pending(now, null))
            assertEquals(segments.str("url21"), schedule.url(21))
            schedule.complete(21, listOf(Cue(20.0, 22.0, "a")))
            assertEquals(20.0 - segments.str("ptoS")!!.toDouble(), schedule.cues().single().startS)
            assertEquals(listOf(22L), schedule.pending(now + 6_000, null))
        }
    }

    @Test fun subtitles() {
        for (case in list("subtitles")) {
            val text = File(directory, case.str("file")!!).readText()
            val cues = if (case.str("format") == "ttml") Subtitles.parseTtml(text) else Subtitles.parseVtt(text)
            val expected = case.getValue("expect").jsonArray.map { it.jsonArray }
            assertEquals(expected.size, cues.size, case.str("file"))
            expected.zip(cues).forEach { (e, cue) ->
                assertEquals(e[0].jsonPrimitive.content.toDouble(), cue.startS, 1e-9)
                assertEquals(e[1].jsonPrimitive.content.toDouble(), cue.endS, 1e-9)
                assertEquals(e[2].jsonPrimitive.content, cue.text)
            }
            val track = CueTrack(cues)
            case.getValue("active").jsonArray.map { it.jsonArray }.forEach { (time, text) ->
                assertEquals(text.takeUnless { it is JsonNull }?.jsonPrimitive?.content, track.activeText(time.jsonPrimitive.content.toDouble()))
            }
        }
    }

    @Test fun liveCatalogRefreshPreservesIdentityAndBoundsPolling() {
        val first = MediaTrack("p/en", TrackKind.AUDIO, "en", "main", "English", null, null, 0, null, null)
        val second = first.copy(id = "p/es", language = "es")
        val manifest = MediaManifest("https://example.test/live.mpd", true, null, null, 0.0, null, null, listOf(second, first))
        assertEquals(first, manifest.refreshedTrack(first))
        assertEquals(1_000L, manifest.refreshDelayMs)
        assertEquals(60_000L, manifest.copy(minimumUpdatePeriodS = 900.0).refreshDelayMs)
        assertEquals(5_000L, manifest.copy(minimumUpdatePeriodS = Double.NaN).refreshDelayMs)
        assertNull(manifest.copy(isLive = false).refreshDelayMs)
        assertEquals(1_000L, manifest.copy(isLive = false, url = "https://example.test/master.m3u8").refreshDelayMs)
        assertNull(manifest.copy(tracks = listOf(second)).refreshedTrack(first))
        assertNull(manifest.copy(tracks = listOf(first.copy(protected = true))).refreshedTrack(first))
        val nextPeriod = first.copy(id = "next/en")
        assertEquals(nextPeriod, manifest.copy(tracks = listOf(nextPeriod)).refreshedTrack(first))
    }

    @Test fun liveCatalogRefreshRejectsReusedIdentityForAnotherLanguageOrRole() {
        val previous = MediaTrack("p/audio", TrackKind.AUDIO, "en", "main", "English", null, null, 0, null, null)
        val replacement = previous.copy(id = "next/audio")
        val manifest = MediaManifest("https://example.test/live.mpd", true, null, null, null, null, null,
            listOf(previous.copy(language = "es"), replacement))
        assertEquals(replacement, manifest.refreshedTrack(previous))
        assertEquals(replacement, manifest.copy(tracks = listOf(previous.copy(role = "alternate"), replacement)).refreshedTrack(previous))
        assertNull(manifest.copy(tracks = listOf(previous.copy(language = "es"))).refreshedTrack(previous))
        assertNull(manifest.copy(tracks = listOf(previous.copy(role = "alternate"))).refreshedTrack(previous))
        val noRole = previous.copy(role = null)
        val emptyRole = previous.copy(role = "")
        assertEquals(emptyRole, manifest.copy(tracks = listOf(replacement.copy(role = null), emptyRole)).refreshedTrack(noRole))
    }

    @Test fun subtitleScheduleResetsAfterSeekAndReplacesSegments() {
        val template = SegmentTemplate(null, "text-${'$'}Number${'$'}.m4s", 1, 2, 1, 0)
        val schedule = TextSegmentSchedule(template, "https://example.test/", false, null)
        assertEquals(listOf(10L, 11L), schedule.pending(0, 20.0))
        schedule.complete(11, listOf(Cue(20.0, 22.0, "old")))
        schedule.complete(11, listOf(Cue(20.0, 22.0, "new")))
        assertEquals(listOf(Cue(20.0, 22.0, "new")), schedule.cues())
        assertEquals(listOf(1L, 2L), schedule.pending(0, 2.0))
        assertTrue(schedule.cues().isEmpty())
        schedule.complete(2, emptyList())
        assertTrue(schedule.pending(0, 2.0).isEmpty())
        assertEquals(listOf(3L), schedule.pending(0, 4.0))
        assertEquals(listOf(3L), schedule.pending(0, 4.0))
    }

    @Test fun textTimelineAndListResolvePeriodOffsets() {
        val xml = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period start="PT10S" duration="PT6S">
            <SegmentTemplate timescale="10" presentationTimeOffset="100" media="text-${'$'}Time${'$'}.xml"/>
            <AdaptationSet contentType="text" mimeType="application/ttml+xml">
              <SegmentTemplate><SegmentTimeline><S t="100" d="20" r="-1"/></SegmentTimeline></SegmentTemplate>
              <Representation id="text"><BaseURL>captions/</BaseURL></Representation>
            </AdaptationSet></Period></MPD>"""
        val manifest = MpdParser.parse(xml, "https://example.test/stream.mpd")
        val track = manifest.text.single()
        val schedule = TextSegmentSchedule(track.segmentTemplate!!, track.baseUrl!!, false, null)
        assertEquals(listOf(1L, 2L), schedule.pending(0, 12.0))
        assertEquals("https://example.test/captions/text-120.xml", schedule.url(2))
        assertNull(schedule.url(4))
        schedule.complete(2, listOf(Cue(12.0, 14.0, "caption")))
        assertEquals(Cue(12.0, 14.0, "caption"), schedule.cues().single())
        val list = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet contentType="text" mimeType="text/vtt">
            <SegmentList duration="2"><SegmentURL media="one.vtt"/><SegmentURL media="two.vtt"/></SegmentList>
            </AdaptationSet></Period></MPD>"""
        val listed = MpdParser.parse(list, manifest.url).text.single()
        val listedSchedule = TextSegmentSchedule(listed.segmentTemplate!!, listed.baseUrl!!, false, null)
        assertEquals("https://example.test/two.vtt", listedSchedule.url(2))
        assertNull(listedSchedule.url(3))
    }

        @Test fun unsupportedTextTimelineDoesNotDiscardAudio() {
                val xml = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>
                    <AdaptationSet contentType="audio"><Representation id="audio"/></AdaptationSet>
                    <AdaptationSet contentType="text" mimeType="application/ttml+xml">
                        <SegmentTemplate media="text-${'$'}Time${'$'}.xml"><SegmentTimeline><S d="2" r="-1"/></SegmentTimeline></SegmentTemplate>
                    </AdaptationSet></Period></MPD>"""
                val manifest = MpdParser.parse(xml, "https://example.test/live.mpd")
                assertEquals(1, manifest.audio.size)
                assertTrue(manifest.text.isEmpty())
        }

    @Test fun companionEnvelopes() {
        val companion = cases.getValue("companion").jsonObject
        for (case in companion.getValue("valid").jsonArray.map { it.jsonObject }) {
            when (val parsed = CompanionProtocol.parse(case.str("text")!!)) {
                is CompanionProtocol.Inbound.SyncAck -> assertEquals("sync-ack", case.str("type"))
                is CompanionProtocol.Inbound.AppMessage -> {
                    assertEquals(case.str("messageType"), parsed.type)
                    assertEquals(case.str("id"), parsed.id)
                    assertEquals(Json.parseToJsonElement(case.str("payload")!!), parsed.payload)
                }
                null -> error("Rejected valid envelope ${case.str("text")}")
            }
        }
        companion.getValue("invalid").jsonArray.forEach { assertNull(CompanionProtocol.parse(it.jsonPrimitive.content), it.toString()) }
        companion.getValue("origins").jsonArray.map { it.jsonArray }.forEach { (url, origin) ->
            assertEquals(origin.takeUnless { it is JsonNull }?.jsonPrimitive?.content, CompanionProtocol.origin(url.jsonPrimitive.content))
        }
        val payload = companion.str("injectionPayload")!! + "\u2028"
        val script = CompanionProtocol.webViewInjection(payload)
        assertTrue('\u2028' !in script)
        val literal = script.substringAfter("var m=").substringBefore(";var o=")
        assertEquals(payload, Json.parseToJsonElement(literal).jsonPrimitive.content)
    }

    @Test fun modeSelectionMatrix() {
        for (case in list("modeSelection")) {
            val availability = mapOf(
                SyncMode.NATIVE to Availability.valueOf(case.str("native")!!),
                SyncMode.COMPAT to Availability.valueOf(case.str("compat")!!),
            )
            assertEquals(case.str("expect")?.let(SyncMode::valueOf), ModeSelection.effective(SyncMode.valueOf(case.str("preferred")!!), availability), case.toString())
        }
    }
}
