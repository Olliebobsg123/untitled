# LX Remote (iPhone app)

A thin native shell around the phone UI the console serves. It finds the
console over Bonjour, takes the PIN, and shows the remote. The UI itself lives
in `../remote/` so it only has to be maintained in one place.

## Build

1. Install Xcode from the App Store, then run it once to accept the licence.
2. `brew install xcodegen`
3. `cd remote-ios && xcodegen` — generates `LXRemote.xcodeproj`
4. Open `LXRemote.xcodeproj`, pick the **LXRemote** target → *Signing & Capabilities*,
   choose your Team (a free Apple ID works; the app then needs re-installing every 7 days).
5. Plug in your iPhone, select it as the run destination, press Run.
   First launch: allow **Local Network** access when iOS asks.

## Use

On the console, click **📱 Remote** (bottom right), switch it on, and read the PIN.
Enter it in the app and tap your console (or type its IP address).
