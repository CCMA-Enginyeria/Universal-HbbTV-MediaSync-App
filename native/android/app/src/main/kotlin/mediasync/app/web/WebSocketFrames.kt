package mediasync.app.web

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.InputStream
import java.net.ProtocolException
import java.security.MessageDigest
import java.util.Locale
import okio.ByteString.Companion.encodeUtf8

/**
 * Server-side subset of RFC 6455 for the loopback companion bridge: handshake,
 * text, ping/pong and close, with bounded sizes. The only peer is a browser tab
 * on the same device, so a dependency-free subset is enough.
 */
internal object WebSocketFrames {
    const val OP_CONTINUATION = 0x0
    const val OP_TEXT = 0x1
    const val OP_BINARY = 0x2
    const val OP_CLOSE = 0x8
    const val OP_PING = 0x9
    const val OP_PONG = 0xA
    const val MAX_REQUEST_BYTES = 8_192
    private const val ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    /** Request line target and headers (lowercase names, repeated headers joined with ", "). */
    data class Request(val method: String, val path: String, val headers: Map<String, String>)

    class Frame(val opcode: Int, val fin: Boolean, val payload: ByteArray)

    /** Reads an HTTP request head; null if it is malformed, truncated or larger than [MAX_REQUEST_BYTES]. */
    fun readRequest(input: InputStream): Request? {
        val head = ByteArrayOutputStream()
        var matched = 0
        while (matched < 4) {
            val byte = input.read()
            if (byte == -1 || head.size() >= MAX_REQUEST_BYTES) return null
            head.write(byte)
            matched = when {
                byte == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
                byte == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
                byte == '\r'.code -> 1
                else -> 0
            }
        }
        val lines = head.toString(Charsets.ISO_8859_1.name()).split("\r\n")
        val requestLine = lines.first().split(' ')
        if (requestLine.size != 3 || !requestLine[2].startsWith("HTTP/1.")) return null
        val headers = linkedMapOf<String, String>()
        for (line in lines.drop(1)) {
            if (line.isEmpty()) continue
            val colon = line.indexOf(':').takeIf { it > 0 } ?: return null
            val name = line.substring(0, colon).trim().lowercase(Locale.ROOT)
            val value = line.substring(colon + 1).trim()
            headers[name] = headers[name]?.let { "$it, $value" } ?: value
        }
        return Request(requestLine[0], requestLine[1], headers)
    }

    /**
     * Validates an upgrade request for [expectedPath] from [expectedOrigin] and returns
     * the `Sec-WebSocket-Accept` value, or null if it must be rejected. The path carries
     * the session secret, so it is compared in constant time.
     */
    fun accept(request: Request, expectedPath: String, expectedOrigin: String): String? {
        if (request.method != "GET") return null
        if (!MessageDigest.isEqual(request.path.toByteArray(), expectedPath.toByteArray())) return null
        if (request.headers["origin"] != expectedOrigin) return null
        if (!hasToken(request.headers["upgrade"], "websocket") || !hasToken(request.headers["connection"], "upgrade")) return null
        if (request.headers["sec-websocket-version"] != "13") return null
        val key = request.headers["sec-websocket-key"]?.takeIf { it.isNotEmpty() } ?: return null
        return acceptKey(key)
    }

    fun acceptKey(key: String): String = (key.trim() + ACCEPT_GUID).encodeUtf8().sha1().base64()

    fun switchingProtocols(accept: String): ByteArray =
        ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $accept\r\n\r\n").toByteArray(Charsets.ISO_8859_1)

    val FORBIDDEN: ByteArray = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.ISO_8859_1)

    /**
     * Reads one client frame, unmasked; null on a clean end of stream. Client frames
     * must be masked and control frames short and final (RFC 6455 §5.1, §5.5).
     */
    fun readFrame(input: DataInputStream, maxPayload: Int): Frame? {
        val first = input.read()
        if (first == -1) return null
        val second = input.readUnsignedByte()
        if (first and 0x70 != 0) throw ProtocolException("Reserved bits set")
        if (second and 0x80 == 0) throw ProtocolException("Unmasked client frame")
        val opcode = first and 0x0F
        val fin = first and 0x80 != 0
        val length = when (val short = second and 0x7F) {
            126 -> input.readUnsignedShort().toLong()
            127 -> input.readLong()
            else -> short.toLong()
        }
        if (opcode >= OP_CLOSE && (!fin || length > 125)) throw ProtocolException("Invalid control frame")
        if (length < 0 || length > maxPayload) throw ProtocolException("Frame too large")
        val mask = ByteArray(4).also(input::readFully)
        val payload = ByteArray(length.toInt()).also(input::readFully)
        for (index in payload.indices) payload[index] = (payload[index].toInt() xor mask[index and 3].toInt()).toByte()
        return Frame(opcode, fin, payload)
    }

    /** Encodes a final, unmasked server frame. */
    fun encode(opcode: Int, payload: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(payload.size + 10)
        out.write(0x80 or opcode)
        when {
            payload.size < 126 -> out.write(payload.size)
            payload.size <= 0xFFFF -> {
                out.write(126)
                out.write(payload.size shr 8 and 0xFF)
                out.write(payload.size and 0xFF)
            }
            else -> {
                out.write(127)
                for (shift in 56 downTo 0 step 8) out.write((payload.size.toLong() shr shift and 0xFF).toInt())
            }
        }
        out.write(payload)
        return out.toByteArray()
    }

    private fun hasToken(header: String?, token: String): Boolean =
        header?.split(',')?.any { it.trim().equals(token, ignoreCase = true) } == true
}
