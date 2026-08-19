// ============================================================
// QLAB 5 ↔ LIGHTING BRIDGE
// ============================================================
// ONE FILE DOES ALL QLAB WORK.
//
// Browser:
//   - displays cues
//   - sends commands
//   - sends timing links
//   - receives lighting trigger events
//
// Bridge:
//   - talks to QLab over OSC
//   - loads cue list
//   - finds active cue
//   - polls playback position every 250ms
//   - polls currentFileTime every 250ms
//   - checks timed lighting triggers
//
// IMPORTANT:
//   This is Node.js.
//   DO NOT use document, window, audio or video elements here.
//
// ============================================================

const WebSocket = require("ws");
const dgram = require("dgram");


// ============================================================
// CONFIG
// ============================================================

const QLAB_IP = "127.0.0.1";
const QLAB_PORT = 53000;
const QLAB_REPLY_PORT = 53001;

const QLAB_PASSWORD = "";

const WS_PORT = 8083;

// EXACTLY 250ms
const POLL_MS = 250;


// ============================================================
// NETWORK
// ============================================================

const udp = dgram.createSocket("udp4");

const wss =
  new WebSocket.Server({
    port: WS_PORT
  });

const clients = new Set();


// ============================================================
// STATE
// ============================================================

let cues = [];

let activeCue = null;

let activeCueObject = null;

let activeCueType = "";

let timeTriggers = {};

let firedTriggers = new Set();

let pollTimer = null;

let cueSyncTimer = null;


// ============================================================
// STARTUP
// ============================================================

console.log("");
console.log("==================================================");
console.log("🎵 QLAB 5 LIGHTING BRIDGE");
console.log("==================================================");
console.log(`QLab:       ${QLAB_IP}:${QLAB_PORT}`);
console.log(`Replies:    ${QLAB_IP}:${QLAB_REPLY_PORT}`);
console.log(`WebSocket:  ws://${QLAB_IP}:${WS_PORT}`);
console.log(`Polling:    ${POLL_MS}ms`);
console.log("==================================================");
console.log("");


// ============================================================
// OSC ENCODER
// ============================================================

function encodeString(value) {

  const raw =
    Buffer.from(
      `${value}\0`,
      "utf8"
    );

  const padding =
    (4 - (raw.length % 4)) % 4;

  return Buffer.concat([
    raw,
    Buffer.alloc(padding)
  ]);
}


function getTypeTag(value) {

  if (
    typeof value === "boolean"
  ) {
    return value ? "T" : "F";
  }

  if (
    Number.isInteger(value)
  ) {
    return "i";
  }

  if (
    typeof value === "number"
  ) {
    return "f";
  }

  return "s";
}


function encodeArgument(value) {

  if (
    typeof value === "boolean"
  ) {
    return Buffer.alloc(0);
  }


  if (
    Number.isInteger(value)
  ) {

    const buf =
      Buffer.alloc(4);

    buf.writeInt32BE(
      value
    );

    return buf;
  }


  if (
    typeof value === "number"
  ) {

    const buf =
      Buffer.alloc(4);

    buf.writeFloatBE(
      value
    );

    return buf;
  }


  return encodeString(
    String(value)
  );
}


function encodeOsc(
  address,
  args = []
) {

  const safeArgs =
    Array.isArray(args)
      ? args
      : [args];


  const tags =
    safeArgs
      .map(getTypeTag)
      .join("");


  return Buffer.concat([
    encodeString(address),
    encodeString(`,${tags}`),
    ...safeArgs.map(
      encodeArgument
    )
  ]);
}


// ============================================================
// OSC DECODER
// ============================================================

function decodeOscString(
  buffer,
  offset
) {

  let end = offset;


  while (
    end < buffer.length &&
    buffer[end] !== 0
  ) {

    end++;
  }


  const value =
    buffer.toString(
      "utf8",
      offset,
      end
    );


  const nextOffset =
    end +
    1 +
    (
      (4 - ((end + 1) % 4)) % 4
    );


  return {
    value,
    nextOffset
  };
}


function decodeOsc(buffer) {

  try {

    const address =
      decodeOscString(
        buffer,
        0
      );


    const tags =
      decodeOscString(
        buffer,
        address.nextOffset
      );


    const args = [];

    let offset =
      tags.nextOffset;


    if (
      !tags.value.startsWith(",")
    ) {

      return {
        address:
          address.value,

        args
      };
    }


    const typeTags =
      tags.value.slice(1);


    for (
      const tag of typeTags
    ) {

      // STRING
      if (tag === "s") {

        const value =
          decodeOscString(
            buffer,
            offset
          );


        args.push(
          value.value
        );


        offset =
          value.nextOffset;
      }


      // INTEGER
      else if (tag === "i") {

        if (
          offset + 4 >
          buffer.length
        ) {
          break;
        }


        args.push(
          buffer.readInt32BE(
            offset
          )
        );


        offset += 4;
      }


      // FLOAT
      else if (tag === "f") {

        if (
          offset + 4 >
          buffer.length
        ) {
          break;
        }


        args.push(
          buffer.readFloatBE(
            offset
          )
        );


        offset += 4;
      }


      // TRUE
      else if (tag === "T") {

        args.push(true);
      }


      // FALSE
      else if (tag === "F") {

        args.push(false);
      }


      // NULL
      else if (tag === "N") {

        args.push(null);
      }
    }


    return {
      address:
        address.value,

      args
    };

  }

  catch (error) {

    console.error(
      "❌ OSC decode error:",
      error
    );


    return {
      address: "",
      args: []
    };
  }
}


// ============================================================
// SEND OSC → QLAB
// ============================================================

function sendOsc(
  address,
  args = []
) {

  let safeArgs =
    Array.isArray(args)
      ? args
      : [args];


  if (
    QLAB_PASSWORD
  ) {

    safeArgs = [
      QLAB_PASSWORD,
      ...safeArgs
    ];
  }


  const packet =
    encodeOsc(
      address,
      safeArgs
    );


  udp.send(
    packet,
    0,
    packet.length,
    QLAB_PORT,
    QLAB_IP,
    error => {

      if (error) {

        console.error(
          "❌ QLab UDP send error:",
          error.message
        );
      }
    }
  );


  console.log(
    "📤 → QLab",
    address,
    safeArgs
  );
}


// ============================================================
// SEND MESSAGE → BROWSER
// ============================================================

function broadcast(message) {

  const payload =
    JSON.stringify(message);


  for (
    const ws of clients
  ) {

    if (
      ws.readyState ===
      WebSocket.OPEN
    ) {

      try {

        ws.send(payload);

      }

      catch (error) {

        console.error(
          "WebSocket send error:",
          error.message
        );
      }
    }
  }
}


// ============================================================
// PARSE QLAB 5 REPLY
// ============================================================
//
// QLab replies commonly look like:
//
// /reply/playbackPosition
// [
//   '{"status":"ok","data":"1",...}'
// ]
//
// This function unwraps that.
//
// ============================================================

function parseQLabReply(
  address,
  args
) {

  if (
    !String(address)
      .startsWith("/reply/")
  ) {

    return null;
  }


  if (
    !Array.isArray(args) ||
    !args.length
  ) {

    return null;
  }


  let value =
    args[0];


  if (
    typeof value === "string"
  ) {

    try {

      value =
        JSON.parse(value);

    }

    catch {

      return {
        status: "ok",
        data: value
      };
    }
  }


  if (
    value &&
    typeof value === "object"
  ) {

    return value;
  }


  return {
    status: "ok",
    data: value
  };
}


// ============================================================
// EXTRACT VALUE FROM QLAB REPLY
// ============================================================

function extractReplyData(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;
  }


  // Direct primitive

  if (
    typeof value !== "object"
  ) {

    return value;
  }


  // QLab wrapper

  if (
    Object.prototype.hasOwnProperty.call(
      value,
      "data"
    )
  ) {

    return value.data;
  }


  return value;
}


// ============================================================
// EXTRACT CUE NUMBER
// ============================================================

function extractCueNumber(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;
  }


  // NUMBER

  if (
    typeof value === "number"
  ) {

    if (
      Number.isFinite(value)
    ) {

      return String(value);
    }

    return null;
  }


  // STRING

  if (
    typeof value === "string"
  ) {

    const text =
      value.trim();


    if (
      !text ||
      text === "none" ||
      text === "null" ||
      text === "undefined"
    ) {

      return null;
    }


    return text;
  }


  // OBJECT

  if (
    typeof value === "object"
  ) {

    const possible =
      value.number ??
      value.cueNumber ??
      value.cue ??
      value.playbackPosition ??
      value.id ??
      value.data;


    if (
      possible !== undefined
    ) {

      return extractCueNumber(
        possible
      );
    }
  }


  return null;
}


// ============================================================
// FIND CUE
// ============================================================

function findCue(
  number
) {

  const wanted =
    String(number);


  return cues.find(
    cue =>
      String(
        cue?.number ??
        cue?.cueNumber ??
        ""
      ) === wanted
  );
}


// ============================================================
// FLATTEN CUE LIST
// ============================================================

function flattenCues(
  items,
  output = []
) {

  if (
    !Array.isArray(items)
  ) {

    return output;
  }


  for (
    const cue of items
  ) {

    if (!cue) {
      continue;
    }


    output.push(cue);


    if (
      Array.isArray(
        cue.cues
      )
    ) {

      flattenCues(
        cue.cues,
        output
      );
    }
  }


  return output;
}


// ============================================================
// LOAD CUES
// ============================================================

function loadCues(
  data
) {

  console.log(
    "📋 Raw cue-list data:",
    JSON.stringify(
      data
    ).slice(
      0,
      3000
    )
  );


  let list = [];


  // Direct array

  if (
    Array.isArray(data)
  ) {

    list = data;
  }


  // { cues: [...] }

  else if (
    data &&
    Array.isArray(
      data.cues
    )
  ) {

    list =
      data.cues;
  }


  // { cueLists: [...] }

  else if (
    data &&
    Array.isArray(
      data.cueLists
    )
  ) {

    list =
      data.cueLists;
  }


  // Sometimes nested under data

  else if (
    data &&
    data.data
  ) {

    return loadCues(
      data.data
    );
  }


  const flattened =
    flattenCues(
      list
    );


  cues =
    flattened;


  console.log(
    `🎼 Loaded ${cues.length} QLab cues`
  );


  broadcast({
    type:
      "qlab-cues",

    cues
  });
}


// ============================================================
// SET ACTIVE CUE
// ============================================================

function setActiveCue(
  number
) {

  // ----------------------------------------------------------
  // NO ACTIVE CUE
  // ----------------------------------------------------------

  if (
    number === null ||
    number === undefined ||
    String(number).trim() === "" ||
    String(number) === "none" ||
    String(number) === "null"
  ) {

    /*
     * Only stop if we actually had
     * an active cue.
     */

    if (
      activeCue !== null
    ) {

      console.log(
        "⏹ QLab playback stopped"
      );


      activeCue = null;

      activeCueObject =
        null;

      activeCueType =
        "";


      firedTriggers.clear();


      broadcast({
        type:
          "qlab-cue-stop"
      });
    }


    return;
  }


  const newCue =
    String(number).trim();


  if (!newCue) {
    return;
  }


  // Same cue — nothing to do.

  if (
    activeCue === newCue
  ) {

    return;
  }


  activeCue =
    newCue;


  activeCueObject =
    findCue(
      newCue
    );


  activeCueType =
    String(
      activeCueObject?.type ??
      activeCueObject?.cueType ??
      ""
    ).toLowerCase();


  // New cue = new trigger cycle.

  firedTriggers.clear();


  console.log(
    "=========================================="
  );

  console.log(
    `▶ ACTIVE QLAB CUE: ${activeCue}`
  );

  console.log(
    `   Name: ${
      activeCueObject?.name ||
      "Unknown"
    }`
  );

  console.log(
    `   Type: ${
      activeCueType ||
      "Unknown"
    }`
  );

  console.log(
    "=========================================="
  );


  broadcast({
    type:
      "qlab-cue-start",

    cueNumber:
      activeCue,

    cue:
      activeCueObject || null
  });
}


// ============================================================
// HANDLE QLAB REPLY
// ============================================================

function handleQLabReply(
  address,
  reply
) {

  console.log(
    "📨 QLab REPLY:",
    address,
    reply
  );


  if (
    reply &&
    reply.status &&
    reply.status !== "ok"
  ) {

    console.error(
      "❌ QLab returned error:",
      reply
    );

    return;
  }


  const data =
    extractReplyData(
      reply
    );


  // ==========================================================
  // CUE LIST
  // ==========================================================

  if (
    address.endsWith(
      "/cueLists"
    )
  ) {

    loadCues(
      data
    );

    return;
  }


  // ==========================================================
  // PLAYBACK POSITION
  // ==========================================================

  if (
    address.endsWith(
      "/playbackPosition"
    )
  ) {

    console.log(
      "🎯 Playback data:",
      JSON.stringify(data)
    );


    const cueNumber =
      extractCueNumber(
        data
      );


    console.log(
      "🎯 Active cue extracted:",
      cueNumber
    );


    /*
     * IMPORTANT:
     *
     * If QLab gives us no useful value,
     * DON'T clear the current cue.
     */

    if (
      cueNumber !== null
    ) {

      setActiveCue(
        cueNumber
      );
    }


    return;
  }


  // ==========================================================
  // CURRENT FILE TIME
  // ==========================================================

  if (
    address.endsWith(
      "/currentFileTime"
    )
  ) {

    if (
      !activeCue
    ) {

      return;
    }


    const elapsed =
      Number(data);


    if (
      !Number.isFinite(
        elapsed
      )
    ) {

      console.warn(
        "⚠️ Invalid currentFileTime:",
        data
      );

      return;
    }


    // THIS IS THE ACTUAL QLAB PLAYBACK TIME.
    processTime(
      activeCue,
      elapsed
    );


    // Send the live QLab time to browser.
    broadcast({
      type:
        "qlab-time",

      cueNumber:
        activeCue,

      elapsed
    });


    return;
  }
}


// ============================================================
// QLAB NORMAL OSC / UPDATE
// ============================================================

function handleQLabUpdate(
  address,
  args
) {

  console.log(
    "📥 QLab UPDATE:",
    address,
    args
  );


  // ----------------------------------------------------------
  // CUE START
  // ----------------------------------------------------------

  const startMatch =
    String(address).match(
      /^\/cue\/([^/]+)\/start$/
    );


  if (
    startMatch
  ) {

    setActiveCue(
      startMatch[1]
    );

    return;
  }


  // ----------------------------------------------------------
  // CUE STOP
  // ----------------------------------------------------------

  const stopMatch =
    String(address).match(
      /^\/cue\/([^/]+)\/stop$/
    );


  if (
    stopMatch
  ) {

    if (
      activeCue ===
      String(stopMatch[1])
    ) {

      setActiveCue(
        null
      );
    }


    return;
  }


  // ----------------------------------------------------------
  // WORKSPACE UPDATE
  // ----------------------------------------------------------

  if (
    String(address)
      .includes(
        "/update/workspace/"
      )
  ) {

    console.log(
      "🔄 Workspace changed — refreshing cues"
    );


    syncCues();

    return;
  }
}


// ============================================================
// UDP → QLAB
// ============================================================

udp.on(
  "message",
  msg => {

    const osc =
      decodeOsc(msg);


    console.log(
      "📥 QLab OSC:",
      osc.address,
      osc.args
    );


    // --------------------------------------------------------
    // QLAB 5 REPLY
    // --------------------------------------------------------

    if (
      String(
        osc.address
      ).startsWith(
        "/reply/"
      )
    ) {

      const reply =
        parseQLabReply(
          osc.address,
          osc.args
        );


      if (reply) {

        handleQLabReply(
          osc.address,
          reply
        );
      }


      return;
    }


    // --------------------------------------------------------
    // NORMAL OSC UPDATE
    // --------------------------------------------------------

    handleQLabUpdate(
      osc.address,
      osc.args
    );
  }
);


// ============================================================
// SYNC CUES
// ============================================================

function syncCues() {

  console.log(
    "🔄 REQUESTING QLAB CUE LIST"
  );


  sendOsc(
    "/cueLists"
  );
}


// ============================================================
// SUBSCRIBE TO QLAB UPDATES
// ============================================================

function subscribeToQLab() {

  console.log(
    "🎧 Subscribing to QLab updates"
  );


  // Enable update notifications.

  sendOsc(
    "/updates",
    1
  );


  // Ask QLab to reply to queries.

  sendOsc(
    "/alwaysReply",
    1
  );


  // Load cues immediately.

  syncCues();
}


// ============================================================
// 250ms QLAB DURATION / TIME WATCHER
// ============================================================
//
// THIS IS THE IMPORTANT PART.
//
// Every 250ms:
//
//   1. Ask QLab which cue is active.
//   2. If a cue is active, ask QLab for its
//      currentFileTime.
//   3. currentFileTime comes directly from QLab.
//   4. processTime() checks lighting triggers.
//
// There is NO browser audio element here.
// There is NO document/window here.
//
// ============================================================

function startDurationWatcher() {

  if (
    pollTimer
  ) {

    clearInterval(
      pollTimer
    );
  }


  console.log(
    `⏱ STARTING ${POLL_MS}ms QLAB DURATION WATCHER`
  );


  pollTimer =
    setInterval(
      () => {

        // ----------------------------------------------------
        // ALWAYS ASK QLAB WHICH CUE IS ACTIVE
        // ----------------------------------------------------

        sendOsc(
          "/playbackPosition"
        );


        // ----------------------------------------------------
        // ASK QLAB FOR CURRENT PLAYBACK TIME
        // ----------------------------------------------------

        if (
          activeCue
        ) {

          /*
           * activeCue is ALWAYS a STRING.
           *
           * This prevents:
           *
           * /cue/[object Object]/currentFileTime
           */

          const cueNumber =
            String(
              activeCue
            ).trim();


          if (
            cueNumber
          ) {

            sendOsc(
              `/cue/${cueNumber}/currentFileTime`
            );
          }
        }

      },

      POLL_MS
    );
}


// ============================================================
// TIMED LIGHTING
// ============================================================

function processTime(
  cueNumber,
  elapsed
) {

  const q =
    String(
      cueNumber
    );


  const triggers =
    timeTriggers[q] || [];


  console.log(
    `⏱ QLAB ${q}: ${elapsed.toFixed(2)}s`
  );


  if (
    !triggers.length
  ) {

    return;
  }


  for (
    let i = 0;
    i < triggers.length;
    i++
  ) {

    const trigger =
      triggers[i];


    const triggerTime =
      Number(
        trigger?.time
      );


    if (
      !Number.isFinite(
        triggerTime
      )
    ) {

      continue;
    }


    const key =
      `${q}:${i}`;


    // --------------------------------------------------------
    // TRIGGER WHEN QLAB TIME REACHES CONFIGURED TIME
    // --------------------------------------------------------

    if (
      elapsed >= triggerTime &&
      !firedTriggers.has(key)
    ) {

      firedTriggers.add(
        key
      );


      const lights =
        Array.isArray(
          trigger?.lights
        )
          ? trigger.lights
          : [];


      console.log("");
      console.log(
        "💡💡💡 LIGHTING TRIGGER"
      );
      console.log(
        `   QLab Cue: ${q}`
      );
      console.log(
        `   Current:  ${elapsed.toFixed(2)}s`
      );
      console.log(
        `   Trigger:  ${triggerTime}s`
      );
      console.log(
        `   Lights:   ${lights.join(", ")}`
      );
      console.log("");


      broadcast({
        type:
          "qlab-lighting-trigger",

        cueNumber:
          q,

        elapsed,

        triggerTime,

        lights,

        reason:
          `QLab ${q} reached ${triggerTime}s`
      });
    }
  }
}


// ============================================================
// WEBSOCKET
// ============================================================

wss.on(
  "connection",
  ws => {

    console.log(
      "✅ BROWSER CONNECTED"
    );


    clients.add(
      ws
    );


    // --------------------------------------------------------
    // TELL BROWSER BRIDGE IS ALIVE
    // --------------------------------------------------------

    ws.send(
      JSON.stringify({
        type:
          "status",

        connected:
          true,

        polling:
          POLL_MS
      })
    );


    // --------------------------------------------------------
    // IMMEDIATELY SEND KNOWN CUES
    // --------------------------------------------------------

    if (
      cues.length
    ) {

      ws.send(
        JSON.stringify({
          type:
            "qlab-cues",

          cues
        })
      );
    }


    // --------------------------------------------------------
    // IMMEDIATELY SEND CURRENT CUE
    // --------------------------------------------------------

    if (
      activeCue
    ) {

      ws.send(
        JSON.stringify({
          type:
            "qlab-cue-start",

          cueNumber:
            activeCue,

          cue:
            activeCueObject ||
            null
        })
      );
    }


    // --------------------------------------------------------
    // BROWSER MESSAGE
    // --------------------------------------------------------

    ws.on(
      "message",
      raw => {

        try {

          const message =
            JSON.parse(
              raw.toString()
            );


          console.log(
            "📨 Browser → Bridge:",
            message
          );


          // --------------------------------------------------
          // SUBSCRIBE
          // --------------------------------------------------

          if (
            message.type ===
            "subscribe"
          ) {

            subscribeToQLab();

            return;
          }


          // --------------------------------------------------
          // SYNC CUES
          // --------------------------------------------------

          if (
            message.type ===
            "sync-cues"
          ) {

            syncCues();

            return;
          }


          // --------------------------------------------------
          // TIMED LIGHTING SETTINGS
          // --------------------------------------------------

          if (
            message.type ===
            "set-time-triggers"
          ) {

            if (
              message.triggers &&
              typeof message.triggers ===
                "object"
            ) {

              timeTriggers =
                message.triggers;
            }

            else {

              timeTriggers = {};
            }


            /*
             * New timing configuration means
             * all configured triggers are allowed
             * to fire again.
             */

            firedTriggers.clear();


            console.log(
              "💡 TIMING MAP UPDATED:"
            );


            console.log(
              JSON.stringify(
                timeTriggers,
                null,
                2
              )
            );


            return;
          }


          // --------------------------------------------------
          // NORMAL OSC COMMAND
          // --------------------------------------------------

          if (
            message.type === "osc" &&
            typeof message.address ===
              "string"
          ) {

            sendOsc(
              message.address,
              Array.isArray(
                message.args
              )
                ? message.args
                : []
            );


            return;
          }


          // --------------------------------------------------
          // OLD FORMAT SUPPORT
          // --------------------------------------------------

          if (
            typeof message.address ===
            "string"
          ) {

            sendOsc(
              message.address,
              Array.isArray(
                message.args
              )
                ? message.args
                : []
            );


            return;
          }


          console.warn(
            "⚠️ UNKNOWN BROWSER MESSAGE:",
            message
          );

        }

        catch (error) {

          console.error(
            "❌ WebSocket message error:",
            error
          );
        }
      }
    );


    // --------------------------------------------------------
    // BROWSER DISCONNECTED
    // --------------------------------------------------------

    ws.on(
      "close",
      () => {

        clients.delete(
          ws
        );


        console.log(
          "🔌 BROWSER DISCONNECTED"
        );
      }
    );
  }
);


// ============================================================
// UDP ERROR
// ============================================================

udp.on(
  "error",
  error => {

    console.error(
      "❌ UDP ERROR:",
      error.message
    );
  }
);


// ============================================================
// WEBSOCKET ERROR
// ============================================================

wss.on(
  "error",
  error => {

    console.error(
      "❌ WEBSOCKET ERROR:",
      error.message
    );
  }
);


// ============================================================
// BIND QLAB REPLY PORT
// ============================================================

udp.bind(
  QLAB_REPLY_PORT,
  QLAB_IP,
  () => {

    console.log(
      `✅ UDP LISTENING ON ${QLAB_REPLY_PORT}`
    );

    console.log(
      `⏱ ${POLL_MS}ms QLAB DURATION WATCHER STARTING...`
    );

    startDurationWatcher();
  }
);