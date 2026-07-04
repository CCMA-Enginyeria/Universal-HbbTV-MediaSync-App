# HbbTV MediaSync — TV Emulator

A self-contained **Node.js** program that pretends to be a television running an
HbbTV application with **DVB-CSS inter-device MediaSync** enabled. Use it to test
the mobile app end-to-end **without a real TV**.

It emulates the complete stack the app expects:

| Layer | Protocol | File | Endpoint |
|-------|----------|------|----------|
| Discovery | SSDP / DIAL | `ssdp.js`, `httpServer.js` | UDP `1900`, HTTP `:7681/dd.xml` |
| Content info | CSS-CII | `cii.js` | `ws://<ip>:7681/cii` |
| Wall clock | CSS-WC | `wc.js` | `udp://<ip>:6677` |
| Timeline sync | CSS-TS | `ts.js` | `ws://<ip>:7681/ts` |

By default it announces the Big Buck Bunny DASH manifest as the content being
"played" and exposes a synthetic PTS timeline (90 kHz) advancing at speed 1.0.

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

You will see a banner with the advertised URLs. Then open the app and scan for
TVs — an entry named **"Emulated HbbTV TV (MediaSync)"** should appear. Connect
to it and the app will read the manifest, list tracks, and synchronize.

## Options (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMU_IP` | auto-detected | Force the LAN IPv4 to advertise |
| `EMU_HTTP_PORT` | `7681` | HTTP + WebSocket port |
| `EMU_WC_PORT` | `6677` | UDP wall clock port |
| `EMU_CONTENT_ID` | Big Buck Bunny MPD | DASH MPD URL to announce (**must contain `.mpd`**) |
| `EMU_NAME` | `Emulated HbbTV TV (MediaSync)` | Friendly name shown in the app |

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

- It does not decode or play real video; it only advertises a synthetic PTS
  timeline. The app still performs real WC + TS synchronization against it.
- It does not implement a manual "connect by IP" flow — discovery is via
  SSDP/DIAL, exactly like a real HbbTV terminal.
