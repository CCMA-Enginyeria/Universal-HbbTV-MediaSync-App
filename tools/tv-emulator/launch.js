'use strict';

/**
 * Builds the URL a standalone HbbTV application must be opened with so it can
 * run on this emulator: the FOKUS polyfill and hbbtv-mediasync-compat.js read
 * `#port=…&hostname=…` to find the App2App `/local/` and `/remote/` endpoints.
 * Returns null for anything that is not an absolute http(s) URL, so the route
 * cannot be abused as an open redirect to other schemes.
 */
function buildLaunchUrl(target, { ip, port }) {
  let url;
  try { url = new URL(target); } catch (e) { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = `port=${port}&hostname=${ip}`;
  return url.href;
}

/**
 * `GET /launch?url=<HbbTV app>` switches the emulator to App2App compatibility
 * mode and redirects the browser to the app, which then acts as the TV.
 */
function createLaunchHandler({ tvState, ip, port, log = console.log }) {
  return function handleLaunch(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'GET' || requestUrl.pathname !== '/launch') return false;

    const location = buildLaunchUrl(requestUrl.searchParams.get('url') || '', { ip, port });
    if (!location) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Expected /launch?url=<absolute http(s) URL of the HbbTV application>');
      return true;
    }

    tvState.update({ mode: 'compat' });
    log('[LAUNCH] external HbbTV app in compat mode');
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
    return true;
  };
}

module.exports = { buildLaunchUrl, createLaunchHandler };
