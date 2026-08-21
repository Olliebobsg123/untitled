# Service startup

ART-NET and QLab services are loaded by Electron's main process. They are not spawned as separate Electron/Node child processes, so macOS Local Network access is attributed to the Lighting Console application when launched from Finder.
