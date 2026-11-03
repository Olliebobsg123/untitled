import SwiftUI

/// First screen: the PIN, then pick the console (found on the Wi-Fi, or typed).
struct PairView: View {
    @EnvironmentObject var client: RemoteClient
    @StateObject private var discovery = Discovery()
    @State private var pin = ""
    @State private var host = ""
    @State private var port = "8090"
    @State private var showManual = false
    @State private var busy = false
    @State private var error: String?
    @State private var appeared = false
    @FocusState private var pinFocused: Bool

    var body: some View {
        ZStack {
            ScrollView {
                VStack(spacing: 30) {
                    header
                    pinEntry
                    consoles
                    manual
                    if let message = error ?? client.pairingMessage {
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(LX.bad)
                            Text(message).font(.subheadline).foregroundColor(.white)
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(LX.bad.opacity(0.12)))
                        .transition(.opacity)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 40)
                .padding(.bottom, 40)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)

            if busy {
                ZStack {
                    Color.black.opacity(0.45).ignoresSafeArea()
                    VStack(spacing: 14) {
                        ProgressView().controlSize(.large).tint(LX.accent)
                        Text("Connecting…").font(.headline).foregroundColor(.white)
                    }
                    .padding(30)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
                .transition(.opacity)
            }
        }
        .onAppear {
            discovery.start()
            if let last = client.lastConsole {
                host = last.host
                port = String(last.port)
            }
            withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appeared = true }
        }
        .onDisappear { discovery.stop() }
    }

    // MARK: Parts

    private var header: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(LinearGradient(colors: [LX.accentBright, LX.accent, LX.accentDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 88, height: 88)
                    .shadow(color: LX.accent.opacity(0.5), radius: 28, y: 12)
                Image(systemName: "sparkles")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundColor(LX.ink)
            }
            .scaleEffect(appeared ? 1 : 0.7)
            .opacity(appeared ? 1 : 0)
            VStack(spacing: 5) {
                Text("Light Spark")
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                Text("REMOTE")
                    .font(.system(size: 12, weight: .bold))
                    .tracking(3)
                    .foregroundColor(LX.accent)
            }
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 10)
        }
    }

    private var pinEntry: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("PIN")
            ZStack {
                // The real text field, out of sight; the boxes show what's typed.
                TextField("", text: $pin)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($pinFocused)
                    .frame(width: 1, height: 1)
                    .opacity(0.01)
                    .onChange(of: pin) { value in
                        let digits = String(value.filter(\.isNumber).prefix(6))
                        if digits != value { pin = digits }
                        if digits.count == 6 {
                            pinFocused = false
                            error = nil
                            client.pairingMessage = nil
                            Haptic.tap()
                        }
                    }
                HStack(spacing: 9) {
                    ForEach(0..<6, id: \.self) { i in pinBox(i) }
                }
                .contentShape(Rectangle())
                .onTapGesture { pinFocused = true }
            }
            Text("On the console, type **remote** (or click 📱 Remote, bottom right).")
                .font(.footnote)
                .foregroundColor(LX.muted)
        }
    }

    private func pinBox(_ i: Int) -> some View {
        let chars = Array(pin)
        let filled = i < chars.count
        let active = pinFocused && i == min(chars.count, 5)
        return RoundedRectangle(cornerRadius: 15, style: .continuous)
            .fill(filled ? LX.accent.opacity(0.12) : LX.glass)
            .overlay(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .strokeBorder(active ? LX.accent : (filled ? LX.accent.opacity(0.35) : LX.line), lineWidth: active ? 2 : 1)
            )
            .overlay(
                Text(filled ? String(chars[i]) : "")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            )
            .frame(height: 62)
            .shadow(color: active ? LX.accent.opacity(0.35) : .clear, radius: 10)
            .animation(.easeOut(duration: 0.15), value: pin)
            .animation(.easeOut(duration: 0.15), value: pinFocused)
    }

    private var consoles: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("Consoles on this Wi-Fi")
            VStack(spacing: 10) {
                if discovery.found.isEmpty {
                    HStack(spacing: 12) {
                        ProgressView().tint(LX.accent)
                        Text("Looking for Light Spark…").foregroundColor(LX.muted)
                        Spacer(minLength: 0)
                    }
                    .padding(16)
                    .glass(18)
                }
                ForEach(discovery.found) { item in
                    Button { connect(to: item) } label: {
                        HStack(spacing: 14) {
                            ZStack {
                                Circle().fill(LX.accent.opacity(0.15)).frame(width: 44, height: 44)
                                Image(systemName: "desktopcomputer").foregroundColor(LX.accent)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.displayName)
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                Text(pinValid ? "Tap to connect" : "Enter the PIN first")
                                    .font(.caption)
                                    .foregroundColor(LX.muted)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(pinValid ? LX.accent : LX.muted)
                        }
                        .padding(14)
                        .glass(18)
                    }
                    .buttonStyle(PressStyle())
                    .disabled(!pinValid || busy)
                    .opacity(pinValid ? 1 : 0.6)
                }
            }
        }
    }

    private var manual: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { showManual.toggle() }
            } label: {
                HStack {
                    SectionTitle("Or type its address")
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(LX.muted)
                        .rotationEffect(.degrees(showManual ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if showManual {
                VStack(spacing: 12) {
                    HStack(spacing: 10) {
                        field("192.168.1.20", text: $host, keyboard: .numbersAndPunctuation)
                        field("Port", text: $port, keyboard: .numberPad).frame(width: 86)
                    }
                    Button(action: connectManual) {
                        Text("Connect")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(LX.ink)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(LX.accentFill)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .shadow(color: LX.accent.opacity(manualReady ? 0.35 : 0), radius: 16, y: 8)
                    }
                    .buttonStyle(PressStyle())
                    .disabled(!manualReady)
                    .opacity(manualReady ? 1 : 0.45)
                    Text("The simulator on your Mac: 127.0.0.1")
                        .font(.footnote)
                        .foregroundColor(LX.dim)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(keyboard)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
            .font(.system(size: 16, design: .monospaced))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .frame(height: 54)
            .glass(16)
    }

    // MARK: Connecting

    private var pinValid: Bool { pin.count == 6 && pin.allSatisfy(\.isNumber) }
    private var trimmedHost: String { host.trimmingCharacters(in: .whitespaces) }
    private var manualReady: Bool { pinValid && !trimmedHost.isEmpty && Int(port) != nil }

    private func connectManual() {
        guard let portNumber = Int(port) else { return }
        Haptic.tap()
        client.connect(SavedConsole(name: trimmedHost, host: trimmedHost, port: portNumber, pin: pin))
    }

    private func connect(to item: FoundConsole) {
        Haptic.tap()
        withAnimation { busy = true; error = nil }
        Discovery.resolve(item.endpoint) { result in
            withAnimation { busy = false }
            guard let result else {
                withAnimation { error = "Couldn't reach \(item.displayName). Check you're on the same Wi-Fi." }
                Haptic.error()
                return
            }
            client.connect(SavedConsole(name: item.displayName, host: result.host, port: result.port, pin: pin))
        }
    }
}
