import Foundation

/// Companion page protocol (formerly `src/utils/companionProtocol.js` in the React Native app), shared by WKWebView and the DASH web player.
public enum CompanionProtocol {
    public static let version = 1
    public static let maxInboundChars = 65_536

    public struct Position {
        public let positionSeconds: Double?
        public let isPlaying: Bool
        public let speed: Double
        public let isLive: Bool
        public let liveEpochSeconds: Double?
        public let generatedAtMs: Int64
        public init(positionSeconds: Double?, isPlaying: Bool, speed: Double, isLive: Bool, liveEpochSeconds: Double?, generatedAtMs: Int64) {
            self.positionSeconds = positionSeconds
            self.isPlaying = isPlaying
            self.speed = speed
            self.isLive = isLive
            self.liveEpochSeconds = liveEpochSeconds
            self.generatedAtMs = generatedAtMs
        }
    }

    public enum Inbound {
        case syncAck
        case appMessage(type: String, id: String?, payload: Any?)
        /// The page's complete tool set; replaces any earlier declaration (PRD-015-R07).
        case tools([CompanionTool])
        /// Answer to a `toolCall`: `result` is text (objects arrive serialized), `error` a failure message.
        case toolResult(id: String, result: String?, error: String?)
    }

    /// Tools a page may declare, and limits that keep a declaration small enough for an assistant.
    public static let maxTools = 16
    public static let maxToolDescriptionChars = 1_024
    public static let maxToolSchemaChars = 8_192
    public static let maxToolResultChars = 16_384

    public static func initMessage(contentId: String?) -> String {
        "{\"version\":\(version),\"type\":\"init\",\"contentId\":\(contentId.map(JsonInput.escape) ?? "null")}"
    }

    private static func number(_ value: Double?) -> String {
        guard let value = value, value.isFinite else { return "null" }
        return JsonInput.serialize(value)
    }

    public static func position(_ position: Position) -> String {
        "{\"version\":\(version),\"type\":\"position\",\"positionSeconds\":\(number(position.positionSeconds))," +
            "\"positionMillis\":\(number(position.positionSeconds.map { $0 * 1000 }))," +
            "\"exoPlayerPositionSeconds\":\(number(position.liveEpochSeconds)),\"isPlaying\":\(position.isPlaying)," +
            "\"speed\":\(JsonInput.serialize(position.speed)),\"isLive\":\(position.isLive),\"generatedAt\":\(position.generatedAtMs)," +
            "\"formattedTime\":\(JsonInput.escape(TimelineMath.formatClock(position.positionSeconds)))}"
    }

    /// Wraps a TV application envelope verbatim (the raw JSON object text is not re-serialised).
    public static func appMessage(rawMessage: String) -> String {
        "{\"version\":\(version),\"type\":\"app-message\",\"message\":\(rawMessage)}"
    }

    /// Asks the page to run one of its declared tools; `rawArguments` is a JSON object text, sent verbatim.
    public static func toolCall(id: String, name: String, rawArguments: String) -> String {
        "{\"version\":\(version),\"type\":\"tool-call\",\"id\":\(JsonInput.escape(id)),\"name\":\(JsonInput.escape(name)),\"arguments\":\(rawArguments)}"
    }

    public static func parse(_ raw: String) -> Inbound? {
        guard let envelope = JsonInput.parseObject(raw, maxChars: maxInboundChars),
              let versionNumber = envelope["version"] as? NSNumber, !(envelope["version"] is String),
              CFGetTypeID(versionNumber) != CFBooleanGetTypeID(), versionNumber.doubleValue == Double(version) else { return nil }
        switch JsonInput.string(envelope["type"]) {
        case "sync-ack": return .syncAck
        case "app-message":
            guard let message = envelope["message"] as? [String: Any], let type = JsonInput.string(message["type"]),
                  !type.isEmpty, type.count <= 128 else { return nil }
            let payload = message["payload"]
            return .appMessage(type: type, id: JsonInput.string(message["id"]), payload: payload is NSNull ? nil : payload)
        case "tools":
            guard let list = envelope["tools"] as? [Any], list.count <= maxTools else { return nil }
            var tools: [CompanionTool] = []
            for item in list {
                if let tool = tool(item), !tools.contains(where: { $0.name == tool.name }) { tools.append(tool) }
            }
            return .tools(tools)
        case "tool-result":
            guard let id = JsonInput.string(envelope["id"]), !id.isEmpty, id.utf16.count <= 128 else { return nil }
            var result: String?
            if let value = envelope["result"], !(value is NSNull) { result = JsonInput.string(value) ?? serialize(value) }
            return .toolResult(id: id, result: result.map { truncate($0, maxToolResultChars) },
                               error: JsonInput.string(envelope["error"]).map { truncate($0, maxToolResultChars) })
        default: return nil
        }
    }

    /// A declared tool, or nil when it breaks a rule; a missing schema means no arguments.
    private static func tool(_ item: Any) -> CompanionTool? {
        guard let tool = item as? [String: Any], let name = JsonInput.string(tool["name"]),
              name.range(of: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$", options: .regularExpression) != nil,
              let description = JsonInput.string(tool["description"])?.trimmingCharacters(in: .whitespacesAndNewlines),
              !description.isEmpty, description.utf16.count <= maxToolDescriptionChars else { return nil }
        let schema: String
        switch tool["inputSchema"] {
        case nil, is NSNull: schema = "{\"type\":\"object\"}"
        case let object as [String: Any]:
            guard let text = serialize(object), text.utf16.count <= maxToolSchemaChars else { return nil }
            schema = text
        default: return nil
        }
        return CompanionTool(name: name, description: description, inputSchema: schema)
    }

    private static func serialize(_ value: Any) -> String? {
        let options: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: options) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    private static func truncate(_ text: String, _ maxUnits: Int) -> String {
        text.utf16.count <= maxUnits ? text : String(decoding: Array(text.utf16.prefix(maxUnits)), as: UTF16.self)
    }

    /// Script that delivers an envelope as an escaped string literal, never as code.
    public static func webViewInjection(_ envelope: String) -> String {
        let literal = JsonInput.escape(envelope)
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return "(function(){var m=\(literal);" +
            "var o=window.location.origin;" +
            "try{window.postMessage(m,(o&&o!=='null')?o:'*');}catch(e){}" +
            "try{if(window.__hbbtvSync)window.__hbbtvSync(JSON.parse(m));}catch(e){}" +
            "})(); true;"
    }

    /// Shim so pages written for React Native keep working; `bridge` is resolved lazily.
    public static func reactNativeShim(bridge: String) -> String {
        "(function(){if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage)return;" +
            "window.ReactNativeWebView={postMessage:function(m){var b=\(bridge);if(b)b.postMessage(String(m));}};})();"
    }

    public static func httpsOrigin(_ url: String?) -> String? {
        guard let value = origin(url), value.hasPrefix("https://") else { return nil }
        return value
    }

    public static func origin(_ url: String?) -> String? {
        guard let url = url, let components = URLComponents(string: url), let scheme = components.scheme?.lowercased(),
              scheme == "https" || scheme == "http", let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = components.port.flatMap { $0 == defaultPort ? nil : $0 }
        return "\(scheme)://\(host)" + (port.map { ":\($0)" } ?? "")
    }

    /// iOS DASH fallback player URL, with the same parameters as the RN app. In video mode
    /// `audioTrack` picks the soundtrack that plays with the picture (`aiso`/`arole`/`atrack`);
    /// pages that predate these parameters keep the default audio.
    public static func webPlayerUrl(base: String, mpdUrl: String, audio: Bool, track: MediaTrack, trackIndex: Int,
                                    volume: Double, isLive: Bool, tuning: SyncTuning, telemetry: Bool,
                                    audioTrack: MediaTrack? = nil, audioTrackIndex: Int = -1) -> String {
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)..<Unicode.Scalar(128)))
        allowed.insert(charactersIn: "-_.*")
        func encode(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        let options = tuning.native
        var query: [(String, String)] = [
            ("mpd", mpdUrl), ("mode", audio ? "audio" : "video"), ("iso", track.language ?? ""), ("track", String(trackIndex)),
            ("role", track.role ?? ""), ("volume", String(volume)), ("live", isLive ? "1" : "0"),
            ("emaAlpha", String(options.emaAlpha)), ("enterBandS", String(options.enterBandS)), ("exitBandS", String(options.exitBandS)),
            ("horizonS", String(options.horizonS)), ("deadTimeS", String(options.deadTimeS)), ("maxRateDelta", String(options.maxRateDelta)),
            ("rateEps", String(options.rateEps)), ("seekCooldownMs", String(tuning.seekCooldownMs)), ("seekLeadS", String(tuning.seekLeadS)),
            ("correctionIntervalMs", String(tuning.progressIntervalMs)), ("tel", telemetry ? "1" : "0"),
        ]
        if let audioTrack = audioTrack, !audio {
            query += [("aiso", audioTrack.language ?? ""), ("arole", audioTrack.role ?? ""), ("atrack", String(audioTrackIndex))]
        }
        return base + (base.contains("?") ? "&" : "?") + query.map { "\($0.0)=\(encode($0.1))" }.joined(separator: "&")
    }
}

/// Position corrections at a bounded cadence, immediately on play/speed changes.
public final class CompanionFeedThrottle {
    private let intervalMs: Int64
    private var lastSentMs: Int64?
    private var lastPlaying: Bool?
    private var lastSpeed: Double?

    public init(intervalMs: Int64 = 1_000) { self.intervalMs = intervalMs }

    public func shouldSend(nowMs: Int64, isPlaying: Bool, speed: Double) -> Bool {
        let changed = isPlaying != lastPlaying || speed != lastSpeed
        if !changed, let last = lastSentMs, nowMs - last < intervalMs { return false }
        lastSentMs = nowMs
        lastPlaying = isPlaying
        lastSpeed = speed
        return true
    }

    public func reset() {
        lastSentMs = nil
        lastPlaying = nil
        lastSpeed = nil
    }
}

/// Accepts bridge messages only from the page origin and current navigation.
public final class CompanionBridgeGate {
    public let allowedOrigin: String?
    public private(set) var pageGeneration: Int64 = 0

    public init(pageUrl: String) { allowedOrigin = CompanionProtocol.origin(pageUrl) }

    @discardableResult
    public func onNavigation() -> Int64 {
        pageGeneration += 1
        return pageGeneration
    }

    public func accept(sourceOrigin: String?, generation: Int64, text: String) -> CompanionProtocol.Inbound? {
        guard let allowed = allowedOrigin, generation == pageGeneration, CompanionProtocol.origin(sourceOrigin) == allowed else { return nil }
        return CompanionProtocol.parse(text)
    }
}

/// Title and icon of a companion page, parsed from the first bytes of its HTML.
public struct WebMetadata: Equatable {
    public static let maxHtmlChars = 200 * 1024
    public let title: String?
    public let iconUrl: String?

    private static let meta = Pattern("<meta[^>]*>", caseInsensitive: true)
    private static let link = Pattern("<link[^>]*>", caseInsensitive: true)
    private static let title = Pattern("<title[^>]*>([\\s\\S]*?)</title>", caseInsensitive: true)

    public static func parse(_ html: String, pageUrl: String) -> WebMetadata {
        let head = String(html.prefix(maxHtmlChars))
        let metas = meta.allMatches(head).map { $0[0] }
        func metaContent(_ name: String) -> String? {
            metas.first { ((attribute($0, "property") ?? attribute($0, "name"))?.lowercased()) == name }.flatMap { attribute($0, "content") }
        }
        let collapse = Pattern("\\s+")
        let pageTitle = metaContent("og:title").map(decode).flatMap { $0.isEmpty ? nil : $0 }
            ?? title.firstMatch(head).map { decode(collapse.replace($0[1]) { _ in " " }) }.flatMap { $0.isEmpty ? nil : $0 }
        let icons: [(String, String)] = link.allMatches(head).compactMap { match in
            guard let rel = attribute(match[0], "rel")?.lowercased(), rel.contains("icon"), let href = attribute(match[0], "href") else { return nil }
            return (rel, href)
        }
        let icon = icons.first { $0.0.contains("apple-touch-icon") }?.1 ?? metaContent("og:image") ?? icons.first?.1 ?? "/favicon.ico"
        return WebMetadata(title: pageTitle.map { String($0.prefix(200)) }, iconUrl: MpdParser.resolve(pageUrl, icon))
    }

    private static func attribute(_ tag: String, _ name: String) -> String? {
        guard let match = Pattern("\(name)\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", caseInsensitive: true).firstMatch(tag) else { return nil }
        return match.dropFirst(2).first { !$0.isEmpty }
    }

    private static func decode(_ text: String) -> String {
        Pattern("&#(\\d{1,6});").replace(text) { groups in
            UInt32(groups[1]).flatMap { Unicode.Scalar($0) }.map { String(Character($0)) } ?? ""
        }
        .replacingOccurrences(of: "&lt;", with: "<", options: .caseInsensitive)
        .replacingOccurrences(of: "&gt;", with: ">", options: .caseInsensitive)
        .replacingOccurrences(of: "&quot;", with: "\"", options: .caseInsensitive)
        .replacingOccurrences(of: "&#39;", with: "'")
        .replacingOccurrences(of: "&apos;", with: "'", options: .caseInsensitive)
        .replacingOccurrences(of: "&nbsp;", with: " ", options: .caseInsensitive)
        .replacingOccurrences(of: "&amp;", with: "&", options: .caseInsensitive)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// A tool a companion page offers to assistants (PRD-015-R07), in the shape of WebMCP tools:
/// `inputSchema` is the JSON Schema of the arguments object, as compact JSON text.
public struct CompanionTool: Equatable {
    public let name: String
    public let description: String
    public let inputSchema: String
}
