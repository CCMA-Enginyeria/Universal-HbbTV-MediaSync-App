import Foundation

public struct TimelineOption: Equatable {
    public let selector: String
    public let unitsPerTick: Int64?
    public let unitsPerSecond: Int64?

    public init(selector: String, unitsPerTick: Int64?, unitsPerSecond: Int64?) {
        self.selector = selector
        self.unitsPerTick = unitsPerTick
        self.unitsPerSecond = unitsPerSecond
    }

    public var tickRate: Double? {
        guard let tick = unitsPerTick, let second = unitsPerSecond, tick > 0, second > 0 else { return nil }
        return Double(second) / Double(tick)
    }
}

/// Accumulated CSS-CII state; omitted properties keep their previous value.
public struct CiiState: Equatable {
    public var protocolVersion: String?
    public var contentId: String?
    public var contentIdStatus: String?
    public var presentationStatus: [String] = []
    public var mrsUrl: String?
    public var wcUrl: String?
    public var tsUrl: String?
    public var teUrl: String?
    public var timelines: [TimelineOption] = []

    public init() {}

    public var isPresentationFault: Bool { presentationStatus.first == "fault" }
}

public final class CiiTracker {
    public enum Field: String { case contentId = "CONTENT_ID", contentIdStatus = "CONTENT_ID_STATUS"
        case presentationStatus = "PRESENTATION_STATUS", wcUrl = "WC_URL", tsUrl = "TS_URL", timelines = "TIMELINES", other = "OTHER" }

    public struct Update {
        public let state: CiiState
        public let changed: Set<Field>
    }

    public private(set) var state = CiiState()

    public init() {}

    public func reset() { state = CiiState() }

    /// Applies a CII message; nil means the frame was not a valid CII object.
    public func apply(_ text: String) -> Update? {
        guard let message = JsonInput.parseObject(text, maxChars: 65_536) else { return nil }
        var next = state
        var changed = Set<Field>()
        func field<T>(_ name: String, _ kind: Field, _ read: (Any?) -> T?, _ write: (inout CiiState, T?) -> Void) {
            guard let raw = message[name] else { return }
            let value: T?
            if JsonInput.isNull(raw) { value = nil } else {
                guard let parsed = read(raw) else { return }
                value = parsed
            }
            var candidate = next
            write(&candidate, value)
            if candidate != next { next = candidate; changed.insert(kind) }
        }
        field("protocolVersion", .other, JsonInput.string) { $0.protocolVersion = $1 }
        field("contentId", .contentId, JsonInput.string) { state, value in
            state.contentId = value.flatMap { id in id.count <= 4096 ? id : nil }
        }
        field("contentIdStatus", .contentIdStatus, JsonInput.string) { $0.contentIdStatus = $1 }
        field("presentationStatus", .presentationStatus, Self.presentation) { $0.presentationStatus = $1 ?? [] }
        field("mrsUrl", .other, JsonInput.string) { $0.mrsUrl = $1 }
        field("wcUrl", .wcUrl, JsonInput.string) { $0.wcUrl = $1 }
        field("tsUrl", .tsUrl, JsonInput.string) { $0.tsUrl = $1 }
        field("teUrl", .other, JsonInput.string) { $0.teUrl = $1 }
        field("timelines", .timelines, Self.timelines) { $0.timelines = $1 ?? [] }
        state = next
        return Update(state: next, changed: changed)
    }

    private static func presentation(_ value: Any?) -> [String]? {
        if let array = value as? [Any] { return Array(array.compactMap(JsonInput.string).prefix(8)) }
        if let text = value as? String { return Array(text.split(separator: " ").map(String.init).prefix(8)) }
        return nil
    }

    private static func timelines(_ value: Any?) -> [TimelineOption]? {
        guard let array = value as? [Any] else { return nil }
        return array.prefix(32).compactMap { item in
            guard let entry = item as? [String: Any], let selector = JsonInput.string(entry["timelineSelector"]),
                  selector.count <= 512 else { return nil }
            let properties = entry["timelineProperties"] as? [String: Any]
            return TimelineOption(selector: selector, unitsPerTick: JsonInput.long(properties?["unitsPerTick"]),
                                  unitsPerSecond: JsonInput.long(properties?["unitsPerSecond"]))
        }
    }
}
