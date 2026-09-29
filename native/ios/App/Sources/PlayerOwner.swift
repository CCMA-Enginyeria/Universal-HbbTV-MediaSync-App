import AVFoundation
import Foundation
import MediaSyncCore

/**
 * The single AVPlayer of the app, used on the main thread. Tracks are selected
 * by media-selection identity (language, accessibility characteristic, name),
 * never by index. The audio session policy: interruptions and removed
 * headphones pause playback, and only the user resumes it (PRD-009-R04).
 */
final class PlayerOwner: NSObject, AVPlayerItemLegibleOutputPushDelegate {
    let player = AVPlayer()
    var onSeekCompleted: (() -> Void)?
    var onPlaybackError: ((Bool) -> Void)?
    var onSystemPause: (() -> Void)?

    private(set) var track: MediaTrack?
    private(set) var suspendedBySystem = false
    private var seeking = false
    private var desiredRate: Float = 1
    private var retries = 0
    private var manifestUrl: String?
    private var statusObservation: NSKeyValueObservation?
    private var retryItem: DispatchWorkItem?
    private var subtitleTrack: MediaTrack?
    private var subtitleRevision = 0
    private var legibleOutput: AVPlayerItemLegibleOutput?
    private(set) var subtitleText: String?

    override init() {
        super.init()
        player.automaticallyWaitsToMinimizeStalling = true
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    var isActive: Bool { track != nil }
    /// Playback intent (the equivalent of ExoPlayer's playWhenReady).
    var wantsToPlay: Bool { player.rate != 0 || player.timeControlStatus == .waitingToPlayAtSpecifiedRate }
    var isBuffering: Bool { seeking || player.timeControlStatus == .waitingToPlayAtSpecifiedRate }
    var rate: Double { Double(player.rate == 0 ? desiredRate : player.rate) }
    var positionS: Double { player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0 }
    var liveEpochS: Double? { player.currentItem?.currentDate()?.timeIntervalSince1970 }

    func play(url: String, track: MediaTrack, startPositionS: Double?, isLive: Bool, volume: Float) {
        guard let target = URL(string: url) else { return }
        self.track = track
        manifestUrl = url
        retries = 0
        suspendedBySystem = false
        desiredRate = 1
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: track.kind == .video ? .moviePlayback : .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        load(target, startPositionS: isLive ? nil : startPositionS)
        player.volume = volume
    }

    private func load(_ url: URL, startPositionS: Double?) {
        let item = AVPlayerItem(url: url)
        let output = AVPlayerItemLegibleOutput()
        output.suppressesPlayerRendering = true
        output.setDelegate(self, queue: .main)
        item.add(output)
        legibleOutput = output
        subtitleText = nil
        item.audioTimePitchAlgorithm = .timeDomain
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async { self?.statusChanged(item) }
        }
        player.replaceCurrentItem(with: item)
        if let start = startPositionS, start > 0 { seek(start) }
        player.playImmediately(atRate: desiredRate)
    }

    private func statusChanged(_ item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            retries = 0
            selectMedia(item)
            selectSubtitle(subtitleTrack)
        case .failed:
            guard let url = manifestUrl.flatMap(URL.init(string:)), retries < 3 else {
                onPlaybackError?(false)
                return
            }
            let delay = [2.0, 4.0, 8.0][retries]
            retries += 1
            onPlaybackError?(true)
            let work = DispatchWorkItem { [weak self] in
                guard let self = self, self.track != nil, self.manifestUrl == url.absoluteString else { return }
                self.load(url, startPositionS: nil)
            }
            retryItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        default:
            break
        }
    }

    private func selectMedia(_ item: AVPlayerItem) {
        guard let target = track else { return }
        let characteristic: AVMediaCharacteristic = target.kind == .video ? .visual : .audible
        Task { @MainActor [weak self] in
            guard let group = try? await item.asset.loadMediaSelectionGroup(for: characteristic), item === self?.player.currentItem else { return }
            let options = group.options.filter { option in
                let language = option.extendedLanguageTag ?? option.locale?.identifier
                let languageMatches = target.language == nil || language?.hasPrefix(target.language!) == true
                let describes = option.hasMediaCharacteristic(.describesVideoForAccessibility)
                return languageMatches && describes == target.audioDescription
            }
            let chosen = options.first { $0.displayName == target.label } ?? options.first
            if let chosen = chosen { item.select(chosen, in: group) }
        }
    }

    func apply(_ command: PlaybackCorrector.Command) {
        switch command {
        case .play: if !suspendedBySystem { player.playImmediately(atRate: desiredRate) }
        case .pause: player.pause()
        case .setRate(let value):
            desiredRate = Float(value)
            if player.rate != 0 { player.rate = desiredRate }
        case .seek(let seconds): seek(seconds)
        }
    }

    private func seek(_ seconds: Double) {
        subtitleText = nil
        seeking = true
        player.seek(to: CMTime(seconds: max(seconds, 0), preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                self?.seeking = false
                self?.onSeekCompleted?()
            }
        }
    }

    func resumeAfterSystemPause() {
        suspendedBySystem = false
        try? AVAudioSession.sharedInstance().setActive(true)
        player.playImmediately(atRate: desiredRate)
    }

    func setVolume(_ volume: Float) { player.volume = min(max(volume, 0), 1) }

    func selectSubtitle(_ track: MediaTrack?) {
        subtitleTrack = track
        subtitleText = nil
        subtitleRevision += 1
        let revision = subtitleRevision
        guard let item = player.currentItem else { return }
        Task { @MainActor [weak self] in
            guard let group = try? await item.asset.loadMediaSelectionGroup(for: .legible),
                  let self = self, item === self.player.currentItem,
                  revision == self.subtitleRevision else { return }
            let selected = track.flatMap { target in
                group.options.first { option in
                    let language = option.extendedLanguageTag ?? option.locale?.identifier
                    return (target.language == nil || language == target.language) &&
                        (target.label == nil || option.displayName == target.label)
                }
            }
            item.select(selected, in: group)
        }
    }

    func legibleOutput(_ output: AVPlayerItemLegibleOutput, didOutputAttributedStrings strings: [NSAttributedString],
                       nativeSampleBuffers: [Any], forItemTime itemTime: CMTime) {
        guard output === legibleOutput, subtitleTrack != nil else { return }
        let text = strings.suffix(4).map { $0.string }.joined(separator: "\n")
        subtitleText = text.isEmpty ? nil : text
    }

    func outputSequenceWasFlushed(_ output: AVPlayerItemOutput) {
        if output === legibleOutput { subtitleText = nil }
    }

    func stop() {
        selectSubtitle(nil)
        legibleOutput?.setDelegate(nil, queue: nil)
        legibleOutput = nil
        track = nil
        manifestUrl = nil
        seeking = false
        suspendedBySystem = false
        retryItem?.cancel()
        retryItem = nil
        statusObservation = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        desiredRate = 1
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    @objc private func interruption(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async { self.systemPause() }
    }

    @objc private func routeChange(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async {
            self.player.pause()
            self.systemPause()
        }
    }

    private func systemPause() {
        guard track != nil else { return }
        suspendedBySystem = true
        onSystemPause?()
    }
}
