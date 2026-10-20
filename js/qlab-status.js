// QLab page: say plainly whether QLab itself is answering, and why Sync
// Cues found nothing. (js/qlab.js talks to Light Spark's own QLab link in
// the main process; "connected" there only meant that link was running.)
(function () {
  const Q = window.QLab;
  if (!Q || Q.__statusWrapped) return;
  Q.__statusWrapped = true;
  const $ = id => document.getElementById(id);
  const say = (m, l) => window.log?.(`🎵 ${m}`, l);
  let heard = false;

  function reason(msg) {
    const ip = msg.ip || Q.ip;
    const here = ip === "127.0.0.1" || ip === "localhost";
    switch (msg.reason) {
      case "ECONNREFUSED": return here ? "QLab isn't open on this computer (or its OSC is off). If QLab is on another computer, put that computer's IP address in the QLab address box." : `Nothing answered at ${ip}. Is QLab open on that computer?`;
      case "ETIMEDOUT": case "EHOSTUNREACH": case "ENETUNREACH": case "no-reply":
        return here ? "QLab didn't answer on this computer. Is it open? If QLab runs on another computer, put that computer's IP address in the QLab address box." : `QLab at ${ip} didn't answer. Check the address (the QLab Mac's IP: System Settings → Wi-Fi → Details), that both computers are on the same network, and that QLab is open.`;
      case "no-workspace": return "QLab is open but no workspace is open in it.";
      case "denied": return "QLab refused: the workspace needs a passcode (or a different one). Check QLab → Workspace Settings → Network → OSC Access, and the passcode box here.";
      default: return `QLab answered with an error (${msg.reason}).`;
    }
  }

  let last = null; // the latest explanation, so the older "N CUES LOADED" text can't cover it
  const show = (text, tone) => {
    last = { text, tone, at: Date.now() };
    const sync = $("qlabLastSync");
    if (sync) { sync.textContent = text; sync.title = text; sync.dataset.tone = tone || ""; }
    // The explanation also goes where the cues would be, where there's room to read it.
    const empty = document.querySelector("#qlabSyncList .empty-state");
    if (empty) empty.textContent = tone === "bad" ? text.replace(/^NO CUES — /, "") : "No QLab cues found. Click Sync Cues.";
  };

  const handle = Q.handleMessage;
  Q.handleMessage = function (message) {
    if (message?.type === "qlab-sync-status") {
      heard = heard || message.ok || !["no-reply", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(message.reason);
      if (message.ok) {
        const skipped = Number(message.unnumbered) || 0;
        if (!message.count) {
          const text = skipped ? `QLab has ${skipped} cue${skipped === 1 ? "" : "s"}, but none has a cue number. Light Spark links to QLab cues by number: give them numbers in QLab (select them → Cue → Renumber Selected Cues).` : "QLab answered, but the workspace in front has no cues.";
          show(`NO CUES — ${text}`, "bad");
          say(`Sync Cues: ${text}`, "warn");
        } else {
          show(`${message.count} CUES LOADED${skipped ? ` · ${skipped} without a number skipped` : ""}`, "ok");
          say(`QLab: loaded ${message.count} cues${skipped ? ` (${skipped} without a cue number left out)` : ""}`, "ok");
        }
      } else {
        const text = reason(message);
        show(`NO CUES — ${text}`, "bad");
        say(`Sync Cues: ${text}`, "warn");
      }
      Q.updateStatus(Q.connected);
      return;
    }
    const out = handle.apply(this, arguments);
    if (message?.type === "qlab-cues" && last && last.tone && Date.now() - last.at < 3000) { const keep = last; show(keep.text, keep.tone); }
    return out;
  };

  const update = Q.updateStatus;
  Q.updateStatus = function (connected) {
    update.apply(this, arguments);
    const text = !connected ? "Light Spark's QLab link isn't running — retrying…" : heard ? `Connected — QLab ${this.ip}` : `Looking for QLab at ${this.ip}…`;
    if (typeof window.updateQLabStatus === "function") window.updateQLabStatus(text, connected && heard);
    const s = $("qlabSettingsStatus");
    if (s) s.textContent = text;
  };

  const syncCues = Q.syncCues;
  Q.syncCues = function () {
    const sent = syncCues.apply(this, arguments);
    if (!sent) {
      const pro = String(window.License?.getTier?.() || "").toLowerCase() === "pro";
      const text = pro ? "Light Spark's QLab link is still starting — try again in a moment." : "QLab needs a Pro licence: the QLab link only runs with Pro.";
      show(`NO CUES — ${text}`, "bad");
      say(`Sync Cues: ${text}`, "warn");
    } else show("SYNCING…");
    return sent;
  };

  // The Test Message button sent a bare string, which the link ignored.
  const test = $("qlabTest");
  if (test) test.onclick = () => { Q.command("/alwaysReply", 1); Q.command("/notification", "Hello from Light Spark"); say("Sent a test message to QLab"); };

  const style = document.createElement("style");
  style.textContent = '#qlabLastSync[data-tone="bad"]{color:#ff98a3;white-space:normal}#qlabLastSync[data-tone="ok"]{color:#6fe08e}';
  document.head.appendChild(style);
})();
