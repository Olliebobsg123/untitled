import SwiftUI

enum RemoteTab: String, CaseIterable {
    case play, look, select, fx, command

    var title: String {
        switch self {
        case .play: return "Play"
        case .look: return "Look"
        case .select: return "Select"
        case .fx: return "FX"
        case .command: return "Command"
        }
    }

    var icon: String {
        switch self {
        case .play: return "play.fill"
        case .look: return "sun.max.fill"
        case .select: return "square.grid.2x2.fill"
        case .fx: return "sparkles"
        case .command: return "terminal.fill"
        }
    }
}

/// The remote: a header, the chosen tab, and the floating tab bar.
struct MainView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var tab: RemoteTab = .play

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar()
            ZStack {
                switch tab {
                case .play: PlayView()
                case .look: LookView()
                case .select: SelectView()
                case .fx: EffectsView()
                case .command: CommandView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .safeAreaInset(edge: .bottom) { TabBar(tab: $tab) }
        .overlay(alignment: .top) { ConnectionBanner() }
        .overlay(alignment: .bottom) { ToastView().padding(.bottom, 92) }
    }
}

struct HeaderBar: View {
    @EnvironmentObject var client: RemoteClient
    @State private var confirmPanic = false

    var body: some View {
        HStack(spacing: 12) {
            StatusDot(live: client.status == .live)
            VStack(alignment: .leading, spacing: 1) {
                Text("LIGHT SPARK")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1.6)
                    .foregroundColor(LX.accent)
                Text(client.console?.name ?? "Remote")
                    .font(.system(size: 19, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if client.state.isBlind {
                Pill(text: "BLIND", fill: LX.warn.opacity(0.18), ink: LX.warn)
            }
            BlackoutButton(on: client.state.blackout) {
                Haptic.thump()
                client.send(["type": "blackout", "on": !client.state.blackout])
            }
            Menu {
                Button { Haptic.thump(); client.command("kill") } label: {
                    Label("Kill cue list", systemImage: "stop.circle")
                }
                Button(role: .destructive) { confirmPanic = true } label: {
                    Label("Kill everything", systemImage: "exclamationmark.octagon")
                }
                Divider()
                Button { client.disconnect() } label: {
                    Label("Disconnect", systemImage: "eject")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(LX.muted)
                    .frame(width: 38, height: 38)
                    .glass(19)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .confirmationDialog("Kill everything?", isPresented: $confirmPanic, titleVisibility: .visible) {
            Button("Kill everything", role: .destructive) {
                Haptic.thump()
                client.command("kill all")
            }
        } message: {
            Text("Stops cues, chases, effects, timecode, fog and haze, and clears the programmer.")
        }
    }
}

struct StatusDot: View {
    let live: Bool
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .stroke((live ? LX.accent : LX.bad).opacity(0.5), lineWidth: 2)
                .frame(width: 20, height: 20)
                .scaleEffect(pulse ? 1.3 : 0.6)
                .opacity(pulse ? 0 : 0.9)
            Circle()
                .fill(live ? LX.accent : LX.bad)
                .frame(width: 10, height: 10)
                .shadow(color: live ? LX.accent : LX.bad, radius: 6)
        }
        .frame(width: 20, height: 20)
        .onAppear {
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}

struct BlackoutButton: View {
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "power").font(.system(size: 13, weight: .bold))
                Text("Blackout").font(.system(size: 13, weight: .bold))
            }
            .foregroundColor(on ? .white : Color(red: 1, green: 0.55, blue: 0.6))
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(Capsule().fill(on ? LX.bad : LX.bad.opacity(0.1)))
            .overlay(Capsule().strokeBorder(on ? LX.bad : LX.bad.opacity(0.3), lineWidth: 1))
            .shadow(color: on ? LX.bad.opacity(0.6) : .clear, radius: 12)
        }
        .buttonStyle(PressStyle())
        .animation(.easeInOut(duration: 0.2), value: on)
    }
}

struct TabBar: View {
    @Binding var tab: RemoteTab
    @Namespace private var selection

    var body: some View {
        HStack(spacing: 2) {
            ForEach(RemoteTab.allCases, id: \.self) { item in
                Button {
                    guard tab != item else { return }
                    Haptic.select()
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.82)) { tab = item }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.icon).font(.system(size: 18, weight: .semibold))
                        Text(item.title).font(.system(size: 10.5, weight: .semibold))
                    }
                    .foregroundColor(tab == item ? LX.accent : LX.dim)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        if tab == item {
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .fill(LX.accent.opacity(0.13))
                                .matchedGeometryEffect(id: "tab", in: selection)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(LX.lineHi, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 24, y: 12)
        .frame(maxWidth: 540)
        .padding(.horizontal, 14)
        .padding(.bottom, 4)
    }
}

/// "Reconnecting…" while the link to the console is down.
struct ConnectionBanner: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        ZStack {
            if client.status == .connecting || client.status == .reconnecting {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(.white)
                    Text(client.status == .connecting ? "Connecting…" : "Reconnecting…")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(LX.lineHi, lineWidth: 1))
                .padding(.top, 58)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: client.status)
    }
}

/// What the console just said ("Cue 9 not found"…), for a moment.
struct ToastView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var shown: LogLine?

    var body: some View {
        ZStack {
            if let line = shown {
                HStack(spacing: 8) {
                    Image(systemName: icon(line.type)).foregroundColor(colour(line.type))
                    Text(line.msg).font(.system(size: 14, weight: .medium)).foregroundColor(.white).lineLimit(2)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(LX.lineHi, lineWidth: 1))
                .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
                .padding(.horizontal, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: shown?.id)
        .onChange(of: client.toast?.id) { _ in shown = client.toast }
        .task(id: shown?.id) {
            guard shown != nil else { return }
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            shown = nil
        }
        .allowsHitTesting(false)
    }

    private func icon(_ type: String) -> String {
        switch type {
        case "warn": return "exclamationmark.triangle.fill"
        case "error": return "xmark.octagon.fill"
        case "ok": return "checkmark.circle.fill"
        default: return "info.circle.fill"
        }
    }

    private func colour(_ type: String) -> Color {
        switch type {
        case "warn": return LX.warn
        case "error": return LX.bad
        case "ok": return LX.accent
        default: return LX.muted
        }
    }
}
