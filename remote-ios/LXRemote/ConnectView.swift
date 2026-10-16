import SwiftUI

struct ConnectView: View {
    @ObservedObject var session: Session
    @StateObject private var discovery = Discovery()
    @State private var pin = ""
    @State private var manualHost = ""
    @State private var manualPort = "8090"
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("PIN"), footer: Text("Shown in the Phone Remote panel on the console (📱 Remote, bottom right).")) {
                    TextField("6-digit PIN", text: $pin)
                        .keyboardType(.numberPad)
                        .font(.system(.title2, design: .monospaced))
                }

                Section(header: Text("Consoles on this Wi-Fi")) {
                    if discovery.found.isEmpty {
                        HStack { ProgressView(); Text("Searching…").foregroundColor(.secondary) }
                    }
                    ForEach(discovery.found) { item in
                        Button(item.id) { connect(to: item) }.disabled(!pinValid || busy)
                    }
                }

                Section(header: Text("Or enter an address")) {
                    TextField("IP address, e.g. 192.168.1.20", text: $manualHost)
                        .keyboardType(.numbersAndPunctuation)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    TextField("Port", text: $manualPort).keyboardType(.numberPad)
                    Button("Connect") {
                        guard let port = Int(manualPort) else { return }
                        session.connect(Console(host: manualHost.trimmingCharacters(in: .whitespaces), port: port, pin: pin))
                    }
                    .disabled(!pinValid || manualHost.trimmingCharacters(in: .whitespaces).isEmpty || Int(manualPort) == nil)
                }

                if let error { Section { Text(error).foregroundColor(.red) } }
            }
            .navigationTitle("LX Remote")
            .overlay { if busy { ProgressView("Connecting…").padding().background(.regularMaterial).cornerRadius(12) } }
        }
        .navigationViewStyle(.stack)
        .onAppear { discovery.start() }
        .onDisappear { discovery.stop() }
    }

    private var pinValid: Bool { pin.count == 6 && pin.allSatisfy(\.isNumber) }

    private func connect(to item: FoundConsole) {
        busy = true; error = nil
        Discovery.resolve(item.endpoint) { result in
            busy = false
            guard let result else { error = "Couldn't reach \(item.id). Check you're on the same Wi-Fi."; return }
            session.connect(Console(host: result.host, port: result.port, pin: pin))
        }
    }
}
