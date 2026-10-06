package mediasync.app.web

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.io.EOFException
import java.net.ProtocolException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LoopbackBridgeTest {
    private val origin = "https://example.com"

    private fun upgrade(path: String = "/secret", headers: Map<String, String> = emptyMap()): String {
        val all = linkedMapOf(
            "Host" to "127.0.0.1:4000",
            "Upgrade" to "websocket",
            "Connection" to "keep-alive, Upgrade",
            "Origin" to origin,
            "Sec-WebSocket-Version" to "13",
            "Sec-WebSocket-Key" to "dGhlIHNhbXBsZSBub25jZQ==",
        )
        headers.forEach { (name, value) -> if (value.isEmpty()) all.remove(name) else all[name] = value }
        return "GET $path HTTP/1.1\r\n" + all.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n"
    }

    private fun request(text: String) = WebSocketFrames.readRequest(ByteArrayInputStream(text.toByteArray(Charsets.ISO_8859_1)))

    /** Builds a masked client frame, as browsers send them. */
    private fun clientFrame(opcode: Int, payload: ByteArray, fin: Boolean = true, mask: ByteArray = byteArrayOf(1, 2, 3, 4)): ByteArray {
        val header = mutableListOf((if (fin) 0x80 else 0) or opcode)
        when {
            payload.size < 126 -> header += 0x80 or payload.size
            else -> header += listOf(0x80 or 126, payload.size shr 8 and 0xFF, payload.size and 0xFF)
        }
        val masked = ByteArray(payload.size) { (payload[it].toInt() xor mask[it and 3].toInt()).toByte() }
        return header.map { it.toByte() }.toByteArray() + mask + masked
    }

    private fun read(bytes: ByteArray, max: Int = 1_000) = WebSocketFrames.readFrame(DataInputStream(ByteArrayInputStream(bytes)), max)

    @Test
    fun acceptsUpgradeWithRfcAcceptKey() {
        val parsed = assertNotNull(request(upgrade()))
        assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WebSocketFrames.accept(parsed, "/secret", origin))
    }

    @Test
    fun rejectsWrongSecretOriginOrHeaders() {
        assertNull(WebSocketFrames.accept(assertNotNull(request(upgrade(path = "/other"))), "/secret", origin))
        assertNull(WebSocketFrames.accept(assertNotNull(request(upgrade(headers = mapOf("Origin" to "https://evil.example")))), "/secret", origin))
        assertNull(WebSocketFrames.accept(assertNotNull(request(upgrade(headers = mapOf("Origin" to "")))), "/secret", origin))
        assertNull(WebSocketFrames.accept(assertNotNull(request(upgrade(headers = mapOf("Upgrade" to "h2c")))), "/secret", origin))
        assertNull(WebSocketFrames.accept(assertNotNull(request(upgrade(headers = mapOf("Sec-WebSocket-Version" to "8")))), "/secret", origin))
        assertNull(WebSocketFrames.accept(assertNotNull(request(upgrade(headers = mapOf("Sec-WebSocket-Key" to "")))), "/secret", origin))
    }

    @Test
    fun rejectsMalformedOrOversizedRequests() {
        assertNull(request("GET /secret\r\n\r\n"))
        assertNull(request("GET /secret HTTP/1.1\r\nHost: x\r\n"))
        assertNull(request("GET /secret HTTP/1.1\r\nX: " + "a".repeat(WebSocketFrames.MAX_REQUEST_BYTES) + "\r\n\r\n"))
    }

    @Test
    fun unmasksClientFrames() {
        val payload = "{\"version\":1}".toByteArray()
        val frame = assertNotNull(read(clientFrame(WebSocketFrames.OP_TEXT, payload)))
        assertEquals(WebSocketFrames.OP_TEXT, frame.opcode)
        assertTrue(frame.fin)
        assertContentEquals(payload, frame.payload)
        val long = ByteArray(300) { it.toByte() }
        assertContentEquals(long, assertNotNull(read(clientFrame(WebSocketFrames.OP_TEXT, long))).payload)
    }

    @Test
    fun rejectsInvalidClientFrames() {
        assertFailsWith<ProtocolException> { read(byteArrayOf(0x81.toByte(), 0x01, 0x41)) }
        assertFailsWith<ProtocolException> { read(clientFrame(WebSocketFrames.OP_TEXT, ByteArray(20)), max = 10) }
        assertFailsWith<ProtocolException> { read(clientFrame(WebSocketFrames.OP_PING, ByteArray(1), fin = false)) }
        assertFailsWith<EOFException> { read(clientFrame(WebSocketFrames.OP_TEXT, ByteArray(20)).copyOf(10)) }
        assertNull(read(ByteArray(0)))
    }

    @Test
    fun encodesUnmaskedServerFrames() {
        assertContentEquals(byteArrayOf(0x81.toByte(), 2, 'h'.code.toByte(), 'i'.code.toByte()), WebSocketFrames.encode(WebSocketFrames.OP_TEXT, "hi".toByteArray()))
        val medium = WebSocketFrames.encode(WebSocketFrames.OP_TEXT, ByteArray(300))
        assertContentEquals(byteArrayOf(0x81.toByte(), 126, 1, 44), medium.copyOf(4))
        val large = WebSocketFrames.encode(WebSocketFrames.OP_TEXT, ByteArray(70_000))
        assertContentEquals(byteArrayOf(0x81.toByte(), 127, 0, 0, 0, 0, 0, 1, 17, 112), large.copyOf(10))
    }

    @Test
    fun addsBridgeAddressToFragment() {
        val socket = "ws://127.0.0.1:4000/abc"
        assertEquals("https://a.example/p?x=1#mediasync-ws=ws%3A%2F%2F127.0.0.1%3A4000%2Fabc", LoopbackCompanion.bridgeUrl("https://a.example/p?x=1", socket))
        assertEquals("https://a.example/#mediasync-ws=ws%3A%2F%2F127.0.0.1%3A4000%2Fabc", LoopbackCompanion.bridgeUrl("https://a.example/#", socket))
        assertEquals("https://a.example/#tab=2&mediasync-ws=ws%3A%2F%2F127.0.0.1%3A4000%2Fabc", LoopbackCompanion.bridgeUrl("https://a.example/#tab=2", socket))
    }

    private class Recorder : LoopbackServer.Listener {
        val events = LinkedBlockingQueue<String>()
        override fun onConnected(connection: Long) { events.add("connected:$connection") }
        override fun onText(connection: Long, text: String) { events.add("text:$connection:${text.length}:${text.take(8)}") }
        override fun onEvent(event: String) = Unit
    }

    private class Client : WebSocketListener() {
        val received = LinkedBlockingQueue<String>()
        override fun onMessage(webSocket: WebSocket, text: String) { received.add(text) }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { received.add("failure:${response?.code}") }
    }

    private fun connect(server: LoopbackServer, client: Client, origin: String = this.origin, token: String = server.token): WebSocket =
        OkHttpClient().newWebSocket(Request.Builder().url("ws://127.0.0.1:${server.port}/$token").header("Origin", origin).build(), client)

    private fun <T> LinkedBlockingQueue<T>.next(): T? = poll(5, TimeUnit.SECONDS)

    @Test
    fun exchangesMessagesWithARealClient() {
        val recorder = Recorder()
        val server = LoopbackServer(origin, recorder)
        try {
            val client = Client()
            val socket = connect(server, client)
            assertEquals("connected:1", recorder.events.next())
            assertTrue(server.isCurrent(1))
            server.send("{\"type\":\"position\"}")
            assertEquals("{\"type\":\"position\"}", client.received.next())
            socket.send("{\"ack\":1}")
            assertEquals("text:1:9:{\"ack\":1", recorder.events.next())
            socket.send("y".repeat(70_000))
            assertEquals("text:1:70000:yyyyyyyy", recorder.events.next())

            val reload = Client()
            connect(server, reload)
            assertEquals("connected:2", recorder.events.next())
            assertTrue(server.isCurrent(2))
            server.send("again")
            assertEquals("again", reload.received.next())
        } finally {
            server.stop()
        }
    }

    @Test
    fun refusesOtherOriginsAndSecrets() {
        val recorder = Recorder()
        val server = LoopbackServer(origin, recorder)
        try {
            val foreign = Client()
            connect(server, foreign, origin = "https://evil.example")
            assertEquals("failure:403", foreign.received.next())
            val guessed = Client()
            connect(server, guessed, token = "guess")
            assertEquals("failure:403", guessed.received.next())
            assertNull(recorder.events.poll(200, TimeUnit.MILLISECONDS))
        } finally {
            server.stop()
        }
    }
}
