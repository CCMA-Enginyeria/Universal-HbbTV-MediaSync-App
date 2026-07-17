/**
 * Sync bridge server wrapper (Android only).
 *
 * Thin wrapper over the native `WsBridge` Expo module: a loopback WebSocket
 * server used to relay DVB-CSS synchronization to a companion page that runs
 * OUTSIDE the in-app WebView (e.g. in a Chrome Custom Tab, where WebXR works
 * but there is no `injectJavaScript` bridge).
 *
 * The app stays the sync authority (it performs the UDP wall-clock and CSS-TS,
 * which a browser cannot) and forwards the computed positions over this socket.
 *
 * On iOS this is a no-op: Custom Tabs / WebXR relaying is Android-only for now.
 */

import { Platform } from 'react-native';

let nativeModule = null;
try {
  // eslint-disable-next-line global-require
  nativeModule = require('../../modules/ws-bridge').default;
} catch (e) {
  console.warn('❌ WsBridge native module not available:', e?.message);
}

const isAvailable = Platform.OS === 'android' && nativeModule != null;

/**
 * Start the loopback WebSocket server. Pass `0` (default) for an ephemeral
 * port. Resolves with the actual bound port, or `0` if unavailable/failed.
 * @param {number} [port]
 * @returns {Promise<number>}
 */
export async function startSyncBridge(port = 0) {
  if (!isAvailable) return 0;
  try {
    return await nativeModule.start(port);
  } catch (e) {
    console.warn('startSyncBridge error:', e?.message);
    return 0;
  }
}

/**
 * Broadcast a sync payload to every connected client. Objects are serialized to
 * JSON; strings are sent as-is.
 * @param {object|string} message
 * @returns {boolean}
 */
export function sendSyncBridge(message) {
  if (!isAvailable) return false;
  try {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    return nativeModule.send(text);
  } catch (e) {
    console.warn('sendSyncBridge error:', e?.message);
    return false;
  }
}

/**
 * Stop the server and close all client connections.
 * @returns {boolean}
 */
export function stopSyncBridge() {
  if (!isAvailable) return false;
  try {
    return nativeModule.stop();
  } catch (e) {
    console.warn('stopSyncBridge error:', e?.message);
    return false;
  }
}

/**
 * Whether the server is currently running.
 * @returns {boolean}
 */
export function isSyncBridgeRunning() {
  if (!isAvailable) return false;
  try {
    return nativeModule.isRunning();
  } catch (e) {
    return false;
  }
}

export default {
  startSyncBridge,
  sendSyncBridge,
  stopSyncBridge,
  isSyncBridgeRunning,
  isAvailable,
};
