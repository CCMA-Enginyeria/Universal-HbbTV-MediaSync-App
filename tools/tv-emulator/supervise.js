'use strict';

/**
 * Keeps the TV emulator alive for unattended demos: runs `index.js` as a child
 * and restarts it when it exits, when its HTTP server stops answering, when
 * its SSDP socket stops answering M-SEARCH (it can lose the multicast
 * membership), or when the LAN IPv4 changes (the emulator advertises the
 * address it started with, so phones would find it but fail to connect).
 *
 * Usage: npm run supervise   (same EMU_* variables as index.js)
 */

const dgram = require('dgram');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { getLocalIPv4 } = require('./net');
const { SSDP_MULTICAST_ADDRESS, SSDP_PORT, DIAL_SEARCH_TARGET } = require('./ssdp');

const HTTP_PORT = parseInt(process.env.EMU_HTTP_PORT || '7681', 10);
const CHECK_INTERVAL_MS = 5000;
const SSDP_CHECK_EVERY = 6; // every 30 s, so the probe does not flood the log
const MAX_FAILURES = 3;
const RESTART_DELAY_MS = 2000;

let child = null;
let childIp = null;
let failures = 0;
let ssdpFailures = 0;
let ssdpVerified = false;
let checks = 0;
let stopping = false;

function log(msg) {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`${ts} [SUPERVISOR] ${msg}`);
}

function currentIp() {
  return getLocalIPv4(process.env.EMU_IP);
}

function start() {
  childIp = currentIp();
  failures = 0;
  ssdpFailures = 0;
  ssdpVerified = false;
  checks = 0;
  log(`starting emulator on ${childIp}`);
  child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: { ...process.env, EMU_IP: childIp },
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    log(`emulator exited (${signal || code}); restarting`);
    setTimeout(start, RESTART_DELAY_MS);
  });
}

/** Kills the child; its exit handler starts a fresh one. */
function restart(reason) {
  if (!child) return;
  log(`restarting: ${reason}`);
  child.kill('SIGKILL');
}

function checkHttp() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: HTTP_PORT, path: '/api/state', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/** Sends a DIAL M-SEARCH on the LAN interface and waits for the emulator's reply. */
function checkSsdp(ip) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const done = (ok) => { clearTimeout(timer); try { socket.close(); } catch (_) {} resolve(ok); };
    const timer = setTimeout(() => done(false), 3000);
    socket.on('message', (msg) => {
      if (msg.toString().includes(`:${HTTP_PORT}/`)) done(true);
    });
    socket.on('error', () => done(false));
    socket.bind(0, ip, () => {
      const search = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_MULTICAST_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 1',
        `ST: ${DIAL_SEARCH_TARGET}`,
        '', '',
      ].join('\r\n');
      socket.send(search, SSDP_PORT, SSDP_MULTICAST_ADDRESS, (err) => { if (err) done(false); });
    });
  });
}

async function check() {
  if (!child) return;
  const ip = currentIp();
  if (ip !== childIp) {
    restart(`LAN address changed ${childIp} -> ${ip}`);
    return;
  }

  failures = (await checkHttp()) ? 0 : failures + 1;
  if (failures >= MAX_FAILURES) {
    restart('HTTP server not responding');
    return;
  }

  checks += 1;
  if (checks % SSDP_CHECK_EVERY !== 1) return;
  if (await checkSsdp(ip)) {
    ssdpVerified = true;
    ssdpFailures = 0;
  } else if (ssdpVerified) {
    // Only trusted once the probe has worked: some networks never loop multicast back.
    ssdpFailures += 1;
    if (ssdpFailures >= 2) restart('SSDP not answering M-SEARCH');
  }
}

function stop() {
  stopping = true;
  if (child) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start();
setInterval(() => { check().catch(() => {}); }, CHECK_INTERVAL_MS);
