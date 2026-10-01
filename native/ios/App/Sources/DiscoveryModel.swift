import Darwin
import Foundation
import MediaSyncCore
import Network

/// Owns at most one DIAL scan; results are published incrementally and tagged by generation.
final class DiscoveryModel: ObservableObject {
    enum Phase { case idle, searching, finished }
    enum Problem { case noNetwork, permission, sendFailed }

    /// The RN reference lists DIAL devices without HbbTV under "other devices"; never offered for sync.
    static let allowNonHbbtvDevices = true

    @Published private(set) var phase = Phase.idle
    @Published private(set) var terminals: [DialTerminal] = []
    @Published private(set) var problem: Problem?
    @Published private(set) var networkAvailable = false

    var syncCapable: [DialTerminal] { terminals.filter { $0.supportsMediaSync } }
    var others: [DialTerminal] { terminals.filter { !$0.supportsMediaSync } }

    private let diagnostics: Diagnostics
    private let monitor = NWPathMonitor()
    private var interfaceName: String?
    private var task: Task<Void, Never>?
    private var generation = 0

    init(diagnostics: Diagnostics) {
        self.diagnostics = diagnostics
        monitor.pathUpdateHandler = { [weak self] path in
            let local = path.availableInterfaces.first { $0.type == .wifi || $0.type == .wiredEthernet }
            DispatchQueue.main.async {
                guard let self = self else { return }
                let wasAvailable = self.networkAvailable
                self.interfaceName = local?.name
                self.networkAvailable = path.status == .satisfied && local != nil
                if !wasAvailable && self.networkAvailable && self.problem == .noNetwork { self.start() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "mediasync.path"))
    }

    func start() {
        cancel()
        generation += 1
        let current = generation
        guard networkAvailable else {
            phase = .finished
            problem = .noNetwork
            terminals = []
            return
        }
        phase = .searching
        problem = nil
        terminals = []
        var options = DialDiscoveryScan.Options()
        options.allowNonHbbtvDevices = Self.allowNonHbbtvDevices
        options.interfaceAddress = interfaceName.flatMap(Self.ipv4Address)
        #if DEBUG
        // Development-only unicast SSDP target (e.g. tools/tv-emulator), so devices signed
        // without Apple's multicast entitlement can still exercise the full session path.
        if let destination = ProcessInfo.processInfo.environment["MEDIASYNC_SSDP_DESTINATION"] {
            options.destination = destination
        }
        #endif
        let startedAt = Date()
        diagnostics.log("discovery", "start", ["generation": current])
        task = Task { [weak self] in
            var problem: Problem?
            var found = 0
            do {
                let result = try await DialDiscoveryScan(options: options).run { terminal in
                    let latency = Int(Date().timeIntervalSince(startedAt) * 1000)
                    DispatchQueue.main.async {
                        guard let self = self, self.generation == current else { return }
                        self.diagnostics.log("discovery", "found", ["generation": current, "latencyMs": latency])
                        self.terminals.append(terminal)
                    }
                }
                found = result.terminals.count
            } catch ScanError.socket(let code) where code == EHOSTUNREACH || code == EPERM || code == ENETUNREACH {
                problem = .permission
            } catch {
                problem = .sendFailed
            }
            DispatchQueue.main.async {
                guard let self = self, self.generation == current else { return }
                self.diagnostics.log("discovery", "finish", ["generation": current, "found": found, "problem": "\(problem.map { "\($0)" } ?? "none")"])
                self.phase = .finished
                self.problem = problem
            }
        }
    }

    func cancel() {
        generation += 1
        task?.cancel()
        task = nil
        if phase == .searching { phase = .finished }
    }

    private static func ipv4Address(_ interface: String) -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard String(cString: entry.pointee.ifa_name) == interface, let address = entry.pointee.ifa_addr,
                  address.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                return String(cString: host)
            }
        }
        return nil
    }
}

/// Bounded, cancellable downloads of untrusted content (manifests, subtitles, page metadata).
final class ContentLoader {
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 30
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }()

    struct HttpStatus: Error { let code: Int }
    struct TooLarge: Error {}

    func data(_ address: String, maxBytes: Int, truncate: Bool = false) async throws -> Data {
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw URLError(.unsupportedURL)
        }
        var request = URLRequest(url: url)
        request.setValue("MediaSyncNative/1.0", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200...299).contains(http.statusCode) else { throw HttpStatus(code: http.statusCode) }
        if !truncate && http.expectedContentLength > Int64(maxBytes) { throw TooLarge() }
        var data = Data()
        data.reserveCapacity(min(maxBytes, max(0, Int(http.expectedContentLength))))
        for try await byte in bytes {
            if data.count >= maxBytes {
                if truncate { break }
                throw TooLarge()
            }
            data.append(byte)
        }
        return data
    }

    func text(_ address: String, maxBytes: Int, truncate: Bool = false) async throws -> String {
        String(decoding: try await data(address, maxBytes: maxBytes, truncate: truncate), as: UTF8.self)
    }

    func manifest(_ address: String, kind: ContentKind) async throws -> MediaManifest {
        let body = try await text(address, maxBytes: MpdParser.maxBytes)
        return kind == .hls ? try HlsParser.parse(body, url: address) : try MpdParser.parse(body, url: address)
    }

    func webMetadata(_ address: String) async -> WebMetadata {
        guard let html = try? await text(address, maxBytes: WebMetadata.maxHtmlChars, truncate: true) else {
            return WebMetadata.parse("", pageUrl: address)
        }
        return WebMetadata.parse(html, pageUrl: address)
    }

    func dataOrNil(_ address: String, maxBytes: Int) async throws -> Data? {
        do {
            return try await data(address, maxBytes: maxBytes)
        } catch let status as HttpStatus where status.code == 404 {
            return nil
        }
    }
}
