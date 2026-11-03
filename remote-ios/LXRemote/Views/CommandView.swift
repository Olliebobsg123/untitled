import SwiftUI

/// Type any console command, record cues, and see what the console says.
struct CommandView: View {
    @EnvironmentObject var client: RemoteClient
    @State private var text = ""
    @State private var cueNumber = ""
    @State private var cueName = ""
    @FocusState private var focus: Field?

    private enum Field { case command, number, name }

    private let quick = ["highlight", "highlight off", "rem dim", "clear", "what's on", "stop all", "top", "kill"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle("Command").padding(.leading, 4)
                HStack(spacing: 8) {
                    TextField("1 thru 4 @ 50", text: $text)
                        .font(.system(size: 17, weight: .medium, design: .monospaced))
                        .foregroundColor(.white)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .submitLabel(.send)
                        .focused($focus, equals: .command)
                        .onSubmit(sendCommand)
                        .padding(.leading, 12)
                    Button(action: sendCommand) {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(LX.ink)
                            .frame(width: 46, height: 46)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(LX.accentFill))
                    }
                    .buttonStyle(PressStyle())
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(6)
                .glass(20)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(quick, id: \.self) { word in
                            Button {
                                Haptic.tap()
                                client.command(word)
                            } label: {
                                Text(word)
                                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                    .foregroundColor(.white.opacity(0.9))
                                    .padding(.horizontal, 12)
                                    .frame(height: 34)
                                    .glass(17)
                            }
                            .buttonStyle(PressStyle())
                        }
                    }
                    .padding(.horizontal, 2)
                }

                SectionTitle("Record a cue").padding(.top, 12).padding(.leading, 4)
                HStack(spacing: 8) {
                    TextField("#", text: $cueNumber)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)
                        .frame(width: 64, height: 46)
                        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white.opacity(0.06)))
                        .focused($focus, equals: .number)
                    TextField("Name", text: $cueName)
                        .font(.system(size: 17))
                        .foregroundColor(.white)
                        .submitLabel(.done)
                        .focused($focus, equals: .name)
                        .onSubmit(record)
                    Button(action: record) {
                        Circle()
                            .fill(Color.white)
                            .frame(width: 16, height: 16)
                            .frame(width: 46, height: 46)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(LinearGradient(colors: [Color(red: 1, green: 0.42, blue: 0.47), LX.bad], startPoint: .top, endPoint: .bottom)))
                            .shadow(color: LX.bad.opacity(0.4), radius: 10, y: 4)
                    }
                    .buttonStyle(PressStyle())
                    .disabled(Double(cueNumber) == nil)
                    .opacity(Double(cueNumber) == nil ? 0.5 : 1)
                }
                .padding(6)
                .glass(20)
                Text("Records what's on stage now. 2.5 goes between 2 and 3.")
                    .font(.footnote)
                    .foregroundColor(LX.dim)
                    .padding(.leading, 4)

                SectionTitle("From the console").padding(.top, 12).padding(.leading, 4)
                VStack(alignment: .leading, spacing: 8) {
                    if client.log.isEmpty {
                        Text("Messages from Light Spark show here.")
                            .foregroundColor(LX.muted)
                    }
                    ForEach(client.log) { line in
                        HStack(alignment: .top, spacing: 8) {
                            Circle().fill(colour(line.type)).frame(width: 6, height: 6).padding(.top, 6)
                            Text(line.msg).foregroundColor(line.type == "info" ? LX.muted : .white)
                        }
                    }
                }
                .font(.system(size: 13, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.28)))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(LX.line, lineWidth: 1))
            }
            .padding(.horizontal, 18)
            .padding(.top, 4)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func sendCommand() {
        let command = text.trimmingCharacters(in: .whitespaces)
        guard !command.isEmpty else { return }
        Haptic.tap()
        client.command(command)
        text = ""
    }

    private func record() {
        guard let number = Double(cueNumber.replacingOccurrences(of: ",", with: ".")), number > 0 else { return }
        Haptic.thump()
        client.send(["type": "record", "number": number, "name": cueName])
        cueName = ""
        cueNumber = ""
        focus = nil
    }

    private func colour(_ type: String) -> Color {
        switch type {
        case "warn": return LX.warn
        case "error": return LX.bad
        case "ok": return LX.accent
        default: return LX.dim
        }
    }
}
