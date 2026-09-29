import Foundation
import XCTest
@testable import MediaSyncCore

final class SyncControllerTests: XCTestCase {
    func testMatchesJavaScriptReference() throws {
        let nativeDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixture = nativeDirectory.appendingPathComponent("fixtures/sync-controller.tsv")
        let content = try String(contentsOf: fixture, encoding: .utf8)
        let rows = content.split(separator: "\n").dropFirst()
        XCTAssertGreaterThan(rows.count, 900)
        let controller = SyncController()
        for (index, row) in rows.enumerated() {
            let fields = row.split(separator: "\t").map(String.init)
            guard fields.count == 10 else {
                XCTFail("Invalid fixture row \(index)")
                return
            }
            if fields[1] == "1" { controller.reset() }
            let decision = controller.update(
                playerTime: try XCTUnwrap(Double(fields[2])),
                tvTime: try XCTUnwrap(Double(fields[3])),
                seekThresholdS: try XCTUnwrap(Double(fields[4]))
            )
            let context = "\(fields[0]) row \(index)"
            XCTAssertEqual(decision.action.rawValue, fields[5], context)
            XCTAssertEqual(decision.rate, try XCTUnwrap(Double(fields[6])), accuracy: 1e-12, context)
            XCTAssertEqual(decision.drift, try XCTUnwrap(Double(fields[7])), accuracy: 1e-12, context)
            XCTAssertEqual(decision.filteredDrift, try XCTUnwrap(Double(fields[8])), accuracy: 1e-12, context)
            XCTAssertEqual(controller.mode.rawValue, fields[9], context)
        }
    }

    func testResetClearsState() {
        let controller = SyncController()
        _ = controller.update(playerTime: 0.5, tvTime: 0)
        controller.reset()
        XCTAssertNil(controller.filteredDrift)
        XCTAssertEqual(controller.currentRate, 1)
        XCTAssertEqual(controller.mode, .locked)
    }

    func testCustomOptions() {
        var options = SyncController.Options()
        options.maxRateDelta = 0.01
        let controller = SyncController(options: options)
        XCTAssertEqual(controller.update(playerTime: -1, tvTime: 0).rate, 1.01, accuracy: 1e-12)
    }
}