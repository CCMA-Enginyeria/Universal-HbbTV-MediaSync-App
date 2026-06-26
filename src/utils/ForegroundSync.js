/**
 * Foreground Sync wrapper (Android only).
 *
 * Starts/stops a plain foreground service (notification WITHOUT playback
 * controls) so the DVB-CSS synchronization, WebSockets/UDP sockets and the
 * companion audio keep running while the app is in the background.
 *
 * On iOS this is a no-op: background execution there relies on the
 * `UIBackgroundModes: ['audio']` capability while audio is playing.
 */

import { Platform } from 'react-native';

let nativeModule = null;
try {
  // eslint-disable-next-line global-require
  nativeModule = require('../../modules/foreground-sync').default;
} catch (e) {
  console.warn('❌ ForegroundSync native module not available:', e?.message);
}

const isAvailable = Platform.OS === 'android' && nativeModule != null;

/**
 * Start (or update) the foreground service. Must be called while the app is in
 * the foreground (Android restriction).
 * @param {string} [title]
 * @param {string} [text]
 * @returns {boolean}
 */
export function startForegroundSync(title, text) {
  if (!isAvailable) return false;
  try {
    return nativeModule.start(title, text);
  } catch (e) {
    console.warn('startForegroundSync error:', e?.message);
    return false;
  }
}

/**
 * Stop the foreground service and remove its notification.
 * @returns {boolean}
 */
export function stopForegroundSync() {
  if (!isAvailable) return false;
  try {
    return nativeModule.stop();
  } catch (e) {
    console.warn('stopForegroundSync error:', e?.message);
    return false;
  }
}

/**
 * Subscribe to the native heartbeat emitted by the foreground service. The
 * heartbeat wakes the JS thread in the background (where React Native pauses
 * `setTimeout`), allowing reconnection logic to run while backgrounded.
 * @param {() => void} callback
 * @returns {{ remove: () => void }}
 */
export function addHeartbeatListener(callback) {
  if (!isAvailable) return { remove: () => {} };
  try {
    return nativeModule.addListener('onHeartbeat', callback);
  } catch (e) {
    console.warn('addHeartbeatListener error:', e?.message);
    return { remove: () => {} };
  }
}

export default { startForegroundSync, stopForegroundSync, addHeartbeatListener, isAvailable };
