import Foundation
import XCTest
@testable import MediaSyncCore

/// Shared fixtures in native/fixtures/protocol; the Kotlin suite asserts the same cases.
final class ProtocolFixturesTests: XCTestCase {
    private static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("fixtures/protocol")

    private var cases: [String: Any] = [:]

    override func setUpWithError() throws {
        let data = try Data(contentsOf: Self.directory.appendingPathComponent("cases.json"))
        cases = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func list(_ name: String) -> [[String: Any]] { cases[name] as? [[String: Any]] ?? [] }
    private func text(_ file: String) throws -> String { try String(contentsOf: Self.directory.appendingPathComponent(file), encoding: .utf8) }
    private func str(_ value: Any?) -> String? { value is NSNull ? nil : (value as? String) ?? (value as? NSNumber)?.stringValue }
    private func hex(_ value: String) -> Data {
        var data = Data()
        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(index, offsetBy: 2)
            data.append(UInt8(value[index..<next], radix: 16)!)
            index = next
        }
        return data
    }

    func testWallClockPackets() {
        for item in list("wallClock") {
            let decoded = WallClockMessage.decode(hex(item["hex"] as! String))
            guard let expect = item["expect"] as? [String: Any] else {
                XCTAssertNil(decoded, item["name"] as? String ?? "")
                continue
            }
            guard let message = decoded else { return XCTFail("Rejected \(item["name"] ?? "")") }
            XCTAssertEqual(message.type, expect["type"] as? Int)
            XCTAssertEqual(message.precision, expect["precision"] as? Int)
            XCTAssertEqual(message.maxFreqError, (expect["maxFreqError"] as? NSNumber)?.int64Value)
            XCTAssertEqual(message.originateNanos, Int64(expect["originate"] as! String))
            XCTAssertEqual(message.receiveNanos, Int64(expect["receive"] as! String))
            XCTAssertEqual(message.transmitNanos, Int64(expect["transmit"] as! String))
        }
    }

    func testCatalogRefreshPreservesSelection() throws {
        let xml = """
        <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" minimumUpdatePeriod="PT900S">
          <Period id="p"><AdaptationSet id="en" contentType="audio" lang="en"><Representation id="a"/></AdaptationSet></Period>
        </MPD>
        """
        let manifest = try MpdParser.parse(xml, url: "https://example.test/live.mpd")
        let selected = try XCTUnwrap(manifest.audio.first)
        XCTAssertEqual(manifest.refreshDelayMs, 60_000)
        XCTAssertEqual(manifest.refreshedTrack(selected), selected)
        let next = try MpdParser.parse(xml.replacingOccurrences(of: "id=\"p\"", with: "id=\"next\""), url: manifest.url)
        XCTAssertEqual(next.refreshedTrack(selected)?.id, "next/en")
        let missing = try MpdParser.parse(xml.replacingOccurrences(of: "lang=\"en\"", with: "lang=\"es\"")
            .replacingOccurrences(of: "id=\"en\"", with: "id=\"es\""), url: manifest.url)
        XCTAssertNil(missing.refreshedTrack(selected))
        let vod = try MpdParser.parse(xml.replacingOccurrences(of: "dynamic", with: "static"), url: manifest.url)
        XCTAssertNil(vod.refreshDelayMs)
    }

        func testCatalogRefreshRejectsReusedIdentityForAnotherLanguageOrRole() throws {
                let xml = """
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
                    <Period id="p"><AdaptationSet id="audio" contentType="audio" lang="en"><Role value="main"/><Representation id="a"/></AdaptationSet></Period>
                </MPD>
                """
                let url = "https://example.test/live.mpd"
                let original = try MpdParser.parse(xml, url: url)
                let selected = try XCTUnwrap(original.audio.first)
                for changed in [xml.replacingOccurrences(of: "lang=\"en\"", with: "lang=\"es\""),
                                                xml.replacingOccurrences(of: "value=\"main\"", with: "value=\"alternate\"")] {
                        XCTAssertNil(try MpdParser.parse(changed, url: url).refreshedTrack(selected))
                        let replacement = """
                        <AdaptationSet id="replacement" contentType="audio" lang="en"><Role value="main"/><Representation id="b"/></AdaptationSet>
                        """
                        let refreshed = try MpdParser.parse(changed.replacingOccurrences(of: "</Period>", with: replacement + "</Period>"), url: url)
                        XCTAssertEqual(refreshed.refreshedTrack(selected)?.id, "p/replacement")
                }
                let noRole = try MpdParser.parse(xml.replacingOccurrences(of: "<Role value=\"main\"/>", with: ""), url: url)
                let emptyRole = try MpdParser.parse(xml.replacingOccurrences(of: "value=\"main\"", with: "value=\"\""), url: url)
                XCTAssertEqual(emptyRole.refreshedTrack(noRole.audio.first), emptyRole.audio.first)
        }

        func testSubtitleScheduleLooksAheadWithoutResetting() {
        let template = SegmentTemplate(initialization: nil, media: "text-$Number$.m4s", timescale: 1,
                                       duration: 2, startNumber: 1, presentationTimeOffset: 0)
        let schedule = TextSegmentSchedule(template: template, baseUrl: "https://example.test/", isLive: false,
                                           availabilityStartTimeMs: nil, lookahead: 2)
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 20), [10, 11, 12, 13])
        for number: Int64 in [10, 11, 12] {
            schedule.complete(number, cues: [Cue(startS: Double(number) * 2 - 2, endS: Double(number) * 2, text: "c\(number)")])
        }
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 21), [13])
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 22), [13, 14])
        XCTAssertEqual(schedule.cues().count, 3)
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 2), [1, 2, 3, 4])
        XCTAssertTrue(schedule.cues().isEmpty)
    }

        func testSubtitleScheduleResetsAfterSeek() {
        let template = SegmentTemplate(initialization: nil, media: "text-$Number$.m4s", timescale: 1,
                                       duration: 2, startNumber: 1, presentationTimeOffset: 0)
        let schedule = TextSegmentSchedule(template: template, baseUrl: "https://example.test/", isLive: false,
                                           availabilityStartTimeMs: nil)
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 20), [10, 11])
        schedule.complete(11, cues: [Cue(startS: 20, endS: 22, text: "old")])
        schedule.complete(11, cues: [Cue(startS: 20, endS: 22, text: "new")])
        XCTAssertEqual(schedule.cues().map { $0.text }, ["new"])
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 2), [1, 2])
        XCTAssertTrue(schedule.cues().isEmpty)
        schedule.complete(2, cues: [])
        XCTAssertTrue(schedule.pending(nowEpochMs: 0, positionS: 2).isEmpty)
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 4), [3])
        XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 4), [3])
    }

        func testTextTimelineResolvesPeriodOffsets() throws {
                let xml = """
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period start="PT10S" duration="PT6S">
                    <SegmentTemplate timescale="10" presentationTimeOffset="100" media="text-$Time$.xml"/>
                    <AdaptationSet contentType="text" mimeType="application/ttml+xml">
                        <SegmentTemplate><SegmentTimeline><S t="100" d="20" r="-1"/></SegmentTimeline></SegmentTemplate>
                        <Representation id="text"><BaseURL>captions/</BaseURL></Representation>
                    </AdaptationSet></Period></MPD>
                """
                let manifest = try MpdParser.parse(xml, url: "https://example.test/stream.mpd")
                let track = try XCTUnwrap(manifest.text.first)
                let schedule = TextSegmentSchedule(template: try XCTUnwrap(track.segmentTemplate), baseUrl: try XCTUnwrap(track.baseUrl),
                                                                                     isLive: false, availabilityStartTimeMs: nil)
                XCTAssertEqual(schedule.pending(nowEpochMs: 0, positionS: 12), [1, 2])
                XCTAssertEqual(schedule.url(2), "https://example.test/captions/text-120.xml")
                XCTAssertNil(schedule.url(4))
                schedule.complete(2, cues: [Cue(startS: 12, endS: 14, text: "caption")])
                XCTAssertEqual(schedule.cues(), [Cue(startS: 12, endS: 14, text: "caption")])
        }

    func testWallClockRequestRoundTrip() {
        var bytes = [UInt8](WallClockMessage.request(originateNanos: 4_294_967_295_999_999_999))
        XCTAssertEqual(bytes.count, 32)
        bytes[1] = 1
        XCTAssertEqual(WallClockMessage.decode(Data(bytes))?.originateNanos, 4_294_967_295_999_999_999)
    }

    func testTimelineMessages() {
        for item in list("timeline") {
            let input = item["text"] as! String
            let parsed = TimelineProtocol.parse(input)
            switch item["expect"] {
            case is NSNull: XCTAssertNil(parsed, input)
            case let value as String where value == "unavailable": XCTAssertEqual(parsed, .unavailable, input)
            case let expect as [String: Any]:
                guard case .available(let timestamp)? = parsed else { return XCTFail("Expected timestamp for \(input)") }
                XCTAssertEqual(timestamp.contentTime, Int64(expect["contentTime"] as! String), input)
                XCTAssertEqual(timestamp.wallClockTime, Int64(expect["wallClockTime"] as! String), input)
                XCTAssertEqual(timestamp.speed, (expect["speed"] as! NSNumber).doubleValue, input)
            default: XCTFail("Invalid fixture \(input)")
            }
        }
    }

    private func advertised(_ value: Any?) -> [TimelineOption] {
        (value as? [Any] ?? []).map { entry in
            if let tuple = entry as? [Any] {
                return TimelineOption(selector: tuple[0] as! String, unitsPerTick: (tuple[1] as! NSNumber).int64Value,
                                      unitsPerSecond: (tuple[2] as! NSNumber).int64Value)
            }
            return TimelineOption(selector: entry as! String, unitsPerTick: nil, unitsPerSecond: nil)
        }
    }

    func testTickRatesAndSelection() {
        for item in list("tickRate") {
            let rate = TimelineProtocol.tickRate(item["selector"] as! String, advertised: advertised(item["advertised"]))
            XCTAssertEqual(rate, (item["expect"] as? NSNumber)?.doubleValue, "\(item)")
        }
        for item in list("timelineSelection") {
            XCTAssertEqual(TimelineProtocol.select(configured: item["configured"] as! String, advertised: advertised(item["advertised"])),
                           str(item["expect"]), "\(item)")
        }
    }

    func testCiiSequences() {
        for item in list("cii") {
            let tracker = CiiTracker()
            var last: CiiTracker.Update?
            for message in item["messages"] as! [String] { if let update = tracker.apply(message) { last = update } }
            let expect = item["expect"] as! [String: Any]
            let name = item["name"] as! String
            XCTAssertEqual(tracker.state.contentId, str(expect["contentId"]), name)
            XCTAssertEqual(tracker.state.presentationStatus, expect["presentationStatus"] as! [String], name)
            XCTAssertEqual(tracker.state.wcUrl, str(expect["wcUrl"]), name)
            XCTAssertEqual(tracker.state.tsUrl, str(expect["tsUrl"]), name)
            XCTAssertEqual(tracker.state.timelines, advertised(expect["timelines"]), name)
            let changed = Set((expect["changed"] as! [String]).compactMap(CiiTracker.Field.init(rawValue:)))
            XCTAssertEqual(last?.changed ?? [], changed, name)
        }
    }

    func testEndpointsAndPreferenceKeys() {
        for item in list("endpoints") {
            XCTAssertEqual(Endpoints.repair(item["url"] as? String, realHost: str(item["host"])), str(item["expect"]), "\(item)")
        }
        for item in list("udp") {
            let expect = (item["expect"] as? [Any]).map { Endpoints.UdpEndpoint(host: $0[0] as! String, port: ($0[1] as! NSNumber).intValue) }
            XCTAssertEqual(Endpoints.parseUdp(item["url"] as? String), expect, "\(item)")
        }
        for item in list("preferenceKeys") {
            XCTAssertEqual(Endpoints.preferenceKey(manufacturer: str(item["manufacturer"]), modelName: str(item["modelName"]),
                                                   location: str(item["location"])), item["expect"] as? String)
        }
    }

    func testContentClassification() {
        for item in list("classify") {
            XCTAssertEqual(ContentClassifier.classify(item["contentId"] as? String).rawValue, item["expect"] as? String, "\(item)")
        }
        XCTAssertEqual(ContentClassifier.resolve(nil, brandFallback: "https://x/a.mpd"), "https://x/a.mpd")
        XCTAssertEqual(ContentClassifier.resolve("dvb://1", brandFallback: "https://x/a.mpd"), "dvb://1")
    }

    func testManifests() throws {
        for item in list("manifests") {
            let file = item["file"] as! String
            let url = item["url"] as! String
            let body = try text(file)
            let manifest = file.hasSuffix(".m3u8") ? try HlsParser.parse(body, url: url) : try MpdParser.parse(body, url: url)
            let expect = item["expect"] as! [String: Any]
            XCTAssertEqual(manifest.isLive, expect["isLive"] as? Bool, file)
            XCTAssertEqual(manifest.durationS, (expect["durationS"] as? NSNumber)?.doubleValue, file)
            XCTAssertEqual(manifest.availabilityStartTimeMs, (expect["availabilityStartTimeMs"] as? NSNumber)?.int64Value, file)
            if let depth = expect["timeShiftBufferDepthS"] as? NSNumber { XCTAssertEqual(manifest.timeShiftBufferDepthS, depth.doubleValue) }
            let tracks = expect["tracks"] as! [[String: Any]]
            XCTAssertEqual(tracks.count, manifest.tracks.count, file)
            for (expected, track) in zip(tracks, manifest.tracks) {
                let context = "\(file) \(expected["id"] ?? "")"
                XCTAssertEqual(track.id, expected["id"] as? String, context)
                XCTAssertEqual(track.kind.rawValue, expected["kind"] as? String, context)
                XCTAssertEqual(track.language, str(expected["language"]), context)
                XCTAssertEqual(track.role, str(expected["role"]), context)
                XCTAssertEqual(track.label, str(expected["label"]), context)
                XCTAssertEqual(track.bandwidth, (expected["bandwidth"] as! NSNumber).int64Value, context)
                XCTAssertEqual(track.width, (expected["width"] as? NSNumber)?.intValue, context)
                XCTAssertEqual(track.height, (expected["height"] as? NSNumber)?.intValue, context)
                XCTAssertEqual(track.audioDescription, expected["audioDescription"] as? Bool, context)
                XCTAssertEqual(track.signLanguage, expected["signLanguage"] as? Bool, context)
                XCTAssertEqual(track.isProtected, expected["protected"] as? Bool, context)
                XCTAssertEqual(track.textFormat, str(expected["textFormat"]), context)
                XCTAssertEqual(track.textUrl, str(expected["textUrl"]), context)
            }
            let applications = (expect["applications"] as? [[String: Any]] ?? []).map {
                WebApplication(url: $0["url"] as! String, name: str($0["name"]), language: str($0["language"]))
            }
            XCTAssertEqual(manifest.applications, applications, file)
            guard let segments = item["segments"] as? [String: Any] else { continue }
            let track = try XCTUnwrap(manifest.text.first)
            let schedule = TextSegmentSchedule(template: try XCTUnwrap(track.segmentTemplate), baseUrl: try XCTUnwrap(track.baseUrl),
                                               isLive: manifest.isLive, availabilityStartTimeMs: manifest.availabilityStartTimeMs,
                                               representationId: track.representationId)
            let now = try XCTUnwrap(manifest.availabilityStartTimeMs) + (segments["nowOffsetMs"] as! NSNumber).int64Value
            XCTAssertEqual(schedule.pending(nowEpochMs: now, positionS: nil), (segments["pending"] as! [NSNumber]).map { $0.int64Value })
            XCTAssertEqual(schedule.url(21), segments["url21"] as? String)
            schedule.complete(21, cues: [Cue(startS: 20, endS: 22, text: "a")])
            XCTAssertEqual(schedule.cues().first?.startS, 20 - (segments["ptoS"] as! NSNumber).doubleValue)
            XCTAssertEqual(schedule.pending(nowEpochMs: now + 6_000, positionS: nil), [22])
        }
    }

    func testSubtitles() throws {
        for item in list("subtitles") {
            let body = try text(item["file"] as! String)
            let cues = item["format"] as? String == "ttml" ? Subtitles.parseTtml(body) : Subtitles.parseVtt(body)
            let expected = item["expect"] as! [[Any]]
            XCTAssertEqual(expected.count, cues.count, item["file"] as! String)
            for (entry, cue) in zip(expected, cues) {
                XCTAssertEqual(cue.startS, (entry[0] as! NSNumber).doubleValue, accuracy: 1e-9)
                XCTAssertEqual(cue.endS, (entry[1] as! NSNumber).doubleValue, accuracy: 1e-9)
                XCTAssertEqual(cue.text, entry[2] as? String)
            }
            let track = CueTrack(cues)
            for entry in item["active"] as! [[Any]] {
                XCTAssertEqual(track.activeText((entry[0] as! NSNumber).doubleValue), str(entry[1]))
            }
        }
    }

    func testCompanionEnvelopes() throws {
        let companion = cases["companion"] as! [String: Any]
        for item in companion["valid"] as! [[String: Any]] {
            switch CompanionProtocol.parse(item["text"] as! String) {
            case .syncAck?: XCTAssertEqual(item["type"] as? String, "sync-ack")
            case .appMessage(let type, let id, let payload)?:
                XCTAssertEqual(type, item["messageType"] as? String)
                XCTAssertEqual(id, item["id"] as? String)
                let expected = try JSONSerialization.jsonObject(with: Data((item["payload"] as! String).utf8)) as! NSDictionary
                XCTAssertEqual(payload as? NSDictionary, expected)
            case nil: XCTFail("Rejected valid envelope \(item["text"] ?? "")")
            }
        }
        for invalid in companion["invalid"] as! [String] { XCTAssertNil(CompanionProtocol.parse(invalid), invalid) }
        for pair in companion["origins"] as! [[Any]] { XCTAssertEqual(CompanionProtocol.origin(pair[0] as? String), str(pair[1])) }
        let payload = (companion["injectionPayload"] as! String) + "\u{2028}"
        let script = CompanionProtocol.webViewInjection(payload)
        XCTAssertFalse(script.contains("\u{2028}"))
        let start = try XCTUnwrap(script.range(of: "var m="))
        let end = try XCTUnwrap(script.range(of: ";var o="))
        let literal = String(script[start.upperBound..<end.lowerBound])
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(literal.utf8), options: [.fragmentsAllowed]) as? String, payload)
    }

    func testWebPlayerUrlCarriesTheCheckedAudioOnlyInVideoMode() {
        let video = MediaTrack(id: "p/v", kind: .video, language: nil, role: "main", label: nil, codecs: nil, mimeType: nil,
                               bandwidth: 0, width: nil, height: nil)
        let audio = MediaTrack(id: "p/ca", kind: .audio, language: "ca", role: "main", label: nil, codecs: nil, mimeType: nil,
                               bandwidth: 0, width: nil, height: nil)
        func url(audioMode: Bool, track: MediaTrack, with checked: MediaTrack?) -> String {
            CompanionProtocol.webPlayerUrl(base: "https://player.test/", mpdUrl: "https://example.test/vod.mpd", audio: audioMode, track: track,
                                           trackIndex: 0, volume: 1, isLive: false, tuning: SyncTuning(), telemetry: false,
                                           audioTrack: checked, audioTrackIndex: 1)
        }
        XCTAssertTrue(url(audioMode: false, track: video, with: audio).hasSuffix("&aiso=ca&arole=main&atrack=1"))
        XCTAssertFalse(url(audioMode: true, track: audio, with: audio).contains("aiso="))
        XCTAssertFalse(url(audioMode: false, track: video, with: nil).contains("aiso="))
    }

    func testModeSelectionMatrix() {
        for item in list("modeSelection") {
            let availability: [SyncMode: Availability] = [
                .native: Availability(rawValue: (item["native"] as! String).lowercased())!,
                .compat: Availability(rawValue: (item["compat"] as! String).lowercased())!,
            ]
            let preferred = SyncMode(rawValue: (item["preferred"] as! String).lowercased())!
            XCTAssertEqual(ModeSelection.effective(preferred: preferred, availability: availability)?.rawValue,
                           str(item["expect"])?.lowercased(), "\(item)")
        }
    }
}
