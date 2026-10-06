package mediasync.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Records transport calls and lets tests play the television's side. */
class FakeTransport : Transport {
    data class Resource(val token: Long, val url: String, val events: TransportEvents, val udp: Boolean)
    data class Timer(val token: Long, val delayMs: Long, val events: TransportEvents)

    val open = linkedMapOf<Long, Resource>()
    val timers = linkedMapOf<Long, Timer>()
    val sent = mutableListOf<Pair<Long, String>>()
    val datagrams = mutableListOf<Pair<Long, ByteArray>>()
    val closed = mutableListOf<Long>()

    override fun openWebSocket(token: Long, url: String, events: TransportEvents) { open[token] = Resource(token, url, events, false) }
    override fun openUdp(token: Long, host: String, port: Int, events: TransportEvents) { open[token] = Resource(token, "udp://$host:$port", events, true) }
    override fun sendText(token: Long, text: String): Boolean { if (token !in open) return false; sent += token to text; return true }
    override fun sendDatagram(token: Long, data: ByteArray): Boolean { if (token !in open) return false; datagrams += token to data; return true }
    override fun close(token: Long) { if (open.remove(token) != null) closed += token }
    override fun schedule(token: Long, delayMs: Long, events: TransportEvents) { timers[token] = Timer(token, delayMs, events) }
    override fun cancel(token: Long) { timers.remove(token) }

    fun socket(urlSuffix: String): Resource = open.values.last { it.url.endsWith(urlSuffix) }
    fun opened(urlSuffix: String) = socket(urlSuffix).let { it.events.onOpened(it.token); it }
    fun text(resource: Resource, text: String) = resource.events.onText(resource.token, text)
    fun fire(delayMs: Long) = timers.values.filter { it.delayMs == delayMs }.forEach { timers.remove(it.token); it.events.onTimer(it.token) }
    fun remoteClose(resource: Resource) { open.remove(resource.token); resource.events.onClosed(resource.token, true) }
}

class ManualClock(var now: Long = 5_000_000_000L) : MonotonicClock {
    override fun nanos() = now
}

class MediaSyncSessionTest {
    private val transport = FakeTransport()
    private val clock = ManualClock()
    private val snapshots = mutableListOf<MediaSyncSession.Snapshot>()
    private val contents = mutableListOf<String?>()
    private val appMessages = mutableListOf<App2AppChannel.Message>()
    private val session = MediaSyncSession(transport, clock, object : MediaSyncSession.Listener {
        override fun onSnapshot(snapshot: MediaSyncSession.Snapshot) { snapshots += snapshot }
        override fun onContentChanged(generation: Long, contentId: String?) { contents += contentId }
        override fun onAppMessage(generation: Long, message: App2AppChannel.Message) { appMessages += message }
    })
    private val state get() = snapshots.last().state
    private val issue get() = snapshots.last().issue

    private fun cii(content: String = "https://cdn/a.mpd", wc: String = "udp://0.0.0.0:6677", ts: String = "ws://10.0.0.2:7681/ts") =
        """{"contentId":"$content","presentationStatus":["okay"],"wcUrl":"$wc","tsUrl":"$ts",
           "timelines":[{"timelineSelector":"urn:dvb:css:timeline:pts","timelineProperties":{"unitsPerTick":1,"unitsPerSecond":90000}}]}"""

    /**
     * Answers the last UDP request as a TV whose wall clock is `offset` ahead,
     * with symmetric delay. Returns the session's local time after the reply.
     */
    private fun answerWallClock(offsetNanos: Long, oneWayNanos: Long = 2_000_000): Long {
        val (token, request) = transport.datagrams.last()
        val originate = WallClockMessage.decode(request.copyOf().also { it[1] = 1 })!!.originateNanos
        val receive = originate + oneWayNanos + offsetNanos
        clock.now += 2 * oneWayNanos
        val response = WallClockMessage.request(originate).also { it[1] = 1 }
        fun put(offset: Int, nanos: Long) {
            val seconds = nanos / 1_000_000_000L
            val fraction = nanos % 1_000_000_000L
            for (i in 0..3) response[offset + i] = (seconds ushr (24 - 8 * i)).toByte()
            for (i in 0..3) response[offset + 4 + i] = (fraction ushr (24 - 8 * i)).toByte()
        }
        put(16, receive)
        put(24, receive)
        transport.open.getValue(token).events.onDatagram(token, response, 0)
        return originate + 2 * oneWayNanos
    }

    private fun config(mode: SyncMode = SyncMode.NATIVE) = MediaSyncSession.Config(
        mode, "ws://0.0.0.0:7681/cii", "ws://10.0.0.2:7681/app2app", "10.0.0.2")

    @Test fun nativeFlowReachesSynchronisedAndExtrapolates() {
        session.start(config())
        assertEquals(MediaSyncSession.State.CONNECTING, state)
        val cii = transport.opened("/cii")
        assertEquals("ws://10.0.0.2:7681/cii", cii.url)
        assertEquals(MediaSyncSession.State.WAITING_CONTENT, state)
        transport.text(cii, cii())
        assertEquals(listOf<String?>("https://cdn/a.mpd"), contents)
        val wc = transport.open.values.single { it.udp }
        assertEquals("udp://10.0.0.2:6677", wc.url)
        wc.events.onOpened(wc.token)
        assertTrue(transport.open.values.none { it.url.endsWith("/ts") }, "TS waits for a wall-clock correlation")
        val local = answerWallClock(offsetNanos = 1_000_000_000_000L)
        val ts = transport.opened("/ts")
        val setup = Json.parseToJsonElement(transport.sent.last { it.first == ts.token }.second).jsonObject
        assertEquals(TimelineProtocol.PTS, setup["timelineSelector"]?.jsonPrimitive?.content)
        assertEquals("", setup["contentIdStem"]?.jsonPrimitive?.content)
        val wall = local + 1_000_000_000_000L
        transport.text(ts, """{"contentTime":"900000","wallClockTime":"$wall","timelineSpeedMultiplier":1}""")
        assertEquals(MediaSyncSession.State.SYNCHRONISED, state)
        assertEquals(10.0, session.position()!!.seconds, 1e-6)
        clock.now += 2_500_000_000L
        val position = assertNotNull(session.position())
        assertEquals(12.5, position.seconds, 1e-6)
        assertTrue(position.reliable)
        assertEquals(2_500.0, position.timestampAgeMs, 1e-6)
    }

    @Test fun contentChangeInvalidatesTimelineUntilNextTimestamp() {
        nativeFlowReachesSynchronisedAndExtrapolates()
        val cii = transport.socket("/cii")
        transport.text(cii, """{"contentId":"https://cdn/b.mpd"}""")
        assertEquals("https://cdn/b.mpd", contents.last())
        assertNull(session.position(), "No correction against the previous content's timeline")
        assertEquals(MediaSyncSession.State.SYNCHRONISING, state)
    }

    @Test fun mixedCompatEndpointsAreRejected() {
        session.start(config(SyncMode.COMPAT))
        val cii = transport.opened("/hbbtv-sync-cii")
        transport.text(cii, cii(wc = "udp://10.0.0.2:6677", ts = "ws://10.0.0.2:7681/app2app/hbbtv-sync-ts"))
        assertEquals(MediaSyncSession.Issue.INVALID_ENDPOINTS, issue)
        assertTrue(transport.open.values.none { it.udp || it.url.endsWith("-ts") })
    }

    @Test fun compatUsesJsonWallClockAfterPairing() {
        session.start(config(SyncMode.COMPAT))
        val cii = transport.opened("/hbbtv-sync-cii")
        transport.text(cii, "pairingcompleted")
        transport.text(cii, cii(wc = "ws://10.0.0.2:7681/app2app/hbbtv-sync-wc", ts = "ws://10.0.0.2:7681/app2app/hbbtv-sync-ts"))
        val wc = transport.opened("-wc")
        transport.text(wc, "pairingcompleted")
        val request = Json.parseToJsonElement(transport.sent.last { it.first == wc.token }.second).jsonObject
        val id = request["id"]!!.jsonPrimitive.content
        val ot = request["ot"]!!.jsonPrimitive.content.toLong()
        clock.now += 40_000_000
        transport.text(wc, """{"v":0,"t":1,"id":$id,"ot":1,"rt":${ot + 20_000_000.5},"tt":${ot + 20_000_001}}""")
        val ts = transport.opened("-ts")
        transport.text(ts, "pairingcompleted")
        assertTrue(transport.sent.count { it.first == ts.token } >= 2, "Setup is repeated after pairing")
        transport.text(ts, """{"contentTime":0,"wallClockTime":${clock.now},"timelineSpeedMultiplier":0}""")
        assertEquals(MediaSyncSession.State.SYNCHRONISED, state)
        assertFalse(session.position()!!.isPlaying)
    }

    @Test fun ciiLossRecoversWithNewTokenAndIgnoresStaleEvents() {
        session.start(config())
        val first = transport.opened("/cii")
        transport.text(first, cii())
        transport.remoteClose(first)
        assertEquals(MediaSyncSession.State.RECOVERING, state)
        assertEquals(MediaSyncSession.Issue.CONNECTION_LOST, issue)
        assertNull(contents.last())
        assertTrue(transport.open.values.none { it.udp }, "Downstream services are released with CII")
        first.events.onText(first.token, cii(content = "https://cdn/stale.mpd"))
        assertEquals(null, contents.last())
        transport.fire(1_000)
        val second = transport.opened("/cii")
        assertTrue(second.token != first.token)
        assertEquals(MediaSyncSession.State.WAITING_CONTENT, state)
    }

    @Test fun stopReleasesEverythingAndLateEventsAreHarmless() {
        nativeFlowReachesSynchronisedAndExtrapolates()
        val tokens = transport.open.keys.toList()
        session.stop()
        assertTrue(transport.open.isEmpty(), "No sockets remain after stop")
        assertTrue(transport.timers.isEmpty(), "No timers remain after stop")
        assertEquals(MediaSyncSession.State.DISCONNECTED, state)
        val before = snapshots.size
        tokens.forEach { session.onText(it, cii()); session.onClosed(it, true); session.onTimer(it) }
        assertEquals(before, snapshots.size)
    }

    @Test fun restartWithIdenticalCiiReopensEndpoints() {
        nativeFlowReachesSynchronisedAndExtrapolates()
        session.start(config())
        assertNull(snapshots.last().contentId, "No content from the previous generation before the new CII")
        assertNull(session.position())
        val cii = transport.opened("/cii")
        transport.text(cii, cii())
        assertEquals(listOf<String?>("https://cdn/a.mpd", "https://cdn/a.mpd"), contents)
        val wc = transport.open.values.single { it.udp }
        wc.events.onOpened(wc.token)
        assertTrue(transport.open.values.none { it.url.endsWith("/ts") }, "A fresh wall-clock correlation is required")
        answerWallClock(offsetNanos = 1_000_000_000_000L)
        transport.opened("/ts")
        assertEquals(MediaSyncSession.State.SYNCHRONISING, state)
    }

    @Test fun wallClockLossIsReportedAfterAnEarlierSync() {
        nativeFlowReachesSynchronisedAndExtrapolates()
        transport.fire(10_000)
        assertTrue(issue != MediaSyncSession.Issue.WALL_CLOCK_UNSYNCHRONISED)
        clock.now += 600_000_000_000L
        transport.fire(10_000)
        assertEquals(MediaSyncSession.Issue.WALL_CLOCK_UNSYNCHRONISED, issue, "Silent UDP must surface after the first check")
    }

    @Test fun withdrawnEndpointsCloseWallClockAndTimeline() {
        nativeFlowReachesSynchronisedAndExtrapolates()
        transport.text(transport.socket("/cii"), """{"wcUrl":null,"tsUrl":null}""")
        assertTrue(transport.open.values.none { it.udp || it.url.endsWith("/ts") })
        assertNull(session.position())
    }

    @Test fun missingEndpointIsAnErrorAndNoContentIsReported() {
        session.start(MediaSyncSession.Config(SyncMode.NATIVE, null, null, null))
        assertEquals(MediaSyncSession.State.ERROR, state)
        assertEquals(MediaSyncSession.Issue.NO_ENDPOINT, issue)
        session.start(config())
        transport.opened("/cii")
        transport.fire(5_000)
        assertEquals(MediaSyncSession.Issue.NO_CONTENT, issue)
    }

    @Test fun appChannelRelaysVerbatimAndStaysIndependent() {
        session.start(config())
        val app = transport.opened("/hbbtv-sync-app")
        assertTrue(session.sendAppMessage("hello", JsonPrimitive(1), null), "Queued until pairing")
        assertTrue(transport.sent.none { it.first == app.token })
        transport.text(app, "pairingcompleted")
        assertEquals("""{"version":1,"type":"hello","id":null,"payload":1}""", transport.sent.last { it.first == app.token }.second)
        val raw = """{"version":1,"type":"state","id":null,"payload":{"n":1.50},"retained":true}"""
        transport.text(app, raw)
        assertEquals(raw, appMessages.single().raw.toString())
        assertEquals(1, session.retainedAppMessages.size)
        transport.remoteClose(app)
        assertEquals(MediaSyncSession.State.CONNECTING, state, "App channel loss does not affect CII")
    }
}

class App2AppChannelTest {
    private val transport = FakeTransport()
    private val states = mutableListOf<App2AppChannel.State>()
    private val channel = App2AppChannel("ws://tv/app2app/p-app", transport, object : App2AppChannel.Listener {
        override fun onAppChannelState(state: App2AppChannel.State) { states += state }
    }, App2AppChannel.Limits(maxQueuedMessages = 2, maxOutboundChars = 100, maxReconnectAttempts = 2))

    @Test fun boundsQueueAndSizes() {
        channel.open()
        assertTrue(channel.send("a", null, null))
        assertTrue(channel.send("b", null, null))
        assertFalse(channel.send("c", null, null), "Queue is bounded")
        assertFalse(channel.send("x".repeat(129), null, null))
        assertFalse(channel.send("big", JsonPrimitive("y".repeat(200)), null))
        val socket = transport.opened("p-app")
        transport.text(socket, "pairingcompleted")
        assertEquals(listOf("a", "b"), transport.sent.map { Json.parseToJsonElement(it.second).jsonObject["type"]!!.jsonPrimitive.content })
    }

    @Test fun reconnectIsBoundedAndCloseDiscardsState() {
        channel.open()
        repeat(2) {
            transport.remoteClose(transport.socket("p-app"))
            transport.timers.values.toList().forEach { transport.timers.remove(it.token); it.events.onTimer(it.token) }
        }
        transport.remoteClose(transport.socket("p-app"))
        assertEquals(App2AppChannel.State.FAILED, states.last())
        assertFalse(channel.send("late", null, null))
        channel.close()
        assertEquals(App2AppChannel.State.CLOSED, states.last())
        assertTrue(transport.open.isEmpty() && transport.timers.isEmpty())
    }

    @Test fun ignoresInvalidInbound() {
        assertNull(channel.parse("[]"))
        assertNull(channel.parse("""{"type":""}"""))
        assertNull(channel.parse("""{"type":1}"""))
        assertNotNull(channel.parse("""{"type":"ok","payload":[1,2]}"""))
    }
}

class TransportProbeTest {
    private val transport = FakeTransport()

    private fun probe(mode: SyncMode, result: MutableList<Boolean>) =
        TransportProbe(transport, mode, "ws://10.0.0.2:7681/cii", "ws://10.0.0.2:7681/app2app", "10.0.0.2") { result += it }

    @Test fun confirmsOnlyUsableEndpoints() {
        val results = mutableListOf<Boolean>()
        probe(SyncMode.NATIVE, results).start()
        val socket = transport.opened("/cii")
        transport.text(socket, """{"contentId":"x"}""")
        assertTrue(results.isEmpty(), "A CII without endpoints is not availability")
        transport.text(socket, """{"wcUrl":"udp://0.0.0.0:6677","tsUrl":"ws://10.0.0.2:7681/ts"}""")
        assertEquals(listOf(true), results)
        assertTrue(transport.open.isEmpty() && transport.timers.isEmpty())
    }

    @Test fun rejectsMixedCompatProfileAndTimesOut() {
        val results = mutableListOf<Boolean>()
        probe(SyncMode.COMPAT, results).start()
        val socket = transport.opened("hbbtv-sync-cii")
        transport.text(socket, """{"wcUrl":"udp://10.0.0.2:6677","tsUrl":"ws://10.0.0.2:7681/app2app/hbbtv-sync-ts"}""")
        assertTrue(results.isEmpty())
        transport.fire(2_000)
        assertEquals(listOf(false), results)
    }

    @Test fun cancelReportsNothing() {
        val results = mutableListOf<Boolean>()
        val probe = probe(SyncMode.NATIVE, results)
        probe.start()
        probe.cancel()
        transport.fire(2_000)
        assertTrue(results.isEmpty() && transport.open.isEmpty())
        val missing = TransportProbe(transport, SyncMode.COMPAT, null, null, null) { results += it }
        missing.start()
        assertEquals(listOf(false), results)
    }
}

class PlaybackCorrectorTest {
    private val corrector = PlaybackCorrector()
    private fun player(time: Double, playing: Boolean = true, rate: Double = 1.0, buffering: Boolean = false) =
        PlaybackCorrector.Player(time, null, playing, buffering, rate)
    private fun tv(position: Double, playing: Boolean = true, reliable: Boolean = true) = PlaybackCorrector.Tv(position, null, playing, reliable)

    @Test fun followsTvPauseAndResumesAtTvPosition() {
        var result = corrector.update(0, tv(10.0, playing = false), player(10.0), SyncMode.NATIVE, false)
        assertEquals(listOf<PlaybackCorrector.Command>(PlaybackCorrector.Command.Pause), result.commands)
        assertEquals(PlaybackCorrector.Status.PAUSED, result.status)
        result = corrector.update(100, tv(30.0), player(10.0, playing = false), SyncMode.NATIVE, false)
        assertEquals(listOf(PlaybackCorrector.Command.Seek(30.0), PlaybackCorrector.Command.Play), result.commands)
    }

    @Test fun seeksOnceAndWaitsForCompletionOrCooldown() {
        var result = corrector.update(0, tv(20.0), player(10.0), SyncMode.NATIVE, false)
        assertEquals(PlaybackCorrector.Command.Seek(20.4), result.commands.single())
        result = corrector.update(500, tv(20.5), player(10.5), SyncMode.NATIVE, false)
        assertTrue(result.commands.isEmpty(), "No re-seek while the first seek settles")
        assertEquals(PlaybackCorrector.Status.SEEKING, result.status)
        corrector.onSeekCompleted()
        result = corrector.update(600, tv(20.6), player(20.6), SyncMode.NATIVE, false)
        assertEquals(PlaybackCorrector.Status.LOCKED, result.status)
    }

    @Test fun compatUsesWiderThresholdsAndRateCorrection() {
        val result = corrector.update(0, tv(15.0), player(10.0), SyncMode.COMPAT, false)
        assertTrue(result.commands.single() is PlaybackCorrector.Command.SetRate, "5 s drift is corrected by rate in compat")
        assertEquals(PlaybackCorrector.Status.ADJUSTING, result.status)
    }

    @Test fun modeSwitchRestoresNormalRateWhenAlreadyLocked() {
        val result = corrector.update(0, tv(10.0), player(10.0, rate = 1.04), SyncMode.COMPAT, false)
        assertEquals(listOf<PlaybackCorrector.Command>(PlaybackCorrector.Command.SetRate(1.0)), result.commands,
            "A new controller assumes 1.0, so the player's leftover correction rate must be undone")
        assertEquals(PlaybackCorrector.Status.LOCKED, result.status)
    }

    @Test fun doesNotCorrectWhileBufferingUnreliableOrThrottled() {
        assertTrue(corrector.update(0, tv(10.5), player(10.0, buffering = true), SyncMode.NATIVE, false).commands.isEmpty())
        assertEquals(PlaybackCorrector.Status.WAITING, corrector.update(10, tv(10.5, reliable = false), player(10.0), SyncMode.NATIVE, false).status)
        corrector.update(100, tv(10.5), player(10.0), SyncMode.NATIVE, false)
        assertTrue(corrector.update(150, tv(10.55), player(10.05), SyncMode.NATIVE, false).commands.isEmpty(), "Min interval")
    }

    @Test fun timelineLossPausesAndRestoresRate() {
        val result = corrector.update(0, null, player(10.0, rate = 1.02), SyncMode.NATIVE, false)
        assertEquals(listOf(PlaybackCorrector.Command.Pause, PlaybackCorrector.Command.SetRate(1.0)), result.commands)
    }

    @Test fun liveComparesEpochTimesAndSeeksInMediaTime() {
        val result = corrector.update(0, PlaybackCorrector.Tv(100.0, 1_000_100.0, true, true),
            PlaybackCorrector.Player(50.0, 1_000_090.0, true, false, 1.0), SyncMode.NATIVE, true)
        assertEquals(PlaybackCorrector.Command.Seek(60.4), result.commands.single())
    }

    @Test fun compatLiveSeeksInsteadOfSlowRateCorrection() {
        val result = corrector.update(0, PlaybackCorrector.Tv(100.0, 1_000_100.0, true, true),
            PlaybackCorrector.Player(50.0, 1_000_090.0, true, false, 1.0), SyncMode.COMPAT, true)
        assertEquals(PlaybackCorrector.Command.Seek(60.4), result.commands.single())
    }
}

class BackoffTest {
    @Test fun growsAndCaps() {
        val backoff = Backoff(1_000, 5_000)
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 5_000L, 5_000L), List(5) { backoff.nextDelayMs() })
        backoff.reset()
        assertEquals(1_000, backoff.nextDelayMs())
    }
}

class WallClockEstimatorTest {
    @Test fun computesOffsetRoundTripAndGrowsDispersion() {
        val estimator = WallClockEstimator(localMaxFreqErrorPpm = 500.0)
        val sample = WallClockEstimator.Sample(1_000_000_000, 11_000_000_000, 11_000_000_000, 1_020_000_000)
        assertTrue(estimator.accept(sample))
        assertEquals(20_000_000, sample.roundTripNanos)
        assertEquals(10_990_000_000, estimator.wallClockNanos(1_000_000_000))
        assertEquals(10_000_000.0, estimator.dispersionNanos(1_020_000_000), 1e-6)
        assertEquals(10_000_000.0 + 1e9 * 500e-6, estimator.dispersionNanos(2_020_000_000), 1e-3)
        val worse = WallClockEstimator.Sample(1_030_000_000, 11_000_000_000, 11_000_000_000, 1_090_000_000)
        assertFalse(estimator.accept(worse, 1_090_000_000))
        val negative = WallClockEstimator.Sample(2_000_000_000, 5, 10, 2_000_000_001)
        assertFalse(estimator.accept(negative))
    }
}
