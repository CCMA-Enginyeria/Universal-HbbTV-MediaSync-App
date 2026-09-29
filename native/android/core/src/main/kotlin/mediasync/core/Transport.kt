package mediasync.core

import java.util.concurrent.atomic.AtomicLong

/**
 * Callbacks delivered by a platform [Transport]. The shell must invoke them
 * serially on the owner's execution context; tokens that are no longer
 * current are ignored, so late events from replaced sockets are harmless.
 */
interface TransportEvents {
    fun onOpened(token: Long) {}
    fun onText(token: Long, text: String) {}
    fun onDatagram(token: Long, data: ByteArray, receivedAtNanos: Long) {}
    fun onClosed(token: Long, failed: Boolean) {}
    fun onTimer(token: Long) {}
}

/**
 * Platform I/O used by the pure session state machines. Every resource is
 * identified by a unique token; [close] and [cancel] must be idempotent.
 */
interface Transport {
    fun openWebSocket(token: Long, url: String, events: TransportEvents)
    fun openUdp(token: Long, host: String, port: Int, events: TransportEvents)
    fun sendText(token: Long, text: String): Boolean
    fun sendDatagram(token: Long, data: ByteArray): Boolean
    fun close(token: Long)
    fun schedule(token: Long, delayMs: Long, events: TransportEvents)
    fun cancel(token: Long)
}

/** Local monotonic clock, in nanoseconds. Never wall-clock time. */
fun interface MonotonicClock {
    fun nanos(): Long
}

object Tokens {
    private val next = AtomicLong(1)
    fun next(): Long = next.getAndIncrement()
}

/** Bounded exponential backoff without randomness, so tests are deterministic. */
class Backoff(private val initialMs: Long = 1_000, private val maxMs: Long = 30_000, private val factor: Double = 2.0) {
    var attempts = 0
        private set

    fun nextDelayMs(): Long {
        val delay = (initialMs * Math.pow(factor, attempts.coerceAtMost(30).toDouble())).toLong().coerceAtMost(maxMs)
        attempts++
        return delay
    }

    fun reset() { attempts = 0 }
}

/** Monotonic nanoseconds rebased so CSS-WC 32-bit seconds never overflow or go negative. */
class RebasedClock(private val source: MonotonicClock) : MonotonicClock {
    private val origin = source.nanos() - 1_000_000_000L
    override fun nanos(): Long = source.nanos() - origin

    /** Converts a reading taken directly from [source] (e.g. a socket receive time). */
    fun fromSource(sourceNanos: Long): Long = sourceNanos - origin
}
