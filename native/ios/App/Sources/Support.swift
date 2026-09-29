import Foundation
import os
import SwiftUI

/// Localized strings generated from the shared translations (native/tools/export-brand.cjs).
enum L10n {
    static func t(_ key: String) -> String { NSLocalizedString(key, comment: "") }

    static func t(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: NSLocalizedString(key, comment: ""), arguments: arguments)
    }

    static func list(_ key: String) -> [String] {
        let count = Int(t("\(key).count")) ?? 0
        return (0..<count).map { t("\(key).\($0)") }
    }
}

/// Brand palette exported from `src/theme.js` plus brand overrides.
enum Theme {
    static func color(_ name: String) -> Color {
        let value = BrandConfig.colors[name] ?? 0xFF00FF
        return Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    static func spacing(_ name: String) -> CGFloat { CGFloat(BrandConfig.spacing[name] ?? 16) }
    static func radius(_ name: String) -> CGFloat { CGFloat(BrandConfig.radius[name] ?? 8) }

    static var background: Color { color("background") }
    static var surface: Color { color("surfaceContainer") }
    static var surfaceHigh: Color { color("surfaceContainerHigh") }
    static var onSurface: Color { color("onSurface") }
    static var onSurfaceVariant: Color { color("onSurfaceVariant") }
    static var primary: Color { color("primary") }
    static var onPrimary: Color { color("onPrimary") }
    static var success: Color { color("success") }
    static var tertiary: Color { color("tertiary") }
}

/**
 * In-memory structured log (PRD-013-R07): states, units and ephemeral ids only,
 * never payloads or URLs. Exported only by an explicit user action.
 */
final class Diagnostics {
    private let lock = NSLock()
    private var records: [String] = []
    private let capacity = 2_000
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "mediasync", category: "MediaSync")

    func log(_ area: String, _ event: String, _ fields: [String: Any] = [:]) {
        var object: [String: Any] = ["t": Int(ProcessInfo.processInfo.systemUptime * 1000), "a": area, "e": event]
        for (key, value) in fields { object[key] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return }
        lock.lock()
        records.append(line)
        if records.count > capacity { records.removeFirst(records.count - capacity) }
        lock.unlock()
        #if DEBUG
        logger.debug("\(line, privacy: .public)")
        #endif
    }

    func export() -> String {
        lock.lock()
        defer { lock.unlock() }
        return (["MediaSync diagnostics \(BrandConfig.version)"] + records).joined(separator: "\n")
    }
}
