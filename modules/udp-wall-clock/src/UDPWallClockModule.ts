import { NativeModule, requireNativeModule } from "expo";
import { UDPWallClockModuleEvents, SocketInfo } from "./UDPWallClock.types";

declare class UDPWallClockModule extends NativeModule<UDPWallClockModuleEvents> {
  /**
   * Create a new UDP socket
   * @returns Promise with the socket ID
   */
  create(): Promise<number>;

  /**
   * Bind socket to a port
   * @param socketId - Socket ID returned by create()
   * @param port - Port to bind to (0 for random port)
   * @returns Promise with the actual bound port
   */
  bind(socketId: number, port: number): Promise<number>;

  /**
   * Send data to remote address
   * @param socketId - Socket ID
   * @param hexData - Data as hex string
   * @param address - Remote IP address
   * @param port - Remote port
   * @returns Promise<boolean>
   */
  send(socketId: number, hexData: string, address: string, port: number): Promise<boolean>;

  /**
   * Close socket
   * @param socketId - Socket ID to close
   * @returns Promise<boolean>
   */
  close(socketId: number): Promise<boolean>;

  /**
   * Get socket info
   * @param socketId - Socket ID
   * @returns Promise with socket information
   */
  getSocketInfo(socketId: number): Promise<SocketInfo>;
}

export default requireNativeModule<UDPWallClockModule>("UDPWallClock");
