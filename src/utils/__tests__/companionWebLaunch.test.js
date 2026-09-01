import {
  buildCustomTabsSyncUrl,
  getCompanionOrigin,
  isExternalSyncWebContent,
} from '../companionWebLaunch';

describe('companion web launch', () => {
  it('only identifies the synchronized external entry point', () => {
    expect(isExternalSyncWebContent('https://example.com/webxr/synctv.html')).toBe(true);
    expect(isExternalSyncWebContent('https://example.com/webxr/SYNCTV.HTML?lang=ca')).toBe(true);
    expect(isExternalSyncWebContent('https://example.com/webxr/index.html')).toBe(false);
    expect(isExternalSyncWebContent('https://example.com/webxr/synctv.html.bak')).toBe(false);
  });

  it('preserves the companion URL state for a secure Custom Tabs launch', () => {
    const result = buildCustomTabsSyncUrl(
      'https://example.com/webxr/synctv.html?lang=ca#view'
    );

    const url = new URL(result);
    expect(url.searchParams.get('lang')).toBe('ca');
    expect(url.hash).toBe('#view');
  });

  it('returns the exact origin used by Digital Asset Links', () => {
    expect(getCompanionOrigin('https://example.com:8443/path/synctv.html')).toBe(
      'https://example.com:8443'
    );
  });

  it('rejects insecure Custom Tabs messaging URLs', () => {
    expect(() => buildCustomTabsSyncUrl('http://example.com/synctv.html')).toThrow(
      'Custom Tabs messaging requires an HTTPS companion URL.'
    );
  });
});