# HbbTV MediaSync — TV Emulator

A self-contained **Node.js** program that pretends to be a television running an
HbbTV application with **DVB-CSS inter-device MediaSync** enabled. Use it to test
the mobile app end-to-end **without a real TV**.

It serves a browser-based TV screen and emulates both complete synchronization
stacks supported by the mobile app:

| Layer | Protocol | File | Endpoint |
|-------|----------|------|----------|
| Discovery | SSDP / DIAL | `ssdp.js`, `httpServer.js` | UDP `1900`, HTTP `:7681/dd.xml` |
| Content info | CSS-CII | `cii.js` | `ws://<ip>:7681/cii` |
| Wall clock | CSS-WC | `wc.js` | `udp://<ip>:6677` |
| Timeline sync | CSS-TS | `ts.js` | `ws://<ip>:7681/ts` |
| TV screen | HTTP + dash.js | `public/`, `tvUi.js` | `http://<ip>:7681/tv` |

By default, the content selected and played in the browser is also announced
through CSS-CII. The TV screen can instead announce a different URL to the
companion device while its real play, pause, seek and playback-rate state keeps
driving the 90 kHz CSS-TS timeline in both transport modes.

## Requirements

- Node.js 18+ (you already have `node@20`).
- The phone/emulator running the app and this emulator **must be on the same
  Wi-Fi / LAN**.

## Run

```bash
cd tools/tv-emulator
npm install      # once — fetches the "ws" dependency
npm start        # or: node index.js
```

Open the **TV screen URL** printed in the banner, choose a programme and select
the transport mode. Then open the mobile app and scan for TVs. An entry named
**"Emulated HbbTV TV (MediaSync)"** should appear; connect to it and the app will
read the selected manifest, list tracks, and synchronize with the browser video.

The **Custom DASH manifest** field changes the content played by the emulated
TV. The **Content URL sent to the companion** field changes only the `contentId`
announced through CSS-CII; it may contain a DASH `.mpd` or a companion web page.
Select **Use TV content** to clear that override and follow the currently played
manifest again. An active override remains selected when the TV programme
changes. The wall clock and timeline always continue to describe the TV video.

The TV screen also shows the active CII, wall-clock and timeline clients.

With the emulator running, its live protocol route can be checked separately:

```powershell
$env:EMU_SMOKE_URL = 'http://127.0.0.1:7681'
npm run smoke
```

## Transport modes

Use the segmented control on the TV screen to switch modes before connecting
the mobile app:

| Mode | CSS-CII | CSS-WC | CSS-TS |
|------|---------|--------|--------|
| **Native DVB-CSS** | WebSocket `/cii` | Binary UDP `:6677` | WebSocket `/ts` |
| **App2App compatibility** | WebSocket `/app2app/hbbtv-sync-cii` | JSON WebSocket `/app2app/hbbtv-sync-wc` | WebSocket `/app2app/hbbtv-sync-ts` |

Only the selected stack accepts connections. Changing mode closes clients from
the previous stack, which prevents mixed native/compatibility sessions.

## Options (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMU_IP` | auto-detected | Force the LAN IPv4 to advertise |
| `EMU_HTTP_PORT` | `7681` | HTTP + WebSocket port |
| `EMU_WC_PORT` | `6677` | UDP wall clock port |
| `EMU_CONTENT_ID` | Big Buck Bunny MPD | Initial DASH MPD URL to play and, unless overridden in the TV screen, announce |
| `EMU_NAME` | `Emulated HbbTV TV (MediaSync)` | Friendly name shown in the app |
| `EMU_MODE` | `native` | Initial TV mode: `native` or `compat` |
| `EMU_COMPAT_PREFIX` | `hbbtv-sync` | App2App compatibility channel prefix |

Example:

```bash
EMU_CONTENT_ID="https://dash.akamaized.net/dash264/TestCases/1a/sony/SNE_DASH_SD_CASE1A_REVISED.mpd" \
EMU_NAME="Living Room TV" \
node index.js
```

## Verify the protocols independently

- **CSS-CII**: `npx wscat -c ws://<ip>:7681/cii` should immediately print a JSON
  document containing `contentId`, `wcUrl`, `tsUrl` and `timelines`.
- **Device description**: `curl -i http://<ip>:7681/dd.xml` should return the XML
  plus an `Application-URL` response header.
- **DIAL app**: `curl http://<ip>:7681/dial/apps/HbbTV` should return the
  `X_HbbTV_InterDevSyncURL` pointing at `/cii`.

## Network caveats

- Disable **AP / client isolation** on your router — otherwise the phone can't
  reach the emulator and multicast won't be delivered.
- Some corporate/guest Wi-Fi networks block UDP multicast (SSDP). Use a normal
  home network or a phone-free hotspot where multicast is allowed.
- **iOS physical device**: needs the `com.apple.developer.networking.multicast`
  entitlement to send SSDP (already handled by the app's config). The **iOS
  Simulator works without it**.
- **Android emulator**: multicast/UDP often does not reach the host machine.
  Prefer a **physical Android device**, or run the emulator on a host reachable
  from the emulator's network.

## What it does NOT do

- It does not implement a manual "connect by IP" flow — discovery is via
  SSDP/DIAL, exactly like a real HbbTV terminal.
- It does not proxy media. The selected DASH host must allow browser CORS and
  provide codecs supported by the browser running the TV screen.
