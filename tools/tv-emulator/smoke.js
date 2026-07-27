'use strict';

const { WebSocket } = require('ws');

const httpBase = process.env.EMU_SMOKE_URL || 'http://127.0.0.1:7681';
const wsBase = httpBase.replace(/^http/, 'ws');

function receiveJson(path, setup, predicate = () => true, label = path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}${path}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${label}`));
    }, 8000);

    ws.on('open', () => {
      if (setup) ws.send(JSON.stringify(setup));
    });
    ws.on('message', (data) => {
      const text = data.toString();
      if (!text.startsWith('{')) return;
      const message = JSON.parse(text);
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.close();
      resolve(message);
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function openJsonChannel(path) {
  const ws = new WebSocket(`${wsBase}${path}`);
  const messages = [];
  const waiters = [];
  ws.on('message', (data) => {
    const text = data.toString();
    if (!text.startsWith('{')) return;
    const message = JSON.parse(text);
    messages.push(message);
    waiters.splice(0).forEach((notify) => notify());
  });
  return {
    close: () => ws.close(),
    waitFor(predicate, label) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 8000;
        const check = () => {
          const match = messages.find(predicate);
          if (match) return resolve(match);
          if (Date.now() >= deadline) return reject(new Error(`Timed out waiting for ${label}`));
          const timer = setTimeout(check, 100);
          waiters.push(() => { clearTimeout(timer); check(); });
        };
        check();
      });
    },
  };
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

async function waitForState(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${httpBase}/api/state`);
    const state = await response.json();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for TV browser state');
}

async function run() {
  const companionContent = 'https://example.test/companion.html';
  const initialResponse = await fetch(`${httpBase}/api/state`);
  const initialState = await initialResponse.json();
  const selectedContent = initialState.contentId;

  await postState({
    mode: 'native',
    contentIdOverride: companionContent,
  });
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const nativeCii = await receiveJson('/cii');
  if (nativeCii.contentId !== companionContent) throw new Error('Native CII did not use the companion override');

  await postState({ mode: 'compat' });
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const ciiChannel = openJsonChannel('/app2app/hbbtv-sync-cii');
  const compatCii = await ciiChannel.waitFor(
    (message) => message.contentId === companionContent,
    'compatibility CII override'
  );
  const compatTs = await receiveJson('/app2app/hbbtv-sync-ts', {
    timelineSelector: 'urn:dvb:css:timeline:pts',
  });

  if (compatCii.contentId !== companionContent) throw new Error('Compatibility CII did not use the companion override');
  if (!compatCii.wcUrl.endsWith('/app2app/hbbtv-sync-wc')) throw new Error('Invalid compatibility WC URL');
  if (!compatCii.tsUrl.endsWith('/app2app/hbbtv-sync-ts')) throw new Error('Invalid compatibility TS URL');
  if (!Number.isFinite(compatTs.contentTime)) throw new Error('Compatibility timeline has no browser content time');
  if (![0, 1].includes(compatTs.timelineSpeedMultiplier)) throw new Error('Compatibility timeline has an invalid speed');

  await postState({ contentIdOverride: null });
  await waitForState((state) => state.contentIdOverride === null);
  await new Promise((resolve) => setTimeout(resolve, 1700));

  const resetCii = await ciiChannel.waitFor(
    (message) => message.contentId === selectedContent,
    'compatibility CII reset'
  );
  ciiChannel.close();
  if (resetCii.contentId !== selectedContent) throw new Error('Compatibility CII did not return to TV content');

  console.log(JSON.stringify({
    tvContent: selectedContent,
    nativeCompanionContent: nativeCii.contentId,
    overriddenCompanionContent: compatCii.contentId,
    resetCompanionContent: resetCii.contentId,
    compatibilityWallClock: compatCii.wcUrl,
    compatibilityTimeline: compatCii.tsUrl,
    browserContentSeconds: compatTs.contentTime / 90000,
    speed: compatTs.timelineSpeedMultiplier,
  }, null, 2));
}

run().catch((err) => {
  console.error(`Smoke test failed: ${err.message}`);
  process.exitCode = 1;
});