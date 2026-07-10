import SyncController from '../SyncController';

/**
 * Simulate the closed loop: feed the controller measurements, apply the
 * returned rate to a virtual player, and advance the player/TV clocks. A
 * one-step command delay models the real bridge/render latency so the tests
 * exercise the controller's lead compensation against overshoot.
 *
 * @param {SyncController} controller
 * @param {number} initialDrift  player - tv at t0 (seconds)
 * @param {object} [opts]
 * @returns {{ drifts:number[], finalRate:number }}
 */
function simulate(controller, initialDrift, opts = {}) {
  const dt = opts.dt ?? 0.1; // 100 ms, matching PROGRESS_UPDATE_INTERVAL_MS
  const steps = opts.steps ?? 300;
  const jitter = opts.jitter ?? 0;

  let playerTime = 0;
  let tvTime = -initialDrift; // so that playerTime - tvTime === initialDrift
  let appliedRate = 1.0; // rate currently in effect on the player
  let pendingRate = 1.0; // rate commanded this step, effective next step
  const drifts = [];

  for (let i = 0; i < steps; i++) {
    const noise = jitter ? (Math.sin(i * 1.7) * jitter) : 0;
    const r = controller.update({ playerTime: playerTime + noise, tvTime });
    if (r.action === 'seek') {
      playerTime = tvTime;
      pendingRate = 1.0;
      appliedRate = 1.0;
    } else if (r.action === 'rate') {
      pendingRate = r.rate;
    }
    // Advance clocks with the currently-effective rate, then apply the command
    // (one-step latency).
    playerTime += appliedRate * dt;
    tvTime += 1.0 * dt;
    appliedRate = pendingRate;
    drifts.push(playerTime - tvTime);
  }

  return { drifts, finalRate: controller.currentRate };
}

describe('SyncController', () => {
  test('hard-seeks on large drift and resets to normal rate', () => {
    const c = new SyncController();
    const r = c.update({ playerTime: 100, tvTime: 90 }); // 10 s drift > 2 s
    expect(r.action).toBe('seek');
    expect(r.rate).toBe(1.0);
    expect(c.currentRate).toBe(1.0);
  });

  test('passes a live seek threshold override through', () => {
    const c = new SyncController();
    // 3 s drift: would seek for VOD (2 s) but not for live (5 s).
    const r = c.update({ playerTime: 3, tvTime: 0, seekThresholdS: 5 });
    expect(r.action).not.toBe('seek');
  });

  test('stays locked for small drift within the release band', () => {
    const c = new SyncController();
    const r = c.update({ playerTime: 0.015, tvTime: 0 }); // 15 ms < exitBand
    expect(r.action).toBe('none');
    expect(r.rate).toBe(1.0);
    expect(c.mode).toBe('locked');
  });

  test('hysteresis: drift between exit and enter band does not engage', () => {
    const c = new SyncController();
    // 40 ms is above exitBand (20 ms) but below enterBand (100 ms): still locked.
    let last;
    for (let i = 0; i < 10; i++) last = c.update({ playerTime: 0.04, tvTime: 0 });
    expect(c.mode).toBe('locked');
    expect(last.rate).toBe(1.0);
  });

  test('rejects sub-band jitter without issuing corrections', () => {
    const c = new SyncController();
    const { finalRate, drifts } = simulate(c, 0, { jitter: 0.03, steps: 100 });
    // Jitter amplitude (30 ms) stays under the enter band, so the controller
    // must never leave the locked state.
    expect(c.mode).toBe('locked');
    expect(finalRate).toBe(1.0);
    // Drift stays bounded by the jitter, never diverges.
    const maxAbs = Math.max(...drifts.map((d) => Math.abs(d)));
    expect(maxAbs).toBeLessThan(0.05);
  });

  test('converges a player that is behind without overshoot, then returns to 1.0', () => {
    const c = new SyncController();
    const { drifts, finalRate } = simulate(c, -0.3, { steps: 400 }); // 300 ms behind
    const finalDrift = drifts[drifts.length - 1];
    expect(Math.abs(finalDrift)).toBeLessThan(0.025); // settled inside the band
    // No significant overshoot to the opposite (positive) side.
    const maxPositive = Math.max(...drifts);
    expect(maxPositive).toBeLessThan(0.03);
    // Rate has returned to normal speed once locked.
    expect(finalRate).toBe(1.0);
  });

  test('converges a player that is ahead without overshoot', () => {
    const c = new SyncController();
    const { drifts, finalRate } = simulate(c, 0.3, { steps: 400 }); // 300 ms ahead
    const finalDrift = drifts[drifts.length - 1];
    expect(Math.abs(finalDrift)).toBeLessThan(0.025);
    // No significant overshoot to the opposite (negative) side.
    const minNegative = Math.min(...drifts);
    expect(minNegative).toBeGreaterThan(-0.03);
    expect(finalRate).toBe(1.0);
  });

  test('never commands a rate outside the configured bounds', () => {
    const c = new SyncController({ maxRateDelta: 0.05 });
    const rates = [];
    // Large (but sub-seek) drift forces the maximum correction.
    let playerTime = 0;
    let tvTime = 1.5; // 1.5 s behind, under the 2 s seek threshold
    for (let i = 0; i < 50; i++) {
      const r = c.update({ playerTime, tvTime });
      rates.push(r.rate);
      playerTime += r.rate * 0.1;
      tvTime += 0.1;
    }
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(0.95 - 1e-9);
      expect(rate).toBeLessThanOrEqual(1.05 + 1e-9);
    }
  });

  test('reset() clears filtered drift and rate state', () => {
    const c = new SyncController();
    c.update({ playerTime: 0.5, tvTime: 0 });
    c.reset();
    expect(c.filteredDrift).toBeNull();
    expect(c.currentRate).toBe(1.0);
    expect(c.mode).toBe('locked');
  });
});
