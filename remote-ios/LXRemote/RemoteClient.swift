import Foundation
import SwiftUI

/// Talks to Light Spark: swaps the PIN for a token (POST /auth), then keeps a
/// WebSocket open. The console sends its state several times a second; the
/// phone sends small JSON commands ({"type":"go"}, …). Drops and Wi-Fi
/// blips reconnect by themselves.
@MainActor
final class RemoteClient: ObservableObject {
    enum Status: Equatable {
        case idle, connecting, live, reconnecting
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var state = ConsoleState()
    @Published private(set) var console: SavedConsole?
    @Published private(set) var log: [LogLine] = []
    @Published var toast: LogLine?
    /// Why pairing failed (wrong PIN…), shown on the pairing screen.
    @Published var pairingMessage: String?
    /// The last console, to fill in the pairing screen after a disconnect.
    @Published private(set) var lastConsole: SavedConsole?

    private var socket: URLSessionWebSocketTask?
    private var retry = 0
    private var generation = 0
    private var lastLogId = 0
    private let session: URLSession
    private let storeKey = "lx.console.v2"

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
        if let data = UserDefaults.standard.data(forKey: storeKey),
           let saved = try? JSONDecoder().decode(SavedConsole.self, from: data) {
            console = saved
            lastConsole = saved
            Task { await self.start() }
        }
    }

    // MARK: Pairing

    func connect(_ target: SavedConsole) {
        pairingMessage = nil
        console = target
        lastConsole = target
        if let data = try? JSONEncoder().encode(target) { UserDefaults.standard.set(data, forKey: storeKey) }
        retry = 0
        Task { await start() }
    }

    func disconnect() {
        generation += 1
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        console = nil
        status = .idle
        state = ConsoleState()
        log = []
        lastLogId = 0
        UserDefaults.standard.removeObject(forKey: storeKey)
    }

    /// Back in the app: reconnect at once if the connection went.
    func wake() {
        guard console != nil, status != .live else { return }
        retry = 0
        Task { await start() }
    }

    // MARK: Connection

    private enum AuthError: Error {
        case wrongPin(String)
        case unreachable
    }

    private func start() async {
        guard let target = console else { return }
        generation += 1
        let gen = generation
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        status = retry == 0 && state.type.isEmpty ? .connecting : .reconnecting
        do {
            let token = try await authenticate(target)
            guard gen == generation else { return }
            open(target, token: token, gen: gen)
        } catch AuthError.wrongPin(let message) {
            guard gen == generation else { return }
            Haptic.error()
            let saved = target
            disconnect()
            lastConsole = SavedConsole(name: saved.name, host: saved.host, port: saved.port, pin: "")
            pairingMessage = message
        } catch {
            guard gen == generation else { return }
            scheduleRetry(gen)
        }
    }

    private func authenticate(_ target: SavedConsole) async throws -> String {
        var parts = URLComponents()
        parts.scheme = "http"
        parts.host = target.host
        parts.port = target.port
        parts.path = "/auth"
        guard let url = parts.url else { throw AuthError.unreachable }
        var request = URLRequest(url: url, timeoutInterval: 4)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["pin": target.pin])
        let result: (Data, URLResponse)
        do { result = try await session.data(for: request) } catch { throw AuthError.unreachable }
        let (data, response) = result
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if code == 200, let token = body?["token"] as? String { return token }
        if code == 401 || code == 429 { throw AuthError.wrongPin(body?["error"] as? String ?? "Wrong PIN") }
        throw AuthError.unreachable
    }

    private func open(_ target: SavedConsole, token: String, gen: Int) {
        var parts = URLComponents()
        parts.scheme = "ws"
        parts.host = target.host
        parts.port = target.port
        parts.path = "/"
        parts.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = parts.url else { return }
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()
        send(["type": "hello"])
        receive(task, gen: gen)
    }

    private func receive(_ task: URLSessionWebSocketTask, gen: Int) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, gen == self.generation else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text): if let data = text.data(using: .utf8) { self.handle(data) }
                    case .data(let data): self.handle(data)
                    @unknown default: break
                    }
                    self.receive(task, gen: gen)
                case .failure:
                    self.status = .reconnecting
                    self.scheduleRetry(gen)
                }
            }
        }
    }

    private func handle(_ data: Data) {
        guard let next = try? JSONDecoder().decode(ConsoleState.self, from: data), next.type == "state" else { return }
        if status != .live {
            if status == .connecting { Haptic.success() }
            status = .live
            retry = 0
        }
        if let line = next.log, line.id != lastLogId {
            if lastLogId != 0 {
                toast = line
                log.insert(line, at: 0)
                if log.count > 50 { log.removeLast() }
            }
            lastLogId = line.id
        }
        state = next
    }

    private func scheduleRetry(_ gen: Int) {
        retry = min(retry + 1, 6)
        let delay = 0.5 * Double(retry)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, gen == self.generation, self.console != nil else { return }
            await self.start()
        }
    }

    // MARK: Commands

    func send(_ message: [String: Any]) {
        guard let socket,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    func command(_ text: String) { send(["type": "cmd", "text": text]) }
}
