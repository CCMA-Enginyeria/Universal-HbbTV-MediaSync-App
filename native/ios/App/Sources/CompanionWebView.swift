import MediaSyncCore
import SwiftUI
import WebKit

/// Full-screen companion page or DASH web player; a new URL recreates the web view and its bridge.
struct CompanionScreen: View {
    @EnvironmentObject private var session: SessionModel
    let url: String?
    let onClose: () -> Void
    @State private var failed = false
    @State private var reloadToken = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Theme.background.ignoresSafeArea()
            if let url = url, CompanionProtocol.origin(url) != nil, !failed {
                CompanionWebView(url: url, session: session, failed: $failed).id("\(url)#\(reloadToken)").ignoresSafeArea(edges: .bottom)
            } else {
                VStack(spacing: Theme.spacing("md")) {
                    Text(L10n.t(failed ? "native.web.loadError" : "discovery.webNoContent")).foregroundColor(Theme.onSurface)
                    if failed {
                        Button(L10n.t("native.terminal.retry")) {
                            failed = false
                            reloadToken += 1
                        }.buttonStyle(.bordered)
                    }
                    Button(L10n.t("discovery.webClose"), action: onClose).buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button(action: onClose) { Image(systemName: "xmark.circle.fill").font(.title).foregroundColor(Theme.onSurface).padding() }
                .accessibilityLabel(L10n.t("discovery.webClose"))
        }
    }
}

/// WKScriptMessageHandler retains its handler; this proxy breaks the cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

struct CompanionWebView: UIViewRepresentable {
    static let handlerName = "mediasync"
    let url: String
    let session: SessionModel
    @Binding var failed: Bool

    func makeCoordinator() -> Coordinator { Coordinator(url: url, session: session, failed: $failed) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let content = configuration.userContentController
        content.add(WeakHandler(context.coordinator), name: Self.handlerName)
        let bridge = "window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.\(Self.handlerName)"
        content.addUserScript(WKUserScript(source: CompanionProtocol.reactNativeShim(bridge: bridge), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        context.coordinator.webView = webView
        session.attachCompanion(context.coordinator)
        if let target = URL(string: url) { webView.load(URLRequest(url: target)) }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.session.detachCompanion(coordinator)
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: handlerName)
        coordinator.webView = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, CompanionSink {
        let session: SessionModel
        weak var webView: WKWebView?
        private let gate: CompanionBridgeGate
        private var ready = false
        private var failed: Binding<Bool>

        init(url: String, session: SessionModel, failed: Binding<Bool>) {
            gate = CompanionBridgeGate(pageUrl: url)
            self.session = session
            self.failed = failed
        }

        func deliver(_ envelope: String) {
            guard ready else { return }
            webView?.evaluateJavaScript(CompanionProtocol.webViewInjection(envelope), completionHandler: nil)
        }

        private func origin(_ security: WKSecurityOrigin) -> String {
            "\(security.protocol)://\(security.host)" + (security.port == 0 ? "" : ":\(security.port)")
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let text = message.body as? String,
                  let inbound = gate.accept(sourceOrigin: origin(message.frameInfo.securityOrigin), generation: gate.pageGeneration, text: text)
            else { return }
            session.onCompanionMessage(inbound)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            gate.onNavigation()
            ready = false
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard CompanionProtocol.origin(webView.url?.absoluteString) == gate.allowedOrigin else { return }
            ready = true
            session.seedCompanion(self)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { failed.wrappedValue = true }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else { return decisionHandler(.cancel) }
            if action.targetFrame?.isMainFrame != true {
                let scheme = target.scheme?.lowercased()
                return decisionHandler(scheme == "http" || scheme == "https" || scheme == "about" ? .allow : .cancel)
            }
            if CompanionProtocol.origin(target.absoluteString) == gate.allowedOrigin { return decisionHandler(.allow) }
            if let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https" { UIApplication.shared.open(target) }
            decisionHandler(.cancel)
        }

        /// Camera only by brand opt-in, for the page's own origin in the main frame; the OS still asks the user.
        @available(iOS 15.0, *)
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let allowed = BrandConfig.cameraEnabled && type == .camera && frame.isMainFrame && self.origin(origin) == gate.allowedOrigin
            decisionHandler(allowed ? .prompt : .deny)
        }
    }
}
