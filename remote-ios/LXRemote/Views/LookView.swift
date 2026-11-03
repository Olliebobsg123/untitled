import SwiftUI

/// Level, colour, strobe and the grand master for the selected lights.
struct LookView: View {
    @EnvironmentObject var client: RemoteClient

    @State private var intensity: Double = 100
    @State private var hue: Double = 0
    @State private var sat: Double = 0
    @State private var strobe: Double = 0
    @State private var master: Double = 100
    @State private var editing: Set<String> = []

    private let levelThrottle = Throttle()
    private let colourThrottle = Throttle()
    private let strobeThrottle = Throttle()
    private let masterThrottle = Throttle()

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 6)

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                selectionNote

                ControlCard(title: "Intensity", value: "\(Int(intensity.rounded()))%") {
                    FillSlider(value: $intensity, range: 0...100, changed: { v in
                        editing.insert("int")
                        levelThrottle.run { client.send(["type": "intensity", "value": v.rounded()]) }
                    }, ended: { v in
                        levelThrottle.run(final: true) { client.send(["type": "intensity", "value": v.rounded()]) }
                        release("int")
                    })
                    QuickRow(items: [0.0, 25, 50, 75, 100].map { level in
                        (label: level == 0 ? "Out" : level == 100 ? "Full" : "\(Int(level))", action: {
                            intensity = level
                            client.send(["type": "intensity", "value": level])
                        })
                    })
                }

                ControlCard(title: "Colour", value: "", accessory: {
                    Circle()
                        .fill(LX.light(hue: hue, sat: sat))
                        .frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.3), lineWidth: 2))
                        .shadow(color: LX.light(hue: hue, sat: sat).opacity(0.8), radius: 10)
                }) {
                    if !client.state.swatches.isEmpty {
                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(Array(client.state.swatches.enumerated()), id: \.offset) { _, swatch in
                                Button {
                                    Haptic.tap()
                                    hue = swatch.hue
                                    sat = swatch.sat
                                    client.send(["type": "colourName", "name": swatch.name])
                                } label: {
                                    Circle()
                                        .fill(LX.hsl(swatch.hue, swatch.sat, swatch.light))
                                        .aspectRatio(1, contentMode: .fit)
                                        .overlay(Circle().strokeBorder(Color.white.opacity(0.16), lineWidth: 2))
                                        .shadow(color: .black.opacity(0.35), radius: 5, y: 3)
                                }
                                .buttonStyle(PressStyle())
                                .accessibilityLabel(swatch.name)
                            }
                        }
                        .padding(.bottom, 4)
                    }
                    labelled("Hue", "\(Int(hue.rounded()))°")
                    FillSlider(value: $hue, range: 0...360,
                               track: AnyShapeStyle(LinearGradient(colors: stride(from: 0.0, through: 360, by: 60).map { LX.hsl($0, 100, 50) }, startPoint: .leading, endPoint: .trailing)),
                               fill: nil,
                               changed: { _ in editing.insert("colour"); colourThrottle.run { sendColour() } },
                               ended: { _ in colourThrottle.run(final: true) { sendColour() }; release("colour") })
                    labelled("Saturation", "\(Int(sat.rounded()))%")
                    FillSlider(value: $sat, range: 0...100,
                               track: AnyShapeStyle(LinearGradient(colors: [.white, LX.hsl(hue, 100, 50)], startPoint: .leading, endPoint: .trailing)),
                               fill: nil,
                               changed: { _ in editing.insert("colour"); colourThrottle.run { sendColour() } },
                               ended: { _ in colourThrottle.run(final: true) { sendColour() }; release("colour") })
                }

                ControlCard(title: "Strobe", value: strobe < 1 ? "Off" : "\(Int(strobe.rounded()))") {
                    FillSlider(value: $strobe, range: 0...255,
                               fill: AnyShapeStyle(LinearGradient(colors: [Color(red: 1, green: 0.62, blue: 0.26), Color(red: 1, green: 0.82, blue: 0.4)], startPoint: .leading, endPoint: .trailing)),
                               changed: { v in editing.insert("strobe"); strobeThrottle.run { client.send(["type": "strobe", "value": v.rounded()]) } },
                               ended: { v in strobeThrottle.run(final: true) { client.send(["type": "strobe", "value": v.rounded()]) }; release("strobe") })
                    QuickRow(items: [
                        (label: "Off", action: { strobe = 0; client.send(["type": "strobe", "value": 0]) }),
                        (label: "Slow", action: { strobe = 60; client.send(["type": "strobe", "value": 60]) }),
                        (label: "Fast", action: { strobe = 200; client.send(["type": "strobe", "value": 200]) })
                    ])
                }

                ControlCard(title: "Grand master", value: "\(Int(master.rounded()))%") {
                    FillSlider(value: $master, range: 0...100,
                               fill: AnyShapeStyle(LinearGradient(colors: [Color.white.opacity(0.55), Color.white.opacity(0.9)], startPoint: .leading, endPoint: .trailing)),
                               changed: { v in editing.insert("master"); masterThrottle.run { client.send(["type": "master", "value": v.rounded()]) } },
                               ended: { v in masterThrottle.run(final: true) { client.send(["type": "master", "value": v.rounded()]) }; release("master") })
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 4)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .onAppear(perform: sync)
        .onChange(of: client.state.intensity) { _ in sync() }
        .onChange(of: client.state.hue) { _ in sync() }
        .onChange(of: client.state.sat) { _ in sync() }
        .onChange(of: client.state.strobe) { _ in sync() }
        .onChange(of: client.state.master) { _ in sync() }
    }

    private var selectionNote: some View {
        let count = client.state.selectedCount
        return HStack(spacing: 8) {
            Image(systemName: count > 0 ? "checkmark.circle.fill" : "hand.tap.fill")
                .foregroundColor(count > 0 ? LX.accent : LX.warn)
            Text(count > 0 ? "\(count) light\(count == 1 ? "" : "s") selected" : "Nothing selected — pick lights in Select")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(count > 0 ? .white : LX.muted)
            Spacer()
        }
        .padding(.horizontal, 4)
    }

    private func labelled(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundColor(LX.muted)
            Spacer()
            Text(value).font(.system(size: 14, weight: .bold, design: .rounded)).monospacedDigit().foregroundColor(.white)
        }
        .padding(.top, 4)
    }

    private func sendColour() {
        client.send(["type": "colour", "hue": hue.rounded(), "sat": sat.rounded()])
    }

    // A moment after letting go, the console's values show again.
    private func release(_ key: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            editing.remove(key)
            sync()
        }
    }

    private func sync() {
        let s = client.state
        guard !s.type.isEmpty else { return }
        if !editing.contains("int") { intensity = s.intensity }
        if !editing.contains("colour") { hue = s.hue; sat = s.sat }
        if !editing.contains("strobe") { strobe = s.strobe }
        if !editing.contains("master") { master = s.master }
    }
}
