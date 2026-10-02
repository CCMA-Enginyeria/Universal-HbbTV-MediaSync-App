import XCTest
@testable import MediaSyncCore

final class DialDiscoveryScanTests: XCTestCase {
    func testRejectsInvalidOptions() async {
        var options = DialDiscoveryScan.Options()
        options.duration = 0
        do {
            _ = try await DialDiscoveryScan(options: options).run()
            XCTFail("Invalid duration must fail")
        } catch {}
    }

    func testOnlyLocationsNamingTheResponderAreFetched() {
        var responder = in_addr()
        inet_pton(AF_INET, "192.168.1.48", &responder)
        XCTAssertTrue(SSDPPacket.names("http://192.168.1.48:7681/dd.xml", address: responder.s_addr))
        XCTAssertFalse(SSDPPacket.names("http://192.0.2.10:7681/dd.xml", address: responder.s_addr), "No LAN-triggered SSRF")
        XCTAssertFalse(SSDPPacket.names("http://tv.local:7681/dd.xml", address: responder.s_addr), "Host names are not resolved")
    }

    func testApplicationUrlMustStayOnTheDescriptionHost() {
        XCTAssertTrue(DialDiscoveryScan.sameHost("http://192.168.1.48:8080/apps", "http://192.168.1.48:7681/dd.xml"))
        XCTAssertFalse(DialDiscoveryScan.sameHost("http://192.0.2.10/apps", "http://192.168.1.48:7681/dd.xml"))
    }

    func testDeadlineEndsIdleScan() async throws {
        var options = DialDiscoveryScan.Options()
        options.destination = "127.0.0.1"
        options.port = 9
        options.duration = 0.1
        let result = try await DialDiscoveryScan(options: options).run()
        XCTAssertFalse(result.cancelled)
        XCTAssertTrue(result.terminals.isEmpty)
    }

    func testCancellationEndsScan() async throws {
        var options = DialDiscoveryScan.Options()
        options.destination = "127.0.0.1"
        options.port = 9
        let task = Task { try await DialDiscoveryScan(options: options).run() }
        task.cancel()
        let result = try await task.value
        XCTAssertTrue(result.cancelled)
        XCTAssertTrue(result.terminals.isEmpty)
    }
}