package mediasync.core

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.DatagramPacket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Single-use DIAL scan. [run] blocks the calling worker; device descriptions
 * are resolved concurrently (bounded) so one slow TV does not delay the rest.
 */
class DialDiscoveryScan(
    private val options: Options = Options(),
) : Closeable {
    data class Options(
        val durationMs: Int = 30_000,
        val requestTimeoutMs: Int = 5_000,
        val maxBodyBytes: Int = 1_048_576,
        val maxDevices: Int = 128,
        val allowNonHbbtvDevices: Boolean = false,
        val destination: InetSocketAddress = InetSocketAddress(DialProtocol.MULTICAST_ADDRESS, DialProtocol.PORT),
        val networkInterface: NetworkInterface? = null,
        /** Extra M-SEARCH transmissions, relative to the scan start (UDP is lossy). */
        val searchRetryDelaysMs: List<Int> = listOf(1_000, 3_000),
        val maxConcurrentRequests: Int = 4,
        /** Opens device-description requests, e.g. on the LAN when a VPN is the default route. */
        val openConnection: ((URL) -> java.net.URLConnection)? = null,
    ) {
        init {
            require(durationMs > 0 && requestTimeoutMs > 0)
            require(maxBodyBytes in 1..1_048_576 && maxDevices > 0)
            require(searchRetryDelaysMs.size <= 8 && searchRetryDelaysMs.all { it > 0 })
            require(maxConcurrentRequests in 1..16)
        }
    }

    data class Failure(val location: String, val message: String)
    data class Result(val terminals: List<DialTerminal>, val failures: List<Failure>, val cancelled: Boolean)
    private data class Response(val body: String, val applicationUrl: String?)

    private val started = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)
    private val expired = AtomicBoolean(false)
    private val resourceLock = Any()
    private val sessionLock = Any()
    private var socket: MulticastSocket? = null
    private val connections = mutableSetOf<HttpURLConnection>()
    private var finished = false
    private var deadlineNanos = 0L
    private val inFlight = AtomicInteger(0)

    /** [onFound] runs on a scan worker, serialised; it must not block or throw. */
    fun run(onFound: (DialTerminal) -> Unit = {}): Result {
        check(started.compareAndSet(false, true)) { "Create a new scan for each search" }
        if (cancelled.get()) return Result(emptyList(), emptyList(), true)
        val session = DiscoverySession(options.allowNonHbbtvDevices)
        val failures = mutableListOf<Failure>()
        val timer = Executors.newSingleThreadScheduledExecutor { Thread(it, "dial-timer").apply { isDaemon = true } }
        val workers: ExecutorService = Executors.newFixedThreadPool(options.maxConcurrentRequests) {
            Thread(it, "dial-resolve").apply { isDaemon = true }
        }
        deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(options.durationMs.toLong())
        session.start()
        timer.schedule({ expired.set(true); releaseResources() }, options.durationMs.toLong(), TimeUnit.MILLISECONDS)
        try {
            val receiver = MulticastSocket(null)
            synchronized(resourceLock) {
                if (inactive()) receiver.close() else socket = receiver
            }
            ensureActive()
            receiver.reuseAddress = true
            receiver.bind(InetSocketAddress(0))
            receiver.timeToLive = 2
            options.networkInterface?.let { receiver.networkInterface = it }
            val search = DialProtocol.searchMessage.toByteArray(Charsets.UTF_8)
            receiver.send(DatagramPacket(search, search.size, options.destination))
            options.searchRetryDelaysMs.filter { it < options.durationMs }.forEach { delay ->
                timer.schedule({
                    if (!inactive()) runCatching { receiver.send(DatagramPacket(search, search.size, options.destination)) }
                }, delay.toLong(), TimeUnit.MILLISECONDS)
            }
            val buffer = ByteArray(65507)
            while (!inactive() && synchronized(sessionLock) { session.terminals.size } < options.maxDevices) {
                receiver.soTimeout = remainingMs().coerceAtMost(250)
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    receiver.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val message = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                // Bounded fan-out, and only descriptions served by the host that answered (no LAN-triggered SSRF).
                if (inFlight.get() >= options.maxDevices) continue
                if (DialProtocol.parseResponse(message)?.let { sameHost(it, packet.address) } != true) continue
                val request = synchronized(sessionLock) { session.accept(message) } ?: continue
                inFlight.incrementAndGet()
                workers.execute {
                    val terminal = try {
                        resolve(request.location)
                    } catch (error: Exception) {
                        synchronized(sessionLock) {
                            if (!inactive() && !finished && failures.size < options.maxDevices) {
                                failures.add(Failure(request.location, error.message ?: "Device request failed"))
                            }
                        }
                        null
                    }
                    synchronized(sessionLock) {
                        if (!inactive() && !finished && session.complete(request, terminal)) onFound(requireNotNull(terminal))
                    }
                    inFlight.decrementAndGet()
                }
            }
        } catch (error: IOException) {
            if (!inactive()) throw error
        } finally {
            timer.shutdownNow()
            releaseResources()
            workers.shutdownNow()
            synchronized(sessionLock) {
                finished = true
                session.finish()
            }
        }
        return synchronized(sessionLock) {
            Result(if (cancelled.get()) emptyList() else session.terminals, failures.toList(), cancelled.get())
        }
    }

    override fun close() {
        cancelled.set(true)
        releaseResources()
    }

    private fun resolve(location: String): DialTerminal? {
        val description = get(location)
        val device = DialProtocol.parseDevice(description.body, location, description.applicationUrl)
            ?: throw IOException("Invalid device description or missing Application-URL")
        if (URI(device.applicationUrl).host?.equals(URI(location).host, ignoreCase = true) != true) {
            throw IOException("Application-URL host differs from the device description host")
        }
        val application = try {
            DialProtocol.parseApplication(get(device.hbbtvUrl).body, URI(location).host)
        } catch (error: IOException) {
            if (inactive() || !options.allowNonHbbtvDevices) throw error
            null
        }
        return DialTerminal(device, application)
    }

    private fun get(address: String): Response {
        ensureActive()
        val url = URL(address)
        val request = (options.openConnection?.invoke(url) ?: url.openConnection()) as HttpURLConnection
        request.instanceFollowRedirects = false
        request.useCaches = false
        request.connectTimeout = remainingMs().coerceAtMost(options.requestTimeoutMs)
        request.readTimeout = request.connectTimeout
        request.setRequestProperty("User-Agent", "DialApp/1.0")
        request.setRequestProperty("Accept-Encoding", "identity")
        synchronized(resourceLock) {
            if (inactive()) {
                request.disconnect()
                throw IOException("Scan ended")
            }
            connections.add(request)
        }
        try {
            ensureActive()
            if (request.responseCode !in 200..299) throw IOException("HTTP ${request.responseCode}")
            if (request.contentLengthLong > options.maxBodyBytes) throw IOException("Response exceeds size limit")
            val output = ByteArrayOutputStream()
            request.inputStream.use { input ->
                val chunk = ByteArray(8192)
                while (true) {
                    ensureActive()
                    val count = input.read(chunk)
                    if (count == -1) break
                    if (count > options.maxBodyBytes - output.size()) throw IOException("Response exceeds size limit")
                    output.write(chunk, 0, count)
                }
            }
            ensureActive()
            return Response(output.toString(Charsets.UTF_8.name()), request.getHeaderField("Application-URL"))
        } finally {
            synchronized(resourceLock) { connections.remove(request) }
            request.disconnect()
        }
    }

    /** True when [url] names [address] as an IP literal; host names are not resolved. */
    private fun sameHost(url: String, address: InetAddress?): Boolean {
        val host = runCatching { URI(url).host }.getOrNull()?.removeSurrounding("[", "]") ?: return false
        if (address == null || !(host.all { it.isDigit() || it == '.' } || ':' in host)) return false
        val literal = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return false
        return literal.address.contentEquals(address.address)
    }

    private fun inactive() = cancelled.get() || expired.get()

    private fun remainingMs(): Int {
        val remaining = TimeUnit.NANOSECONDS.toMillis(deadlineNanos - System.nanoTime())
        if (remaining <= 0) expired.set(true)
        return remaining.coerceIn(1, Int.MAX_VALUE.toLong()).toInt()
    }

    private fun ensureActive() {
        remainingMs()
        if (inactive()) throw IOException("Scan ended")
    }

    private fun releaseResources() {
        val (udp, http) = synchronized(resourceLock) {
            val current = socket to connections.toList()
            socket = null
            connections.clear()
            current
        }
        udp?.close()
        http.forEach { it.disconnect() }
    }
}