# Universal HbbTV MediaSync App — Agent Notes

React Native + Expo **dev-client/bare-workflow** app for DIAL/HbbTV discovery and companion-screen media sync (private listening). New Architecture is enabled (`newArchEnabled: true`).

This is a **white-label / forkable** app: every brand-specific value (name, identifiers, colors, splash, default language, App2App channel) lives in a single file, `src/brand/brand.config.js`, which is consumed both by `app.config.js` (Expo CLI) and by the React Native code. A fork should normally only need to edit that one file.

## Critical Setup Gotchas

- **`ios/` and `android/` are gitignored and NOT committed.**
  - `ios/` does **not exist** in this working tree; generate it with `npx expo prebuild --platform ios`.
  - `android/` exists locally but is untracked. The CI regenerates it with `npx expo prebuild --platform android --clean`.
- **Expo config is dynamic (`app.config.js`), not `app.json`.** All values are derived from `src/brand/brand.config.js`. The iOS multicast entitlement, `NSLocalNetworkUsageDescription`, `UIBackgroundModes: ['audio']`, and the Android permissions / foreground-service config are declared in `app.config.js` and injected during prebuild.
- **Native UDP + background sync are version-controlled Expo local modules** under `modules/` (autolinked via `expo-modules-core`), so they survive clean prebuilds.
- **Apple Developer Program required for iOS physical-device UDP multicast.** Without the paid program (and the approved `com.apple.developer.networking.multicast` entitlement), UDP multicast fails with `errno 65 (EHOSTUNREACH)`. The iOS Simulator works fine without it.

## Commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Start Metro | `npm start` (alias `expo start`) |
| Run tests | `npm test` (Jest via `jest-expo`) |
| Run iOS | `npm run ios` (alias `expo run:ios`) |
| Run Android | `npm run android` (alias `expo run:android`) |
| Web | `npm run web` (alias `expo start --web`) |
| Local signed Android build | `./build-release-signed.ps1` (PowerShell) |

- **Jest is configured** (`jest.config.js`, `jest.setup.js`, `jest-expo` preset). Tests live in `__tests__/` folders next to the code they cover (`src/services/__tests__`, `src/utils/__tests__`, `src/components/__tests__`).
- No lint or typecheck scripts are configured.

## Architecture & Boundaries

- **`src/`** — Main JS application code.
  - `brand/` — `brand.config.js`, the single source of truth for all brand/fork values (identity, native ids, default language, assets, color overrides).
  - `services/` — DIAL/SSDP discovery (`DIALDiscoveryService.js`), DVB-CSS media sync (`MediaSyncService.js`, `CSSCIIService.js`, `CSSTSService.js`, `CSSWCService.js`, `CSSWCServiceUDP.js`), and MPD/TTML parsers (`MpdParserService.js`, `TtmlSegmentService.js`).
  - `screens/` — React Native screens: `DiscoveryScreen`, `HelpScreen`.
  - `components/` — Shared UI components (`AppHeader.js`, `StatusSlot.js`, `TerminalItem.js`).
  - `utils/` — `config.js` (hardcoded IPs/URLs/channels), `ForegroundSync.js` (Android background-service wrapper), `NativeUDPMulticast.js` (iOS custom-module wrapper), `NativeUDPWallClock.js`, TTML/VTT parsers (`TtmlParser.js`, `TtmlDemuxer.js`, `VttParser.js`).
  - `models/` — `HbbTVTerminal.js`.
  - `data/` — Static JSON: `channels.json`, `tvBrands.json`.
  - `i18n/` — i18next setup (`index.js`) and `translations.js`.
  - `theme.js` — Centralized design tokens (colors, spacing, typography). Brand color overrides from `brand.config.js` are merged on top. Import as `theme` and use instead of hardcoded style values.
- **`modules/udp-multicast`** — **iOS-only** custom Expo module (Swift / BSD sockets) for DIAL/SSDP multicast discovery and DVB-CSS unicast. Referenced as `UDPMulticast`; wrapped by `src/utils/NativeUDPMulticast.js`.
- **`modules/udp-wall-clock`** — **Android-only** custom Expo module (Kotlin) for DVB-CSS wall-clock UDP sync. Referenced as `UDPWallClock`; wrapped by `src/utils/NativeUDPWallClock.js`.
- **`modules/foreground-sync`** — **Android-only** custom Expo module (Kotlin) that runs a foreground service so DVB-CSS sync, WebSockets/UDP sockets and companion audio keep running while the app is in the background. Wrapped by `src/utils/ForegroundSync.js` (no-op on iOS, which relies on `UIBackgroundModes: ['audio']`).
- **`modules/ws-bridge`** — **Android-only** custom Expo module (Kotlin, `org.java-websocket`) that runs a loopback WebSocket server (bound to `127.0.0.1`) to relay DVB-CSS sync to a companion page opened OUTSIDE the in-app WebView (a Chrome Custom Tab, so WebXR works, where there is no `injectJavaScript` bridge). Wrapped by `src/utils/SyncBridgeServer.js`. Used for companion URLs flagged with `xr=1`, which `TerminalItem.js` opens via `expo-web-browser` with `?syncBridge=ws://127.0.0.1:<port>` appended; the `sync_app` page connects to that bridge as an additive transport.
- **`plugins/withNetworkConfig.js`** — Expo config plugin that injects Android `network_security_config.xml` (cleartext traffic) and ProGuard keep-rules for `react-native-udp`. Do not remove from the `app.config.js` plugins array.
- **`plugins/withReleaseSigning.js`** — Expo config plugin that wires the release keystore signing into the generated Android project.
- **`tools/tv-emulator/`** — Self-contained **Node.js** DVB-CSS/HbbTV TV emulator (SSDP/DIAL discovery, CSS-CII, CSS-WC, CSS-TS) to test the app end-to-end **without a real TV**. Has its own `package.json`.
- **`www/`** — `landing/` (marketing landing page, deployed to GitHub Pages) and `hbbtv_examples/` (sample HbbTV pages).
- **`store/`** — Store metadata: `play-store-listings.md`, `release-notes-1.0.0.md`.
- **`app.config.js`** — Dynamic Expo config driven by `src/brand/brand.config.js`. Notable fields: `newArchEnabled: true`, `orientation: 'default'` (app is locked to portrait at runtime; `default` lets the video player rotate into fullscreen landscape), background-audio config for `react-native-video`, and the custom plugins.

## Platform-Specific Networking & Background Playback

- **iOS** — Uses the custom Swift module `UDPMulticast` (autolinked local module at `modules/udp-multicast`) for multicast/unicast. Background execution relies on `UIBackgroundModes: ['audio']` while audio is playing.
- **Android** — Uses the community package `react-native-udp` for UDP/SSDP; the `udp-wall-clock` module handles wall-clock sync; the `foreground-sync` module plus `react-native-video` background-audio config keep sockets/timers alive in the background.

## CI / Deployment

- **Tests** — `.github/workflows/tests.yml` runs `npm test -- --runInBand` on every push to `main` and on manual dispatch (Node 22).
- **Landing page** — `.github/workflows/publish-landing-page.yml` deploys `www/landing` to GitHub Pages, triggered only when `www/landing/**` (or the workflow) changes on `main`.
- **Android APK** — `.github/workflows/build-android.yml` triggers on `v*` tags or manual dispatch. Steps: `npm ci` → `npx expo prebuild --platform android --clean` → sign & build with Gradle (JDK 17). Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Conventions

- Main app code is **JavaScript** (not TypeScript); `tsconfig.json` extends `expo/tsconfig.base` but there is no `tsc` build step.
- The custom Expo modules use TypeScript for their public API (`index.ts`, `src/*.ts`).
- `src/brand/brand.config.js` is a **CommonJS** module (consumed by both Node and RN). Brand/fork values belong here — do not hardcode them elsewhere.
- Hardcoded network/content configuration lives in `src/utils/config.js` (IP addresses, content URLs, channel names, timeline selectors). Update this file when local network or content endpoints change.

## Code Style

> **Rule: all source code, identifiers, comments, JSDoc and log messages MUST be written in English.**
> User-facing UI strings are the only exception — they are localized via i18n (see below). Note that many existing files still contain Catalan comments/logs; when you touch that code, migrate the comments and logs you edit to English rather than adding new non-English text.

- **Language:** JavaScript (ES modules) with modern syntax (`import`/`export`, `async`/`await`, arrow functions, destructuring).
- **Indentation:** 2 spaces. **Strings:** single quotes. Terminate statements with semicolons.
- **Naming:**
  - `camelCase` for variables, functions and instance methods.
  - `PascalCase` for React components, classes and models.
  - `UPPER_SNAKE_CASE` for constants and config keys.
  - Files: `PascalCase.js` for components/screens/services/models; `camelCase.js` for utilities/config.
- **React components:** function components with hooks. Screens use `export default function ScreenName({ navigation }) { ... }`. Keep `StyleSheet.create(...)` at the bottom of the file and pull values from `theme.js` instead of hardcoding.
- **Services:** singleton classes that extend `EventEmitter`, exposed through a `getXxxService()` accessor. Communicate state changes via events, not direct coupling.
- **Comments:** use `/** ... */` JSDoc blocks to describe the purpose of modules, classes and non-trivial functions. Explain *why*, not *what*. All in English.
- **Logging:** `console.log` / `console.warn` / `console.error` with concise English messages; the existing emoji prefixes (e.g. `✅`, `❌`, `📡`) are fine for readability.
- **Tests:** Jest + `@testing-library/react-native`. Place specs in a `__tests__/` folder next to the code under test; name files `*.test.js`.
- No linter or formatter is configured — match the surrounding style of the file you are editing.

## Internationalization (i18n)

- Stack: `i18next` + `react-i18next` + `expo-localization`.
- Device language is detected automatically via `Localization.getLocales()` on app start (`src/i18n/index.js`); if unsupported it falls back to `brand.defaultLanguage`.
- Default / fallback language is **brand-configurable** in `src/brand/brand.config.js` (`defaultLanguage`, `fallbackLanguages`) — currently `en`.
- Supported UI languages: Catalan (`ca`), Spanish (`es`), Basque (`eu`), English (`en`), German (`de`), Italian (`it`), French (`fr`).
- Translation resources live in `src/i18n/translations.js` grouped by feature / screen (e.g. `help.*`).
- **When adding a new screen or feature:** extract all user-facing strings into `translations.js` under a namespaced key and use `const { t } = useTranslation()` in the component. Never hardcode user-facing text in components.
