#!/usr/bin/env node
'use strict';

/**
 * Adds a multi-bitrate video ladder to the single-bitrate IBC demo DASH manifests.
 *
 * The masters are not available, so each video Representation is rebuilt from its
 * published init + media segments and re-encoded with libx264 into a 1080p/720p/540p/360p
 * ladder. Everything that drives synchronisation is kept identical to the original:
 * timescale, segment duration, startNumber, keyframe on every segment boundary and the
 * same edit list (B-frame delay), so every Representation presents frame 0 at time 0.
 * Audio segments are copied untouched. The original MPD text is edited in place (only the
 * video Representations are replaced), so Roles, languages and EventStreams survive.
 *
 * Output: <work>/out/<S3 path of the original manifest dir>/abr/, ready to upload.
 *
 * Usage: node tools/dash-ladder/build.cjs [--work <dir>] [--only <demo>] [--preset medium]
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const S3_ORIGIN = 'https://ccma-labs-generic.s3.eu-west-1.amazonaws.com/';

const DEMOS = [
  { name: 'signes', manifest: 'ibc-2026/_dash_Signes_IBC/manifest_signes.mpd' },
  { name: 'sagrada-main', manifest: 'ibc-2026/_dash_Sagrada_Familia_IBC/main/manifest_main.mpd' },
  { name: 'sagrada-realitzacio', manifest: 'ibc-2026/_dash_Sagrada_Familia_IBC/realitzacio/manifest_realitzacio.mpd' },
  { name: 'eclipsi', manifest: 'ibc-2026/_dash_eclipsi_IBC/manifest_Eclipsi.mpd' },
];

/** Target ladder; an original at or below the top bitrate is kept as the top rung. */
const LADDER = [
  { height: 1080, kbps: 5000 },
  { height: 720, kbps: 2800 },
  { height: 540, kbps: 1500 },
  { height: 360, kbps: 700 },
];
const KEEP_ORIGINAL_BELOW_BPS = 5500000;

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const WORK = path.resolve(arg('work', path.join(__dirname, '..', '..', '..', 'dash-ladder-work')));
const ONLY = arg('only', null);
const PRESET = arg('preset', 'medium');

const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`${cmd} exited with ${result.status}`);
}

function capture(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr}`);
  return result.stdout;
}

function isoDurationSeconds(value) {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!m) throw new Error(`Unsupported duration ${value}`);
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`).exec(tag);
  return m ? m[1] : null;
};

/** Minimal parser for the GPAC-generated manifests: one SegmentTemplate per AdaptationSet. */
function parseManifest(xml) {
  const duration = isoDurationSeconds(attr(/<MPD[^>]*>/.exec(xml)[0], 'mediaPresentationDuration'));
  const sets = [];
  for (const m of xml.matchAll(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g)) {
    const block = m[0];
    const template = /<SegmentTemplate\b[^>]*>/.exec(block)[0];
    const reps = [...block.matchAll(/<Representation\b[^>]*>[\s\S]*?<\/Representation>/g)].map((r) => ({
      text: r[0],
      tag: /<Representation\b[^>]*>/.exec(r[0])[0],
    }));
    sets.push({
      reps: reps.map((r) => ({
        ...r,
        id: attr(r.tag, 'id'),
        mimeType: attr(r.tag, 'mimeType') || attr(block, 'mimeType'),
        codecs: attr(r.tag, 'codecs'),
        frameRate: attr(r.tag, 'frameRate'),
        bandwidth: +attr(r.tag, 'bandwidth'),
      })),
      media: attr(template, 'media'),
      init: attr(template, 'initialization'),
      timescale: +attr(template, 'timescale'),
      segDuration: +attr(template, 'duration'),
      startNumber: +(attr(template, 'startNumber') || 1),
    });
  }
  return { duration, sets };
}

const fill = (template, id, number) =>
  template.replace(/\$RepresentationID\$/g, id).replace(/\$Number\$/g, String(number));

/**
 * HTTP goes through curl rather than Node's fetch: curl honours HTTPS_PROXY and the
 * system certificate store, which corporate networks need.
 */
function curl(curlArgs) {
  return new Promise((resolve) => {
    execFile('curl', ['-s', '--retry', '3', ...curlArgs], { encoding: 'utf8', maxBuffer: 16 << 20 },
      (error, stdout) => resolve({ ok: !error, stdout }));
  });
}

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  const tmp = `${file}.part`;
  if (!(await curl(['-f', '-o', tmp, url])).ok) throw new Error(`Download failed: ${url}`);
  fs.renameSync(tmp, file);
}

async function pool(items, limit, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await worker(items[next++]);
  }));
}

/** Downloads init + every media segment of a Representation into `dir`; returns file names. */
async function fetchRepresentation(baseUrl, set, rep, count, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const names = [fill(set.init, rep.id)];
  for (let n = set.startNumber; n < set.startNumber + count; n++) names.push(fill(set.media, rep.id, n));
  await pool(names, 16, (name) => download(new URL(name, baseUrl).href, path.join(dir, name)));
  const next = await curl(['-f', '-I', new URL(fill(set.media, rep.id, set.startNumber + count), baseUrl).href]);
  if (next.ok) throw new Error(`${rep.id}: more than ${count} segments published`);
  return names;
}

// ---- ISO BMFF inspection (enough to verify timing parity) ----

function boxes(buf, start = 0, end = buf.length) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    let size = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); header = 16; }
    if (size < 8) break;
    out.push({ type, start: o, body: o + header, end: o + size });
    o += size;
  }
  return out;
}

function find(buf, pathTypes, start = 0, end = buf.length) {
  const [head, ...rest] = pathTypes;
  for (const b of boxes(buf, start, end)) {
    if (b.type !== head) continue;
    if (!rest.length) return b;
    const hit = find(buf, rest, b.body, b.end);
    if (hit) return hit;
  }
  return null;
}

function initInfo(file) {
  const buf = fs.readFileSync(file);
  const elst = find(buf, ['moov', 'trak', 'edts', 'elst']);
  const mdhd = find(buf, ['moov', 'trak', 'mdia', 'mdhd']);
  const avcC = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  let editList = null;
  if (elst) {
    const version = buf[elst.body];
    const first = elst.body + 8;
    editList = version === 1 ? Number(buf.readBigInt64BE(first + 8)) : buf.readInt32BE(first + 4);
  }
  const mdhdVersion = buf[mdhd.body];
  const timescale = buf.readUInt32BE(mdhd.body + (mdhdVersion === 1 ? 20 : 12));
  let codecs = null;
  if (avcC) {
    const at = buf.indexOf('avcC', avcC.body, 'latin1');
    if (at > 0) codecs = `avc1.${buf.subarray(at + 5, at + 8).toString('hex').toUpperCase()}`;
  }
  return { editList, timescale, codecs };
}

function segmentInfo(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4096);
  const length = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const buf = head.subarray(0, length);
  const tfdt = find(buf, ['moof', 'traf', 'tfdt']);
  const trun = find(buf, ['moof', 'traf', 'trun']);
  const decodeTime = buf[tfdt.body] === 1 ? Number(buf.readBigUInt64BE(tfdt.body + 4)) : buf.readUInt32BE(tfdt.body + 4);
  return { decodeTime, samples: buf.readUInt32BE(trun.body + 4) };
}

// ---- Encoding ----

function encodeLadder({ source, rep, set, rungs, profile, frameRate, tmpDir }) {
  const gop = Math.round((set.segDuration / set.timescale) * frameRate);
  const filters = [`[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join('')}`];
  rungs.forEach((rung, i) => filters.push(`[s${i}]scale=-2:${rung.height}:flags=lanczos,setsar=1[v${i}]`));
  const cmd = ['-hide_banner', '-v', 'warning', '-stats', '-y', '-i', source, '-filter_complex', filters.join(';')];
  rungs.forEach((rung, i) => {
    const dir = path.join(tmpDir, rung.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    cmd.push(
      '-map', `[v${i}]`, '-an',
      '-c:v', 'libx264', '-preset', PRESET, '-profile:v', profile, '-pix_fmt', 'yuv420p',
      '-b:v', `${rung.kbps}k`, '-maxrate', `${Math.round(rung.kbps * 1.1)}k`, '-bufsize', `${rung.kbps * 2}k`,
      '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-x264-params', 'scenecut=0:open-gop=0',
      '-force_key_frames', `expr:eq(mod(n,${gop}),0)`,
      '-video_track_timescale', String(set.timescale),
      '-f', 'dash', '-seg_duration', String(set.segDuration / set.timescale),
      '-use_template', '1', '-use_timeline', '0',
      '-init_seg_name', fill(set.init, rung.id), '-media_seg_name', set.media.replace(/\$RepresentationID\$/g, rung.id),
      path.join(dir, 'ffmpeg.mpd'),
    );
  });
  log(`encode ${rep.id} -> ${rungs.map((r) => r.id).join(', ')}`);
  run('ffmpeg', cmd);
}

function probeSize(file) {
  const [w, h] = capture('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
    .trim().split(',').map(Number);
  return { width: w, height: h };
}

// ---- Main ----

async function buildDemo(demo) {
  const manifestUrl = S3_ORIGIN + demo.manifest;
  const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const outDir = path.join(WORK, 'out', path.dirname(demo.manifest), 'abr');
  const srcDir = path.join(WORK, 'src', demo.name);
  const tmpDir = path.join(WORK, 'tmp', demo.name);
  fs.mkdirSync(outDir, { recursive: true });

  log(`== ${demo.name}: ${manifestUrl}`);
  const manifest = await curl(['-f', manifestUrl]);
  if (!manifest.ok) throw new Error(`Download failed: ${manifestUrl}`);
  const xml = manifest.stdout;
  const { duration, sets } = parseManifest(xml);
  let mpd = xml;

  for (const set of sets) {
    const count = Math.ceil(duration / (set.segDuration / set.timescale) - 1e-6);
    for (const rep of set.reps) {
      if (!rep.mimeType.startsWith('video/')) {
        log(`copy ${rep.id} (${count} segments)`);
        await fetchRepresentation(baseUrl, set, rep, count, outDir);
        continue;
      }

      const repSrc = path.join(srcDir, rep.id);
      const names = await fetchRepresentation(baseUrl, set, rep, count, repSrc);
      const original = initInfo(path.join(repSrc, names[0]));
      const [num, den = 1] = rep.frameRate.split('/').map(Number); // "50" or "30000/1001"
      const frameRate = num / den;
      const profile = rep.codecs.startsWith('avc1.64') ? 'high' : 'main';

      const keepOriginal = rep.bandwidth <= KEEP_ORIGINAL_BELOW_BPS;
      const rungs = LADDER.filter((r, i) => !(keepOriginal && i === 0))
        .map((r) => ({ ...r, id: r.height === 1080 ? rep.id : `${rep.id}_${r.height}` }));

      const done = rungs.every((r) => fs.existsSync(path.join(outDir, fill(set.media, r.id, set.startNumber + count - 1))));
      if (!done) {
        const source = path.join(srcDir, `${rep.id}.mp4`);
        if (!fs.existsSync(source)) {
          log(`join ${rep.id} (${count} segments)`);
          const tmp = `${source}.part`;
          const fd = fs.openSync(tmp, 'w');
          for (const name of names) fs.writeSync(fd, fs.readFileSync(path.join(repSrc, name)));
          fs.closeSync(fd);
          fs.renameSync(tmp, source);
        }
        encodeLadder({ source, rep, set, rungs, profile, frameRate, tmpDir });
        for (const rung of rungs) {
          const dir = path.join(tmpDir, rung.id);
          for (const f of fs.readdirSync(dir)) if (f !== 'ffmpeg.mpd') fs.renameSync(path.join(dir, f), path.join(outDir, f));
        }
      }

      const entries = [];
      if (keepOriginal) {
        for (const name of names) fs.copyFileSync(path.join(repSrc, name), path.join(outDir, name));
        entries.push({ id: rep.id, codecs: rep.codecs, ...probeSize(path.join(srcDir, `${rep.id}.mp4`)), bandwidth: rep.bandwidth });
      }

      for (const rung of rungs) {
        const init = initInfo(path.join(outDir, fill(set.init, rung.id)));
        const problems = [];
        if (init.timescale !== set.timescale) problems.push(`timescale ${init.timescale}`);
        if (init.editList !== original.editList) problems.push(`edit list ${init.editList} != ${original.editList}`);
        let bytes = 0;
        for (let i = 0; i < count; i++) {
          const n = set.startNumber + i;
          const file = path.join(outDir, fill(set.media, rung.id, n));
          if (!fs.existsSync(file)) { problems.push(`missing segment ${n}`); break; }
          bytes += fs.statSync(file).size;
          const ours = segmentInfo(file);
          const theirs = segmentInfo(path.join(repSrc, fill(set.media, rep.id, n)));
          if (ours.decodeTime !== theirs.decodeTime || ours.samples !== theirs.samples) {
            problems.push(`segment ${n}: tfdt ${ours.decodeTime}/${theirs.decodeTime} samples ${ours.samples}/${theirs.samples}`);
            break;
          }
        }
        if (fs.existsSync(path.join(outDir, fill(set.media, rung.id, set.startNumber + count)))) problems.push('extra segments');
        if (problems.length) throw new Error(`${rung.id}: ${problems.join('; ')}`);
        const size = probeSize(path.join(outDir, fill(set.init, rung.id)));
        entries.push({ id: rung.id, codecs: init.codecs, ...size, bandwidth: Math.round((bytes * 8) / duration) });
        log(`ok ${rung.id} ${size.width}x${size.height} ${(bytes * 8 / duration / 1e6).toFixed(2)} Mbps, timing matches original`);
      }

      entries.sort((a, b) => b.bandwidth - a.bandwidth);
      const at = mpd.indexOf(rep.text);
      const indent = mpd.slice(mpd.lastIndexOf('\n', at) + 1, at);
      const replacement = entries.map((e) =>
        rep.text
          .replace(/\bid="[^"]*"/, `id="${e.id}"`)
          .replace(/\bcodecs="[^"]*"/, `codecs="${e.codecs}"`)
          .replace(/\bwidth="[^"]*"/, `width="${e.width}"`)
          .replace(/\bheight="[^"]*"/, `height="${e.height}"`)
          .replace(/\bbandwidth="[^"]*"/, `bandwidth="${e.bandwidth}"`)).join(`\n${indent}`);
      mpd = mpd.replace(rep.text, replacement);
    }
  }

  mpd = mpd.replace(/(<!-- MPD file Generated[^\n]*-->)/,
    `$1\n<!-- Video ladder added by tools/dash-ladder/build.cjs at ${new Date().toISOString()} -->`);
  const manifestName = path.basename(demo.manifest);
  fs.writeFileSync(path.join(outDir, manifestName), mpd);
  log(`wrote ${path.join(outDir, manifestName)}`);
}

(async () => {
  for (const demo of DEMOS) {
    if (ONLY && demo.name !== ONLY) continue;
    await buildDemo(demo);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
