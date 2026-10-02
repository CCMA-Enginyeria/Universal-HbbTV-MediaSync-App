# Native iOS DASH feasibility

Date: 2026-10-01. Status: isolated native probe passes basic playback/seek-position
checks on a physical iPhone with the user-provided CCMA sample.

## Executable probe

`native/ios/DashProbe` is an independent development-only application, not a
production playback adapter. MobileVLCKit 3.7.3 is pinned in Podfile and
Podfile.lock. The production app and CI do not depend on this target.

From that directory:

```sh
xcodegen generate
pod install
xcodebuild -workspace DashProbe.xcworkspace -scheme DashProbe \
   -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
   CODE_SIGNING_ALLOWED=NO test
```

The probe accepts an MPD URL and provides native video, play/stop, rate requests
and absolute seeks. It records monotonic elapsed time, media time, reported rate,
state and seekability to the screen and console. It does not infer live UTC or
claim that a time event means seek completion. Its diagnostic strings are
development-only and are not part of the localized shipping application.

Verified locally: dependency installation, simulator Debug build and launch,
and unsigned iphoneos Release build succeeded. On 2026-10-01, the signed probe
ran on the connected iPhone (iPhone15,4, iOS 26.6.1). The original Envivio sample
failed with a zero media clock on both simulator and device; its cause remains
unresolved, not evidence that all DASH playback fails.

After changing only the test URL to the user's CCMA IBC sample
(`ibc-2026/_dash_Signes_IBC/manifest_signes.mpd`), the same physical-device test
passed: 1 test, 0 failures, 6.794 seconds. The clock advanced beyond 2 seconds
and reported 30 seconds after the seek request. Results are in
`/tmp/mediasync-dash-ccma.xcresult` and `/tmp/mediasync-dash-ccma.log` on the test
Mac. The user also reported successful manual playback. Reported seek position
does not establish decoded-frame arrival, resumed output or exact seek latency.
Live UTC mapping, fine rate correction and background behavior remain unverified.

## Timing gate result (2026-10-01): failed

`Tests/TimingTests.swift` fixes its thresholds in code before measurement:
measured rate within max(0.001, 25 % of the requested excess); seek landing within
the 2 s seek threshold; media time advancing plus 5 new displayed pictures within
3 s of the request. Same CCMA sample, same iPhone (iOS 26.6.1), signed run:

| Requested rate | Measured (20 s fit) | Error | Max deviation from fit |
| --- | --- | --- | --- |
| 1.000 | 1.00026 | +0.00026 | 0.62 s |
| 0.950 | 0.95454 | +0.00454 | 0.57 s |
| 0.998 | 0.99691 | -0.00109 (fail) | 0.62 s |
| 1.002 | 1.00328 | +0.00128 (fail) | 0.65 s |
| 1.050 | 1.04588 | -0.00412 | 0.67 s |
| 1.000 | 0.99990 | -0.00010 | 0.61 s |

| Seek target | Landed | Advancing after | 5 new pictures after |
| --- | --- | --- | --- |
| 30.0 | 28.865 | 6.81 s | 7.07 s (fail) |
| 121.3 | 121.561 | 4.38 s | 4.66 s (fail) |
| 600.7 | 598.863 | 4.05 s | 4.33 s (fail) |
| 15.0 | 15.639 | 3.81 s | 4.08 s (fail) |
| 1000.0 | 998.863 | 4.40 s | 4.68 s (fail) |

Findings:

- The reported media time changes only about 3 times per second and deviates up
  to 0.67 s from a smooth clock. That noise is far larger than the sync accuracy
  the corrector is designed for and would dominate its drift filter. Whether
  interpolation between updates removes it was not measured.
- The two finest correction steps overshoot by about 0.0011-0.0013. The large
  steps, 0.95 and 1.05, are within tolerance.
- Landing is within the 2 s threshold (snapping to about the 2 s segment grid),
  but output resumes after 4-7 s on the device, versus 2.3-3.9 s on the simulator.
- The simulator run also failed (0.998, 1.002, and 2 of 5 seeks). Simulator
  numbers are not device evidence.

The candidate does not pass as-is.

## Decision (2026-10-01)

Product decision: iOS keeps playing DASH through the brand's sync web player for
now; native DASH is deferred, not rejected. This is a known gap and does not satisfy
the native-DASH goal. No VLC dependency enters the production app. Options when it is
revisited: local DASH-to-HLS repackaging for AVPlayer (preferred candidate for clear
fMP4 avc1/mp4a content), VLC clock interpolation plus segment-aligned seeks, or
another engine, each measured with `TimingTests` thresholds. Live timeline mapping, tracks, interruptions and background
behavior remain unmeasured. Retain the Envivio failure as a separate
source-compatibility investigation.
The external-source test requires network access and is not a deterministic
unit test. The probe is not suitable for distribution or release signing.

The migration requires DASH playback without WKWebView. AVPlayer remains the
HLS engine; WKWebView remains available for actual web companion experiences.
The existing DASH web route is baseline behavior, not fulfillment of this goal.

## Candidate and evidence

MobileVLCKit/libVLC is a candidate for a native playback spike:

- [VideoLAN overview](https://www.videolan.org/vlc/libvlc.html): native library and Apple bindings.
- [Official distribution](https://download.videolan.org/pub/cocoapods/prod/): MobileVLCKit 3.7.3 is listed; inspect and pin the actual artifact before integration.
- [VLCKit README](https://raw.githubusercontent.com/videolan/vlckit/master/README.md): CocoaPods integration and LGPL 2.1 licensing. Review exact binary dependencies and redistribution/relinking obligations; this is not App Store approval.
- [VLC 3 changelog](https://raw.githubusercontent.com/videolan/vlc/3.0.x/NEWS): DASH and live DASH support. This does not prove compatibility with all broadcaster manifests.
- [Player API](https://videolan.videolan.me/VLCKit/interface_v_l_c_media_player.html): native drawable, tracks, time, seek and rate. Requested rate may be ignored or differ from actual rate.
- [Delegate API](https://videolan.videolan.me/VLCKit/protocol_v_l_c_media_player_delegate-p.html): state/time events, not an explicit seek-completed guarantee.

## Required experiment before production integration

1. Verify the pinned binary's device/simulator slices, minimum OS, provenance,
   headers, size and license obligations. Source-build support does not prove
   that a particular distributed binary contains the required slices.
2. Build a minimal native harness using controlled clear DASH VOD/live streams
   and a representative broadcaster MPD. No web fallback.
3. Measure actual media progression at 0.95, 0.998, 1, 1.002 and 1.05 times
   speed, not only rate-property readback.
4. Establish the relation between player time and DASH presentation time across
   MPD refreshes, moving windows and periods. Do not assume availability start
   plus player time equals UTC. The existing corrector needs a valid live epoch.
5. Measure seek landing and settling; implement generation-scoped completion,
   failure and timeout semantics. A time-change event alone is not completion.
6. Verify language/accessibility track identity, subtitle output, interruptions,
   locked-screen audio and resource release on a physical iPhone as well as the
   simulator. Define numerical acceptance thresholds before accepting results.

Only after these gates should PlayerOwner gain engine adapters and SessionModel,
TerminalView, Views and MediaSyncApp stop routing DASH to the web player. Preserve
one active engine and the existing PlaybackCorrector policy. If the candidate
fails, report the limitation instead of silently reinstating a web fallback.

## Baseline evidence

Xcode 26.0.1, XcodeGen 2.46.0: 41 core tests and 2 hosted simulator tests passed;
unsigned Release arm64 archive succeeded. A test-target product-name collision
was fixed with separate executable/module and bundle identities and a regression
test. This evidence proves neither DASH playback nor physical-device timing.