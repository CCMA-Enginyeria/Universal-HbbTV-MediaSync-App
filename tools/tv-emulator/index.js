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

const IP = getLocalIPv4(process.env.EMU_IP);
const HTTP_PORT = parseInt(process.env.EMU_HTTP_PORT || '7681', 10);
const WC_PORT = parseInt(process.env.EMU_WC_PORT || '6677', 10);
const FRIENDLY_NAME = process.env.EMU_NAME || 'Emulated HbbTV TV (MediaSync)';
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

function log(msg) {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`${ts} ${msg}`);
}

// --- HTTP + DIAL ------------------------------------------------------------
const httpServer = createDialHttpServer({
  ip: IP,
  port: HTTP_PORT,
  uuid: UUID,
  friendlyName: FRIENDLY_NAME,
  ciiUrl: CII_URL,
  app2appUrl: APP2APP_URL,
  log,
});

// --- WebSocket endpoints (share the HTTP server, routed by path) ------------
const ciiWss = new WebSocketServer({ noServer: true });
const tsWss = new WebSocketServer({ noServer: true });
const app2appWss = new WebSocketServer({ noServer: true });

const onCiiConnection = createCiiConnectionHandler({
  contentId: CONTENT_ID,
  wcUrl: WC_URL,
  tsUrl: TS_URL,
  log,
});
const onTsConnection = createTsConnectionHandler({ log });

ciiWss.on('connection', onCiiConnection);
tsWss.on('connection', onTsConnection);
// App2App is only required so the app recognizes us as an HbbTV device; we
// accept the connection and keep it idle.
app2appWss.on('connection', (ws) => {
  log('[APP2APP] client connected (kept idle)');
  ws.on('message', () => {});
  ws.on('close', () => log('[APP2APP] client disconnected'));
  ws.on('error', () => {});
});

httpServer.on('upgrade', (req, socket, head) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/cii') {
    ciiWss.handleUpgrade(req, socket, head, (ws) => ciiWss.emit('connection', ws, req));
  } else if (path === '/ts') {
    tsWss.handleUpgrade(req, socket, head, (ws) => tsWss.emit('connection', ws, req));
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
const wcSocket = startWallClockServer({ port: WC_PORT, log });

// --- SSDP (UDP multicast) ---------------------------------------------------
const ssdpSocket = startSsdpResponder({ ip: IP, location: LOCATION, uuid: UUID, log });

// --- Banner -----------------------------------------------------------------
console.log('');
console.log('==================================================================');
console.log('  HbbTV MediaSync — TV Emulator');
console.log('==================================================================');
console.log(`  Friendly name : ${FRIENDLY_NAME}`);
console.log(`  LAN address   : ${IP}`);
console.log(`  Device desc.  : ${LOCATION}`);
console.log(`  CSS-CII       : ${CII_URL}`);
console.log(`  CSS-WC        : ${WC_URL}`);
console.log(`  CSS-TS        : ${TS_URL}`);
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
