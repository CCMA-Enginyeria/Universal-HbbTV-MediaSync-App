import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_MEDIA_SYNC_MODE,
  MediaSyncMode,
  getMediaSyncMode,
  getMediaSyncModeStorageKey,
  setMediaSyncMode,
} from '../MediaSyncModePreferences';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const createTerminal = (manufacturer, modelName, deviceDescriptionUrl) => ({
  getModelIdentity: () => ({ manufacturer, modelName, deviceDescriptionUrl }),
});

describe('MediaSyncModePreferences', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('defaults to compatibility mode', async () => {
    const terminal = createTerminal('Example', 'Model 1', 'http://tv-1/device.xml');
    await expect(getMediaSyncMode(terminal)).resolves.toBe(DEFAULT_MEDIA_SYNC_MODE);
  });

  it('shares a preference between units of the same normalized model', async () => {
    const livingRoom = createTerminal(' Example ', 'Model  1', 'http://tv-1/device.xml');
    const bedroom = createTerminal('example', 'model 1', 'http://tv-2/device.xml');

    await setMediaSyncMode(livingRoom, MediaSyncMode.NATIVE);

    expect(getMediaSyncModeStorageKey(livingRoom)).toBe(getMediaSyncModeStorageKey(bedroom));
    await expect(getMediaSyncMode(bedroom)).resolves.toBe(MediaSyncMode.NATIVE);
  });

  it('keeps different models isolated', async () => {
    const firstModel = createTerminal('Example', 'Model 1', 'http://tv-1/device.xml');
    const secondModel = createTerminal('Example', 'Model 2', 'http://tv-2/device.xml');

    await setMediaSyncMode(firstModel, MediaSyncMode.NATIVE);

    await expect(getMediaSyncMode(secondModel)).resolves.toBe(MediaSyncMode.COMPAT);
  });

  it('falls back to device identity when model metadata is missing', () => {
    const first = createTerminal(null, null, 'http://tv-1/device.xml');
    const second = createTerminal(null, null, 'http://tv-2/device.xml');
    expect(getMediaSyncModeStorageKey(first)).not.toBe(getMediaSyncModeStorageKey(second));
  });

  it('rejects unsupported modes and ignores invalid stored values', async () => {
    const terminal = createTerminal('Example', 'Model 1', 'http://tv-1/device.xml');
    await AsyncStorage.setItem(getMediaSyncModeStorageKey(terminal), 'automatic');

    await expect(getMediaSyncMode(terminal)).resolves.toBe(MediaSyncMode.COMPAT);
    await expect(setMediaSyncMode(terminal, 'automatic')).rejects.toThrow('Invalid MediaSync mode');
  });
});