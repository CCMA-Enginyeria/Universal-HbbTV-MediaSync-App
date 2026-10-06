# Broadcaster integration guide

This guide explains how to make an HbbTV service work with the **Universal HbbTV
MediaSync** app (Android and iOS). You do not need to build or maintain a mobile app,
and you do not need to run a backend. You add a short snippet to your HbbTV
application. Optionally, you can describe extra content in your DASH manifest.

| You want to offer… | What you publish | Section |
|--------------------|------------------|---------|
| Alternative audio, audio description, sign-language or extra video, subtitles | A DASH MPD (or HLS playlist) as the content ID | [1](#1-enable-mediasync-on-the-tv), [2](#2-what-the-app-reads-from-your-manifest) |
| A synchronized web experience **next to** those tracks | `Application` entries inside the MPD | [3](#3-announce-web-experiences-inside-the-mpd) |
| **Only** a synchronized web experience | A web page URL as the content ID | [4](#4-a-web-page-as-the-content-id) |
| Sync on TVs whose DVB-CSS stack is unreliable, or messages between the TV app and the web | The `hbbtv-compat` script | [5](#5-compatibility-mode-and-application-messages) |

## What the viewer sees

1. **Discovery.** The app lists the HbbTV TVs on the same Wi-Fi network. Devices
   that do not support HbbTV appear under "other devices" and cannot be selected.
2. **TV screen.** After the viewer picks a TV, the app shows:
   - the **sync mode**: *High precision* (the TV's native DVB-CSS) or
     *Compatibility* (App2App). The app tests both and only enables the ones the
     TV offers; the viewer can switch between them.
   - **Synchronized web**: one card per web experience, with its name and
     language and an **Open** button;
   - **Audio** and **Video** tracks with *Listen* / *Watch* buttons, a volume
     slider and a fullscreen button for video;
   - **Subtitles** chips when the manifest has text tracks.
3. **Playback.** The selected track plays in sync with the TV. Audio continues in
   the background, including with the screen locked. A web experience opens
   full screen and receives the TV timeline.

A help screen with troubleshooting tips and a diagnostics export is always
available. The interface is available in Catalan, Spanish, Basque, English,
German, Italian and French.

## 1. Enable MediaSync on the TV

In your HbbTV application, create a `MediaSynchroniser`, announce the content ID
and enable inter-device synchronization:

```js
var ms = oipfObjectFactory.createMediaSynchroniser();

// The content ID the companion loads: a DASH MPD, an HLS playlist or a web page.
ms.contentIdOverride = 'https://cdn.example.com/programme/companion.mpd';

// Synchronize against the <video> element that plays the programme.
ms.initMediaSynchroniser(video, 'urn:dvb:css:timeline:pts');

ms.enableInterDeviceSync(function () {
  console.log('Inter-device sync enabled');
});
```

When this snippet runs, the TV advertises itself over **DIAL/SSDP** and publishes
the content ID over **CSS-CII**. The app then synchronizes over **CSS-WC**
(wall clock) and **CSS-TS** (timeline). Supported timelines are
`urn:dvb:css:timeline:pts` (90 kHz) and
`urn:dvb:css:timeline:mpd:period:rel:<ticks>`.

To change the companion content during the programme, assign a new
`contentIdOverride`. The app reloads the content. If the viewer was playing a
track, the app resumes the track with the same kind, language and role.

### Content ID rules

The app decides the content type from the URL **path**:

| Path ends with | Treated as |
|----------------|------------|
| `.mpd` | DASH manifest |
| `.m3u8` | HLS playlist |
| `.html` / `.htm` | Companion web page |

The content ID must be an absolute `http://` or `https://` URL without
credentials (`user@host`). The app shows any other content ID as unsupported.

## 2. What the app reads from your manifest

Each `AdaptationSet` becomes one choice for the viewer. The app shows the
representation with the highest bandwidth.

| MPD element / attribute | Effect in the app |
|-------------------------|-------------------|
| `contentType` or `mimeType` (`audio/*`, `video/*`, TTML/WebVTT) | Audio, video or subtitle section |
| `lang` | Language name in the track label |
| `Role value="main" / "alternate" / "commentary" …` | Track role |
| `Role value="description"` or `Accessibility` on audio | Labeled as audio description |
| `Role value="sign"` or `Accessibility` on video | Labeled as sign language |
| `Label` | Track title |
| `ContentProtection` | Track is hidden (DRM is not supported) |
| `type="dynamic"` | Live: the manifest is refreshed and the selected track is kept |

Subtitles can be side-loaded TTML/WebVTT files, or segmented through
`SegmentTemplate`/`SegmentList` (a finite `SegmentTimeline` of up to 10000 segments).
Byte ranges, fMP4 `wvtt` and TTML styles/regions are not supported yet.

> On iOS, DASH tracks currently play through the brand's sync web player instead
> of AVPlayer. HLS plays natively on both platforms.

## 3. Announce web experiences inside the MPD

Since version **1.6.0**, one MPD can carry both the media and the interactive
experience that goes with it. Add a Period `EventStream` with the scheme
`urn:3cat:ums:application:2026`. Each `Application type="web"` appears as a
**Synchronized web** card above the tracks. When the viewer opens it, the page
loads and receives the TV timeline, as for a web content ID (see
[section 4](#4-a-web-page-as-the-content-id)).

```xml
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     xmlns:ums="urn:3cat:ums:2026"
     type="static" mediaPresentationDuration="PT1H"
     profiles="urn:dvb:dash:profile:dvb-dash:2014">
  <Period id="main">
    <EventStream schemeIdUri="urn:3cat:ums:application:2026" value="1" timescale="1">
      <Event id="1" presentationTime="0">
        <ums:Application type="web"
                         url="https://apps.example.com/experience/?lang=en"
                         name="Solar eclipse · Immersive experience" lang="en"/>
        <ums:Application type="web"
                         url="experience/?lang=ca"
                         name="Eclipsi solar · Experiència immersiva" lang="ca"/>
      </Event>
    </EventStream>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="ca">
      <!-- … -->
    </AdaptationSet>
  </Period>
</MPD>
```

Rules:

- **Namespace.** Declare the `ums` prefix on the root element
  (`xmlns:ums="urn:3cat:ums:2026"`). Without the declaration the XML is invalid,
  and the app rejects the whole manifest. The app matches `Application` by its
  local name, so any prefix works.
- **Scheme and version.** `schemeIdUri` must be exactly
  `urn:3cat:ums:application:2026`. `value` is the format version: leave it out or
  set it to `1`. The app ignores other versions, which leaves room for future
  formats.
- **`type`** must be `web`. The app ignores other types and elements without a
  type.
- **`url`** is required. It can be relative: the app resolves it against the
  Period's `BaseURL` (or the MPD URL). The app keeps only `http://`/`https://`
  URLs without credentials. It drops duplicate URLs.
- **`name`** (optional) is the card title, trimmed and capped at 200
  characters. Without it, the app shows a generic "synchronized content" title.
- **`lang`** (optional) appears next to the name, so viewers can choose their
  language when you publish the same experience in several languages.
- You can use several `Application` elements, `Event`s and `Period`s. The app
  keeps at most **16** applications per manifest.
- **Timing is not applied yet.** `presentationTime` and `duration` are parsed
  but ignored: every announced application is available for the whole
  presentation. Use `presentationTime="0"` for now.

You can keep the same `EventStream` in the MPD your TV player uses: DASH players
ignore event schemes they do not know. A reference manifest with valid and
rejected cases is in
[`native/fixtures/protocol/applications.mpd`](../native/fixtures/protocol/applications.mpd).

## 4. A web page as the content ID

If the experience is only a web page, set it directly as the content ID:

```js
ms.contentIdOverride = 'https://apps.example.com/sync_app/index.html';
```

The TV must keep playing a `<video>` element so the timeline stays alive. The app
shows one **Synchronized web** card, titled with the page's `og:title` or
`<title>`. If the content ID later points to another page, an open page reloads.
If the content ID stops pointing to a web page, the app tells the viewer and lets
them close the page.

How the page opens:

- **Android:** in a Chrome Custom Tab with a message channel, when the page is
  HTTPS, a Custom Tabs browser is installed and the browser validates the page
  origin through Digital Asset Links. Otherwise the page opens in an in-app
  WebView, which receives the same messages. For the Custom Tab to work, publish
  `https://<your origin>/.well-known/assetlinks.json` with the
  `delegate_permission/common.use_as_origin` relation for the app. Copy the
  repository's [`assetlinks.json`](../.well-known/assetlinks.json), which lists
  the published app's package and certificate fingerprints.
- **Meta Quest (Horizon OS):** in a regular Quest Browser tab, because only
  those offer WebXR (the browser's Custom Tabs and the Android WebView report no
  immersive sessions). HTTPS pages only. The app adds
  `#mediasync-ws=<loopback WebSocket URL>` to the page URL and accepts that
  WebSocket only from the page's origin; see
  [Meta Quest tabs](#meta-quest-tabs). The browser asks the viewer once to let
  the site reach apps on the device.
- **iOS:** in an in-app WKWebView.

### Receiving the timeline

The same code works in every container. Listen for `message` events:

```js
window.addEventListener('message', function (event) {
  var msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (!msg || msg.version !== 1) return;

  switch (msg.type) {
    case 'init':        // { contentId }
      break;
    case 'position':    // { positionSeconds, positionMillis, isPlaying, speed, isLive, generatedAt, formattedTime }
      render(msg.positionSeconds, msg.generatedAt);
      break;
    case 'app-message': // { message } relayed verbatim from the TV application (section 5)
      handleTvMessage(msg.message);
      break;
  }
});
```

- The app sends `init` again after each navigation or reload.
- It sends `position` at most about once per second, and immediately when play
  state or speed changes.
- `generatedAt` is the phone's wall clock (epoch ms) at which `positionSeconds`
  was valid. To animate smoothly between messages, extrapolate from it with
  `speed`.
- `positionSeconds` can be `null` while the TV timeline is unknown.

The legacy global `window.__hbbtvSync(msg)` is still called if the page
defines it.

### Replying to the app

Inside the WebView and WKWebView, the app provides
`window.ReactNativeWebView.postMessage(string)`, so pages written for the former
React Native app work unchanged. In a Custom Tab, reply through the port that the
browser attaches to incoming messages (`event.ports[0]`). In a Meta Quest tab,
send through the loopback WebSocket.

```js
var tabPort = null;
window.addEventListener('message', function (event) {
  if (event.ports && event.ports[0]) tabPort = event.ports[0];
});

function send(envelope) {
  var text = JSON.stringify(envelope);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
  else if (tabPort) tabPort.postMessage(text);
}

send({ version: 1, type: 'sync-ack', positionSeconds: 12.3 });
send({ version: 1, type: 'app-message', message: { type: 'vote', id: 'r1', payload: { option: 2 } } });
```

The app accepts only messages from the opened page's origin and from the
current page load, with a maximum of 64 KiB. An `app-message` needs a non-empty
`message.type` of at most 128 characters. The app relays it verbatim to the TV
application.

A ready-to-run page that shows the synchronized timecode:
[`www/hbbtv_examples/sync_app/index.html`](../www/hbbtv_examples/sync_app/index.html).

### Meta Quest tabs

On Meta Quest the same envelopes travel as WebSocket text frames. Read the
address from the fragment once, keep it for reloads in the same tab, and
reconnect if the socket closes: the app sends `init`, the last position and the
retained TV state again on every connection.

```js
var params = new URLSearchParams(location.hash.slice(1));
var socketUrl = params.get('mediasync-ws') || sessionStorage.getItem('mediasync-ws');
if (socketUrl && socketUrl.indexOf('ws://127.0.0.1:') === 0) {
  sessionStorage.setItem('mediasync-ws', socketUrl);
  var socket = new WebSocket(socketUrl);
  socket.onmessage = function (event) { handle(JSON.parse(event.data)); };
  // send(envelope): socket.send(JSON.stringify(envelope));
}
```

The address is valid until the viewer opens another page or leaves the TV in the
app. Remove the parameter from the visible URL (`history.replaceState`) so it is
not shared.

## 5. Compatibility mode and application messages

Some TVs ship a DVB-CSS stack that is missing or unreliable. Add
[`www/hbbtv-compat/hbbtv-mediasync-compat.js`](../www/hbbtv-compat/README.md) to
your HbbTV application **in addition to** the `MediaSynchroniser`. It serves the
same DVB-CSS protocol over the HbbTV App2App channel:

```html
<script src="hbbtv-mediasync-compat.js"></script>
<script>
  window.HbbTVMediaSyncCompat.start(video, {
    contentId: 'https://cdn.example.com/programme/companion.mpd'
  });
</script>
```

The app checks which transports the TV offers. It uses *Compatibility* by
default and *High precision* when the check confirms it works or the viewer
selects it for that TV model.

The script also opens an **application channel** for messages in both
directions between your HbbTV application and the companion web page
(`sendAppMessage`, `setAppState`, `onAppMessage`). The channel is available in
both sync modes whenever the TV advertises App2App. See the
[compat README](../www/hbbtv-compat/README.md) for the API.

## 6. Test without a real TV

[`tools/tv-emulator`](../tools/tv-emulator/README.md) is a Node.js HbbTV/DVB-CSS
TV emulator (SSDP/DIAL, CSS-CII/WC/TS, App2App). Point it at your content ID and
test the app on a phone on the same network:

```sh
cd tools/tv-emulator && npm ci && EMU_IP=<your LAN IP> node index.js
```

[`www/hbbtv_examples/`](../www/hbbtv_examples/) contains HbbTV applications that
announce DASH, web and compatibility content and that you can adapt.

## Checklist

- [ ] The HbbTV application calls `createMediaSynchroniser()`, sets
      `contentIdOverride` and calls `enableInterDeviceSync()`.
- [ ] The content ID is an absolute HTTP(S) URL ending in `.mpd`, `.m3u8` or `.html`.
- [ ] The companion tracks are not DRM protected and carry `lang` and `Role` /
      `Accessibility`.
- [ ] Web experiences in the MPD use `urn:3cat:ums:application:2026`, version `1`,
      `type="web"`, and declare the `ums` namespace.
- [ ] For iOS, the DASH manifest and segments send CORS headers, because DASH
      plays in a web player there.
- [ ] For the Android Custom Tab, the web origin publishes
      `/.well-known/assetlinks.json` (otherwise the page opens in the WebView).
- [ ] Tested against the TV emulator and at least one real TV.

Questions or a TV that does not work? [Open an issue](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/issues)
or contact [rbermudez.h@3cat.cat](mailto:rbermudez.h@3cat.cat).
