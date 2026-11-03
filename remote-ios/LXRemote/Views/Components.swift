import SwiftUI

/// A square-ish button in a grid: a group, palette, chase or fixture.
struct Tile: View {
    let title: String
    var subtitle: String? = nil
    var on = false
    var dot: Color? = nil
    var big = false
    let action: () -> Void

    var body: some View {
        Button(action: { Haptic.tap(); action() }) {
            VStack(alignment: big ? .center : .leading, spacing: 3) {
                if let dot {
                    Circle()
                        .fill(dot)
                        .frame(width: 14, height: 14)
                        .shadow(color: dot.opacity(0.8), radius: 5)
                        .padding(.bottom, 2)
                }
                Text(title)
                    .font(big ? .system(size: 22, weight: .heavy, design: .rounded) : .system(size: 14, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(big ? .center : .leading)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .lineLimit(1)
                        .opacity(0.65)
                }
            }
            .foregroundColor(on ? LX.ink : .white)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: big ? .center : .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(on ? AnyShapeStyle(LX.accentFill) : AnyShapeStyle(LX.glass))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(on ? Color.clear : LX.line, lineWidth: 1)
            )
            .shadow(color: on ? LX.accent.opacity(0.35) : .clear, radius: 12, y: 6)
        }
        .buttonStyle(PressStyle())
    }
}

/// A thick slider you drag anywhere on: a coloured track, a filled part up to
/// the value (unless the track is the colour, like hue), and a white thumb.
struct FillSlider: View {
    @Binding var value: Double
    var range: ClosedRange<Double>
    var track: AnyShapeStyle = AnyShapeStyle(Color.white.opacity(0.07))
    var fill: AnyShapeStyle? = AnyShapeStyle(LX.accentFill)
    var changed: (Double) -> Void
    var ended: (Double) -> Void

    @State private var dragging = false
    private let height: CGFloat = 34

    init(value: Binding<Double>,
         range: ClosedRange<Double>,
         track: AnyShapeStyle = AnyShapeStyle(Color.white.opacity(0.07)),
         fill: AnyShapeStyle? = AnyShapeStyle(LX.accentFill),
         changed: @escaping (Double) -> Void,
         ended: @escaping (Double) -> Void) {
        self._value = value
        self.range = range
        self.track = track
        self.fill = fill
        self.changed = changed
        self.ended = ended
    }

    var body: some View {
        GeometryReader { geo in
            let width = max(1, geo.size.width)
            let span = range.upperBound - range.lowerBound
            let fraction = CGFloat(span > 0 ? (value - range.lowerBound) / span : 0)
            let thumbX = (width - height) * max(0, min(1, fraction))
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                    .overlay(Capsule().strokeBorder(LX.line, lineWidth: 1))
                if let fill {
                    Capsule().fill(fill)
                        .frame(width: thumbX + height)
                }
                Circle()
                    .fill(Color.white)
                    .frame(width: height - 4, height: height - 4)
                    .shadow(color: .black.opacity(0.45), radius: 6, y: 3)
                    .scaleEffect(dragging ? 1.12 : 1)
                    .offset(x: thumbX + 2)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { gesture in
                        if !dragging { dragging = true; Haptic.select() }
                        let x = min(max(0, gesture.location.x - height / 2), width - height)
                        let v = range.lowerBound + Double(x / max(1, width - height)) * span
                        value = v
                        changed(v)
                    }
                    .onEnded { _ in
                        dragging = false
                        ended(value)
                    }
            )
            .animation(.spring(response: 0.25, dampingFraction: 0.75), value: dragging)
        }
        .frame(height: height)
    }
}

/// A card with a title and value above whatever's inside.
struct ControlCard<Content: View, Accessory: View>: View {
    let title: String
    let value: String
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(LX.muted)
                Spacer()
                accessory()
                Text(value)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(.white)
            }
            content()
        }
        .padding(16)
        .glass(22)
    }
}

extension ControlCard where Accessory == EmptyView {
    init(title: String, value: String, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, value: value, accessory: { EmptyView() }, content: content)
    }
}

/// A row of quick choices in a dark trough (Out 25 50 75 Full…).
struct QuickRow: View {
    let items: [(label: String, action: () -> Void)]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Button(action: { Haptic.tap(); item.action() }) {
                    Text(item.label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white.opacity(0.85))
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white.opacity(0.04)))
                }
                .buttonStyle(PressStyle())
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(Color.black.opacity(0.28)))
        .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).strokeBorder(LX.line, lineWidth: 1))
    }
}

/// Shown when a list from the console is empty.
struct EmptyNote: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundColor(LX.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .glass(16)
    }
}

/// Sends a slider's value at most every 50 ms while dragging, and always the last one.
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
