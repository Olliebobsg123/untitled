/* ============================================================
   QLAB CLIENT
   ------------------------------------------------------------
   Features:
   • QLab IP configurable from UI
   • Bridge port configurable from UI
   • Passcode configurable from UI
   • Settings saved to localStorage
   • Automatic QLab cue detection
   • Automatic currentFileTime tracking
   • Timed lighting triggers
   • Immediate lighting links
   • Automatic reconnect
   • Lighting console GO can advance QLab
   • QLab GO can be triggered from anywhere using:
       QLab.goFromLightingConsole()
   ============================================================ */

window.QLab = {

  /* ==========================================================
     DEFAULT SETTINGS
     ========================================================== */

  ip: "127.0.0.1",
  bridgePort: 8083,
  passcode: "",

  ws: null,
  connected: false,
  reconnectTimer: null,
  watcher: null,

  /* ==========================================================
     QLAB STATE
     ========================================================== */

  cues: [],
  activeCue: null,
  activeElapsed: 0,
  workspaceId: null,

  /* ==========================================================
     LIGHTING LINKS
     ========================================================== */

  cueLinks: {},
  timeTriggers: {},

  /* ==========================================================
     TRIGGER STATE
     ========================================================== */

  firedTriggers: new Set(),
  lastElapsed: -1,
  lastCue: null,

  /* ==========================================================
     LOAD SETTINGS
     ========================================================== */

  loadSettings() {

    try {

      const saved =
        JSON.parse(
          localStorage.getItem(
            "qlabConnectionSettings"
          ) || "{}"
        );

      if (saved.ip !== undefined) {
        this.ip = String(saved.ip);
      }

      if (saved.bridgePort !== undefined) {
        this.bridgePort =
          Number(saved.bridgePort) || 8083;
      }

      if (saved.passcode !== undefined) {
        this.passcode = String(saved.passcode);
      }

    } catch (error) {

      console.warn(
        "Could not load QLab settings:",
        error
      );

    }

  },


  /* ==========================================================
     SAVE SETTINGS
     ========================================================== */

  saveSettings() {

    const ipInput =
      document.getElementById(
        "qlabIpInput"
      );

    const portInput =
      document.getElementById(
        "qlabPortInput"
      );

    const passInput =
      document.getElementById(
        "qlabPasscodeInput"
      );

    if (ipInput) {
      this.ip =
        ipInput.value.trim() ||
        "127.0.0.1";
    }

    if (portInput) {
      this.bridgePort =
        Number(portInput.value) ||
        8083;
    }

    if (passInput) {
      this.passcode =
        passInput.value;
    }

    localStorage.setItem(
      "qlabConnectionSettings",
      JSON.stringify({
        ip: this.ip,
        bridgePort: this.bridgePort,
        passcode: this.passcode
      })
    );

    console.log(
      "💾 QLab settings saved:",
      {
        ip: this.ip,
        bridgePort: this.bridgePort
      }
    );

  },


  /* ==========================================================
   QLAB SETTINGS UI
   ========================================================== */

renderSettings() {

  const qlabPage =
    document.getElementById("page-qlab") ||
    document.getElementById("qlabPage") ||
    document.getElementById("qlab");

  // Never render the settings anywhere else
  if (!qlabPage) return;

  const existing =
    document.getElementById("qlabSettingsPanel");

  if (existing) return;

  const panel =
    document.createElement("div");

  panel.id = "qlabSettingsPanel";

  panel.style.cssText = `
    width:100%;
    box-sizing:border-box;
    margin:15px 0 0 0;
    padding:16px;
    background:#20202a;
    border:1px solid #444;
    border-radius:10px;
    color:#fff;
  `;

  panel.innerHTML = `

    <div style="
      font-size:16px;
      font-weight:bold;
      margin-bottom:12px;
    ">
      ⚙️ QLab Connection Settings
    </div>

    <div style="
      display:flex;
      flex-wrap:wrap;
      gap:12px;
      align-items:end;
    ">

      <div>
        <label style="
          display:block;
          font-size:11px;
          color:#aaa;
          margin-bottom:4px;
        ">
          QLab IP Address
        </label>

        <input
          id="qlabIpInput"
          type="text"
          value="${this.escapeHTML(this.ip)}"
          placeholder="127.0.0.1"
          style="
            width:150px;
            padding:8px;
            border-radius:5px;
            border:1px solid #555;
            background:#111;
            color:#fff;
          "
        >
      </div>

      <div>
        <label style="
          display:block;
          font-size:11px;
          color:#aaa;
          margin-bottom:4px;
        ">
          Bridge Port
        </label>

        <input
          id="qlabPortInput"
          type="number"
          value="${this.bridgePort}"
          placeholder="8083"
          style="
            width:90px;
            padding:8px;
            border-radius:5px;
            border:1px solid #555;
            background:#111;
            color:#fff;
          "
        >
      </div>

      <div>
        <label style="
          display:block;
          font-size:11px;
          color:#aaa;
          margin-bottom:4px;
        ">
          Passcode
        </label>

        <input
          id="qlabPasscodeInput"
          type="password"
          value="${this.escapeHTML(this.passcode)}"
          placeholder="QLab bridge passcode"
          style="
            width:180px;
            padding:8px;
            border-radius:5px;
            border:1px solid #555;
            background:#111;
            color:#fff;
          "
        >
      </div>

      <button
        class="btn-secondary"
        onclick="QLab.applySettings()"
      >
        💾 Save & Connect
      </button>

      <button
        class="btn-secondary"
        onclick="QLab.goFromLightingConsole()"
        style="
          font-weight:bold;
          padding:9px 18px;
        "
      >
        ▶ QLAB GO
      </button>

    </div>

    <div
      id="qlabSettingsStatus"
      style="
        margin-top:10px;
        font-size:11px;
        color:#888;
      "
    >
      Settings are saved in this browser.
    </div>

  `;

  // Put it INSIDE the QLab page only
  qlabPage.appendChild(panel);
},
  /* ==========================================================
     ESCAPE HTML
     ========================================================== */

  escapeHTML(value) {

    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  },


  /* ==========================================================
     APPLY SETTINGS
     ========================================================== */

  applySettings() {

    this.saveSettings();

    const status =
      document.getElementById(
        "qlabSettingsStatus"
      );

    if (status) {

      status.textContent =
        `Connecting to ${this.ip}:${this.bridgePort}…`;

    }

    this.connect(
      this.ip
    );

  },


  /* ==========================================================
     CONNECT
     ========================================================== */

  connect(ip = null) {

    if (ip !== null) {
      this.ip = String(ip);
    }

    this.stopWatcher();

    if (this.ws) {

      try {
        this.ws.close();
      } catch {}

      this.ws = null;

    }

    const url =
      `ws://${this.ip}:${this.bridgePort}`;

    console.log(
      "QLab bridge connecting:",
      url
    );

    try {

      this.ws =
        new WebSocket(url);

    } catch (error) {

      console.error(
        "QLab WebSocket error:",
        error
      );

      this.scheduleReconnect();

      return false;

    }


    this.ws.onopen = () => {

      this.connected = true;

      console.log(
        "✅ QLAB BRIDGE CONNECTED"
      );

      this.updateStatus(true);


      if (this.passcode) {

        this.send({
          type: "auth",
          passcode: this.passcode
        });

      }


      this.send({
        type: "subscribe"
      });


      this.syncCues();

      this.sendTimeTriggers();

      this.startWatcher();


      if (
        typeof log === "function"
      ) {

        log(
          "🎵 QLab connected — automatic cue tracking ACTIVE"
        );

      }

    };


    this.ws.onmessage = event => {

      try {

        const message =
          JSON.parse(
            event.data
          );

        console.log(
          "QLab message:",
          message
        );

        this.handleMessage(
          message
        );

      } catch (error) {

        console.error(
          "QLab message error:",
          error,
          event.data
        );

      }

    };


    this.ws.onerror = error => {

      console.error(
        "QLab bridge error:",
        error
      );

    };


    this.ws.onclose = () => {

      this.connected = false;

      this.stopWatcher();

      this.updateStatus(false);

      console.warn(
        "QLab bridge disconnected"
      );

      this.scheduleReconnect();

    };


    return true;

  },


  /* ==========================================================
     RECONNECT
     ========================================================== */

  scheduleReconnect() {

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer = null;

          if (!this.connected) {
            this.connect(this.ip);
          }

        },
        2000
      );

  },


  /* ==========================================================
     STATUS
     ========================================================== */

  updateStatus(connected) {

    if (
      typeof window.updateQLabStatus ===
      "function"
    ) {

      window.updateQLabStatus(

        connected
          ? `Connected — ${this.ip}:${this.bridgePort}`
          : "Disconnected — retrying…",

        connected

      );

    }

    const status =
      document.getElementById(
        "qlabSettingsStatus"
      );

    if (status) {

      status.textContent =
        connected
          ? `Connected to ${this.ip}:${this.bridgePort}`
          : `Disconnected — retrying ${this.ip}:${this.bridgePort}`;

    }

  },


  /* ==========================================================
     SEND
     ========================================================== */

  send(message) {

    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {

      console.warn(
        "⚠️ QLab bridge is not connected:",
        message
      );

      return false;

    }

    try {

      this.ws.send(
        JSON.stringify(message)
      );

      return true;

    } catch (error) {

      console.error(
        "QLab send error:",
        error
      );

      return false;

    }

  },


  /* ==========================================================
     OSC COMMAND
     ========================================================== */

  command(address, ...args) {

    console.log(
      "🎛 QLab command:",
      address,
      args
    );

    return this.send({
      type: "osc",
      address,
      args
    });

  },


  /* ==========================================================
     QLAB CONTROLS
     ========================================================== */

  syncCues() {

    return this.send({
      type: "sync-cues"
    });

  },


  /* ==========================================================
     NORMAL QLAB GO
     ========================================================== */

  go() {

    console.log(
      "▶ QLAB GO"
    );

    return this.command(
      "/go"
    );

  },


  /* ==========================================================
     LIGHTING CONSOLE → QLAB GO
     ----------------------------------------------------------
     THIS IS THE IMPORTANT NEW FUNCTION.
     
     Your lighting console GO button can call:

         QLab.goFromLightingConsole()

     It sends /go to QLab.

     QLab then reports its new active cue through the bridge,
     and the normal 250ms tracking continues.
     ========================================================== */

  goFromLightingConsole() {

    console.log(
      "💡▶ LIGHTING CONSOLE → QLAB GO"
    );


    if (!this.connected) {

      console.warn(
        "⚠️ Cannot GO QLab — bridge is disconnected"
      );

      if (
        typeof log === "function"
      ) {

        log(
          "⚠️ QLab GO failed — bridge disconnected"
        );

      }

      return false;

    }


    const result =
      this.command(
        "/go"
      );


    if (result) {

      console.log(
        "✅ QLab GO sent from lighting console"
      );


      if (
        typeof log === "function"
      ) {

        log(
          "▶ QLab GO"
        );

      }

    }


    return result;

  },


  /* ==========================================================
     ALIAS
     ----------------------------------------------------------
     Also exposes simple global-style naming.
     ========================================================== */

  lightingGo() {

    return this.goFromLightingConsole();

  },


  qlabGo() {

    return this.goFromLightingConsole();

  },


  /* ==========================================================
     STOP
     ========================================================== */

  stop() {

    const result =
      this.command(
        "/stop"
      );

    this.resetTracking();

    return result;

  },


  /* ==========================================================
     PAUSE
     ========================================================== */

  pause() {

    return this.command(
      "/pause"
    );

  },


  /* ==========================================================
     RESUME
     ========================================================== */

  resume() {

    return this.command(
      "/resume"
    );

  },


  /* ==========================================================
     CUE
     ========================================================== */

  cue(number) {

    return this.goTo(
      number
    );

  },


  /* ==========================================================
     GO TO CUE
     ========================================================== */

  goTo(number) {

    number =
      String(number ?? "").trim();

    if (!number) {
      return false;
    }

    console.log(
      `▶ QLAB GO TO CUE ${number}`
    );

    return this.command(
      `/cue/${number}/go`
    );

  },


  /* ==========================================================
     STOP CUE
     ========================================================== */

  cueStop(number) {

    number =
      String(number ?? "").trim();

    if (!number) {
      return false;
    }

    return this.command(
      `/cue/${number}/stop`
    );

  },


  /* ==========================================================
     PANIC
     ========================================================== */

  panic() {

    const result =
      this.command(
        "/panic"
      );

    this.resetTracking();

    return result;

  },


  /* ==========================================================
     WATCHER
     ========================================================== */

  startWatcher() {

    this.stopWatcher();

    console.log(
      "⏱ Starting QLab 250ms watcher"
    );

    this.watcher =
      setInterval(
        () => {

          this.pollQLab();

        },
        250
      );

    this.pollQLab();

  },


  /* ==========================================================
     STOP WATCHER
     ========================================================== */

  stopWatcher() {

    if (this.watcher) {

      clearInterval(
        this.watcher
      );

      this.watcher = null;

    }

  },


  /* ==========================================================
     POLL QLAB
     ========================================================== */

  pollQLab() {

    if (!this.connected) {
      return;
    }


    /*
     * ALWAYS ask QLab which cue is currently playing.
     *
     * This means the browser does NOT depend on someone
     * clicking the QLab computer.
     */

    this.command(
      "/playbackPosition"
    );


    /*
     * If we already know the active cue,
     * ask for its current playback time.
     */

    if (this.activeCue) {

      this.requestCurrentTime();

    }

  },


  /* ==========================================================
     REQUEST CURRENT FILE TIME
     ========================================================== */

  requestCurrentTime() {

    if (
      !this.connected ||
      !this.activeCue
    ) {

      return;

    }


    const cue =
      String(
        this.activeCue
      ).trim();


    if (!cue) {
      return;
    }


    this.command(
      `/cue/${cue}/currentFileTime`
    );

  },


  /* ==========================================================
     MESSAGE HANDLER
     ========================================================== */

  handleMessage(message) {

    if (!message) {
      return;
    }


    /* --------------------------------------------------------
       CURRENT TIME
       -------------------------------------------------------- */

    if (
      message.type === "qlab-time"
    ) {

      this.handleCurrentTime(
        message.cueNumber,
        message.elapsed
      );

      return;

    }


    /* --------------------------------------------------------
       TIMED LIGHTING TRIGGER
       -------------------------------------------------------- */

    if (
      message.type ===
      "qlab-lighting-trigger"
    ) {

      const lights =
        Array.isArray(
          message.lights
        )
          ? message.lights
          : [];


      lights.forEach(
        light => {

          this.fireLightingCue(
            light,
            `QLab ${message.cueNumber} reached ${message.triggerTime}s`
          );

        }
      );


      return;

    }


    /* --------------------------------------------------------
       BRIDGE STATUS
       -------------------------------------------------------- */

    if (
      message.type === "status"
    ) {

      this.connected =
        !!message.connected;

      return;

    }


    /* --------------------------------------------------------
       WORKSPACE
       -------------------------------------------------------- */

    if (
      message.type === "qlab-workspace"
    ) {

      this.workspaceId =
        message.workspaceId;

      return;

    }


    /* --------------------------------------------------------
       CUE LIST
       -------------------------------------------------------- */

    if (
      message.type === "qlab-cues"
    ) {

      this.loadCues(
        message.cues
      );

      return;

    }


    /* --------------------------------------------------------
       CUE START
       -------------------------------------------------------- */

    if (
      message.type === "qlab-cue-start"
    ) {

      const cue =
        this.resolveCueNumber(
          message.cueNumber ??
          message.number ??
          message.cue
        );


      if (cue) {

        this.startAudio(
          cue
        );

      }

      return;

    }


    /* --------------------------------------------------------
       CUE STOP
       -------------------------------------------------------- */

    if (
      message.type === "qlab-cue-stop"
    ) {

      console.log(
        "⏹ QLab cue stopped"
      );

      this.resetTracking();

      return;

    }


    /* --------------------------------------------------------
       RAW OSC
       -------------------------------------------------------- */

    if (
      message.type === "osc"
    ) {

      this.handleOSC(
        message.address,
        message.args
      );

      return;

    }


    /* --------------------------------------------------------
       OLD FORMAT SUPPORT
       -------------------------------------------------------- */

    if (message.address) {

      this.handleOSC(
        message.address,
        message.args ??
        message.arguments ??
        []
      );

    }

  },


  /* ==========================================================
     OSC HANDLER
     ========================================================== */

  handleOSC(address, args) {

    address =
      String(
        address || ""
      );


    if (!Array.isArray(args)) {

      args =
        args === undefined
          ? []
          : [args];

    }


    /* --------------------------------------------------------
       CUE LIST
       -------------------------------------------------------- */

    if (
      address.endsWith(
        "/cueLists"
      )
    ) {

      this.loadCues(
        this.extractValue(args)
      );

      return;

    }


    /* --------------------------------------------------------
       PLAYBACK POSITION
       -------------------------------------------------------- */

    if (
      address === "/playbackPosition" ||
      address.endsWith("/playbackPosition")
    ) {

      this.handlePlaybackPosition(
        args
      );

      return;

    }


    /* --------------------------------------------------------
       CURRENT FILE TIME
       -------------------------------------------------------- */

    const timeMatch =
      address.match(
        /\/cue\/([^/]+)\/currentFileTime$/
      );


    if (timeMatch) {

      const elapsed =
        this.extractNumber(
          args
        );


      if (elapsed !== null) {

        this.handleCurrentTime(
          this.cleanCueIdentifier(
            timeMatch[1]
          ),
          elapsed
        );

      }

      return;

    }


    /* --------------------------------------------------------
       ACTION ELAPSED
       -------------------------------------------------------- */

    const actionMatch =
      address.match(
        /\/cue\/([^/]+)\/actionElapsed$/
      );


    if (actionMatch) {

      const elapsed =
        this.extractNumber(
          args
        );


      if (elapsed !== null) {

        this.handleCurrentTime(
          this.cleanCueIdentifier(
            actionMatch[1]
          ),
          elapsed
        );

      }

      return;

    }


    /* --------------------------------------------------------
       CUE START
       -------------------------------------------------------- */

    const startMatch =
      address.match(
        /\/cue\/([^/]+)\/start$/
      );


    if (startMatch) {

      const cue =
        this.resolveCueNumber(
          this.cleanCueIdentifier(
            startMatch[1]
          )
        );


      if (cue) {

        this.startAudio(
          cue
        );

      }

      return;

    }


    /* --------------------------------------------------------
       CUE STOP
       -------------------------------------------------------- */

    const stopMatch =
      address.match(
        /\/cue\/([^/]+)\/stop$/
      );


    if (stopMatch) {

      const stoppedCue =
        this.cleanCueIdentifier(
          stopMatch[1]
        );


      if (
        String(this.activeCue) ===
        String(stoppedCue)
      ) {

        this.resetTracking();

      }

      return;

    }

  },


  /* ==========================================================
     PLAYBACK POSITION
     ========================================================== */

  handlePlaybackPosition(args) {

    const value =
      this.extractValue(
        args
      );


    /*
     * QLab has nothing playing.
     */

    if (
      this.isNothingPlaying(
        value
      )
    ) {

      if (this.activeCue) {

        this.resetTracking();

      }

      return;

    }


    /*
     * Find the active cue.
     */

    const cueNumber =
      this.resolveCueNumber(
        value
      ) ||
      this.findCueNumberDeep(
        value
      );


    if (!cueNumber) {

      console.warn(
        "Could not resolve QLab playback position:",
        value
      );

      return;

    }


    /*
     * New cue detected.
     */

    if (
      String(this.activeCue) !==
      String(cueNumber)
    ) {

      this.startAudio(
        cueNumber
      );

    }


    /*
     * Keep asking for current time.
     */

    this.requestCurrentTime();

  },


  /* ==========================================================
     NOTHING PLAYING
     ========================================================== */

  isNothingPlaying(value) {

    if (
      value === null ||
      value === undefined
    ) {

      return true;

    }


    if (
      typeof value === "string"
    ) {

      const s =
        value
          .trim()
          .toLowerCase();


      return (
        !s ||
        s === "none" ||
        s === "null" ||
        s === "false" ||
        s === "0"
      );

    }


    return false;

  },


  /* ==========================================================
     START AUDIO
     ========================================================== */

  startAudio(cueNumber) {

    cueNumber =
      String(
        cueNumber ?? ""
      ).trim();


    if (!cueNumber) {
      return;
    }


    const resolved =
      this.resolveCueNumber(
        cueNumber
      );


    if (resolved) {

      cueNumber =
        resolved;

    }


    const changed =
      String(this.activeCue) !==
      String(cueNumber);


    if (changed) {

      console.log(
        `🎵 ACTIVE QLAB CUE → ${cueNumber}`
      );


      this.activeCue =
        cueNumber;


      this.activeElapsed =
        0;


      this.lastCue =
        cueNumber;


      this.lastElapsed =
        -1;


      this.firedTriggers.clear();


      this.renderCueSync();


      if (
        typeof log === "function"
      ) {

        log(
          `🎵 QLab Audio Cue ${cueNumber} started`
        );

      }

    }


    this.requestCurrentTime();

  },


  /* ==========================================================
     CURRENT TIME
     ========================================================== */

  handleCurrentTime(
    cueNumber,
    elapsed
  ) {

    cueNumber =
      String(
        cueNumber ?? ""
      ).trim();


    elapsed =
      Number(
        elapsed
      );


    if (
      !Number.isFinite(
        elapsed
      )
    ) {

      return;

    }


    const resolved =
      this.resolveCueNumber(
        cueNumber
      );


    if (resolved) {

      cueNumber =
        resolved;

    }


    if (!this.activeCue) {

      this.startAudio(
        cueNumber
      );

    }


    if (
      this.activeCue &&
      String(cueNumber) !==
      String(this.activeCue)
    ) {

      return;

    }


    /*
     * If playback jumps backwards,
     * allow lighting triggers to fire again.
     */

    if (
      this.lastElapsed >= 0 &&
      elapsed <
      this.lastElapsed - 0.25
    ) {

      this.firedTriggers.clear();

    }


    this.activeCue =
      cueNumber;


    this.activeElapsed =
      elapsed;


    this.lastElapsed =
      elapsed;


    this.checkTimedLighting(
      cueNumber,
      elapsed
    );


    this.renderCueSync();

  },


  /* ==========================================================
     TIMED LIGHTING
     ========================================================== */

  checkTimedLighting(
    cueNumber,
    elapsed
  ) {

    const q =
      String(
        cueNumber
      );


    const triggers =
      this.timeTriggers[q] ||
      [];


    if (!triggers.length) {
      return;
    }


    triggers.forEach(
      (
        trigger,
        index
      ) => {

        const triggerTime =
          Number(
            trigger.time
          );


        if (
          !Number.isFinite(
            triggerTime
          )
        ) {

          return;

        }


        const key =
          `${q}:${index}`;


        if (
          elapsed >= triggerTime &&
          !this.firedTriggers.has(key)
        ) {

          this.firedTriggers.add(
            key
          );


          const lights =
            Array.isArray(
              trigger.lights
            )
              ? trigger.lights
              : [];


          console.log(
            `💡 TIME TRIGGER — QLab ${q} @ ${triggerTime}s`,
            lights
          );


          lights.forEach(
            lightingCue => {

              this.fireLightingCue(
                lightingCue,
                `QLab ${q} reached ${triggerTime.toFixed(2)}s`
              );

            }
          );

        }

      }
    );

  },


  /* ==========================================================
     FIRE LIGHTING CUE
     ========================================================== */

  fireLightingCue(
    number,
    reason = ""
  ) {

    const n =
      parseInt(
        number,
        10
      );


    if (
      !Number.isInteger(n) ||
      n < 1
    ) {

      console.warn(
        "Invalid lighting cue:",
        number
      );

      return;

    }


    console.log(
      `💡 FIRE LIGHTING CUE ${n}`,
      reason
    );


    if (
      typeof window.goToCue ===
      "function"
    ) {

      /*
       * Lighting console is zero based.
       */

      window.goToCue(
        n - 1
      );

    } else {

      console.error(
        "❌ goToCue() does not exist"
      );

      return;

    }


    if (
      typeof log === "function"
    ) {

      log(
        `💡 Lighting Cue ${n} — ${reason}`
      );

    }

  },


  /* ==========================================================
     EXTRACT NUMBER
     ========================================================== */

  extractNumber(args) {

    if (!Array.isArray(args)) {
      args = [args];
    }


    for (
      const value of args
    ) {

      if (
        typeof value === "number" &&
        Number.isFinite(value)
      ) {

        return value;

      }


      if (
        typeof value === "string" &&
        value.trim()
      ) {

        const n =
          Number(
            value
          );


        if (
          Number.isFinite(n)
        ) {

          return n;

        }


        try {

          const parsed =
            JSON.parse(
              value
            );


          const nested =
            this.extractNumber(
              [parsed]
            );


          if (
            nested !== null
          ) {

            return nested;

          }

        } catch {}

      }


      if (
        value &&
        typeof value === "object"
      ) {

        const candidates = [
          value.data,
          value.value,
          value.elapsed,
          value.currentFileTime,
          value.actionElapsed,
          value.time
        ];


        for (
          const candidate of candidates
        ) {

          const n =
            Number(
              candidate
            );


          if (
            Number.isFinite(n)
          ) {

            return n;

          }

        }

      }

    }


    return null;

  },


  /* ==========================================================
     EXTRACT VALUE
     ========================================================== */

  extractValue(args) {

    if (
      !Array.isArray(args)
    ) {

      return args;

    }


    if (
      !args.length
    ) {

      return null;

    }


    if (
      args.length === 1
    ) {

      const value =
        args[0];


      if (
        typeof value === "string"
      ) {

        try {

          return JSON.parse(
            value
          );

        } catch {

          return value;

        }

      }


      return value;

    }


    return args;

  },


  /* ==========================================================
     RESOLVE CUE NUMBER
     ========================================================== */

  resolveCueNumber(value) {

    if (
      value === null ||
      value === undefined
    ) {

      return null;

    }


    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {

      let s =
        String(
          value
        ).trim();


      if (
        !s ||
        s === "[object Object]"
      ) {

        return null;

      }


      const pathMatch =
        s.match(
          /\/cue\/([^/]+)/
        );


      if (pathMatch) {

        s =
          pathMatch[1];

      }


      const direct =
        this.cues.find(
          cue =>
            String(
              cue.number ??
              cue.cueNumber ??
              ""
            ) === s
        );


      if (direct) {

        return String(
          direct.number ??
          direct.cueNumber
        );

      }


      const byId =
        this.cues.find(
          cue =>
            String(
              cue.uniqueID ??
              ""
            ) === s
        );


      if (byId) {

        return String(
          byId.number
        );

      }


      const byOtherId =
        this.cues.find(
          cue =>
            String(
              cue.id ??
              ""
            ) === s ||
            String(
              cue.uniqueId ??
              ""
            ) === s
        );


      if (byOtherId) {

        return String(
          byOtherId.number
        );

      }


      if (
        /^\d+(?:\.\d+)?$/.test(s)
      ) {

        return s;

      }


      return null;

    }


    if (
      value &&
      typeof value === "object"
    ) {

      const candidates = [
        value.number,
        value.cueNumber,
        value.cue,
        value.uniqueID,
        value.uniqueId,
        value.id,
        value.data,
        value.value
      ];


      for (
        const candidate of candidates
      ) {

        const result =
          this.resolveCueNumber(
            candidate
          );


        if (result) {

          return result;

        }

      }

    }


    return null;

  },


  /* ==========================================================
     DEEP CUE SEARCH
     ========================================================== */

  findCueNumberDeep(value) {

    if (
      value === null ||
      value === undefined
    ) {

      return null;

    }


    const direct =
      this.resolveCueNumber(
        value
      );


    if (direct) {

      return direct;

    }


    if (
      Array.isArray(value)
    ) {

      for (
        const item of value
      ) {

        const result =
          this.findCueNumberDeep(
            item
          );


        if (result) {

          return result;

        }

      }

    }


    if (
      typeof value === "object"
    ) {

      for (
        const item of Object.values(value)
      ) {

        const result =
          this.findCueNumberDeep(
            item
          );


        if (result) {

          return result;

        }

      }

    }


    return null;

  },


  /* ==========================================================
     CLEAN CUE IDENTIFIER
     ========================================================== */

  cleanCueIdentifier(value) {

    const s =
      String(
        value ?? ""
      ).trim();


    if (!s) {
      return "";
    }


    const match =
      s.match(
        /\/cue\/([^/]+)/
      );


    return match
      ? match[1]
      : s;

  },


  /* ==========================================================
     LOAD CUES
     ========================================================== */

  loadCues(data) {

    if (
      typeof data === "string"
    ) {

      try {

        data =
          JSON.parse(
            data
          );

      } catch {

        console.warn(
          "Could not parse cue list:",
          data
        );

        return;

      }

    }


    const result = [];
    const seen = new Set();


    const addCue =
      cue => {

        if (
          !cue ||
          typeof cue !== "object"
        ) {

          return;

        }


        const number =
          cue.number ??
          cue.cueNumber;


        const uniqueID =
          cue.uniqueID ??
          cue.uniqueId ??
          cue.id;


        if (
          number !== undefined ||
          uniqueID !== undefined
        ) {

          const identity =
            String(
              uniqueID ??
              number
            );


          if (
            !seen.has(
              identity
            )
          ) {

            seen.add(
              identity
            );


            result.push(
              cue
            );

          }

        }


        [
          cue.cues,
          cue.children,
          cue.cueList
        ].forEach(
          child => {

            if (
              Array.isArray(child)
            ) {

              child.forEach(
                addCue
              );

            }

          }
        );

      };


    const walk =
      value => {

        if (
          Array.isArray(value)
        ) {

          value.forEach(
            walk
          );

          return;

        }


        if (
          value &&
          typeof value === "object"
        ) {

          addCue(
            value
          );


          Object.values(value)
            .forEach(
              child => {

                if (
                  child &&
                  typeof child ===
                    "object"
                ) {

                  walk(
                    child
                  );

                }

              }
            );

        }

      };


    walk(
      data
    );


    this.cues =
      result;


    console.log(
      `🎼 Loaded ${this.cues.length} QLab cues`,
      this.cues
    );


    this.renderCueSync();
    this.renderLinkEditor();

  },


  /* ==========================================================
     RESET
     ========================================================== */

  resetTracking() {

    this.activeCue = null;

    this.activeElapsed = 0;

    this.lastCue = null;

    this.lastElapsed = -1;

    this.firedTriggers.clear();

    this.renderCueSync();

  },


  /* ==========================================================
     TIMING CONFIG
     ========================================================== */

  sendTimeTriggers() {

    return this.send({
      type:
        "set-time-triggers",

      triggers:
        this.timeTriggers
    });

  },


  /* ==========================================================
     ADD TIME TRIGGER
     ========================================================== */

  addTimeTrigger(q) {

    q =
      String(q);


    if (
      !this.timeTriggers[q]
    ) {

      this.timeTriggers[q] = [];

    }


    this.timeTriggers[q].push({
      time: 5,
      lights: []
    });


    this.saveStoredLinks();

    this.renderLinkEditor();

  },


  /* ==========================================================
     REMOVE TIME TRIGGER
     ========================================================== */

  removeTimeTrigger(
    q,
    index
  ) {

    q =
      String(q);


    if (
      !this.timeTriggers[q]
    ) {

      return;

    }


    this.timeTriggers[q].splice(
      index,
      1
    );


    if (
      !this.timeTriggers[q].length
    ) {

      delete this.timeTriggers[q];

    }


    this.firedTriggers.clear();

    this.saveStoredLinks();

    this.sendTimeTriggers();

    this.renderLinkEditor();

  },


  /* ==========================================================
     SAVE LINKS
     ========================================================== */

  saveAllLinks() {

    document
      .querySelectorAll(
        "#linkEditorList [data-immediate]"
      )
      .forEach(
        input => {

          const q =
            input.dataset.immediate;


          const numbers =
            input.value
              .split(",")
              .map(
                x =>
                  parseInt(
                    x.trim(),
                    10
                  )
              )
              .filter(
                Number.isInteger
              );


          if (
            numbers.length
          ) {

            this.cueLinks[q] =
              numbers;

          } else {

            delete this.cueLinks[q];

          }

        }
      );


    const next = {};


    document
      .querySelectorAll(
        "#linkEditorList [data-time]"
      )
      .forEach(
        input => {

          const q =
            input.dataset.time;


          const index =
            Number(
              input.dataset.index
            );


          const time =
            Number(
              input.value
            );


          const lightInput =
            document.querySelector(
              `#linkEditorList [data-light="${q}"][data-index="${index}"]`
            );


          const light =
            Number(
              lightInput?.value
            );


          if (
            Number.isFinite(time) &&
            time >= 0 &&
            Number.isInteger(light) &&
            light > 0
          ) {

            if (!next[q]) {

              next[q] = [];

            }


            next[q].push({
              time,
              lights: [light]
            });

          }

        }
      );


    Object.keys(next)
      .forEach(
        q => {

          next[q].sort(
            (a, b) =>
              Number(a.time) -
              Number(b.time)
          );

        }
      );


    this.timeTriggers =
      next;


    this.saveStoredLinks();

    this.firedTriggers.clear();

    this.sendTimeTriggers();

    this.renderLinkEditor();

    this.renderCueSync();

  },


  /* ==========================================================
     STORAGE
     ========================================================== */

  saveStoredLinks() {

    localStorage.setItem(
      "qlabCueLinks",
      JSON.stringify(
        this.cueLinks
      )
    );


    localStorage.setItem(
      "qlabTimeTriggers",
      JSON.stringify(
        this.timeTriggers
      )
    );

  },


  /* ==========================================================
     CLEAR LINKS
     ========================================================== */

  clearAllLinks() {

    this.cueLinks = {};

    this.timeTriggers = {};

    this.firedTriggers.clear();


    localStorage.removeItem(
      "qlabCueLinks"
    );


    localStorage.removeItem(
      "qlabTimeTriggers"
    );


    this.sendTimeTriggers();

    this.renderLinkEditor();

    this.renderCueSync();

  },


  /* ==========================================================
     ADD NEW LINK
     ========================================================== */

  addNewLinkRow() {

    const q =
      prompt(
        "QLab audio cue number:"
      );


    if (
      q === null ||
      !String(q).trim()
    ) {

      return;

    }


    const number =
      String(
        q
      ).trim();


    if (
      !this.cues.some(
        cue =>
          String(
            cue.number
          ) === number
      )
    ) {

      this.cues.push({
        number,
        name: "Audio Cue",
        type: "audio"
      });

    }


    this.renderLinkEditor();

  },


  /* ==========================================================
     LINK EDITOR
     ========================================================== */

  renderLinkEditor() {

    const box =
      document.getElementById(
        "linkEditorList"
      );


    if (!box) {
      return;
    }


    box.innerHTML = "";


    this.cues.forEach(
      cue => {

        const q =
          String(
            cue.number ??
            ""
          ).trim();


        if (!q) {
          return;
        }


        const immediate =
          (
            this.cueLinks[q] ||
            []
          ).join(", ");


        const triggers =
          this.timeTriggers[q] ||
          [];


        const row =
          document.createElement(
            "div"
          );


        row.className =
          "link-panel";


        row.innerHTML = `

          <b>
            QLab ${this.escapeHTML(q)}
          </b>

          <input
            class="link-input"
            data-immediate="${this.escapeHTML(q)}"
            value="${this.escapeHTML(immediate)}"
            placeholder="1,2,3"
            style="width:120px"
          >

          <button
            class="btn-secondary link-btn"
            onclick="QLab.addTimeTrigger('${this.escapeHTML(q)}')"
          >
            + Add Lighting Cue
          </button>

          <div
            style="
              font-size:10px;
              color:#777;
              margin:6px 0;
            "
          >
            Timed lighting cues:
          </div>

          <div
            data-triggers="${this.escapeHTML(q)}"
          ></div>

        `;


        box.appendChild(
          row
        );


        const list =
          row.querySelector(
            `[data-triggers="${CSS.escape(q)}"]`
          );


        triggers.forEach(
          (
            trigger,
            index
          ) => {

            const r =
              document.createElement(
                "div"
              );


            r.className =
              "link-row";


            r.innerHTML = `

              <span>
                At
              </span>

              <input
                type="number"
                class="link-input"
                data-time="${this.escapeHTML(q)}"
                data-index="${index}"
                value="${Number(trigger.time) || 0}"
                step="0.01
                min="0"
              >

              <span>
                sec → Lighting Cue
              </span>

              <input
                type="number"
                class="link-input"
                data-light="${this.escapeHTML(q)}"
                data-index="${index}"
                value="${
                  (trigger.lights || [])[0] || ""
                }"
                min="1"
              >

              <button
                class="btn-secondary link-btn"
                onclick="
                  QLab.removeTimeTrigger(
                    '${this.escapeHTML(q)}',
                    ${index}
                  )
                "
              >
                ✕
              </button>

            `;


            if (list) {

              list.appendChild(
                r
              );

            }

          }
        );

      }
    );

  },


  /* ==========================================================
     CUE DISPLAY
     ========================================================== */

  renderCueSync() {

    const box =
      document.getElementById(
        "qlabSyncList"
      );


    if (!box) {
      return;
    }


    box.innerHTML = "";


    if (
      !this.cues.length
    ) {

      box.innerHTML = `

        <div
          style="
            padding:15px;
            color:#aaa;
            text-align:center;
          "
        >
          No QLab cues found.
        </div>

      `;

      return;

    }


    this.cues.forEach(
      cue => {

        const q =
          String(
            cue.number ??
            ""
          );


        if (!q) {
          return;
        }


        const triggers =
          this.timeTriggers[q] ||
          [];


        const active =
          q ===
          String(
            this.activeCue
          );


        const label =
          triggers.length
            ? triggers
                .map(
                  x =>
                    `⏰ ${x.time}s → Light ${
                      (x.lights || [])[0] || "?"
                    }`
                )
                .join(" | ")
            : "⚡ Not linked";


        const row =
          document.createElement(
            "div"
          );


        row.style = `

          padding:10px;
          margin:4px 0;

          background:${
            active
              ? "#1a3a2a"
              : "#2a2a3a"
          };

          border-left:3px solid ${
            active
              ? "#0f6"
              : "#444"
          };

          border-radius:6px;

          display:flex;
          gap:10px;
          align-items:center;

        `;


        row.innerHTML = `

          <b>
            ${this.escapeHTML(q)}
          </b>

          <span style="flex:1">

            ${this.escapeHTML(
              cue.name ||
              cue.displayName ||
              cue.type ||
              cue.cueType ||
              "Unnamed"
            )}

          </span>

          <span
            style="
              font-size:12px;
              min-width:160px;
            "
          >
            ${label}
          </span>

          ${
            active
              ? `
                <span
                  style="
                    font-size:11px;
                    color:#0f6;
                  "
                >
                  ▶ ${this.activeElapsed.toFixed(2)}s
                </span>
              `
              : ""
          }

          <button
            class="btn-secondary"
            onclick="
              QLab.goTo('${this.escapeHTML(q)}')
            "
          >
            ▶ GO
          </button>

        `;


        box.appendChild(
          row
        );

      }
    );

  }

};


/* ============================================================
   GLOBAL QLAB GO FUNCTIONS
   ------------------------------------------------------------
   These make it easy for ANY existing lighting-console button
   to trigger QLab without rewriting the whole lighting system.

   Examples:

       onclick="QLab.goFromLightingConsole()"

   or:

       onclick="window.QLabGO()"

   or JavaScript:

       QLabGO()
   ============================================================ */

window.QLabGO =
  function() {

    return window.QLab
      .goFromLightingConsole();

  };


window.qlabGo =
  function() {

    return window.QLab
      .goFromLightingConsole();

  };


window.goQLab =
  function() {

    return window.QLab
      .goFromLightingConsole();

  };


window.lightingConsoleQLabGo =
  function() {

    return window.QLab
      .goFromLightingConsole();

  };


/* ============================================================
   LOAD SAVED CONNECTION SETTINGS
   ============================================================ */

QLab.loadSettings();


/* ============================================================
   LOAD SAVED LINKS
   ============================================================ */

try {

  QLab.cueLinks =
    JSON.parse(
      localStorage.getItem(
        "qlabCueLinks"
      ) || "{}"
    );


  QLab.timeTriggers =
    JSON.parse(
      localStorage.getItem(
        "qlabTimeTriggers"
      ) || "{}"
    );

} catch {

  QLab.cueLinks = {};

  QLab.timeTriggers = {};

}


/* ============================================================
   QLAB — CONSTANT DURATION CHECK
   ============================================================ */

let qlabDuration = 0;


function updateQLabDuration() {

  try {

    const media =
      document.querySelector(
        "audio"
      ) ||
      document.querySelector(
        "video"
      );


    if (
      media &&
      Number.isFinite(
        media.duration
      ) &&
      media.duration > 0
    ) {

      qlabDuration =
        media.duration;

    }


    const durationEl =
      document.getElementById(
        "qlabDuration"
      );


    if (
      durationEl &&
      qlabDuration > 0
    ) {

      durationEl.textContent =
        formatQLabTime(
          qlabDuration
        );

    }

  } catch (err) {

    console.warn(
      "QLab duration check failed:",
      err
    );

  }

}


function formatQLabTime(
  seconds
) {

  seconds =
    Math.max(
      0,
      Number(seconds) || 0
    );


  const mins =
    Math.floor(
      seconds / 60
    );


  const secs =
    Math.floor(
      seconds % 60
    );


  return `${
    String(mins)
      .padStart(2, "0")
  }:${
    String(secs)
      .padStart(2, "0")
  }`;

}


/* ============================================================
   DURATION WATCHER
   ============================================================ */

setInterval(
  updateQLabDuration,
  250
);


/* ============================================================
   IMMEDIATE DURATION CHECK
   ============================================================ */

updateQLabDuration();


/* ============================================================
   OPTIONAL AUTOMATIC QLAB GO BUTTON HOOKS
   ------------------------------------------------------------
   If your HTML already has one of these IDs, clicking it will
   automatically send GO to QLab:

       #qlabGoButton
       #qlabGOButton
       #lightingQLabGo
       #lightingConsoleQLabGo
       #goQLab

   This does NOT interfere with normal lighting GO behaviour.
   ============================================================ */

function installQLabGoButtonHooks() {

  const selectors = [
    "#qlabGoButton",
    "#qlabGOButton",
    "#lightingQLabGo",
    "#lightingConsoleQLabGo",
    "#goQLab",
    "[data-qlab-go]"
  ];


  selectors.forEach(
    selector => {

      document
        .querySelectorAll(
          selector
        )
        .forEach(
          button => {

            if (
              button.dataset.qlabGoHooked ===
              "true"
            ) {

              return;

            }


            button.dataset.qlabGoHooked =
              "true";


            button.addEventListener(
              "click",
              () => {

                console.log(
                  "💡▶ Lighting console QLab GO button clicked"
                );


                QLab.goFromLightingConsole();

              }
            );

          }
        );

    }
  );

}


/* ============================================================
   START
   ============================================================ */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    console.log(
      "QLab controller starting..."
    );


    QLab.renderSettings();


    QLab.connect(
      QLab.ip
    );


    /*
     * Give the rest of the lighting console UI a moment to
     * finish rendering, then look for a QLab GO button.
     */

    installQLabGoButtonHooks();


    setTimeout(
      installQLabGoButtonHooks,
      500
    );


    setTimeout(
      installQLabGoButtonHooks,
      1500
    );

  }
);