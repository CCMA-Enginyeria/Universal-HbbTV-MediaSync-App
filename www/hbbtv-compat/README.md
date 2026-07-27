# HbbTV MediaSync — App2App Compatibility Mode

`hbbtv-mediasync-compat.js` is a **drop-in polyfill** that exposes DVB-CSS
inter-device media synchronisation over the standard HbbTV **App2App**
WebSocket transport, **independently of the terminal's native DVB-CSS stack**.

## Why

Some real HbbTV devices ship a native DVB-CSS implementation (CSS-CII / CSS-WC /
CSS-TS) that is flaky or broken. The App2App channel, by contrast, is a reliable
and widely-supported HbbTV feature. This module reuses the **exact same DVB-CSS
JSON wire protocol** as the FOKUS `hbbtv-manager-polyfill.js`, but serves it over
three App2App channels — so a companion app can synchronise even when the native
DVB-CSS endpoints fail.

Because it uses the same protocol, a companion app needs **almost no extra code**:
it connects to the App2App CSS-CII channel instead of the native
`X_HbbTV_InterDevSyncURL`, and everything downstream (CSS-WC, CSS-TS) is
identical.

## How it works

The module opens three App2App **server** channels (defaults, `<prefix>` =
`hbbtv-sync`):

| Channel        | DVB-CSS role | Payload |
|----------------|--------------|---------|
| `<prefix>-cii` | CSS-CII      | `{ contentId, presentationStatus, wcUrl, tsUrl, timelines }` pushed on pair + on change |
| `<prefix>-wc`  | CSS-WC       | request `{ v, t:0, ..., ot }` → response `{ v, t:1, ..., rt, tt }` |
| `<prefix>-ts`  | CSS-TS       | control timestamps `{ contentTime, wallClockTime, timelineSpeedMultiplier }` |

The CSS-CII channel advertises the WC and TS channel URLs, so the companion only
needs to know the CSS-CII channel name to bootstrap the whole session.

App2App base URLs are resolved automatically:
1. From the native CS manager
   (`oipfObjectFactory.createCSManager().getApp2AppLocalBaseURL()` /
   `getApp2AppRemoteBaseURL()`) — this works even when native DVB-CSS is broken.
2. Falling back to the launch hash parameters (`port` / `hostname`).

## Usage

Add the script to your HbbTV application:

```html
<script src="hbbtv-mediasync-compat.js"></script>
```

Start it once the media element is ready to play, and stop it on teardown:

```js
var video = document.querySelector('video');

// When playback starts:
window.HbbTVMediaSyncCompat.start(video, {
  contentId: 'https://example.com/stream.mpd', // DASH MPD or companion web URL
  timelineSelector: 'urn:dvb:css:timeline:pts', // optional (default PTS)
  tickRate: 90000,                              // optional (default 90 kHz)
  channelPrefix: 'hbbtv-sync',                  // optional
});

// When the content id changes (e.g. new stream):
window.HbbTVMediaSyncCompat.setContentId('https://example.com/other.mpd');

// On teardown / navigation away:
window.HbbTVMediaSyncCompat.stop();
```

### API

| Method | Description |
|--------|-------------|
| `start(video, options)` | Starts the App2App sync servers for a media element. Returns `true` on success. Stops any previous instance first. |
| `setContentId(contentId)` | Updates the announced contentId and re-broadcasts CSS-CII. |
| `stop()` | Stops the servers and releases resources. |
| `isRunning()` | Whether the servers are currently running. |

## Notes

- The module is framework-agnostic **ES5** (no build step) and safe to drop into
  old device browsers.
- Browser-based emulators can pass `app2appLocalBaseUrl` and
  `app2appRemoteBaseUrl` to `start()` when no native CS manager is available.
- It uses channel names distinct from the polyfill's own `dvbcss-*` channels, so
  it can run alongside the polyfill's `MediaSynchroniser` without clashing.
- It is independent of `createMediaSynchroniser()` — call it **in addition to**
  the native DVB-CSS `MediaSynchroniser` so companions can prefer whichever
  transport works on the device.

## Companion side (Universal HbbTV MediaSync App)

The mobile app detects the compatibility channel and connects to
`<X_HbbTV_App2AppURL>/<prefix>-cii`, preferring it over native DVB-CSS and
falling back automatically. See `src/services/MediaSyncService.js`
(`connect()` compat-first logic).
