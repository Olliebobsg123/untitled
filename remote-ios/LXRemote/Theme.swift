import SwiftUI

/// Light Spark's look: a dark stage, teal light, frosted glass.
enum LX {
    static let bg = Color(red: 0.024, green: 0.031, blue: 0.043)
    static let accent = Color(red: 0.098, green: 0.839, blue: 0.639)
    static let accent2 = Color(red: 0.243, green: 0.910, blue: 0.769)
    static let accentBright = Color(red: 0.42, green: 0.96, blue: 0.84)
    static let accentDeep = Color(red: 0.043, green: 0.620, blue: 0.463)
    static let ink = Color(red: 0.012, green: 0.078, blue: 0.059)
    static let glass = Color.white.opacity(0.055)
    static let glassHi = Color.white.opacity(0.09)
    static let line = Color.white.opacity(0.09)
    static let lineHi = Color.white.opacity(0.16)
    static let muted = Color(red: 0.54, green: 0.59, blue: 0.64)
    static let dim = Color(red: 0.37, green: 0.42, blue: 0.46)
    static let bad = Color(red: 1.0, green: 0.30, blue: 0.37)
    static let warn = Color(red: 1.0, green: 0.71, blue: 0.28)

    static var accentFill: LinearGradient {
        LinearGradient(colors: [accent2, accent], startPoint: .top, endPoint: .bottom)
    }

    /// A colour from hue (0-360), saturation and lightness (0-100), as the console uses.
    static func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
        let sat = max(0, min(1, s / 100)), light = max(0, min(1, l / 100))
        let v = light + sat * min(light, 1 - light)
        let sv = v == 0 ? 0 : 2 * (1 - light / v)
        let hue = h.truncatingRemainder(dividingBy: 360) / 360
        return Color(hue: hue < 0 ? hue + 1 : hue, saturation: sv, brightness: v)
    }

    /// How a hue/saturation looks as light: paler as it loses saturation.
    static func light(hue: Double, sat: Double) -> Color { hsl(hue, sat, 50 + (100 - sat) / 4) }
}

/// The dark room with a soft teal glow from above.
struct StageBackground: View {
    var body: some View {
        ZStack {
            LX.bg
            RadialGradient(colors: [LX.accent.opacity(0.20), .clear], center: .top, startRadius: 0, endRadius: 460)
            RadialGradient(colors: [Color(red: 0.47, green: 0.35, blue: 1.0).opacity(0.13), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 420)
            RadialGradient(colors: [Color(red: 0.24, green: 0.55, blue: 1.0).opacity(0.07), .clear], center: .leading, startRadius: 0, endRadius: 360)
        }
        .ignoresSafeArea()
    }
}

/// Frosted card: the app's basic surface.
struct GlassBackground: ViewModifier {
    var radius: CGFloat
    var highlighted: Bool
    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(LX.glass))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(highlighted ? LX.accent.opacity(0.55) : LX.line, lineWidth: 1))
    }
}

extension View {
    func glass(_ radius: CGFloat = 20, highlighted: Bool = false) -> some View {
        modifier(GlassBackground(radius: radius, highlighted: highlighted))
    }
}

/// Buttons sink a little under your finger.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .brightness(configuration.isPressed ? 0.06 : 0)
            .animation(.spring(response: 0.22, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Small spaced capitals above a section.
struct SectionTitle: View {
    let text: String
    var colour: Color = LX.muted
    init(_ text: String, colour: Color = LX.muted) { self.text = text; self.colour = colour }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .tracking(1.4)
            .foregroundColor(colour)
    }
}

/// A rounded label: LIVE, NEXT, BLIND…
struct Pill: View {
    let text: String
    var fill: Color
    var ink: Color
    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .heavy))
            .tracking(1)
            .foregroundColor(ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(fill))
    }
}

enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func thump() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}
