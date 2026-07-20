import ExpoModulesCore
import Foundation
import Darwin

/**
 * Native iOS UDP module for DVB-CSS Wall Clock (CSS-WC) synchronization.
 *
 * Mirrors the Android `UDPWallClockModule` (Kotlin) API so the shared JavaScript
 * wrapper (`src/utils/NativeUDPWallClock.js`) works identically on both platforms:
 * numeric socket ids and hex-encoded payloads.
 *
 * Uses plain BSD/POSIX unicast UDP sockets (no multicast membership), so unlike
 * the `udp-multicast` module it does NOT require the
 * `com.apple.developer.networking.multicast` entitlement.
 */
public class UDPWallClockModule: Module {

  // socketId -> file descriptor
  private var sockets: [Int: Int32] = [:]
  // socketId -> running flag for the receive loop
  private var running: [Int: Bool] = [:]
  private var socketCounter = 0
  private let lock = NSLock()
  private let recvQueue = DispatchQueue(label: "cat.ccma.dialapp.udpwallclock.recv", attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("UDPWallClock")

    Events("onMessage")

    // Create a new UDP socket, returns the numeric socket id.
    AsyncFunction("create") { (promise: Promise) in
      let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
      guard fd >= 0 else {
        promise.reject("CREATE_ERROR", "Failed to create socket (errno \(errno))")
        return
      }

      var reuse: Int32 = 1
      setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

      self.lock.lock()
      self.socketCounter += 1
      let socketId = self.socketCounter
      self.sockets[socketId] = fd
      self.lock.unlock()

      promise.resolve(socketId)
    }

    // Bind the socket to a local port (0 => ephemeral) and start the receive loop.
    AsyncFunction("bind") { (socketId: Int, port: Int, promise: Promise) in
      self.lock.lock()
      let fd = self.sockets[socketId]
      self.lock.unlock()

      guard let fd = fd else {
        promise.reject("SOCKET_NOT_FOUND", "Socket \(socketId) not found")
        return
      }

      var bindAddr = sockaddr_in()
      bindAddr.sin_family = sa_family_t(AF_INET)
      bindAddr.sin_port = in_port_t(UInt16(truncatingIfNeeded: port)).bigEndian
      bindAddr.sin_addr.s_addr = INADDR_ANY

      let bindResult = withUnsafePointer(to: &bindAddr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
      guard bindResult == 0 else {
        promise.reject("BIND_ERROR", "Failed to bind socket (errno \(errno))")
        return
      }

      // Resolve the actual bound port.
      var localAddr = sockaddr_in()
      var localLen = socklen_t(MemoryLayout<sockaddr_in>.size)
      let getNameResult = withUnsafeMutablePointer(to: &localAddr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
          getsockname(fd, saPtr, &localLen)
        }
      }
      let boundPort: Int = getNameResult == 0 ? Int(UInt16(bigEndian: localAddr.sin_port)) : port

      self.lock.lock()
      self.running[socketId] = true
      self.lock.unlock()

      self.startReceiveLoop(socketId: socketId, fd: fd)

      promise.resolve(boundPort)
    }

    // Send hex-encoded data to a remote unicast address.
    AsyncFunction("send") { (socketId: Int, hexData: String, address: String, port: Int, promise: Promise) in
      self.lock.lock()
      let fd = self.sockets[socketId]
      self.lock.unlock()

      guard let fd = fd else {
        promise.reject("SOCKET_NOT_FOUND", "Socket \(socketId) not found")
        return
      }

      guard let data = self.dataFromHexString(hexData) else {
        promise.reject("SEND_ERROR", "Invalid hex payload")
        return
      }

      var destAddr = sockaddr_in()
      destAddr.sin_family = sa_family_t(AF_INET)
      destAddr.sin_port = in_port_t(UInt16(truncatingIfNeeded: port)).bigEndian
      inet_pton(AF_INET, address, &destAddr.sin_addr)

      self.recvQueue.async {
        let sent = data.withUnsafeBytes { (rawBuffer: UnsafeRawBufferPointer) -> Int in
          withUnsafePointer(to: &destAddr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
              sendto(fd, rawBuffer.baseAddress, data.count, 0, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
          }
        }
        if sent < 0 {
          promise.reject("SEND_ERROR", "sendto failed (errno \(errno))")
        } else {
          promise.resolve(true)
        }
      }
    }

    // Close the socket and stop its receive loop.
    AsyncFunction("close") { (socketId: Int, promise: Promise) in
      self.closeSocket(socketId: socketId)
      promise.resolve(true)
    }

    // Return diagnostic info about the socket.
    AsyncFunction("getSocketInfo") { (socketId: Int, promise: Promise) in
      self.lock.lock()
      let fd = self.sockets[socketId]
      let isBound = self.running[socketId] ?? false
      self.lock.unlock()

      guard let fd = fd else {
        promise.reject("SOCKET_NOT_FOUND", "Socket \(socketId) not found")
        return
      }

      var localAddr = sockaddr_in()
      var localLen = socklen_t(MemoryLayout<sockaddr_in>.size)
      let getNameResult = withUnsafeMutablePointer(to: &localAddr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
          getsockname(fd, saPtr, &localLen)
        }
      }

      var localPort = 0
      var localAddress = "0.0.0.0"
      if getNameResult == 0 {
        localPort = Int(UInt16(bigEndian: localAddr.sin_port))
        var ipBuffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        inet_ntop(AF_INET, &localAddr.sin_addr, &ipBuffer, socklen_t(INET_ADDRSTRLEN))
        localAddress = String(cString: ipBuffer)
      }

      promise.resolve([
        "localPort": localPort,
        "localAddress": localAddress,
        "isBound": isBound,
        "isClosed": false
      ])
    }

    OnDestroy {
      self.closeAll()
    }
  }

  // MARK: - Socket lifecycle

  private func closeSocket(socketId: Int) {
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

  // MARK: - Receive loop

  private func startReceiveLoop(socketId: Int, fd: Int32) {
    recvQueue.async { [weak self] in
      guard let self = self else { return }
      // DVB-CSS WC packets are 32 bytes; use a larger buffer to be safe.
      var buffer = [UInt8](repeating: 0, count: 2048)

      while self.isRunning(socketId) {
        var senderAddr = sockaddr_in()
        var senderLen = socklen_t(MemoryLayout<sockaddr_in>.size)

        let n = withUnsafeMutablePointer(to: &senderAddr) {
          $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            recvfrom(fd, &buffer, buffer.count, 0, saPtr, &senderLen)
          }
        }

        if n > 0 {
          let hex = self.hexStringFromBytes(buffer, count: n)

          var ipBuffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
          inet_ntop(AF_INET, &senderAddr.sin_addr, &ipBuffer, socklen_t(INET_ADDRSTRLEN))
          let senderIP = String(cString: ipBuffer)
          let senderPort = Int(UInt16(bigEndian: senderAddr.sin_port))

          self.sendEvent("onMessage", [
            "socketId": socketId,
            "data": hex,
            "address": senderIP,
            "port": senderPort
          ])
        } else if n <= 0 {
          // Socket closed or fatal error: exit the loop.
          break
        }
      }
    }
  }

  private func isRunning(_ socketId: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return running[socketId] ?? false
  }

  // MARK: - Hex helpers (match the Android module: uppercase hex)

  private func hexStringFromBytes(_ bytes: [UInt8], count: Int) -> String {
    let hexDigits = Array("0123456789ABCDEF")
    var chars = [Character]()
    chars.reserveCapacity(count * 2)
    for i in 0..<count {
      let v = Int(bytes[i])
      chars.append(hexDigits[(v >> 4) & 0x0F])
      chars.append(hexDigits[v & 0x0F])
    }
    return String(chars)
  }

  private func dataFromHexString(_ hex: String) -> Data? {
    let chars = Array(hex)
    guard chars.count % 2 == 0 else { return nil }
    var data = Data(capacity: chars.count / 2)
    var i = 0
    while i < chars.count {
      guard let hi = chars[i].hexDigitValue, let lo = chars[i + 1].hexDigitValue else {
        return nil
      }
      data.append(UInt8((hi << 4) | lo))
      i += 2
    }
    return data
  }
}
