'use strict';

const { WebSocket, WebSocketServer } = require('ws');

/**
 * Pairs a browser-side HbbTV App2App server socket with a remote companion
 * socket and relays frames unchanged between them.
 */
function createApp2AppBroker({ localPrefix, remotePrefix, log = console.log }) {
  const localWss = new WebSocketServer({ noServer: true });
  const remoteWss = new WebSocketServer({ noServer: true });
  const waiting = { local: new Map(), remote: new Map() };

  function queue(side, channel, ws) {
    const entries = waiting[side].get(channel) || [];
    entries.push(ws);
    waiting[side].set(channel, entries);
  }

  function removeQueued(side, channel, ws) {
    const entries = waiting[side].get(channel) || [];
    waiting[side].set(channel, entries.filter((entry) => entry !== ws));
  }

  function takeOpen(side, channel) {
    const entries = waiting[side].get(channel) || [];
    while (entries.length > 0) {
      const ws = entries.shift();
      if (ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  function pair(channel) {
    const local = takeOpen('local', channel);
    const remote = takeOpen('remote', channel);
    if (!local || !remote) {
      if (local) queue('local', channel, local);
      if (remote) queue('remote', channel, remote);
      return;
    }

    local.app2appPeer = remote;
    remote.app2appPeer = local;
    local.app2appChannel = channel;
    remote.app2appChannel = channel;
    local.send('pairingcompleted');
    remote.send('pairingcompleted');
    log(`[APP2APP] paired ${channel}`);
  }

  function register(side, ws, channel) {
    ws.app2appSide = side;
    ws.app2appChannel = channel;
    queue(side, channel, ws);

    ws.on('message', (data, isBinary) => {
      const peer = ws.app2appPeer;
      if (peer && peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
    });
    ws.on('close', () => {
      removeQueued(side, channel, ws);
      const peer = ws.app2appPeer;
      ws.app2appPeer = null;
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.app2appPeer = null;
        peer.close(1012, 'App2App peer disconnected');
      }
    });
    ws.on('error', () => {});
    pair(channel);
  }

  localWss.on('connection', (ws, req, channel) => register('local', ws, channel));
  remoteWss.on('connection', (ws, req, channel) => register('remote', ws, channel));

  function route(pathname, req, socket, head) {
    const route = pathname.startsWith(`${localPrefix}/`)
      ? { side: 'local', prefix: localPrefix, server: localWss }
      : pathname.startsWith(`${remotePrefix}/`)
        ? { side: 'remote', prefix: remotePrefix, server: remoteWss }
        : null;
    if (!route) return false;

    const channel = pathname.slice(route.prefix.length + 1);
    if (!channel) return false;
    route.server.handleUpgrade(req, socket, head, (ws) => {
      route.server.emit('connection', ws, req, channel);
    });
    return true;
  }

  function getRemoteConnectionCount(channel) {
    let count = 0;
    remoteWss.clients.forEach((client) => {
      if (client.app2appChannel === channel && client.app2appPeer) count += 1;
    });
    return count;
  }

  function closeRemote(reason = 'TV emulator mode changed') {
    remoteWss.clients.forEach((client) => client.close(1012, reason));
  }

  return { closeRemote, getRemoteConnectionCount, route };
}

module.exports = { createApp2AppBroker };