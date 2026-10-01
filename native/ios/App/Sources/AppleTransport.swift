import Darwin
import Foundation
import MediaSyncCore

/// Monotonic clock shared by the session and the socket receive timestamps.
func monotonicNanos() -> Int64 { Int64(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) }

/**
 * Core `Transport` over URLSessionWebSocketTask and connected BSD UDP sockets.
 * Must be used on the main thread; all events are delivered on the main queue
 * and events for tokens that are no longer registered are dropped.
 */
final class AppleTransport: NSObject, Transport, URLSessionWebSocketDelegate {
    private lazy var session = URLSession(configuration: {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return configuration
    }(), delegate: self, delegateQueue: .main)
    private var sockets: [Int64: URLSessionWebSocketTask] = [:]
    private var tasks: [Int: Int64] = [:]
    private var datagrams: [Int64: UdpChannel] = [:]
    private var listeners: [Int64: TransportEvents] = [:]
    private var timers: [Int64: DispatchWorkItem] = [:]
    private let diagnostics: Diagnostics

    init(diagnostics: Diagnostics) {
        self.diagnostics = diagnostics
    }

    var openResources: Int { sockets.count + datagrams.count }

    func openWebSocket(_ token: Int64, url: String, events: TransportEvents) {
        dispatchPrecondition(condition: .onQueue(.main))
        listeners[token] = events
        guard let target = URL(string: url) else {
            DispatchQueue.main.async { self.finish(token, failed: true) }
            return
        }
        var request = URLRequest(url: target)
        request.setValue("MediaSyncNative/1.0", forHTTPHeaderField: "User-Agent")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 262_144
        sockets[token] = task
        tasks[task.taskIdentifier] = token
        diagnostics.log("transport", "ws.open", ["token": token])
        task.resume()
        receive(token, task)
    }

    private func receive(_ token: Int64, _ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self, self.sockets[token] === task else { return }
                switch result {
                case .success(.string(let text)):
                    self.listeners[token]?.onText(token, text)
                    if self.sockets[token] === task { self.receive(token, task) }
                case .success:
                    self.receive(token, task)
                case .failure:
                    self.finish(token, failed: true)
                }
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard let token = tasks[webSocketTask.taskIdentifier], sockets[token] === webSocketTask else { return }
        listeners[token]?.onOpened(token)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard let token = tasks[webSocketTask.taskIdentifier] else { return }
        finish(token, failed: false)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let token = tasks[task.taskIdentifier] else { return }
        if error != nil { diagnostics.log("transport", "ws.failure", ["token": token]) }
        finish(token, failed: error != nil)
    }

    func openUdp(_ token: Int64, host: String, port: Int, events: TransportEvents) {
        dispatchPrecondition(condition: .onQueue(.main))
        listeners[token] = events
        datagrams[token] = UdpChannel(host: host, port: port,
            onOpen: { [weak self] in self?.deliver(token) { $0.onOpened(token) } },
            onDatagram: { [weak self] data, at in self?.deliver(token) { $0.onDatagram(token, data, receivedAtNanos: at) } },
            onFailure: { [weak self] in
                DispatchQueue.main.async {
                    self?.diagnostics.log("transport", "udp.failure", ["token": token])
                    self?.finish(token, failed: true)
                }
            })
    }

    private func deliver(_ token: Int64, _ block: @escaping (TransportEvents) -> Void) {
        DispatchQueue.main.async { [weak self] in
            if let events = self?.listeners[token] { block(events) }
        }
    }

    func sendText(_ token: Int64, _ text: String) -> Bool {
        guard let task = sockets[token] else { return false }
        task.send(.string(text)) { _ in }
        return true
    }

    func sendDatagram(_ token: Int64, _ data: Data) -> Bool { datagrams[token]?.send(data) ?? false }

    func close(_ token: Int64) {
        dispatchPrecondition(condition: .onQueue(.main))
        listeners.removeValue(forKey: token)
        if let task = sockets.removeValue(forKey: token) {
            tasks.removeValue(forKey: task.taskIdentifier)
            task.cancel(with: .normalClosure, reason: nil)
        }
        datagrams.removeValue(forKey: token)?.close()
    }

    func schedule(_ token: Int64, delayMs: Int64, events: TransportEvents) {
        let item = DispatchWorkItem { [weak self] in
            guard self?.timers.removeValue(forKey: token) != nil else { return }
            events.onTimer(token)
        }
        timers[token] = item
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(delayMs)), execute: item)
    }

    func cancel(_ token: Int64) { timers.removeValue(forKey: token)?.cancel() }

    private func finish(_ token: Int64, failed: Bool) {
        var removed = false
        if let task = sockets.removeValue(forKey: token) {
            tasks.removeValue(forKey: task.taskIdentifier)
            removed = true
        }
        if let channel = datagrams.removeValue(forKey: token) {
            channel.close()
            removed = true
        }
        let events = listeners.removeValue(forKey: token)
        if removed { events?.onClosed(token, failed: failed) }
    }
}

/// Connected UDP socket: only datagrams from the TV's address and port are delivered.
private final class UdpChannel {
    private let queue = DispatchQueue(label: "mediasync.udp")
    private var descriptor: Int32 = -1
    private var source: DispatchSourceRead?
    private var closed = false

    init(host: String, port: Int, onOpen: @escaping () -> Void, onDatagram: @escaping (Data, Int64) -> Void, onFailure: @escaping () -> Void) {
        queue.async { [self] in
            var hints = addrinfo(ai_flags: 0, ai_family: AF_INET, ai_socktype: SOCK_DGRAM, ai_protocol: IPPROTO_UDP,
                                 ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
            var result: UnsafeMutablePointer<addrinfo>?
            guard !closed, getaddrinfo(host, String(port), &hints, &result) == 0, let address = result else { return onFailure() }
            defer { freeaddrinfo(result) }
            let socket = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            guard socket >= 0 else { return onFailure() }
            // Writes to a socket reclaimed while suspended raise SIGPIPE by default (TN2277).
            var noSigPipe: Int32 = 1
            guard setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size)) == 0,
                  fcntl(socket, F_SETFL, O_NONBLOCK) != -1, connect(socket, address.pointee.ai_addr, address.pointee.ai_addrlen) == 0 else {
                Darwin.close(socket)
                return onFailure()
            }
            descriptor = socket
            let read = DispatchSource.makeReadSource(fileDescriptor: socket, queue: queue)
            read.setEventHandler {
                var buffer = [UInt8](repeating: 0, count: 2048)
                let count = buffer.withUnsafeMutableBytes { recv(socket, $0.baseAddress, $0.count, 0) }
                let receivedAt = monotonicNanos()
                if count >= 0 {
                    onDatagram(Data(buffer.prefix(count)), receivedAt)
                } else if errno != EWOULDBLOCK && errno != EAGAIN && errno != EINTR {
                    onFailure()
                }
            }
            read.setCancelHandler { Darwin.close(socket) }
            source = read
            read.resume()
            onOpen()
        }
    }

    func send(_ data: Data) -> Bool {
        queue.async { [self] in
            guard !closed, descriptor >= 0 else { return }
            _ = data.withUnsafeBytes { Darwin.send(descriptor, $0.baseAddress, $0.count, 0) }
        }
        return true
    }

    func close() {
        queue.async { [self] in
            closed = true
            source?.cancel()
            source = nil
            descriptor = -1
        }
    }
}
