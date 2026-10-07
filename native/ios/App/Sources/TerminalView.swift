import MediaSyncCore
import SwiftUI

struct TerminalView: View {
    @EnvironmentObject private var session: SessionModel
    let onHelp: () -> Void
    let onOpenWeb: (String) -> Void
    let onBack: () -> Void

    /// The catalog scrolls; the player is docked below it by the root view (see `PlayerDock`).
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onBack) { Image(systemName: "chevron.backward").font(.title3) }
                    .frame(minWidth: 44, minHeight: 44).accessibilityLabel(L10n.t("native.terminal.back"))
                Text(session.terminal?.device.friendlyName ?? L10n.t("native.discovery.unnamedTv"))
                    .font(.title3.bold()).foregroundColor(Theme.onSurface).accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: onHelp) { Image(systemName: "questionmark.circle").font(.title3) }
                    .frame(minWidth: 44, minHeight: 44).accessibilityLabel(L10n.t("nav.help"))
            }
            .padding(.horizontal, Theme.spacing("containerPadding"))
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.spacing("sm")) {
                    statusSection
                    if !session.availableModes.isEmpty { modeSelector }
                    contentSection
                }
                .padding(Theme.spacing("containerPadding"))
            }
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
        case .web:
            webSection
        case .media(let manifest, _):
            webSection
            let tracks = manifest.tracks.filter { !$0.isProtected }
            let audio = tracks.filter { $0.kind == .audio }
            let video = tracks.filter { $0.kind == .video }
            if !audio.isEmpty || !video.isEmpty || !manifest.text.isEmpty { message(L10n.t("native.terminal.selectHint")) }
            if !audio.isEmpty { section(L10n.t("discovery.audioSection")) }
            ForEach(audio, id: \.id) { ComponentRow(track: $0, checked: session.audio == $0) }
            if !video.isEmpty { section(L10n.t("discovery.videoSection")) }
            ForEach(video, id: \.id) { ComponentRow(track: $0, checked: session.video == $0) }
            if !manifest.text.isEmpty { section(L10n.t("native.terminal.subtitles")) }
            ForEach(manifest.text, id: \.id) { ComponentRow(track: $0, checked: session.subtitle == $0) }
        }
    }

    @ViewBuilder private var webSection: some View {
        let pages = session.webPages
        if !pages.isEmpty {
            section(L10n.t("discovery.webSection"))
            ForEach(pages, id: \.url) { page in
                HStack {
                    Image(systemName: "globe").accessibilityHidden(true)
                    VStack(alignment: .leading) {
                        let title = page.title ?? L10n.t("discovery.webAvailableTitle")
                        Text(page.language.map { "\(title) · \(Labels.language($0, kind: .text))" } ?? title).font(.headline)
                        Text(L10n.t("discovery.webAvailableSubtitle")).font(.caption).foregroundColor(Theme.onSurfaceVariant)
                    }
                    Spacer()
                    Button(L10n.t("discovery.webOpen")) { onOpenWeb(page.url) }.buttonStyle(.borderedProminent)
                }
                .foregroundColor(Theme.onSurface).padding(Theme.spacing("md")).background(Theme.surface).cornerRadius(Theme.radius("lg"))
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

/// One component of the content; at most one audio, one video and one subtitle track are checked.
private struct ComponentRow: View {
    @EnvironmentObject private var session: SessionModel
    let track: MediaTrack
    let checked: Bool

    var body: some View {
        Button { session.toggle(track) } label: {
            HStack(spacing: Theme.spacing("md")) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(.title2).foregroundColor(checked ? Theme.primary : Theme.onSurfaceVariant)
                    .accessibilityHidden(true)
                VStack(alignment: .leading) {
                    if track.kind != .text {
                        Text(track.kind == .audio ? Labels.audioRole(track) : L10n.t("discovery.videoLabel"))
                            .font(.caption.bold()).foregroundColor(Theme.primary)
                    }
                    Text(Labels.title(track)).font(.headline).foregroundColor(Theme.onSurface)
                }
                Spacer()
            }
            .frame(minHeight: 44)
            .padding(Theme.spacing("md"))
            .background(checked ? Theme.surfaceHigh : Theme.surface)
            .cornerRadius(Theme.radius("lg"))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/**
 * Player docked at the bottom of the app while components are checked: picture (AVPlayer or
 * the DASH web player), subtitles, sync status and volume. It stays below the TV list too, so
 * the web player, which lives in this view, keeps playing when the user leaves the TV screen.
 */
struct PlayerDock: View {
    @EnvironmentObject private var session: SessionModel
    let onFullscreen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing("sm")) {
            if let url = session.webPlayerUrl {
                if session.video != nil {
                    CompanionScreen(url: url) { session.stopAll() }
                        .aspectRatio(16 / 9, contentMode: .fit).frame(maxWidth: .infinity, maxHeight: 280)
                } else {
                    CompanionScreen(url: url) { session.stopAll() }.frame(height: 120)
                }
            }
            if session.video != nil && session.webPlayerUrl == nil {
                ZStack(alignment: .topTrailing) {
                    VideoSurface(player: session.playerOwner.player)
                    VStack { Spacer(); SubtitleOverlay(text: session.subtitleText) }
                    Button(action: onFullscreen) { Image(systemName: "arrow.up.left.and.arrow.down.right").foregroundColor(.white).padding(10) }
                        .accessibilityLabel(L10n.t("native.terminal.fullscreen"))
                }
                .aspectRatio(16 / 9, contentMode: .fit).frame(maxWidth: .infinity, maxHeight: 280)
            } else if session.subtitle != nil {
                // Audio only, subtitles only or the web player (which does not render them): the text sits below.
                Text(session.subtitleText ?? " ").multilineTextAlignment(.center).frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundColor(Theme.onSurface)
            }
            if session.isActive { controls }
        }
        .padding(.horizontal, Theme.spacing("containerPadding"))
        .padding(.vertical, Theme.spacing("sm"))
        .background(Theme.surfaceHigh.ignoresSafeArea(edges: .bottom).shadow(radius: 8))
    }

    @ViewBuilder private var controls: some View {
        HStack {
            if session.webPlayerUrl != nil {
                Text(L10n.t("native.player.webPlayer")).font(.caption).foregroundColor(Theme.onSurfaceVariant)
            } else {
                let status = Labels.syncStatus(session.status, rate: session.rate)
                Text(status).font(.caption.bold()).foregroundColor(session.status == .locked ? Theme.success : Theme.tertiary)
                    .accessibilityLabel(L10n.t("native.a11y.syncStatus", status))
            }
            Spacer()
            Text(isLive ? L10n.t("discovery.live") : TimelineMath.formatClock(session.positionS)).font(.caption.monospacedDigit())
                .foregroundColor(Theme.onSurfaceVariant).accessibilityHidden(true)
            Button(L10n.t("discovery.stopSync")) { session.stopAll() }.frame(minHeight: 44)
        }
        if session.webPlayerUrl == nil {
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
            } else if session.video == nil {
                Text(L10n.t("discovery.backgroundHint")).font(.caption).foregroundColor(Theme.onSurfaceVariant)
            }
            // Without a checked audio track nothing is audible, so there is no volume to set.
            if session.audio != nil {
                Slider(value: Binding(get: { Double(session.volume) }, set: { session.setVolume(Float($0)) }), in: 0...1)
                    .accessibilityLabel(L10n.t("native.player.volume"))
            }
        }
    }

    private var isLive: Bool {
        if case .media(let manifest, _) = session.content { return manifest.isLive }
        return false
    }
}
