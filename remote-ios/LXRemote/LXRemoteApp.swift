import SwiftUI

@main
struct LXRemoteApp: App {
    @StateObject private var session = Session()

    var body: some Scene {
        WindowGroup {
            ZStack {
                if let console = session.active {
                    RemoteWebView(console: console, onDisconnect: { withAnimation(.easeInOut(duration: 0.35)) { session.disconnect() } })
                        .ignoresSafeArea(.container, edges: [])
                        .transition(.opacity)
                } else {
                    ConnectView(session: session)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.35), value: session.active)
            .preferredColorScheme(.dark)
            .tint(.lxAccent)
            .background(Color.lxBg.ignoresSafeArea())
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true } // keep the screen on during a show
        }
    }
}

/// A console the phone can talk to.
struct Console: Equatable, Codable {
    var host: String
    var port: Int
    var pin: String

    var url: URL? { URL(string: "http://\(host):\(port)/#pin=\(pin)") }
}

/// Remembers the last console so the app reconnects on launch.
final class Session: ObservableObject {
    @Published var active: Console?
    private let key = "lx.lastConsole"

    init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder().decode(Console.self, from: data) {
            active = saved
        }
    }

    func connect(_ console: Console) {
        if let data = try? JSONEncoder().encode(console) { UserDefaults.standard.set(data, forKey: key) }
        active = console
    }

    func disconnect() {
        UserDefaults.standard.removeObject(forKey: key)
        active = nil
    }
}
