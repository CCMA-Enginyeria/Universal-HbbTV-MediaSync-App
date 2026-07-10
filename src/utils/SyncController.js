/**
 * SyncController — predictive, lead-compensated drift corrector for companion
 * media playback.
 *
 * Given the companion player's current playback time and the target TV timeline
 * position, it decides whether to hard-seek, nudge the playback rate, or do
 * nothing. It is a pure state machine (no React / native dependencies) so it can
 * be unit-tested in isolation.
 *
 * Why predictive: the correction loop has significant dead-time (the player
 * progress is sampled periodically and the rate command travels through the
 * JS/native bridge). A plain proportional controller keeps the corrective rate
 * applied until the *measured* drift crosses zero, by which point the player has
 * already overshot — producing the "reach sync, then sail past it" hunting. We
 * add a lead term that predicts the drift at the moment the new rate takes
 * effect, so the controller eases back toward 1.0 *before* the drift actually
 * reaches zero.
 *
 * Hysteresis: a wider engage band and a narrow release band keep the controller
 * locked at 1.0 once synced, so measurement jitter no longer re-triggers small
 * corrections (no more chattering around the target).
 *
 * All times are in seconds; rates are multipliers where 1.0 is normal speed.
 */

const DEFAULTS = {
  emaAlpha: 0.25, // drift low-pass filter weight (0..1); low = smooths measurement spikes
  enterBandS: 0.1, // start correcting when |filtered drift| exceeds this (100 ms)
  exitBandS: 0.02, // return to 1.0 (lock) when |filtered drift| drops below this
  horizonS: 3.0, // time budget over which the predicted drift is nulled
  deadTimeS: 0.35, // loop dead-time compensated by the lead term
  maxRateDelta: 0.05, // max rate deviation from 1.0 (i.e. clamp to [0.95, 1.05])
  rateEps: 0.002, // ignore rate changes smaller than this (avoids state churn)
  seekThresholdS: 2.0, // hard-seek when |drift| exceeds this
};

export default class SyncController {
  /**
   * @param {Partial<typeof DEFAULTS>} [options] Tuning overrides.
   */
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.reset();
  }

  /** Reset the internal state (call when the source or selection changes). */
  reset() {
    this.filteredDrift = null; // null until the first sample
    this.currentRate = 1.0;
    this.mode = 'locked'; // 'locked' | 'correcting'
  }

  /**
   * Feed a new measurement and get the recommended action.
   *
   * @param {object} m
   * @param {number} m.playerTime Companion player position (seconds).
   * @param {number} m.tvTime Target TV timeline position (seconds).
   * @param {number} [m.seekThresholdS] Override the hard-seek threshold (e.g. live).
   * @returns {{action:'seek'|'rate'|'none', rate:number, drift:number, filteredDrift:number}}
   *   `drift` is the raw (unfiltered) drift so the caller can compute a live
   *   seek target as `playerCurrentTime - drift` when needed.
   */
  update({ playerTime, tvTime, seekThresholdS }) {
    const o = this.opts;
    const seekTh = seekThresholdS ?? o.seekThresholdS;
    const drift = playerTime - tvTime; // > 0: player ahead, < 0: player behind
    const absDrift = Math.abs(drift);

    // Large drift: a rate nudge would take too long — hard seek and reset.
    if (absDrift > seekTh) {
      this.filteredDrift = 0;
      this.currentRate = 1.0;
      this.mode = 'locked';
      return { action: 'seek', rate: 1.0, drift, filteredDrift: 0 };
    }

    // Low-pass filter the drift to reject wall-clock / progress jitter.
    if (this.filteredDrift == null) {
      this.filteredDrift = drift;
    } else {
      this.filteredDrift = o.emaAlpha * drift + (1 - o.emaAlpha) * this.filteredDrift;
    }
    const fd = this.filteredDrift;
    const absFd = Math.abs(fd);

    // Hysteresis: decide whether we should be actively correcting.
    if (this.mode === 'locked') {
      if (absFd > o.enterBandS) this.mode = 'correcting';
    } else if (absFd < o.exitBandS) {
      this.mode = 'locked';
    }

    // Locked: stay at (or snap back to) normal speed.
    if (this.mode === 'locked') {
      if (this.currentRate !== 1.0) {
        this.currentRate = 1.0;
        return { action: 'rate', rate: 1.0, drift, filteredDrift: fd };
      }
      return { action: 'none', rate: 1.0, drift, filteredDrift: fd };
    }

    // Predictive rate nulling with lead compensation for the loop dead-time.
    // `driftAtApply` anticipates where the drift will be once the new rate lands,
    // so the controller eases back toward 1.0 ahead of the true zero crossing.
    const driftAtApply = fd + (this.currentRate - 1.0) * o.deadTimeS;
    let rateDelta = -driftAtApply / o.horizonS;
    rateDelta = Math.max(-o.maxRateDelta, Math.min(o.maxRateDelta, rateDelta));
    const newRate = 1.0 + rateDelta;

    if (Math.abs(newRate - this.currentRate) > o.rateEps) {
      this.currentRate = newRate;
      return { action: 'rate', rate: newRate, drift, filteredDrift: fd };
    }
    return { action: 'none', rate: this.currentRate, drift, filteredDrift: fd };
  }
}
