'use strict';

/**
 * Shared wall clock for the emulated TV.
 *
 * DVB-CSS requires that the CSS-WC (wall clock) server and the CSS-TS
 * (timeline sync) server expose timestamps in the SAME time base. The mobile
 * app measures the offset between its local clock and this wall clock via WC,
 * then interprets the TS control timestamps (which carry `wallClockTime`) in
 * that same base. If WC and TS used different clocks, synchronization would
 * drift or fail.
 *
 * The base is monotonic and starts at 0 when the process launches, so the
 * `seconds` field of the WC packet (a uint32) always fits comfortably.
 */

const NANOS_PER_SECOND = 1e9;
const NANOS_PER_MS = 1e6;

const startHrTime = process.hrtime.bigint();

/**
 * Current wall clock time in nanoseconds since the emulator started.
 * @returns {number} Elapsed nanoseconds (safe integer for ~100 days of uptime).
 */
function wallClockNanos() {
  return Number(process.hrtime.bigint() - startHrTime);
}

/**
 * Split a nanosecond value into whole seconds + remaining nanoseconds, the
 * representation used by the binary DVB-CSS wall clock packet.
 * @param {number} nanos
 * @returns {{ seconds: number, nanos: number }}
 */
function nanosToSecsAndNanos(nanos) {
  const seconds = Math.floor(nanos / NANOS_PER_SECOND);
  const nanosRemainder = Math.floor(nanos % NANOS_PER_SECOND);
  return { seconds, nanos: nanosRemainder };
}

module.exports = {
  NANOS_PER_SECOND,
  NANOS_PER_MS,
  wallClockNanos,
  nanosToSecsAndNanos,
};
