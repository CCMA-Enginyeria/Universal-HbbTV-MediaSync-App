(function (root, factory) {
  var SyncController = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = SyncController;
  } else {
    root.SyncController = SyncController;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    emaAlpha: 0.25,
    enterBandS: 0.1,
    exitBandS: 0.02,
    horizonS: 3.0,
    deadTimeS: 0.35,
    maxRateDelta: 0.05,
    rateEps: 0.002,
    seekThresholdS: 2.0,
  };

  function SyncController(options) {
    this.opts = Object.assign({}, DEFAULTS, options || {});
    this.reset();
  }

  SyncController.prototype.reset = function () {
    this.filteredDrift = null;
    this.currentRate = 1.0;
    this.mode = 'locked';
  };

  SyncController.prototype.update = function (measurement) {
    var options = this.opts;
    var seekThreshold = measurement.seekThresholdS != null
      ? measurement.seekThresholdS
      : options.seekThresholdS;
    var drift = measurement.playerTime - measurement.tvTime;
    var absDrift = Math.abs(drift);

    if (absDrift > seekThreshold) {
      this.filteredDrift = 0;
      this.currentRate = 1.0;
      this.mode = 'locked';
      return { action: 'seek', rate: 1.0, drift: drift, filteredDrift: 0 };
    }

    if (this.filteredDrift == null) {
      this.filteredDrift = drift;
    } else {
      this.filteredDrift = options.emaAlpha * drift
        + (1 - options.emaAlpha) * this.filteredDrift;
    }
    var filteredDrift = this.filteredDrift;
    var absFilteredDrift = Math.abs(filteredDrift);

    if (this.mode === 'locked') {
      if (absFilteredDrift > options.enterBandS) this.mode = 'correcting';
    } else if (absFilteredDrift < options.exitBandS) {
      this.mode = 'locked';
    }

    if (this.mode === 'locked') {
      if (this.currentRate !== 1.0) {
        this.currentRate = 1.0;
        return { action: 'rate', rate: 1.0, drift: drift, filteredDrift: filteredDrift };
      }
      return { action: 'none', rate: 1.0, drift: drift, filteredDrift: filteredDrift };
    }

    var driftAtApply = filteredDrift
      + (this.currentRate - 1.0) * options.deadTimeS;
    var rateDelta = -driftAtApply / options.horizonS;
    rateDelta = Math.max(-options.maxRateDelta, Math.min(options.maxRateDelta, rateDelta));
    var newRate = 1.0 + rateDelta;

    if (Math.abs(newRate - this.currentRate) > options.rateEps) {
      this.currentRate = newRate;
      return { action: 'rate', rate: newRate, drift: drift, filteredDrift: filteredDrift };
    }
    return {
      action: 'none',
      rate: this.currentRate,
      drift: drift,
      filteredDrift: filteredDrift,
    };
  };

  return SyncController;
}));
