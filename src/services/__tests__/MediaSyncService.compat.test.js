/**
 * Tests for the App2App compatibility-mode transport selection in
 * MediaSyncService: URL building, compat-first ordering, and fallback.
 */

import { EventEmitter } from 'events';

// --- Mocks for the four DVB-CSS services -----------------------------------
// Each mock is an EventEmitter that records the URL it was constructed with, so
// the tests can assert which transport MediaSyncService attempted and drive the
// CSS-CII events (message / error) that trigger selection and fallback.

jest.mock('../CSSCIIService', () => {
  const { EventEmitter } = require('events');
  class MockCSSCIIService extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      this.destroyed = false;
      this.wcUrl = null;
      this.tsUrl = null;
      MockCSSCIIService.instances.push(this);
    }
    async connect() {}
    destroy() {
      this.destroyed = true;
    }
    getState() {
      return { contentId: null };
    }
    getContentId() {
      return null;
    }
    getTimelineSyncUrl() {
      return this.tsUrl;
    }
    getWallClockUrl() {
      return this.wcUrl;
    }
  }
  MockCSSCIIService.instances = [];
  return { __esModule: true, default: MockCSSCIIService };
});

jest.mock('../CSSWCService', () => {
  const { EventEmitter } = require('events');
  class MockCSSWCService extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
    }
    connect() {}
    destroy() {}
    isSynchronized() {
      return false;
    }
    getWallClock() {
      return {};
    }
    getStats() {
      return {};
    }
    sendRequest() {}
  }
  return { __esModule: true, default: MockCSSWCService };
});

jest.mock('../CSSWCServiceUDP', () => {
  const { EventEmitter } = require('events');
  class MockCSSWCServiceUDP extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
    }
    connect() {}
    destroy() {}
    isSynchronized() {
      return false;
    }
    getWallClock() {
      return {};
    }
    getStats() {
      return {};
    }
    sendRequest() {}
  }
  return {
    __esModule: true,
    default: MockCSSWCServiceUDP,
    parseWCUrl: () => ({ protocol: 'ws' }),
  };
});

jest.mock('../CSSTSService', () => {
  const { EventEmitter } = require('events');
  class MockCSSTSService extends EventEmitter {
    constructor(url, selector) {
      super();
      this.url = url;
      this.selector = selector;
    }
    connect() {}
    destroy() {}
    setWallClock() {}
    setTickRate() {}
    setStreamInfo() {}
    isTimelineAvailable() {
      return false;
    }
    getCurrentPosition() {
      return null;
    }
    getTimeline() {
      return { getSpeed: () => 0 };
    }
    getInfo() {
      return null;
    }
  }
  return { __esModule: true, default: MockCSSTSService };
});

// eslint-disable-next-line import/first
import MediaSyncService from '../MediaSyncService';
// eslint-disable-next-line import/first
import CSSCIIService from '../CSSCIIService';

const NATIVE_URL = 'ws://192.168.1.50:7681/cii';
const APP2APP_URL = 'ws://192.168.1.50:7681/app2app';
const COMPAT_CII_URL = 'ws://192.168.1.50:7681/app2app/hbbtv-sync-cii';
const COMPAT_WC_URL = 'ws://192.168.1.50:7681/app2app/hbbtv-sync-wc';
const COMPAT_TS_URL = 'ws://192.168.1.50:7681/app2app/hbbtv-sync-ts';

describe('MediaSyncService — App2App compatibility transport selection', () => {
  let services;

  const createService = () => {
    const service = new MediaSyncService();
    services.push(service);
    return service;
  };

  beforeEach(() => {
    CSSCIIService.instances.length = 0;
    services = [];
  });

  afterEach(() => {
    services.forEach((service) => service.disconnect());
    jest.useRealTimers();
  });

  describe('buildCompatCiiUrl', () => {
    it('appends the compat CSS-CII channel to the App2App base URL', () => {
      const svc = createService();
      svc.compatChannelPrefix = 'hbbtv-sync';
      expect(svc.buildCompatCiiUrl('ws://host:7681/app2app')).toBe(
        'ws://host:7681/app2app/hbbtv-sync-cii'
      );
      // Trailing slashes are normalized.
      expect(svc.buildCompatCiiUrl('ws://host:7681/remote/')).toBe(
        'ws://host:7681/remote/hbbtv-sync-cii'
      );
    });

    it('returns null when there is no App2App URL', () => {
      const svc = createService();
      expect(svc.buildCompatCiiUrl(null)).toBeNull();
      expect(svc.buildCompatCiiUrl('')).toBeNull();
    });
  });

  describe('wall-clock accuracy margins', () => {
    it('accepts lower wall-clock accuracy in compatibility mode', () => {
      const svc = createService();
      svc.mode = 'compat';

      expect(svc.getWcToleranceMs()).toBe(500);
    });

    it('keeps the strict wall-clock margin for native DVB-CSS', () => {
      const svc = createService();
      svc.mode = 'native';

      expect(svc.getWcToleranceMs()).toBe(100);
    });
  });

  describe('compat-first ordering', () => {
    it('tries the compat channel before native when App2App is available', async () => {
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL });

      expect(CSSCIIService.instances).toHaveLength(1);
      expect(CSSCIIService.instances[0].url).toBe(COMPAT_CII_URL);
      expect(svc.getMode()).toBe('compat');
    });

    it('keeps the compat transport once a CII message arrives (no native attempt)', async () => {
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL });

      const compatCii = CSSCIIService.instances[0];
      compatCii.wcUrl = COMPAT_WC_URL;
      compatCii.tsUrl = COMPAT_TS_URL;
      compatCii.emit('message', { contentId: 'x.mpd' });

      expect(svc.probing).toBe(false);
      // No second (native) CII service should have been created.
      expect(CSSCIIService.instances).toHaveLength(1);
      expect(svc.getMode()).toBe('compat');
    });

    it('rejects the whole compat session when WC or TS is not App2App compat', async () => {
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL });

      const compatCii = CSSCIIService.instances[0];
      compatCii.wcUrl = 'udp://192.168.1.50:6677';
      compatCii.tsUrl = COMPAT_TS_URL;
      compatCii.emit('wc-url', compatCii.wcUrl);

      expect(compatCii.destroyed).toBe(true);
      expect(CSSCIIService.instances).toHaveLength(2);
      expect(CSSCIIService.instances[1].url).toBe(NATIVE_URL);
      expect(svc.getMode()).toBe('native');
    });
  });

  describe('fallback to native', () => {
    it('falls back to native DVB-CSS when the compat channel errors', async () => {
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL });

      const compatCii = CSSCIIService.instances[0];
      expect(compatCii.url).toBe(COMPAT_CII_URL);

      // Compat channel fails before any CII message -> should advance to native.
      compatCii.emit('error', new Error('refused'));

      expect(compatCii.destroyed).toBe(true);
      expect(CSSCIIService.instances).toHaveLength(2);
      expect(CSSCIIService.instances[1].url).toBe(NATIVE_URL);
      expect(svc.getMode()).toBe('native');
    });

    it('falls back to native when the compat probe times out', async () => {
      jest.useFakeTimers();
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL, compatProbeTimeoutMs: 1000 });

      expect(CSSCIIService.instances[0].url).toBe(COMPAT_CII_URL);

      jest.advanceTimersByTime(1000);

      expect(CSSCIIService.instances).toHaveLength(2);
      expect(CSSCIIService.instances[1].url).toBe(NATIVE_URL);
      expect(svc.getMode()).toBe('native');
    });
  });

  describe('native-only (no App2App)', () => {
    it('uses the native URL directly without probing', async () => {
      const svc = createService();
      await svc.connect(NATIVE_URL, {});

      expect(CSSCIIService.instances).toHaveLength(1);
      expect(CSSCIIService.instances[0].url).toBe(NATIVE_URL);
      expect(svc.getMode()).toBe('native');
      expect(svc.probing).toBe(false);
    });

    it('errors when neither native nor App2App URLs are provided', async () => {
      const svc = createService();
      const onError = jest.fn();
      svc.on('error', onError);
      await svc.connect(null, {});

      expect(CSSCIIService.instances).toHaveLength(0);
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('strict transport mode', () => {
    it('uses only native DVB-CSS when native mode is requested', async () => {
      const svc = createService();
      const onError = jest.fn();
      svc.on('error', onError);
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL, mode: 'native' });

      expect(CSSCIIService.instances).toHaveLength(1);
      expect(CSSCIIService.instances[0].url).toBe(NATIVE_URL);
      expect(svc.getMode()).toBe('native');
      expect(svc.probing).toBe(false);

      CSSCIIService.instances[0].emit('error', new Error('native down'));
      expect(CSSCIIService.instances).toHaveLength(1);
      expect(onError).toHaveBeenCalled();
    });

    it('uses only App2App when compatibility mode is requested', async () => {
      jest.useFakeTimers();
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL, mode: 'compat' });

      expect(CSSCIIService.instances).toHaveLength(1);
      expect(CSSCIIService.instances[0].url).toBe(COMPAT_CII_URL);
      expect(svc.getMode()).toBe('compat');
      expect(svc.probing).toBe(false);

      jest.advanceTimersByTime(5000);
      expect(CSSCIIService.instances).toHaveLength(1);
    });

    it.each([
      ['native', null, APP2APP_URL],
      ['compat', NATIVE_URL, null],
    ])('errors when the URL required by %s mode is missing', async (mode, nativeUrl, app2appUrl) => {
      const svc = createService();
      const onError = jest.fn();
      svc.on('error', onError);

      await svc.connect(nativeUrl, { app2appUrl, mode });

      expect(CSSCIIService.instances).toHaveLength(0);
      expect(svc.state).toBe('error');
      expect(onError).toHaveBeenCalled();
    });

    it('rejects invalid mode values', async () => {
      const svc = createService();
      await expect(svc.connect(NATIVE_URL, { mode: 'automatic' })).rejects.toThrow(
        'Invalid MediaSync mode'
      );
    });
  });

  describe('preferCompat=false', () => {
    it('tries native first and falls back to compat on failure', async () => {
      const svc = createService();
      await svc.connect(NATIVE_URL, { app2appUrl: APP2APP_URL, preferCompat: false });

      expect(CSSCIIService.instances[0].url).toBe(NATIVE_URL);

      CSSCIIService.instances[0].emit('error', new Error('native down'));

      expect(CSSCIIService.instances).toHaveLength(2);
      expect(CSSCIIService.instances[1].url).toBe(COMPAT_CII_URL);
      expect(svc.getMode()).toBe('compat');
    });
  });
});
