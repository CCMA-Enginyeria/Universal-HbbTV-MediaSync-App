#!/usr/bin/env node
'use strict';

/**
 * Build-time export of the single brand source (src/brand/brand.config.js),
 * the shared translations and theme tokens into native Android/iOS resources.
 *
 * Usage:
 *   node native/tools/export-brand.cjs --check
 *   node native/tools/export-brand.cjs --print-json
 *   node native/tools/export-brand.cjs --android <outDir>
 *   node native/tools/export-brand.cjs --ios <outDir>
 *   node native/tools/export-brand.cjs --brand <path/to/brand.config.js> ...
 *
 * Outputs are generated (never committed); a fork only edits its brand file.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const LANGUAGES = ['ca', 'es', 'eu', 'en', 'de', 'it', 'fr'];
const OMITTED_KEYS = new Set(['help.brands', 'help.channels']);

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function fail(message) {
  console.error(`export-brand: ${message}`);
  process.exit(1);
}

/** Evaluates one of the app's small ES modules without a bundler. */
function loadEsModule(file, globals) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+default\s+/m, 'module.exports = ');
  const sandbox = { module: { exports: {} }, ...globals };
  vm.runInNewContext(source, sandbox, { filename: file, timeout: 2000 });
  return sandbox.module.exports;
}

function loadInputs() {
  const brandFile = path.resolve(arg('--brand') || path.join(ROOT, 'src/brand/brand.config.js'));
  const brand = require(brandFile);
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const translations = loadEsModule(path.join(ROOT, 'src/i18n/translations.js'), {
    tvBrands: readJson('src/data/tvBrands.json'),
    channelsData: readJson('src/data/channels.json'),
  });
  const theme = loadEsModule(path.join(ROOT, 'src/theme.js'), { brand });
  const nativeStrings = readJson('native/i18n/native-strings.json');
  return { brand, brandFile, translations, theme, nativeStrings };
}

function flatten(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (OMITTED_KEYS.has(name)) continue;
    if (Array.isArray(value)) {
      if (!value.every((item) => typeof item === 'string')) fail(`${name}: only string arrays are exported`);
      out[name] = value;
    } else if (value && typeof value === 'object') {
      flatten(value, name, out);
    } else if (typeof value === 'string') {
      out[name] = value;
    } else {
      fail(`${name}: unsupported value ${JSON.stringify(value)}`);
    }
  }
  return out;
}

const placeholders = (text) => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

/** Merges RN and native strings, then validates keys and placeholders in every language. */
function buildStrings({ translations, nativeStrings, brand }) {
  const defaultLanguage = brand.defaultLanguage;
  if (!LANGUAGES.includes(defaultLanguage)) fail(`defaultLanguage '${defaultLanguage}' is not supported`);
  const strings = {};
  for (const language of LANGUAGES) {
    const shared = translations[language]?.translation;
    if (!shared) fail(`missing translations for '${language}'`);
    if (!nativeStrings[language]) fail(`missing native strings for '${language}'`);
    strings[language] = { ...flatten(shared), ...flatten({ native: nativeStrings[language] }) };
  }
  const errors = [];
  const reference = strings[defaultLanguage];
  for (const language of LANGUAGES) {
    const table = strings[language];
    for (const key of Object.keys(reference)) {
      if (!(key in table)) errors.push(`${language}: missing '${key}'`);
      else if (Array.isArray(reference[key]) !== Array.isArray(table[key])) errors.push(`${language}: '${key}' type differs`);
      else if (!Array.isArray(table[key])) {
        const expected = [...new Set(placeholders(reference[key]))].sort().join(',');
        const actual = [...new Set(placeholders(table[key]))].sort().join(',');
        if (expected !== actual) errors.push(`${language}: '${key}' placeholders {${actual}} != {${expected}}`);
      }
    }
    for (const key of Object.keys(table)) {
      if (!(key in reference)) errors.push(`${language}: unexpected '${key}'`);
    }
  }
  if (errors.length) fail(`translation check failed:\n  ${errors.join('\n  ')}`);
  return strings;
}

function brandSummary({ brand, theme }) {
  const [major = 0, minor = 0, patch = 0] = String(brand.version).split('.').map((part) => parseInt(part, 10) || 0);
  const versionCode = Number(process.env.MEDIASYNC_VERSION_CODE) || major * 10000 + minor * 100 + patch;
  for (const [key, pattern] of [['androidPackage', /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/], ['bundleIdentifier', /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/], ['scheme', /^[a-z][a-z0-9+.-]*$/]]) {
    if (!pattern.test(brand[key] || '')) fail(`brand.${key} is invalid: ${brand[key]}`);
  }
  for (const key of ['syncWebPlayerUrl', 'supportUrl', 'defaultContentUrl']) {
    if (brand[key] != null && !/^https?:\/\//.test(brand[key])) fail(`brand.${key} must be an http(s) URL`);
  }
  return {
    appName: brand.appName,
    shortName: brand.shortName,
    version: brand.version,
    versionCode,
    scheme: brand.scheme,
    androidPackage: brand.androidPackage,
    bundleIdentifier: brand.bundleIdentifier,
    defaultLanguage: brand.defaultLanguage,
    languages: LANGUAGES,
    app2appChannel: brand.app2appChannel,
    defaultContentUrl: brand.defaultContentUrl ?? null,
    syncWebPlayerUrl: brand.syncWebPlayerUrl ?? null,
    supportUrl: brand.supportUrl ?? null,
    cameraEnabled: !!brand.permissions?.camera,
    cameraUsageDescription: brand.cameraUsageDescription ?? '',
    splashBackgroundColor: brand.splashBackgroundColor,
    colors: theme.colors,
    spacing: theme.spacing,
    radius: theme.radius,
  };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && Buffer.isBuffer(content) === false && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content);
}

function copyAsset(relative, destination, brandFile) {
  const source = path.resolve(path.dirname(brandFile), '..', '..', relative);
  const fallback = path.resolve(ROOT, relative);
  const file = fs.existsSync(source) ? source : fallback;
  if (!fs.existsSync(file)) fail(`asset not found: ${relative}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}

const argb = (hex) => {
  const value = String(hex).replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) fail(`invalid color ${hex}`);
  return `0xFF${value.toUpperCase()}`;
};

function androidName(key) {
  return key.replace(/[^A-Za-z0-9_]/g, '_');
}

function androidText(text, formatted) {
  let value = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/'/g, "\\'").replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  if (/^[@?]/.test(value)) value = `\\${value}`;
  if (formatted) value = value.replace(/%/g, '%%');
  return value;
}

function exportAndroid(outDir, inputs, strings, summary) {
  const reference = strings[summary.defaultLanguage];
  const order = Object.fromEntries(Object.entries(reference).map(([key, value]) =>
    [key, Array.isArray(value) ? [] : [...new Set(placeholders(value))]]));
  const names = new Map();
  for (const key of Object.keys(reference)) {
    const name = androidName(key);
    if (names.has(name)) fail(`Android resource name collision: ${key} / ${names.get(name)}`);
    names.set(name, key);
  }
  for (const language of LANGUAGES) {
    const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<!-- Generated by native/tools/export-brand.cjs. Do not edit. -->', '<resources>'];
    for (const [key, value] of Object.entries(strings[language])) {
      const name = androidName(key);
      if (Array.isArray(value)) {
        lines.push(`    <string-array name="${name}">`);
        value.forEach((item) => lines.push(`        <item>${androidText(item, false)}</item>`));
        lines.push('    </string-array>');
      } else {
        const args = order[key];
        let text = androidText(value, args.length > 0);
        args.forEach((placeholder, index) => {
          text = text.replace(new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`, 'g'), `%${index + 1}$s`);
        });
        lines.push(`    <string name="${name}">${text}</string>`);
      }
    }
    lines.push('</resources>', '');
    const folder = language === summary.defaultLanguage ? 'values' : `values-${language}`;
    write(path.join(outDir, 'res', folder, 'strings.xml'), lines.join('\n'));
  }
  const brandXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Generated by native/tools/export-brand.cjs. Do not edit. -->',
    '<resources>',
    `    <string name="app_name" translatable="false">${androidText(summary.appName, false)}</string>`,
    `    <color name="splash_background">#${summary.splashBackgroundColor.replace('#', '').toUpperCase()}</color>`,
    `    <color name="ic_launcher_background">#${summary.splashBackgroundColor.replace('#', '').toUpperCase()}</color>`,
    ...Object.entries(summary.colors).map(([name, value]) => `    <color name="theme_${androidName(name)}">${value}</color>`),
    '</resources>',
    '',
  ].join('\n');
  write(path.join(outDir, 'res', 'values', 'brand.xml'), brandXml);
  write(path.join(outDir, 'res', 'xml', 'locales_config.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">',
    ...[summary.defaultLanguage, ...LANGUAGES.filter((l) => l !== summary.defaultLanguage)].map((l) => `    <locale android:name="${l}"/>`),
    '</locale-config>',
    '',
  ].join('\n'));
  write(path.join(outDir, 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@color/ic_launcher_background"/>',
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
    '</adaptive-icon>',
    '',
  ].join('\n'));
  const { brand, brandFile } = inputs;
  copyAsset(brand.assets.icon, path.join(outDir, 'res', 'mipmap-xxxhdpi', 'ic_launcher.png'), brandFile);
  copyAsset(brand.assets.adaptiveIcon, path.join(outDir, 'res', 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'), brandFile);
  copyAsset(brand.assets.splashImage, path.join(outDir, 'res', 'drawable-nodpi', 'splash_icon.png'), brandFile);

  const kotlinString = (value) => (value == null ? 'null' : JSON.stringify(value).replace(/\$/g, '\\$'));
  const kotlin = [
    '// Generated by native/tools/export-brand.cjs from the brand configuration. Do not edit.',
    'package mediasync.app.brand',
    '',
    'object BrandConfig {',
    `    const val APP_NAME: String = ${kotlinString(summary.appName)}`,
    `    const val SHORT_NAME: String = ${kotlinString(summary.shortName)}`,
    `    const val VERSION: String = ${kotlinString(summary.version)}`,
    `    const val SCHEME: String = ${kotlinString(summary.scheme)}`,
    `    const val APP2APP_CHANNEL: String = ${kotlinString(summary.app2appChannel)}`,
    `    val DEFAULT_CONTENT_URL: String? = ${kotlinString(summary.defaultContentUrl)}`,
    `    val SYNC_WEB_PLAYER_URL: String? = ${kotlinString(summary.syncWebPlayerUrl)}`,
    `    val SUPPORT_URL: String? = ${kotlinString(summary.supportUrl)}`,
    `    const val CAMERA_ENABLED: Boolean = ${summary.cameraEnabled}`,
    `    const val DEFAULT_LANGUAGE: String = ${kotlinString(summary.defaultLanguage)}`,
    `    val LANGUAGES: List<String> = listOf(${LANGUAGES.map(kotlinString).join(', ')})`,
    '    val COLORS: Map<String, Long> = mapOf(',
    ...Object.entries(summary.colors).map(([name, value]) => `        ${kotlinString(name)} to ${argb(value)},`),
    '    )',
    '    val SPACING: Map<String, Int> = mapOf(',
    ...Object.entries(summary.spacing).map(([name, value]) => `        ${kotlinString(name)} to ${Number(value)},`),
    '    )',
    '    val RADIUS: Map<String, Int> = mapOf(',
    ...Object.entries(summary.radius).map(([name, value]) => `        ${kotlinString(name)} to ${Number(value)},`),
    '    )',
    '}',
    '',
  ].join('\n');
  write(path.join(outDir, 'kotlin', 'mediasync', 'app', 'brand', 'BrandConfig.kt'), kotlin);
}

function iosText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function exportIos(outDir, inputs, strings, summary) {
  const reference = strings[summary.defaultLanguage];
  for (const language of LANGUAGES) {
    const lines = ['/* Generated by native/tools/export-brand.cjs. Do not edit. */'];
    for (const [key, value] of Object.entries(strings[language])) {
      if (Array.isArray(value)) {
        lines.push(`"${key}.count" = "${value.length}";`);
        value.forEach((item, index) => lines.push(`"${key}.${index}" = "${iosText(item)}";`));
        continue;
      }
      const args = [...new Set(placeholders(reference[key]))];
      let text = iosText(args.length ? value.replace(/%/g, '%%') : value);
      args.forEach((placeholder, index) => {
        text = text.replace(new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`, 'g'), `%${index + 1}$@`);
      });
      lines.push(`"${key}" = "${text}";`);
    }
    write(path.join(outDir, `${language}.lproj`, 'Localizable.strings'), `${lines.join('\n')}\n`);
    write(path.join(outDir, `${language}.lproj`, 'InfoPlist.strings'), [
      '/* Generated by native/tools/export-brand.cjs. Do not edit. */',
      `"CFBundleDisplayName" = "${iosText(summary.appName)}";`,
      `"NSLocalNetworkUsageDescription" = "${iosText(strings[language]['native.discovery.permissionMessage'])}";`,
      ...(summary.cameraEnabled ? [`"NSCameraUsageDescription" = "${iosText(summary.cameraUsageDescription)}";`] : []),
      '',
    ].join('\n'));
  }
  const xcconfig = [
    '// Generated by native/tools/export-brand.cjs. Do not edit.',
    `BRAND_BUNDLE_IDENTIFIER = ${summary.bundleIdentifier}`,
    `BRAND_DISPLAY_NAME = ${summary.appName}`,
    `BRAND_MARKETING_VERSION = ${summary.version}`,
    `BRAND_BUILD_NUMBER = ${summary.versionCode}`,
    `BRAND_URL_SCHEME = ${summary.scheme}`,
    `BRAND_DEVELOPMENT_LANGUAGE = ${summary.defaultLanguage}`,
    `BRAND_CAMERA_USAGE = ${summary.cameraEnabled ? summary.cameraUsageDescription.replace(/[\r\n]/g, ' ') : ''}`,
    '',
  ].join('\n');
  write(path.join(outDir, 'Brand.xcconfig'), xcconfig);
  const plistValue = (value, indent) => {
    const pad = '  '.repeat(indent);
    if (Array.isArray(value)) return `${pad}<array>\n${value.map((item) => plistValue(item, indent + 1)).join('\n')}\n${pad}</array>`;
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).map(([key, item]) => `${pad}  <key>${key}</key>\n${plistValue(item, indent + 1)}`);
      return `${pad}<dict>\n${entries.join('\n')}\n${pad}</dict>`;
    }
    if (typeof value === 'boolean') return `${pad}<${value}/>`;
    return `${pad}<string>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string>`;
  };
  const info = {
    CFBundleDevelopmentRegion: summary.defaultLanguage,
    CFBundleDisplayName: summary.appName,
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleLocalizations: LANGUAGES,
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    CFBundleURLTypes: [{ CFBundleURLName: summary.bundleIdentifier, CFBundleURLSchemes: [summary.scheme] }],
    ITSAppUsesNonExemptEncryption: false,
    LSRequiresIPhoneOS: true,
    // Televisions are reached by LAN IP over HTTP/WS; media CDNs may still use HTTP.
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoadsForMedia: true },
    NSLocalNetworkUsageDescription: strings[summary.defaultLanguage]['native.discovery.permissionMessage'],
    ...(summary.cameraEnabled ? { NSCameraUsageDescription: summary.cameraUsageDescription } : {}),
    UIBackgroundModes: ['audio'],
    UILaunchScreen: { UIColorName: 'SplashBackground', UIImageName: 'SplashIcon', UIImageRespectsSafeAreaInsets: true },
    UIRequiresFullScreen: false,
    UIStatusBarStyle: 'UIStatusBarStyleLightContent',
    UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
    'UISupportedInterfaceOrientations~ipad': ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
    UIUserInterfaceStyle: 'Dark',
  };
  const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(body, 0)}\n</plist>\n`;
  write(path.join(outDir, 'Info.plist'), plist(info));
  // Physical-device multicast needs Apple's approved entitlement (see native/README.md).
  write(path.join(outDir, 'MediaSync.entitlements'), plist({ 'com.apple.developer.networking.multicast': true }));
  const swiftString = (value) => (value == null ? 'nil' : JSON.stringify(value));
  const hex = (value) => `0x${String(value).replace('#', '').toUpperCase()}`;
  write(path.join(outDir, 'BrandConfig.swift'), [
    '// Generated by native/tools/export-brand.cjs from the brand configuration. Do not edit.',
    'enum BrandConfig {',
    `    static let appName = ${swiftString(summary.appName)}`,
    `    static let shortName = ${swiftString(summary.shortName)}`,
    `    static let version = ${swiftString(summary.version)}`,
    `    static let scheme = ${swiftString(summary.scheme)}`,
    `    static let app2appChannel = ${swiftString(summary.app2appChannel)}`,
    `    static let defaultContentUrl: String? = ${swiftString(summary.defaultContentUrl)}`,
    `    static let syncWebPlayerUrl: String? = ${swiftString(summary.syncWebPlayerUrl)}`,
    `    static let supportUrl: String? = ${swiftString(summary.supportUrl)}`,
    `    static let cameraEnabled = ${summary.cameraEnabled}`,
    `    static let defaultLanguage = ${swiftString(summary.defaultLanguage)}`,
    `    static let languages = [${LANGUAGES.map(swiftString).join(', ')}]`,
    '    static let colors: [String: UInt32] = [',
    ...Object.entries(summary.colors).map(([name, value]) => `        ${swiftString(name)}: ${hex(value)},`),
    '    ]',
    '    static let spacing: [String: Double] = [',
    ...Object.entries(summary.spacing).map(([name, value]) => `        ${swiftString(name)}: ${Number(value)},`),
    '    ]',
    '    static let radius: [String: Double] = [',
    ...Object.entries(summary.radius).map(([name, value]) => `        ${swiftString(name)}: ${Number(value)},`),
    '    ]',
    '}',
    '',
  ].join('\n'));
  const assets = path.join(outDir, 'Brand.xcassets');
  write(path.join(assets, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2));
  write(path.join(assets, 'AppIcon.appiconset', 'Contents.json'), JSON.stringify({
    images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2));
  copyAsset(inputs.brand.assets.icon, path.join(assets, 'AppIcon.appiconset', 'icon-1024.png'), inputs.brandFile);
  write(path.join(assets, 'SplashIcon.imageset', 'Contents.json'), JSON.stringify({
    images: [{ filename: 'splash.png', idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2));
  copyAsset(inputs.brand.assets.splashImage, path.join(assets, 'SplashIcon.imageset', 'splash.png'), inputs.brandFile);
  const color = summary.splashBackgroundColor.replace('#', '');
  const component = (offset) => (parseInt(color.substr(offset, 2), 16) / 255).toFixed(3);
  write(path.join(assets, 'SplashBackground.colorset', 'Contents.json'), JSON.stringify({
    colors: [{ idiom: 'universal', color: { 'color-space': 'srgb', components: { red: component(0), green: component(2), blue: component(4), alpha: '1.000' } } }],
    info: { author: 'xcode', version: 1 },
  }, null, 2));
}

function main() {
  const inputs = loadInputs();
  const strings = buildStrings(inputs);
  const summary = brandSummary(inputs);
  if (process.argv.includes('--print-json')) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }
  const android = arg('--android');
  const ios = arg('--ios');
  if (android) exportAndroid(path.resolve(android), inputs, strings, summary);
  if (ios) exportIos(path.resolve(ios), inputs, strings, summary);
  if (process.argv.includes('--check') || (!android && !ios)) {
    const count = Object.keys(strings[summary.defaultLanguage]).length;
    console.log(`Brand '${summary.appName}' OK: ${count} keys in ${LANGUAGES.length} languages, placeholders consistent.`);
  }
}

main();
