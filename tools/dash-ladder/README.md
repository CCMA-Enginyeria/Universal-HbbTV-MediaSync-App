# DASH video ladder for the IBC demos

The IBC demo manifests on S3 (Sagrada Família main + realització, Sign language, Eclipse) were
published with a single 1080p video quality at ~10 Mbps. `build.cjs` adds a multi-bitrate
ladder so players can adapt to the network:

| Rung | Bitrate |
|------|---------|
| 1080p | 5 Mbps (an original at ≤ 5.5 Mbps is kept as is instead) |
| 720p | 2.8 Mbps |
| 540p | 1.5 Mbps |
| 360p | 0.7 Mbps |

The masters are not available, so the script downloads every published video segment,
joins them and re-encodes them with libx264. To keep DVB-CSS sync intact, every new
Representation keeps the original timescale, segment duration, `startNumber`, a keyframe at
every segment boundary and the same edit list (B-frame delay), and the script **verifies**
`tfdt` and sample count of every segment against the original before writing the MPD.
Audio segments are copied untouched. The MPD is the original text with only the video
`Representation`s replaced, so Roles, languages and EventStreams are preserved.

## Requirements

- Node.js 18+
- `curl` (honours `HTTPS_PROXY`)
- `ffmpeg` / `ffprobe` with libx264 (macOS: `brew install ffmpeg`)
- Free disk: ~3× the original size of the demo (Sign language: ~10 GB)

## Run

```sh
# All demos (hours on CPU) or one of: signes, sagrada-main, sagrada-realitzacio, eclipsi
node tools/dash-ladder/build.cjs --only signes --work ~/dash-ladder-work
```

Options: `--work <dir>` (default `../dash-ladder-work` next to the repo), `--only <demo>`,
`--preset <x264 preset>` (default `medium`). The script is resumable: downloaded segments and
finished encodes are reused when it is run again.

Output: `<work>/out/<S3 path of the original manifest dir>/abr/`, e.g.
`out/ibc-2026/_dash_Signes_IBC/abr/manifest_signes.mpd` plus all its segments. The log ends
with `ok <rep> ... timing matches original` for every rung and `wrote <manifest>`; any
mismatch aborts with an error instead.

## Publish

Upload each `abr/` folder next to the original one (bucket `ccma-labs-generic`, CORS already
allows `*`), with proper content types:

```sh
cd <work>/out
aws s3 cp ibc-2026 s3://ccma-labs-generic/ibc-2026 --recursive --exclude '*' --include '*.m4s' --include '*.mp4' --content-type video/mp4
aws s3 cp ibc-2026 s3://ccma-labs-generic/ibc-2026 --recursive --exclude '*' --include '*.mpd' --content-type application/dash+xml
```

Then test the new URLs with the TV emulator and the apps before switching the demo URLs in
`tools/tv-emulator/index.js`, `www/hbbtv_examples/basic-media-sync-viewer.html` and the
Eclipse HbbTV app (`exp-eclipse/hbbtv_app/src/App.js`). The originals stay in place, so
rolling back is just reverting the URLs.
