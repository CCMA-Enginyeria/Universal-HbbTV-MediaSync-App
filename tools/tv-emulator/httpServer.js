'use strict';

const http = require('http');

/**
 * HTTP + DIAL server for the emulated TV.
 *
 * Two responsibilities, both consumed by src/services/DIALDiscoveryService.js:
 *
 *  1. GET /dd.xml — the UPnP device description. The app reads the
 *     `Application-URL` response header (critical for HbbTV) to know where the
 *     DIAL application resource lives, and parses `root.device` for the
 *     friendly name / manufacturer / model.
 *
 *  2. GET /dial/apps/HbbTV — the DIAL application resource. The app parses
 *     `service.additionalData` and extracts (namespace prefixes are stripped by
 *     the app's XML parser):
 *       - X_HbbTV_App2AppURL       (must be present to pass the HbbTV filter)
 *       - X_HbbTV_InterDevSyncURL  (the CSS-CII WebSocket URL to sync against)
 */

/**
 * @param {object} opts
 * @param {string} opts.ip
 * @param {number} opts.port
 * @param {string} opts.uuid
 * @param {string} opts.friendlyName
 * @param {string} opts.ciiUrl       ws:// URL of the CSS-CII endpoint.
 * @param {string} opts.app2appUrl   ws:// URL of the App2App endpoint.
 * @param {(msg: string) => void} [opts.log]
 * @param {(req, res) => boolean} [opts.onUnhandled] Optional extra route handler.
 * @returns {http.Server}
 */
function createDialHttpServer({
  ip,
  port,
  uuid,
  friendlyName,
  ciiUrl,
  app2appUrl,
  log = console.log,
}) {
  const applicationBaseUrl = `http://${ip}:${port}/dial/apps`;

  const deviceDescriptionXml = [
    '<?xml version="1.0"?>',
    '<root xmlns="urn:schemas-upnp-org:device-1-0">',
    '  <specVersion><major>1</major><minor>0</minor></specVersion>',
    '  <device>',
    '    <deviceType>urn:schemas-upnp-org:device:tvdevice:1</deviceType>',
    `    <friendlyName>${friendlyName}</friendlyName>`,
    '    <manufacturer>Universal HbbTV MediaSync</manufacturer>',
    '    <modelName>TV Emulator</modelName>',
    '    <modelNumber>1.0</modelNumber>',
    `    <UDN>uuid:${uuid}</UDN>`,
    '  </device>',
    '</root>',
  ].join('\n');

  const hbbTvAppXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<service xmlns="urn:dial-multiscreen-org:schemas:dial" xmlns:hbbtv="urn:hbbtv:HbbTVCompanionScreen:2014" dialVer="2.1">',
    '  <name>HbbTV</name>',
    '  <options allowStop="true"/>',
    '  <state>running</state>',
    '  <additionalData>',
    `    <hbbtv:X_HbbTV_App2AppURL>${app2appUrl}</hbbtv:X_HbbTV_App2AppURL>`,
    `    <hbbtv:X_HbbTV_InterDevSyncURL>${ciiUrl}</hbbtv:X_HbbTV_InterDevSyncURL>`,
    '    <hbbtv:X_HbbTV_UserAgent>HbbTV/1.5.1 (+SYNC; Emulator)</hbbtv:X_HbbTV_UserAgent>',
    '  </additionalData>',
    '</service>',
  ].join('\n');

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && (url === '/dd.xml' || url === '/')) {
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        // Critical for HbbTV discovery: tells the app where the DIAL apps live.
        'Application-URL': applicationBaseUrl,
      });
      res.end(deviceDescriptionXml);
      log(`[HTTP] served device description to ${req.socket.remoteAddress}`);
      return;
    }

    if (req.method === 'GET' && url === '/dial/apps/HbbTV') {
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(hbbTvAppXml);
      log(`[HTTP] served HbbTV app resource to ${req.socket.remoteAddress}`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', (err) => {
    log(`[HTTP] server error: ${err.message}`);
  });

  return server;
}

module.exports = { createDialHttpServer };
