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