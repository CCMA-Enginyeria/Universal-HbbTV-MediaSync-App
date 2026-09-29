import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public struct DialDevice: Equatable, Sendable {
    public let location: String
    public let applicationUrl: String
    public let friendlyName: String?
    public let manufacturer: String?
    public let modelName: String?
    public var udn: String? = nil
    public var hbbtvUrl: String { applicationUrl + "/HbbTV" }
    /// Stable identity: the UPnP UDN when present, otherwise the description URL.
    public var id: String { udn ?? location }
}

public struct HbbtvApplication: Equatable, Sendable {
    public let app2AppUrl: String?
    public let interDeviceSyncUrl: String?
    public let userAgent: String?
}

public struct DialTerminal: Equatable, Sendable {
    public let device: DialDevice
    public let application: HbbtvApplication?
    public var supportsHbbtv: Bool { application?.app2AppUrl != nil }
    public var supportsMediaSync: Bool { application?.interDeviceSyncUrl != nil || application?.app2AppUrl != nil }

    public init(device: DialDevice, application: HbbtvApplication?) {
        self.device = device
        self.application = application
    }
}

public enum DialProtocol {
    public static let searchTarget = "urn:dial-multiscreen-org:service:dial:1"
    public static let multicastAddress = "239.255.255.250"
    public static let port = 1900
    public static let searchMessage = [
        "M-SEARCH * HTTP/1.1", "HOST: \(multicastAddress):\(port)",
        "MAN: \"ssdp:discover\"", "MX: 3", "ST: \(searchTarget)", "", ""
    ].joined(separator: "\r\n")

    public static func parseResponse(_ message: String) -> String? {
        guard message.utf8.count <= 65507, !message.contains("\0") else { return nil }
        let lines = message.components(separatedBy: "\n").map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let status = lines.first,
              status.range(of: #"^HTTP/1\.[01] 200(?: .*|)$"#, options: .regularExpression) != nil
        else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            if line.isEmpty { break }
            guard let separator = line.firstIndex(of: ":") else { return nil }
            let name = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            guard !name.isEmpty, headers[name] == nil else { return nil }
            headers[name] = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
        }
        guard headers["st"] == searchTarget else { return nil }
        return validUrl(headers["location"], schemes: ["http", "https"])
    }

    public static func parseDevice(_ xml: String, location: String, applicationUrl: String?) -> DialDevice? {
        var base = applicationUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
        while base?.hasSuffix("/") == true { base?.removeLast() }
        guard let descriptionUrl = validUrl(location, schemes: ["http", "https"]),
              let applicationBase = validUrl(base, schemes: ["http", "https"]),
              URLComponents(string: applicationBase)?.query == nil,
              let root = parseXml(xml), root.name == "root",
              let device = root.child("device") else { return nil }
        return DialDevice(location: descriptionUrl, applicationUrl: applicationBase,
                          friendlyName: device.value("friendlyName"),
                          manufacturer: device.value("manufacturer"), modelName: device.value("modelName"),
                          udn: device.value("UDN"))
    }

    /// Both App2App and the CSS-CII InterDevSync endpoint are WebSocket URLs;
    /// placeholder hosts are replaced by `realHost` (the host that answered discovery).
    public static func parseApplication(_ xml: String, realHost: String? = nil) -> HbbtvApplication? {
        guard let root = parseXml(xml), root.name == "service" else { return nil }
        let additional = root.child("additionalData")
        func endpoint(_ name: String) -> String? {
            validUrl(Endpoints.repair(additional?.value(name), realHost: realHost), schemes: ["ws", "wss"])
        }
        return HbbtvApplication(
            app2AppUrl: endpoint("X_HbbTV_App2AppURL"),
            interDeviceSyncUrl: endpoint("X_HbbTV_InterDevSyncURL"),
            userAgent: additional?.value("X_HbbTV_UserAgent"))
    }

    private static func validUrl(_ value: String?, schemes: Set<String>) -> String? {
        guard let value = value, !value.isEmpty,
              value.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              let components = URLComponents(string: value),
              let scheme = components.scheme, schemes.contains(scheme.lowercased()),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil, components.fragment == nil,
              components.url != nil else { return nil }
        if let port = components.port, !(0...65535).contains(port) { return nil }
        return value
    }

    private static func parseXml(_ xml: String) -> XmlNode? {
        guard xml.utf8.count <= 1_048_576, !xml.contains("<!DOCTYPE"), !xml.contains("\0") else { return nil }
        let delegate = XmlTree()
        let parser = XMLParser(data: Data(xml.utf8))
        parser.shouldProcessNamespaces = true
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse(), parser.parserError == nil else { return nil }
        return delegate.root
    }
}

private final class XmlNode {
    let name: String
    var text = ""
    var children: [XmlNode] = []
    init(_ name: String) { self.name = name }
    func child(_ name: String) -> XmlNode? { children.first { $0.name == name } }
    func value(_ name: String) -> String? {
        guard let value = child(name)?.text.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }
}

private final class XmlTree: NSObject, XMLParserDelegate {
    var root: XmlNode?
    private var stack: [XmlNode] = []

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName: String?, attributes attributeDict: [String: String]) {
        let node = XmlNode(elementName)
        if let parent = stack.last { parent.children.append(node) } else { root = node }
        stack.append(node)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        for node in stack { node.text += string }
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        let text = String(decoding: CDATABlock, as: UTF8.self)
        for node in stack { node.text += text }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        _ = stack.popLast()
    }
}