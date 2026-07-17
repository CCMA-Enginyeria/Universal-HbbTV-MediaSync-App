#!/usr/bin/env node
/**
 * sync-dashboard — live DVB-CSS sync dashboard (dev tool).
 *
 * Ingests the app's compact telemetry lines (marker `SYNCTEL`) from
 * `adb logcat` (or from stdin) and serves a real-time web dashboard over
 * Server-Sent Events (SSE). Zero runtime dependencies — Node built-ins only.
 *
 * Usage:
 *   node index.js                 # spawn `adb logcat` and serve on :4599
 *   node index.js --port 8080     # custom HTTP port
 *   node index.js --device XYZ    # target a specific adb device (adb -s XYZ)
 *   node index.js --clear         # `adb logcat -c` before reading
 *   node index.js --stdin         # read logs from stdin instead of adb
 *                                 #   e.g. npx react-native log-android | node index.js --stdin
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// --- CLI args ---------------------------------------------------------------
function parseArgs(argv) {
  const args = { port: 4599, device: null, clear: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') args.port = parseInt(argv[++i], 10) || args.port;
    else if (a === '--device' || a === '-d') args.device = argv[++i] || null;
    else if (a === '--clear' || a === '-c') args.clear = true;
    else if (a === '--stdin' || a === '-i') args.stdin = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`sync-dashboard — live DVB-CSS sync dashboard

Options:
  -p, --port <n>     HTTP port (default 4599)
  -d, --device <id>  adb device serial (adb -s <id>)
  -c, --clear        clear the logcat buffer before reading (adb logcat -c)
  -i, --stdin        read logs from stdin instead of spawning adb
  -h, --help         show this help
`);
}

const args = parseArgs(process.argv.slice(2));

// --- Telemetry marker -------------------------------------------------------
// The app prints:  📈 SYNCTEL {"v":1,...}
// Different logcat formats prefix this with timestamps/pid/tag, so we just look
// for the marker and take the JSON object that follows.
const MARKER = 'SYNCTEL ';

// --- SSE clients ------------------------------------------------------------
/** @type {Set<import('http').ServerResponse>} */
const clients = new Set();
// Keep the last record per player so freshly-connected browsers get an instant
// snapshot instead of waiting for the next tick.
const lastByKind = new Map();

function broadcast(record) {
  const data = `data: ${JSON.stringify(record)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch (_) { /* client gone; cleaned up on close */ }
  }
}

function handleLine(line) {
  const idx = line.indexOf(MARKER);
  if (idx === -1) return;
  const jsonStr = line.slice(idx + MARKER.length).trim();
  let record;
  try {
    record = JSON.parse(jsonStr);
  } catch (_) {
    return; // partial / malformed line; ignore
  }
  // Stamp arrival time so the dashboard can compute freshness even if device
  // and host clocks differ.
  record._rx = Date.now();
  if (record.k) lastByKind.set(record.k, record);
  broadcast(record);
}

// --- Log source -------------------------------------------------------------
let logProc = null;

function startLogSource() {
  if (args.stdin) {
    console.log('[sync-dashboard] reading telemetry from stdin');
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', handleLine);
    rl.on('close', () => console.log('[sync-dashboard] stdin closed'));
    return;
  }

  const adbBase = args.device ? ['-s', args.device] : [];

  if (args.clear) {
    try {
      spawn('adb', [...adbBase, 'logcat', '-c']).on('close', spawnLogcat);
    } catch (e) {
      console.error('[sync-dashboard] failed to clear logcat:', e.message);
      spawnLogcat();
    }
  } else {
    spawnLogcat();
  }

  function spawnLogcat() {
    // `-v tag` keeps lines compact; we match the marker regardless of format.
    const cmdArgs = [...adbBase, 'logcat', '-v', 'tag'];
    console.log(`[sync-dashboard] spawning: adb ${cmdArgs.join(' ')}`);
    logProc = spawn('adb', cmdArgs);

    const rl = readline.createInterface({ input: logProc.stdout });
    rl.on('line', handleLine);

    logProc.stderr.on('data', (d) => process.stderr.write(`[adb] ${d}`));
    logProc.on('error', (err) => {
      console.error('[sync-dashboard] failed to run adb. Is it on PATH and a device connected?');
      console.error('   ', err.message);
      console.error('   Tip: use --stdin and pipe logs in, e.g. npx react-native log-android | node index.js --stdin');
    });
    logProc.on('close', (code) => {
      console.warn(`[sync-dashboard] adb logcat exited (code ${code}). Reconnecting in 2s...`);
      setTimeout(spawnLogcat, 2000);
    });
  }
}

// --- HTTP server ------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // Prevent path traversal.
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    // Send current snapshot immediately.
    for (const record of lastByKind.values()) {
      res.write(`data: ${JSON.stringify(record)}\n\n`);
    }
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  serveStatic(req, res);
});

// SSE keep-alive comment every 20s so proxies/browsers don't drop the stream.
setInterval(() => {
  for (const res of clients) {
    try { res.write(': ping\n\n'); } catch (_) { /* ignore */ }
  }
}, 20000);

server.listen(args.port, () => {
  console.log(`[sync-dashboard] open http://localhost:${args.port}`);
  startLogSource();
});
