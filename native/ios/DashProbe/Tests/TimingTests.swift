import XCTest
import UIKit
import MobileVLCKit
@testable import DashProbe

/// Device timing gate for native DASH playback (see docs/ios-native-dash.md).
///
/// Thresholds are fixed here before measurement so results cannot be tuned to fit:
/// - Rate: the corrector requests continuous rates in 1 +/- 0.05 and treats changes
///   below 0.002 as noise, so the measured rate must be within
///   max(0.001, 25 % of the requested excess) of the request.
/// - Seek landing: within 2 s of the target, the default seek threshold; a larger
///   landing error would make the corrector seek again in a loop.
/// - Seek settling: media time advancing and at least 5 new displayed pictures
///   within 3 s of the request.
///
/// Requires network access to the external CCMA sample; not a deterministic unit test.
final class TimingTests: XCTestCase {
    private static let sample = "https://ccma-labs-generic.s3.eu-west-1.amazonaws.com/ibc-2026/_dash_Signes_IBC/manifest_signes.mpd"
    private let rateWindowS = 20.0
    private let rateSettleS = 3.0

    @MainActor
    private func startPlayback() async throws -> (ProbePlayer, UIView) {
        let owner = ProbePlayer()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 640, height: 360))
        owner.player.drawable = surface
        owner.play(Self.sample)
        let deadline = Date().addingTimeInterval(40)
        while owner.player.time.intValue < 2000 && Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertGreaterThanOrEqual(owner.player.time.intValue, 2000, "Native DASH media clock must advance")
        return (owner, surface)
    }

    private func uptime() -> Double { ProcessInfo.processInfo.systemUptime }

    private func log(_ line: String) { NSLog("DASH_TIMING %@", line) }

    /// Least-squares slope of media time against monotonic time; reduces the effect
    /// of coarse or jittery media-clock reporting compared with endpoint differences.
    /// Also returns the largest deviation from the fitted line, which bounds how far a
    /// single reported media time can be from a smooth clock.
    private func fit(_ samples: [(Double, Double)]) -> (slope: Double, maxResidualS: Double) {
        let n = Double(samples.count)
        let meanX = samples.map(\.0).reduce(0, +) / n
        let meanY = samples.map(\.1).reduce(0, +) / n
        let cov = samples.reduce(0) { $0 + ($1.0 - meanX) * ($1.1 - meanY) }
        let varX = samples.reduce(0) { $0 + ($1.0 - meanX) * ($1.0 - meanX) }
        let slope = cov / varX
        let residual = samples.map { abs($0.1 - (meanY + slope * ($0.0 - meanX))) }.max() ?? 0
        return (slope, residual)
    }

    @MainActor
    func testMeasuredProgressionAtCorrectionRates() async throws {
        let (owner, surface) = try await startPlayback()
        defer { owner.stop(); _ = surface }
        log("rate,requested,reported,measured,error,samples,distinctTimes,maxResidualS")
        var failures: [String] = []
        for requested: Float in [1, 0.95, 0.998, 1.002, 1.05, 1] {
            owner.setRate(requested)
            try await Task.sleep(nanoseconds: UInt64(rateSettleS * 1e9))
            var samples: [(Double, Double)] = []
            let end = uptime() + rateWindowS
            while uptime() < end {
                samples.append((uptime(), Double(owner.player.time.intValue) / 1000))
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            let (measured, maxResidual) = fit(samples)
            let error = measured - Double(requested)
            let tolerance = max(0.001, 0.25 * abs(Double(requested) - 1))
            let distinct = Set(samples.map(\.1)).count
            log("rate,\(requested),\(owner.player.rate),\(measured),\(error),\(samples.count),\(distinct),\(maxResidual)")
            if abs(error) > tolerance {
                failures.append("requested \(requested): measured \(measured), tolerance \(tolerance)")
            }
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "; "))
    }

    @MainActor
    func testSeekLandingAndResumedOutput() async throws {
        let (owner, surface) = try await startPlayback()
        defer { owner.stop(); _ = surface }
        log("seek,target,landed,landingError,advancingAfterS,picturesAfterS")
        var failures: [String] = []
        for target in [30.0, 121.3, 600.7, 15.0, 1000.0] {
            let requestedAt = uptime()
            let picturesAtRequest = owner.player.media?.statistics.displayedPictures ?? 0
            owner.player.time = VLCTime(int: Int32(target * 1000))
            var landed: Double?
            var advancingAt: Double?
            var picturesAt: Double?
            var previous: Double?
            var picturesAtLanding: Int32 = 0
            let deadline = requestedAt + 8
            while uptime() < deadline && (advancingAt == nil || picturesAt == nil) {
                let media = Double(owner.player.time.intValue) / 1000
                let pictures = owner.player.media?.statistics.displayedPictures ?? 0
                if advancingAt == nil, abs(media - target) <= 2, let prior = previous, media > prior, abs(prior - target) <= 2 {
                    advancingAt = uptime() - requestedAt
                    landed = prior
                    picturesAtLanding = pictures
                }
                if advancingAt != nil, picturesAt == nil, pictures >= picturesAtLanding + 5, pictures > picturesAtRequest {
                    picturesAt = uptime() - requestedAt
                }
                previous = media
                try await Task.sleep(nanoseconds: 20_000_000)
            }
            let landingError = landed.map { $0 - target }
            let fields: [Double?] = [landed, landingError, advancingAt, picturesAt]
            log("seek,\(target)," + fields.map { $0.map { String($0) } ?? "nil" }.joined(separator: ","))
            if landed == nil || abs(landingError ?? .infinity) > 2 || (picturesAt ?? .infinity) > 3 {
                failures.append("target \(target): landed \(String(describing: landed)), resumed after \(String(describing: picturesAt))")
            }
            // Let playback run before the next seek so each request starts from steady state.
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "; "))
    }
}
