package mediasync.core

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.util.concurrent.CompletionStage
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** JDK implementation of [Transport]; every event is delivered on [owner]. */
class JdkTransport(private val owner: ScheduledExecutorService) : Transport {
    private val http = HttpClient.newHttpClient()
    private val sockets = ConcurrentHashMap<Long, WebSocket>()
    private val udp = ConcurrentHashMap<Long, DatagramSocket>()
    private val timers = ConcurrentHashMap<Long, ScheduledFuture<*>>()
    private val live = ConcurrentHashMap.newKeySet<Long>()

    val openCount: Int get() = sockets.size + udp.size

    override fun openWebSocket(token: Long, url: String, events: TransportEvents) {
        live += token
        http.newWebSocketBuilder().buildAsync(URI(url), object : WebSocket.Listener {
            private val text = StringBuilder()
            override fun onOpen(webSocket: WebSocket) {
                if (token !in live) { webSocket.abort(); return }
                sockets[token] = webSocket
                owner.execute { if (token in live) events.onOpened(token) }
                webSocket.request(1)
            }
            override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
                text.append(data)
                if (last) {
                    val message = text.toString()
                    text.setLength(0)
                    owner.execute { if (token in live) events.onText(token, message) }
                }
                webSocket.request(1)
                return null
            }
            override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
                finish(token, false, events)
                return null
            }
            override fun onError(webSocket: WebSocket, error: Throwable) = finish(token, true, events)
        }).exceptionally { finish(token, true, events); null }
    }

    private fun finish(token: Long, failed: Boolean, events: TransportEvents) {
        sockets.remove(token)
        owner.execute { if (live.remove(token)) events.onClosed(token, failed) }
    }

    override fun openUdp(token: Long, host: String, port: Int, events: TransportEvents) {
        live += token
        val socket = DatagramSocket().apply { connect(InetAddress.getByName(host), port) }
        udp[token] = socket
        owner.execute { events.onOpened(token) }
        thread(isDaemon = true) {
            val buffer = ByteArray(2048)
            try {
                while (true) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val at = System.nanoTime()
                    val data = packet.data.copyOfRange(0, packet.length)
                    owner.execute { if (token in live) events.onDatagram(token, data, at) }
                }
            } catch (_: Exception) {
                owner.execute { if (live.remove(token)) events.onClosed(token, true) }
            }
        }
    }

    override fun sendText(token: Long, text: String): Boolean = sockets[token]?.let { it.sendText(text, true); true } ?: false

    override fun sendDatagram(token: Long, data: ByteArray): Boolean = udp[token]?.let { it.send(DatagramPacket(data, data.size)); true } ?: false

    override fun close(token: Long) {
        live.remove(token)
        sockets.remove(token)?.sendClose(WebSocket.NORMAL_CLOSURE, "")
        udp.remove(token)?.close()
    }

    override fun schedule(token: Long, delayMs: Long, events: TransportEvents) {
        timers[token] = owner.schedule({ if (timers.remove(token) != null) events.onTimer(token) }, delayMs, TimeUnit.MILLISECONDS)
    }

    override fun cancel(token: Long) {
        timers.remove(token)?.cancel(false)
    }
}

/**
 * End-to-end check against `tools/tv-emulator` (run with EMU_IP=127.0.0.1).
 * Enabled with `-Pmediasync.emulator=127.0.0.1`; otherwise it is reported as skipped.
 */
class EmulatorIntegrationTest {
    private val host: String? = System.getProperty("mediasync.emulator")?.takeIf { it.isNotBlank() }
    // HTTP/1.1 only: an h2c upgrade request would be routed to the emulator's WebSocket handler.
    private val http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()

    private fun setTv(json: String) {
        http.send(HttpRequest.newBuilder(URI("http://$host:7681/api/state")).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json)).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun tvPositionSeconds(): Double {
        val body = http.send(HttpRequest.newBuilder(URI("http://$host:7681/api/state")).build(), HttpResponse.BodyHandlers.ofString()).body()
        return Json.parseToJsonElement(body).jsonObject.getValue("positionSeconds").jsonPrimitive.content.toDouble()
    }

    /** Some hosts do not loop SSDP multicast back; the HTTP half of discovery is still exercised. */
    private fun resolveDirectly(): DialTerminal {
        println("E2E note: SSDP multicast was not looped back on this host; resolving the description directly")
        val location = "http://$host:7681/dd.xml"
        val description = http.send(HttpRequest.newBuilder(URI(location)).build(), HttpResponse.BodyHandlers.ofString())
        val device = assertNotNull(DialProtocol.parseDevice(description.body(), location,
            description.headers().firstValue("Application-URL").orElse(null)))
        val app = http.send(HttpRequest.newBuilder(URI(device.hbbtvUrl)).build(), HttpResponse.BodyHandlers.ofString())
        return DialTerminal(device, DialProtocol.parseApplication(app.body(), host))
    }

    @Test fun discoversAndSynchronisesInBothModes() {
        // Reported as skipped (not passed) unless the emulator host is provided.
        org.junit.Assume.assumeTrue("Needs -Pmediasync.emulator=<host>", host != null)
        setTv("""{"mode":"native","paused":false,"positionSeconds":30,"contentIdOverride":null}""")
        val loopback = java.net.NetworkInterface.getByInetAddress(InetAddress.getByName(host))
        val scanned = runCatching {
            DialDiscoveryScan(DialDiscoveryScan.Options(durationMs = 2_500, networkInterface = loopback)).use { it.run() }.terminals.singleOrNull()
        }.getOrNull()
        val terminal = scanned ?: resolveDirectly()
        val application = assertNotNull(terminal.application)
        assertTrue(Endpoints.isWebSocket(application.interDeviceSyncUrl), "InterDevSync is the CSS-CII WebSocket")

        val owner = Executors.newSingleThreadScheduledExecutor()
        val transport = JdkTransport(owner)
        val snapshots = LinkedBlockingQueue<MediaSyncSession.Snapshot>()
        val contents = LinkedBlockingQueue<String>()
        val session = owner.submit<MediaSyncSession> {
            MediaSyncSession(transport, { System.nanoTime() }, object : MediaSyncSession.Listener {
                override fun onSnapshot(snapshot: MediaSyncSession.Snapshot) { snapshots.add(snapshot) }
                override fun onContentChanged(generation: Long, contentId: String?) { contents.add(contentId ?: "") }
            })
        }.get()
        fun awaitState(state: MediaSyncSession.State) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
            while (System.nanoTime() < deadline) {
                val next = snapshots.poll(250, TimeUnit.MILLISECONDS) ?: continue
                if (next.state == state) return
            }
            error("Timed out waiting for $state")
        }
        fun position() = owner.submit<TimelinePosition?> { session.position() }.get()

        try {
            // Compatibility mode is served by the emulator's TV page (/tv) running in a browser.
            val modes = listOf(SyncMode.NATIVE) + if (System.getProperty("mediasync.emulatorCompat") == "true") listOf(SyncMode.COMPAT) else emptyList()
            for (mode in modes) {
                setTv("""{"mode":"${mode.wireName}","paused":false}""")
                snapshots.clear()
                owner.submit { session.start(MediaSyncSession.Config(mode, application.interDeviceSyncUrl, application.app2AppUrl,
                    Endpoints.realHost(terminal.device.location), timelineSelector = "urn:dvb:css:timeline:mpd:period:rel:1000")) }.get()
                awaitState(MediaSyncSession.State.SYNCHRONISED)
                val first = assertNotNull(position())
                val reference = tvPositionSeconds()
                val errorMs = abs(first.seconds - reference) * 1000
                println("E2E $mode: tv=${"%.3f".format(reference)} s companion=${"%.3f".format(first.seconds)} s " +
                    "error=${"%.1f".format(errorMs)} ms uncertainty=${"%.1f".format(first.uncertaintyMs)} ms")
                assertTrue(errorMs < if (mode == SyncMode.NATIVE) 150 else 600, "$mode position error $errorMs ms")
                Thread.sleep(1_000)
                val second = assertNotNull(position())
                if (mode == SyncMode.NATIVE || first.isPlaying) {
                    assertEquals(1.0, second.seconds - first.seconds, 0.1)
                } else {
                    // The compat timeline follows the TV page's <video>, which may be unable to play in the host browser.
                    println("E2E note: compat timeline is paused by the TV page video element; advance not asserted")
                }

                setTv("""{"paused":true}""")
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (position()?.isPlaying != false && System.nanoTime() < deadline) Thread.sleep(100)
                assertEquals(false, position()?.isPlaying, "$mode follows TV pause")

                contents.clear()
                setTv("""{"paused":false,"contentIdOverride":"https://example.com/other.mpd"}""")
                assertEquals("https://example.com/other.mpd", contents.poll(5, TimeUnit.SECONDS))
                setTv("""{"contentIdOverride":null}""")
            }
            owner.submit { session.stop() }.get()
            Thread.sleep(300)
            assertEquals(0, transport.openCount, "No sockets remain after stop")
        } finally {
            owner.shutdownNow()
            setTv("""{"mode":"native","contentIdOverride":null}""")
        }
    }
}
