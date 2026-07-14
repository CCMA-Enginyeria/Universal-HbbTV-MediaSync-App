import { fetchWebMetadata } from '../webMetadata';

describe('fetchWebMetadata', () => {
  const mockFetch = (html, { ok = true } = {}) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      text: jest.fn().mockResolvedValue(html),
    });
  };

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  it('extracts the <title> and resolves a relative favicon href', async () => {
    mockFetch(`
      <html><head>
        <title>My &amp; Companion Page</title>
        <link rel="icon" href="/assets/favicon.png">
      </head><body></body></html>
    `);

    const meta = await fetchWebMetadata('https://tv.example.com/app/companion.html');

    expect(meta.title).toBe('My & Companion Page');
    expect(meta.faviconUrl).toBe('https://tv.example.com/assets/favicon.png');
  });

  it('prefers og:title and apple-touch-icon over <title> and rel=icon', async () => {
    mockFetch(`
      <html><head>
        <title>Fallback Title</title>
        <meta property="og:title" content="Open Graph Title">
        <link rel="icon" href="/small.ico">
        <link rel="apple-touch-icon" href="https://cdn.example.com/big.png">
      </head></html>
    `);

    const meta = await fetchWebMetadata('https://example.com/page.html');

    expect(meta.title).toBe('Open Graph Title');
    expect(meta.faviconUrl).toBe('https://cdn.example.com/big.png');
  });

  it('falls back to /favicon.ico at the origin when no icon link exists', async () => {
    mockFetch('<html><head><title>No Icon</title></head></html>');

    const meta = await fetchWebMetadata('https://host.example.com/deep/path/page.html?x=1');

    expect(meta.title).toBe('No Icon');
    expect(meta.faviconUrl).toBe('https://host.example.com/favicon.ico');
  });

  it('returns nulls for non-http URLs without fetching', async () => {
    global.fetch = jest.fn();

    const meta = await fetchWebMetadata('ftp://nope');

    expect(meta).toEqual({ title: null, faviconUrl: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns nulls on a failed (non-ok) response', async () => {
    mockFetch('irrelevant', { ok: false });

    const meta = await fetchWebMetadata('https://example.com/x.html');

    expect(meta).toEqual({ title: null, faviconUrl: null });
  });

  it('returns nulls (and does not throw) when fetch rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const meta = await fetchWebMetadata('https://example.com/x.html');

    expect(meta).toEqual({ title: null, faviconUrl: null });
  });
});
