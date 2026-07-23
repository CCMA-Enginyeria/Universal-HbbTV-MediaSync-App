# Universal HbbTV MediaSync App

[![Tests](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/tests.yml/badge.svg)](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/tests.yml)
[![Build Android APK](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/build-android.yml/badge.svg)](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/build-android.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20iOS-blue.svg)](#)
[![Get it on Google Play](https://img.shields.io/badge/Get%20it%20on-Google%20Play-01875f?logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=cat.ccma.universalmediasync&pcampaignid=web_share)
[![Made with Expo](https://img.shields.io/badge/Made%20with-Expo-000020.svg?logo=expo&logoColor=white)](https://expo.dev)

![Universal HbbTV MediaSync App preview](assets/preview.jpg)

## Download

The Android app is available on Google Play: [Universal MediaSync](https://play.google.com/store/apps/details?id=cat.ccma.lab.universalmediasync&pcampaignid=web_share).

## Vision

Create a **universal HbbTV MediaSync application**, open source and maintained by the community of HbbTV members, enabling complementary content to be played on a second device such as a mobile phone or tablet, **perfectly synchronized** with the main TV content.

The goal is to provide **a single application for all broadcasters** that want to enable second-screen experiences, avoiding the need for each broadcaster to develop and maintain its own dedicated app.

## Value Proposition

- **Minimal adoption effort for broadcasters.** Joining the initiative is as simple as adding a small code snippet that enables MediaSync for the selected content and specifies which complementary content should be offered on the second screen.
- **Frictionless user experience.** Activation for the viewer should be as direct and seamless as possible.

## Minimal Integration for Broadcasters

To make an HbbTV application discoverable by the Universal HbbTV MediaSync app, the
broadcaster only needs to create a `MediaSynchroniser`, expose the content ID of the
DASH stream, and start synchronization against the video element's PTS timeline:

```js
// 1. Create the MediaSynchroniser from the OIPF object factory
var ms = oipfObjectFactory.createMediaSynchroniser();

// 2. Announce the content ID (DASH MPD URL) that the second screen will load
ms.contentIdOverride = 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd';

// 3. Initialise sync against the playing <video> element on the PTS timeline (90 kHz)
ms.initMediaSynchroniser(video, 'urn:dvb:css:timeline:pts');

// 4. Enable inter-device synchronization so companion screens can join
ms.enableInterDeviceSync(function () {
  console.log('Inter-device sync enabled');
});
```

Where `video` is the `HTMLVideoElement` currently playing the tv content.
Once this snippet runs, the HbbTV terminal advertises itself over **DIAL/SSDP** and
serves the content ID over **CSS-CII**, allowing the mobile app to discover it and
synchronize the complementary track automatically.

### Companion web app (instead of a DASH track)

The content ID does not have to be a DASH manifest. If `contentIdOverride` points to
a **web URL** (an `.html` page), the mobile app will not parse an MPD: instead it
shows a card announcing that synchronized content is available and, when the user
opens it, loads that web full-screen inside a WebView and feeds it the live
synchronization data via post-messages.

```js
var ms = oipfObjectFactory.createMediaSynchroniser();

// Announce a companion WEB (.html) instead of an MPD.
// The TV keeps playing a <video> so the PTS timeline stays alive; only the
// content ID advertised to the companion changes.
ms.contentIdOverride = 'https://your-broadcaster.example/sync_app/index.html';

ms.initMediaSynchroniser(video, 'urn:dvb:css:timeline:pts');
ms.enableInterDeviceSync(function () {
  console.log('Inter-device sync enabled');
});
```

Inside the companion web, receive the synchronization messages by defining a global
handler that the mobile app calls on every timeline update:

```js
// Called by the mobile app on each sync update.
window.__hbbtvSync = function (msg) {
  // msg = { type:'init', contentId } on load, then
  // msg = { type:'position', positionSeconds, positionMillis, isPlaying, speed, isLive, formattedTime }
  if (msg.type === 'position') {
    render(msg.positionSeconds); // e.g. show the exact timecode
  }
};
```

A minimal, ready-to-run demonstrator that displays the exact synchronized timecode
lives at [`www/hbbtv_examples/sync_app/index.html`](www/hbbtv_examples/sync_app/index.html),
and [`www/hbbtv_examples/basic-media-sync-viewer.html`](www/hbbtv_examples/basic-media-sync-viewer.html)
includes a *“Web Demo (Timecode)”* content entry that advertises it.

## How It Works

1. The mobile app **discovers devices on the Wi-Fi network** that have MediaSync enabled, using the **DIAL** protocol (SSDP).
2. The user selects the TV set.
3. The app connects to the running HbbTV application, receives the content ID over **CSS-CII** (`ms.contentIdOverride`), and reads the DASH **MPD** — or, if the content ID is a **web** (`.html`), loads that page full-screen in a WebView and feeds it the sync data via post-messages instead of parsing an MPD.
4. It presents the user with the **available audio and video tracks** announced in the manifest (or a card to open the synchronized web).
5. The selected track plays **with precise synchronization** via **DVB-CSS** (CSS-WC UDP wallclock + CSS-TS timeline, `urn:dvb:css:timeline:pts`, 90 kHz).

Additional capabilities:
- **Background audio**: minimize the app and keep the synchronized audio playing.
- **Video track** selection (e.g. sign-language / alternate video) with a visible player.
- **Companion web content**: when the content ID is a web (`.html`), the app opens it
  full-screen in a WebView and streams the timeline to it via post-messages
  (`window.__hbbtvSync`) instead of parsing an MPD. If a new content ID arrives with a
  different web it reloads it; if it no longer points to a web, the app tells the user
  and lets them close it.
- 7 UI languages: Catalan, Spanish, Basque, English, German, Italian, French
  (default/fallback: **English**).

## License

Released under the [MIT License](LICENSE). Maintenance is open and community-driven —
any HbbTV member is welcome to propose and contribute new features.
