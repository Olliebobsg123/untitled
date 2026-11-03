import SwiftUI

// Light Spark's colours: near-black stage, teal light.
extension Color {
    static let lxBg = Color(red: 0.024, green: 0.031, blue: 0.043)
    static let lxAccent = Color(red: 0.098, green: 0.839, blue: 0.639)
    static let lxAccent2 = Color(red: 0.243, green: 0.910, blue: 0.769)
    static let lxAccentDeep = Color(red: 0.059, green: 0.647, blue: 0.490)
    static let lxInk = Color(red: 0.012, green: 0.078, blue: 0.059)
    static let lxGlass = Color.white.opacity(0.055)
    static let lxLine = Color.white.opacity(0.09)
    static let lxMuted = Color(red: 0.54, green: 0.59, blue: 0.64)
    static let lxBad = Color(red: 1.0, green: 0.30, blue: 0.37)
}

/// The dark stage with a soft teal glow from above.
struct LXBackground: View {
    var body: some View {
        ZStack {
            Color.lxBg
            RadialGradient(colors: [Color.lxAccent.opacity(0.22), .clear], center: .top, startRadius: 0, endRadius: 440)
            RadialGradient(colors: [Color(red: 0.47, green: 0.35, blue: 1.0).opacity(0.14), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 400)
        }
        .ignoresSafeArea()
    }
}

/// Buttons that sink a little under your finger.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct ConnectView: View {
    @ObservedObject var session: Session
    @StateObject private var discovery = Discovery()
    @State private var pin = ""
    @State private var manualHost = ""
    @State private var manualPort = "8090"
    @State private var showManual = false
    @State private var busy = false
    @State private var error: String?
    @State private var appeared = false
    @FocusState private var pinFocused: Bool

    var body: some View {
        ZStack {
            LXBackground()
            ScrollView {
                VStack(spacing: 30) {
                    header
                    pinEntry
                    consoles
                    manual
                    if let error {
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.lxBad)
                            Text(error).font(.subheadline).foregroundColor(.white)
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.lxBad.opacity(0.12)))
                        .transition(.opacity)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 44)
                .padding(.bottom, 40)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            if busy { busyOverlay }
        }
        .onAppear {
            discovery.start()
            withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appeared = true }
        }
        .onDisappear { discovery.stop() }
    }

    // MARK: Parts

    private var header: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(LinearGradient(colors: [.lxAccent2, .lxAccent, .lxAccentDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 84, height: 84)
                    .shadow(color: Color.lxAccent.opacity(0.45), radius: 26, y: 12)
                Image(systemName: "sparkles")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundColor(.lxInk)
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
                    .foregroundColor(.lxAccent)
            }
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 10)
        }
    }

    private var pinEntry: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("PIN")
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
                        if digits.count == 6 { pinFocused = false; UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                    }
                HStack(spacing: 9) {
                    ForEach(0..<6, id: \.self) { i in
                        pinBox(i)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { pinFocused = true }
            }
            Text("On the console: type **remote**, or tap 📱 Remote at the bottom right.")
                .font(.footnote)
                .foregroundColor(.lxMuted)
        }
    }

    private func pinBox(_ i: Int) -> some View {
        let chars = Array(pin)
        let filled = i < chars.count
        let active = pinFocused && i == min(chars.count, 5)
        return RoundedRectangle(cornerRadius: 15, style: .continuous)
            .fill(filled ? Color.lxAccent.opacity(0.12) : Color.lxGlass)
            .overlay(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(active ? Color.lxAccent : (filled ? Color.lxAccent.opacity(0.35) : Color.lxLine), lineWidth: active ? 2 : 1)
            )
            .overlay(
                Text(filled ? String(chars[i]) : "")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            )
            .frame(height: 62)
            .shadow(color: active ? Color.lxAccent.opacity(0.35) : .clear, radius: 10)
            .animation(.easeOut(duration: 0.15), value: pin)
            .animation(.easeOut(duration: 0.15), value: pinFocused)
    }

    private var consoles: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Consoles on this Wi-Fi")
            VStack(spacing: 10) {
                if discovery.found.isEmpty {
                    HStack(spacing: 12) {
                        ProgressView().tint(.lxAccent)
                        Text("Looking for Light Spark…").foregroundColor(.lxMuted)
                        Spacer(minLength: 0)
                    }
                    .padding(16)
                    .background(card)
                }
                ForEach(discovery.found) { item in
                    Button { connect(to: item) } label: {
                        HStack(spacing: 14) {
                            ZStack {
                                Circle().fill(Color.lxAccent.opacity(0.15)).frame(width: 44, height: 44)
                                Image(systemName: "desktopcomputer").foregroundColor(.lxAccent)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.id)
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                Text(pinValid ? "Tap to connect" : "Enter the PIN first")
                                    .font(.caption)
                                    .foregroundColor(.lxMuted)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(pinValid ? .lxAccent : .lxMuted)
                        }
                        .padding(14)
                        .background(card)
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
                    sectionTitle("Or enter an address")
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.lxMuted)
                        .rotationEffect(.degrees(showManual ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if showManual {
                VStack(spacing: 12) {
                    HStack(spacing: 10) {
                        field("192.168.1.20", text: $manualHost, keyboard: .numbersAndPunctuation)
                        field("Port", text: $manualPort, keyboard: .numberPad).frame(width: 86)
                    }
                    Button(action: connectManual) {
                        Text("Connect")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(.lxInk)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(LinearGradient(colors: [.lxAccent2, .lxAccent], startPoint: .top, endPoint: .bottom))
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .shadow(color: Color.lxAccent.opacity(manualReady ? 0.35 : 0), radius: 16, y: 8)
                    }
                    .buttonStyle(PressStyle())
                    .disabled(!manualReady)
                    .opacity(manualReady ? 1 : 0.45)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var busyOverlay: some View {
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().controlSize(.large).tint(.lxAccent)
                Text("Connecting…").font(.headline).foregroundColor(.white)
            }
            .padding(30)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .transition(.opacity)
    }

    private var card: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color.lxGlass)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.lxLine, lineWidth: 1))
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .tracking(1.4)
            .foregroundColor(.lxMuted)
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
            .background(card)
    }

    // MARK: Connecting

    private var pinValid: Bool { pin.count == 6 && pin.allSatisfy(\.isNumber) }
    private var manualReady: Bool { pinValid && !manualHost.trimmingCharacters(in: .whitespaces).isEmpty && Int(manualPort) != nil }

    private func connectManual() {
        guard let port = Int(manualPort) else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        session.connect(Console(host: manualHost.trimmingCharacters(in: .whitespaces), port: port, pin: pin))
    }

    private func connect(to item: FoundConsole) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation { busy = true; error = nil }
        Discovery.resolve(item.endpoint) { result in
            withAnimation { busy = false }
            guard let result else {
                withAnimation { error = "Couldn't reach \(item.id). Check you're on the same Wi-Fi." }
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                return
            }
            session.connect(Console(host: result.host, port: result.port, pin: pin))
        }
    }
}
