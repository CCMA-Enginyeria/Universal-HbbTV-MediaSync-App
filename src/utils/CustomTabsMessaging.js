/** Android-only wrapper for the verified Custom Tabs postMessage channel. */

import { Platform } from 'react-native';

let nativeModule = null;
try {
  // eslint-disable-next-line global-require
  nativeModule = require('../../modules/custom-tabs-messaging').default;
} catch (error) {
  console.warn('CustomTabsMessaging native module not available:', error?.message);
}

export const isCustomTabsMessagingAvailable = Platform.OS === 'android' && nativeModule != null;

export const openCustomTab = async (url, origin) => {
  if (!isCustomTabsMessagingAvailable) return { opened: false, reason: 'UNAVAILABLE' };
  return nativeModule.open(url, origin);
};

export const postCustomTabMessage = (message) => {
  if (!isCustomTabsMessagingAvailable) return -1;
  return nativeModule.postMessage(message);
};

export const closeCustomTabSession = () => {
  if (!isCustomTabsMessagingAvailable) return;
  nativeModule.close();
};

const addListener = (eventName, callback) => {
  if (!isCustomTabsMessagingAvailable) return { remove: () => {} };
  return nativeModule.addListener(eventName, callback);
};

export const addCustomTabChannelReadyListener = (callback) => addListener('onChannelReady', callback);
export const addCustomTabErrorListener = (callback) => addListener('onChannelError', callback);
export const addCustomTabMessageListener = (callback) => addListener('onMessage', callback);
export const addCustomTabPageLoadedListener = (callback) => addListener('onPageLoaded', callback);
export const addCustomTabHiddenListener = (callback) => addListener('onTabHidden', callback);

export default {
  openCustomTab,
  postCustomTabMessage,
  closeCustomTabSession,
  addCustomTabChannelReadyListener,
  addCustomTabErrorListener,
  addCustomTabMessageListener,
  addCustomTabPageLoadedListener,
  addCustomTabHiddenListener,
  isAvailable: isCustomTabsMessagingAvailable,
};