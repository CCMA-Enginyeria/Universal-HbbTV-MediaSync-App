import XCTest
import UIKit
@testable import DashProbe

final class PlaybackTests: XCTestCase {
    @MainActor
    func testExternalDashAdvancesAndSeeks() async throws {
        let owner = ProbePlayer()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 640, height: 360))
        owner.player.drawable = surface
        defer { owner.stop() }
        owner.play("https://ccma-labs-generic.s3.eu-west-1.amazonaws.com/ibc-2026/_dash_Signes_IBC/manifest_signes.mpd")
        let deadline = Date().addingTimeInterval(40)
        while owner.player.time.intValue < 2000 && Date() < deadline {
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThanOrEqual(owner.player.time.intValue, 2000, "Native DASH media clock must advance")
        XCTAssertTrue(owner.player.isSeekable)
        owner.seek(30)
        let seekDeadline = Date().addingTimeInterval(10)
        while owner.player.time.intValue < 29000 && Date() < seekDeadline {
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThanOrEqual(owner.player.time.intValue, 29000)
        XCTAssertLessThan(owner.player.time.intValue, 35000)
    }
}