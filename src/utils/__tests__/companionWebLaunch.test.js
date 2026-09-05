import { canAttemptCustomTab, getCompanionOrigin } from '../companionWebLaunch';

describe('companion web launch', () => {
  it('returns the exact origin used by Digital Asset Links', () => {
    expect(getCompanionOrigin('https://example.com:8443/path/synctv.html')).toBe(
      'https://example.com:8443'
    );
    expect(getCompanionOrigin('https://example.com/webxr/index.html?lang=ca#view')).toBe(
      'https://example.com'
    );
  });

  it('returns no origin for URLs that cannot back a verified channel', () => {
    expect(getCompanionOrigin('http://example.com/synctv.html')).toBeNull();
    expect(getCompanionOrigin('not a url')).toBeNull();
    expect(getCompanionOrigin(undefined)).toBeNull();
  });

  it('only attempts Custom Tabs for secure companion URLs', () => {
    expect(canAttemptCustomTab('https://example.com/webxr/index.html')).toBe(true);
    expect(canAttemptCustomTab('http://example.com/webxr/synctv.html')).toBe(false);
    expect(canAttemptCustomTab(null)).toBe(false);
  });
});