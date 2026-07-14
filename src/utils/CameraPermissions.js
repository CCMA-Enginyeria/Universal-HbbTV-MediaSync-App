/**
 * Camera permission helper.
 *
 * Wraps `expo-camera`'s imperative permission API so the companion web page
 * rendered in the in-app WebView (second device) can access the camera via
 * `getUserMedia()`. The OS permission is requested on-demand — only when the
 * page actually asks for the camera — never at app launch.
 *
 * On web there is no runtime permission model here (the browser handles it), so
 * the request resolves to `true`.
 */

import { Platform } from 'react-native';
import * as Camera from 'expo-camera';

/**
 * Request the camera permission, showing the OS dialog if it has not been
 * decided yet. Returns `true` when access is granted.
 * @returns {Promise<boolean>}
 */
export const requestCameraPermission = async () => {
  if (Platform.OS === 'web') return true;
  try {
    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.error('❌ Camera permission request failed:', e?.message);
    return false;
  }
};

/**
 * Check the current camera permission without prompting the user.
 * @returns {Promise<boolean>}
 */
export const checkCameraPermission = async () => {
  if (Platform.OS === 'web') return true;
  try {
    const { status } = await Camera.getCameraPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    return false;
  }
};
