/* sync-dashboard front-end.
 *
 * Connects to the server's SSE stream (/events), keeps a rolling history of
 * drift samples, and renders a live dashboard. The drift chart is drawn on a
 * plain <canvas> (no external chart library) so the tool works fully offline.
 */

'use strict';

// --- Rolling history --------------------------------------------------------
const MAX_POINTS = 240;         // ~1 minute at 250ms/sample per player
const STALE_MS = 3000;          // no telemetry for this long => stale
const OFFLINE_MS = 8000;        // => offline

/** history: array of { t, raw, filt } (most recent last) */
const history = [];
let last = null;                // latest full record
let updates = [];               // arrival timestamps for updates/s

// --- DOM refs ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  connDot: $('conn-dot'), connText: $('conn-text'), stateBadge: $('state-badge'),
  driftValue: $('drift-value'), driftRaw: $('drift-raw'), rate: $('rate-value'),
  action: $('action-value'), spd: $('spd-value'),
  wcRtt: $('wc-rtt'), wcRttRange: $('wc-rtt-range'), wcDisp: $('wc-disp'),
  wcReq: $('wc-req'), wcResp: $('wc-resp'), wcRate: $('wc-rate'),
  tsTv: $('ts-tv'), tsPl: $('ts-pl'), tsDelta: $('ts-delta'), tsKind: $('ts-kind'),
  hpAge: $('hp-age'), hpUps: $('hp-ups'), hpWc: $('hp-wc'), hpState: $('hp-state'),
  canvas: $('drift-chart'),
};

// --- WC request-rate tracking ----------------------------------------------
let lastReqN = null, lastReqT = null, reqRate = 0;

// --- SSE --------------------------------------------------------------------
function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { els.connText.textContent = 'connected'; };
  es.onmessage = (ev) => {
    let rec;
    try { rec = JSON.parse(ev.data); } catch (_) { return; }
    onRecord(rec);
  };
  es.onerror = () => { els.connText.textContent = 'reconnecting…'; };
}

function onRecord(rec) {
  last = rec;
  const now = Date.now();
  updates.push(now);

  history.push({ t: now, raw: num(rec.dr), filt: num(rec.fd) });
  while (history.length > MAX_POINTS) history.shift();

  // WC request rate (requests per second) from the monotonic counter.
  if (rec.reqN != null) {
    if (lastReqN != null && lastReqT != null && rec.reqN > lastReqN) {
      const dt = (now - lastReqT) / 1000;
      if (dt > 0) reqRate = (rec.reqN - lastReqN) / dt;
    }
    lastReqN = rec.reqN;
    lastReqT = now;
  }

  render();
}

// --- Helpers ----------------------------------------------------------------
function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function fmt(v, unit = '', d = 0) { return v == null ? '—' : `${v.toFixed(d)}${unit}`; }

function driftClass(absMs) {
  if (absMs == null) return '';
  if (absMs <= 40) return 'good';
  if (absMs <= 120) return 'warn';
  return 'bad';
}

// --- Render -----------------------------------------------------------------
function render() {
  if (!last) return;
  const r = last;

  // Hero: filtered drift
  const fd = num(r.fd);
  els.driftValue.textContent = fd == null ? '—' : String(Math.round(fd));
  els.driftValue.className = 'hero-value ' + driftClass(fd == null ? null : Math.abs(fd));
  els.driftRaw.textContent = fmt(num(r.dr), ' ms');
  els.rate.textContent = fmt(num(r.rt), '×', 3);
  els.action.textContent = r.act ?? '—';
  els.spd.textContent = r.spd != null ? String(r.spd) : '—';

  // State badge (controller status: locked / adjusting / seeking)
  const st = r.st ?? '—';
  els.stateBadge.textContent = st;
  els.stateBadge.className = 'badge ' + (['locked', 'adjusting', 'seeking'].includes(st) ? st : '');

  // WC card
  els.wcRtt.textContent = fmt(num(r.wcRtt), ' ms', 1);
  els.wcRttRange.textContent = (num(r.wcRttMin) != null && num(r.wcRttMax) != null)
    ? `${r.wcRttMin.toFixed(1)} / ${r.wcRttMax.toFixed(1)} ms` : '—';
  setColored(els.wcDisp, num(r.wcDisp), (v) => `${Math.round(v)} ms`, (v) => v <= 50 ? 'good' : v <= 150 ? 'warn' : 'bad');
  els.wcReq.textContent = r.reqN != null ? String(r.reqN) : '—';
  els.wcResp.textContent = r.respN != null ? String(r.respN) : '—';
  els.wcRate.textContent = reqRate > 0 ? `${reqRate.toFixed(2)}/s` : '—';

  // TS card
  const tv = num(r.tv), pl = num(r.pl);
  els.tsTv.textContent = fmt(tv, ' s', 2);
  els.tsPl.textContent = fmt(pl, ' s', 2);
  if (tv != null && pl != null) {
    const delta = (tv - pl) * 1000;
    setColored(els.tsDelta, delta, (v) => `${v >= 0 ? '+' : ''}${Math.round(v)} ms`, (v) => driftClass(Math.abs(v)));
  } else {
    els.tsDelta.textContent = '—'; els.tsDelta.className = '';
  }
  els.tsKind.textContent = r.k ?? '—';

  // Health handled by tick()
  els.hpState.textContent = r.state ?? '—';

  drawChart();
}

function setColored(el, v, fmtFn, classFn) {
  if (v == null) { el.textContent = '—'; el.className = ''; return; }
  el.textContent = fmtFn(v);
  const c = classFn(v);
  el.className = c ? `value-${c}` : '';
}

// --- Health tick (runs even without new records) ----------------------------
function tick() {
  const now = Date.now();
  const age = last ? now - (last._rx || last.t) : Infinity;

  // Connection indicator
  let cls = 'offline', txt = 'no telemetry';
  if (age < STALE_MS) { cls = 'online'; txt = 'live'; }
  else if (age < OFFLINE_MS) { cls = 'stale'; txt = 'stale'; }
  els.connDot.className = 'dot ' + cls;
  if (els.connText.textContent === 'connected' || ['live', 'stale', 'no telemetry'].includes(els.connText.textContent)) {
    els.connText.textContent = txt;
  }

  // Health card
  els.hpAge.textContent = isFinite(age) ? `${(age / 1000).toFixed(1)} s` : '—';
  updates = updates.filter((t) => now - t < 1000);
  els.hpUps.textContent = updates.length ? String(updates.length) : '0';
  const wcAlive = last && last.wcRtt != null && age < STALE_MS;
  els.hpWc.textContent = last ? (wcAlive ? 'yes' : 'no') : '—';
  els.hpWc.className = last ? (wcAlive ? 'value-good' : 'value-bad') : '';
}

// --- Canvas chart -----------------------------------------------------------
function drawChart() {
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // Logical (CSS) size comes from layout, never from the backing-store size —
  // reading canvas.height and writing it back scaled by dpr creates a feedback
  // loop that grows the canvas every frame on HiDPI displays.
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 220;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 44, padR = 8, padT = 10, padB = 18;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  // Determine symmetric Y range from data (min 100ms).
  let maxAbs = 50;
  for (const p of history) {
    if (p.raw != null) maxAbs = Math.max(maxAbs, Math.abs(p.raw));
    if (p.filt != null) maxAbs = Math.max(maxAbs, Math.abs(p.filt));
  }
  maxAbs = Math.ceil(maxAbs / 50) * 50;

  const yFor = (v) => padT + h / 2 - (v / maxAbs) * (h / 2);
  const xFor = (i) => padL + (history.length <= 1 ? w : (i / (MAX_POINTS - 1)) * w);

  // Grid + axis labels
  ctx.strokeStyle = '#242b34';
  ctx.fillStyle = '#6e7681';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const gv of [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs]) {
    const y = yFor(gv);
    ctx.beginPath();
    ctx.moveTo(padL, y); ctx.lineTo(padL + w, y);
    ctx.strokeStyle = gv === 0 ? '#3a434e' : '#20272f';
    ctx.stroke();
    ctx.fillText(String(Math.round(gv)), padL - 6, y);
  }

  // Series
  const drawSeries = (key, color, width) => {
    ctx.beginPath();
    let started = false;
    history.forEach((p, i) => {
      const v = p[key];
      if (v == null) { started = false; return; }
      const x = xFor(i), y = yFor(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  drawSeries('raw', '#6e7681', 1);
  drawSeries('filt', '#58a6ff', 2);
}

// --- Boot -------------------------------------------------------------------
window.addEventListener('resize', drawChart);
setInterval(tick, 500);
tick();
connect();
