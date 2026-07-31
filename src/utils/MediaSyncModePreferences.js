import AsyncStorage from '@react-native-async-storage/async-storage';

export const MediaSyncMode = Object.freeze({
  NATIVE: 'native',
  COMPAT: 'compat',
});

export const DEFAULT_MEDIA_SYNC_MODE = MediaSyncMode.COMPAT;

const STORAGE_PREFIX = '@universal-mediasync/mode/v1';

const normalizePart = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
};

export const getMediaSyncModeStorageKey = (terminal) => {
  const identity = terminal?.getModelIdentity?.() || {};
  const manufacturer = normalizePart(identity.manufacturer);
  const modelName = normalizePart(identity.modelName);

  if (manufacturer || modelName) {
    return `${STORAGE_PREFIX}/model/${encodeURIComponent(manufacturer)}/${encodeURIComponent(modelName)}`;
  }

  const deviceIdentity = normalizePart(identity.deviceDescriptionUrl);
  return `${STORAGE_PREFIX}/device/${encodeURIComponent(deviceIdentity || 'unknown')}`;
};

export const isMediaSyncMode = (mode) =>
  mode === MediaSyncMode.NATIVE || mode === MediaSyncMode.COMPAT;

export const getMediaSyncMode = async (terminal) => {
  const storedMode = await AsyncStorage.getItem(getMediaSyncModeStorageKey(terminal));
  return isMediaSyncMode(storedMode) ? storedMode : DEFAULT_MEDIA_SYNC_MODE;
};

export const setMediaSyncMode = async (terminal, mode) => {
  if (!isMediaSyncMode(mode)) {
    throw new Error(`Invalid MediaSync mode: ${mode}`);
  }
  await AsyncStorage.setItem(getMediaSyncModeStorageKey(terminal), mode);
};