import MediaSyncCore
import SwiftUI

struct TerminalView: View {
    @EnvironmentObject private var session: SessionModel
    let onHelp: () -> Void
    let onOpenWeb: () -> Void
    let onFullscreen: () -> Void
    let onBack: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing("sm")) {
                HStack {
                    Button(action: onBack) { Image(systemName: "chevron.backward").font(.title3) }
                        .frame(minWidth: 44, minHeight: 44).accessibilityLabel(L10n.t("native.terminal.back"))
                    Text(session.terminal?.device.friendlyName ?? L10n.t("native.discovery.unnamedTv"))
                        .font(.title3.bold()).foregroundColor(Theme.onSurface).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button(action: onHelp) { Image(systemName: "questionmark.circle").font(.title3) }
                        .frame(minWidth: 44, minHeight: 44).accessibilityLabel(L10n.t("nav.help"))
                }
                statusSection
                if !session.availableModes.isEmpty { modeSelector }
                contentSection
            }
            .padding(Theme.spacing("containerPadding"))
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarHidden(true)
    }

    @ViewBuilder private var statusSection: some View {
        if let terminal = session.terminal, !terminal.supportsMediaSync {
            message(L10n.t("native.discovery.noSyncSupport"))
        } else if session.noModes {
            message(L10n.t("native.terminal.noModes"))
            Button(L10n.t("native.terminal.retry")) { session.retry() }.buttonStyle(.bordered)
        } else if session.probing && session.availableModes.isEmpty {
            message(L10n.t("native.terminal.probing"))
        } else if let text = Labels.session(session.snapshot) {
            message(text)
        }
    }

    /// Shows the mode actually in use (PRD-006-R08); the stored preference can differ when
    /// the TV only offers the other stack. Unavailable modes are not offered.
    private var modeSelector: some View {
        let shown = session.effectiveMode ?? session.preferredMode
        return VStack(alignment: .leading, spacing: Theme.spacing("xs")) {
            section(L10n.t("discovery.modeTitle"))
            Picker(L10n.t("discovery.modeTitle"), selection: Binding(get: { shown }, set: { session.setPreferredMode($0) })) {
                ForEach(session.availableModes, id: \.self) { mode in
                    Text(L10n.t(mode == .native ? "discovery.modeNative" : "discovery.modeCompat")).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            Text(L10n.t(shown == .native ? "discovery.modeNativeDescription" : "discovery.modeCompatDescription"))
                .font(.caption).foregroundColor(Theme.onSurfaceVariant)
        }
    }

    @ViewBuilder private var contentSection: some View {
        switch session.content {
        case .none, .loading:
            if session.effectiveMode != nil { message(L10n.t("discovery.waitingForContent")) }
        case .failed(let reason):
            message(L10n.t(reason == .format ? "native.terminal.unsupportedContent"
                           : reason == .protected ? "native.terminal.protectedContent" : "native.terminal.manifestError"))
        case .web(let page):
            section(L10n.t("discovery.webSection"))
            HStack {
                Image(systemName: "globe").accessibilityHidden(true)
                VStack(alignment: .leading) {
                    Text(page.title ?? L10n.t("discovery.webAvailableTitle")).font(.headline)
                    Text(L10n.t("discovery.webAvailableSubtitle")).font(.caption).foregroundColor(Theme.onSurfaceVariant)
                }
                Spacer()
                Button(L10n.t("discovery.webOpen"), action: onOpenWeb).buttonStyle(.borderedProminent)
            }
            .foregroundColor(Theme.onSurface).padding(Theme.spacing("md")).background(Theme.surface).cornerRadius(Theme.radius("lg"))
        case .media(let manifest, let kind):
            let tracks = manifest.tracks.filter { !$0.isProtected }
            let audio = tracks.filter { $0.kind == .audio }
            let video = tracks.filter { $0.kind == .video }
            if !audio.isEmpty { section(L10n.t("discovery.audioSection")) }
            ForEach(audio, id: \.id) { TrackRow(track: $0, live: manifest.isLive, onFullscreen: onFullscreen) }
            if !video.isEmpty { section(L10n.t("discovery.videoSection")) }
            ForEach(video, id: \.id) { TrackRow(track: $0, live: manifest.isLive, onFullscreen: onFullscreen) }
            if !manifest.text.isEmpty {
                section(L10n.t("native.terminal.subtitles"))
                Picker(L10n.t("native.terminal.subtitles"), selection: Binding(
                    get: { session.subtitle?.id ?? "" },
                    set: { identity in session.selectSubtitle(manifest.text.first { $0.id == identity }) }
                )) {
                    Text(L10n.t("native.terminal.subtitlesOff")).tag("")
                    ForEach(manifest.text, id: \.id) { track in
                        Text(Labels.title(track)).tag(track.id)
                    }
                }
                .pickerStyle(.menu)
                if kind == .dash || session.selected == nil {
                    SubtitleOverlay(text: session.subtitleText)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func section(_ title: String) -> some View {
        Text(title).font(.headline).foregroundColor(Theme.onSurface).padding(.top, Theme.spacing("lg")).accessibilityAddTraits(.isHeader)
    }

    private func message(_ text: String) -> some View {
        Text(text).foregroundColor(Theme.onSurfaceVariant).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, Theme.spacing("sm"))
    }
}

private struct TrackRow: View {
    @EnvironmentObject private var session: SessionModel
    let track: MediaTrack
    let live: Bool
    let onFullscreen: () -> Void

    var body: some View {
        let selected = session.selected == track
        VStack(alignment: .leading, spacing: Theme.spacing("sm")) {
            HStack {
                VStack(alignment: .leading) {
                    Text(track.kind == .audio ? Labels.audioRole(track) : L10n.t("discovery.videoLabel")).font(.caption.bold()).foregroundColor(Theme.primary)
                    Text(Labels.title(track)).font(.headline).foregroundColor(Theme.onSurface)
                }
                Spacer()
                Button(selected ? L10n.t("discovery.stopSync") : L10n.t(track.kind == .audio ? "discovery.listen" : "discovery.watch")) {
                    session.play(track)
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
            if selected { panel }
        }
        .padding(Theme.spacing("md"))
        .background(selected ? Theme.surfaceHigh : Theme.surface)
        .cornerRadius(Theme.radius("lg"))
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private var panel: some View {
        if session.webPlayerUrl != nil {
            Text(L10n.t("native.player.webPlayer")).font(.caption).foregroundColor(Theme.onSurfaceVariant)
        } else {
            if track.kind == .video {
                ZStack(alignment: .topTrailing) {
                    VideoSurface(player: session.playerOwner.player).aspectRatio(16 / 9, contentMode: .fit)
                    VStack { Spacer(); SubtitleOverlay(text: session.subtitleText) }
                    Button(action: onFullscreen) { Image(systemName: "arrow.up.left.and.arrow.down.right").foregroundColor(.white).padding(10) }
                        .accessibilityLabel(L10n.t("native.terminal.fullscreen"))
                }
            } else if let text = session.subtitleText {
                Text(text).multilineTextAlignment(.center).frame(maxWidth: .infinity).foregroundColor(Theme.onSurface)
            }
            let status = Labels.syncStatus(session.status, rate: session.rate)
            HStack {
                Text(status).font(.caption.bold()).foregroundColor(session.status == .locked ? Theme.success : Theme.tertiary)
                    .accessibilityLabel(L10n.t("native.a11y.syncStatus", status))
                Spacer()
                Text(live ? L10n.t("discovery.live") : TimelineMath.formatClock(session.positionS)).font(.caption.monospacedDigit())
                    .foregroundColor(Theme.onSurfaceVariant).accessibilityHidden(true)
            }
            if session.suspendedBySystem {
                HStack {
                    Text(L10n.t("native.player.pausedBySystem")).foregroundColor(Theme.onSurfaceVariant)
                    Spacer()
                    Button(L10n.t("native.player.resume")) { session.resumeAfterSystemPause() }.buttonStyle(.bordered)
                }
            } else if session.playerRetrying {
                Text(L10n.t("native.player.retrying")).foregroundColor(Theme.onSurfaceVariant)
            } else if session.playerFailed {
                Text(L10n.t("native.player.failed")).foregroundColor(Theme.onSurfaceVariant)
            } else if track.kind == .audio {
                Text(L10n.t("discovery.backgroundHint")).font(.caption).foregroundColor(Theme.onSurfaceVariant)
            }
            Slider(value: Binding(get: { Double(session.volume) }, set: { session.setVolume(Float($0)) }), in: 0...1)
                .accessibilityLabel(L10n.t("native.player.volume"))
        }
    }
}
