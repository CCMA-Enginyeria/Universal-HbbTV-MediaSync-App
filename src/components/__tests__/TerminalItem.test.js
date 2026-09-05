import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockProbeRequests = [];
const mockConnections = [];

jest.mock('../../services/MediaSyncService', () => {
  const { EventEmitter: MockEventEmitter } = require('events');

  class MockMediaSyncService extends MockEventEmitter {
    probeTransportAvailability(mode, interDevSyncUrl, options = {}) {
      return new Promise((resolve) => {
        const request = { mode, interDevSyncUrl, options, resolve };
        mockProbeRequests.push(request);
        options.signal?.addEventListener?.('abort', () => resolve(false), { once: true });
      });
    }

    connect(interDevSyncUrl, options) {
      mockConnections.push({ interDevSyncUrl, options, service: this });
    }

    destroy() {
      this.removeAllListeners();
    }

    getMode() {
      return null;
    }
  }

  return {
    __esModule: true,
    MediaSyncService: MockMediaSyncService,
    default: MockMediaSyncService,
    SyncState: {
      DISCONNECTED: 'disconnected',
      CONNECTING_CII: 'connecting-cii',
      SYNCHRONIZED: 'synchronized',
    },
  };
});

jest.mock('../../utils/MediaSyncModePreferences', () => ({
  DEFAULT_MEDIA_SYNC_MODE: 'compat',
  MediaSyncMode: { NATIVE: 'native', COMPAT: 'compat' },
  getMediaSyncMode: jest.fn(),
  setMediaSyncMode: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

jest.mock('react-native-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props) => React.createElement(View, props);
});
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: (props) => React.createElement(View, props) };
});
jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props) => React.createElement(View, props);
});
jest.mock('../../services/MpdParserService', () => ({ parseMpd: jest.fn() }));
jest.mock('../../utils/webMetadata', () => ({
  fetchWebMetadata: jest.fn(() => Promise.resolve({ title: null, faviconUrl: null })),
}));
jest.mock('../../utils/CameraPermissions', () => ({
  requestCameraPermission: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'portrait-up' },
}));
jest.mock('../../utils/ForegroundSync', () => ({
  startForegroundSync: jest.fn(),
  stopForegroundSync: jest.fn(),
  addHeartbeatListener: jest.fn(() => ({ remove: jest.fn() })),
  addStopListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../../utils/CustomTabsMessaging', () => {
  const subscription = () => ({ remove: jest.fn() });
  return {
    addCustomTabChannelReadyListener: jest.fn(subscription),
    addCustomTabErrorListener: jest.fn(subscription),
    addCustomTabMessageListener: jest.fn(subscription),
    addCustomTabPageLoadedListener: jest.fn(subscription),
    addCustomTabHiddenListener: jest.fn(subscription),
    closeCustomTabSession: jest.fn(),
    isCustomTabsMessagingAvailable: true,
    openCustomTab: jest.fn(),
    postCustomTabMessage: jest.fn(),
  };
});

import { Platform } from 'react-native';
import { openCustomTab } from '../../utils/CustomTabsMessaging';
import { startForegroundSync } from '../../utils/ForegroundSync';

import TerminalItem from '../TerminalItem';
import {
  getMediaSyncMode,
  setMediaSyncMode,
} from '../../utils/MediaSyncModePreferences';

const createTerminal = ({ nativeUrl = 'ws://tv.local:7681/cii', app2appUrl = 'ws://tv.local:7681/app2app' } = {}) => ({
  getFriendlyName: () => 'Living room TV',
  hasMediaSyncCapability: () => !!nativeUrl || !!app2appUrl,
  getInterDevSyncURL: () => nativeUrl,
  getApp2AppURL: () => app2appUrl,
  getRealIP: () => '192.168.1.50',
  getModelIdentity: () => ({ manufacturer: 'Example', modelName: 'TV' }),
});

const renderExpanded = (terminal = createTerminal()) => render(
  <TerminalItem terminal={terminal} expanded onToggleExpand={jest.fn()} />
);

const resolveProbe = async (mode, available) => {
  const request = mockProbeRequests.find((entry) => entry.mode === mode);
  expect(request).toBeTruthy();
  await act(async () => {
    request.resolve(available);
  });
};

describe('TerminalItem MediaSync mode availability', () => {
  beforeEach(() => {
    mockProbeRequests.length = 0;
    mockConnections.length = 0;
    getMediaSyncMode.mockReset();
    getMediaSyncMode.mockResolvedValue('compat');
    setMediaSyncMode.mockClear();
  });

  it('hides the selector until a mode is confirmed, then shows only confirmed modes', async () => {
    renderExpanded();

    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));
    expect(screen.queryByText('discovery.modeTitle')).toBeNull();

    await resolveProbe('native', true);
    expect(screen.getByText('discovery.modeTitle')).toBeTruthy();
    expect(screen.getByText('discovery.modeNative')).toBeTruthy();
    expect(screen.queryByText('discovery.modeCompat')).toBeNull();
    expect(mockConnections).toHaveLength(0);

    await resolveProbe('compat', true);
    expect(screen.getByText('discovery.modeCompat')).toBeTruthy();
    await waitFor(() => expect(mockConnections.at(-1)?.options.mode).toBe('compat'));
  });

  it('falls back to native without overwriting an unavailable compatibility preference', async () => {
    renderExpanded();
    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));

    await resolveProbe('native', true);
    await resolveProbe('compat', false);

    await waitFor(() => expect(mockConnections.at(-1)?.options.mode).toBe('native'));
    expect(screen.getByText('discovery.modeNative')).toBeTruthy();
    expect(screen.queryByText('discovery.modeCompat')).toBeNull();
    expect(setMediaSyncMode).not.toHaveBeenCalled();
  });

  it('waits for the saved native preference when compatibility responds first', async () => {
    getMediaSyncMode.mockResolvedValue('native');
    renderExpanded();
    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));

    await resolveProbe('compat', true);
    expect(mockConnections).toHaveLength(0);

    await resolveProbe('native', true);
    await waitFor(() => expect(mockConnections.at(-1)?.options.mode).toBe('native'));
  });

  it('supports a compatibility-only terminal', async () => {
    renderExpanded(createTerminal({ nativeUrl: null }));
    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));

    await resolveProbe('native', false);
    await resolveProbe('compat', true);

    await waitFor(() => expect(mockConnections.at(-1)?.options.mode).toBe('compat'));
    expect(screen.getByText('discovery.modeCompat')).toBeTruthy();
    expect(screen.queryByText('discovery.modeNative')).toBeNull();
  });

  it('persists a manual selection and reconnects using it', async () => {
    renderExpanded();
    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));
    await resolveProbe('native', true);
    await resolveProbe('compat', true);
    await waitFor(() => expect(mockConnections.at(-1)?.options.mode).toBe('compat'));

    fireEvent.press(screen.getByText('discovery.modeNative'));

    await waitFor(() => expect(setMediaSyncMode).toHaveBeenCalledWith(expect.anything(), 'native'));
    await waitFor(() => expect(mockConnections.at(-1)?.options.mode).toBe('native'));
  });

  it('cancels both availability probes when unmounted', async () => {
    const view = renderExpanded();
    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));

    view.unmount();

    expect(mockProbeRequests.every((request) => request.options.signal.aborted)).toBe(true);
  });
});

describe('TerminalItem companion transport selection', () => {
  const originalPlatform = Platform.OS;

  const announceCompanionWeb = async (contentId) => {
    renderExpanded();
    await waitFor(() => expect(mockProbeRequests).toHaveLength(2));
    await resolveProbe('native', true);
    await resolveProbe('compat', true);
    await waitFor(() => expect(mockConnections).toHaveLength(1));

    await act(async () => {
      mockConnections.at(-1).service.emit('cii-change', { state: { contentId } });
    });
    const openButton = await screen.findByText('discovery.webOpen');
    await act(async () => {
      fireEvent.press(openButton);
    });
  };

  beforeEach(() => {
    mockProbeRequests.length = 0;
    mockConnections.length = 0;
    getMediaSyncMode.mockReset();
    getMediaSyncMode.mockResolvedValue('compat');
    openCustomTab.mockReset();
    startForegroundSync.mockClear();
    Platform.OS = 'android';
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('keeps a verified origin in the Custom Tab', async () => {
    openCustomTab.mockResolvedValue({ opened: true });

    await announceCompanionWeb('https://verified.example.com/webxr/index.html');

    expect(openCustomTab).toHaveBeenCalledWith(
      'https://verified.example.com/webxr/index.html',
      'https://verified.example.com'
    );
    expect(startForegroundSync).toHaveBeenCalled();
    expect(screen.queryByTestId('companion-web-modal')).toBeNull();
  });

  it('falls back to the WebView when Digital Asset Links validation fails', async () => {
    openCustomTab.mockResolvedValue({ opened: false, reason: 'DAL_FAILED' });

    await announceCompanionWeb('https://unverified.example.com/webxr/synctv.html');

    expect(openCustomTab).toHaveBeenCalledTimes(1);
    expect(startForegroundSync).not.toHaveBeenCalled();
    expect(screen.getByTestId('companion-web-modal')).toBeTruthy();
  });

  it('uses the WebView for insecure companion URLs without touching Custom Tabs', async () => {
    await announceCompanionWeb('http://insecure.example.com/webxr/synctv.html');

    expect(openCustomTab).not.toHaveBeenCalled();
    expect(screen.getByTestId('companion-web-modal')).toBeTruthy();
  });
});
