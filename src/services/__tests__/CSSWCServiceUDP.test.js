import { CorrelatedClock, parseWCUrl } from '../CSSWCServiceUDP';

jest.mock('../../utils/NativeUDPMulticast', () => ({
  createSocket: jest.fn(),
}));

jest.mock('../../utils/NativeUDPWallClock', () => ({
  createSocket: jest.fn(),
  isModuleAvailable: jest.fn(() => false),
}));

describe('CSSWCServiceUDP utilities', () => {
  describe('parseWCUrl', () => {
    it('parses UDP and WebSocket-style wall-clock URLs', () => {
      expect(parseWCUrl('udp://192.168.1.10:6678')).toEqual({ protocol: 'udp', host: '192.168.1.10', port: 6678 });
      expect(parseWCUrl('ws://example.test:7681/wc')).toEqual({ protocol: 'ws', host: 'example.test', port: 7681 });
      expect(parseWCUrl('wss://clock.example.test/path')).toEqual({ protocol: 'wss', host: 'clock.example.test', port: 6677 });
      expect(parseWCUrl('192.168.1.10:6677')).toEqual({ protocol: 'udp', host: '192.168.1.10', port: 6677 });
    });

    it('returns null for empty input', () => {
      expect(parseWCUrl('')).toBeNull();
      expect(parseWCUrl(null)).toBeNull();
    });
  });

  describe('CorrelatedClock', () => {
    let originalPerformance;

    beforeEach(() => {
      originalPerformance = global.performance;
      Object.defineProperty(global, 'performance', {
        configurable: true,
        value: { now: jest.fn(() => 1500) },
      });
    });

    afterEach(() => {
      Object.defineProperty(global, 'performance', {
        configurable: true,
        value: originalPerformance,
      });
    });

    it('maps local time to correlated wall-clock time', () => {
      const clock = new CorrelatedClock();
      clock.setCorrelation(1000000000, 5000000000, 25000000);

      expect(clock.now()).toBe(5500000000);
      expect(clock.nowSeconds()).toBe(5.5);
      expect(clock.nowMillis()).toBe(5500);
      expect(clock.getDispersionMillis()).toBe(25);
      expect(clock.isSynchronized()).toBe(true);
      expect(clock.getInfo()).toMatchObject({
        wallClockNanos: 5500000000,
        wallClockSeconds: 5.5,
        dispersionMs: 25,
        isSynchronized: true,
      });
    });

    it('reports unsynchronized state before a correlation is set', () => {
      const clock = new CorrelatedClock();

      expect(clock.getDispersionMillis()).toBe(Infinity);
      expect(clock.isSynchronized()).toBe(false);
    });
  });
});