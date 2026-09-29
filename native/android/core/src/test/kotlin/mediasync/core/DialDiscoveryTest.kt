package mediasync.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DialDiscoveryTest {
    private val location = "http://192.168.1.10:8008/device.xml"
    private val response = "HTTP/1.1 200 OK\r\nLoCaTiOn: $location\r\nST: ${DialProtocol.SEARCH_TARGET}\r\n\r\n"
    private val deviceXml = """<root xmlns="urn:schemas-upnp-org:device-1-0"><device>
        <friendlyName> Living &amp; TV </friendlyName><manufacturer>Vendor</manufacturer>
        <modelName>Model</modelName><UDN>uuid:1234</UDN></device></root>"""
    private val appXml = """<service xmlns="urn:dial-multiscreen-org:schemas:dial" xmlns:h="urn:hbbtv">
        <additionalData><h:X_HbbTV_App2AppURL>ws://192.168.1.10:8080/app2app/</h:X_HbbTV_App2AppURL>
        <h:X_HbbTV_InterDevSyncURL>ws://192.168.1.10:8080/cii</h:X_HbbTV_InterDevSyncURL>
        <h:X_HbbTV_UserAgent>HbbTV/1.5.1</h:X_HbbTV_UserAgent></additionalData></service>"""

    private fun terminal() = DialTerminal(
        assertNotNull(DialProtocol.parseDevice(deviceXml, location, "http://192.168.1.10:8008/apps/")),
        assertNotNull(DialProtocol.parseApplication(appXml)),
    )

    @Test fun formatsSearchAndParsesCaseInsensitiveHeaders() {
        assertTrue(DialProtocol.searchMessage.endsWith("\r\n\r\n"))
        assertTrue(DialProtocol.searchMessage.contains("MX: 3\r\n"))
        assertEquals(location, DialProtocol.parseResponse(response))
        assertNull(DialProtocol.parseResponse(response.replace("200 OK", "404 Not Found")))
        assertNull(DialProtocol.parseResponse(response.replace(DialProtocol.SEARCH_TARGET, "ssdp:all")))
        assertNull(DialProtocol.parseResponse(response.replace(location, "file:///etc/passwd")))
        assertNull(DialProtocol.parseResponse(response.replace("\r\n\r\n", "\r\nLOCATION: $location\r\n\r\n")))
    }

    @Test fun parsesNamespacesAndRequiresApplicationHeader() {
        val terminal = terminal()
        assertEquals("Living & TV", terminal.device.friendlyName)
        assertEquals("http://192.168.1.10:8008/apps/HbbTV", terminal.device.hbbtvUrl)
        assertTrue(terminal.supportsHbbtv)
        assertEquals("ws://192.168.1.10:8080/cii", terminal.application?.interDeviceSyncUrl)
        assertEquals("uuid:1234", terminal.device.id)
        assertTrue(terminal.supportsMediaSync)
        assertEquals("HbbTV/1.5.1", terminal.application?.userAgent)
        assertNull(DialProtocol.parseDevice(deviceXml, location, null))
        assertNull(DialProtocol.parseDevice(deviceXml, location, "/apps"))
        assertNull(DialProtocol.parseDevice(deviceXml, location, "http://host/apps?query=1"))
    }

    @Test fun rejectsMalformedXmlAndEntities() {
        assertNull(DialProtocol.parseApplication("<service>"))
        assertNull(DialProtocol.parseApplication("<!DOCTYPE service [<!ENTITY secret SYSTEM 'file:///etc/passwd'>]><service>&secret;</service>"))
        assertNull(DialProtocol.parseApplication("<root/>"))
        assertNull(DialProtocol.parseApplication(appXml.replace("ws://", "file://"))?.app2AppUrl)
        assertNull(DialProtocol.parseApplication(appXml.replace("ws://192.168.1.10:8080/cii", "http://192.168.1.10/cii"))?.interDeviceSyncUrl)
    }

    @Test fun repairsPlaceholderHostsWithTheRespondingHost() {
        val placeholder = appXml.replace("192.168.1.10:8080/cii", "0.0.0.0:8080/cii").replace("ws://192.168.1.10:8080/app2app/", "ws://:8080/app2app/")
        assertNull(DialProtocol.parseApplication(placeholder)?.app2AppUrl)
        val repaired = assertNotNull(DialProtocol.parseApplication(placeholder, "192.168.1.10"))
        assertEquals("ws://192.168.1.10:8080/cii", repaired.interDeviceSyncUrl)
        assertEquals("ws://192.168.1.10:8080/app2app/", repaired.app2AppUrl)
    }

    @Test fun deduplicatesPendingAndCompletedRequests() {
        val session = DiscoverySession()
        assertNull(session.accept(response))
        session.start()
        val request = assertNotNull(session.accept(response))
        assertNull(session.accept(response))
        assertTrue(session.complete(request, terminal()))
        assertNull(session.accept(response))
        assertEquals(1, session.terminals.size)
    }

    @Test fun ignoresOldRequestsAfterRestartOrRetry() {
        val session = DiscoverySession()
        session.start()
        val old = assertNotNull(session.accept(response))
        session.start()
        val current = assertNotNull(session.accept(response))
        assertFalse(session.complete(old, terminal()))
        assertFalse(session.complete(current, null))
        val retry = assertNotNull(session.accept(response))
        assertFalse(session.complete(current, terminal()))
        assertTrue(session.complete(retry, terminal()))
    }

    @Test fun finishKeepsResultsAndStopClearsThem() {
        val session = DiscoverySession()
        session.start()
        assertTrue(session.complete(assertNotNull(session.accept(response)), terminal()))
        session.finish()
        assertEquals(1, session.terminals.size)
        assertFalse(session.isRunning)
        assertNull(session.accept(response))
        session.stop()
        assertTrue(session.terminals.isEmpty())
        session.start()
        val pending = assertNotNull(session.accept(response))
        session.stop()
        assertFalse(session.complete(pending, terminal()))
    }

    @Test fun filtersNonHbbtvUnlessExplicitlyAllowed() {
        for (allowed in listOf(false, true)) {
            val session = DiscoverySession(allowed)
            session.start()
            val request = assertNotNull(session.accept(response))
            assertEquals(allowed, session.complete(request, terminal().copy(application = null)))
        }
    }
}