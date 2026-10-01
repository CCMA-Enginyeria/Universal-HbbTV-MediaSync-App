import Foundation

/// CSS-TS control timestamp: contentTime in ticks, wallClockTime in nanoseconds.
public struct ControlTimestamp: Equatable {
    public let contentTime: Int64
    public let wallClockTime: Int64
    public let speed: Double
}

public enum TimelineMessage: Equatable {
    case available(ControlTimestamp)
    case unavailable
}

public enum TimelineProtocol {
    public static let pts = "urn:dvb:css:timeline:pts"
    private static let mpdPeriodRel = Pattern("^urn:dvb:css:timeline:mpd:period:rel:(\\d+)(?::.*)?$")

    public static func setupMessage(timelineSelector: String, contentIdStem: String = "") -> String {
        "{\"contentIdStem\":\(JsonInput.escape(contentIdStem)),\"timelineSelector\":\(JsonInput.escape(timelineSelector))}"
    }

    /// Returns nil for frames that are not CSS-TS messages (including App2App control frames).
    public static func parse(_ text: String) -> TimelineMessage? {
        guard let message = JsonInput.parseObject(text, maxChars: 16_384) else { return nil }
        let speedValue = message["timelineSpeedMultiplier"]
        let content = message["contentTime"]
        let wall = message["wallClockTime"]
        if JsonInput.isNull(speedValue) || content == nil || JsonInput.isNull(content) || wall == nil || JsonInput.isNull(wall) {
            return .unavailable
        }
        guard let contentTime = JsonInput.long(content), let wallClockTime = JsonInput.long(wall) else { return nil }
        let speed: Double
        if speedValue == nil { speed = 1 } else {
            guard let parsed = JsonInput.double(speedValue) else { return nil }
            speed = parsed
        }
        // Any finite speed is valid (TS 103 286-2); negative means rewinding, which the corrector treats as not playing.
        guard speed.isFinite else { return nil }
        return .available(ControlTimestamp(contentTime: contentTime, wallClockTime: wallClockTime, speed: speed))
    }

    /// Ticks per second, preferring CII properties. TEMI selectors (`temi:<component_tag>:<timeline_id>`)
    /// carry no rate, so they need CII properties.
    public static func tickRate(_ selector: String, advertised: [TimelineOption] = []) -> Double? {
        if let rate = advertised.first(where: { $0.selector == selector })?.tickRate { return rate }
        if selector == pts { return 90_000 }
        if let match = mpdPeriodRel.matchEntire(selector) { return Double(match[1]).flatMap { $0 > 0 ? $0 : nil } }
        return nil
    }

    public static func select(configured: String, advertised: [TimelineOption]) -> String? {
        if advertised.isEmpty || advertised.contains(where: { $0.selector == configured }) {
            return tickRate(configured, advertised: advertised) != nil ? configured : nil
        }
        return advertised.first { tickRate($0.selector, advertised: advertised) != nil }?.selector
    }
}

public struct TimelinePosition: Equatable {
    public let seconds: Double
    public let speed: Double
    public let uncertaintyMs: Double
    public let timestampAgeMs: Double
    public let reliable: Bool
    public var isPlaying: Bool { speed > 0 }
}

public enum TimelineMath {
    public static func positionSeconds(_ timestamp: ControlTimestamp, wallNowNanos: Int64, tickRate: Double) -> Double {
        let elapsed = Double(wallNowNanos - timestamp.wallClockTime) / 1e9
        return Double(timestamp.contentTime) / tickRate + (timestamp.speed == 0 ? 0 : elapsed * timestamp.speed)
    }

    public static func formatClock(_ seconds: Double?) -> String {
        guard let seconds = seconds, seconds.isFinite else { return "--:--:--" }
        let total = Int(max(seconds, 0))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}
