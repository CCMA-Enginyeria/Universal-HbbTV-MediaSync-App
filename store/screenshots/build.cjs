#!/usr/bin/env node
/**
 * Renders the store screenshots: every panel of `stage.html` (one continuous
 * background across all panels) at the store size, per platform and language.
 *
 * Usage: node store/screenshots/build.cjs [--platform android|ios|ipad] [--lang en,ca] [--preview]
 * Output: store/screenshots/out/<platform>/<lang>/<n>.png
 *         (--preview also writes out/<platform>/<lang>/strip.png with all panels)
 *
 * Needs a Chromium browser (Chrome or Edge); override with CHROME_PATH.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');
const brand = require(path.join(ROOT, 'src/brand/brand.config.js'));
const SIZES = { android: [1080, 1920], ios: [1284, 2778], ipad: [2064, 2752] };
const LANGS = ['en', 'ca', 'es', 'eu', 'de', 'it', 'fr'];
const PANELS = 4;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    // Edge first on Windows: headless Chrome exits early while a managed
    // Chrome profile is open.
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  return found;
}

/** Reads width/height from the PNG IHDR chunk. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const browser = findBrowser();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'store-shots-'));
const stage = pathToFileURL(path.join(__dirname, 'stage.html')).href;
const hash = encodeURIComponent(JSON.stringify({
  appName: brand.appName,
  background: brand.colors?.background,
  primary: brand.colors?.primary,
}));

function render(platform, lang, slice, out) {
  const [w, h] = SIZES[platform];
  const width = slice === 'all' ? w * PANELS : w;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', '--virtual-time-budget=3000',
    `--user-data-dir=${profile}`, `--window-size=${width},${h}`, `--screenshot=${out}`,
    `${stage}?platform=${platform}&lang=${lang}&slice=${slice}#${hash}`,
  ], { stdio: 'ignore' });
  const [ow, oh] = pngSize(out);
  if (ow !== width || oh !== h) throw new Error(`${out} is ${ow}x${oh}, expected ${width}x${h}`);
  console.log(path.relative(ROOT, out));
}

const platforms = arg('platform') ? [arg('platform')] : Object.keys(SIZES);
const langs = arg('lang') ? arg('lang').split(',') : LANGS;
for (const platform of platforms) {
  for (const lang of langs) {
    const dir = path.join(__dirname, 'out', platform, lang);
    for (let i = 0; i < PANELS; i++) render(platform, lang, i, path.join(dir, `${i + 1}.png`));
    if (process.argv.includes('--preview')) render(platform, lang, 'all', path.join(dir, 'strip.png'));
  }
}
fs.rmSync(profile, { recursive: true, force: true });
