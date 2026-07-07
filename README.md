# Universal HbbTV MediaSync App

[![Tests](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/tests.yml/badge.svg)](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/tests.yml)
[![Build Android APK](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/build-android.yml/badge.svg)](https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/actions/workflows/build-android.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20iOS-blue.svg)](#)
[![Get it on Google Play](https://img.shields.io/badge/Get%20it%20on-Google%20Play-01875f?logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=cat.ccma.universalmediasync&pcampaignid=web_share)
[![Made with Expo](https://img.shields.io/badge/Made%20with-Expo-000020.svg?logo=expo&logoColor=white)](https://expo.dev)

![Universal HbbTV MediaSync App preview](assets/preview.jpg)

## Download

The Android app is available on Google Play: [Universal MediaSync](https://play.google.com/store/apps/details?id=cat.ccma.universalmediasync&pcampaignid=web_share).

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

## How It Works

1. The mobile app **discovers devices on the Wi-Fi network** that have MediaSync enabled, using the **DIAL** protocol (SSDP).
2. The user selects the TV set.
3. The app connects to the running HbbTV application, receives the content ID over **CSS-CII** (`ms.contentIdOverride`), and reads the DASH **MPD**.
4. It presents the user with the **available audio and video tracks** announced in the manifest.
5. The selected track plays **with precise synchronization** via **DVB-CSS** (CSS-WC UDP wallclock + CSS-TS timeline, `urn:dvb:css:timeline:pts`, 90 kHz).

Additional capabilities:
- **Background audio**: minimize the app and keep the synchronized audio playing.
- **Video track** selection (e.g. sign-language / alternate video) with a visible player.
- 7 UI languages: Catalan, Spanish, Basque, English, German, Italian, French
  (default/fallback: **English**).

## License

Released under the [MIT License](LICENSE). Maintenance is open and community-driven —
any HbbTV member is welcome to propose and contribute new features.
