package mediasync.app.net

import android.os.Handler
import android.os.Looper
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import mediasync.app.diagnostics.Diagnostics
import mediasync.core.Transport
import mediasync.core.TransportEvents
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Core [Transport] over OkHttp WebSockets and connected UDP sockets. Every
 * public method must be called on the main looper, and every event is posted
 * back to it; events for tokens no longer registered are dropped.
 */
class AndroidTransport(
    private val http: OkHttpClient,
    private val handler: Handler,
    private val diagnostics: Diagnostics,
) : Transport {
    private val sockets = HashMap<Long, WebSocket>()
    private val datagrams = HashMap<Long, UdpChannel>()
    private val listeners = HashMap<Long, TransportEvents>()
    private val timers = HashMap<Long, Runnable>()
    private val io: ExecutorService = Executors.newCachedThreadPool { Thread(it, "mediasync-udp").apply { isDaemon = true } }

    val openResources: Int get() = sockets.size + datagrams.size

    override fun openWebSocket(token: Long, url: String, events: TransportEvents) {
        checkThread()
        listeners[token] = events
        val request = runCatching { Request.Builder().url(url).header("User-Agent", USER_AGENT).build() }.getOrNull()
        if (request == null) {
            handler.post { finish(token, true) }
            return
        }
        diagnostics.log("transport", "ws.open", "token" to token)
        sockets[token] = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = post(token) { events.onOpened(token) }
            override fun onMessage(webSocket: WebSocket, text: String) = post(token) { events.onText(token, text) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { handler.post { finish(token, false) } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handler.post {
                    diagnostics.log("transport", "ws.failure", "token" to token, "error" to t.javaClass.simpleName)
                    finish(token, true)
                }
            }
        })
    }

    override fun openUdp(token: Long, host: String, port: Int, events: TransportEvents) {
        checkThread()
        listeners[token] = events
        datagrams[token] = UdpChannel(token, host, port, events)
    }

    override fun sendText(token: Long, text: String): Boolean = sockets[token]?.send(text) ?: false

    override fun sendDatagram(token: Long, data: ByteArray): Boolean = datagrams[token]?.send(data) ?: false

    override fun close(token: Long) {
        checkThread()
        listeners.remove(token)
        sockets.remove(token)?.close(1000, null)
        datagrams.remove(token)?.close()
    }

    override fun schedule(token: Long, delayMs: Long, events: TransportEvents) {
        checkThread()
        val runnable = Runnable { if (timers.remove(token) != null) events.onTimer(token) }
        timers[token] = runnable
        handler.postDelayed(runnable, delayMs)
    }

    override fun cancel(token: Long) {
        timers.remove(token)?.let(handler::removeCallbacks)
    }

    private fun post(token: Long, block: () -> Unit) {
        handler.post { if (token in listeners) block() }
    }

    private fun finish(token: Long, failed: Boolean) {
        val removed = sockets.remove(token) != null || datagrams.remove(token)?.also { it.close() } != null
        val events = listeners.remove(token)
        if (removed) events?.onClosed(token, failed)
    }

    private fun checkThread() = check(Looper.myLooper() == handler.looper) { "Transport must be used on its owner looper" }

    /** Connected socket: only datagrams from the TV's address and port are delivered. */
    private inner class UdpChannel(val token: Long, host: String, port: Int, val events: TransportEvents) {
        @Volatile private var socket: DatagramSocket? = null
        @Volatile private var closed = false
        private val sender = Executors.newSingleThreadExecutor { Thread(it, "mediasync-udp-send").apply { isDaemon = true } }

        init {
            io.execute {
                try {
                    val target = InetAddress.getByName(host)
                    val created = DatagramSocket()
                    created.connect(target, port)
                    socket = created
                    if (closed) {
                        created.close()
                        return@execute
                    }
                    post(token) { events.onOpened(token) }
                    val buffer = ByteArray(2048)
                    while (!closed) {
                        val packet = DatagramPacket(buffer, buffer.size)
                        created.receive(packet)
                        val receivedAt = System.nanoTime()
                        val data = packet.data.copyOfRange(packet.offset, packet.offset + packet.length)
                        post(token) { events.onDatagram(token, data, receivedAt) }
                    }
                } catch (error: Exception) {
                    if (!closed) handler.post {
                        diagnostics.log("transport", "udp.failure", "token" to token, "error" to error.javaClass.simpleName)
                        finish(token, true)
                    }
                }
            }
        }

        fun send(data: ByteArray): Boolean {
            if (closed) return false
            sender.execute { runCatching { socket?.send(DatagramPacket(data, data.size)) } }
            return true
        }

        fun close() {
            closed = true
            socket?.close()
            sender.shutdownNow()
        }
    }

    companion object {
        const val USER_AGENT = "MediaSyncNative/1.0"
    }
}
