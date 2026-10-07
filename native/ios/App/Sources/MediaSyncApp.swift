import SwiftUI
import UIKit

/// Process-scoped owners; views only observe them, so recreation never duplicates workers.
final class AppModel: ObservableObject {
    let diagnostics = Diagnostics()
    lazy var transport = AppleTransport(diagnostics: diagnostics)
    lazy var discovery = DiscoveryModel(diagnostics: diagnostics)
    lazy var session = SessionModel(transport: transport, loader: ContentLoader(), diagnostics: diagnostics)
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Phones stay portrait except fullscreen video and web pages; tablets rotate freely.
    static var allowsLandscape = false

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        if UIDevice.current.userInterfaceIdiom == .pad || AppDelegate.allowsLandscape { return .allButUpsideDown }
        return .portrait
    }
}

@main
struct MediaSyncApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(model.discovery)
                .environmentObject(model.session)
                .preferredColorScheme(.dark)
        }
    }
}

/// Full-screen surfaces; only one is presented at a time.
enum Overlay: String, Identifiable, Equatable {
    case web
    case video

    var id: String { rawValue }
}

struct RootView: View {
    @EnvironmentObject private var session: SessionModel
    @State private var showTerminal = false
    @State private var showHelp = false
    @State private var overlay: Overlay?

    /// The player docks below the TV list and the TV screen; help and full-screen surfaces cover it.
    var body: some View {
        VStack(spacing: 0) {
            navigation
            if session.hasDock { PlayerDock(onFullscreen: { overlay = .video }) }
        }
        .background(Theme.background.ignoresSafeArea())
        .sheet(isPresented: $showHelp) { HelpView() }
        .fullScreenCover(item: $overlay) { item in
            switch item {
            case .web:
                CompanionScreen(url: session.openWebPage?.url) { overlay = nil }
            case .video:
                FullscreenVideo { overlay = nil }
            }
        }
        .onChange(of: session.video) { video in
            if video == nil && overlay == .video { overlay = nil }
        }
        .onChange(of: session.terminal) { terminal in
            if terminal == nil {
                showTerminal = false
                overlay = nil
            }
        }
        .onChange(of: overlay) { value in
            AppDelegate.allowsLandscape = value != nil
            if value == nil { requestPortrait() }
        }
    }

    private var navigation: some View {
        NavigationView {
            ZStack {
                Theme.background.ignoresSafeArea()
                DiscoveryView(onOpen: { terminal in
                    session.select(terminal)
                    showTerminal = true
                }, onHelp: { showHelp = true })
                NavigationLink(destination: TerminalView(onHelp: { showHelp = true }, onOpenWeb: { url in
                    session.openWeb(url)
                    overlay = .web
                }, onBack: {
                    session.leaveDetail()
                    showTerminal = false
                }), isActive: $showTerminal) { EmptyView() }
            }
            .navigationBarHidden(true)
        }
        .navigationViewStyle(.stack)
    }

    private func requestPortrait() {
        guard UIDevice.current.userInterfaceIdiom == .phone,
              let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        if #available(iOS 16.0, *) {
            scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
        } else {
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}
