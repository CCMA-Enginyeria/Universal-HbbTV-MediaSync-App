import Foundation

/// Media synchronisation transport advertised by a terminal.
public enum SyncMode: String, CaseIterable {
    case native
    case compat

    /// The RN reference stored `compat` by default.
    public static let defaultMode = SyncMode.compat
    public var wireName: String { rawValue }
}

/// Endpoint helpers shared by discovery, the session and the probes (mirrors Kotlin `Endpoints`).
public enum Endpoints {
    public static let defaultCompatPrefix = "hbbtv-sync"
    private static let authority = Pattern("^([a-zA-Z][a-zA-Z0-9+.-]*://)([^/:?#]*)([\\s\\S]*)$")
    private static let placeholders: Set<String> = ["", "0.0.0.0", "localhost", "127.0.0.1"]

    public static func hasPlaceholderHost(_ url: String?) -> Bool {
        guard let url = url, let match = authority.matchEntire(url) else { return false }
        return placeholders.contains(match[2].lowercased())
    }

    public static func repair(_ url: String?, realHost: String?) -> String? {
        guard let url = url, let host = realHost, !host.isEmpty, let match = authority.matchEntire(url),
              placeholders.contains(match[2].lowercased()) else { return url }
        return match[1] + host + match[3]
    }

    public static func realHost(_ candidates: String?...) -> String? {
        for candidate in candidates {
            guard let candidate = candidate, let host = URLComponents(string: candidate)?.host, !host.isEmpty,
                  !placeholders.contains(host.lowercased()) else { continue }
            return host
        }
        return nil
    }

    private static let webSocket = Pattern("^wss?://[^/\\s]+", caseInsensitive: true)

    public static func isWebSocket(_ url: String?) -> Bool {
        guard let url = url else { return false }
        return webSocket.contains(url)
    }

    public static func compatUrl(_ app2appBase: String?, prefix: String, service: String) -> String? {
        guard var base = app2appBase, !base.isEmpty else { return nil }
        let cleanPrefix = prefix.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !cleanPrefix.isEmpty else { return nil }
        while base.hasSuffix("/") { base.removeLast() }
        return "\(base)/\(cleanPrefix)-\(service)"
    }

    public static func isCompatServiceUrl(_ url: String?, prefix: String, service: String) -> Bool {
        guard isWebSocket(url), var value = url else { return false }
        while value.hasSuffix("/") { value.removeLast() }
        return value.hasSuffix("/\(prefix.trimmingCharacters(in: CharacterSet(charactersIn: "/")))-\(service)")
    }

    public struct UdpEndpoint: Equatable {
        public let host: String
        public let port: Int
    }

    public static func parseUdp(_ url: String?) -> UdpEndpoint? {
        guard let url = url, !url.isEmpty else { return nil }
        var rest: Substring
        if url.lowercased().hasPrefix("udp://") { rest = url.dropFirst(6) } else if url.contains("://") { return nil } else { rest = Substring(url) }
        if let slash = rest.firstIndex(of: "/") { rest = rest[..<slash] }
        guard let separator = rest.lastIndex(of: ":"), separator > rest.startIndex else { return nil }
        let host = String(rest[..<separator])
        guard let port = Int(rest[rest.index(after: separator)...]), (1...65535).contains(port),
              !host.contains(where: { $0.isWhitespace || $0 == "@" }) else { return nil }
        return UdpEndpoint(host: host, port: port)
    }

    public static func ciiUrl(mode: SyncMode, interDevSyncUrl: String?, app2appUrl: String?, prefix: String) -> String? {
        switch mode {
        case .native: return isWebSocket(interDevSyncUrl) ? interDevSyncUrl : nil
        case .compat: return compatUrl(app2appUrl, prefix: prefix, service: "cii")
        }
    }

    /// RN-compatible preference key so migrated preferences stay attached to the same TV model.
    public static func preferenceKey(manufacturer: String?, modelName: String?, location: String?) -> String {
        func normalize(_ value: String?) -> String {
            guard let value = value else { return "" }
            return value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: Locale(identifier: "en_US"))
                .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        }
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)..<Unicode.Scalar(128)))
        allowed.insert(charactersIn: "-_.!~*'()")
        func encode(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        let prefix = "@universal-mediasync/mode/v1"
        let maker = normalize(manufacturer)
        let model = normalize(modelName)
        if !maker.isEmpty || !model.isEmpty { return "\(prefix)/model/\(encode(maker))/\(encode(model))" }
        let device = normalize(location)
        return "\(prefix)/device/\(encode(device.isEmpty ? "unknown" : device))"
    }
}
