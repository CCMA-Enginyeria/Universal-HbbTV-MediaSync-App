'use strict';

/**
 * CSS-CII (Content Identification & Information) WebSocket handler.
 *
 * When the mobile app connects to the InterDevSync URL (our /cii endpoint), it
 * expects a JSON message describing what the TV is presenting. See
 * src/services/CSSCIIService.js -> handleMessage for the exact fields consumed:
 *
 *   - contentId          : MUST contain ".mpd" — the app only loads the DASH
 *                          manifest when contentId includes ".mpd"
 *                          (src/components/TerminalItem.js).
 *   - wcUrl              : udp:// URL of the CSS-WC wall clock server.
 *   - tsUrl              : ws:// URL of the CSS-TS timeline server.
 *   - timelines          : advertised timeline options.
 *
 * A real TV pushes CII updates whenever state changes; for a static emulator we
 * simply send the full CII document once on connect (and could resend on
 * demand). That is enough to drive the app through WC + TS synchronization.
 */

/**
 * @param {object} opts
 * @param {string} opts.contentId  DASH MPD URL (must contain ".mpd").
 * @param {string} opts.wcUrl      udp://ip:port of the wall clock server.
 * @param {string} opts.tsUrl      ws://ip:port/ts of the timeline server.
 * @param {(msg: string) => void} [opts.log]
 * @returns {(ws: import('ws').WebSocket) => void} onConnection handler.
 */
function createCiiConnectionHandler({ contentId, wcUrl, tsUrl, log = console.log }) {
  const ciiDocument = {
    protocolVersion: '1.1',
    contentId,
    contentIdStatus: 'final',
    presentationStatus: ['okay'],
    mrsUrl: null,
    wcUrl,
    tsUrl,
    timelines: [
      {
        timelineSelector: 'urn:dvb:css:timeline:pts',
        timelineProperties: {
          unitsPerTick: 1,
          unitsPerSecond: 90000,
        },
      },
    ],
  };

  return function onConnection(ws) {
    log('[CII] client connected');

    try {
      ws.send(JSON.stringify(ciiDocument));
      log(`[CII] sent CII (contentId=${contentId})`);
    } catch (err) {
      log(`[CII] failed to send CII: ${err.message}`);
    }

    // A real CII channel is push-only from the TV; ignore anything the client
    // sends but keep the socket open.
    ws.on('message', () => {});
    ws.on('close', () => log('[CII] client disconnected'));
    ws.on('error', (err) => log(`[CII] socket error: ${err.message}`));
  };
}

module.exports = { createCiiConnectionHandler };
