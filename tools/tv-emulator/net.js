'use strict';

const os = require('os');

/**
 * Pick the primary non-internal IPv4 address of this machine. This is the
 * address the mobile app on the same Wi-Fi will use to reach the emulator, so
 * it must be a real LAN address (not 127.0.0.1).
 *
 * Preference order:
 *   1. Common LAN interfaces (en0, eth0, wlan0, Wi-Fi) if available.
 *   2. Any other non-internal IPv4 interface.
 *
 * @param {string} [preferred] Optional explicit IP to use (overrides detection).
 * @returns {string} An IPv4 address, or '127.0.0.1' as a last resort.
 */
function getLocalIPv4(preferred) {
  if (preferred) {
    return preferred;
  }

  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({ name, address: addr.address });
      }
    }
  }

  if (candidates.length === 0) {
    return '127.0.0.1';
  }

  const preferredNames = ['en0', 'eth0', 'wlan0', 'wi-fi', 'wlp'];
  const primary = candidates.find((c) =>
    preferredNames.some((p) => c.name.toLowerCase().startsWith(p))
  );

  return (primary || candidates[0]).address;
}

module.exports = { getLocalIPv4 };
