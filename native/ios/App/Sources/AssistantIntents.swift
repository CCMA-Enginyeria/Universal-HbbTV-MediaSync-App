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
 * player dock. Without a TV it uses the open one or the only one that offers synchronization.
 */
@available(iOS 17.0, *)
struct ListenToTvIntent: AppIntent {
    static var title: LocalizedStringResource = "native.assistant.listen.title"
    static var description = IntentDescription("native.assistant.listen.description")
    static var openAppWhenRun = true

    @Parameter(title: "native.assistant.tv.parameter")
    var tv: TvEntity?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let commands = AssistantCommands.shared
        let id: String
        if let tv = tv {
            id = tv.id
        } else if let current = commands.currentTvId {
            id = current
        } else {
            let capable = try await commands.compatibleTvs()
            guard capable.count == 1 else { throw $tv.needsValueError(dialog(L10n.t("native.assistant.tvs.choose"))) }
            id = capable[0].id
        }
        let text = try await commands.listen(id)
        return .result(dialog: dialog(text))
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

/// Phrases must name the app and match `native.assistant.phrases` in English (checked by export-brand.cjs).
@available(iOS 17.0, *)
struct MediaSyncShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ListenToTvIntent(), phrases: ["Listen to the TV with \(.applicationName)"],
                    shortTitle: "native.assistant.listen.title", systemImageName: "headphones")
        AppShortcut(intent: TvStatusIntent(), phrases: ["\(.applicationName) status"],
                    shortTitle: "native.assistant.status.title", systemImageName: "tv")
        AppShortcut(intent: FindTvsIntent(), phrases: ["Find TVs with \(.applicationName)"],
                    shortTitle: "native.assistant.listTvs.title", systemImageName: "magnifyingglass")
        AppShortcut(intent: ConnectTvIntent(), phrases: ["Connect \(.applicationName) to a TV"],
                    shortTitle: "native.assistant.connect.title", systemImageName: "link")
        AppShortcut(intent: StopSyncIntent(), phrases: ["Stop \(.applicationName)"],
                    shortTitle: "native.assistant.stop.title", systemImageName: "stop.circle")
    }
}
