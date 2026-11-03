# LX Remote (iPhone app)

A native SwiftUI remote for Light Spark. It finds the console on the Wi-Fi
(Bonjour, `_lxconsole._tcp`), pairs with the 6-digit PIN, and talks to the
console's remote server directly:

- `POST http://<console>:8090/auth` with `{"pin":"123456"}` → `{"token":"…"}`
- WebSocket `ws://<console>:8090/?token=…`
  - the console sends `{"type":"state", …}` several times a second
    (cues, live/next cue, groups, palettes, chases, fixtures, levels, log)
  - the phone sends commands: `go`, `back`, `cue`, `blackout`, `intensity`,
    `colour`, `colourName`, `strobe`, `master`, `select`, `group`, `palette`,
    `chase`, `stopChase`, `record`, `cmd` (any command-line text)

The web remote in `../remote/` (for Safari / Add to Home Screen) is separate.

## Screens

- **Pair** — PIN boxes, consoles found on the Wi-Fi, or type an address
- **Play** — what's live and next (with GO notes), GO / Back, the cue list by song
- **Look** — intensity, colour swatches, hue, saturation, strobe, grand master
- **Select** — all / none, groups, lights
- **FX** — palettes (with their colours) and chases
- **Command** — any command, quick commands, record a cue, the console's messages
- **⋯ menu** — kill the cue list, kill everything, disconnect

## Build (Mac, Xcode installed)

```bash
cd remote-ios
xcodegen
xcodebuild -project LXRemote.xcodeproj -scheme LXRemote -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build build
```

Run it in the simulator:

```bash
open -a Simulator
xcrun simctl boot "iPhone 17"
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/LXRemote.app
xcrun simctl launch booted com.olivergrainger.lxremote
```

On a real iPhone: open `LXRemote.xcodeproj` in Xcode, pick your Team under
Signing & Capabilities (a free Apple ID works; reinstall every 7 days), plug
in the phone and press Run.

`LXRemote.xcodeproj` and `LXRemote/Info.plist` are made by `xcodegen` from
`project.yml`, so they aren't kept in git.
