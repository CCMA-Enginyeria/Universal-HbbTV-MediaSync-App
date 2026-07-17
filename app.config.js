/**
 * Expo dynamic configuration for the Universal HbbTV MediaSync App.
 *
 * All brand-specific values are read from `src/brand/brand.config.js`, so a
 * fork should not need to touch this file — only the brand config.
 */

const brand = require('./src/brand/brand.config');

module.exports = {
  expo: {
    name: brand.appName,
    slug: brand.slug,
    scheme: brand.scheme,
    version: brand.version,
    // The app is locked to portrait at runtime (see App.js). We declare
    // 'default' here so the OS *allows* landscape, which is required for the
    // video player to rotate into fullscreen landscape via expo-screen-orientation.
    orientation: 'default',
    icon: brand.assets.icon,
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    plugins: [
      './plugins/withNetworkConfig',
      './plugins/withReleaseSigning',
      'expo-localization',
      'expo-web-browser',
      [
        'react-native-video',
        {
          // Register the Android foreground service (PlaybackService) and the
          // media notification so companion audio/video keeps playing while the
          // app is in the background, which in turn keeps the DVB-CSS sync
          // timers and sockets alive.
          enableBackgroundAudio: true,
          enableNotificationControls: true,
        },
      ],
      [
        'expo-splash-screen',
        {
          ios: {
            backgroundColor: brand.splashBackgroundColor,
            image: brand.assets.splashImage,
            resizeMode: 'cover',
          },
          android: {
            backgroundColor: brand.splashBackgroundColor,
            image: brand.assets.splashImage,
            imageWidth: 150,
          },
        },
      ],
    ],
    splash: {
      image: brand.assets.splashImage,
      resizeMode: 'contain',
      backgroundColor: brand.splashBackgroundColor,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: brand.bundleIdentifier,
      entitlements: {
        'com.apple.developer.networking.multicast': true,
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSLocalNetworkUsageDescription:
          'This app uses the local network to discover and synchronize with HbbTV televisions (DIAL/SSDP).',
        // Keep companion audio playing while the app is in the background.
        UIBackgroundModes: ['audio'],
        // Only declare camera usage when the brand opts in; the string is shown
        // in the on-demand iOS camera permission dialog.
        ...(brand.permissions?.camera
          ? { NSCameraUsageDescription: brand.cameraUsageDescription }
          : {}),
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: brand.assets.adaptiveIcon,
        backgroundColor: brand.splashBackgroundColor,
      },
      edgeToEdgeEnabled: true,
      package: brand.androidPackage,
      versionCode: 2,
      permissions: [
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.CHANGE_WIFI_MULTICAST_STATE',
        // Keep companion audio playing while the app is in the background.
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
        // Required on Android 13+ so the media foreground-service notification is
        // shown; without it the OS may suspend the process (and the DVB-CSS
        // WebSockets/UDP sockets) as soon as the app goes to the background.
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.WAKE_LOCK',
        // Only declared when the brand opts in. The runtime prompt is still
        // shown on-demand (only when the companion web page uses the camera).
        ...(brand.permissions?.camera ? ['android.permission.CAMERA'] : []),
      ],
      usesCleartextTraffic: true,
    },
    web: {
      favicon: brand.assets.favicon,
    },
  },
};
