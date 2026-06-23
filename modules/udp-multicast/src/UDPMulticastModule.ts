import { NativeModule, requireNativeModule } from "expo";

import { UDPMulticastModuleEvents } from "./UDPMulticast.types";

declare class UDPMulticastModule extends NativeModule<UDPMulticastModuleEvents> {
  /**
   * Create and bind a UDP socket.
   * @param socketId - Caller-generated unique socket identifier
   * @param port - Local port to bind to (0 for an ephemeral port)
   * @param address - Local address to bind to (e.g. "0.0.0.0")
   */
  createSocket(socketId: string, port: number, address: string): Promise<void>;

  /**
   * Send a datagram.
   * @param socketId - Socket identifier
   * @param data - Base64-encoded payload
   * @param port - Destination port
   * @param address - Destination IP address
   */
  send(socketId: string, data: string, port: number, address: string): Promise<void>;

  /**
   * Join a multicast group on the Wi-Fi interface.
   * @param socketId - Socket identifier
   * @param multicastAddress - Multicast group address (e.g. "239.255.255.250")
   */
  addMembership(socketId: string, multicastAddress: string): Promise<void>;

  /**
   * Close a socket and stop its receive loop.
   * @param socketId - Socket identifier
   */
  close(socketId: string): Promise<void>;
}

export default requireNativeModule<UDPMulticastModule>("UDPMulticast");
