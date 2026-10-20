# Light Spark on Windows

## Download

Every update to the main branch is built automatically and put on the
[Latest Build release](https://github.com/Olliebobsg123/untitled/releases/tag/latest-build):

- `Lighting-Console-x64.exe` — the installer. **Use this one**: it updates itself.
- `Lighting-Console-portable.exe` — runs without installing (handy on a USB stick); it tells you when there's a new version but you download it yourself.

## Updates

Light Spark checks for a new version when it starts (Preferences → Show → Updates, or type `update`).
The installed version downloads it quietly and installs it **the next time you quit** — it never restarts during a show.
To install straight away: Preferences → Show → Updates → **Restart and update now**.

## Make the installer yourself (optional)

On a Windows 10 or 11 PC:

1. Install **Node.js** (the LTS version) from nodejs.org, and **Git** from git-scm.com.
2. Open **Command Prompt** and run:

   ```
   git clone https://github.com/Olliebobsg123/untitled.git lightspark
   cd lightspark
   npm install
   npm run build-win
   ```

3. The `Build` folder now has `Lighting-Console-x64.exe` (installer) and `Lighting-Console-portable.exe`.

To try it without building: `npm start` in the same folder.

## First run

- **Windows SmartScreen** may say "Windows protected your PC", because the app isn't signed with a paid certificate. Click **More info → Run anyway**.
- **Windows Firewall** asks whether Light Spark can use the network. Tick **Private networks** and allow it — Art-Net/sACN, the phone remote, QLab Connect and multi-console (primary / backup / client / mirror) all need it.
- **Show files** are saved in `Documents\LX Console Shows`, autosave backups in `Documents\LX Console Shows\Backups`.

## Hardware

- **USB-DMX interfaces** (Enttec DMX USB Pro and similar) show up as COM ports in Preferences → Outputs. If one doesn't appear, install the FTDI "VCP" driver from ftdichip.com.
- **MIDI controllers** work straight away. To talk to QLab or other software on the *same* PC (MSC or MIDI timecode), install a virtual MIDI cable such as **loopMIDI** (Windows has no built-in IAC Driver like the Mac).
- **Audio timecode (LTC)**: if Light Spark can't hear the sound input, check Settings → Privacy & security → Microphone → "Let desktop apps access your microphone".

## Keys

Everything that is ⌘ on the Mac is **Ctrl** on Windows: Ctrl+S save, Ctrl+O open, Ctrl+, Preferences, Ctrl+Z undo, Ctrl+1…9 pages. Quit with Ctrl+Q or Alt+F4.

## If something goes wrong

Light Spark keeps a log of how it started and any moment it got stuck.
Press **Alt** to show the menu bar, then **File → Show Log Folder**, and send `main.log`.
