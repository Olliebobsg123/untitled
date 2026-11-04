import SwiftUI

/// Pick Light Spark on the Wi-Fi (or type its address), then its PIN.
struct ConnectView: View {
    @EnvironmentObject var client: RemoteClient
    @StateObject private var discovery = Discovery()
    @State private var chosen: FoundConsole?
    @State private var askingForPin = false
    @State private var pin = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 10) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 44))
                            .foregroundColor(.accentColor)
                        Text("Connect to Light Spark")
                            .font(.title2.bold())
                        Text("In Light Spark on your Mac, type **remote on**, then **remote** to see the PIN.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    if discovery.found.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Looking on this Wi-Fi…").foregroundColor(.secondary)
                        }
                    }
                    ForEach(discovery.found) { item in
                        Button {
                            chosen = item
                            pin = ""
                            askingForPin = true
                        } label: {
                            HStack {
                                Label(item.displayName, systemImage: "desktopcomputer")
                                    .foregroundColor(.primary)
                                Spacer()
                                if busy && chosen == item { ProgressView() }
                            }
                        }
                        .disabled(busy)
                    }
                } header: {
                    Text("On This Wi-Fi")
                } footer: {
                    Text("Your iPhone and your Mac need to be on the same Wi-Fi.")
                }

                Section {
                    NavigationLink("Enter Address") { ManualConnectView() }
                }

                if let message = error ?? client.pairingMessage {
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("LX Remote")
            .alert("Enter PIN", isPresented: $askingForPin) {
                TextField("6-digit PIN", text: $pin)
                    .keyboardType(.numberPad)
                Button("Connect") {
                    if let item = chosen { connect(to: item) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Light Spark shows the PIN when you type remote.")
            }
        }
        .onAppear { discovery.start() }
        .onDisappear { discovery.stop() }
    }

    private func connect(to item: FoundConsole) {
        let digits = pin.filter(\.isNumber)
        guard digits.count == 6 else {
            error = "The PIN has 6 digits."
            Haptic.error()
            return
        }
        error = nil
        client.pairingMessage = nil
        busy = true
        Discovery.resolve(item.endpoint) { result in
            busy = false
            guard let result else {
                error = "Couldn't reach \(item.displayName). Check it's on the same Wi-Fi."
                Haptic.error()
                return
            }
            client.connect(SavedConsole(name: item.displayName, host: result.host, port: result.port, pin: digits))
        }
    }
}

/// Connect by typing the Mac's address (shown when you type remote in Light Spark).
struct ManualConnectView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var host = ""
    @State private var port = "8090"
    @State private var pin = ""

    var body: some View {
        Form {
            Section {
                TextField("192.168.1.20", text: $host)
                    .keyboardType(.numbersAndPunctuation)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                TextField("Port", text: $port)
                    .keyboardType(.numberPad)
            } header: {
                Text("Address")
            } footer: {
                Text("In the simulator on your Mac, use 127.0.0.1.")
            }

            Section("PIN") {
                TextField("6-digit PIN", text: $pin)
                    .keyboardType(.numberPad)
            }

            Section {
                Button("Connect") {
                    Haptic.tap()
                    client.connect(SavedConsole(name: trimmedHost, host: trimmedHost, port: Int(port) ?? 8090, pin: pin.filter(\.isNumber)))
                }
                .disabled(!ready)
            }
        }
        .navigationTitle("Enter Address")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            if host.isEmpty, let last = client.lastConsole {
                host = last.host
                port = String(last.port)
            }
        }
    }

    private var trimmedHost: String { host.trimmingCharacters(in: .whitespaces) }
    private var ready: Bool { !trimmedHost.isEmpty && Int(port) != nil && pin.filter(\.isNumber).count == 6 }
}
