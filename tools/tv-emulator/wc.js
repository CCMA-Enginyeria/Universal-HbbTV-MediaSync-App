'use strict';

const dgram = require('dgram');
const { wallClockNanos, nanosToSecsAndNanos } = require('./clock');

/**
 * CSS-WC (Wall Clock) UDP server.
 *
 * Implements the binary DVB-CSS wall clock protocol described in
 * src/services/CSSWCServiceUDP.js. The app sends 32-byte request packets
 * (message type 0) carrying its "originate" timestamp; we reply with a response
 * packet (message type 1) that:
 *
 *   - echoes the originate timestamp back unchanged (bytes 8..15), so the client
 *     can compute the round-trip,
 *   - fills the receive timestamp (bytes 16..23) with our wall clock time when
 *     the request arrived,
 *   - fills the transmit timestamp (bytes 24..31) with our wall clock time when
 *     we send the response.
 *
 * The receive/transmit timestamps use the SAME wall clock as the CSS-TS server
 * (see clock.js), which is what makes end-to-end sync coherent.
 *
 * Packet layout (32 bytes, big-endian):
 *   0      version (0)
 *   1      message type (0=request, 1=response)
 *   2      precision (int8)
 *   3      reserved
 *   4..7   max frequency error (uint32)
 *   8..11  originate seconds
 *   12..15 originate nanos
 *   16..19 receive seconds
 *   20..23 receive nanos
 *   24..27 transmit seconds
 *   28..31 transmit nanos
 */

const WC_PACKET_SIZE = 32;
const WC_VERSION = 0;
const WC_MSG_RESPONSE = 1;
// Precision: 2^-10 s ~= 1 ms. Encoded as a signed exponent per DVB-CSS.
const WC_PRECISION = -10;
// Max frequency error in units of 1/256 ppm. 500 ppm is a typical value.
const WC_MAX_FREQ_ERROR = 500 * 256;

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} [opts.ip] Interface address to bind to (default: all).
 * @param {(msg: string) => void} [opts.log]
 * @returns {dgram.Socket}
 */
function startWallClockServer({ port, ip, log = console.log }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    log(`[WC] socket error: ${err.message}`);
  });

  socket.on('message', (msg, rinfo) => {
    // Record arrival time as early as possible for accuracy.
    const receiveNanos = wallClockNanos();

    if (msg.length < WC_PACKET_SIZE) {
      return;
    }

    // Copy the request so the originate timestamp (bytes 8..15) is preserved.
    const response = Buffer.from(msg.subarray(0, WC_PACKET_SIZE));

    response.writeUInt8(WC_VERSION, 0);
    response.writeUInt8(WC_MSG_RESPONSE, 1);
    response.writeInt8(WC_PRECISION, 2);
    response.writeUInt8(0, 3);
    response.writeUInt32BE(WC_MAX_FREQ_ERROR >>> 0, 4);

    const recv = nanosToSecsAndNanos(receiveNanos);
    response.writeUInt32BE(recv.seconds >>> 0, 16);
    response.writeUInt32BE(recv.nanos >>> 0, 20);

    const transmitNanos = wallClockNanos();
    const trans = nanosToSecsAndNanos(transmitNanos);
    response.writeUInt32BE(trans.seconds >>> 0, 24);
    response.writeUInt32BE(trans.nanos >>> 0, 28);

    socket.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
      if (err) {
        log(`[WC] failed to reply to ${rinfo.address}:${rinfo.port}: ${err.message}`);
      }
    });
  });

  socket.bind(port, ip, () => {
    log(`[WC] wall clock server listening on udp ${ip || '0.0.0.0'}:${port}`);
  });

  return socket;
}

module.exports = { startWallClockServer };
