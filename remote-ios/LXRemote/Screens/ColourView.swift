import SwiftUI

/// Level, colour and strobe for the selected lights, and the grand master.
struct ColourView: View {
    @EnvironmentObject var client: RemoteClient

    @State private var intensity: Double = 100
    @State private var strobe: Double = 0
    @State private var master: Double = 100
    @State private var custom = Color.white
    @State private var editing: Set<String> = []

    private let levelThrottle = Throttle()
    private let strobeThrottle = Throttle()
    private let masterThrottle = Throttle()
    private let swatchColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 6)

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Image(systemName: "sun.min").foregroundColor(.secondary)
                        Slider(value: $intensity, in: 0...100, onEditingChanged: { started in editingChanged("int", started) })
                        Image(systemName: "sun.max.fill").foregroundColor(.secondary)
                    }
                    HStack(spacing: 8) {
                        ForEach([0.0, 25, 50, 75, 100], id: \.self) { level in
                            Button(level == 0 ? "Out" : level == 100 ? "Full" : "\(Int(level))") {
                                Haptic.tap()
                                intensity = level
                                client.send(["type": "intensity", "value": level])
                            }
                            .buttonStyle(.bordered)
                            .frame(maxWidth: .infinity)
                        }
                    }
                } header: {
                    HStack {
                        Text("Intensity")
                        Spacer()
                        Text("\(Int(intensity.rounded()))%").monospacedDigit()
                    }
                } footer: {
                    Text(selectionText)
                }

                Section("Colour") {
                    if !client.state.swatches.isEmpty {
                        LazyVGrid(columns: swatchColumns, spacing: 12) {
                            ForEach(Array(client.state.swatches.enumerated()), id: \.offset) { _, swatch in
                                Button {
                                    Haptic.tap()
                                    client.send(["type": "colourName", "name": swatch.name])
                                } label: {
                                    Circle()
                                        .fill(LightColour.hsl(swatch.hue, swatch.sat, swatch.light))
                                        .overlay(Circle().strokeBorder(Color.primary.opacity(0.15), lineWidth: 1))
                                        .aspectRatio(1, contentMode: .fit)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(swatch.name)
                            }
                        }
                        .padding(.vertical, 6)
                    }
                    ColorPicker("Pick Any Colour", selection: $custom, supportsOpacity: false)
                        .onChange(of: custom) { colour in sendColour(colour) }
                    HStack {
                        Text("Selected lights")
                        Spacer()
                        Circle()
                            .fill(LightColour.shown(hue: client.state.hue, sat: client.state.sat))
                            .overlay(Circle().strokeBorder(Color.primary.opacity(0.15), lineWidth: 1))
                            .frame(width: 24, height: 24)
                    }
                }

                Section {
                    Slider(value: $strobe, in: 0...255, onEditingChanged: { started in editingChanged("strobe", started) })
                    Button("Strobe Off") {
                        Haptic.tap()
                        strobe = 0
                        client.send(["type": "strobe", "value": 0])
                    }
                    .disabled(strobe < 1)
                } header: {
                    HStack {
                        Text("Strobe")
                        Spacer()
                        Text(strobe < 1 ? "Off" : "\(Int(strobe.rounded()))").monospacedDigit()
                    }
                }

                Section {
                    Slider(value: $master, in: 0...100, onEditingChanged: { started in editingChanged("master", started) })
                } header: {
                    HStack {
                        Text("Grand Master")
                        Spacer()
                        Text("\(Int(master.rounded()))%").monospacedDigit()
                    }
                } footer: {
                    Text("Everything on stage, scaled together.")
                }
            }
            .navigationTitle("Colour")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) { BlackoutButton() }
            }
            .onAppear(perform: sync)
            .onChange(of: intensity) { value in
                if editing.contains("int") { levelThrottle.run { client.send(["type": "intensity", "value": value.rounded()]) } }
            }
            .onChange(of: strobe) { value in
                if editing.contains("strobe") { strobeThrottle.run { client.send(["type": "strobe", "value": value.rounded()]) } }
            }
            .onChange(of: master) { value in
                if editing.contains("master") { masterThrottle.run { client.send(["type": "master", "value": value.rounded()]) } }
            }
            .onChange(of: client.state.intensity) { _ in sync() }
            .onChange(of: client.state.strobe) { _ in sync() }
            .onChange(of: client.state.master) { _ in sync() }
        }
    }

    private var selectionText: String {
        let count = client.state.selectedCount
        return count == 0 ? "Nothing selected. Pick lights in the Lights tab." : "Changes go to the \(count) selected light\(count == 1 ? "" : "s")."
    }

    // While a slider moves it's yours; let go and the last value is sent, then the
    // console's values show again.
    private func editingChanged(_ key: String, _ started: Bool) {
        if started {
            editing.insert(key)
            return
        }
        switch key {
        case "int": levelThrottle.run(final: true) { client.send(["type": "intensity", "value": intensity.rounded()]) }
        case "strobe": strobeThrottle.run(final: true) { client.send(["type": "strobe", "value": strobe.rounded()]) }
        default: masterThrottle.run(final: true) { client.send(["type": "master", "value": master.rounded()]) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            editing.remove(key)
            sync()
        }
    }

    private func sendColour(_ colour: Color) {
        var hue: CGFloat = 0, sat: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
        guard UIColor(colour).getHue(&hue, saturation: &sat, brightness: &brightness, alpha: &alpha) else { return }
        client.send(["type": "colour", "hue": (Double(hue) * 360).rounded(), "sat": (Double(sat) * 100).rounded()])
    }

    private func sync() {
        let s = client.state
        guard !s.type.isEmpty else { return }
        if !editing.contains("int") { intensity = s.intensity }
        if !editing.contains("strobe") { strobe = s.strobe }
        if !editing.contains("master") { master = s.master }
    }
}
