import AVFoundation
import MediaSyncCore
import SwiftUI
import UIKit

/// Localized labels derived from core models; the core never returns display text.
enum Labels {
    private static let languages: Set<String> = ["ca", "es", "eu", "en", "fr", "de", "it", "pt"]

    static func language(_ code: String?, kind: TrackKind) -> String {
        guard let code = code, !code.isEmpty else {
            switch kind {
            case .audio: return L10n.t("discovery.media.audioGeneric")
            case .video: return L10n.t("discovery.media.videoGeneric")
            case .text: return L10n.t("discovery.media.subtitleGeneric")
            }
        }
        let normalized = code.lowercased().split(separator: "-").first.map(String.init) ?? code
        if normalized.range(of: "^q[a-t][a-z]$", options: .regularExpression) != nil || normalized == "mis" { return L10n.t("discovery.media.otherLang") }
        if normalized == "und" { return L10n.t("discovery.media.undefinedLang") }
        return languages.contains(normalized) ? L10n.t("discovery.media.languages.\(normalized)") : code.uppercased()
    }

    static func audioRole(_ track: MediaTrack) -> String {
        if track.audioDescription || track.role == "description" { return L10n.t("discovery.audioDescription") }
        if track.role == nil || track.role == "main" { return L10n.t("discovery.audioMain") }
        if track.label?.lowercased().contains("original") == true || track.role == "dub" { return L10n.t("discovery.audioOriginal") }
        return L10n.t("discovery.audioAlternative")
    }

    static func title(_ track: MediaTrack) -> String {
        let base: String
        if let label = track.label { base = label }
        else if track.kind == .video && track.signLanguage { base = L10n.t("discovery.media.signLanguage") }
        else if track.kind == .audio && track.audioDescription { base = L10n.t("discovery.media.audioDescription") }
        else if track.kind == .video, let role = track.role, role != "main" { base = "\(L10n.t("discovery.media.videoGeneric")) (\(role))" }
        else { base = language(track.language, kind: track.kind) }
        var extras: [String] = []
        let codecs = track.codecs?.lowercased() ?? ""
        let codec = codecs.contains("ec-3") ? "Dolby" : codecs.contains("ac-3") ? "AC3" : codecs.contains("mp4a") ? "AAC" : nil
        if track.kind == .audio, let codec = codec, !base.contains(codec) { extras.append(codec) }
        if track.kind == .video, let width = track.width, let height = track.height { extras.append("\(width)x\(height)") }
        return extras.isEmpty ? base : "\(base) (\(extras.joined(separator: ", ")))"
    }

    static func syncStatus(_ status: PlaybackCorrector.Status, rate: Double) -> String {
        switch status {
        case .locked: return L10n.t("discovery.syncLocked")
        case .adjusting: return L10n.t("discovery.syncAdjusting", String(format: "%.3f", locale: Locale(identifier: "en_US_POSIX"), rate))
        case .seeking: return L10n.t("discovery.syncSeeking")
        case .paused: return L10n.t("native.player.pausedOnTv")
        case .waiting: return L10n.t("discovery.syncWaiting")
        }
    }

    static func session(_ snapshot: MediaSyncSession.Snapshot?) -> String? {
        guard let snapshot = snapshot else { return nil }
        switch snapshot.issue {
        case .none: break
        case .noEndpoint: return L10n.t("discovery.terminalNoSyncUrl")
        case .ciiUnreachable: return L10n.t("discovery.connectionError")
        case .connectionLost: return L10n.t("discovery.retryingConnection")
        case .invalidEndpoints: return L10n.t("native.terminal.invalidEndpoints")
        case .noContent: return L10n.t("discovery.noContentSelected")
        case .presentationFault: return L10n.t("native.terminal.presentationFault")
        case .unsupportedTimeline: return L10n.t("native.terminal.unsupportedTimeline")
        case .timelineUnavailable: return L10n.t("native.terminal.timelineUnavailable")
        case .wallClockUnsynchronised: return L10n.t("native.terminal.wallClock")
        }
        switch snapshot.state {
        case .disconnected: return nil
        case .connecting: return L10n.t("native.terminal.connecting")
        case .waitingContent: return L10n.t("discovery.waitingForContent")
        case .synchronising: return L10n.t("native.terminal.synchronising")
        case .synchronised: return L10n.t(snapshot.mode == .compat ? "discovery.statusConnectedCompat" : "discovery.statusConnected")
        case .recovering: return L10n.t("discovery.retryingConnection")
        case .error: return L10n.t("discovery.connectionError")
        }
    }
}

struct DiscoveryView: View {
    @EnvironmentObject private var discovery: DiscoveryModel
    @EnvironmentObject private var session: SessionModel
    let onOpen: (DialTerminal) -> Void
    let onHelp: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing("sm")) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading) {
                        Text(L10n.t("discovery.title")).font(.title2.bold()).foregroundColor(Theme.onSurface).accessibilityAddTraits(.isHeader)
                        Text(L10n.t("discovery.subtitle")).font(.subheadline).foregroundColor(Theme.onSurfaceVariant)
                    }
                    Spacer()
                    Button(action: onHelp) { Image(systemName: "questionmark.circle").font(.title2) }
                        .frame(minWidth: 44, minHeight: 44).accessibilityLabel(L10n.t("nav.help"))
                }
                if let active = session.terminal, session.isActive {
                    Button { onOpen(active) } label: {
                        Text("\(L10n.t("native.discovery.activeSession")) · \(active.device.friendlyName ?? L10n.t("native.discovery.unnamedTv"))")
                            .frame(maxWidth: .infinity, alignment: .leading).padding(Theme.spacing("md"))
                            .background(Theme.color("primaryContainer")).foregroundColor(Theme.color("onPrimaryContainer"))
                            .cornerRadius(Theme.radius("lg"))
                    }
                }
                HStack(spacing: Theme.spacing("sm")) {
                    if discovery.phase == .searching { ProgressView() }
                    if let status = statusText { Text(status).foregroundColor(Theme.onSurfaceVariant).font(.body) }
                }
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
                HStack {
                    if discovery.phase == .searching {
                        Button(L10n.t("native.discovery.cancel")) { discovery.cancel() }.buttonStyle(.bordered)
                    } else {
                        Button(L10n.t("native.discovery.rescan")) { discovery.start() }.buttonStyle(.borderedProminent)
                    }
                    if discovery.problem == .permission || discovery.problem == .noNetwork {
                        Button(L10n.t("native.discovery.openSettings")) {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }.buttonStyle(.bordered)
                    }
                }
                ForEach(discovery.syncCapable, id: \.device.id) { terminal in
                    Button { onOpen(terminal) } label: { TerminalRow(terminal: terminal, enabled: true) }
                }
                if !discovery.others.isEmpty {
                    Text(L10n.t("discovery.otherDevices")).font(.headline).foregroundColor(Theme.onSurfaceVariant)
                        .padding(.top, Theme.spacing("md")).accessibilityAddTraits(.isHeader)
                    ForEach(discovery.others, id: \.device.id) { TerminalRow(terminal: $0, enabled: false) }
                }
                if discovery.phase == .finished && discovery.problem == nil && discovery.syncCapable.isEmpty {
                    Text(L10n.t("discovery.errorHint")).foregroundColor(Theme.onSurfaceVariant)
                }
            }
            .padding(Theme.spacing("containerPadding"))
        }
        .background(Theme.background.ignoresSafeArea())
        .onAppear { if discovery.phase == .idle { discovery.start() } }
    }

    private var statusText: String? {
        switch discovery.problem {
        case .noNetwork: return L10n.t("native.discovery.noNetwork")
        case .permission: return L10n.t("native.discovery.permissionMessage")
        case .sendFailed: return L10n.t("native.discovery.sendFailed")
        case nil:
            if discovery.phase == .searching { return L10n.t("discovery.scanning") }
            if discovery.phase == .finished && discovery.syncCapable.isEmpty { return L10n.t("discovery.noMediaSyncDevices") }
            return nil
        }
    }
}

private struct TerminalRow: View {
    let terminal: DialTerminal
    let enabled: Bool

    var body: some View {
        HStack(spacing: Theme.spacing("md")) {
            Image(systemName: "tv").foregroundColor(Theme.onSurface).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(terminal.device.friendlyName ?? L10n.t("native.discovery.unnamedTv")).font(.headline).foregroundColor(Theme.onSurface)
                let detail = [terminal.device.manufacturer, terminal.device.modelName].compactMap { $0 }.joined(separator: " · ")
                if !detail.isEmpty { Text(detail).font(.caption).foregroundColor(Theme.onSurfaceVariant) }
                if !enabled { Text(L10n.t("native.discovery.nonHbbtvNotice")).font(.caption).foregroundColor(Theme.onSurfaceVariant) }
            }
            Spacer()
        }
        .padding(Theme.spacing("md"))
        .frame(minHeight: 44)
        .background(Theme.surface)
        .cornerRadius(Theme.radius("lg"))
        .accessibilityElement(children: .combine)
    }
}

struct HelpView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.presentationMode) private var presentationMode

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.spacing("md")) {
                    Text(L10n.t("help.mainSubtitle")).foregroundColor(Theme.onSurfaceVariant)
                    VStack(alignment: .leading, spacing: Theme.spacing("md")) {
                        Text(L10n.t("help.troubleshootingTitle")).font(.headline).foregroundColor(Theme.onSurface).accessibilityAddTraits(.isHeader)
                        ForEach(Array(L10n.list("help.troubleshootingSteps").enumerated()), id: \.offset) { index, step in
                            Text("\(index + 1). \(step)").foregroundColor(Theme.onSurface)
                        }
                    }
                    .padding(Theme.spacing("lg")).background(Theme.surface).cornerRadius(Theme.radius("lg"))
                    HStack {
                        if let support = BrandConfig.supportUrl.flatMap(URL.init(string:)) {
                            Link(L10n.t("native.help.support"), destination: support).buttonStyle(.bordered)
                        }
                        ShareLinkButton(text: app.diagnostics.export())
                    }
                    Text("\(BrandConfig.appName) \(BrandConfig.version)").font(.caption).foregroundColor(Theme.onSurfaceVariant)
                }
                .padding(Theme.spacing("containerPadding"))
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(L10n.t("help.mainTitle"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("native.terminal.back")) { presentationMode.wrappedValue.dismiss() }
                }
            }
        }
    }
}

/// Diagnostics leave the device only when the user shares them.
private struct ShareLinkButton: View {
    let text: String
    @State private var sharing = false

    var body: some View {
        Button(L10n.t("native.help.exportDiagnostics")) { sharing = true }
            .buttonStyle(.bordered)
            .sheet(isPresented: $sharing) { ActivitySheet(items: [text]) }
    }
}

private struct ActivitySheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Video surface bound to the single app player; audio-only playback never creates one.
struct VideoSurface: UIViewRepresentable {
    let player: AVPlayer

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.player = player
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) { view.playerLayer.player = player }

    static func dismantleUIView(_ view: PlayerView, coordinator: ()) { view.playerLayer.player = nil }
}

struct SubtitleOverlay: View {
    let text: String?
    var body: some View {
        if let text = text {
            Text(text).font(.body).multilineTextAlignment(.center).foregroundColor(.white)
                .padding(.horizontal, 8).padding(.vertical, 4).background(Color.black.opacity(0.7)).cornerRadius(4).padding(8)
        }
    }
}

struct FullscreenVideo: View {
    @EnvironmentObject private var session: SessionModel
    let onExit: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            VideoSurface(player: session.playerOwner.player).ignoresSafeArea()
            VStack { Spacer(); SubtitleOverlay(text: session.subtitleText) }
            Button(action: onExit) { Image(systemName: "arrow.down.right.and.arrow.up.left").font(.title2).foregroundColor(.white).padding() }
                .accessibilityLabel(L10n.t("native.terminal.exitFullscreen"))
        }
    }
}
