/**
 * Universal HbbTV MediaSync App — Brand configuration (single source of truth).
 *
 * This is the ONE file a broadcaster needs to edit to fork and rebrand the app:
 * app name, identifiers, colors, splash, default language and the App2App channel.
 *
 * It is written as a CommonJS module so it can be consumed both by:
 *   - `app.config.js` (Node / Expo CLI, via require), and
 *   - the React Native code (via `import brand from './brand/brand.config'`).
 */

const brand = {
  // ---- Identity -----------------------------------------------------------
  appName: 'Universal MediaSync',
  shortName: 'MediaSync',
  slug: 'universal-mediasync',
  scheme: 'universalmediasync',
  version: '1.2.0',

  // Native identifiers (must be unique per published fork)
  bundleIdentifier: 'cat.ccma.lab.universalmediasync', // iOS
  androidPackage: 'cat.ccma.lab.universalmediasync', // Android

  // ---- Localization -------------------------------------------------------
  // Default / fallback UI language. Supported: ca, es, eu, en, de, it, fr.
  defaultLanguage: 'en',
  fallbackLanguages: ['en'],

  // ---- Assets (paths relative to the project root) ------------------------
  assets: {
    icon: './assets/icon.png',
    adaptiveIcon: './assets/adaptive-icon.png',
    splashImage: './assets/splash-icon.png',
    favicon: './assets/favicon.png',
  },

  // ---- Brand colors -------------------------------------------------------
  // Partial overrides merged on top of the base design palette (src/theme.js).
  // A fork can change just these few tokens to restyle the whole app.
  colors: {
    primary: '#c0c1ff',
    onPrimary: '#1000a9',
    primaryContainer: '#8083ff',
    onPrimaryContainer: '#0d0096',
    background: '#0b1326',
    surface: '#0b1326',
  },
  // Background used for the native splash screen and adaptive icon.
  splashBackgroundColor: '#0b1326',

  // ---- Networking ---------------------------------------------------------
  // App2App / DVB-CSS channel used to talk to the HbbTV application.
  app2appChannel: 'org.hbbtv.mediasync',

  // Optional fallback DASH (MPD) URL, used only if the TV announces no
  // contentId via DVB-CSS CII. Leave null for the standard HbbTV flow.
  defaultContentUrl: null,

  // URL of the hosted `sync_webplayer` page (dash.js). Used on iOS to play DASH
  // (MPD) content, since iOS AVPlayer cannot play MPEG-DASH natively: the app
  // opens this page in a full-screen WebView and feeds it the DVB-CSS sync via
  // `window.__hbbtvSync`. Host it like the companion `sync_app` page (per fork).
  // When the TV announces HLS (M3U8) instead, iOS uses the native player and
  // ignores this. The repo source lives at
  // `www/hbbtv_examples/sync_webplayer/index.html`.
  syncWebPlayerUrl: 'https://ccma-labs-generic.s3.eu-west-1.amazonaws.com/hbbtv-dial-viewer/sync_webplayer/index.html',

  // ---- Permissions --------------------------------------------------------
  // Opt-in device permissions. Kept off by default so a fork only declares the
  // native capability (iOS Info.plist / Android manifest) when it truly needs
  // it — which keeps store listings clean. When a permission is disabled the
  // corresponding request is denied at runtime (the OS prompt never appears).
  permissions: {
    // Allow the companion web page rendered in the in-app WebView (second
    // device) to access the camera via `getUserMedia()`. The OS permission is
    // requested on-demand, only when the page actually asks for the camera.
    camera: true,
  },
  // Static usage description shown in the iOS camera permission dialog
  // (`NSCameraUsageDescription`). iOS requires a fixed string here; user-facing
  // Android rationale is localized via i18n (`permissions.camera.*`).
  cameraUsageDescription:
    'This app lets the companion web page use the camera when you interact with it.',

  // ---- About / support ----------------------------------------------------
  supportUrl: 'https://www.hbbtv.org',
};

module.exports = brand;
