import Foundation
import Network

struct FoundConsole: Identifiable, Hashable {
    let id: String          // the Bonjour service name
    let endpoint: NWEndpoint

    /// "Lighting Console (Olivers-MacBook-Pro.local)" → "Olivers MacBook Pro"
    var displayName: String {
        var name = id
        if let open = name.range(of: "("), let close = name.range(of: ")", options: .backwards), open.upperBound <= close.lowerBound {
            name = String(name[open.upperBound..<close.lowerBound])
        }
        name = name.replacingOccurrences(of: ".local", with: "").replacingOccurrences(of: "-", with: " ")
        return name.isEmpty ? id : name
    }
}

/// Finds Light Spark consoles on the Wi-Fi (they advertise _lxconsole._tcp).
final class Discovery: ObservableObject {
    @Published var found: [FoundConsole] = []
    private var browser: NWBrowser?

    func start() {
        stop()
        let browser = NWBrowser(for: .bonjour(type: "_lxconsole._tcp", domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let items = results.compactMap { result -> FoundConsole? in
                guard case let .service(name, _, _, _) = result.endpoint else { return nil }
                return FoundConsole(id: name, endpoint: result.endpoint)
            }
            .sorted { $0.id < $1.id }
            DispatchQueue.main.async { self?.found = items }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    /// The console's IPv4 address and port, from a short test connection.
    static func resolve(_ endpoint: NWEndpoint, completion: @escaping ((host: String, port: Int)?) -> Void) {
        let params = NWParameters.tcp
        if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
        let connection = NWConnection(to: endpoint, using: params)
        let lock = NSLock()
        var finished = false
        func finish(_ result: (host: String, port: Int)?) {
            lock.lock()
            let first = !finished
            finished = true
            lock.unlock()
            guard first else { return }
            connection.cancel()
            DispatchQueue.main.async { completion(result) }
        }
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if case let .hostPort(host, port)? = connection.currentPath?.remoteEndpoint {
                    var name = "\(host)"
                    if let scope = name.firstIndex(of: "%") { name = String(name[..<scope]) }
                    finish((name, Int(port.rawValue)))
                } else {
                    finish(nil)
                }
            case .failed, .cancelled:
                finish(nil)
            default:
                break
            }
        }
        connection.start(queue: .global())
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) { finish(nil) }
    }
}
