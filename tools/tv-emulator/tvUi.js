'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_FILES = {
  '/tv': ['index.html', 'text/html; charset=utf-8'],
  '/tv/': ['index.html', 'text/html; charset=utf-8'],
  '/tv/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/tv/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/tv/fallback.jpg': ['../../../assets/preview.jpg', 'image/jpeg'],
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createTvUiHandler({ tvState, catalog, getConnections, log = console.log }) {
  return function handleTvUi(req, res) {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(302, { Location: '/tv' });
      res.end();
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, {
        ...tvState.getSnapshot(),
        catalog,
        connections: getConnections(),
      });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/state') {
      readJson(req)
        .then((patch) => {
          const previous = tvState.getSnapshot();
          const allowed = {};
          ['contentId', 'mode', 'positionSeconds', 'paused', 'playbackRate'].forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
          });
          const snapshot = tvState.update(allowed);
          if (snapshot.mode !== previous.mode ||
              snapshot.contentId !== previous.contentId ||
              snapshot.paused !== previous.paused) {
            log(`[TV] ${snapshot.mode} | ${snapshot.paused ? 'paused' : 'playing'} | ${snapshot.contentId}`);
          }
          sendJson(res, 200, snapshot);
        })
        .catch((err) => sendJson(res, 400, { error: err.message }));
      return true;
    }

    const staticFile = STATIC_FILES[pathname];
    if (req.method === 'GET' && staticFile) {
      try {
        const body = fs.readFileSync(path.join(PUBLIC_DIR, staticFile[0]));
        res.writeHead(200, {
          'Content-Type': staticFile[1],
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    return false;
  };
}

module.exports = { createTvUiHandler };