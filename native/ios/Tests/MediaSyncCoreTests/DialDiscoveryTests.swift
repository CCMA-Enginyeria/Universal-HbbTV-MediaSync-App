import XCTest
@testable import MediaSyncCore

final class DialDiscoveryTests: XCTestCase {
    private let location = "http://192.168.1.10:8008/device.xml"
    private var response: String {
        "HTTP/1.1 200 OK\r\nLoCaTiOn: \(location)\r\nST: \(DialProtocol.searchTarget)\r\n\r\n"
    }
    private let deviceXml = """
        <root xmlns="urn:schemas-upnp-org:device-1-0"><device>
        <friendlyName> Living &amp; TV </friendlyName><manufacturer>Vendor</manufacturer>
        <modelName>Model</modelName><UDN>uuid:1234</UDN></device></root>
        """
    private let appXml = """
        <service xmlns="urn:dial-multiscreen-org:schemas:dial" xmlns:h="urn:hbbtv">
        <additionalData><h:X_HbbTV_App2AppURL>ws://192.168.1.10:8080/app2app/</h:X_HbbTV_App2AppURL>
        <h:X_HbbTV_InterDevSyncURL>ws://192.168.1.10:8080/cii</h:X_HbbTV_InterDevSyncURL>
        <h:X_HbbTV_UserAgent>HbbTV/1.5.1</h:X_HbbTV_UserAgent></additionalData></service>
        """

    private func terminal() throws -> DialTerminal {
        DialTerminal(device: try XCTUnwrap(DialProtocol.parseDevice(deviceXml, location: location,
                       applicationUrl: "http://192.168.1.10:8008/apps/")),
                     application: try XCTUnwrap(DialProtocol.parseApplication(appXml)))
    }

    func testSearchAndHeaders() {
        XCTAssertTrue(DialProtocol.searchMessage.hasSuffix("\r\n\r\n"))
        XCTAssertEqual(DialProtocol.parseResponse(response), location)
        XCTAssertNil(DialProtocol.parseResponse(response.replacingOccurrences(of: "200 OK", with: "404 Not Found")))
        XCTAssertNil(DialProtocol.parseResponse(response.replacingOccurrences(of: DialProtocol.searchTarget, with: "ssdp:all")))
        XCTAssertNil(DialProtocol.parseResponse(response.replacingOccurrences(of: location, with: "file:///etc/passwd")))
        XCTAssertNil(DialProtocol.parseResponse(response.replacingOccurrences(of: "\r\n\r\n", with: "\r\nLOCATION: \(location)\r\n\r\n")))
    }

    func testNamespacesAndApplicationHeader() throws {
        let result = try terminal()
        XCTAssertEqual(result.device.friendlyName, "Living & TV")
        XCTAssertEqual(result.device.hbbtvUrl, "http://192.168.1.10:8008/apps/HbbTV")
        XCTAssertTrue(result.supportsHbbtv)
        XCTAssertEqual(result.application?.interDeviceSyncUrl, "ws://192.168.1.10:8080/cii")
        XCTAssertEqual(result.device.id, "uuid:1234")
        XCTAssertTrue(result.supportsMediaSync)
        XCTAssertEqual(result.application?.userAgent, "HbbTV/1.5.1")
        XCTAssertNil(DialProtocol.parseDevice(deviceXml, location: location, applicationUrl: nil))
        XCTAssertNil(DialProtocol.parseDevice(deviceXml, location: location, applicationUrl: "/apps"))
        XCTAssertNil(DialProtocol.parseDevice(deviceXml, location: location, applicationUrl: "http://host/apps?query=1"))
    }

    func testRejectsMalformedXmlAndEntities() {
        XCTAssertNil(DialProtocol.parseApplication("<service>"))
        XCTAssertNil(DialProtocol.parseApplication("<!DOCTYPE service [<!ENTITY secret SYSTEM 'file:///etc/passwd'>]><service>&secret;</service>"))
        XCTAssertNil(DialProtocol.parseApplication("<root/>"))
        XCTAssertNil(DialProtocol.parseApplication(appXml.replacingOccurrences(of: "ws://", with: "file://"))?.app2AppUrl)
    }

    func testRepairsPlaceholderHosts() throws {
        let placeholder = appXml.replacingOccurrences(of: "192.168.1.10:8080/cii", with: "0.0.0.0:8080/cii")
            .replacingOccurrences(of: "ws://192.168.1.10:8080/app2app/", with: "ws://:8080/app2app/")
        XCTAssertNil(DialProtocol.parseApplication(placeholder)?.app2AppUrl)
        let repaired = try XCTUnwrap(DialProtocol.parseApplication(placeholder, realHost: "192.168.1.10"))
        XCTAssertEqual(repaired.interDeviceSyncUrl, "ws://192.168.1.10:8080/cii")
        XCTAssertEqual(repaired.app2AppUrl, "ws://192.168.1.10:8080/app2app/")
    }

    func testDeduplicatesRequests() throws {
        let session = DiscoverySession()
        XCTAssertNil(session.accept(response))
        session.start()
        let request = try XCTUnwrap(session.accept(response))
        XCTAssertNil(session.accept(response))
        XCTAssertTrue(session.complete(request, terminal: try terminal()))
        XCTAssertNil(session.accept(response))
        XCTAssertEqual(session.terminals.count, 1)
    }

    func testRestartAndRetryIgnoreStaleRequests() throws {
        let session = DiscoverySession()
        session.start()
        let old = try XCTUnwrap(session.accept(response))
        session.start()
        let current = try XCTUnwrap(session.accept(response))
        XCTAssertFalse(session.complete(old, terminal: try terminal()))
        XCTAssertFalse(session.complete(current, terminal: nil))
        let retry = try XCTUnwrap(session.accept(response))
        XCTAssertFalse(session.complete(current, terminal: try terminal()))
        XCTAssertTrue(session.complete(retry, terminal: try terminal()))
    }

    func testFinishAndStop() throws {
        let session = DiscoverySession()
        session.start()
        XCTAssertTrue(session.complete(try XCTUnwrap(session.accept(response)), terminal: try terminal()))
        session.finish()
        XCTAssertEqual(session.terminals.count, 1)
        XCTAssertFalse(session.isRunning)
        XCTAssertNil(session.accept(response))
        session.stop()
        XCTAssertTrue(session.terminals.isEmpty)
        session.start()
        let pending = try XCTUnwrap(session.accept(response))
        session.stop()
        XCTAssertFalse(session.complete(pending, terminal: try terminal()))
    }

    func testNonHbbtvFilter() throws {
        for allowed in [false, true] {
            let session = DiscoverySession(allowNonHbbtvDevices: allowed)
            session.start()
            let request = try XCTUnwrap(session.accept(response))
            let device = try terminal().device
            XCTAssertEqual(session.complete(request, terminal: DialTerminal(device: device, application: nil)), allowed)
        }
    }
}