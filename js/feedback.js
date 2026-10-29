"use strict";

// ==============================================
// SUGGESTIONS / BUG REPORTS
// ==============================================
// Email delivery is handled by the Electron preload bridge so this also
// works when the app is opened from a local file:// URL.

(function installFeedbackCommands() {
  const addStyles = () => {
    if (document.getElementById("lxFeedbackStyles")) return;
    const style = document.createElement("style");
    style.id = "lxFeedbackStyles";
    style.textContent = `
      #lxFeedbackModal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.72); z-index:100000; padding:20px; box-sizing:border-box; }
      #lxFeedbackModal.is-open { display:flex; }
      #lxFeedbackModal .lx-feedback-box { width:min(620px,100%); background:#0b1012; border:1px solid #2a373b; box-shadow:0 24px 80px rgba(0,0,0,.55); padding:22px; box-sizing:border-box; color:#eef4f2; font-family:Inter,"Segoe UI",system-ui,sans-serif; }
      #lxFeedbackModal .lx-feedback-kicker { color:#19d6a3; font:900 12px/1 var(--mono,monospace); letter-spacing:.14em; text-transform:uppercase; margin-bottom:8px; }
      #lxFeedbackModal h3 { margin:0 0 7px; font-size:20px; }
      #lxFeedbackModal p { margin:0 0 16px; color:#a6b1af; font-size:14px; }
      #lxFeedbackModal textarea { width:100%; min-height:170px; resize:vertical; box-sizing:border-box; background:#070a0b; border:1px solid #2a373b; color:#eef4f2; padding:12px; outline:none; font:700 14px/1.5 var(--mono,monospace); }
      #lxFeedbackModal textarea:focus { border-color:#19d6a3; }
      #lxFeedbackModal .lx-feedback-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:13px; }
      #lxFeedbackModal button { border:1px solid #2a373b; background:#11191c; color:#eef4f2; padding:9px 14px; cursor:pointer; font:900 13px/1 var(--mono,monospace); text-transform:uppercase; }
      #lxFeedbackModal button:hover { background:#172124; }
      #lxFeedbackModal .lx-feedback-send { background:#19d6a3; color:#06110d; border-color:#19d6a3; }
      #lxFeedbackModal .lx-feedback-send:hover { background:#42e2b8; }
      #lxFeedbackModal .lx-feedback-status { min-height:16px; margin-top:9px; color:#a6b1af; font:700 13px/1.4 var(--mono,monospace); }
    `;
    document.head.appendChild(style);
  };

  function ensureModal() {
    addStyles();
    let modal = document.getElementById("lxFeedbackModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "lxFeedbackModal";
    modal.innerHTML = `
      <div class="lx-feedback-box" role="dialog" aria-modal="true" aria-labelledby="lxFeedbackTitle">
        <div class="lx-feedback-kicker" id="lxFeedbackKicker">FEEDBACK</div>
        <h3 id="lxFeedbackTitle">Send feedback</h3>
        <p id="lxFeedbackHelp">Tell us what you would like to report or suggest.</p>
        <textarea id="lxFeedbackText" placeholder="Type your message here..."></textarea>
        <div class="lx-feedback-status" id="lxFeedbackStatus"></div>
        <div class="lx-feedback-actions">
          <button type="button" id="lxFeedbackCancel">Cancel</button>
          <button type="button" id="lxFeedbackSend" class="lx-feedback-send">Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove("is-open");
      const text = document.getElementById("lxFeedbackText");
      if (text) text.value = "";
      const status = document.getElementById("lxFeedbackStatus");
      if (status) status.textContent = "";
    };

    document.getElementById("lxFeedbackCancel")?.addEventListener("click", close);
    modal.addEventListener("click", event => {
      if (event.target === modal) close();
    });
    document.getElementById("lxFeedbackText")?.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitFeedback();
      }
    });
    document.getElementById("lxFeedbackSend")?.addEventListener("click", submitFeedback);

    return modal;
  }

  let currentType = "suggestion";

  function openFeedback(type) {
    const modal = ensureModal();
    currentType = type === "bug" ? "bug" : "suggestion";

    const kicker = document.getElementById("lxFeedbackKicker");
    const title = document.getElementById("lxFeedbackTitle");
    const help = document.getElementById("lxFeedbackHelp");
    const text = document.getElementById("lxFeedbackText");
    const status = document.getElementById("lxFeedbackStatus");

    if (currentType === "bug") {
      if (kicker) kicker.textContent = "BUG REPORT";
      if (title) title.textContent = "Report a bug";
      if (help) help.textContent = "Describe what went wrong and what you expected to happen.";
      if (text) text.placeholder = "What happened? What were you trying to do?";
    } else {
      if (kicker) kicker.textContent = "SUGGESTION";
      if (title) title.textContent = "Send a suggestion";
      if (help) help.textContent = "Tell us what you would like to see added or changed.";
      if (text) text.placeholder = "What would you like to suggest?";
    }

    if (status) status.textContent = "";
    modal.classList.add("is-open");
    setTimeout(() => text?.focus(), 0);
  }

  async function submitFeedback() {
    const text = String(document.getElementById("lxFeedbackText")?.value || "").trim();
    const status = document.getElementById("lxFeedbackStatus");
    const sendButton = document.getElementById("lxFeedbackSend");

    if (!text) {
      if (status) status.textContent = "Please enter a message first.";
      return;
    }

    if (sendButton) {
      sendButton.disabled = true;
      sendButton.textContent = "Sending...";
    }
    if (status) status.textContent = "Sending feedback...";

    const typeLabel = currentType === "bug" ? "Bug Report" : "Suggestion";

    try {
      if (!window.LXFeedbackMail || typeof window.LXFeedbackMail.send !== "function") {
        throw new Error("The desktop email bridge is not available. Restart the app after updating it.");
      }

      const result = await window.LXFeedbackMail.send({
        message: text,
        type: typeLabel
      });

      console.log("[FEEDBACK] Email bridge response:", result);

      if (!result?.success) {
        throw new Error(result?.message || "Email service rejected the message");
      }

      if (status) status.textContent = "Sent successfully — check your email.";
      if (typeof window.log === "function") window.log(`${typeLabel} sent`, "ok");

      setTimeout(() => {
        const modal = document.getElementById("lxFeedbackModal");
        if (modal) modal.classList.remove("is-open");
      }, 1200);
    } catch (error) {
      console.error("[FEEDBACK] Send failed:", error);
      if (status) status.textContent = `Could not send: ${error?.message || "email service error"}`;
      if (typeof window.log === "function") window.log("Feedback could not be sent", "error");
    } finally {
      if (sendButton) {
        sendButton.disabled = false;
        sendButton.textContent = "Send";
      }
    }
  }

  if (typeof commandDefs !== "undefined" && Array.isArray(commandDefs)) {
    commandDefs.push(
      { cmd: "suggestion", hint: "open suggestion menu" },
      { cmd: "suggestions", hint: "open suggestion menu" },
      { cmd: "bug report", hint: "open bug report menu" },
      { cmd: "bugreport", hint: "open bug report menu" }
    );
  }

  const previousParseCommand = window.parseCommand || window.__lxOriginalParseCommand;
  window.parseCommand = function(rawCommand) {
    const command = String(rawCommand || "").trim().toLowerCase();

    if (/^(suggestion|suggestions)$/.test(command)) {
      openFeedback("suggestion");
      return;
    }

    if (/^(bug\s+report|bugreport)$/.test(command)) {
      openFeedback("bug");
      return;
    }

    return typeof previousParseCommand === "function"
      ? previousParseCommand.apply(this, arguments)
      : undefined;
  };

  window.LXFeedback = Object.freeze({
    openSuggestion: () => openFeedback("suggestion"),
    openBugReport: () => openFeedback("bug")
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureModal, { once: true });
  } else {
    ensureModal();
  }
})();

// The custom fixture editor lives in its own module.
if (!document.querySelector('script[data-lx-fixture-editor]')) {
  const script = document.createElement("script");
  script.src = "js/fixture-editor.js";
  script.dataset.lxFixtureEditor = "1";
  document.head.appendChild(script);
}
