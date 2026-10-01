# Native migration

The numbered implementation requirements, dependencies and acceptance criteria
are tracked in [the migration PRD index](../docs/prds/README.md).

This directory contains independent Kotlin/Compose Android and Swift/SwiftUI iOS
applications that replace the React Native app. The React Native application
remains unchanged as the shipping product and behavioral reference until cutover.
Per-requirement status and evidence: [parity matrix](../docs/prds/parity-matrix.md);
security notes: [threat model](../docs/prds/threat-model.md).

## Layout

| Path | Contents |
| --- | --- |
| `android/core` | Pure Kotlin/JVM core: DIAL discovery, DVB-CSS CII/WC/TS, App2App, session and probe state machines, playback corrector, MPD/HLS/TTML/VTT parsers, companion protocol |
| `android/app` | Android app: Compose UI, Media3 player, foreground service, Custom Tabs/WebView companion |
| `ios/Sources/MediaSyncCore` | Swift port of the core (same fixtures) |
| `ios/App` | iOS app: SwiftUI, AVPlayer, WKWebView companion, XcodeGen `project.yml` |
| `fixtures/protocol` | Cross-platform protocol cases and sample manifests/subtitles |
| `i18n/native-strings.json` | Strings that only the native apps use (7 languages) |
| `tools/export-brand.cjs` | Generates brand, strings, colors, icons and splash for both platforms |

Design: the cores contain serial state machines with no I/O. Every socket and
timer goes through an injected `Transport` with a unique token, so events from
replaced connections are ignored. Events are delivered on the owner's context
(Android main looper, iOS main queue); network I/O and parsing run elsewhere.

## Build and test

From the repository root with Node.js 22, JDK 17+ and the Android SDK (36):

```powershell
node native/tools/sync-vectors.cjs --check
node native/tools/export-brand.cjs --check
cd native/android
.\gradlew.bat :core:test :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

The app build runs `export-brand.cjs` itself, so brand/strings changes in
`src/brand`, `src/i18n`, `src/theme.js` or `native/i18n` are picked up
automatically. Release builds read `MEDIASYNC_KEYSTORE`, `MEDIASYNC_KEYSTORE_PASSWORD`,
`MEDIASYNC_KEY_ALIAS` and `MEDIASYNC_KEY_PASSWORD`; `MEDIASYNC_VERSION_CODE`
overrides the version code.

The app unit tests cover content-download cancellation while reading the body,
response cleanup, size limits, metadata truncation and HTTP errors using controlled
OkHttp interceptors. They do not prove session replacement or real-network behavior.

End-to-end against the TV emulator (no real TV needed):

```powershell
cd tools/tv-emulator; npm ci; $env:EMU_IP='127.0.0.1'; node index.js
# in another terminal
cd native/android; .\gradlew.bat :core:test "-Pmediasync.emulator=127.0.0.1"
```

Add `"-Pmediasync.emulatorCompat=true"` to also check the compat (App2App)
transport; it requires the emulator's `/tv` page open in a browser.

iOS, on macOS with Xcode 16 and XcodeGen:

```sh
swift test --package-path native/ios
sh native/ios/App/generate.sh
xcodebuild -project native/ios/App/MediaSync.xcodeproj -scheme MediaSync \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO test
```

**iOS baseline verified on 2026-10-01:** Xcode 26.0.1 and XcodeGen 2.46.0;
41 Swift core tests and 2 hosted app tests passed on the iPhone 17 Pro simulator.
The Release arm64 archive also built successfully without signing. Use an
installed simulator destination rather than assuming iPhone 16 is available.
Real TVs and production signing remain unverified.

Physical iPhone against the emulator without Apple's multicast entitlement: build
Debug with `CODE_SIGN_ENTITLEMENTS=` and launch with
`MEDIASYNC_SSDP_DESTINATION=<emulator IP>` (Debug-only unicast M-SEARCH), e.g.
`xcrun devicectl device process launch --environment-variables '{"MEDIASYNC_SSDP_DESTINATION":"192.168.1.48"}' <bundle id>`.
Everything after discovery uses unicast and is exercised normally.

Native DASH on iOS is deferred: MobileVLCKit failed the device timing gate, and
DASH stays on the brand's sync web player for now (known gap). See the
[feasibility decision](../docs/ios-native-dash.md).

## Decisions and known gaps

- Default sync mode is compat (React Native parity); native is used when the
  probe confirms it or the user selected it for that TV model.
- The CSS-CII endpoint (`X_HbbTV_InterDevSyncURL`) is ws/wss; placeholder hosts
  are replaced with the host that answered discovery.
- System pauses (audio focus, headphones unplugged, interruptions) pause
  playback and require the user to resume.
- Non-HbbTV DIAL devices are listed under "other devices" but are not selectable.
- iOS plays DASH through the brand's sync web player. HLS subtitle selection
  now uses Media3/AVPlayer with a single app overlay; device timing and visual
  verification remain pending. External TTML/VTT selection is exposed on iOS.
- Live catalogs refresh every 1-60 seconds with cancellation and stable track
  selection. Finite text SegmentTimeline/SegmentList indexes are supported,
  capped at 10000 segments. Byte ranges, unresolved open timelines, fMP4 wvtt
  and TTML styles/regions remain unsupported. Swift changes await Xcode.
- CI also builds Android release APK/AAB and an unsigned iOS archive. These
  are validation artifacts, not approved store releases; production signing,
  upgrade testing and rollout authorization remain required.
- The apps keep the React Native package/bundle ids and migrate the stored sync
  mode preference, so they can update the RN app in place.
- Debug builds use a `.dev` id suffix and can be installed side by side.

## Behavioral contract

The reference implementation is
`www/hbbtv_examples/sync_webplayer/SyncController.js`, also re-exported by the
React Native controller. After an intentional reference change, review the
behavior, run `node native/tools/sync-vectors.cjs`, inspect the fixture diff and
run both native test suites. Do not regenerate fixtures just to hide a failed port.

Each session owns one controller. Invoke it serially on the playback owner's
execution context; these mutable classes are not thread-safe. Time values and
thresholds are in seconds, rates are dimensionless, and drift is player minus TV.
Inputs must be finite measurements from the same timeline. The protocol/session
layer validates network data before calling the controller.

`seek` requests a seek to the caller's TV position and a return to normal speed;
`rate` requests a speed change; `none` must not issue a new player command.
Reset the controller when replacing a playback session. The existing 350 ms
dead-time default is preserved for parity, not asserted to be optimal for native
players; retune it only after actual device measurements.

The Swift tests intentionally read the repository-level fixtures through their
source location. Run them from a full checkout, not an isolated copied package.

## Next steps

1. Repeat the locally verified baseline in macOS CI.
2. Test on physical devices and TVs: multicast, permissions, TalkBack/VoiceOver,
   30-minute background sessions and battery (see the parity matrix).
3. Close the documented gaps and pending product decisions, then start the beta
   and cutover plan of PRD-014.

Keep brand values sourced from `src/brand/brand.config.js`; generated native
resources must not be edited by hand. Preserve all existing localized UI languages.

Do not put handwritten native applications in root `android/` or `ios/`: those
directories are ignored Expo prebuild outputs. The versioned migration lives here.

## Discovery contract

`DialProtocol` builds the existing DIAL M-SEARCH request, accepts HTTP 200 SSDP
responses for the DIAL search target, and parses namespace-qualified device and
HbbTV application XML. The device application base must come from the HTTP
`Application-URL` header; it is never guessed from the description location.
The HTTP adapters check response status and pass that header to
`parseDevice`, then fetch the resulting `hbbtvUrl` with the existing
`DialApp/1.0` user agent. Missing display names remain null for the UI to localize.

Unlike the permissive JavaScript parser, these parsers reject duplicate SSDP
headers, unsupported URL schemes, credentials, fragments, malformed XML and DTDs.
App2App and inter-device sync endpoints must use WS/WSS.
The transports enforce response size limits, timeouts and reject redirects.

`DiscoverySession` is mutable and must be used serially on its owning execution
context. `start()` begins a fresh scan, `accept()` reserves a unique request,
and `complete()` accepts the resulting terminal or releases the reservation on
failure (`null` in Kotlin, `nil` in Swift). Repeated packets are suppressed while
a request is pending or its terminal is already present. Each request has its
own identity so late completions cannot affect a restarted scan or a retry.

`finish()` ends the scan and keeps the results; `stop()` clears them. Both discard
pending requests. These methods invalidate results but do not themselves cancel
sockets or HTTP operations; the transport owner handles those resources. A failed
description fetch can be retried when another SSDP response arrives.

The session defaults to HbbTV-only. The apps pass `allowNonHbbtvDevices = true`
to preserve the React Native configuration and show those devices separately.

## Network transport

Kotlin `DialDiscoveryScan.run()` blocks and must run on a worker, never the UI
thread. Each scan is single-use; call `close()` from its lifecycle owner to cancel
and close the UDP socket and active HTTP connection. The result contains discovered
terminals, bounded device-request failures and a cancellation flag. `onFound`
executes on the scan worker; dispatch UI updates explicitly and discard callbacks
from replaced scans. Cancellation returns an empty terminal list but cannot undo
callbacks already delivered to the owner. Fatal socket/setup errors propagate.

Swift `DialDiscoveryScan.run()` is async and returns the same result categories.
Cancel its owning `Task` to close reception and cancel HTTP. A Dispatch deadline
ends reception and invalidates HTTP even while waiting for a device response.
The socket descriptor is closed in the Dispatch source cancellation handler.
Both report terminals incrementally through `onFound`.

Both transports use an ephemeral IPv4 socket and accept unicast replies to
M-SEARCH, rather than subscribing to unsolicited SSDP announcements. The default
scan lasts 30 seconds; requests use a five-second timeout, bodies are limited to
1 MiB and results to 128 devices. M-SEARCH is resent after 1 s and 3 s, and up
to four devices are resolved concurrently so a slow TV does not delay others.
Interface selection is explicitly configurable (`networkInterface` in Kotlin,
IPv4 `interfaceAddress` in Swift); the apps pass the Wi-Fi/Ethernet interface.
Physical-device multicast, network changes, iOS entitlement/ATS and Android
permissions remain unverified.

The Kotlin network tests use ephemeral UDP and HTTP loopback ports and verify
the actual request bytes, application header, HbbTV query, deduplication, HTTP
errors, redirects, fixed/chunked size limits, non-HbbTV mode, cancellation during
receive and HTTP, and scan expiry during a blocked HTTP request. They do not prove
Android device compatibility or multicast behavior. The HTTP test server is JDK
test-only and is not part of the shipped core.