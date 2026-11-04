import SwiftUI

/// The cue list, song by song, with Go and Back always at the bottom.
/// Tap a cue to go to it, or make it the next one.
struct CuesView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var picked: CueItem?

    private var s: ConsoleState { client.state }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if !s.cues.contains(where: { $0 != nil }) {
                        Section {
                            Text("No cues yet. Cues you record in Light Spark show here.")
                                .foregroundColor(.secondary)
                        }
                    }
                    ForEach(sections) { section in
                        Section {
                            ForEach(section.cues) { cue in
                                Button {
                                    picked = cue
                                } label: {
                                    CueRow(cue: cue, isLive: cue.i == s.currentCue, isNext: cue.i == s.nextIndex)
                                }
                                .id(cue.i)
                            }
                        } header: {
                            if let title = section.title { Text(title) }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .onChange(of: s.currentCue) { index in
                    withAnimation { proxy.scrollTo(index, anchor: .center) }
                }
            }
            .navigationTitle("Cues")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { ConnectionStatus() }
                ToolbarItem(placement: .navigationBarTrailing) { BlackoutButton() }
            }
            .safeAreaInset(edge: .bottom) { GoBar() }
            .confirmationDialog(
                picked.map { "Cue \($0.number.text) · \($0.name)" } ?? "",
                isPresented: Binding(get: { picked != nil }, set: { if !$0 { picked = nil } }),
                titleVisibility: .visible,
                presenting: picked
            ) { cue in
                Button("Go to This Cue") {
                    Haptic.thump()
                    client.send(["type": "cue", "index": cue.i])
                }
                Button("Make It the Next Cue") {
                    Haptic.tap()
                    client.command("set next \(cue.number.text)")
                }
            } message: { cue in
                Text(cue.goNote.map { "GO on \($0)" } ?? "Go to it now, or make it the cue GO plays next.")
            }
        }
    }

    // A section for each scene (song); cues before the first scene have no heading.
    private struct CueSection: Identifiable {
        let id: Int
        let title: String?
        var cues: [CueItem]
    }

    private var sections: [CueSection] {
        var out: [CueSection] = []
        for case let cue? in s.cues {
            if out.isEmpty || (cue.scene != nil && cue.scene != out[out.count - 1].title) {
                out.append(CueSection(id: cue.i, title: cue.scene, cues: [cue]))
            } else {
                out[out.count - 1].cues.append(cue)
            }
        }
        return out
    }
}

struct CueRow: View {
    let cue: CueItem
    let isLive: Bool
    let isNext: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(cue.number.text)
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundColor(isLive ? .accentColor : .secondary)
                .frame(minWidth: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(cue.name)
                    .foregroundColor(.primary)
                    .fontWeight(isLive ? .semibold : .regular)
                    .lineLimit(1)
                if let note = cue.goNote {
                    Text(note)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if isLive {
                Text("LIVE")
                    .font(.caption2.bold())
                    .foregroundColor(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.accentColor))
            } else if isNext {
                Text("NEXT")
                    .font(.caption2.bold())
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// What's next and where it goes, with Back and Go.
struct GoBar: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        let next = client.state.cue(at: client.state.nextIndex)
        VStack(spacing: 10) {
            if let next {
                VStack(spacing: 2) {
                    Text("Next: \(next.number.text) · \(next.name)")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let note = next.goNote {
                        Text("GO on \(note)")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                    }
                }
            } else {
                Text(client.state.currentCue >= 0 ? "End of the cue list" : "No cues")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            HStack(spacing: 12) {
                Button {
                    Haptic.tap()
                    client.send(["type": "back"])
                } label: {
                    Label("Back", systemImage: "backward.fill")
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .buttonStyle(.bordered)
                .frame(width: 120)

                Button {
                    Haptic.thump()
                    client.send(["type": "go"])
                } label: {
                    Text("Go")
                        .font(.title2.bold())
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(next == nil)
            }
        }
        .padding(.horizontal)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }
}
