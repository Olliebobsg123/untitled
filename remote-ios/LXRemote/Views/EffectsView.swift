import SwiftUI

/// Palettes and chases.
struct EffectsView: View {
    @EnvironmentObject var client: RemoteClient

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 9)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle("Palettes").padding(.leading, 4)
                if client.state.palettes.isEmpty {
                    EmptyNote(text: "No palettes in this show")
                } else {
                    LazyVGrid(columns: columns, spacing: 9) {
                        ForEach(Array(client.state.palettes.enumerated()), id: \.offset) { _, palette in
                            Tile(title: palette.name, dot: dotColour(palette)) {
                                client.send(["type": "palette", "name": palette.name])
                            }
                        }
                    }
                }

                HStack {
                    SectionTitle("Chases")
                    Spacer()
                    Button {
                        Haptic.tap()
                        client.send(["type": "stopChase"])
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "stop.fill").font(.system(size: 11, weight: .bold))
                            Text("Stop").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .glass(16)
                    }
                    .buttonStyle(PressStyle())
                }
                .padding(.top, 14)
                .padding(.leading, 4)

                if client.state.chases.isEmpty {
                    EmptyNote(text: "No chases in this show")
                } else {
                    LazyVGrid(columns: columns, spacing: 9) {
                        ForEach(Array(client.state.chases.enumerated()), id: \.offset) { _, chase in
                            Tile(title: chase.name, subtitle: chase.i == client.state.activeChase ? "Running" : nil, on: chase.i == client.state.activeChase) {
                                client.send(["type": "chase", "index": chase.i])
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 4)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
    }

    private func dotColour(_ palette: PaletteItem) -> Color? {
        guard let hue = palette.hue, let sat = palette.sat, sat > 0 else { return nil }
        return LX.light(hue: hue, sat: sat)
    }
}
