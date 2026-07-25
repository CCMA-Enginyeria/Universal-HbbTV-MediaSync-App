'use strict';

const { EventEmitter } = require('events');
const { wallClockNanos } = require('./clock');

const PTS_TICK_RATE = 90000;

class TvState extends EventEmitter {
  constructor({ contentId, mode = 'native' }) {
    super();
    this.state = {
      contentId,
      mode: mode === 'compat' ? 'compat' : 'native',
      positionSeconds: 0,
      paused: true,
      playbackRate: 1,
      updatedWallClockNanos: wallClockNanos(),
    };
  }

  getSnapshot() {
    const snapshot = { ...this.state };
    if (!snapshot.paused) {
      const elapsedSeconds = (wallClockNanos() - snapshot.updatedWallClockNanos) / 1e9;
      snapshot.positionSeconds += elapsedSeconds * snapshot.playbackRate;
    }
    return snapshot;
  }

  update(patch) {
    const current = this.getSnapshot();
    const next = {
      ...current,
      ...patch,
      mode: patch.mode === 'compat' ? 'compat' : patch.mode === 'native' ? 'native' : current.mode,
      positionSeconds: Number.isFinite(Number(patch.positionSeconds))
        ? Math.max(0, Number(patch.positionSeconds))
        : current.positionSeconds,
      playbackRate: Number.isFinite(Number(patch.playbackRate))
        ? Math.max(0, Number(patch.playbackRate))
        : current.playbackRate,
      paused: typeof patch.paused === 'boolean' ? patch.paused : current.paused,
      updatedWallClockNanos: wallClockNanos(),
    };

    this.state = next;
    const snapshot = this.getSnapshot();
    if (snapshot.contentId !== current.contentId ||
        snapshot.mode !== current.mode ||
        snapshot.paused !== current.paused) {
      this.emit('change', snapshot);
    }
    return snapshot;
  }

  buildControlTimestamp() {
    const snapshot = this.getSnapshot();
    return {
      contentTime: Math.round(snapshot.positionSeconds * PTS_TICK_RATE),
      wallClockTime: wallClockNanos(),
      timelineSpeedMultiplier: snapshot.paused ? 0 : snapshot.playbackRate,
    };
  }
}

module.exports = { PTS_TICK_RATE, TvState };