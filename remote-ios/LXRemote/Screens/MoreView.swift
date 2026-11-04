import SwiftUI

/// Palettes, chases, the command line, recording, stopping everything, and the connection.
struct MoreView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var confirmKillAll = false
    @State private var confirmDisconnect = false

    var body: some View {
        NavigationStack {
            List {
                Section("Show") {
                    NavigationLink { PalettesView() } label: { Label("Palettes", systemImage: "paintpalette") }
                    NavigationLink { ChasesView() } label: { Label("Chases", systemImage: "arrow.triangle.2.circlepath") }
                    NavigationLink { RecordCueView() } label: { Label("Record a Cue", systemImage: "record.circle") }
                    NavigationLink { CommandView() } label: { Label("Command Line", systemImage: "terminal") }
                }

                Section {
                    Button(role: .destructive) {
                        Haptic.thump()
                        client.command("kill")
                    } label: {
                        Label("Kill Cue List", systemImage: "stop.circle")
                    }
                    Button(role: .destructive) {
                        confirmKillAll = true
                    } label: {
                        Label("Kill Everything", systemImage: "exclamationmark.octagon")
                    }
                } header: {
                    Text("Stop")
                } footer: {
                    Text("Kill Cue List puts the lights out and GO starts again from the first cue. Kill Everything also stops chases, effects, fog and haze.")
                }

                Section("Connection") {
                    HStack {
                        Text("Light Spark")
                        Spacer()
                        Text(client.console?.name ?? "").foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Status")
                        Spacer()
                        ConnectionStatus()
                    }
                    Button("Disconnect", role: .destructive) { confirmDisconnect = true }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("More")
            .confirmationDialog("Kill everything?", isPresented: $confirmKillAll, titleVisibility: .visible) {
                Button("Kill Everything", role: .destructive) {
                    Haptic.thump()
                    client.command("kill all")
                }
            } message: {
                Text("Stops cues, chases, effects, timecode, fog and haze, and clears the programmer.")
            }
            .confirmationDialog("Disconnect from Light Spark?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { client.disconnect() }
            }
        }
    }
}

struct PalettesView: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        List {
            Section {
                ForEach(Array(client.state.palettes.enumerated()), id: \.offset) { _, palette in
                    Button {
                        Haptic.tap()
                        client.send(["type": "palette", "name": palette.name])
                    } label: {
                        HStack(spacing: 12) {
                            if let hue = palette.hue, let sat = palette.sat, sat > 0 {
                                Circle().fill(LightColour.shown(hue: hue, sat: sat)).frame(width: 18, height: 18)
                            } else {
                                Image(systemName: "circle.dashed").foregroundColor(.secondary)
                            }
                            Text(palette.name).foregroundColor(.primary)
                        }
                    }
                }
            } footer: {
                Text(client.state.palettes.isEmpty ? "No palettes in this show." : "Applies to the selected lights.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Palettes")
    }
}

struct ChasesView: View {
    @EnvironmentObject var client: RemoteClient

    var body: some View {
        List {
            Section {
                ForEach(Array(client.state.chases.enumerated()), id: \.offset) { _, chase in
                    Button {
                        Haptic.tap()
                        client.send(["type": "chase", "index": chase.i])
                    } label: {
                        HStack {
                            Text(chase.name).foregroundColor(.primary)
                            Spacer()
                            if chase.i == client.state.activeChase {
                                Text("Running").font(.subheadline).foregroundColor(.accentColor)
                            }
                        }
                    }
                }
            } footer: {
                if client.state.chases.isEmpty { Text("No chases in this show.") }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Chases")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Stop") {
                    Haptic.tap()
                    client.send(["type": "stopChase"])
                }
                .disabled(client.state.activeChase < 0)
            }
        }
    }
}

struct RecordCueView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var number = ""
    @State private var name = ""

    private var cueNumber: Double? {
        guard let n = Double(number.replacingOccurrences(of: ",", with: ".")), n > 0 else { return nil }
        return n
    }

    var body: some View {
        Form {
            Section {
                TextField("Cue number", text: $number)
                    .keyboardType(.decimalPad)
                TextField("Name (optional)", text: $name)
            } footer: {
                Text("Records what's on stage now. 2.5 goes between cues 2 and 3.")
            }
            Section {
                Button("Record Cue") {
                    guard let n = cueNumber else { return }
                    Haptic.thump()
                    client.send(["type": "record", "number": n, "name": name])
                    number = ""
                    name = ""
                }
                .disabled(cueNumber == nil)
            }
        }
        .navigationTitle("Record a Cue")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct CommandView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var text = ""

    private let quick = ["highlight", "highlight off", "rem dim", "clear", "what's on", "stop all"]

    var body: some View {
        Form {
            Section {
                TextField("1 thru 4 @ 50", text: $text)
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .submitLabel(.send)
                    .onSubmit(send)
                Button("Send", action: send)
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            } footer: {
                Text("Anything you'd type into Light Spark's command line.")
            }

            Section("Quick") {
                ForEach(quick, id: \.self) { word in
                    Button(word) {
                        Haptic.tap()
                        client.command(word)
                    }
                    .font(.body.monospaced())
                }
            }

            Section("From Light Spark") {
                if client.log.isEmpty {
                    Text("Messages from Light Spark show here.").foregroundColor(.secondary)
                }
                ForEach(client.log) { line in
                    Text(line.msg)
                        .font(.footnote)
                        .foregroundColor(line.type == "warn" ? .orange : line.type == "error" ? .red : .primary)
                }
            }
        }
        .navigationTitle("Command Line")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }

    private func send() {
        let command = text.trimmingCharacters(in: .whitespaces)
        guard !command.isEmpty else { return }
        Haptic.tap()
        client.command(command)
        text = ""
    }
}
