'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { TvState } = require('../tvState');

test('paused playback produces a stable zero-speed control timestamp', () => {
  const state = new TvState({ contentId: 'https://example.test/a.mpd' });
  state.update({ positionSeconds: 12.5, paused: true });

  const timestamp = state.buildControlTimestamp();

  assert.equal(timestamp.contentTime, 1125000);
  assert.equal(timestamp.timelineSpeedMultiplier, 0);
  assert.ok(timestamp.wallClockTime >= 0);
});

test('content and mode updates are exposed in snapshots', () => {
  const state = new TvState({ contentId: 'https://example.test/a.mpd' });

  const snapshot = state.update({
    contentId: 'https://example.test/b.mpd',
    mode: 'compat',
    playbackRate: 1.25,
  });

  assert.equal(snapshot.contentId, 'https://example.test/b.mpd');
  assert.equal(snapshot.mode, 'compat');
  assert.equal(snapshot.playbackRate, 1.25);
});

test('announced content follows playback until an override is set', () => {
  const state = new TvState({ contentId: 'https://example.test/a.mpd' });

  assert.equal(state.getSnapshot().announcedContentId, 'https://example.test/a.mpd');

  let snapshot = state.update({ contentIdOverride: ' https://example.test/companion.html ' });
  assert.equal(snapshot.contentId, 'https://example.test/a.mpd');
  assert.equal(snapshot.contentIdOverride, 'https://example.test/companion.html');
  assert.equal(snapshot.announcedContentId, 'https://example.test/companion.html');

  snapshot = state.update({ contentId: 'https://example.test/b.mpd' });
  assert.equal(snapshot.announcedContentId, 'https://example.test/companion.html');

  snapshot = state.update({ contentIdOverride: '' });
  assert.equal(snapshot.contentIdOverride, null);
  assert.equal(snapshot.announcedContentId, 'https://example.test/b.mpd');
});

test('announced content changes emit CII updates', () => {
  const state = new TvState({ contentId: 'https://example.test/a.mpd' });
  const announcedContentIds = [];
  state.on('change', (snapshot) => { announcedContentIds.push(snapshot.announcedContentId); });

  state.update({ contentId: 'https://example.test/b.mpd' });
  state.update({ contentIdOverride: 'https://example.test/companion.html' });
  state.update({ contentId: 'https://example.test/c.mpd' });
  state.update({ contentIdOverride: null });

  assert.deepEqual(announcedContentIds, [
    'https://example.test/b.mpd',
    'https://example.test/companion.html',
    'https://example.test/c.mpd',
  ]);
});

test('position heartbeats do not emit CII or transport changes', () => {
  const state = new TvState({ contentId: 'https://example.test/a.mpd' });
  let changeCount = 0;
  state.on('change', () => { changeCount += 1; });

  state.update({ positionSeconds: 1 });
  state.update({ positionSeconds: 2 });

  assert.equal(changeCount, 0);
});