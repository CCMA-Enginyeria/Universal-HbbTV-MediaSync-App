package mediasync.core

import com.sun.net.httpserver.HttpServer
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class DialDiscoveryScanTest {
    private class Television : AutoCloseable {
        val executor = Executors.newCachedThreadPool()
        val udp = DatagramSocket(InetSocketAddress(InetAddress.getLoopbackAddress(), 0))
        val http = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        val base = "http://127.0.0.1:${http.address.port}"
        var location = "$base/device.xml"
        var applicationUrl = "$base/apps/"
        val descriptions = AtomicInteger()
        val applications = AtomicInteger()
        var status = 200
        var body = "<root><device><friendlyName>Test TV</friendlyName></device></root>"
        var appStatus = 200
        var chunked = false
        var receivedAgent: String? = null
        var receivedSearch: String? = null

        init {
            http.executor = executor
            http.createContext("/device.xml") { exchange ->
                descriptions.incrementAndGet()
                exchange.responseHeaders.add("Application-URL", applicationUrl)
                exchange.responseHeaders.add("Location", "$base/redirected")
                val bytes = body.toByteArray()
                exchange.sendResponseHeaders(status, if (chunked) 0 else bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            http.createContext("/apps/HbbTV") { exchange ->
                applications.incrementAndGet()
                receivedAgent = exchange.requestHeaders.getFirst("User-Agent")
                val bytes = "<service><additionalData><X_HbbTV_App2AppURL>ws://localhost:8080/app2app/</X_HbbTV_App2AppURL></additionalData></service>".toByteArray()
                exchange.sendResponseHeaders(appStatus, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            http.start()
        }

        fun respond() = executor.submit {
            udp.soTimeout = 3000
            val packet = DatagramPacket(ByteArray(4096), 4096)
            udp.receive(packet)
            receivedSearch = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
            val message = "HTTP/1.1 200 OK\r\nST: ${DialProtocol.SEARCH_TARGET}\r\nLOCATION: $location\r\n\r\n".toByteArray()
            repeat(3) { udp.send(DatagramPacket(message, message.size, packet.socketAddress)) }
        }

        fun options() = DialDiscoveryScan.Options(durationMs = 700,
            requestTimeoutMs = 300, destination = InetSocketAddress(InetAddress.getLoopbackAddress(), udp.localPort))

        override fun close() {
            udp.close()
            http.stop(0)
            executor.shutdownNow()
        }
    }

    @Test fun discoversThroughUdpAndHttpAndDeduplicates() {
        Television().use { television ->
            val responder = television.respond()
            val found = mutableListOf<DialTerminal>()
            val result = DialDiscoveryScan(television.options()).use { it.run(found::add) }
            responder.get(2, TimeUnit.SECONDS)
            assertFalse(result.cancelled)
            assertTrue(result.failures.isEmpty())
            assertEquals("Test TV", result.terminals.single().device.friendlyName)
            assertEquals(result.terminals, found)
            assertEquals(1, television.descriptions.get())
            assertEquals(1, television.applications.get())
            assertEquals("DialApp/1.0", television.receivedAgent)
            assertEquals(DialProtocol.searchMessage, television.receivedSearch)
        }
    }

    @Test fun ignoresLocationsNotServedByTheResponder() {
        Television().use { television ->
            television.location = "http://192.0.2.10:${television.http.address.port}/device.xml"
            val responder = television.respond()
            val result = DialDiscoveryScan(television.options()).use { it.run() }
            responder.get(2, TimeUnit.SECONDS)
            assertTrue(result.terminals.isEmpty() && result.failures.isEmpty(), "No request to a host that did not answer")
            assertEquals(0, television.descriptions.get())
        }
    }

    @Test fun rejectsApplicationUrlOnAnotherHost() {
        Television().use { television ->
            television.applicationUrl = "http://192.0.2.10/apps/"
            val responder = television.respond()
            val result = DialDiscoveryScan(television.options()).use { it.run() }
            responder.get(2, TimeUnit.SECONDS)
            assertTrue(result.terminals.isEmpty())
            assertTrue(result.failures.any { it.message.contains("Application-URL host") })
            assertEquals(0, television.applications.get())
        }
    }

    @Test fun rejectsRedirectAndHttpFailure() {
        for (status in listOf(302, 500)) {
            Television().use { television ->
                television.status = status
                val responder = television.respond()
                val result = DialDiscoveryScan(television.options()).use { it.run() }
                responder.get(2, TimeUnit.SECONDS)
                assertTrue(result.terminals.isEmpty())
                assertTrue(result.failures.any { it.message == "HTTP $status" })
                assertEquals(0, television.applications.get())
            }
        }
    }

    @Test fun boundsFixedAndChunkedBodies() {
        for (chunked in listOf(false, true)) {
            Television().use { television ->
                television.body = "x".repeat(4096)
                television.chunked = chunked
                val responder = television.respond()
                val result = DialDiscoveryScan(television.options().copy(maxBodyBytes = 512)).use { it.run() }
                responder.get(2, TimeUnit.SECONDS)
                assertTrue(result.terminals.isEmpty())
                assertTrue(result.failures.any { it.message.contains("size limit") })
            }
        }
    }

    @Test fun preservesExplicitNonHbbtvMode() {
        Television().use { television ->
            television.appStatus = 404
            val responder = television.respond()
            val result = DialDiscoveryScan(television.options().copy(allowNonHbbtvDevices = true)).use { it.run() }
            responder.get(2, TimeUnit.SECONDS)
            assertFalse(result.terminals.single().supportsHbbtv)
        }
    }

    @Test fun cancelsAnIdleSocketAndRejectsReuse() {
        Television().use { television ->
            val scan = DialDiscoveryScan(television.options().copy(durationMs = 10_000))
            val result = television.executor.submit<DialDiscoveryScan.Result> { scan.run() }
            val packet = DatagramPacket(ByteArray(4096), 4096)
            television.udp.soTimeout = 2000
            television.udp.receive(packet)
            scan.close()
            assertTrue(result.get(2, TimeUnit.SECONDS).cancelled)
            assertFailsWith<IllegalStateException> { scan.run() }
        }
    }

    @Test fun cancelsBeforeStart() {
        val scan = DialDiscoveryScan()
        scan.close()
        assertTrue(scan.run().cancelled)
    }

    @Test fun cancelsPendingHttpWithoutPublishingResults() {
        Television().use { television ->
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            val found = AtomicInteger()
            television.http.removeContext("/device.xml")
            television.http.createContext("/device.xml") { exchange ->
                entered.countDown()
                release.await(3, TimeUnit.SECONDS)
                exchange.close()
            }
            val responder = television.respond()
            val scan = DialDiscoveryScan(television.options().copy(durationMs = 10_000))
            try {
                val result = television.executor.submit<DialDiscoveryScan.Result> {
                    scan.run { found.incrementAndGet() }
                }
                assertTrue(entered.await(2, TimeUnit.SECONDS))
                scan.close()
                val completed = result.get(2, TimeUnit.SECONDS)
                assertTrue(completed.cancelled)
                assertTrue(completed.terminals.isEmpty())
                assertEquals(0, found.get())
                responder.get(2, TimeUnit.SECONDS)
            } finally {
                release.countDown()
                scan.close()
            }
        }
    }

    @Test fun slowTelevisionDoesNotDelayOthers() {
        Television().use { slow ->
            Television().use { fast ->
                val release = CountDownLatch(1)
                slow.http.removeContext("/device.xml")
                slow.http.createContext("/device.xml") { exchange ->
                    release.await(3, TimeUnit.SECONDS)
                    exchange.close()
                }
                val responder = slow.executor.submit {
                    slow.udp.soTimeout = 3000
                    val packet = DatagramPacket(ByteArray(4096), 4096)
                    slow.udp.receive(packet)
                    for (base in listOf(slow.base, fast.base)) {
                        val message = "HTTP/1.1 200 OK\r\nST: ${DialProtocol.SEARCH_TARGET}\r\nLOCATION: $base/device.xml\r\n\r\n".toByteArray()
                        slow.udp.send(DatagramPacket(message, message.size, packet.socketAddress))
                    }
                }
                val found = CountDownLatch(1)
                val scan = DialDiscoveryScan(slow.options().copy(durationMs = 5_000, requestTimeoutMs = 4_000))
                try {
                    val result = slow.executor.submit<DialDiscoveryScan.Result> { scan.run { found.countDown() } }
                    assertTrue(found.await(2, TimeUnit.SECONDS), "The fast TV is published while the slow one is pending")
                    scan.close()
                    assertTrue(result.get(2, TimeUnit.SECONDS).cancelled)
                    responder.get(2, TimeUnit.SECONDS)
                } finally {
                    release.countDown()
                    scan.close()
                }
            }
        }
    }

    @Test fun retriesSearchWhenTheFirstPacketIsLost() {
        Television().use { television ->
            val responder = television.executor.submit {
                television.udp.soTimeout = 3000
                val packet = DatagramPacket(ByteArray(4096), 4096)
                television.udp.receive(packet)
                television.udp.receive(packet)
                val message = "HTTP/1.1 200 OK\r\nST: ${DialProtocol.SEARCH_TARGET}\r\nLOCATION: ${television.base}/device.xml\r\n\r\n".toByteArray()
                television.udp.send(DatagramPacket(message, message.size, packet.socketAddress))
            }
            val options = television.options().copy(durationMs = 1_500, searchRetryDelaysMs = listOf(200))
            val result = DialDiscoveryScan(options).use { it.run() }
            responder.get(2, TimeUnit.SECONDS)
            assertEquals(1, result.terminals.size)
        }
    }

    @Test fun boundsSlowHttpByScanDeadline() {
        Television().use { television ->
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            television.http.removeContext("/device.xml")
            television.http.createContext("/device.xml") { exchange ->
                entered.countDown()
                release.await(3, TimeUnit.SECONDS)
                exchange.close()
            }
            val responder = television.respond()
            try {
                val result = television.executor.submit<DialDiscoveryScan.Result> {
                    DialDiscoveryScan(television.options().copy(durationMs = 500, requestTimeoutMs = 5000)).use { it.run() }
                }
                assertTrue(entered.await(2, TimeUnit.SECONDS))
                val completed = result.get(2, TimeUnit.SECONDS)
                assertFalse(completed.cancelled)
                assertTrue(completed.terminals.isEmpty())
                responder.get(2, TimeUnit.SECONDS)
            } finally { release.countDown() }
        }
    }
}