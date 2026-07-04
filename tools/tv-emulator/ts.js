'use strict';

const { wallClockNanos } = require('./clock');

/**
 * CSS-TS (Timeline Synchronisation) WebSocket handler.
 *
 * Protocol (see src/services/CSSTSService.js):
 *   - The app connects and sends a "setup" message: { timelineSelector }.
 *   - The TV replies with "Control Timestamps":
 *       { contentTime, wallClockTime, timelineSpeedMultiplier }
 *     mapping a point on the media timeline (contentTime, in timeline ticks) to
 *     a point on the wall clock (wallClockTime, in nanoseconds), plus the play
 *     speed. A `timelineSpeedMultiplier: null` means the timeline is
 *     unavailable.
 *
 * We model a PTS timeline (90 kHz) that started at wall clock 0 and plays at
 * speed 1.0. `wallClockTime` uses the SAME base as the CSS-WC server, so the
 * app can convert positions accurately. We resend the control timestamp
 * periodically as a keep-alive.
 */

const PTS_TICK_RATE = 90000; // ticks per second
const RESEND_INTERVAL_MS = 2000;

/**
 * Build a control timestamp for the PTS timeline at the current wall clock.
 * contentTime advances 1:1 with the wall clock (speed 1.0) from an origin of 0.
 * @returns {{ contentTime: number, wallClockTime: number, timelineSpeedMultiplier: number }}
 */
function buildPtsControlTimestamp() {
  const wallNanos = wallClockNanos();
  const contentTime = Math.round((wallNanos * PTS_TICK_RATE) / 1e9);
  return {
    contentTime,
    wallClockTime: wallNanos,
    timelineSpeedMultiplier: 1.0,
  };
}

/**
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log]
 * @returns {(ws: import('ws').WebSocket) => void} onConnection handler.
 */
function createTsConnectionHandler({ log = console.log } = {}) {
  return function onConnection(ws) {
    log('[TS] client connected');
    let timer = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const sendControlTimestamp = () => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(buildPtsControlTimestamp()));
      } catch (err) {
        log(`[TS] failed to send control timestamp: ${err.message}`);
      }
    };

    ws.on('message', (data) => {
      let setup;
      try {
        setup = JSON.parse(data.toString());
      } catch (err) {
        log(`[TS] ignoring non-JSON setup message`);
        return;
      }

      const selector = setup.timelineSelector;
      log(`[TS] setup received (timelineSelector=${selector})`);

      if (selector === 'urn:dvb:css:timeline:pts') {
        // Send an immediate control timestamp, then keep it fresh.
        sendControlTimestamp();
        stop();
        timer = setInterval(sendControlTimestamp, RESEND_INTERVAL_MS);
      } else {
        // We only expose a PTS timeline; report anything else as unavailable.
        log(`[TS] unknown timeline "${selector}" -> reporting unavailable`);
        try {
          ws.send(JSON.stringify({ timelineSpeedMultiplier: null }));
        } catch (err) {
          log(`[TS] failed to send unavailable: ${err.message}`);
        }
      }
    });

    ws.on('close', () => {
      stop();
      log('[TS] client disconnected');
    });
    ws.on('error', (err) => {
      stop();
      log(`[TS] socket error: ${err.message}`);
    });
  };
}

module.exports = { createTsConnectionHandler };
