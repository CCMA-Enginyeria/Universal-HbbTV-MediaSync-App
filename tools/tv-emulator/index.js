'use strict';

/**
 * HbbTV MediaSync — TV Emulator
 * =============================
 *
 * A self-contained Node.js program that pretends to be a television running an
 * HbbTV application with DVB-CSS inter-device MediaSync enabled. It lets the
 * mobile app discover and synchronize end-to-end WITHOUT a real TV.
 *
 * It emulates the full stack the app expects:
 *   - SSDP / DIAL discovery      (ssdp.js + httpServer.js)
 *   - CSS-CII content info        (cii.js, WebSocket /cii)
 *   - CSS-WC wall clock           (wc.js, UDP)
 *   - CSS-TS timeline sync        (ts.js, WebSocket /ts)
 *
 * Usage:
 *   npm install          # once, to fetch the "ws" dependency
 *   npm start            # or: node index.js
 *
 * Options (environment variables):
 *   EMU_IP         Force the LAN IPv4 to advertise (default: auto-detected)
 *   EMU_HTTP_PORT  HTTP + WebSocket port           (default: 7681)
 *   EMU_WC_PORT    UDP wall clock port             (default: 6677)
 *   EMU_CONTENT_ID DASH MPD URL to announce        (default: Big Buck Bunny)
 *   EMU_NAME       Friendly name shown in the app  (default: "Emulated HbbTV TV (MediaSync)")
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { getLocalIPv4 } = require('./net');
const { startSsdpResponder } = require('./ssdp');
const { createDialHttpServer } = require('./httpServer');
const { createCiiConnectionHandler } = require('./cii');
const { startWallClockServer } = require('./wc');
const { createTsConnectionHandler } = require('./ts');
const { createApp2AppBroker } = require('./app2appBroker');
const { TvState } = require('./tvState');
const { createTvUiHandler } = require('./tvUi');

const IP = getLocalIPv4(process.env.EMU_IP);
const HTTP_PORT = parseInt(process.env.EMU_HTTP_PORT || '7681', 10);
const WC_PORT = parseInt(process.env.EMU_WC_PORT || '6677', 10);
const FRIENDLY_NAME = process.env.EMU_NAME || 'Emulated HbbTV TV (MediaSync)';
const INITIAL_MODE = process.env.EMU_MODE === 'compat' ? 'compat' : 'native';
// contentId MUST contain ".mpd" — the app only loads the DASH manifest then.
const CONTENT_ID =
  process.env.EMU_CONTENT_ID ||
  'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd';

const UUID = crypto.randomUUID();

const LOCATION = `http://${IP}:${HTTP_PORT}/dd.xml`;
const CII_URL = `ws://${IP}:${HTTP_PORT}/cii`;
const TS_URL = `ws://${IP}:${HTTP_PORT}/ts`;
const APP2APP_URL = `ws://${IP}:${HTTP_PORT}/app2app`;
const WC_URL = `udp://${IP}:${WC_PORT}`;

// App2App compatibility-mode channels. These mirror the native DVB-CSS trio but
// run entirely over App2App WebSockets, so a companion can synchronise even
// when native DVB-CSS is unavailable. Channel names follow the `hbbtv-sync`
// prefix used by www/hbbtv-compat/hbbtv-mediasync-compat.js and the mobile
// MediaSyncService compat client.
const COMPAT_PREFIX = process.env.EMU_COMPAT_PREFIX || 'hbbtv-sync';
const COMPAT_CII_PATH = `/app2app/${COMPAT_PREFIX}-cii`;
const COMPAT_WC_PATH = `/app2app/${COMPAT_PREFIX}-wc`;
const COMPAT_TS_PATH = `/app2app/${COMPAT_PREFIX}-ts`;
const COMPAT_CII_URL = `ws://${IP}:${HTTP_PORT}${COMPAT_CII_PATH}`;
const COMPAT_WC_URL = `ws://${IP}:${HTTP_PORT}${COMPAT_WC_PATH}`;
const COMPAT_TS_URL = `ws://${IP}:${HTTP_PORT}${COMPAT_TS_PATH}`;

const CONTENT_CATALOG = [
  {
    title: 'Big Buck Bunny',
    description: 'Akamai DASH reference stream',
    contentId: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    poster: '/tv/fallback.jpg',
  },
  {
    title: 'Envivio reference',
    description: 'Multi-bitrate DASH test stream',
    contentId: 'https://dash.akamaized.net/envivio/EnvivioDash3/manifest.mpd',
    poster: '/tv/fallback.jpg',
  },
  {
    title: 'DASH-IF test card',
    description: 'AVC adaptation-set test stream',
    contentId: 'https://dash.akamaized.net/dash264/TestCases/1a/netflix/exMPD_BIP_TC1.mpd',
    poster: '/tv/fallback.jpg',
  },
];

if (!CONTENT_CATALOG.some((item) => item.contentId === CONTENT_ID)) {
  CONTENT_CATALOG.unshift({
    title: 'Configured content',
    description: 'Loaded from EMU_CONTENT_ID',
    contentId: CONTENT_ID,
  });
}

const tvState = new TvState({ contentId: CONTENT_ID, mode: INITIAL_MODE });

function log(msg) {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`${ts} ${msg}`);
}

// --- HTTP + DIAL ------------------------------------------------------------
// --- WebSocket endpoints (share the HTTP server, routed by path) ------------
const ciiWss = new WebSocketServer({ noServer: true });
const tsWss = new WebSocketServer({ noServer: true });
const app2appWss = new WebSocketServer({ noServer: true });

const onCiiConnection = createCiiConnectionHandler({
  tvState,
  wcUrl: WC_URL,
  tsUrl: TS_URL,
  log,
});
const onTsConnection = createTsConnectionHandler({ tvState, log });

ciiWss.on('connection', onCiiConnection);
tsWss.on('connection', onTsConnection);

const app2appBroker = createApp2AppBroker({
  localPrefix: '/app2app-local',
  remotePrefix: '/app2app',
  log,
});

// App2App is only required so the app recognizes us as an HbbTV device; we
// accept the connection and keep it idle.
app2appWss.on('connection', (ws) => {
  log('[APP2APP] client connected (kept idle)');
  ws.on('message', () => {});
  ws.on('close', () => log('[APP2APP] client disconnected'));
  ws.on('error', () => {});
});

const getConnections = () => {
  const mode = tvState.getSnapshot().mode;
  return mode === 'compat'
    ? {
      cii: app2appBroker.getRemoteConnectionCount(`${COMPAT_PREFIX}-cii`),
      wc: app2appBroker.getRemoteConnectionCount(`${COMPAT_PREFIX}-wc`),
      ts: app2appBroker.getRemoteConnectionCount(`${COMPAT_PREFIX}-ts`),
    }
    : { cii: ciiWss.clients.size, wc: Date.now() - nativeWcLastSeen < 3000 ? 1 : 0, ts: tsWss.clients.size };
};

let nativeWcLastSeen = 0;
const onUnhandled = createTvUiHandler({ tvState, catalog: CONTENT_CATALOG, getConnections, log });
const httpServer = createDialHttpServer({
  ip: IP,
  port: HTTP_PORT,
  uuid: UUID,
  friendlyName: FRIENDLY_NAME,
  ciiUrl: CII_URL,
  app2appUrl: APP2APP_URL,
  onUnhandled,
  log,
});

httpServer.on('upgrade', (req, socket, head) => {
  const path = (req.url || '/').split('?')[0];
  const mode = tvState.getSnapshot().mode;
  if (mode === 'native' && path === '/cii') {
    ciiWss.handleUpgrade(req, socket, head, (ws) => ciiWss.emit('connection', ws, req));
  } else if (mode === 'native' && path === '/ts') {
    tsWss.handleUpgrade(req, socket, head, (ws) => tsWss.emit('connection', ws, req));
  } else if ((mode === 'compat' || path.startsWith('/app2app-local/')) &&
             app2appBroker.route(path, req, socket, head)) {
    return;
  } else if (path === '/app2app') {
    app2appWss.handleUpgrade(req, socket, head, (ws) => app2appWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

httpServer.listen(HTTP_PORT, () => {
  log(`[HTTP] DIAL + WebSocket server listening on http://${IP}:${HTTP_PORT}`);
});

// --- CSS-WC (UDP) -----------------------------------------------------------
const wcSocket = startWallClockServer({
  port: WC_PORT,
  onRequest: () => { nativeWcLastSeen = Date.now(); },
  log,
});

tvState.on('change', (snapshot) => {
  const staleServers = snapshot.mode === 'compat'
    ? [ciiWss, tsWss]
    : [];
  staleServers.forEach((server) => {
    server.clients.forEach((client) => client.close(1012, 'TV emulator mode changed'));
  });
  if (snapshot.mode !== 'compat') app2appBroker.closeRemote();
});

// --- SSDP (UDP multicast) ---------------------------------------------------
const ssdpSocket = startSsdpResponder({ ip: IP, location: LOCATION, uuid: UUID, log });

// --- Banner -----------------------------------------------------------------
console.log('');
console.log('==================================================================');
console.log('  HbbTV MediaSync — TV Emulator');
console.log('==================================================================');
console.log(`  Friendly name : ${FRIENDLY_NAME}`);
console.log(`  LAN address   : ${IP}`);
console.log(`  TV screen     : http://${IP}:${HTTP_PORT}/tv`);
console.log(`  Initial mode  : ${INITIAL_MODE}`);
console.log(`  Device desc.  : ${LOCATION}`);
console.log(`  CSS-CII       : ${CII_URL}`);
console.log(`  CSS-WC        : ${WC_URL}`);
console.log(`  CSS-TS        : ${TS_URL}`);
console.log(`  Compat CII    : ${COMPAT_CII_URL}`);
console.log(`  Compat WC     : ${COMPAT_WC_URL}`);
console.log(`  Compat TS     : ${COMPAT_TS_URL}`);
console.log(`  Content ID    : ${CONTENT_ID}`);
console.log('------------------------------------------------------------------');
console.log('  Make sure your phone is on the SAME Wi-Fi network.');
console.log('  Then open the app and scan for TVs.  Press Ctrl+C to stop.');
console.log('==================================================================');
console.log('');

// --- Graceful shutdown ------------------------------------------------------
function shutdown() {
  log('Shutting down...');
  try { ssdpSocket.close(); } catch (_) {}
  try { wcSocket.close(); } catch (_) {}
  try { httpServer.close(); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
