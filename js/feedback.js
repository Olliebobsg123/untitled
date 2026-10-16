"use strict";

// ==============================================
// SUGGESTIONS / BUG REPORTS
// ==============================================
// Email delivery is handled by the Electron preload bridge so this also
// works when the app is opened from a local file:// URL.

(function installFeedbackCommands() {

  function ensureModal() {
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

  LXCommands.describe("suggestion", "open suggestion menu");
  LXCommands.describe("bug report", "open bug report menu");
  LXCommands.add(raw => {
    const command = String(raw || "").trim().toLowerCase();
    if (/^(suggestion|suggestions)$/.test(command)) return openFeedback("suggestion");
    if (/^(bug\s+report|bugreport)$/.test(command)) return openFeedback("bug");
    return LXCommands.NOT_MINE;
  });

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

