import SwiftUI

/// Pan and tilt for the selected moving lights: drag on the pad (left/right
/// is pan, up/down is tilt), Fine for small careful moves, arrows to nudge,
/// Home to centre them.
struct MoveView: View {
    @EnvironmentObject var client: RemoteClient

    @State private var pan: Double = 0.5
    @State private var tilt: Double = 0.5
    @State private var dragging = false
    @State private var fine = false
    @State private var dragStart: (pan: Double, tilt: Double)?
    private let throttle = Throttle()

    private var position: Position? { client.state.position }

    var body: some View {
        NavigationStack {
            Form {
                if position == nil {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("No moving lights selected", systemImage: "move.3d")
                                .font(.headline)
                            Text(client.state.hasMovers
                                 ? "Pick lights that pan and tilt in the Lights tab, then move them here."
                                 : "This show has no lights that pan and tilt.")
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    Section {
                        pad
                            .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                        Toggle(isOn: $fine) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Fine")
                                Text("Small, careful moves: dragging moves the light a tenth as far")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    } header: {
                        HStack {
                            Text("Pan & Tilt")
                            Spacer()
                            Text("Pan \(Int((pan * 255).rounded())) · Tilt \(Int((tilt * 255).rounded()))")
                                .monospacedDigit()
                        }
                    } footer: {
                        Text("Moves the \(position?.count ?? 0) selected moving light\(position?.count == 1 ? "" : "s").")
                    }

                    Section("Nudge") {
                        HStack(spacing: 10) {
                            nudgeButton("arrow.left", dpan: -1, dtilt: 0)
                            nudgeButton("arrow.down", dpan: 0, dtilt: -1)
                            nudgeButton("arrow.up", dpan: 0, dtilt: 1)
                            nudgeButton("arrow.right", dpan: 1, dtilt: 0)
                        }
                        Button {
                            Haptic.thump()
                            client.send(["type": "home"])
                        } label: {
                            Label("Home (centre)", systemImage: "scope")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
            .navigationTitle("Move")
            .onAppear(perform: sync)
            .onChange(of: client.state.position) { _ in sync() }
        }
    }

    // The pad: a square with a centre cross and the light's dot.
    private var pad: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(.secondarySystemBackground))
                Path { p in
                    for i in 1..<4 {
                        let x = size.width * CGFloat(i) / 4, y = size.height * CGFloat(i) / 4
                        p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height))
                        p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y))
                    }
                }
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                Path { p in
                    p.move(to: CGPoint(x: size.width / 2, y: 0)); p.addLine(to: CGPoint(x: size.width / 2, y: size.height))
                    p.move(to: CGPoint(x: 0, y: size.height / 2)); p.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                }
                .stroke(Color.primary.opacity(0.2), lineWidth: 1)
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: dragging ? 34 : 28, height: dragging ? 34 : 28)
                    .shadow(color: Color.accentColor.opacity(0.6), radius: dragging ? 10 : 4)
                    .position(x: CGFloat(pan) * size.width, y: CGFloat(1 - tilt) * size.height)
                    .animation(.easeOut(duration: 0.12), value: dragging)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        if !dragging { dragging = true; dragStart = (pan, tilt); Haptic.tap() }
                        if fine, let start = dragStart {
                            // Fine: the finger's movement, a tenth as far.
                            pan = clamp(start.pan + Double(g.translation.width / size.width) * 0.1)
                            tilt = clamp(start.tilt - Double(g.translation.height / size.height) * 0.1)
                        } else {
                            pan = clamp(Double(g.location.x / size.width))
                            tilt = clamp(1 - Double(g.location.y / size.height))
                        }
                        throttle.run { send() }
                    }
                    .onEnded { _ in
                        throttle.run(final: true) { send() }
                        dragging = false
                        dragStart = nil
                    }
            )
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func nudgeButton(_ icon: String, dpan: Double, dtilt: Double) -> some View {
        // One step is 1 of 255 (Fine: a quarter of that).
        let step = fine ? 0.25 / 255 : 1.0 / 255
        return Button {
            Haptic.tap()
            client.send(["type": "nudge", "dpan": dpan * step, "dtilt": dtilt * step])
        } label: {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
    }

    private func send() { client.send(["type": "position", "pan": pan, "tilt": tilt]) }
    private func clamp(_ v: Double) -> Double { min(1, max(0, v)) }

    // While a finger is on the pad it's yours; otherwise show where the lights are.
    private func sync() {
        guard !dragging, let p = position else { return }
        pan = p.pan
        tilt = p.tilt
    }
}
