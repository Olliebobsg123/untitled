import SwiftUI

/// Pick lights: groups, or fixtures one by one.
struct SelectView: View {
    @EnvironmentObject var client: RemoteClient

    private let groupColumns = [GridItem(.adaptive(minimum: 104), spacing: 9)]
    private let fixtureColumns = [GridItem(.adaptive(minimum: 74), spacing: 9)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    QuickRow(items: [
                        (label: "All", action: { client.send(["type": "select", "mode": "all"]) }),
                        (label: "None", action: { client.send(["type": "select", "mode": "none"]) })
                    ])
                    .frame(maxWidth: 200)
                    Spacer()
                    Text("\(client.state.selectedCount) selected")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(client.state.selectedCount > 0 ? LX.accent : LX.muted)
                }

                SectionTitle("Groups").padding(.top, 10).padding(.leading, 4)
                if client.state.groups.isEmpty {
                    EmptyNote(text: "No groups in this show")
                } else {
                    LazyVGrid(columns: groupColumns, spacing: 9) {
                        ForEach(Array(client.state.groups.enumerated()), id: \.offset) { _, group in
                            Tile(title: group.name, subtitle: "\(group.count) light\(group.count == 1 ? "" : "s")") {
                                client.send(["type": "group", "name": group.name])
                            }
                        }
                    }
                }

                SectionTitle("Lights").padding(.top, 10).padding(.leading, 4)
                if client.state.fixtures.isEmpty {
                    EmptyNote(text: "No lights patched")
                } else {
                    LazyVGrid(columns: fixtureColumns, spacing: 9) {
                        ForEach(Array(client.state.fixtures.enumerated()), id: \.offset) { _, fixture in
                            Tile(title: fixture.num.text, subtitle: shortName(fixture.name), on: fixture.sel, big: true) {
                                client.send(["type": "select", "id": fixture.fid.json])
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

    // "Showtec Performer 1500 Fresnel Q6 (20ch TR16)" → "Performer 1500"
    private func shortName(_ name: String) -> String {
        var words = name.replacingOccurrences(of: "\\s*\\(.*\\)", with: "", options: .regularExpression)
            .split(separator: " ").map(String.init)
        if words.count > 2 { words.removeFirst() }
        return words.prefix(2).joined(separator: " ")
    }
}
