import Foundation
import Darwin

public struct DialDiscoveryScan {
    public struct Options {
        public var duration: TimeInterval = 30
        public var requestTimeout: TimeInterval = 5
        public var maxBodyBytes = 1_048_576
        public var maxDevices = 128
        public var allowNonHbbtvDevices = false
        public var destination = DialProtocol.multicastAddress
        public var port: UInt16 = UInt16(DialProtocol.port)
        public var interfaceAddress: String?
        /// Extra M-SEARCH transmissions, relative to the scan start (UDP is lossy).
        public var searchRetryDelays: [TimeInterval] = [1, 3]
        public var maxConcurrentRequests = 4
        public init() {}
    }

    public struct Failure: Sendable {
        public let location: String
        public let message: String
    }

    public struct Result: Sendable {
        public let terminals: [DialTerminal]
        public let failures: [Failure]
        public let cancelled: Bool
    }

    public let options: Options
    public init(options: Options = Options()) { self.options = options }

    /// `onFound` is called once per new terminal as soon as it resolves, from a background task.
    public func run(onFound: @escaping @Sendable (DialTerminal) -> Void = { _ in }) async throws -> Result {
        guard options.duration.isFinite, options.duration > 0, options.duration <= 3600,
              options.requestTimeout.isFinite, options.requestTimeout > 0,
              (1...1_048_576).contains(options.maxBodyBytes), options.maxDevices > 0,
              (1...16).contains(options.maxConcurrentRequests), options.searchRetryDelays.count <= 8,
              options.searchRetryDelays.allSatisfy({ $0 > 0 && $0.isFinite }) else {
            throw ScanError.invalidOptions
        }
        if Task.isCancelled { return Result(terminals: [], failures: [], cancelled: true) }
        let receiver = try SSDPReceiver(options: options)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = min(options.requestTimeout, options.duration)
        configuration.timeoutIntervalForResource = min(options.requestTimeout, options.duration)
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        let http = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        let timeout = DispatchWorkItem {
            receiver.close()
            http.invalidateAndCancel()
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + options.duration, execute: timeout)
        for delay in options.searchRetryDelays where delay < options.duration {
            DispatchQueue.global().asyncAfter(deadline: .now() + delay) { receiver.resend() }
        }
        defer {
            timeout.cancel()
            receiver.close()
            http.invalidateAndCancel()
        }
        let options = self.options
        return try await withTaskCancellationHandler(operation: {
            let state = ScanState(allowNonHbbtvDevices: options.allowNonHbbtvDevices, maxFailures: options.maxDevices)
            var receiveError: Error?
            await withTaskGroup(of: Void.self) { group in
                var running = 0
                do {
                    for try await packet in receiver.messages {
                        if Task.isCancelled || receiver.isClosed { break }
                        // Only descriptions served by the host that answered (no LAN-triggered SSRF).
                        guard let location = DialProtocol.parseResponse(packet.text),
                              SSDPPacket.names(location, address: packet.source),
                              let request = await state.accept(packet.text) else { continue }
                        if running >= options.maxConcurrentRequests {
                            _ = await group.next()
                            running -= 1
                        }
                        running += 1
                        group.addTask {
                            let location = request.location
                            do {
                                let terminal = try await self.resolve(location, session: http, receiver: receiver)
                                await state.complete(request, terminal: terminal, onFound: onFound)
                            } catch {
                                let ended = Task.isCancelled || receiver.isClosed
                                await state.complete(request, terminal: nil, onFound: onFound)
                                if !ended { await state.fail(Failure(location: location, message: String(describing: error))) }
                            }
                        }
                        if await state.count >= options.maxDevices { break }
                    }
                } catch {
                    if !Task.isCancelled { receiveError = error }
                }
                receiver.close()
                http.invalidateAndCancel()
                group.cancelAll()
            }
            if let error = receiveError { throw error }
            let (terminals, failures) = await state.finish()
            return Result(terminals: Task.isCancelled ? [] : terminals, failures: failures, cancelled: Task.isCancelled)
        }, onCancel: {
            receiver.close()
            http.invalidateAndCancel()
        })
    }

    /// Application-URL must stay on the device-description host.
    static func sameHost(_ applicationUrl: String, _ location: String) -> Bool {
        guard let host = URLComponents(string: applicationUrl)?.host?.lowercased() else { return false }
        return host == URLComponents(string: location)?.host?.lowercased()
    }

    private func resolve(_ location: String, session http: URLSession, receiver: SSDPReceiver) async throws -> DialTerminal {
        let description = try await get(location, session: http)
        guard let device = DialProtocol.parseDevice(description.0, location: location,
            applicationUrl: description.1.value(forHTTPHeaderField: "Application-URL")) else {
            throw ScanError.invalidDescription
        }
        guard Self.sameHost(device.applicationUrl, location) else { throw ScanError.applicationUrlHostMismatch }
        let application: HbbtvApplication?
        do {
            application = DialProtocol.parseApplication(try await get(device.hbbtvUrl, session: http).0,
                                                        realHost: URLComponents(string: location)?.host)
        } catch {
            if Task.isCancelled || receiver.isClosed || !options.allowNonHbbtvDevices { throw error }
            application = nil
        }
        return DialTerminal(device: device, application: application)
    }

    private func get(_ address: String, session: URLSession) async throws -> (String, HTTPURLResponse) {
        try Task.checkCancellation()
        guard let url = URL(string: address) else { throw ScanError.invalidDescription }
        var request = URLRequest(url: url)
        request.setValue("DialApp/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let response = response as? HTTPURLResponse else { throw ScanError.invalidDescription }
        guard (200...299).contains(response.statusCode) else { throw ScanError.http(response.statusCode) }
        guard response.expectedContentLength <= Int64(options.maxBodyBytes) else { throw ScanError.bodyTooLarge }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < options.maxBodyBytes else { throw ScanError.bodyTooLarge }
            data.append(byte)
        }
        return (String(decoding: data, as: UTF8.self), response)
    }
}

/// Scan failures; `socket` carries errno so apps can map local-network denials (EHOSTUNREACH/EPERM).
public enum ScanError: Error {
    case invalidOptions, invalidDescription, bodyTooLarge, applicationUrlHostMismatch
    case http(Int), socket(Int32)
}

/// Serialises the non-thread-safe discovery session for concurrent resolutions.
private actor ScanState {
    private let session: DiscoverySession
    private let maxFailures: Int
    private var failures: [DialDiscoveryScan.Failure] = []
    private var finished = false

    init(allowNonHbbtvDevices: Bool, maxFailures: Int) {
        session = DiscoverySession(allowNonHbbtvDevices: allowNonHbbtvDevices)
        self.maxFailures = maxFailures
        session.start()
    }

    var count: Int { session.terminals.count }

    func accept(_ packet: String) -> DiscoverySession.Request? { finished ? nil : session.accept(packet) }

    func complete(_ request: DiscoverySession.Request, terminal: DialTerminal?, onFound: @Sendable (DialTerminal) -> Void) {
        guard !finished, !Task.isCancelled || terminal == nil else { return }
        if session.complete(request, terminal: terminal), let terminal = terminal { onFound(terminal) }
    }

    func fail(_ failure: DialDiscoveryScan.Failure) {
        if !finished && failures.count < maxFailures { failures.append(failure) }
    }

    func finish() -> ([DialTerminal], [DialDiscoveryScan.Failure]) {
        finished = true
        session.finish()
        return (session.terminals, failures)
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// One SSDP datagram and the IPv4 address it came from.
struct SSDPPacket: Sendable {
    let text: String
    /// Sender IPv4 address in network byte order.
    let source: UInt32

    /// True when [url] names [address] as an IPv4 literal; host names are not resolved.
    static func names(_ url: String, address: UInt32) -> Bool {
        guard let host = URLComponents(string: url)?.host else { return false }
        var literal = in_addr()
        return inet_pton(AF_INET, host, &literal) == 1 && literal.s_addr == address
    }
}

private final class SSDPReceiver: @unchecked Sendable {
    let messages: AsyncThrowingStream<SSDPPacket, Error>
    private let continuation: AsyncThrowingStream<SSDPPacket, Error>.Continuation
    private let source: DispatchSourceRead
    private let lock = NSLock()
    private var closed = false
    private let descriptor: Int32
    private let destination: sockaddr_in
    var isClosed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }

    init(options: DialDiscoveryScan.Options) throws {
        let descriptor = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard descriptor >= 0 else { throw ScanError.socket(errno) }
        var destination = sockaddr_in()
        do {
            guard fcntl(descriptor, F_SETFL, O_NONBLOCK) != -1 else { throw ScanError.socket(errno) }
            // Writes to a socket reclaimed while suspended raise SIGPIPE by default (TN2277).
            var noSigPipe: Int32 = 1
            guard setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe,
                socklen_t(MemoryLayout<Int32>.size)) == 0 else { throw ScanError.socket(errno) }
            var local = sockaddr_in()
            local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            local.sin_family = sa_family_t(AF_INET)
            let bound = withUnsafePointer(to: &local) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            guard bound == 0 else { throw ScanError.socket(errno) }
            if let interface = options.interfaceAddress {
                var address = in_addr()
                guard inet_pton(AF_INET, interface, &address) == 1 else { throw ScanError.invalidOptions }
                guard setsockopt(descriptor, IPPROTO_IP, IP_MULTICAST_IF, &address,
                    socklen_t(MemoryLayout<in_addr>.size)) == 0 else { throw ScanError.socket(errno) }
            }
            var ttl: UInt8 = 2
            guard setsockopt(descriptor, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, 1) == 0 else { throw ScanError.socket(errno) }
            destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            destination.sin_family = sa_family_t(AF_INET)
            destination.sin_port = options.port.bigEndian
            guard inet_pton(AF_INET, options.destination, &destination.sin_addr) == 1 else { throw ScanError.invalidOptions }
            guard SSDPReceiver.send(descriptor, destination) else { throw ScanError.socket(errno) }
        } catch {
            Darwin.close(descriptor)
            throw error
        }
        self.descriptor = descriptor
        self.destination = destination
        var streamContinuation: AsyncThrowingStream<SSDPPacket, Error>.Continuation!
        messages = AsyncThrowingStream(bufferingPolicy: .bufferingNewest(128)) { streamContinuation = $0 }
        continuation = streamContinuation
        source = DispatchSource.makeReadSource(fileDescriptor: descriptor,
                                               queue: DispatchQueue(label: "mediasync.discovery.udp"))
        let output = continuation
        source.setEventHandler {
            var buffer = [UInt8](repeating: 0, count: 65507)
            var sender = sockaddr_in()
            var senderLength = socklen_t(MemoryLayout<sockaddr_in>.size)
            let count = buffer.withUnsafeMutableBytes { bytes in
                withUnsafeMutablePointer(to: &sender) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        recvfrom(descriptor, bytes.baseAddress, bytes.count, 0, $0, &senderLength)
                    }
                }
            }
            if count >= 0 {
                output.yield(SSDPPacket(text: String(decoding: buffer.prefix(count), as: UTF8.self), source: sender.sin_addr.s_addr))
            } else if errno != EWOULDBLOCK && errno != EAGAIN && errno != EINTR {
                output.finish(throwing: ScanError.socket(errno))
            }
        }
        source.setCancelHandler { Darwin.close(descriptor) }
        source.resume()
    }

    private static func send(_ descriptor: Int32, _ destination: sockaddr_in) -> Bool {
        var target = destination
        let payload = Data(DialProtocol.searchMessage.utf8)
        let sent = payload.withUnsafeBytes { buffer in
            withUnsafePointer(to: &target) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    sendto(descriptor, buffer.baseAddress, buffer.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        return sent == payload.count
    }

    /// Retransmits the M-SEARCH; the lock guarantees the descriptor is still open.
    func resend() {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        _ = SSDPReceiver.send(descriptor, destination)
    }

    func close() {
        lock.lock()
        if closed { lock.unlock(); return }
        closed = true
        lock.unlock()
        continuation.finish()
        source.cancel()
    }

    deinit { close() }
}