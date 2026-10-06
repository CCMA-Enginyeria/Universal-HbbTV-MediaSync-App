package mediasync.app.web

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import mediasync.core.CompanionProtocol
import okio.ByteString.Companion.toByteString

/**
 * WebSocket server on 127.0.0.1 for one companion page. It accepts only upgrades
 * to the secret path from the page origin and keeps just the newest connection, so a
 * page reload replaces the previous one. [Listener] callbacks run on server threads and
 * carry the connection id; use [isCurrent] to drop events from replaced pages.
 *
 * With a [page] the server also serves that document at [pageUrl] and the page origin
 * is the server's own (`http://127.0.0.1:port`, a secure context for WebXR). A fixed
 * [preferredPort] keeps that origin, and so the page's local storage, across launches.
 * Without a page, [origin] is the HTTPS origin of the external companion page.
 */
internal class LoopbackServer(
    origin: String?,
    private val listener: Listener,
    preferredPort: Int = 0,
    private val page: ByteArray? = null,
) {
    interface Listener {
        fun onConnected(connection: Long)
        fun onText(connection: Long, text: String)
        fun onEvent(event: String)
    }

    private class Peer(val id: Long, val socket: Socket, val output: OutputStream) {
        fun close() {
            runCatching { socket.close() }
        }
    }

    private val server = bind(preferredPort)
    val port: Int = server.localPort
    val token: String = ByteArray(TOKEN_BYTES).also(SecureRandom()::nextBytes).toByteString().base64Url().trimEnd('=')
    val socketUrl: String get() = "ws://127.0.0.1:$port/$token"
    val pageUrl: String get() = "http://127.0.0.1:$port/$token/"
    private val host = "127.0.0.1:$port"
    private val origin: String = origin ?: "http://$host"
    private val peer = AtomicReference<Peer?>()
    private val ids = AtomicLong()
    private val writer: ExecutorService = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "MediaSyncLoopbackWriter") }

    init {
        thread(name = "MediaSyncLoopback", isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                thread(name = "MediaSyncLoopbackPeer", isDaemon = true) { serve(socket) }
            }
        }
    }

    fun isCurrent(connection: Long): Boolean = peer.get()?.id == connection

    /** Queues a text frame for the current page, if any; never blocks the caller. */
    fun send(text: String) {
        val target = peer.get() ?: return
        val frame = WebSocketFrames.encode(WebSocketFrames.OP_TEXT, text.toByteArray(Charsets.UTF_8))
        runCatching { writer.execute { write(target, frame) } }
    }

    fun stop() {
        runCatching { server.close() }
        peer.getAndSet(null)?.close()
        writer.shutdownNow()
    }

    private fun write(target: Peer, frame: ByteArray) {
        try {
            synchronized(target) {
                target.output.write(frame)
                target.output.flush()
            }
        } catch (_: IOException) {
            target.close()
        }
    }

    private fun serve(socket: Socket) {
        val current: Peer
        val input: DataInputStream
        try {
            socket.soTimeout = HANDSHAKE_TIMEOUT_MS
            input = DataInputStream(BufferedInputStream(socket.getInputStream()))
            val output = socket.getOutputStream()
            val request = WebSocketFrames.readRequest(input)
            if (page != null && request != null && WebSocketFrames.isPageRequest(request, "/$token/", host)) {
                output.write(WebSocketFrames.page(page, "ws://$host"))
                output.flush()
                socket.close()
                listener.onEvent("loopback-page")
                return
            }
            val accept = request?.let { WebSocketFrames.accept(it, "/$token", origin) }
            if (accept == null) {
                listener.onEvent("loopback-rejected")
                runCatching { output.write(WebSocketFrames.FORBIDDEN) }
                socket.close()
                return
            }
            output.write(WebSocketFrames.switchingProtocols(accept))
            output.flush()
            socket.soTimeout = 0
            current = Peer(ids.incrementAndGet(), socket, output)
        } catch (_: IOException) {
            runCatching { socket.close() }
            return
        }
        if (server.isClosed) return current.close()
        peer.getAndSet(current)?.close()
        listener.onEvent("loopback-connected")
        listener.onConnected(current.id)
        try {
            read(current, input)
        } catch (_: IOException) {
            // Closed by the page, by a newer connection or by stop().
        } finally {
            current.close()
            if (peer.compareAndSet(current, null)) listener.onEvent("loopback-disconnected")
        }
    }

    private fun read(current: Peer, input: DataInputStream) {
        val message = ByteArrayOutputStream()
        var inText = false
        while (true) {
            val frame = WebSocketFrames.readFrame(input, MAX_MESSAGE_BYTES) ?: return
            when (frame.opcode) {
                WebSocketFrames.OP_TEXT, WebSocketFrames.OP_CONTINUATION -> {
                    // A text frame must start a message and a continuation must follow one.
                    if ((frame.opcode == WebSocketFrames.OP_TEXT) == inText) return closeWith(current, CLOSE_PROTOCOL_ERROR)
                    inText = true
                    if (message.size() + frame.payload.size > MAX_MESSAGE_BYTES) return closeWith(current, CLOSE_TOO_BIG)
                    message.write(frame.payload)
                    if (frame.fin) {
                        val text = message.toString(Charsets.UTF_8.name())
                        message.reset()
                        inText = false
                        listener.onText(current.id, text)
                    }
                }
                WebSocketFrames.OP_PING -> write(current, WebSocketFrames.encode(WebSocketFrames.OP_PONG, frame.payload))
                WebSocketFrames.OP_PONG -> Unit
                WebSocketFrames.OP_CLOSE -> return write(current, WebSocketFrames.encode(WebSocketFrames.OP_CLOSE, frame.payload.copyOf(minOf(2, frame.payload.size))))
                else -> return closeWith(current, CLOSE_UNSUPPORTED)
            }
        }
    }

    private fun closeWith(current: Peer, code: Int) =
        write(current, WebSocketFrames.encode(WebSocketFrames.OP_CLOSE, byteArrayOf((code shr 8).toByte(), code.toByte())))

    /**
     * Binds to 127.0.0.1 explicitly: on Android `InetAddress.getLoopbackAddress()` is `::1`,
     * which pages connecting to `ws://127.0.0.1` cannot reach.
     */
    private fun bind(preferredPort: Int): ServerSocket {
        if (preferredPort > 0) runCatching { return ServerSocket(preferredPort, BACKLOG, IPV4_LOOPBACK) }
        return ServerSocket(0, BACKLOG, IPV4_LOOPBACK)
    }

    private companion object {
        const val BACKLOG = 4
        val IPV4_LOOPBACK: InetAddress = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))
        const val TOKEN_BYTES = 24
        const val HANDSHAKE_TIMEOUT_MS = 5_000
        const val MAX_MESSAGE_BYTES = CompanionProtocol.MAX_INBOUND_CHARS * 4
        const val CLOSE_PROTOCOL_ERROR = 1002
        const val CLOSE_UNSUPPORTED = 1003
        const val CLOSE_TOO_BIG = 1009
    }
}
