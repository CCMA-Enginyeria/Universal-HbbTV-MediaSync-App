import Foundation

public struct Cue: Equatable {
    public let startS: Double
    public let endS: Double
    public let text: String
    public init(startS: Double, endS: Double, text: String) {
        self.startS = startS
        self.endS = endS
        self.text = text
    }
}

/// TTML (EBU-TT-D) and WebVTT subsets used by current broadcasters (mirrors Kotlin `Subtitles`).
public enum Subtitles {
    public static let maxDocumentChars = 2 * 1_048_576
    public static let maxCues = 5_000

    private struct Timing {
        let frameRate: Double
        let tickRate: Double
        let subFrameRate: Double
    }

    public static func parseTtml(_ xml: String) -> [Cue] {
        guard let root = XmlElement.parse(xml, maxChars: maxDocumentChars), root.name == "tt", let body = root.child("body") else { return [] }
        let declaredFrameRate = Double(root.attribute("frameRate")).flatMap { $0 > 0 ? $0 : nil }
        // 25 fps when undeclared, as in the RN parser (EBU-TT-D broadcasters).
        let frameRate = declaredFrameRate ?? 25
        let parts = root.attribute("frameRateMultiplier").split(separator: " ").compactMap { Double($0) }
        let multiplier = parts.count == 2 && parts[1] != 0 ? parts[0] / parts[1] : 1
        let subFrameRate = Double(root.attribute("subFrameRate")).flatMap { $0 > 0 ? $0 : nil } ?? 1
        // TTML: without ttp:tickRate, ticks are frames x sub-frames when a frame rate is declared, otherwise 1 per second.
        let tickRate = Double(root.attribute("tickRate")).flatMap { $0 > 0 ? $0 : nil }
            ?? declaredFrameRate.map { $0 * multiplier * subFrameRate } ?? 1
        var cues: [Cue] = []
        let timing = Timing(frameRate: frameRate * multiplier, tickRate: tickRate, subFrameRate: subFrameRate)
        walk(body, parentBegin: 0, timing: timing, cues: &cues)
        return stableSorted(cues)
    }

    private static func walk(_ element: XmlElement, parentBegin: Double, timing: Timing, cues: inout [Cue]) {
        guard cues.count < maxCues else { return }
        let begin = parentBegin + (parseTime(element.attribute("begin"), timing) ?? 0)
        if element.name == "p" {
            let end: Double
            if let value = parseTime(element.attribute("end"), timing) { end = parentBegin + value }
            else if let value = parseTime(element.attribute("dur"), timing) { end = begin + value }
            else { return }
            let lines = text(element).components(separatedBy: "\n").map { line in
                line.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: " ")
            }
            let value = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty && end > begin { cues.append(Cue(startS: begin, endS: end, text: value)) }
            return
        }
        for child in element.elements where child.name == "div" || child.name == "p" {
            walk(child, parentBegin: begin, timing: timing, cues: &cues)
        }
    }

    private static func text(_ element: XmlElement) -> String {
        element.children.map { child -> String in
            switch child {
            case .text(let value): return value.replacingOccurrences(of: "\n", with: " ")
            case .element(let nested):
                if nested.name == "br" { return "\n" }
                return nested.name == "span" ? text(nested) : ""
            }
        }.joined()
    }

    private static let clockTime = Pattern("^(\\d+):(\\d{2}):(\\d{2})(?:\\.(\\d+))?$")
    private static let frameTime = Pattern("^(\\d+):(\\d{2}):(\\d{2}):(\\d+)(?:\\.(\\d+))?$")
    private static let offsetTime = Pattern("^(\\d+(?:\\.\\d+)?)(h|ms|m|s|f|t)$")

    private static func parseTime(_ value: String, _ timing: Timing) -> Double? {
        let text = value.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        if let m = clockTime.matchEntire(text) {
            let fraction = m[4].isEmpty ? 0 : Double("0." + m[4]) ?? 0
            return Double(Int64(m[1])! * 3600 + Int64(m[2])! * 60 + Int64(m[3])!) + fraction
        }
        if let m = frameTime.matchEntire(text) {
            let frames = (Double(m[4]) ?? 0) + (m[5].isEmpty ? 0 : (Double(m[5]) ?? 0) / timing.subFrameRate)
            return Double(Int64(m[1])! * 3600 + Int64(m[2])! * 60 + Int64(m[3])!) + frames / timing.frameRate
        }
        if let m = offsetTime.matchEntire(text), let amount = Double(m[1]) {
            switch m[2] {
            case "h": return amount * 3600
            case "m": return amount * 60
            case "s": return amount
            case "ms": return amount / 1000
            case "f": return amount / timing.frameRate
            default: return amount / timing.tickRate
            }
        }
        return nil
    }

    private static let vttTiming = Pattern("((?:\\d+:)?\\d{2}:\\d{2}[.,]\\d{3})\\s*-->\\s*((?:\\d+:)?\\d{2}:\\d{2}[.,]\\d{3})")
    private static let tags = Pattern("<[^>]+>")

    public static func parseVtt(_ text: String) -> [Cue] {
        guard text.count <= maxDocumentChars else { return [] }
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        var cues: [Cue] = []
        var index = 0
        while index < lines.count && cues.count < maxCues {
            let match = vttTiming.firstMatch(lines[index])
            index += 1
            guard let timing = match else { continue }
            var body: [String] = []
            while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                body.append(lines[index])
                index += 1
            }
            let cleaned = tags.replace(body.joined(separator: "\n")) { _ in "" }
                .replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
                .replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&amp;", with: "&")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let start = vttTime(timing[1])
            let end = vttTime(timing[2])
            if !cleaned.isEmpty && end > start { cues.append(Cue(startS: start, endS: end, text: cleaned)) }
        }
        return stableSorted(cues)
    }

    private static func vttTime(_ value: String) -> Double {
        let parts = value.replacingOccurrences(of: ",", with: ".").split(separator: ":").map(String.init)
        let seconds = Double(parts.last ?? "0") ?? 0
        let minutes = Double(parts[parts.count - 2]) ?? 0
        let hours = parts.count == 3 ? Double(parts[0]) ?? 0 : 0
        return hours * 3600 + minutes * 60 + seconds
    }

    private static func stableSorted(_ cues: [Cue]) -> [Cue] {
        cues.enumerated().sorted { $0.element.startS == $1.element.startS ? $0.offset < $1.offset : $0.element.startS < $1.element.startS }
            .map { $0.element }
    }

    /// Extracts the TTML document from the `mdat` box of an fMP4 (`stpp`) segment.
    public static func extractTtmlFromMp4(_ data: Data) -> String? {
        let bytes = [UInt8](data)
        var offset = 0
        func uint32(_ at: Int) -> Int { (Int(bytes[at]) << 24) | (Int(bytes[at + 1]) << 16) | (Int(bytes[at + 2]) << 8) | Int(bytes[at + 3]) }
        while offset + 8 <= bytes.count {
            var size = uint32(offset)
            let type = String(decoding: bytes[(offset + 4)..<(offset + 8)], as: UTF8.self)
            var header = 8
            if size == 1 {
                guard offset + 16 <= bytes.count else { return nil }
                let high = uint32(offset + 8)
                guard high == 0 else { return nil }
                size = uint32(offset + 12)
                header = 16
            } else if size == 0 {
                size = bytes.count - offset
            }
            guard size >= header, offset + size <= bytes.count else { return nil }
            if type == "mdat" {
                let xml = String(decoding: bytes[(offset + header)..<(offset + size)], as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return xml.hasPrefix("<") ? xml : nil
            }
            offset += size
        }
        return nil
    }
}

/// Sorted cue list with overlap-aware lookup.
public struct CueTrack {
    private let sorted: [Cue]

    public init(_ cues: [Cue] = []) {
        sorted = cues.enumerated().sorted { $0.element.startS == $1.element.startS ? $0.offset < $1.offset : $0.element.startS < $1.element.startS }
            .map { $0.element }
    }

    public var count: Int { sorted.count }

    public func activeText(_ time: Double?) -> String? {
        guard let time = time, !sorted.isEmpty else { return nil }
        var low = 0
        var high = sorted.count
        while low < high {
            let mid = (low + high) / 2
            if sorted[mid].startS <= time { low = mid + 1 } else { high = mid }
        }
        let active = sorted[0..<low].filter { time < $0.endS }.suffix(4).map { $0.text }
        return active.isEmpty ? nil : active.joined(separator: "\n")
    }
}

/// Plans segmented-TTML downloads (live by wall clock, VOD by position) with a bounded buffer.
public final class TextSegmentSchedule {
    private let template: SegmentTemplate
    private let baseUrl: String
    private let isLive: Bool
    private let availabilityStartTimeMs: Int64?
    private let representationId: String?
    private let maxSegments: Int
    private var buffer: [(Int64, [Cue])] = []
    private var lastFetched: Int64?
    private static let placeholder = Pattern("\\$(Number|Time|RepresentationID)(%0(\\d+)d)?\\$")

    public init(template: SegmentTemplate, baseUrl: String, isLive: Bool, availabilityStartTimeMs: Int64?,
                representationId: String? = nil, maxSegments: Int = 20) {
        self.template = template
        self.baseUrl = baseUrl
        self.isLive = isLive
        self.availabilityStartTimeMs = availabilityStartTimeMs
        self.representationId = representationId
        self.maxSegments = maxSegments
    }

    public func currentSegment(nowEpochMs: Int64, positionS: Double?) -> Int64 {
        let fallback = isLive ? availabilityStartTimeMs.map { Double(nowEpochMs - $0) / 1000 } ?? 0 : 0
        let elapsed = (positionS ?? fallback) - template.periodStartS
        if elapsed < 0 { return template.startNumber }
        if !template.segments.isEmpty {
            let time = elapsed * Double(template.timescale) + Double(template.presentationTimeOffset)
            let index = template.segments.lastIndex { Double($0.time) <= time } ?? 0
            return template.startNumber + Int64(index)
        }
        return template.startNumber + Int64((elapsed / template.segmentSeconds).rounded(.down))
    }

    public func pending(nowEpochMs: Int64, positionS: Double?) -> [Int64] {
        let current = currentSegment(nowEpochMs: nowEpochMs, positionS: positionS)
        if let last = lastFetched, last > current || current - last > Int64(maxSegments) { reset() }
        let start: Int64
        if let last = lastFetched, last <= current, current - last <= Int64(maxSegments) { start = last + 1 } else { start = current - 1 }
        let first = max(start, template.startNumber)
        guard first <= current else { return [] }
        return Array(Array(first...current).suffix(maxSegments))
    }

    public func url(_ number: Int64) -> String? {
        let segment: TextSegment?
        if template.segments.isEmpty { segment = nil }
        else {
            let index = number.subtractingReportingOverflow(template.startNumber)
            guard !index.overflow, index.partialValue >= 0, index.partialValue < Int64(template.segments.count) else { return nil }
            segment = template.segments[Int(index.partialValue)]
        }
        if let path = segment?.url { return MpdParser.resolve(baseUrl, path) }
        let path = TextSegmentSchedule.placeholder.replace(template.media) { groups in
            if groups[1] == "Time" { return String(segment?.time ?? ((number - self.template.startNumber) * self.template.duration)) }
            if groups[1] == "Number" {
                if let width = Int(groups[3]) {
                    let digits = String(number)
                    return String(repeating: "0", count: max(0, min(width, 12) - digits.count)) + digits
                }
                return String(number)
            }
            return representationId ?? ""
        }.replacingOccurrences(of: "$$", with: "$")
        return MpdParser.resolve(baseUrl, path)
    }

    public func complete(_ number: Int64, cues: [Cue]) {
        lastFetched = max(lastFetched ?? number, number)
        buffer.removeAll { $0.0 == number }
        guard !cues.isEmpty else { return }
        let offset = template.presentationTimeOffsetSeconds - template.periodStartS
        buffer.append((number, cues.map { Cue(startS: $0.startS - offset, endS: $0.endS - offset, text: $0.text) }))
        while buffer.count > maxSegments { buffer.removeFirst() }
    }

    public func cues() -> [Cue] { buffer.flatMap { $0.1 } }

    public func reset() {
        buffer.removeAll()
        lastFetched = nil
    }
}
