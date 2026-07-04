'use strict';

const dgram = require('dgram');

/**
 * SSDP (Simple Service Discovery Protocol) responder.
 *
 * The mobile app discovers TVs by multicasting an `M-SEARCH` with
 *   ST: urn:dial-multiscreen-org:service:dial:1
 * (see src/services/DIALDiscoveryService.js). We join the SSDP multicast group
 * and reply with a unicast `HTTP/1.1 200 OK` whose LOCATION header points at
 * our device description XML. The app then fetches that XML over HTTP.
 *
 * We only answer M-SEARCH requests whose ST matches the DIAL service target or
 * `ssdp:all`, so we don't pollute unrelated UPnP discovery on the network.
 */

const SSDP_MULTICAST_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const DIAL_SEARCH_TARGET = 'urn:dial-multiscreen-org:service:dial:1';

/**
 * @param {object} opts
 * @param {string} opts.ip        LAN IPv4 of the emulator.
 * @param {string} opts.location  URL of the device description XML (dd.xml).
 * @param {string} opts.uuid      Stable UUID for this emulated device.
 * @param {(msg: string) => void} [opts.log]
 * @returns {dgram.Socket}
 */
function startSsdpResponder({ ip, location, uuid, log = console.log }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    log(`[SSDP] socket error: ${err.message}`);
  });

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');

    // Only care about M-SEARCH discovery requests.
    if (!/^M-SEARCH \* HTTP\/1\.1/i.test(text)) {
      return;
    }

    const stMatch = text.match(/^ST:\s*(.+)$/im);
    const st = stMatch ? stMatch[1].trim() : '';

    if (st !== DIAL_SEARCH_TARGET && st !== 'ssdp:all') {
      return;
    }

    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'EXT:',
      `LOCATION: ${location}`,
      'SERVER: Node/22 UPnP/1.1 HbbTV-MediaSync-Emulator/1.0',
      `ST: ${DIAL_SEARCH_TARGET}`,
      `USN: uuid:${uuid}::${DIAL_SEARCH_TARGET}`,
      'BOOTID.UPNP.ORG: 1',
      'CONFIGID.UPNP.ORG: 1',
      '',
      '',
    ].join('\r\n');

    const buffer = Buffer.from(response);
    socket.send(buffer, 0, buffer.length, rinfo.port, rinfo.address, (err) => {
      if (err) {
        log(`[SSDP] failed to answer ${rinfo.address}:${rinfo.port}: ${err.message}`);
      } else {
        log(`[SSDP] answered M-SEARCH from ${rinfo.address}:${rinfo.port}`);
      }
    });
  });

  socket.bind(SSDP_PORT, () => {
    try {
      socket.addMembership(SSDP_MULTICAST_ADDRESS, ip);
    } catch (err) {
      // Fall back to joining on the default interface if the specific IP fails.
      try {
        socket.addMembership(SSDP_MULTICAST_ADDRESS);
      } catch (err2) {
        log(`[SSDP] could not join multicast group: ${err2.message}`);
      }
    }
    log(`[SSDP] listening on ${SSDP_MULTICAST_ADDRESS}:${SSDP_PORT} (iface ${ip})`);
  });

  return socket;
}

module.exports = {
  startSsdpResponder,
  SSDP_MULTICAST_ADDRESS,
  SSDP_PORT,
  DIAL_SEARCH_TARGET,
};
