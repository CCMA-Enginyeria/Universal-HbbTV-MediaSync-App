import ExpoModulesCore
import Foundation
import Darwin

/**
 * Native iOS UDP module for DIAL/SSDP multicast discovery and DVB-CSS wall-clock sync.
 *
 * Uses BSD/POSIX sockets directly (rather than Network.framework) so we can pin
 * outgoing multicast to the Wi-Fi interface (en0) via `IP_MULTICAST_IF`, which is
 * required for SSDP M-SEARCH to reach HbbTV terminals on the local network.
 *
 * Requires the `com.apple.developer.networking.multicast` entitlement on a physical
 * device (paid Apple Developer Program).
 */
public class UDPMulticastModule: Module {

  // socketId -> file descriptor
  private var sockets: [String: Int32] = [:]
  // socketId -> running flag for the receive loop
  private var running: [String: Bool] = [:]
  private let lock = NSLock()
  private let recvQueue = DispatchQueue(label: "cat.ccma.dialapp.udp.recv", attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("UDPMulticast")

    Events("onMessage", "onError", "onBound")

    AsyncFunction("createSocket") { (socketId: String, port: Int, address: String, promise: Promise) in
      self.createSocket(socketId: socketId, port: port, address: address, promise: promise)
    }

    AsyncFunction("send") { (socketId: String, data: String, port: Int, address: String, promise: Promise) in
      self.send(socketId: socketId, base64: data, port: port, address: address, promise: promise)
    }

    AsyncFunction("addMembership") { (socketId: String, multicastAddress: String, promise: Promise) in
      self.addMembership(socketId: socketId, multicastAddress: multicastAddress, promise: promise)
    }

    AsyncFunction("close") { (socketId: String, promise: Promise) in
      self.closeSocket(socketId: socketId)
      promise.resolve(nil)
    }

    OnDestroy {
      self.closeAll()
    }
  }

  // MARK: - Socket lifecycle

  private func createSocket(socketId: String, port: Int, address: String, promise: Promise) {
    let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
    guard fd >= 0 else {
      promise.reject("E_SOCKET", "Failed to create socket (errno \(errno))")
      return
    }

    // Allow multiple sockets to bind the same port (needed for SSDP 1900).
    var reuse: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
    setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &reuse, socklen_t(MemoryLayout<Int32>.size))

    // Bind to the requested local port (0 => ephemeral).
    var bindAddr = sockaddr_in()
    bindAddr.sin_family = sa_family_t(AF_INET)
    bindAddr.sin_port = in_port_t(UInt16(truncatingIfNeeded: port)).bigEndian
    if address.isEmpty || address == "0.0.0.0" {
      bindAddr.sin_addr.s_addr = INADDR_ANY
    } else {
      inet_pton(AF_INET, address, &bindAddr.sin_addr)
    }

    let bindResult = withUnsafePointer(to: &bindAddr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bindResult == 0 else {
      let err = errno
      Darwin.close(fd)
      promise.reject("E_BIND", "Failed to bind socket (errno \(err))")
      return
    }

    // Pin outgoing multicast to the Wi-Fi interface so M-SEARCH leaves the device.
    if let wifiIP = getWiFiAddress() {
      var localInterface = in_addr()
      inet_pton(AF_INET, wifiIP, &localInterface)
      setsockopt(fd, IPPROTO_IP, IP_MULTICAST_IF, &localInterface, socklen_t(MemoryLayout<in_addr>.size))

      var ttl: UInt8 = 128
      setsockopt(fd, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, socklen_t(MemoryLayout<UInt8>.size))

      var loop: UInt8 = 1
      setsockopt(fd, IPPROTO_IP, IP_MULTICAST_LOOP, &loop, socklen_t(MemoryLayout<UInt8>.size))
    }

    // Resolve the actual bound port.
    var localAddr = sockaddr_in()
    var localLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    let boundPort: Int = withUnsafeMutablePointer(to: &localAddr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
        if getsockname(fd, saPtr, &localLen) == 0 {
          return Int(UInt16(bigEndian: localAddr.sin_port))
        }
        return port
      }
    }

    lock.lock()
    sockets[socketId] = fd
    running[socketId] = true
    lock.unlock()

    startReceiveLoop(socketId: socketId, fd: fd)

    sendEvent("onBound", [
      "socketId": socketId,
      "port": boundPort,
      "address": getWiFiAddress() ?? "0.0.0.0"
    ])

    promise.resolve(nil)
  }

  private func closeSocket(socketId: String) {
    lock.lock()
    let fd = sockets[socketId]
    running[socketId] = false
    sockets.removeValue(forKey: socketId)
    running.removeValue(forKey: socketId)
    lock.unlock()

    if let fd = fd {
      Darwin.close(fd)
    }
  }

  private func closeAll() {
    lock.lock()
    let ids = Array(sockets.keys)
    lock.unlock()
    for id in ids {
      closeSocket(socketId: id)
    }
  }

  // MARK: - Send

  private func send(socketId: String, base64: String, port: Int, address: String, promise: Promise) {
    lock.lock()
    let fd = sockets[socketId]
    lock.unlock()

    guard let fd = fd else {
      promise.reject("E_NO_SOCKET", "Socket \(socketId) not found")
      return
    }

    guard let data = Data(base64Encoded: base64) else {
      promise.reject("E_DECODE", "Invalid base64 payload")
      return
    }

    var destAddr = sockaddr_in()
    destAddr.sin_family = sa_family_t(AF_INET)
    destAddr.sin_port = in_port_t(UInt16(truncatingIfNeeded: port)).bigEndian
    inet_pton(AF_INET, address, &destAddr.sin_addr)

    let sent = data.withUnsafeBytes { (rawBuffer: UnsafeRawBufferPointer) -> Int in
      withUnsafePointer(to: &destAddr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
          sendto(fd, rawBuffer.baseAddress, data.count, 0, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }

    if sent < 0 {
      promise.reject("E_SEND", "sendto failed (errno \(errno))")
    } else {
      promise.resolve(nil)
    }
  }

  // MARK: - Multicast membership

  private func addMembership(socketId: String, multicastAddress: String, promise: Promise) {
    lock.lock()
    let fd = sockets[socketId]
    lock.unlock()

    guard let fd = fd else {
      promise.reject("E_NO_SOCKET", "Socket \(socketId) not found")
      return
    }

    var mreq = ip_mreq()
    inet_pton(AF_INET, multicastAddress, &mreq.imr_multiaddr)
    if let wifiIP = getWiFiAddress() {
      inet_pton(AF_INET, wifiIP, &mreq.imr_interface)
    } else {
      mreq.imr_interface.s_addr = INADDR_ANY
    }

    let result = setsockopt(fd, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, socklen_t(MemoryLayout<ip_mreq>.size))
    if result < 0 {
      promise.reject("E_MEMBERSHIP", "IP_ADD_MEMBERSHIP failed (errno \(errno))")
    } else {
      promise.resolve(nil)
    }
  }

  // MARK: - Receive loop

  private func startReceiveLoop(socketId: String, fd: Int32) {
    recvQueue.async { [weak self] in
      guard let self = self else { return }
      var buffer = [UInt8](repeating: 0, count: 65536)

      while self.isRunning(socketId) {
        var senderAddr = sockaddr_in()
        var senderLen = socklen_t(MemoryLayout<sockaddr_in>.size)

        let n = withUnsafeMutablePointer(to: &senderAddr) {
          $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            recvfrom(fd, &buffer, buffer.count, 0, saPtr, &senderLen)
          }
        }

        if n > 0 {
          let payload = Data(bytes: buffer, count: n)
          let b64 = payload.base64EncodedString()

          var ipBuffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
          inet_ntop(AF_INET, &senderAddr.sin_addr, &ipBuffer, socklen_t(INET_ADDRSTRLEN))
          let senderIP = String(cString: ipBuffer)
          let senderPort = Int(UInt16(bigEndian: senderAddr.sin_port))

          self.sendEvent("onMessage", [
            "socketId": socketId,
            "data": b64,
            "address": senderIP,
            "port": senderPort,
            "size": n
          ])
        } else if n < 0 {
          // Socket closed or fatal error: exit the loop.
          if self.isRunning(socketId) {
            self.sendEvent("onError", [
              "socketId": socketId,
              "error": "recvfrom failed (errno \(errno))"
            ])
          }
          break
        }
      }
    }
  }

  private func isRunning(_ socketId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return running[socketId] ?? false
  }

  // MARK: - Helpers

  /// Returns the IPv4 address of the Wi-Fi interface (en0), if available.
  private func getWiFiAddress() -> String? {
    var address: String?
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else {
      return nil
    }
    defer { freeifaddrs(ifaddr) }

    for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
      let interface = ptr.pointee
      let addrFamily = interface.ifa_addr.pointee.sa_family
      if addrFamily == UInt8(AF_INET) {
        let name = String(cString: interface.ifa_name)
        if name == "en0" {
          var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
          getnameinfo(
            interface.ifa_addr,
            socklen_t(interface.ifa_addr.pointee.sa_len),
            &hostname,
            socklen_t(hostname.count),
            nil,
            0,
            NI_NUMERICHOST
          )
          address = String(cString: hostname)
        }
      }
    }
    return address
  }
}
