import Foundation

/// Bounded JSON helpers used at every network boundary (mirrors Kotlin `JsonInput`).
enum JsonInput {
    static let maxMessageChars = 262_144
    static let maxDepth = 32

    static func parseObject(_ text: String, maxChars: Int = maxMessageChars) -> [String: Any]? {
        guard text.count <= maxChars, let data = text.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              depth(value) <= maxDepth else { return nil }
        return value as? [String: Any]
    }

    static func depth(_ value: Any, _ current: Int = 1) -> Int {
        if current > maxDepth { return current }
        if let object = value as? [String: Any] { return object.values.map { depth($0, current + 1) }.max() ?? current }
        if let array = value as? [Any] { return array.map { depth($0, current + 1) }.max() ?? current }
        return current
    }

    static func isNull(_ value: Any?) -> Bool { value is NSNull }

    static func string(_ value: Any?) -> String? { value as? String }

    private static func isBoolean(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

    /// Integer from a JSON number or decimal string, rounding fractions, without precision loss for integers.
    static func long(_ value: Any?) -> Int64? {
        if let text = value as? String {
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard trimmed.count <= 64 else { return nil }
            if let exact = Int64(trimmed) { return exact }
            return decimal(trimmed)
        }
        guard let number = value as? NSNumber, !isBoolean(number) else { return nil }
        let text = number.stringValue
        return Int64(text) ?? decimal(text)
    }

    private static func decimal(_ text: String) -> Int64? {
        guard text.count <= 64, let value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), value.isFinite else { return nil }
        guard value.exponent <= 64, value.exponent >= -64 else { return nil }
        var input = value
        var rounded = Decimal()
        NSDecimalRound(&rounded, &input, 0, .plain)
        guard rounded >= Decimal(Int64.min), rounded <= Decimal(Int64.max) else { return nil }
        return Int64(NSDecimalNumber(decimal: rounded).stringValue)
    }

    static func double(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, !isBoolean(number) else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    static func escape(_ value: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return String(decoding: (try? encoder.encode(value)) ?? Data("\"\"".utf8), as: UTF8.self)
    }

    /// Serialises any JSON value (including fragments); nil becomes `null`.
    static func serialize(_ value: Any?) -> String {
        guard let value = value, !(value is NSNull) else { return "null" }
        if let text = value as? String { return escape(text) }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes]) else { return "null" }
        return String(decoding: data, as: UTF8.self)
    }
}

/// Small NSRegularExpression wrapper (the package supports iOS 15, before Swift Regex).
struct Pattern {
    private let expression: NSRegularExpression

    init(_ pattern: String, caseInsensitive: Bool = false) {
        // Patterns are compile-time constants of this package.
        expression = try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    /// Capture groups of a whole-string match ("" for groups that did not participate).
    func matchEntire(_ text: String) -> [String]? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = expression.firstMatch(in: text, range: range), match.range == range else { return nil }
        return groups(match, in: text)
    }

    func firstMatch(_ text: String) -> [String]? {
        guard let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return groups(match, in: text)
    }

    func allMatches(_ text: String) -> [[String]] {
        expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { groups($0, in: text) }
    }

    func contains(_ text: String) -> Bool { firstMatch(text) != nil }

    func replace(_ text: String, _ transform: ([String]) -> String) -> String {
        var result = ""
        var last = text.startIndex
        for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text) else { continue }
            result += text[last..<range.lowerBound]
            result += transform(groups(match, in: text))
            last = range.upperBound
        }
        return result + text[last...]
    }

    private func groups(_ match: NSTextCheckingResult, in text: String) -> [String] {
        (0..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
        }
    }
}
