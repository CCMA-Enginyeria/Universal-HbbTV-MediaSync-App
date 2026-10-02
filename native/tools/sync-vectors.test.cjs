const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const SyncController = require('../../www/hbbtv_examples/sync_webplayer/SyncController');

function checkVectors(Controller = SyncController) {
  const math = Object.create(Math);
  math.sin = () => { throw new Error('Vector generation must not depend on Math.sin'); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sync-vectors.cjs'), 'utf8'), {
    __dirname,
    process: { argv: ['node', 'sync-vectors.cjs', '--check'] },
    Math: math,
    console: { log() {} },
    require: id => id.endsWith('/SyncController') ? Controller : require(id),
  });
}

test('pinned jitter inputs preserve all existing fixture bytes without Math.sin', () => {
  const inputs = require('./sync-jitter-inputs.json');
  const fixtureInputs = fs.readFileSync(path.join(__dirname, '../fixtures/sync-controller.tsv'), 'utf8')
    .split('\n').filter(row => row.startsWith('jitter\t'))
    .map(row => Number(row.split('\t')[2]));
  assert.equal(inputs.length, 100);
  assert.deepEqual(inputs, fixtureInputs);
  checkVectors();
});

test('exact output checking still rejects a tiny controller result change', () => {
  class ChangedController extends SyncController {
    update(measurement) {
      const decision = super.update(measurement);
      return { ...decision, filteredDrift: decision.filteredDrift + Number.EPSILON };
    }
  }
  assert.throws(() => checkVectors(ChangedController), {
    code: 'ERR_ASSERTION',
    message: /Regenerate native sync vectors/,
  });
});