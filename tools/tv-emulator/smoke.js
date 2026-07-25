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

async function postState(patch) {
  const response = await fetch(`${httpBase}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`State update failed with HTTP ${response.status}`);
  return response.json();
}

async function run() {
  const selectedContent = 'https://example.test/selected.mpd';
  const companionContent = 'https://example.test/companion.html';

  await postState({
    mode: 'native',
    contentId: selectedContent,
    contentIdOverride: companionContent,
    positionSeconds: 42,
    paused: false,
  });
  const nativeCii = await receiveJson('/cii');
  if (nativeCii.contentId !== companionContent) throw new Error('Native CII did not use the companion override');

  await postState({ mode: 'compat' });
  const compatCii = await receiveJson('/app2app/hbbtv-sync-cii');
  const compatTs = await receiveJson('/app2app/hbbtv-sync-ts', {
    timelineSelector: 'urn:dvb:css:timeline:pts',
  });

  if (compatCii.contentId !== companionContent) throw new Error('Compatibility CII did not use the companion override');
  if (!compatCii.wcUrl.endsWith('/app2app/hbbtv-sync-wc')) throw new Error('Invalid compatibility WC URL');
  if (!compatCii.tsUrl.endsWith('/app2app/hbbtv-sync-ts')) throw new Error('Invalid compatibility TS URL');
  if (compatTs.contentTime < 42 * 90000) throw new Error('Compatibility timeline did not use TV position');
  if (compatTs.timelineSpeedMultiplier !== 1) throw new Error('Compatibility timeline is not playing');

  await postState({ contentIdOverride: null });

  const resetCii = await receiveJson('/app2app/hbbtv-sync-cii');
  if (resetCii.contentId !== selectedContent) throw new Error('Compatibility CII did not return to TV content');

  console.log(JSON.stringify({
    tvContent: selectedContent,
    nativeCompanionContent: nativeCii.contentId,
    overriddenCompanionContent: compatCii.contentId,
    resetCompanionContent: resetCii.contentId,
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