package mediasync.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Bidirectional `<prefix>-app` App2App channel. Payloads are opaque: they are
 * relayed as received and never interpreted or rewritten. Serial, not thread-safe.
 */
class App2AppChannel(
    val url: String,
    private val transport: Transport,
    private val listener: Listener,
    private val limits: Limits = Limits(),
) : TransportEvents {
    data class Limits(
        val maxInboundChars: Int = 262_144,
        val maxOutboundChars: Int = 65_536,
        val maxQueuedMessages: Int = 32,
        val maxRetainedTypes: Int = 32,
        val maxTypeLength: Int = 128,
        val maxReconnectAttempts: Int = 5,
    )

    enum class State { CLOSED, CONNECTING, OPEN, PAIRED, RECOVERING, FAILED }

    /** An application envelope; [raw] is the verbatim JSON object. */
    data class Message(val type: String, val id: String?, val retained: Boolean, val raw: JsonObject)

    interface Listener {
        fun onAppChannelState(state: State) {}
        fun onAppMessage(message: Message) {}
    }

    companion object {
        const val VERSION = 1
        const val PAIRING_FRAME = "pairingcompleted"

        fun url(app2appBase: String?, prefix: String): String? = Endpoints.compatUrl(app2appBase, prefix, "app")

        fun envelope(type: String, payload: JsonElement?, id: String?): JsonObject = buildJsonObject {
            put("version", VERSION)
            put("type", type)
            put("id", id?.let { JsonPrimitive(it) } ?: JsonNull)
            put("payload", payload ?: JsonNull)
        }
    }

    var state = State.CLOSED
        private set
    private var socket: Long? = null
    private var timer: Long? = null
    private val backoff = Backoff(2_000, 30_000)
    private val queue = ArrayDeque<String>()
    private val retainedMessages = linkedMapOf<String, Message>()
    val retained: List<Message> get() = retainedMessages.values.toList()

    fun open() {
        if (state == State.CONNECTING || state == State.OPEN || state == State.PAIRED) return
        connect(State.CONNECTING)
    }

    fun close() {
        socket?.let(transport::close)
        timer?.let(transport::cancel)
        socket = null
        timer = null
        queue.clear()
        retainedMessages.clear()
        backoff.reset()
        setState(State.CLOSED)
    }

    /** Sends (or queues until pairing) an application message; false if rejected. */
    fun send(type: String, payload: JsonElement?, id: String?): Boolean {
        if (type.isEmpty() || type.length > limits.maxTypeLength || (id?.length ?: 0) > 256) return false
        if (state == State.CLOSED || state == State.FAILED) return false
        val text = envelope(type, payload, id).toString()
        if (text.length > limits.maxOutboundChars) return false
        if (state == State.PAIRED && socket?.let { transport.sendText(it, text) } == true) return true
        if (queue.size >= limits.maxQueuedMessages) return false
        queue.addLast(text)
        return true
    }

    override fun onOpened(token: Long) {
        if (token != socket) return
        backoff.reset()
        setState(State.OPEN)
    }

    override fun onText(token: Long, text: String) {
        if (token != socket) return
        if (text == PAIRING_FRAME) {
            setState(State.PAIRED)
            while (queue.isNotEmpty()) {
                if (!transport.sendText(token, queue.first())) break
                queue.removeFirst()
            }
            return
        }
        val message = parse(text) ?: return
        if (message.retained) {
            if (message.type in retainedMessages || retainedMessages.size < limits.maxRetainedTypes) {
                retainedMessages[message.type] = message
            }
        }
        listener.onAppMessage(message)
    }

    override fun onClosed(token: Long, failed: Boolean) {
        if (token != socket) return
        socket = null
        if (backoff.attempts >= limits.maxReconnectAttempts) {
            setState(State.FAILED)
            return
        }
        setState(State.RECOVERING)
        val next = Tokens.next()
        timer = next
        transport.schedule(next, backoff.nextDelayMs(), this)
    }

    override fun onTimer(token: Long) {
        if (token != timer) return
        timer = null
        connect(State.RECOVERING)
    }

    fun parse(text: String): Message? {
        val json = JsonInput.parseObject(text, limits.maxInboundChars) ?: return null
        val type = JsonInput.string(json["type"])?.takeIf { it.isNotEmpty() && it.length <= limits.maxTypeLength } ?: return null
        val retained = (json["retained"] as? JsonPrimitive)?.content == "true"
        return Message(type, JsonInput.string(json["id"]), retained, json)
    }

    private fun connect(next: State) {
        val token = Tokens.next()
        socket = token
        setState(next)
        transport.openWebSocket(token, url, this)
    }

    private fun setState(next: State) {
        if (state == next) return
        state = next
        listener.onAppChannelState(next)
    }
}
