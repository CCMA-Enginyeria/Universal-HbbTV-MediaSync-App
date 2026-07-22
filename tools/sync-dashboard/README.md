# sync-dashboard

A small dev tool that turns the app's verbose sync logs into a **live web
dashboard**. It reads the compact `SYNCTEL` telemetry lines the app prints,
parses them out of `adb logcat`, and shows only the information that matters to
understand the DVB-CSS synchronization state in real time.

No runtime dependencies — it uses Node built-ins only, and the web UI draws its
chart on a plain `<canvas>`, so it works fully offline.

## What it shows

- **Filtered drift** (big number) + a live scrolling **drift chart** (raw vs filtered, in ms).
- **Sync state** badge (`locked` / `adjusting` / `seeking`) + playback **rate** and action.
- **CSS-WC**: round-trip time (avg / min / max), dispersion, request/response counters, request rate.
- **CSS-TS**: TV position vs player position and their delta.
- **Health**: telemetry age, updates/s, whether the wall clock is alive, sync state.

## Requirements

- Node.js 18+.
- `adb` on your `PATH` and an Android device/emulator connected (`adb devices`).
- The app running with telemetry enabled: `MEDIA_SYNC.SYNC_TELEMETRY` is `true`
  by default in `src/utils/config.js`.

> The app prints one `📈 SYNCTEL {...}` line per sync tick (~4/s per player).
> These reach `adb logcat` (tag `ReactNativeJS`) in standalone/release builds.

## Usage

```bash
cd tools/sync-dashboard
npm start                 # spawns `adb logcat`, serves http://localhost:4599
```

Then open <http://localhost:4599> in your browser.

### Options

```bash
node index.js --port 8080       # custom HTTP port
node index.js --device <serial> # target a specific device (adb -s <serial>)
node index.js --clear           # clear the logcat buffer first (adb logcat -c)
node index.js --stdin           # read logs from stdin instead of spawning adb
```

### stdin mode (Metro / dev builds)

If your JS `console.log` output does not reach `adb logcat` (e.g. when running
through Metro in a dev build), pipe the log stream in instead:

```bash
npx react-native log-android | node index.js --stdin
# or replay a captured file (PowerShell):
Get-Content samplelog.txt | node index.js --stdin
```

## How it works

```
app (SYNCTEL JSON) → adb logcat → index.js (parse) → SSE /events → browser (public/)
```

The server keeps the last record per player so a freshly-opened browser gets an
instant snapshot, then streams updates via Server-Sent Events.

## Telemetry schema (`SYNCTEL`, v1)

| field | meaning |
|-------|---------|
| `v` | schema version |
| `t` | device timestamp (ms) |
| `k` | player kind (`audio` / `video`) |
| `st` | controller status (`locked` / `adjusting` / `seeking`) |
| `dr` | raw drift (ms) |
| `fd` | filtered drift (ms) |
| `tv` | TV timeline position (s) |
| `pl` | player position (s) |
| `rt` | applied playback rate |
| `act` | controller action (`none` / `rate` / `seek`) |
| `spd` | player speed |
| `state` | MediaSync state (e.g. `synchronized`) |
| `src` | telemetry source: `native` (default, native player) or `web` (web player) |
| `wcDisp` | wall-clock dispersion (ms) |
| `wcRtt` / `wcRttMin` / `wcRttMax` | WC round-trip time (ms) |
| `reqN` / `respN` | WC request / response counters |

Emitted from `src/components/TerminalItem.js` (`runDriftCorrection`) and gated by
`config.MEDIA_SYNC.SYNC_TELEMETRY`.

### Web player source (`src: web`)

The hosted dash.js web player (`www/hbbtv_examples/sync_webplayer`) runs its own
drift controller inside a WebView (used on iOS, where AVPlayer cannot play
MPEG-DASH). When telemetry is enabled it posts the same schema to the host,
tagged `src: web`; the host re-logs it as a `SYNCTEL` line so it reaches this
dashboard through the same `adb logcat` pipeline. The dashboard shows a `web` /
`native` badge (and a `source` row) so you can tell which controller produced the
current sample. Web-player samples omit the `wc*` / `reqN` / `respN` fields, since
the wall clock is handled natively.
