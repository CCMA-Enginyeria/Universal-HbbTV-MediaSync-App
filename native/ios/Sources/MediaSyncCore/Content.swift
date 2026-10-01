import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

/// Ordered XML tree (elements and text) parsed without DTDs or external entities.
final class XmlElement {
    enum Child {
        case element(XmlElement)
        case text(String)
    }

    let name: String
    let attributes: [String: String]
    var children: [Child] = []

    init(name: String, attributes: [String: String]) {
        self.name = name
        self.attributes = attributes
    }

    var elements: [XmlElement] { children.compactMap { if case .element(let element) = $0 { return element } else { return nil } } }

    func children(_ name: String) -> [XmlElement] { elements.filter { $0.name == name } }
    func child(_ name: String) -> XmlElement? { elements.first { $0.name == name } }

    var textContent: String {
        children.map { child -> String in
            switch child {
            case .text(let text): return text
            case .element(let element): return element.textContent
            }
        }.joined()
    }

    func childText(_ name: String) -> String? {
        let text = child(name)?.textContent.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }

    /// Attribute by local name; namespaced attributes (e.g. `ttp:frameRate`) match their local part.
    func attribute(_ name: String) -> String {
        if let value = attributes[name] { return value }
        return attributes.first { $0.key.hasSuffix(":" + name) }?.value ?? ""
    }

    static func parse(_ xml: String, maxChars: Int) -> XmlElement? {
        guard xml.count <= maxChars, xml.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil, !xml.contains("\0") else { return nil }
        let builder = Builder()
        let parser = XMLParser(data: Data(xml.utf8))
        parser.shouldProcessNamespaces = true
        parser.shouldResolveExternalEntities = false
        parser.delegate = builder
        guard parser.parse(), parser.parserError == nil else { return nil }
        return builder.root
    }

    private final class Builder: NSObject, XMLParserDelegate {
        var root: XmlElement?
        private var stack: [XmlElement] = []

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String]) {
            let element = XmlElement(name: elementName, attributes: attributes)
            if let parent = stack.last { parent.children.append(.element(element)) } else { root = element }
            stack.append(element)
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            stack.last?.children.append(.text(string))
        }

        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
            stack.last?.children.append(.text(String(decoding: CDATABlock, as: UTF8.self)))
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
            _ = stack.popLast()
        }
    }
}

public enum ContentKind: String { case none = "NONE", dash = "DASH", hls = "HLS", web = "WEB", unsupported = "UNSUPPORTED" }

public enum ContentClassifier {
    private static let web = Pattern("\\.html?(\\?|#|$)", caseInsensitive: true)
    private static let dash = Pattern("\\.mpd(\\?|#|$)", caseInsensitive: true)
    private static let hls = Pattern("\\.m3u8(\\?|#|$)", caseInsensitive: true)

    public static func classify(_ contentId: String?) -> ContentKind {
        guard let contentId = contentId, !contentId.trimmingCharacters(in: .whitespaces).isEmpty else { return .none }
        guard let components = URLComponents(string: contentId), let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return .unsupported }
        // The path decides first, so a query such as `?back=/index.html` cannot change the kind.
        return kind(of: components.percentEncodedPath) ?? kind(of: contentId) ?? .unsupported
    }

    private static func kind(of text: String) -> ContentKind? {
        if web.contains(text) { return .web }
        if dash.contains(text) { return .dash }
        if hls.contains(text) { return .hls }
        return nil
    }

    /// Brand fallback only replaces missing content, never unsupported content.
    public static func resolve(_ contentId: String?, brandFallback: String?) -> String? {
        if let contentId = contentId, !contentId.trimmingCharacters(in: .whitespaces).isEmpty { return contentId }
        guard let fallback = brandFallback, classify(fallback) != .unsupported else { return nil }
        return fallback
    }
}

public enum TrackKind: String { case audio = "AUDIO", video = "VIDEO", text = "TEXT" }

public struct TextSegment: Equatable {
    public let time: Int64
    public let duration: Int64
    public var url: String? = nil
}

public struct SegmentTemplate: Equatable {
    public let initialization: String?
    public let media: String
    public let timescale: Int64
    public let duration: Int64
    public let startNumber: Int64
    public let presentationTimeOffset: Int64
    public var segments: [TextSegment] = []
    public var periodStartS: Double = 0
    public var segmentSeconds: Double { Double(duration) / Double(timescale) }
    public var presentationTimeOffsetSeconds: Double { Double(presentationTimeOffset) / Double(timescale) }
}

public struct MediaTrack: Equatable {
    public let id: String
    public let kind: TrackKind
    public let language: String?
    public let role: String?
    public let label: String?
    public let codecs: String?
    public let mimeType: String?
    public let bandwidth: Int64
    public let width: Int?
    public let height: Int?
    public var audioDescription = false
    public var signLanguage = false
    public var isProtected = false
    public var textFormat: String? = nil
    public var textUrl: String? = nil
    public var segmentTemplate: SegmentTemplate? = nil
    public var baseUrl: String? = nil
    public var representationId: String? = nil
}

public struct MediaManifest: Equatable {
    public let url: String
    public let isLive: Bool
    public let availabilityStartTimeMs: Int64?
    public let timeShiftBufferDepthS: Double?
    public let minimumUpdatePeriodS: Double?
    public let suggestedPresentationDelayS: Double?
    public let durationS: Double?
    public let tracks: [MediaTrack]

    public var audio: [MediaTrack] { tracks.filter { $0.kind == .audio } }
    public var video: [MediaTrack] { tracks.filter { $0.kind == .video } }
    public var text: [MediaTrack] { tracks.filter { $0.kind == .text } }
    public var refreshDelayMs: Int64? {
        guard isLive || ContentClassifier.classify(url) == .hls else { return nil }
        let interval = minimumUpdatePeriodS.flatMap { $0.isFinite ? $0 : nil } ?? 5
        return Int64(min(max(interval, 1), 60) * 1000)
    }

    public func refreshedTrack(_ previous: MediaTrack?) -> MediaTrack? {
        guard let previous = previous else { return nil }
        let playable = tracks.filter { !$0.isProtected }
        return playable.first { $0.id == previous.id && $0.kind == previous.kind &&
            $0.language == previous.language && ($0.role ?? "") == (previous.role ?? "") }
            ?? PlaybackIntent(previous).match(playable)
    }

    public var isProtected: Bool {
        let media = tracks.filter { $0.kind != .text }
        return !tracks.isEmpty && media.allSatisfy { $0.isProtected }
    }
}

public struct ManifestError: Error {}

/// Remembers what the user was playing so a reconnect or new content resumes the same role/language.
public struct PlaybackIntent: Equatable {
    public let kind: TrackKind
    public let language: String?
    public let role: String?

    public init(_ track: MediaTrack) {
        kind = track.kind
        language = track.language
        role = track.role
    }

    public func match(_ tracks: [MediaTrack]) -> MediaTrack? {
        tracks.first { $0.kind == kind && $0.language == language && ($0.role ?? "") == (role ?? "") }
    }
}

public enum MpdParser {
    public static let maxBytes = 4 * 1_048_576

    public static func parse(_ xml: String, url manifestUrl: String) throws -> MediaManifest {
        guard let root = XmlElement.parse(xml, maxChars: maxBytes), root.name == "MPD" else { throw ManifestError() }
        let isLive = root.attribute("type") == "dynamic"
        let mpdBase = resolve(manifestUrl, root.childText("BaseURL")) ?? manifestUrl
        var tracks: [MediaTrack] = []
        var inferredStart = 0.0
        for (periodIndex, period) in root.children("Period").enumerated() {
            let periodId = period.attribute("id").isEmpty ? "p\(periodIndex)" : period.attribute("id")
            let periodBase = resolve(mpdBase, period.childText("BaseURL")) ?? mpdBase
            let start = period.attribute("start") == "PT0S" ? 0 : parseDuration(period.attribute("start")) ?? inferredStart
            let duration = parseDuration(period.attribute("duration"))
            inferredStart = start + (duration ?? 0)
            for (index, set) in period.children("AdaptationSet").enumerated() {
                if let track = try track(set, period: period, periodId: periodId, index: index, periodBase: periodBase,
                                         periodStart: start, periodDuration: duration) { tracks.append(track) }
            }
        }
        return MediaManifest(url: manifestUrl, isLive: isLive,
                             availabilityStartTimeMs: parseDateTime(root.attribute("availabilityStartTime")),
                             timeShiftBufferDepthS: parseDuration(root.attribute("timeShiftBufferDepth")),
                             minimumUpdatePeriodS: parseDuration(root.attribute("minimumUpdatePeriod")),
                             suggestedPresentationDelayS: parseDuration(root.attribute("suggestedPresentationDelay")),
                             durationS: isLive ? nil : parseDuration(root.attribute("mediaPresentationDuration")),
                             tracks: tracks)
    }

    private static func track(_ set: XmlElement, period: XmlElement, periodId: String, index: Int, periodBase: String,
                              periodStart: Double, periodDuration: Double?) throws -> MediaTrack? {
        let representations = set.children("Representation")
        var best: XmlElement?
        for representation in representations where best == nil ||
            (Int64(representation.attribute("bandwidth")) ?? 0) > (Int64(best!.attribute("bandwidth")) ?? 0) {
            best = representation
        }
        func attribute(_ name: String) -> String? {
            let own = set.attribute(name)
            let value = own.isEmpty ? (best?.attribute(name) ?? "") : own
            return value.isEmpty ? nil : value
        }
        let mime = attribute("mimeType")?.lowercased() ?? ""
        let contentType = set.attribute("contentType").lowercased()
        let codecs = attribute("codecs")
        let lowerCodecs = codecs?.lowercased() ?? ""
        let kind: TrackKind
        if contentType == "audio" || mime.hasPrefix("audio/") { kind = .audio }
        else if contentType == "video" || mime.hasPrefix("video/") { kind = .video }
        else if contentType == "text" || mime.contains("ttml") || mime.contains("vtt") || mime.contains("subtitle") ||
            (mime == "application/mp4" && (lowerCodecs.contains("stpp") || lowerCodecs.contains("wvtt"))) { kind = .text }
        else { return nil }
        let roles = set.children("Role").map { $0.attribute("value") }
        let accessibility = set.children("Accessibility")
        let rawRole = roles.first.flatMap { $0.isEmpty ? nil : $0 }
        let description = kind == .audio && (rawRole == "description" || !accessibility.isEmpty)
        let sign = kind == .video && (rawRole == "sign" || !accessibility.isEmpty)
        let role: String? = description ? "description" : (kind == .video ? (rawRole ?? "main") : rawRole)
        let label = set.childText("Label") ?? (set.attribute("label").isEmpty ? nil : set.attribute("label"))
        let language = set.attribute("lang").isEmpty ? nil : set.attribute("lang")
        let setBase = resolve(periodBase, set.childText("BaseURL")) ?? periodBase
        let setId = set.attribute("id").isEmpty ? "as\(index)" : set.attribute("id")
        let isProtected = !set.children("ContentProtection").isEmpty ||
            representations.contains { !$0.children("ContentProtection").isEmpty }
        var textFormat: String?
        var textUrl: String?
        var template: SegmentTemplate?
        if kind == .text {
            if mime.contains("vtt") || lowerCodecs.contains("wvtt") { textFormat = "vtt" }
            else if mime.contains("ttml") || lowerCodecs.contains("stpp") { textFormat = "ttml" }
            let ancestors = [best, set, period].compactMap { $0 }
            let templates = ancestors.compactMap { $0.child("SegmentTemplate") }
            let templateElement = templates.first
            do {
            if let list = ancestors.compactMap({ $0.child("SegmentList") }).first {
                template = try segmentTemplate([list], periodStart: periodStart, periodDuration: periodDuration, isList: true)
            } else if !templates.isEmpty {
                template = try segmentTemplate(templates, periodStart: periodStart, periodDuration: periodDuration, isList: false)
            }
            } catch { return nil }
            if let base = best?.childText("BaseURL") {
                textUrl = resolve(setBase, base)
            } else if template == nil, let element = templateElement {
                let initialization = element.attribute("initialization")
                textUrl = resolve(setBase, initialization.isEmpty ? element.attribute("media") : initialization)
            }
            if textUrl == nil && template == nil { return nil }
        }
        let representationId = best.flatMap { $0.attribute("id").isEmpty ? nil : $0.attribute("id") }
        var track = MediaTrack(id: "\(periodId)/\(setId)", kind: kind, language: language, role: role, label: label, codecs: codecs,
                               mimeType: mime.isEmpty ? nil : mime, bandwidth: Int64(best?.attribute("bandwidth") ?? "") ?? 0,
                               width: attribute("width").flatMap { Int($0) }, height: attribute("height").flatMap { Int($0) })
        track.audioDescription = description
        track.signLanguage = sign
        track.isProtected = isProtected
        track.textFormat = textFormat
        track.textUrl = textUrl
        track.segmentTemplate = template
        track.baseUrl = resolve(setBase, best?.childText("BaseURL")) ?? setBase
        track.representationId = representationId
        return track
    }

    private static func segmentTemplate(_ elements: [XmlElement], periodStart: Double, periodDuration: Double?, isList: Bool) throws -> SegmentTemplate? {
        func attribute(_ name: String) -> String {
            elements.first { !$0.attribute(name).isEmpty }?.attribute(name) ?? ""
        }
        let media = attribute("media")
        guard !media.isEmpty || isList else { return nil }
        let timescale = Int64(attribute("timescale")).flatMap { $0 > 0 ? $0 : nil } ?? 1
        let offset = Int64(attribute("presentationTimeOffset")) ?? 0
        let timeline = elements.compactMap { $0.child("SegmentTimeline") }.first
        let entries = timeline?.children("S") ?? []
        var segments: [TextSegment] = []
        var time: Int64 = 0
        for (index, entry) in entries.enumerated() {
            time = Int64(entry.attribute("t")) ?? time
            guard let duration = Int64(entry.attribute("d")), duration > 0 else { throw ManifestError() }
            let repetition = Int64(entry.attribute("r")) ?? 0
            let count: Double
            if repetition >= 0 { count = Double(repetition) + 1 }
            else {
                let next = index + 1 < entries.count ? Int64(entries[index + 1].attribute("t")).map(Double.init) : nil
                guard let end = next ?? periodDuration.map({ $0 * Double(timescale) + Double(offset) }) else { throw ManifestError() }
                count = ceil((end - Double(time)) / Double(duration))
            }
            guard count.isFinite, count >= 1, count <= Double(10_000 - segments.count) else { throw ManifestError() }
            for _ in 0..<Int(count) {
                segments.append(TextSegment(time: time, duration: duration))
                let next = time.addingReportingOverflow(duration)
                guard !next.overflow else { throw ManifestError() }
                time = next.partialValue
            }
        }
        guard let duration = Int64(attribute("duration")).flatMap({ $0 > 0 ? $0 : nil }) ?? segments.first?.duration else { return nil }
        if isList {
            let urls = elements[0].children("SegmentURL")
            guard urls.count <= 10_000, segments.isEmpty || urls.count == segments.count else { throw ManifestError() }
            for (index, entry) in urls.enumerated() {
                let path = entry.attribute("media")
                guard !path.isEmpty, entry.attribute("mediaRange").isEmpty else { throw ManifestError() }
                if timeline == nil {
                    let start = Int64(index).multipliedReportingOverflow(by: duration)
                    guard !start.overflow else { throw ManifestError() }
                    segments.append(TextSegment(time: start.partialValue, duration: duration, url: path))
                } else { segments[index].url = path }
            }
        }
        let initialization = attribute("initialization")
        return SegmentTemplate(initialization: initialization.isEmpty ? nil : initialization, media: media, timescale: timescale,
                               duration: duration, startNumber: Int64(attribute("startNumber")) ?? 1,
                               presentationTimeOffset: offset, segments: segments, periodStartS: periodStart)
    }

    /// RFC 3986 resolution; only HTTP(S) results without credentials are accepted.
    public static func resolve(_ base: String, _ relative: String?) -> String? {
        guard let relative = relative?.trimmingCharacters(in: .whitespacesAndNewlines), !relative.isEmpty,
              let baseUrl = URL(string: base), let resolved = URL(string: relative, relativeTo: baseUrl)?.absoluteURL,
              let scheme = resolved.scheme?.lowercased(), scheme == "http" || scheme == "https", resolved.user == nil else { return nil }
        return resolved.absoluteString
    }

    private static let durationPattern = Pattern(
        "^P(?:(\\d+(?:\\.\\d+)?)Y)?(?:(\\d+(?:\\.\\d+)?)M)?(?:(\\d+(?:\\.\\d+)?)D)?(?:T(?:(\\d+(?:\\.\\d+)?)H)?(?:(\\d+(?:\\.\\d+)?)M)?(?:(\\d+(?:\\.\\d+)?)S)?)?$")

    public static func parseDuration(_ value: String?) -> Double? {
        guard let value = value, let match = durationPattern.matchEntire(value.trimmingCharacters(in: .whitespaces)) else { return nil }
        let factors = [31_536_000.0, 2_592_000, 86_400, 3_600, 60, 1]
        let total = zip(match.dropFirst(), factors).reduce(0.0) { $0 + (Double($1.0) ?? 0) * $1.1 }
        return total > 0 ? total : nil
    }

    public static func parseDateTime(_ value: String?) -> Int64? {
        guard let value = value, !value.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        for candidate in [value, value + "Z"] {
            for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
                formatter.formatOptions = options
                if let date = formatter.date(from: candidate) { return Int64((date.timeIntervalSince1970 * 1000).rounded()) }
            }
        }
        return nil
    }
}

/// Minimal HLS multivariant parser: renditions and variants.
public enum HlsParser {
    private static let attributePattern = Pattern("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)")

    public static func parse(_ text: String, url playlistUrl: String) throws -> MediaManifest {
        guard text.count <= MpdParser.maxBytes, text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#EXTM3U") else { throw ManifestError() }
        var tracks: [MediaTrack] = []
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
        var ended = false
        var variantIndex = 0
        for (index, line) in lines.enumerated() {
            if line.hasPrefix("#EXT-X-ENDLIST") || line == "#EXT-X-PLAYLIST-TYPE:VOD" { ended = true }
            else if line.hasPrefix("#EXT-X-MEDIA:") {
                let values = attributes(String(line.dropFirst("#EXT-X-MEDIA:".count)))
                let kind: TrackKind
                switch values["TYPE"] {
                case "AUDIO": kind = .audio
                case "SUBTITLES": kind = .text
                case "VIDEO": kind = .video
                default: continue
                }
                let description = (values["CHARACTERISTICS"] ?? "").contains("public.accessibility.describes-video")
                let name = values["NAME"]
                var track = MediaTrack(id: "\(values["GROUP-ID"] ?? "")/\(name ?? "")", kind: kind, language: values["LANGUAGE"],
                                       role: description ? "description" : (values["DEFAULT"] == "YES" ? "main" : "alternate"),
                                       label: name, codecs: nil, mimeType: nil, bandwidth: 0, width: nil, height: nil)
                track.audioDescription = description
                track.textFormat = kind == .text ? "vtt" : nil
                track.textUrl = values["URI"].flatMap { MpdParser.resolve(playlistUrl, $0) }
                tracks.append(track)
            } else if line.hasPrefix("#EXT-X-STREAM-INF:"), !tracks.contains(where: { $0.kind == .video && $0.id.hasPrefix("variant") }) {
                let values = attributes(String(line.dropFirst("#EXT-X-STREAM-INF:".count)))
                let resolution = values["RESOLUTION"]?.split(separator: "x").map(String.init)
                if index + 1 < lines.count, !lines[index + 1].hasPrefix("#") {
                    tracks.append(MediaTrack(id: "variant\(variantIndex)", kind: .video, language: nil, role: "main", label: nil,
                                             codecs: values["CODECS"], mimeType: nil, bandwidth: Int64(values["BANDWIDTH"] ?? "") ?? 0,
                                             width: resolution?.first.flatMap { Int($0) }, height: resolution?.dropFirst().first.flatMap { Int($0) }))
                    variantIndex += 1
                }
            }
        }
        let mediaPlaylist = !lines.contains { $0.hasPrefix("#EXT-X-STREAM-INF") } && lines.contains { $0.hasPrefix("#EXTINF") }
        if mediaPlaylist {
            tracks.append(MediaTrack(id: "media", kind: .audio, language: nil, role: "main", label: nil, codecs: nil,
                                     mimeType: nil, bandwidth: 0, width: nil, height: nil))
        }
        return MediaManifest(url: playlistUrl, isLive: mediaPlaylist && !ended, availabilityStartTimeMs: nil, timeShiftBufferDepthS: nil,
                             minimumUpdatePeriodS: nil, suggestedPresentationDelayS: nil, durationS: nil, tracks: tracks)
    }

    private static func attributes(_ list: String) -> [String: String] {
        var result: [String: String] = [:]
        for match in attributePattern.allMatches(list) {
            var value = match[2]
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 { value = String(value.dropFirst().dropLast()) }
            result[match[1]] = value
        }
        return result
    }
}
