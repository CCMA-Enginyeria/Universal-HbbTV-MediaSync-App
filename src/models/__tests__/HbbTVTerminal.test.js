import { HbbTVTerminal } from '../HbbTVTerminal';

describe('HbbTVTerminal', () => {
  function createTerminal(overrides = {}) {
    return new HbbTVTerminal(
      {
        deviceDescriptionUrl: 'http://192.168.1.10/device.xml',
        applicationUrl: 'http://192.168.1.10/apps',
        friendlyName: 'Living Room TV',
        manufacturer: 'Example',
        modelName: 'HbbTV-1',
        ...overrides.dialDevice,
      },
      {
        additionalData: {
          X_HbbTV_App2AppURL: 'ws://0.0.0.0:8001/app2app',
          X_HbbTV_InterDevSyncURL: 'udp://:6677',
          X_HbbTV_UserAgent: 'HbbTV UA',
          ...overrides.additionalData,
        },
      },
    );
  }

  it('uses DIAL and app info fields to expose terminal details', () => {
    const terminal = createTerminal();

    expect(terminal.getFriendlyName()).toBe('Living Room TV');
    expect(terminal.getAppLaunchURL()).toBe('http://192.168.1.10/apps/HbbTV');
    expect(terminal.getApp2AppURL()).toBe('ws://0.0.0.0:8001/app2app');
    expect(terminal.getInterDevSyncURL()).toBe('udp://:6677');
    expect(terminal.getUserAgent()).toBe('HbbTV UA');
    expect(terminal.hasMediaSyncCapability()).toBe(true);
  });

  it('falls back to safe defaults for missing DIAL data', () => {
    const terminal = new HbbTVTerminal(null, null);

    expect(terminal.getFriendlyName()).toBe('Terminal desconegut');
    expect(terminal.getAppLaunchURL()).toBeNull();
    expect(terminal.hasMediaSyncCapability()).toBe(false);
    expect(terminal.toJSON()).toMatchObject({
      friendlyName: 'Terminal desconegut',
      appLaunchURL: null,
      app2AppURL: null,
      interDevSyncURL: null,
      userAgent: null,
    });
  });

  it('detects and replaces invalid host placeholders', () => {
    expect(HbbTVTerminal.hasInvalidIP('ws://0.0.0.0:8001')).toBe(true);
    expect(HbbTVTerminal.hasInvalidIP('ws://localhost:8001')).toBe(true);
    expect(HbbTVTerminal.hasInvalidIP('ws://127.0.0.1:8001')).toBe(true);
    expect(HbbTVTerminal.hasInvalidIP('ws://:8001')).toBe(true);
    expect(HbbTVTerminal.hasInvalidIP('ws://192.168.1.10:8001')).toBe(false);

    expect(HbbTVTerminal.replaceInvalidIP('ws://0.0.0.0:8001', '192.168.1.20')).toBe('ws://192.168.1.20:8001');
    expect(HbbTVTerminal.replaceInvalidIP('ws://:8001', '192.168.1.20')).toBe('ws://192.168.1.20:8001');
  });

  it('applies a real IP to invalid App2App and InterDevSync URLs', () => {
    const terminal = createTerminal();

    terminal.setRealIP('192.168.1.20');

    expect(terminal.getApp2AppURL()).toBe('ws://192.168.1.20:8001/app2app');
    expect(terminal.getInterDevSyncURL()).toBe('udp://192.168.1.20:6677');
    expect(terminal.hasAnyInvalidIP()).toBe(false);
  });

  it('updates lastSeen without changing discoveredAt', () => {
    const terminal = createTerminal();
    const discoveredAt = terminal.discoveredAt;
    terminal.lastSeen = new Date('2020-01-01T00:00:00Z');

    terminal.updateLastSeen();

    expect(terminal.discoveredAt).toBe(discoveredAt);
    expect(terminal.lastSeen.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
  });
});