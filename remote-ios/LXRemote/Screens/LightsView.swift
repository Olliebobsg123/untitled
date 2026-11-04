import SwiftUI

/// Pick lights: a group, or lights one by one (tick to select).
struct LightsView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var search = ""

    private var fixtures: [FixtureItem] {
        let text = search.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return client.state.fixtures }
        return client.state.fixtures.filter { $0.num.text == text || $0.name.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        NavigationStack {
            List {
                if search.isEmpty {
                    Section {
                        ForEach(Array(client.state.groups.enumerated()), id: \.offset) { _, group in
                            Button {
                                Haptic.tap()
                                client.send(["type": "group", "name": group.name])
                            } label: {
                                HStack {
                                    Text(group.name).foregroundColor(.primary)
                                    Spacer()
                                    Text("\(group.count)")
                                        .monospacedDigit()
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    } header: {
                        Text("Groups")
                    } footer: {
                        if client.state.groups.isEmpty { Text("No groups in this show.") }
                    }
                }

                Section {
                    ForEach(fixtures, id: \.fid) { fixture in
                        Button {
                            Haptic.tap()
                            client.send(["type": "select", "id": fixture.fid.json])
                        } label: {
                            HStack(spacing: 12) {
                                Text(fixture.num.text)
                                    .font(.body.monospacedDigit().weight(.semibold))
                                    .frame(minWidth: 36, alignment: .leading)
                                Text(fixture.name)
                                    .lineLimit(1)
                                Spacer()
                                if fixture.sel {
                                    Image(systemName: "checkmark")
                                        .fontWeight(.semibold)
                                        .foregroundColor(.accentColor)
                                }
                            }
                            .foregroundColor(.primary)
                        }
                    }
                } header: {
                    Text("Lights · \(client.state.selectedCount) selected")
                } footer: {
                    if client.state.fixtures.isEmpty { Text("No lights patched.") }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, prompt: "Find a light")
            .navigationTitle("Lights")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Clear") {
                        Haptic.tap()
                        client.send(["type": "select", "mode": "none"])
                    }
                    .disabled(client.state.selectedCount == 0)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Select All") {
                        Haptic.tap()
                        client.send(["type": "select", "mode": "all"])
                    }
                }
            }
        }
    }
}
