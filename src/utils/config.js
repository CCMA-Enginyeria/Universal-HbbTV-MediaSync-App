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
    // Player progress callback sampling interval (ms). Lower values give a more
    // precise drift measurement but cost more CPU/battery (ExoPlayer fires the
    // callback at this rate). The synchronized timeline is extrapolated locally
    // between samples (accounting for playback speed), so a coarser value saves
    // battery without losing sync.
    PROGRESS_UPDATE_INTERVAL_MS: 250,
    // Interval at which the locally extrapolated position is emitted to the
    // player corrector (ms).
    POSITION_UPDATE_INTERVAL_MS: 250,
    // Drift-correction cadence far from lock (ms).
    SYNC_INTERVAL_MS: 500,
    // Drift-correction cadence near lock (ms). Should not be lower than
    // PROGRESS_UPDATE_INTERVAL_MS, otherwise we would correct more often than we
    // sample the player position.
    NEAR_SYNC_INTERVAL_MS: 250,
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
