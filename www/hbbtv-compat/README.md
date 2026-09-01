# HbbTV MediaSync — App2App Compatibility Mode

`hbbtv-mediasync-compat.js` is a **drop-in polyfill** that exposes DVB-CSS
inter-device media synchronisation over the standard HbbTV **App2App**
WebSocket transport, **independently of the terminal's native DVB-CSS stack**.

## Why

Some real HbbTV devices ship a native DVB-CSS implementation (CSS-CII / CSS-WC /
CSS-TS) that is flaky or broken. The App2App channel, by contrast, is a reliable
and widely-supported HbbTV feature. This module reuses the **exact same DVB-CSS
JSON wire protocol** as the FOKUS `hbbtv-manager-polyfill.js`, but serves it over
App2App channels — so a companion app can synchronise even when the native
DVB-CSS endpoints fail.

It also adds a fourth, **non-DVB-CSS application channel** for free-form
bidirectional messaging between the HbbTV application and its companion
(commands, chat, application state).

Because it uses the same protocol, a companion app needs **almost no extra code**:
it connects to the App2App CSS-CII channel instead of the native
`X_HbbTV_InterDevSyncURL`, and everything downstream (CSS-WC, CSS-TS) is
identical.

## How it works

The module opens four App2App **server** channels (defaults, `<prefix>` =
`hbbtv-sync`):

| Channel        | Role         | Payload |
|----------------|--------------|---------|
| `<prefix>-cii` | CSS-CII      | `{ contentId, presentationStatus, wcUrl, tsUrl, timelines }` pushed on pair + on change |
| `<prefix>-wc`  | CSS-WC       | request `{ v, t:0, ..., ot }` → response `{ v, t:1, ..., rt, tt }` |
| `<prefix>-ts`  | CSS-TS       | control timestamps `{ contentTime, wallClockTime, timelineSpeedMultiplier }` |
| `<prefix>-app` | Application  | `{ version, type, id, payload, retained? }` in both directions |

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
  // optional, defaults to 'urn:dvb:css:timeline:mpd:period:rel:1000'
  timelineSelector: 'urn:dvb:css:timeline:mpd:period:rel:1000',
  tickRate: 90000,                              // optional (default 90 kHz)
  channelPrefix: 'hbbtv-sync',                  // optional
});

// When the content id changes (e.g. new stream):
window.HbbTVMediaSyncCompat.setContentId('https://example.com/other.mpd');

// On teardown / navigation away:
window.HbbTVMediaSyncCompat.stop();
```

### Application channel

The `<prefix>-app` channel is independent of DVB-CSS: it is available in
compatibility mode **and** while the companion synchronises over native DVB-CSS,
and it carries whatever the two applications agree on. This module never
inspects the payload.

```js
// Retained state: replayed to companions that pair later.
window.HbbTVMediaSyncCompat.setAppState('location', { location: 'barcelona' });
window.HbbTVMediaSyncCompat.setAppState('location', null); // clears it

// One-off broadcast to every paired companion.
window.HbbTVMediaSyncCompat.sendAppMessage('chat.typing', { active: true });

// Requests coming from a companion; `respond` answers that companion only.
window.HbbTVMediaSyncCompat.onAppMessage(function (message, respond) {
  if (message.type === 'chat.message') {
    respond({ text: buildReply(message.payload.text) });
  }
});
```

Envelope: `{ version: 1, type: <string>, id: <string|null>, payload: <any> }`,
plus `retained: true` on state replays. A companion message carrying an `id`
is a request; answering with the same `id` correlates the response.

### API

| Method | Description |
|--------|-------------|
| `start(video, options)` | Starts the App2App sync servers for a media element. Returns `true` on success. Stops any previous instance first. |
| `setContentId(contentId)` | Updates the announced contentId and re-broadcasts CSS-CII. |
| `setPrivateState(privateState)` | Replaces the application-specific `private` CII field and re-broadcasts CSS-CII. Prefer the application channel for anything non-CII. |
| `sendAppMessage(type, payload, id)` | Broadcasts a one-off application message over `<prefix>-app`. |
| `setAppState(type, payload)` | Publishes retained application state; replayed to companions pairing later. `null` clears it. |
| `onAppMessage(listener)` | Subscribes to companion messages as `(message, respond)`. Returns an unsubscribe function. |
| `onConnectedDeviceCountChange(listener)` | Subscribes to the number of fully paired companion devices. Returns an unsubscribe function. |
| `getConnectedDeviceCount()` | Paired device count, or `null` while not running. |
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

The application channel is handled by `src/services/App2AppChannelService.js`
and exposed through `MediaSyncService.sendAppMessage()`, `requestApp()` and the
`app-message` event. It is opened whenever the terminal advertises an App2App
base URL, regardless of the DVB-CSS transport in use. Messages are relayed
verbatim to the companion web page over the Chrome Custom Tabs channel, so the
app itself stays agnostic of the payload schema.
