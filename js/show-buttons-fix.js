(function () {
  "use strict";

  function wireShowButtons() {
    const saveButton = document.getElementById("btnSaveShow");
    const loadButton = document.getElementById("btnLoadShow");
    const fileInput = document.getElementById("showFileInput");

    if (!saveButton || !loadButton || !fileInput) return false;

    // Use addEventListener rather than assigning onclick so this remains
    // reliable even if another part of the console refreshes the Settings UI.
    if (!saveButton.dataset.showWired) {
      saveButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.saveShow === "function") {
          window.saveShow();
        }
      });
      saveButton.dataset.showWired = "1";
    }

    if (!loadButton.dataset.showWired) {
      loadButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        // Reset first so selecting the same file twice still fires change.
        fileInput.value = "";
        fileInput.click();
      });
      loadButton.dataset.showWired = "1";
    }

    if (!fileInput.dataset.showWired) {
      fileInput.addEventListener("change", async function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          if (typeof window.loadShow !== "function") {
            throw new Error("Show loader is not available");
          }
          window.loadShow(text);
        } catch (error) {
          console.error("Load Show failed:", error);
          if (typeof window.log === "function") {
            window.log("Failed to load show file", "warn");
          } else {
            alert("Failed to load show file.");
          }
        } finally {
          fileInput.value = "";
        }
      });
      fileInput.dataset.showWired = "1";
    }

    return true;
  }

  // The Settings page can be shown/updated after the initial DOM event, so
  // keep a lightweight watcher until the controls have been wired.
  function start() {
    if (wireShowButtons()) return;
    const timer = setInterval(function () {
      if (wireShowButtons()) clearInterval(timer);
    }, 100);
    setTimeout(function () { clearInterval(timer); }, 15000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  // Re-wire if the Settings DOM is rebuilt later.
  const observer = new MutationObserver(function () {
    wireShowButtons();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
