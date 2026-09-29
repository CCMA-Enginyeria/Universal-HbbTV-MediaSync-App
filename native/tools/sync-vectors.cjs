const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const SyncController = require('../../www/hbbtv_examples/sync_webplayer/SyncController');

const rows = ['scenario\treset\tplayerTime\ttvTime\tseekThresholdS\taction\trate\tdrift\tfilteredDrift\tmode'];

function scenario(name, samples) {
  const controller = new SyncController();
  samples.forEach((sample, index) => {
    const reset = index === 0 || sample.reset === true;
    if (reset) controller.reset();
    const measurement = { playerTime: sample.playerTime, tvTime: sample.tvTime ?? 0,
      seekThresholdS: sample.seekThresholdS ?? 2 };
    const decision = controller.update(measurement);
    rows.push([name, Number(reset), measurement.playerTime, measurement.tvTime,
      measurement.seekThresholdS, decision.action, decision.rate, decision.drift,
      decision.filteredDrift, controller.mode].join('\t'));
  });
}

scenario('boundaries', [0, 0.02, 0.1, 0.100001, -0.100001, 2, -2, 2.000001, -2.000001]
  .map(playerTime => ({ playerTime, reset: true })));
scenario('live', [3, 5, 5.000001, -3, -5, -5.000001]
  .map(playerTime => ({ playerTime, seekThresholdS: 5, reset: true })));
scenario('zero-threshold', [{ playerTime: 0.001, seekThresholdS: 0 }]);
scenario('jitter', Array.from({ length: 100 }, (_, step) => ({ playerTime: Math.sin(step * 1.7) * 0.03 })));
scenario('reset-and-seek', [0.5, 0.5, 10, 0.04, -0.5, 0, 0, 0]
  .map((playerTime, step) => ({ playerTime, reset: step === 5 })));
scenario('release', [0.5, ...Array(60).fill(0)].map(playerTime => ({ playerTime })));

for (const initialDrift of [-0.3, 0.3]) {
  const controller = new SyncController();
  let playerTime = 0;
  let tvTime = -initialDrift;
  let appliedRate = 1;
  const samples = [];
  for (let step = 0; step < 400; step++) {
    samples.push({ playerTime, tvTime });
    const decision = controller.update({ playerTime, tvTime });
    playerTime += appliedRate * 0.1;
    tvTime += 0.1;
    appliedRate = decision.rate;
  }
  assert.ok(Math.abs(playerTime - tvTime) < 0.025);
  assert.equal(controller.currentRate, 1);
  scenario(initialDrift < 0 ? 'behind' : 'ahead', samples);
}

const output = `${rows.join('\n')}\n`;
const destination = path.join(__dirname, '..', 'fixtures', 'sync-controller.tsv');
if (process.argv.includes('--check')) {
  assert.equal(fs.readFileSync(destination, 'utf8'), output, 'Regenerate native sync vectors after reviewing controller changes.');
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output);
}
console.log(`Verified ${rows.length - 1} JavaScript reference decisions.`);