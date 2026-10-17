import SwiftUI
import WebKit

/// Hosts the console's phone UI (served by the console at http://host:port/).
struct RemoteWebView: UIViewRepresentable {
    let console: Console
    let onDisconnect: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDisconnect: onDisconnect) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "lx")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.04, green: 0.06, blue: 0.08, alpha: 1)
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = context.coordinator
        context.coordinator.web = web
        if let url = console.url { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let onDisconnect: () -> Void
        weak var web: WKWebView?
        private var retries = 0

        init(onDisconnect: @escaping () -> Void) { self.onDisconnect = onDisconnect }

        // The web UI posts "disconnect" from its ⏏ button.
        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            if (message.body as? String) == "disconnect" { onDisconnect() }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            // Console not reachable yet (asleep, wrong Wi-Fi, app closed) — keep retrying.
            retries += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + min(Double(retries), 5)) { [weak webView] in
                if let url = webView?.url ?? (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL {
                    webView?.load(URLRequest(url: url))
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { retries = 0 }
    }
}
