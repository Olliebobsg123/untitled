import SwiftUI

/// What's live, what's next, GO / Back, and the cue list (song by song).
struct PlayView: View {
    @EnvironmentObject var client: RemoteClient

    private var s: ConsoleState { client.state }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    LiveCard(current: s.cue(at: s.currentCue), next: s.cue(at: s.nextIndex))

                    HStack(spacing: 12) {
                        Button {
                            Haptic.tap()
                            client.send(["type": "back"])
                        } label: {
                            VStack(spacing: 6) {
                                Image(systemName: "chevron.backward").font(.system(size: 26, weight: .bold))
                                Text("Back").font(.system(size: 13, weight: .semibold)).foregroundColor(LX.muted)
                            }
                            .foregroundColor(.white)
                            .frame(width: 100, height: 120)
                            .glass(24)
                        }
                        .buttonStyle(PressStyle())

                        Button {
                            Haptic.thump()
                            client.send(["type": "go"])
                        } label: {
                            GoFace(next: s.cue(at: s.nextIndex))
                        }
                        .buttonStyle(PressStyle())
                    }

                    SectionTitle("Cue list").padding(.top, 10).padding(.leading, 4)

                    if !s.cues.contains(where: { $0 != nil }) {
                        EmptyNote(text: "No cues recorded yet")
                    }
                    LazyVStack(spacing: 8) {
                        ForEach(rows) { row in
                            switch row.kind {
                            case .scene(let name):
                                Text(name.uppercased())
                                    .font(.system(size: 11, weight: .bold))
                                    .tracking(1.4)
                                    .foregroundColor(LX.accent)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.top, 12)
                                    .padding(.leading, 4)
                            case .cue(let cue):
                                CueRow(cue: cue, live: cue.i == s.currentCue, next: cue.i == s.nextIndex) {
                                    Haptic.tap()
                                    client.send(["type": "cue", "index": cue.i])
                                }
                                .id("cue-\(cue.i)")
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
            .onChange(of: s.currentCue) { index in
                withAnimation(.easeInOut(duration: 0.4)) { proxy.scrollTo("cue-\(index)", anchor: .center) }
            }
        }
    }

    // The cue list with a heading wherever the scene (song) changes.
    private struct Row: Identifiable {
        enum Kind { case scene(String), cue(CueItem) }
        let id: String
        let kind: Kind
    }

    private var rows: [Row] {
        var out: [Row] = []
        var scene: String?
        for case let cue? in s.cues {
            if let name = cue.scene, name != scene {
                scene = name
                out.append(Row(id: "scene-\(cue.i)", kind: .scene(name)))
            }
            out.append(Row(id: "cue-\(cue.i)", kind: .cue(cue)))
        }
        return out
    }
}

struct LiveCard: View {
    let current: CueItem?
    let next: CueItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle("Live", colour: LX.accent)
            if let cue = current {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(cue.number.text)
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundColor(LX.accent)
                    Text(cue.name)
                        .font(.system(size: 27, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                if let scene = cue.scene {
                    Text(scene).font(.system(size: 13, weight: .semibold)).foregroundColor(LX.muted)
                }
            } else {
                Text("No cue running")
                    .font(.system(size: 21, weight: .bold, design: .rounded))
                    .foregroundColor(LX.muted)
            }
            Group {
                if let cue = next {
                    (Text("Next  ").foregroundColor(LX.muted)
                     + Text("\(cue.number.text) \(cue.name)").foregroundColor(.white).bold()
                     + Text(cue.goNote.map { "  ·  GO on \($0)" } ?? "").foregroundColor(LX.muted))
                } else if current != nil {
                    Text("End of the cue list").foregroundColor(LX.muted)
                }
            }
            .font(.system(size: 13))
            .lineLimit(2)
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(LinearGradient(colors: [LX.accent.opacity(0.16), Color.white.opacity(0.035)], startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(LX.line, lineWidth: 1))
        .animation(.easeInOut(duration: 0.25), value: current?.i)
    }
}

struct GoFace: View {
    let next: CueItem?

    var body: some View {
        VStack(spacing: 4) {
            Text("GO")
                .font(.system(size: 46, weight: .black, design: .rounded))
                .tracking(2)
            Text(next.map { "\($0.number.text) · \($0.name)" } ?? "End of the list")
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
                .opacity(0.75)
                .padding(.horizontal, 14)
        }
        .foregroundColor(LX.ink)
        .frame(maxWidth: .infinity)
        .frame(height: 120)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(RadialGradient(colors: [LX.accentBright, LX.accent, LX.accentDeep], center: .top, startRadius: 0, endRadius: 260))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(LinearGradient(colors: [Color.white.opacity(0.6), Color.white.opacity(0.05)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        )
        .shadow(color: LX.accent.opacity(0.45), radius: 26, y: 12)
    }
}

struct CueRow: View {
    let cue: CueItem
    let live: Bool
    let next: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(cue.number.text)
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundColor(live ? LX.ink : LX.muted)
                    .frame(minWidth: 46)
                    .padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(live ? LX.accent : Color.white.opacity(0.06)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(cue.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    if let note = cue.goNote {
                        Text("GO on \(note)")
                            .font(.system(size: 12))
                            .foregroundColor(LX.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                if live {
                    Pill(text: "LIVE", fill: LX.accent, ink: LX.ink)
                } else if next {
                    Pill(text: "NEXT", fill: Color.white.opacity(0.09), ink: LX.muted)
                }
                Text(String(format: "%.1fs", cue.fade / 1000))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundColor(LX.dim)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .fill(live
                          ? AnyShapeStyle(LinearGradient(colors: [LX.accent.opacity(0.22), LX.accent.opacity(0.04)], startPoint: .leading, endPoint: .trailing))
                          : AnyShapeStyle(LX.glass))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .strokeBorder(live ? LX.accent.opacity(0.55) : LX.line, lineWidth: 1)
            )
            .shadow(color: live ? LX.accent.opacity(0.18) : .clear, radius: 14, y: 6)
        }
        .buttonStyle(PressStyle())
    }
}
