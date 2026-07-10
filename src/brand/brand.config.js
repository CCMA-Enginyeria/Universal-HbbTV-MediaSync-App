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
  version: '1.1.0',

  // Native identifiers (must be unique per published fork)
  bundleIdentifier: 'cat.ccma.universalmediasync', // iOS
  androidPackage: 'cat.ccma.universalmediasync', // Android

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

  // ---- About / support ----------------------------------------------------
  supportUrl: 'https://www.hbbtv.org',
};

module.exports = brand;
