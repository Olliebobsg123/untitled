import SwiftUI

@main
struct LXRemoteApp: App {
    @StateObject private var client = RemoteClient()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(client)
                .preferredColorScheme(.dark)
                .tint(LX.accent)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true } // the screen stays on during a show
                .onChange(of: scenePhase) { phase in
                    if phase == .active { client.wake() }
                }
        }
    }
}

/// Pairing until a console is chosen, then the remote.
struct RootView: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        ZStack {
            StageBackground()
            if client.console == nil {
                PairView()
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            } else {
                MainView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: client.console == nil)
    }
}
