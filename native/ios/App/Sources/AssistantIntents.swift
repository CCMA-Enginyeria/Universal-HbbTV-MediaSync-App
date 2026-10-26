import AppIntents
import MediaSyncCore

/*
 * Siri, Shortcuts and Spotlight actions (App Intents) over `AssistantCommands`. Titles and
 * descriptions are keys of the generated Localizable.strings; the App Shortcut phrases are
 * looked up in the generated AppShortcuts.strings by their English literal, which
 * export-brand.cjs checks against native/i18n/native-strings.json (`native.assistant.phrases`).
 * iOS 17+: the deployment target stays at iOS 15, where the assistant is simply not offered.
 */

@available(iOS 17.0, *)
private func dialog(_ text: String) -> IntentDialog { IntentDialog("\(text)") }

@available(iOS 17.0, *)
extension AssistantCommands.Failure: CustomLocalizedStringResourceConvertible {
    var localizedStringResource: LocalizedStringResource { "\(message)" }
}

/// A TV on the local network, as Siri and Shortcuts see it.
@available(iOS 17.0, *)
struct TvEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "native.assistant.tv.type")
    static var defaultQuery = TvQuery()

    let id: String
    let name: String
    let model: String?

    init(_ tv: AssistantCommands.Tv) {
        id = tv.id
        name = tv.name
        model = tv.model
    }

    var displayRepresentation: DisplayRepresentation {
        if let model = model { return DisplayRepresentation(title: "\(name)", subtitle: "\(model)") }
        return DisplayRepresentation(title: "\(name)")
    }
}

/// Resolves TVs through discovery; only TVs that offer synchronization are suggested.
@available(iOS 17.0, *)
struct TvQuery: EntityStringQuery {
    func entities(for identifiers: [TvEntity.ID]) async throws -> [TvEntity] {
        var found: [TvEntity] = []
        for id in identifiers {
            if let tv = await AssistantCommands.shared.tv(id) { found.append(TvEntity(tv)) }
        }
        return found
    }

    func entities(matching string: String) async throws -> [TvEntity] {
        try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) }
    }

    func suggestedEntities() async throws -> [TvEntity] {
        try await AssistantCommands.shared.tvs().filter(\.syncCapable).map(TvEntity.init)
    }
}

/// An audio track of the programme on the open TV, as Siri lists it when there is a choice.
@available(iOS 17.0, *)
struct AudioTrackEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "native.assistant.audio.type")
    static var defaultQuery = AudioTrackQuery()

    let id: String
    let name: String

    init(_ track: MediaTrack) {
        id = track.id
        name = Labels.title(track)
    }

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

/// Tracks of the content already open; Siri only asks for one once the TV is connected.
@available(iOS 17.0, *)
struct AudioTrackQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [AudioTrackEntity.ID]) async throws -> [AudioTrackEntity] {
        AssistantCommands.shared.playableAudio.filter { identifiers.contains($0.id) }.map(AudioTrackEntity.init)
    }

    @MainActor
    func suggestedEntities() async throws -> [AudioTrackEntity] {
        AssistantCommands.shared.playableAudio.map(AudioTrackEntity.init)
    }
}

/// A video track or a companion page of the programme, as Siri lists them when there is a choice.
@available(iOS 17.0, *)
struct VisualEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "native.assistant.visual.type")
    static var defaultQuery = VisualQuery()

    let id: String
    let name: String

    init(_ visual: AssistantCommands.Visual) {
        id = visual.id
        name = visual.title
    }

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

/// What the content already open offers; Siri only asks for one once the TV is connected.
@available(iOS 17.0, *)
struct VisualQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [VisualEntity.ID]) async throws -> [VisualEntity] {
        AssistantCommands.shared.visuals.filter { identifiers.contains($0.id) }.map(VisualEntity.init)
    }

    @MainActor
    func suggestedEntities() async throws -> [VisualEntity] {
        AssistantCommands.shared.visuals.map(VisualEntity.init)
    }
}

@available(iOS 17.0, *)
enum SyncModeOption: String, AppEnum {
    case native, compat

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "discovery.modeTitle")
    static var caseDisplayRepresentations: [SyncModeOption: DisplayRepresentation] = [
        .native: "discovery.modeNative",
        .compat: "discovery.modeCompat",
    ]

    var mode: SyncMode { self == .native ? .native : .compat }
}

@available(iOS 17.0, *)
struct FindTvsIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.listTvs.title"
    static var description = IntentDescription("native.assistant.listTvs.description")

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[TvEntity]> & ProvidesDialog {
        let commands = AssistantCommands.shared
        let tvs = try await commands.tvs(refresh: true)
        return .result(value: tvs.filter(\.syncCapable).map(TvEntity.init), dialog: dialog(commands.tvsSummary(tvs)))
    }
}

@available(iOS 17.0, *)
struct TvStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.status.title"
    static var description = IntentDescription("native.assistant.status.description")

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let text = AssistantCommands.shared.status()
        return .result(value: text, dialog: dialog(text))
    }
}

/// Opens the app: the TV screen shows the session, and the local network prompt needs the foreground.
@available(iOS 17.0, *)
struct ConnectTvIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.connect.title"
    static var description = IntentDescription("native.assistant.connect.description")
    static var openAppWhenRun = true

    @Parameter(title: "native.assistant.tv.parameter")
    var tv: TvEntity

    @Parameter(title: "native.assistant.mode.parameter")
    var mode: SyncModeOption?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = try await AssistantCommands.shared.connect(tv.id, mode: mode?.mode)
        return .result(dialog: dialog(text))
    }
}

/**
 * Opens the app, because DASH audio plays through the brand web player, which lives in the
 * player dock. Without a TV it uses the open one or the only one that offers synchronization;
 * without an audio track it lists them and lets the user pick one when there are several.
 */
@available(iOS 17.0, *)
struct ListenToTvIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.listen.title"
    static var description = IntentDescription("native.assistant.listen.description")
    static var openAppWhenRun = true

    @Parameter(title: "native.assistant.tv.parameter")
    var tv: TvEntity?

    @Parameter(title: "native.assistant.audio.parameter")
    var audio: AudioTrackEntity?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let commands = AssistantCommands.shared
        let id = try await listeningTvId(tv, parameter: $tv)
        var trackId = audio?.id
        if trackId == nil {
            let tracks = try await commands.audioTracks(id)
            if tracks.count > 1 {
                let chosen = try await $audio.requestDisambiguation(among: tracks.map(AudioTrackEntity.init),
                                                                    dialog: dialog(commands.audioChoice(tracks)))
                trackId = chosen.id
            }
        }
        return .result(dialog: dialog(try await commands.listen(id, trackId: trackId)))
    }
}

/// Like `ListenToTvIntent`, but plays the programme's audio description.
@available(iOS 17.0, *)
struct AudioDescriptionIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.audioDescription.title"
    static var description = IntentDescription("native.assistant.audioDescription.description")
    static var openAppWhenRun = true

    @Parameter(title: "native.assistant.tv.parameter")
    var tv: TvEntity?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let id = try await listeningTvId(tv, parameter: $tv)
        return .result(dialog: dialog(try await AssistantCommands.shared.listen(id, described: true)))
    }
}

/// The given TV, else the open one, else the only one that offers synchronization; asks otherwise.
@available(iOS 17.0, *)
@MainActor
private func listeningTvId(_ tv: TvEntity?, parameter: IntentParameter<TvEntity?>) async throws -> String {
    if let tv = tv { return tv.id }
    let commands = AssistantCommands.shared
    if let current = commands.currentTvId { return current }
    let capable = try await commands.compatibleTvs()
    guard capable.count == 1 else { throw parameter.needsValueError(dialog(L10n.t("native.assistant.tvs.choose"))) }
    return capable[0].id
}

/// Opens the app, which shows the same list on the TV screen.
@available(iOS 17.0, *)
struct AvailableContentIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.content.title"
    static var description = IntentDescription("native.assistant.content.description")
    static var openAppWhenRun = true

    @Parameter(title: "native.assistant.tv.parameter")
    var tv: TvEntity?

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let id = try await listeningTvId(tv, parameter: $tv)
        let text = try await AssistantCommands.shared.contentSummary(id)
        return .result(value: text, dialog: dialog(text))
    }
}

/// Shows a video or a companion page; lists them and lets the user pick one when there are several.
@available(iOS 17.0, *)
struct WatchContentIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.watch.title"
    static var description = IntentDescription("native.assistant.watch.description")
    static var openAppWhenRun = true

    @Parameter(title: "native.assistant.tv.parameter")
    var tv: TvEntity?

    @Parameter(title: "native.assistant.visual.parameter")
    var content: VisualEntity?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let commands = AssistantCommands.shared
        let id = try await listeningTvId(tv, parameter: $tv)
        var visualId = content?.id
        if visualId == nil {
            let items = try await commands.visuals(id)
            if items.count > 1 {
                let chosen = try await $content.requestDisambiguation(among: items.map(VisualEntity.init),
                                                                      dialog: dialog(commands.visualChoice(items)))
                visualId = chosen.id
            }
        }
        return .result(dialog: dialog(try await commands.watch(id, visualId: visualId)))
    }
}

@available(iOS 17.0, *)
struct StopAudioIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.stopAudio.title"
    static var description = IntentDescription("native.assistant.stopAudio.description")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: dialog(AssistantCommands.shared.stopAudio()))
    }
}

@available(iOS 17.0, *)
struct StopSyncIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.stop.title"
    static var description = IntentDescription("native.assistant.stop.description")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: dialog(AssistantCommands.shared.stop()))
    }
}

/**
 * Phrases must name the app and match `native.assistant.phrases` in English (checked by export-brand.cjs).
 * Only commands that do what the user wants get a phrase; finding TVs, the status and connecting are
 * intermediate steps the others take on their own, and stay as Shortcuts actions. Each command has a
 * short form without articles, as people tend to say it, and none says "TV": Siri takes those for a
 * Home (HomeKit) TV accessory.
 */
@available(iOS 17.0, *)
struct MediaSyncShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ListenToTvIntent(), phrases: [
            "Turn on audio with \(.applicationName)",
            "Turn on \(.applicationName) audio",
            "Listen to \(.applicationName)",
        ], shortTitle: "native.assistant.listen.title", systemImageName: "headphones")
        AppShortcut(intent: AvailableContentIntent(), phrases: [
            "What content is available on \(.applicationName)",
            "What content is available \(.applicationName)",
        ], shortTitle: "native.assistant.content.title", systemImageName: "list.bullet")
        AppShortcut(intent: WatchContentIntent(), phrases: [
            "Watch content with \(.applicationName)",
            "Watch content \(.applicationName)",
        ], shortTitle: "native.assistant.watch.title", systemImageName: "play.rectangle")
        AppShortcut(intent: AudioDescriptionIntent(), phrases: ["Turn on audio description with \(.applicationName)"],
                    shortTitle: "native.assistant.audioDescription.title", systemImageName: "ear")
        AppShortcut(intent: StopAudioIntent(), phrases: [
            "Stop audio on \(.applicationName)",
            "Stop \(.applicationName) audio",
        ], shortTitle: "native.assistant.stopAudio.title", systemImageName: "speaker.slash")
        AppShortcut(intent: StopSyncIntent(), phrases: [
            "Stop content on \(.applicationName)",
            "Stop \(.applicationName) content",
            "Stop \(.applicationName)",
        ], shortTitle: "native.assistant.stop.title", systemImageName: "stop.circle")
    }
}
