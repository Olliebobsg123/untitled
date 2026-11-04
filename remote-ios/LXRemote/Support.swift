import SwiftUI
import UIKit

enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func thump() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

/// Sends a slider's value at most every 50 ms while it moves, and always the last one.
final class Throttle {
    private var last = Date.distantPast
    func run(final: Bool = false, _ action: () -> Void) {
        let now = Date()
        if final || now.timeIntervalSince(last) > 0.05 {
            last = now
            action()
        }
    }
}

/// Colours as the console describes them: hue 0-360, saturation and lightness 0-100.
enum LightColour {
    static func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
        let sat = max(0, min(1, s / 100)), light = max(0, min(1, l / 100))
        let v = light + sat * min(light, 1 - light)
        let sv = v == 0 ? 0 : 2 * (1 - light / v)
        var hue = h.truncatingRemainder(dividingBy: 360) / 360
        if hue < 0 { hue += 1 }
        return Color(hue: hue, saturation: sv, brightness: v)
    }

    /// How a hue and saturation look as light (paler as saturation drops).
    static func shown(hue: Double, sat: Double) -> Color { hsl(hue, sat, 50 + (100 - sat) / 4) }
}

/// A warning or error from Light Spark ("There's no cue 9"), shown for a moment at the top.
struct MessageBanner: View {
    @EnvironmentObject var client: RemoteClient
    @State private var shown: LogLine?

    var body: some View {
        ZStack {
            if let line = shown {
                Label(line.msg, systemImage: line.type == "error" ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: shown?.id)
        .onChange(of: client.toast?.id) { _ in
            if let line = client.toast, line.type == "warn" || line.type == "error" { shown = line }
        }
        .task(id: shown?.id) {
            guard shown != nil else { return }
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            shown = nil
        }
        .allowsHitTesting(false)
    }
}

/// Connected (green) or reconnecting (orange), for the navigation bar.
struct ConnectionStatus: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(client.status == .live ? Color.green : Color.orange)
                .frame(width: 8, height: 8)
            Text(client.status == .live ? (client.console?.name ?? "Connected") : "Reconnecting…")
                .font(.footnote)
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
    }
}

/// Blackout on or off, for the navigation bar.
struct BlackoutButton: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        Button {
            Haptic.thump()
            client.send(["type": "blackout", "on": !client.state.blackout])
        } label: {
            Text(client.state.blackout ? "Blackout On" : "Blackout")
                .fontWeight(client.state.blackout ? .bold : .regular)
        }
        .tint(.red)
    }
}
