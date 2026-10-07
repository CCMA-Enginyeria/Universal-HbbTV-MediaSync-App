#!/usr/bin/env node
/**
 * Renders the Meta Horizon Store art for the Meta Quest listing with headless
 * Edge/Chrome (`art.html`), then re-encodes every file to the exact format the
 * Developer Dashboard asks for (24-bit PNG, except the 32-bit transparent logo).
 *
 * Usage: node store/meta-quest/build.cjs [--only hero,icon,...]
 * Output: store/meta-quest/out/<asset>.png and out/screenshots/<n>.png
 *
 * Screenshots must be real captures from the headset (VRC.Quest.Asset.5): put
 * them in store/meta-quest/captures/ (see capture.sh); each one is letterboxed
 * to 2560x1440 without adding any text. Needs a Chromium browser (Chrome or
 * Edge); override with CHROME_PATH.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out');
const CAPTURES = path.join(__dirname, 'captures');
const brand = require(path.join(ROOT, 'src/brand/brand.config.js'));

/** Meta Horizon Store asset sizes (developers.meta.com/horizon/resources/asset-guidelines). */
const ASSETS = {
  hero: [3000, 900],
  landscape: [2560, 1440],
  square: [1440, 1440],
  portrait: [1008, 1440],
  mini: [1080, 360],
  icon: [512, 512],
  logo: [4800, 1000], // transparent; trimmed to its content afterwards (max 9000x1440)
};
const SCREENSHOT = [2560, 1440];
const SCREENSHOT_COUNT = 5;

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

// ---- Minimal PNG codec (8-bit, non-interlaced: what Chrome and the brand icon use)

function readPng(file) {
  const b = fs.readFileSync(file);
  let pos = 8;
  let width, height, colorType, depth, interlace;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = { 2: 3, 6: 4 }[colorType];
  if (depth !== 8 || !channels || interlace) throw new Error(`${file}: unsupported PNG (depth ${depth}, color ${colorType}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const up = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) px[(y * width + x) * 4 + k] = line[x * channels + k];
      px[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Writes RGBA pixels as a 24-bit (alpha = false, flattened on black) or 32-bit PNG. */
function writePng(file, { width, height, px }, alpha) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * channels + 1);
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = row + 1 + x * channels;
      const a = alpha ? 255 : px[s + 3];
      for (let k = 0; k < 3; k++) raw[d + k] = Math.round((px[s + k] * a) / 255);
      if (alpha) raw[d + 3] = px[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** Crops an image to the bounding box of its non-transparent pixels plus a margin. */
function trim(img, margin) {
  const { width, height, px } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
  x1 = Math.min(width - 1, x1 + margin); y1 = Math.min(height - 1, y1 + margin);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) px.copy(out, y * w * 4, ((y + y0) * width + x0) * 4, ((y + y0) * width + x1 + 1) * 4);
  return { width: w, height: h, px: out };
}

/**
 * Lifts the emblem off the icon's solid background (un-premultiplies against
 * the background colour), so covers and the transparent logo can use it.
 */
function iconGlyph(iconFile) {
  const img = readPng(iconFile);
  const { px } = img;
  const bg = [px[0], px[1], px[2]];
  for (let i = 0; i < px.length; i += 4) {
    let a = 0;
    for (let k = 0; k < 3; k++) {
      const c = px[i + k];
      a = Math.max(a, c >= bg[k] ? (c - bg[k]) / (255 - bg[k]) : (bg[k] - c) / bg[k]);
    }
    for (let k = 0; k < 3; k++) {
      px[i + k] = a > 0 ? Math.max(0, Math.min(255, Math.round((px[i + k] - (1 - a) * bg[k]) / a))) : 0;
    }
    px[i + 3] = Math.round(a * 255);
  }
  return trim(img, 4);
}

// ---- Rendering ---------------------------------------------------------------

const browser = findBrowser();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-art-'));
const page = pathToFileURL(path.join(__dirname, 'art.html')).href;
const glyphFile = path.join(profile, 'glyph.png');
writePng(glyphFile, iconGlyph(path.join(ROOT, brand.assets.icon)), true);
const hash = encodeURIComponent(JSON.stringify({
  appName: brand.appName,
  background: brand.colors?.background,
  glyph: pathToFileURL(glyphFile).href,
  icon: pathToFileURL(path.join(ROOT, brand.assets.icon)).href,
}));

function render(params, [w, h], transparent) {
  const shot = path.join(profile, 'shot.png');
  const query = new URLSearchParams({ ...params, w, h }).toString();
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', '--virtual-time-budget=3000',
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--user-data-dir=${profile}`, `--window-size=${w},${h}`, `--screenshot=${shot}`,
    `${page}?${query}#${hash}`,
  ], { stdio: 'ignore' });
  const img = readPng(shot);
  if (img.width !== w || img.height !== h) throw new Error(`${params.asset} rendered ${img.width}x${img.height}, expected ${w}x${h}`);
  return img;
}

function save(name, img, alpha) {
  const file = path.join(OUT, name);
  writePng(file, img, alpha);
  console.log(`${path.relative(ROOT, file)}  ${img.width}x${img.height} ${alpha ? '32' : '24'}-bit`);
}

const only = arg('only') ? arg('only').split(',') : [...Object.keys(ASSETS), 'screenshots'];
for (const name of Object.keys(ASSETS).filter((a) => only.includes(a))) {
  const logo = name === 'logo';
  const img = render({ asset: name }, ASSETS[name], logo);
  save(`${name}.png`, logo ? trim(img, 24) : img, logo);
}

if (only.includes('screenshots')) {
  const shots = fs.existsSync(CAPTURES)
    ? fs.readdirSync(CAPTURES).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
    : [];
  shots.forEach((file, i) => {
    const img = render({ asset: 'screenshot', shot: pathToFileURL(path.join(CAPTURES, file)).href }, SCREENSHOT, false);
    save(path.join('screenshots', `${i + 1}.png`), img, false);
  });
  if (shots.length !== SCREENSHOT_COUNT) {
    console.warn(`! ${shots.length} capture(s) in ${path.relative(ROOT, CAPTURES)}; the store needs exactly ${SCREENSHOT_COUNT} (see capture.sh).`);
  }
}
fs.rmSync(profile, { recursive: true, force: true });
