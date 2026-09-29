import Foundation
import XCTest
@testable import MediaSyncCore

/// Records transport calls and lets tests play the television's side.
final class FakeTransport: Transport {
    struct Resource {
        let token: Int64
        let url: String
        let events: TransportEvents
        let udp: Bool
    }

    struct Timer {
        let token: Int64
        let delayMs: Int64
        let events: TransportEvents
    }

    var open: [Resource] = []
    var timers: [Timer] = []
    var sent: [(Int64, String)] = []
    var datagrams: [(Int64, Data)] = []

    func openWebSocket(_ token: Int64, url: String, events: TransportEvents) { open.append(Resource(token: token, url: url, events: events, udp: false)) }
    func openUdp(_ token: Int64, host: String, port: Int, events: TransportEvents) {
        open.append(Resource(token: token, url: "udp://\(host):\(port)", events: events, udp: true))
    }
    func sendText(_ token: Int64, _ text: String) -> Bool {
        guard open.contains(where: { $0.token == token }) else { return false }
        sent.append((token, text))
        return true
    }
    func sendDatagram(_ token: Int64, _ data: Data) -> Bool {
        guard open.contains(where: { $0.token == token }) else { return false }
        datagrams.append((token, data))
        return true
    }
    func close(_ token: Int64) { open.removeAll { $0.token == token } }
    func schedule(_ token: Int64, delayMs: Int64, events: TransportEvents) { timers.append(Timer(token: token, delayMs: delayMs, events: events)) }
    func cancel(_ token: Int64) { timers.removeAll { $0.token == token } }

    func socket(_ suffix: String) -> Resource { open.last { $0.url.hasSuffix(suffix) }! }
    @discardableResult func opened(_ suffix: String) -> Resource {
        let resource = socket(suffix)
        resource.events.onOpened(resource.token)
        return resource
    }
    func text(_ resource: Resource, _ text: String) { resource.events.onText(resource.token, text) }
    func fire(_ delayMs: Int64) {
        let due = timers.filter { $0.delayMs == delayMs }
        timers.removeAll { $0.delayMs == delayMs }
        due.forEach { $0.events.onTimer($0.token) }
    }
    func remoteClose(_ resource: Resource) {
        open.removeAll { $0.token == resource.token }
        resource.events.onClosed(resource.token, failed: true)
    }
}

final class MediaSyncSessionTests: XCTestCase {
    private var transport: FakeTransport!
    private var now: Int64 = 5_000_000_000
    private var session: MediaSyncSession!
    private var snapshots: [MediaSyncSession.Snapshot] = []
    private var contents: [String?] = []
    private var appMessages: [App2AppChannel.Message] = []

    override func setUp() {
        transport = FakeTransport()
        snapshots = []
        contents = []
        appMessages = []
        now = 5_000_000_000
        session = MediaSyncSession(transport: transport, clock: { [unowned self] in self.now })
        session.onSnapshot = { [unowned self] in self.snapshots.append($0) }
        session.onContentChanged = { [unowned self] in self.contents.append($1) }
        session.onAppMessage = { [unowned self] in self.appMessages.append($1) }
    }

    private var state: MediaSyncSession.State { snapshots.last!.state }
    private var issue: MediaSyncSession.Issue { snapshots.last!.issue }

    private func cii(content: String = "https://cdn/a.mpd", wc: String = "udp://0.0.0.0:6677", ts: String = "ws://10.0.0.2:7681/ts") -> String {
        "{\"contentId\":\"\(content)\",\"presentationStatus\":[\"okay\"],\"wcUrl\":\"\(wc)\",\"tsUrl\":\"\(ts)\"," +
            "\"timelines\":[{\"timelineSelector\":\"urn:dvb:css:timeline:pts\",\"timelineProperties\":{\"unitsPerTick\":1,\"unitsPerSecond\":90000}}]}"
    }

    private func config(_ mode: SyncMode = .native) -> MediaSyncSession.Config {
        MediaSyncSession.Config(mode: mode, interDevSyncUrl: "ws://0.0.0.0:7681/cii", app2appUrl: "ws://10.0.0.2:7681/app2app", realHost: "10.0.0.2")
    }

    /// Answers the last UDP request as a TV whose clock is `offset` ahead; returns the session's local time.
    private func answerWallClock(offset: Int64, oneWay: Int64 = 2_000_000) -> Int64 {
        let (token, request) = transport.datagrams.last!
        var bytes = [UInt8](request)
        bytes[1] = 1
        let originate = WallClockMessage.decode(Data(bytes))!.originateNanos
        let receive = originate + oneWay + offset
        now += 2 * oneWay
        func put(_ offset: Int, _ nanos: Int64) {
            let seconds = nanos / 1_000_000_000
            let fraction = nanos % 1_000_000_000
            for index in 0..<4 { bytes[offset + index] = UInt8(truncatingIfNeeded: seconds >> (24 - 8 * Int64(index))) }
            for index in 0..<4 { bytes[offset + 4 + index] = UInt8(truncatingIfNeeded: fraction >> (24 - 8 * Int64(index))) }
        }
        put(16, receive)
        put(24, receive)
        transport.open.first { $0.token == token }!.events.onDatagram(token, Data(bytes), receivedAtNanos: 0)
        return originate + 2 * oneWay
    }

    private func synchronise() {
        session.start(config())
        let ciiSocket = transport.opened("/cii")
        XCTAssertEqual(ciiSocket.url, "ws://10.0.0.2:7681/cii")
        transport.text(ciiSocket, cii())
        let wc = transport.open.first { $0.udp }!
        XCTAssertEqual(wc.url, "udp://10.0.0.2:6677")
        wc.events.onOpened(wc.token)
        XCTAssertFalse(transport.open.contains { $0.url.hasSuffix("/ts") }, "TS waits for a wall-clock correlation")
        let local = answerWallClock(offset: 1_000_000_000_000)
        let ts = transport.opened("/ts")
        let setup = try! JSONSerialization.jsonObject(with: Data(transport.sent.last { $0.0 == ts.token }!.1.utf8)) as! [String: Any]
        XCTAssertEqual(setup["timelineSelector"] as? String, TimelineProtocol.pts)
        XCTAssertEqual(setup["contentIdStem"] as? String, "")
        transport.text(ts, "{\"contentTime\":\"900000\",\"wallClockTime\":\"\(local + 1_000_000_000_000)\",\"timelineSpeedMultiplier\":1}")
    }

    func testNativeFlowReachesSynchronisedAndExtrapolates() throws {
        synchronise()
        XCTAssertEqual(state, .synchronised)
        XCTAssertEqual(try XCTUnwrap(session.position()).seconds, 10, accuracy: 1e-6)
        now += 2_500_000_000
        let position = try XCTUnwrap(session.position())
        XCTAssertEqual(position.seconds, 12.5, accuracy: 1e-6)
        XCTAssertTrue(position.reliable)
    }

    func testContentChangeInvalidatesTimeline() {
        synchronise()
        transport.text(transport.socket("/cii"), "{\"contentId\":\"https://cdn/b.mpd\"}")
        XCTAssertEqual(contents.last ?? nil, "https://cdn/b.mpd")
        XCTAssertNil(session.position())
        XCTAssertEqual(state, .synchronising)
    }

    func testMixedCompatEndpointsAreRejected() {
        session.start(config(.compat))
        let ciiSocket = transport.opened("/hbbtv-sync-cii")
        transport.text(ciiSocket, cii(wc: "udp://10.0.0.2:6677", ts: "ws://10.0.0.2:7681/app2app/hbbtv-sync-ts"))
        XCTAssertEqual(issue, .invalidEndpoints)
        XCTAssertFalse(transport.open.contains { $0.udp || $0.url.hasSuffix("-ts") })
    }

    func testCompatUsesJsonWallClockAfterPairing() throws {
        session.start(config(.compat))
        let ciiSocket = transport.opened("/hbbtv-sync-cii")
        transport.text(ciiSocket, "pairingcompleted")
        transport.text(ciiSocket, cii(wc: "ws://10.0.0.2:7681/app2app/hbbtv-sync-wc", ts: "ws://10.0.0.2:7681/app2app/hbbtv-sync-ts"))
        let wc = transport.opened("-wc")
        transport.text(wc, "pairingcompleted")
        let request = try JSONSerialization.jsonObject(with: Data(transport.sent.last { $0.0 == wc.token }!.1.utf8)) as! [String: Any]
        let id = (request["id"] as! NSNumber).int64Value
        let ot = (request["ot"] as! NSNumber).int64Value
        now += 40_000_000
        transport.text(wc, "{\"v\":0,\"t\":1,\"id\":\(id),\"ot\":1,\"rt\":\(ot + 20_000_000).5,\"tt\":\(ot + 20_000_001)}")
        let ts = transport.opened("-ts")
        transport.text(ts, "pairingcompleted")
        XCTAssertGreaterThanOrEqual(transport.sent.filter { $0.0 == ts.token }.count, 2)
        transport.text(ts, "{\"contentTime\":0,\"wallClockTime\":\(now),\"timelineSpeedMultiplier\":0}")
        XCTAssertEqual(state, .synchronised)
        XCTAssertFalse(try XCTUnwrap(session.position()).isPlaying)
    }

    func testCiiLossRecoversWithNewTokenAndIgnoresStaleEvents() {
        session.start(config())
        let first = transport.opened("/cii")
        transport.text(first, cii())
        transport.remoteClose(first)
        XCTAssertEqual(state, .recovering)
        XCTAssertEqual(issue, .connectionLost)
        XCTAssertNil(contents.last ?? nil)
        XCTAssertFalse(transport.open.contains { $0.udp })
        first.events.onText(first.token, cii(content: "https://cdn/stale.mpd"))
        XCTAssertNil(contents.last ?? nil)
        transport.fire(1_000)
        let second = transport.opened("/cii")
        XCTAssertNotEqual(second.token, first.token)
        XCTAssertEqual(state, .waitingContent)
    }

    func testStopReleasesEverything() {
        synchronise()
        let tokens = transport.open.map { $0.token }
        session.stop()
        XCTAssertTrue(transport.open.isEmpty)
        XCTAssertTrue(transport.timers.isEmpty)
        XCTAssertEqual(state, .disconnected)
        let before = snapshots.count
        for token in tokens {
            session.onText(token, cii())
            session.onClosed(token, failed: true)
            session.onTimer(token)
        }
        XCTAssertEqual(snapshots.count, before)
    }

    func testMissingEndpointAndNoContent() {
        session.start(MediaSyncSession.Config(mode: .native, interDevSyncUrl: nil, app2appUrl: nil, realHost: nil))
        XCTAssertEqual(state, .error)
        XCTAssertEqual(issue, .noEndpoint)
        session.start(config())
        transport.opened("/cii")
        transport.fire(5_000)
        XCTAssertEqual(issue, .noContent)
    }

    func testAppChannelRelaysVerbatim() throws {
        session.start(config())
        let app = transport.opened("/hbbtv-sync-app")
        XCTAssertTrue(session.sendAppMessage(type: "hello", payload: 1, id: nil))
        XCTAssertFalse(transport.sent.contains { $0.0 == app.token })
        transport.text(app, "pairingcompleted")
        XCTAssertEqual(transport.sent.last { $0.0 == app.token }?.1, "{\"version\":1,\"type\":\"hello\",\"id\":null,\"payload\":1}")
        let raw = "{\"version\":1,\"type\":\"state\",\"id\":null,\"payload\":{\"n\":1.50},\"retained\":true}"
        transport.text(app, raw)
        XCTAssertEqual(appMessages.first?.raw, raw)
        XCTAssertEqual(CompanionProtocol.appMessage(rawMessage: raw), "{\"version\":1,\"type\":\"app-message\",\"message\":\(raw)}")
        XCTAssertEqual(session.retainedAppMessages.count, 1)
        transport.remoteClose(app)
        XCTAssertEqual(state, .connecting, "App channel loss does not affect CII")
    }
}

final class TransportProbeTests: XCTestCase {
    func testConfirmsOnlyUsableEndpointsAndCancels() {
        let transport = FakeTransport()
        var results: [Bool] = []
        let probe = TransportProbe(transport: transport, mode: .native, interDevSyncUrl: "ws://10.0.0.2:7681/cii",
                                   app2appUrl: "ws://10.0.0.2:7681/app2app", realHost: "10.0.0.2") { results.append($0) }
        probe.start()
        let socket = transport.opened("/cii")
        transport.text(socket, "{\"contentId\":\"x\"}")
        XCTAssertTrue(results.isEmpty)
        transport.text(socket, "{\"wcUrl\":\"udp://0.0.0.0:6677\",\"tsUrl\":\"ws://10.0.0.2:7681/ts\"}")
        XCTAssertEqual(results, [true])
        XCTAssertTrue(transport.open.isEmpty && transport.timers.isEmpty)

        let compat = TransportProbe(transport: transport, mode: .compat, interDevSyncUrl: nil, app2appUrl: "ws://10.0.0.2:7681/app2app",
                                    realHost: nil) { results.append($0) }
        compat.start()
        transport.text(transport.opened("hbbtv-sync-cii"), "{\"wcUrl\":\"udp://10.0.0.2:6677\",\"tsUrl\":\"ws://10.0.0.2:7681/app2app/hbbtv-sync-ts\"}")
        transport.fire(2_000)
        XCTAssertEqual(results, [true, false])

        let cancelled = TransportProbe(transport: transport, mode: .native, interDevSyncUrl: "ws://h/cii", app2appUrl: nil, realHost: nil) { results.append($0) }
        cancelled.start()
        cancelled.cancel()
        transport.fire(2_000)
        XCTAssertEqual(results, [true, false])
    }
}

final class PlaybackCorrectorTests: XCTestCase {
    private func player(_ time: Double, playing: Bool = true, rate: Double = 1, buffering: Bool = false) -> PlaybackCorrector.Player {
        PlaybackCorrector.Player(mediaTimeS: time, liveEpochS: nil, isPlaying: playing, isBuffering: buffering, rate: rate)
    }

    private func tv(_ position: Double, playing: Bool = true, reliable: Bool = true) -> PlaybackCorrector.Tv {
        PlaybackCorrector.Tv(positionS: position, liveEpochS: nil, isPlaying: playing, reliable: reliable)
    }

    func testPauseResumeSeekAndCooldown() {
        let corrector = PlaybackCorrector()
        XCTAssertEqual(corrector.update(nowMs: 0, tv: tv(10, playing: false), player: player(10), mode: .native, isLive: false).commands, [.pause])
        XCTAssertEqual(corrector.update(nowMs: 100, tv: tv(30), player: player(10, playing: false), mode: .native, isLive: false).commands,
                       [.seek(30), .play])
        let other = PlaybackCorrector()
        XCTAssertEqual(other.update(nowMs: 0, tv: tv(20), player: player(10), mode: .native, isLive: false).commands, [.seek(20.4)])
        XCTAssertEqual(other.update(nowMs: 500, tv: tv(20.5), player: player(10.5), mode: .native, isLive: false).status, .seeking)
        other.onSeekCompleted()
        XCTAssertEqual(other.update(nowMs: 600, tv: tv(20.6), player: player(20.6), mode: .native, isLive: false).status, .locked)
    }

    func testCompatRateAndLiveSeek() {
        let corrector = PlaybackCorrector()
        let result = corrector.update(nowMs: 0, tv: tv(15), player: player(10), mode: .compat, isLive: false)
        XCTAssertEqual(result.status, .adjusting)
        let live = PlaybackCorrector().update(nowMs: 0, tv: PlaybackCorrector.Tv(positionS: 100, liveEpochS: 1_000_100, isPlaying: true, reliable: true),
            player: PlaybackCorrector.Player(mediaTimeS: 50, liveEpochS: 1_000_090, isPlaying: true, isBuffering: false, rate: 1),
            mode: .native, isLive: true)
        XCTAssertEqual(live.commands, [.seek(60.4)])
        let lost = PlaybackCorrector().update(nowMs: 0, tv: nil, player: player(10, rate: 1.02), mode: .native, isLive: false)
        XCTAssertEqual(lost.commands, [.pause, .setRate(1)])
    }
}

final class WallClockEstimatorTests: XCTestCase {
    func testOffsetRoundTripAndDispersionGrowth() {
        let estimator = WallClockEstimator(localMaxFreqErrorPpm: 500)
        let sample = WallClockEstimator.Sample(localSendNanos: 1_000_000_000, remoteReceiveNanos: 11_000_000_000,
                                               remoteTransmitNanos: 11_000_000_000, localReceiveNanos: 1_020_000_000)
        XCTAssertTrue(estimator.accept(sample))
        XCTAssertEqual(sample.roundTripNanos, 20_000_000)
        XCTAssertEqual(estimator.wallClockNanos(1_000_000_000), 10_990_000_000)
        XCTAssertEqual(estimator.dispersionNanos(2_020_000_000), 10_000_000 + 1e9 * 500e-6, accuracy: 1e-3)
        XCTAssertFalse(estimator.accept(WallClockEstimator.Sample(localSendNanos: 1_030_000_000, remoteReceiveNanos: 11_000_000_000,
            remoteTransmitNanos: 11_000_000_000, localReceiveNanos: 1_090_000_000)))
    }
}
