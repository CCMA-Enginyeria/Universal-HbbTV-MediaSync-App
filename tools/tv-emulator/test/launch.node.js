'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildLaunchUrl } = require('../launch');

const emulator = { ip: '192.168.1.20', port: 7681 };

test('adds the FOKUS launch hash and keeps the query string', () => {
  assert.strictEqual(
    buildLaunchUrl('https://example.com/app/index.html?video=a&b=1', emulator),
    'https://example.com/app/index.html?video=a&b=1#port=7681&hostname=192.168.1.20',
  );
});

test('replaces an existing hash', () => {
  assert.strictEqual(
    buildLaunchUrl('http://example.com/#old', emulator),
    'http://example.com/#port=7681&hostname=192.168.1.20',
  );
});

test('rejects relative and non-http URLs', () => {
  assert.strictEqual(buildLaunchUrl('', emulator), null);
  assert.strictEqual(buildLaunchUrl('/tv', emulator), null);
  assert.strictEqual(buildLaunchUrl('javascript:alert(1)', emulator), null);
});
