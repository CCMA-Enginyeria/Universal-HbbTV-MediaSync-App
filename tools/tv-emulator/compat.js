'use strict';

const { wallClockNanos } = require('./clock');

/**
 * App2App Compatibility Mode — CSS-WC over WebSocket.
 *
 * The real DVB-CSS wall clock uses a binary UDP protocol. The App2App
 * compatibility mode (see hbbtv-compat/hbbtv-mediasync-compat.js and
 * src/services/CSSWCService.js) instead exchanges JSON over a WebSocket:
 *
 *   client -> { v:0, t:0, p, mfe, id, ot }      (request)
 *   server -> { v:0, t:1, p, mfe, id, ot, rt, tt } (response)
 *
 * where `rt` (receive) and `tt` (transmit) are the server wall clock in
 * nanoseconds, using the SAME base as the CSS-TS control timestamps so the app
 * can correlate the media timeline accurately.
 *
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log]
 * @returns {(ws: import('ws').WebSocket) => void} onConnection handler.
 */
function createCompatWcConnectionHandler({ log = console.log } = {}) {
  return function onConnection(ws) {
    log('[COMPAT-WC] client connected');

    ws.on('message', (data) => {
      let request;
      try {
        request = JSON.parse(data.toString());
      } catch (err) {
        log('[COMPAT-WC] ignoring non-JSON request');
        return;
      }

      // Only respond to wall-clock requests (type 0).
      if (request.t !== 0) return;

      const now = wallClockNanos();
      const response = {
        v: 0,
        t: 1, // response
        p: request.p,
        mfe: request.mfe,
        id: request.id,
        ot: request.ot,
        rt: now,
        tt: now,
      };

      try {
        ws.send(JSON.stringify(response));
      } catch (err) {
        log(`[COMPAT-WC] failed to send response: ${err.message}`);
      }
    });

    ws.on('close', () => log('[COMPAT-WC] client disconnected'));
    ws.on('error', (err) => log(`[COMPAT-WC] socket error: ${err.message}`));
  };
}

module.exports = { createCompatWcConnectionHandler };
