import Foundation

/// A value the console sends as either a number or a string (fixture ids and
/// numbers, cue numbers). Sent back exactly as it came.
enum Flex: Codable, Hashable {
    case string(String)
    case number(Double)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { self = .number(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else { self = .string("") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let d): try c.encode(d)
        }
    }

    var text: String {
        switch self {
        case .string(let s): return s
        case .number(let d): return d == d.rounded() && abs(d) < 1e9 ? String(Int(d)) : String(d)
        }
    }

    /// For sending back in a message.
    var json: Any {
        switch self {
        case .string(let s): return s
        case .number(let d): return d == d.rounded() && abs(d) < 1e9 ? Int(d) as Any : d as Any
        }
    }
}

struct CueItem: Decodable, Identifiable {
    var i = 0
    var number = Flex.string("")
    var name = "Cue"
    var fade: Double = 800
    var scene: String?
    var goNote: String?
    var id: Int { i }

    enum K: String, CodingKey { case i, number, name, fade, scene, goNote }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        i = (try? c.decode(Int.self, forKey: .i)) ?? 0
        number = (try? c.decode(Flex.self, forKey: .number)) ?? .number(Double(i + 1))
        name = (try? c.decode(String.self, forKey: .name)) ?? "Cue"
        fade = (try? c.decode(Double.self, forKey: .fade)) ?? 800
        scene = try? c.decode(String.self, forKey: .scene)
        goNote = try? c.decode(String.self, forKey: .goNote)
    }
}

struct GroupItem: Decodable {
    var name = ""
    var count = 0
}

struct PaletteItem: Decodable {
    var name = ""
    var hue: Double?
    var sat: Double?
}

struct ChaseItem: Decodable {
    var i = 0
    var name = ""
}

struct FixtureItem: Decodable {
    var fid = Flex.string("")
    var num = Flex.string("")
    var name = ""
    var sel = false

    enum K: String, CodingKey { case id, num, name, sel }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        fid = (try? c.decode(Flex.self, forKey: .id)) ?? .string("")
        num = (try? c.decode(Flex.self, forKey: .num)) ?? .string("")
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        sel = (try? c.decode(Bool.self, forKey: .sel)) ?? false
    }
}

struct Swatch: Decodable {
    var name = ""
    var hue: Double = 0
    var sat: Double = 0
    var light: Double = 50
}

struct LogLine: Decodable, Identifiable, Equatable {
    var id = 0
    var msg = ""
    var type = "info"
}

/// Everything the console tells the phone, several times a second.
struct ConsoleState: Decodable {
    var type = ""
    var mode: String?
    var blackout = false
    var master: Double = 100
    var intensity: Double = 100
    var hue: Double = 0
    var sat: Double = 0
    var strobe: Double = 0
    var currentCue = -1
    var next = -1
    var cues: [CueItem?] = []
    var groups: [GroupItem] = []
    var palettes: [PaletteItem] = []
    var chases: [ChaseItem] = []
    var activeChase = -1
    var fixtures: [FixtureItem] = []
    var swatches: [Swatch] = []
    var log: LogLine?

    init() {}

    enum K: String, CodingKey {
        case type, mode, blackout, master, intensity, hue, sat, strobe, currentCue, next, cues, groups, palettes, chases, activeChase, fixtures, swatches, log
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        mode = try? c.decode(String.self, forKey: .mode)
        blackout = (try? c.decode(Bool.self, forKey: .blackout)) ?? false
        master = (try? c.decode(Double.self, forKey: .master)) ?? 100
        intensity = (try? c.decode(Double.self, forKey: .intensity)) ?? 100
        hue = (try? c.decode(Double.self, forKey: .hue)) ?? 0
        sat = (try? c.decode(Double.self, forKey: .sat)) ?? 0
        strobe = (try? c.decode(Double.self, forKey: .strobe)) ?? 0
        currentCue = (try? c.decode(Int.self, forKey: .currentCue)) ?? -1
        next = (try? c.decode(Int.self, forKey: .next)) ?? -1
        cues = (try? c.decode([CueItem?].self, forKey: .cues)) ?? []
        groups = (try? c.decode([GroupItem].self, forKey: .groups)) ?? []
        palettes = (try? c.decode([PaletteItem].self, forKey: .palettes)) ?? []
        chases = (try? c.decode([ChaseItem].self, forKey: .chases)) ?? []
        activeChase = (try? c.decode(Int.self, forKey: .activeChase)) ?? -1
        fixtures = (try? c.decode([FixtureItem].self, forKey: .fixtures)) ?? []
        swatches = (try? c.decode([Swatch].self, forKey: .swatches)) ?? []
        log = try? c.decode(LogLine.self, forKey: .log)
    }

    func cue(at index: Int) -> CueItem? {
        index >= 0 && index < cues.count ? cues[index] : nil
    }

    /// What GO plays next: the console's choice, else the cue after the live one.
    var nextIndex: Int {
        if next >= 0, cue(at: next) != nil { return next }
        var i = currentCue + 1
        while i < cues.count {
            if cues[i] != nil { return i }
            i += 1
        }
        return -1
    }

    var isBlind: Bool { (mode ?? "").uppercased() == "BLIND" }
    var selectedCount: Int { fixtures.filter(\.sel).count }
}

/// The console the phone is paired with (remembered between launches).
struct SavedConsole: Codable, Equatable {
    var name: String
    var host: String
    var port: Int
    var pin: String
}
