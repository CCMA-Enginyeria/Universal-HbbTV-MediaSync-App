# Universal MediaSync

## Vision

Create a **universal HbbTV MediaSync application**, open source and maintained by the community of HbbTV members, enabling complementary content to be played on a second device such as a mobile phone or tablet, **perfectly synchronized** with the main TV content.

The goal is to provide **a single application for all broadcasters** that want to enable second-screen experiences, avoiding the need for each broadcaster to develop and maintain its own dedicated app. This repository is the **common app** intended to be forked: a fork only needs to edit a single configuration file to fully rebrand it.

## Value Proposition

- **Minimal adoption effort for broadcasters.** Joining the initiative is as simple as adding a small code snippet that enables MediaSync for the selected content and specifies which complementary content should be offered on the second screen.
- **Frictionless user experience.** Activation for the viewer should be as direct and seamless as possible.

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

## Rebrand / fork in one file

Everything broadcaster-specific lives in **[src/brand/brand.config.js](src/brand/brand.config.js)**.
Edit it to fork the app — no other file needs to change:

| Field | Purpose |
|-------|---------|
| `appName`, `shortName` | Display name shown in the UI and on the device. |
| `slug`, `scheme` | Expo slug and deep-link URL scheme. |
| `bundleIdentifier`, `androidPackage` | Native app identifiers (must be unique per published fork). |
| `defaultLanguage`, `fallbackLanguages` | UI language defaults. |
| `assets` | Icon / adaptive icon / splash / favicon paths. |
| `colors` | Partial palette overrides merged on top of `src/theme.js`. |
| `splashBackgroundColor` | Native splash + adaptive icon background. |
| `app2appChannel` | App2App / DVB-CSS channel used to talk to the HbbTV app. |
| `defaultContentUrl` | Optional fallback MPD if the TV announces no contentId (leave `null` for the standard flow). |
| `supportUrl` | About/support link. |

The brand config is a CommonJS module consumed by **both** `app.config.js` (Expo CLI) and the
React Native code, so a single edit propagates everywhere.

### Steps to rebrand

1. Edit `src/brand/brand.config.js` (name, identifiers, colors, language).
2. Replace the images in `assets/` (icon, adaptive icon, splash, favicon).
3. Run `npx expo prebuild --clean` to regenerate the native projects with the new identity.

## Project structure

- `app.config.js` — dynamic Expo config that reads from `src/brand/brand.config.js`.
- `src/brand/brand.config.js` — **single source of truth** for forking/rebranding.
- `src/screens/` — `DiscoveryScreen`, `HelpScreen`.
- `src/components/` — `TerminalItem` (per-TV connection, track selection, synchronized playback), `AppHeader`.
- `src/services/` — DIAL/SSDP discovery, WebSocket, DVB-CSS (`CSSWCService`, `CSSTSService`, `MediaSyncService`), MPD/TTML parsers.
- `src/utils/config.js` — runtime config derived from the brand config.
- `src/i18n/` — i18next setup and translations.
- `modules/udp-multicast` — iOS Swift Expo module (multicast/unicast UDP).
- `modules/udp-wall-clock` — Android Kotlin Expo module (CSS-WC wall clock).
- `plugins/` — Expo config plugins (network security config, release signing).
- `www/` — static HbbTV-side test pages (`index.html` launcher, basic + dash.js media-sync viewers).

## Commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Start Metro | `npm start` |
| Run iOS | `npm run ios` |
| Run Android | `npm run android` |
| Web | `npm run web` |

> `ios/` and `android/` are not committed. Generate them with `npx expo prebuild`.

## Platform networking

- **iOS** — custom Swift Expo module `udp-multicast` (autolinked, survives clean prebuilds).
  Physical-device UDP multicast requires the Apple Developer Program and the approved
  `com.apple.developer.networking.multicast` entitlement. The iOS Simulator works without it.
- **Android** — `react-native-udp` for UDP/SSDP and the `udp-wall-clock` module for CSS-WC.

## www test pages

The `www/` folder contains minimal HbbTV-side pages to exercise the sync flow from a TV/emulator:

- `index.html` — launcher (Basic + dash.js viewers).
- `basic-media-sync-viewer.html` — native HTML5 `<video>` + DVB-CSS.
- `dashjs-media-sync-viewer.html` — dash.js + DVB-CSS.

They use a generic public demo DASH stream
(`https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd`) via `ms.contentIdOverride`.
Replace it with your own MPD as needed.

## License

Released under the [MIT License](LICENSE). Maintenance is open and community-driven —
any HbbTV member is welcome to propose and contribute new features.
