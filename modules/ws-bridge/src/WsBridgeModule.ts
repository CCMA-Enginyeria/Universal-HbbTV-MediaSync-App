import { NativeModule, requireNativeModule } from "expo";

declare class WsBridgeModule extends NativeModule {
  /**
   * Start a loopback WebSocket server bound to 127.0.0.1. Pass `0` to let the
   * OS pick an ephemeral port. Resolves with the actual bound port, which the
   * caller passes to the companion page as `?syncBridge=ws://127.0.0.1:<port>`.
   *
   * Loopback-only binding is intentional: it keeps the bridge unreachable from
   * other devices and lets an HTTPS page open a plain `ws://` connection
   * without mixed-content blocking.
   */
  start(port: number): Promise<number>;

  /**
   * Broadcast a text message to every connected client. The last broadcast is
   * cached and re-sent to any client that connects afterwards, so a freshly
   * opened page immediately receives the current sync state.
   */
  send(message: string): boolean;

  /**
   * Stop the server and close all client connections.
   */
  stop(): boolean;

  /**
   * Whether the server is currently running.
   */
  isRunning(): boolean;
}

export default requireNativeModule<WsBridgeModule>("WsBridge");
