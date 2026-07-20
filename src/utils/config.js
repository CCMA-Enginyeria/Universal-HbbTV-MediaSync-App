/**
 * Application configuration for the Universal HbbTV MediaSync App.
 *
 * Brand-specific values (channel name, default content, app metadata) are read
 * from `src/brand/brand.config.js`. The protocol-level defaults below
 * (DIAL/SSDP and DVB-CSS) are standard and normally do not need changes.
 */

import brand from '../brand/brand.config';

export const config = {
  // DIAL / SSDP protocol
  SSDP_MULTICAST_ADDRESS: '239.255.255.250',
  SSDP_PORT: 1900,
  SSDP_SEARCH_TARGET: 'urn:dial-multiscreen-org:service:dial:1',

  // Timeouts
  SEARCH_TIMEOUT: 30000, // 30 seconds
  DEVICE_REFRESH_INTERVAL: 5000, // 5 seconds

  // Development / testing mode.
  // Set to true to also allow DIAL devices without HbbTV (Chromecast, etc.).
  ALLOW_NON_HBBTV_DEVICES: true,

  // App2App / DVB-CSS channel used to talk to the HbbTV application.
  CHANNEL: brand.app2appChannel,

  // URL of the hosted `sync_webplayer` (dash.js) page opened on iOS to play DASH
  // (MPD) content, which iOS AVPlayer cannot handle natively. Brand-configurable.
  SYNC_WEBPLAYER_URL: brand.syncWebPlayerUrl,

  // HbbTV application metadata (used when launching an app via DIAL).
  HBBTV_APP: {
    orgId: 0,
    appId: 0,
    appName: brand.appName,
    appNameLanguage: brand.defaultLanguage,
  },

  // Media Sync (DVB-CSS)
  MEDIA_SYNC: {
    // Acceptable synchronization tolerance in milliseconds.
    TOLERANCE_MS: 100,
    // Wall-clock synchronization interval.
    WC_SYNC_INTERVAL_MS: 1000,
    // Player progress callback sampling interval (ms). ExoPlayer updates its
    // internal position in coarse steps, so polling too fast (e.g. 100 ms)
    // returns uneven `currentTime` deltas (one short reading then a catch-up),
    // which injects measurement noise into the drift. 250 ms lets the position
    // settle between samples → smoother deltas, less CPU, and is still far
    // faster than the (slow) real drift needs.
    PROGRESS_UPDATE_INTERVAL_MS: 250,
    // Interval at which the locally extrapolated position is emitted to the
    // player corrector (ms). Used for UI updates and the background-safe
    // correction fallback (control timestamps wake JS even when timers freeze).
    POSITION_UPDATE_INTERVAL_MS: 250,
    // Minimum interval (ms) between two drift corrections for the same player.
    // De-duplicates the onProgress and position-update paths without dropping
    // legitimate onProgress samples (keep it below PROGRESS_UPDATE_INTERVAL_MS).
    SYNC_MIN_CORRECTION_INTERVAL_MS: 80,
    // Predictive drift-controller tuning (see src/utils/SyncController.js).
    // Low-pass filter weight for the measured drift (0..1); higher = more reactive.
    // Kept low so onProgress/wall-clock measurement spikes (~80-100 ms bursts)
    // are smoothed away instead of triggering corrections.
    SYNC_EMA_ALPHA: 0.25,
    // Start correcting when the filtered drift exceeds this (seconds). Set well
    // above the observed measurement noise (real drift is ~±20 ms) so noise
    // never engages the controller; the audio then stays glued at rate 1.0.
    SYNC_ENTER_BAND_S: 0.1,
    // Return to normal speed (lock) when the filtered drift drops below this (seconds).
    SYNC_EXIT_BAND_S: 0.02,
    // Time budget over which the predicted drift is nulled (seconds). Larger =
    // gentler corrections; smaller = faster but nearer the overshoot edge.
    SYNC_HORIZON_S: 3.0,
    // Loop dead-time compensated by the controller's lead term (seconds).
    SYNC_DEAD_TIME_S: 0.35,
    // Maximum playback-rate deviation from 1.0 (clamps to [1 - delta, 1 + delta]).
    SYNC_MAX_RATE_DELTA: 0.05,
    // Ignore rate changes smaller than this (avoids React state churn).
    SYNC_RATE_EPS: 0.002,
    // After a hard seek, suppress further corrections for this long (ms) or until
    // the player reports the seek completed (onSeek), whichever comes first. A
    // DASH seek needs to fetch/buffer new segments, during which onProgress still
    // reports the old position; without this guard the corrector would re-seek
    // every cycle to a moving target ("seeking in many slow steps").
    SYNC_SEEK_COOLDOWN_MS: 1500,
    // Lead added to the seek target (seconds) to compensate for the seek+rebuffer
    // latency, so the player lands where the TV *will* be, not where it was.
    SYNC_SEEK_LEAD_S: 0.4,
    // When true, logs the drift/rate control loop (~4 lines/s per player) to the
    // console for diagnosing sync stability. Verbose; keep off in favour of the
    // compact SYNC_TELEMETRY line below unless you need the raw control-loop trace.
    DEBUG_SYNC: false,
    // When true, emits one compact single-line JSON telemetry record per sync
    // tick (marker `SYNCTEL`) with the key sync metrics. Consumed by the
    // `tools/sync-dashboard` dev tool to render a live web dashboard from
    // `adb logcat`. Cheap enough (~4 lines/s) to leave on during development.
    SYNC_TELEMETRY: true,
    // Default timeline selector (MPEG-DASH PTS).
    TIMELINE_SELECTOR: 'urn:dvb:css:timeline:pts',
    // Tick rate for PTS (90kHz).
    TICK_RATE: 90000,
    // Optional fallback content URL, used only when the TV announces no
    // contentId via DVB-CSS CII. Null for the standard HbbTV flow.
    DEFAULT_CONTENT_URL: brand.defaultContentUrl,
  },
};

export default config;
