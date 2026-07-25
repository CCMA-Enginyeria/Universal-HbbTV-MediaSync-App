'use strict';

const { WebSocket } = require('ws');

const httpBase = process.env.EMU_SMOKE_URL || 'http://127.0.0.1:7681';
const wsBase = httpBase.replace(/^http/, 'ws');

function receiveJson(path, setup) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}${path}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${path}`));
    }, 3000);

    ws.on('open', () => {
      if (setup) ws.send(JSON.stringify(setup));
    });
    ws.on('message', (data) => {
      const text = data.toString();
      if (!text.startsWith('{')) return;
      clearTimeout(timeout);
      ws.close();
      resolve(JSON.parse(text));
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function run() {
  const nativeCii = await receiveJson('/cii');
  const selectedContent = 'https://example.test/selected.mpd';

  const response = await fetch(`${httpBase}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'compat',
      contentId: selectedContent,
      positionSeconds: 42,
      paused: false,
    }),
  });
  if (!response.ok) throw new Error(`State update failed with HTTP ${response.status}`);

  const compatCii = await receiveJson('/app2app/hbbtv-sync-cii');
  const compatTs = await receiveJson('/app2app/hbbtv-sync-ts', {
    timelineSelector: 'urn:dvb:css:timeline:pts',
  });

  if (compatCii.contentId !== selectedContent) throw new Error('Compatibility CII did not update');
  if (!compatCii.wcUrl.endsWith('/app2app/hbbtv-sync-wc')) throw new Error('Invalid compatibility WC URL');
  if (!compatCii.tsUrl.endsWith('/app2app/hbbtv-sync-ts')) throw new Error('Invalid compatibility TS URL');
  if (compatTs.contentTime < 42 * 90000) throw new Error('Compatibility timeline did not use TV position');
  if (compatTs.timelineSpeedMultiplier !== 1) throw new Error('Compatibility timeline is not playing');

  console.log(JSON.stringify({
    nativeContent: nativeCii.contentId,
    compatibilityContent: compatCii.contentId,
    compatibilityWallClock: compatCii.wcUrl,
    compatibilityTimeline: compatCii.tsUrl,
    contentSeconds: compatTs.contentTime / 90000,
    speed: compatTs.timelineSpeedMultiplier,
  }, null, 2));
}

run().catch((err) => {
  console.error(`Smoke test failed: ${err.message}`);
  process.exitCode = 1;
});