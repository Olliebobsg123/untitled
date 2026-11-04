import SwiftUI

@main
struct LXRemoteApp: App {
    @StateObject private var client = RemoteClient()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(client)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true } // the screen stays on during a show
                .onChange(of: scenePhase) { phase in
                    if phase == .active { client.wake() }
                }
        }
    }
}

/// Connect first; once connected, the remote's tabs.
struct RootView: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        Group {
            if client.console == nil {
                ConnectView()
            } else {
                MainTabs()
            }
        }
        .animation(.default, value: client.console == nil)
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            CuesView()
                .tabItem { Label("Cues", systemImage: "list.number") }
            LightsView()
                .tabItem { Label("Lights", systemImage: "lightbulb") }
            ColourView()
                .tabItem { Label("Colour", systemImage: "paintbrush") }
            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .overlay(alignment: .top) { MessageBanner() }
    }
}
