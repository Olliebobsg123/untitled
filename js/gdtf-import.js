"use strict";

/* Compatibility loader: gdtf-import.js now lives under js/fixtures/.
 * Electron injects this file after the document has loaded, so avoid
 * document.write and append the real module normally.
 */
(() => {
  const src = "js/fixtures/gdtf-import.js";
  if (document.querySelector(`script[data-fixture-loader="${src}"]`)) return;
  const script = document.createElement("script");
  script.src = src;
  script.dataset.fixtureLoader = src;
  script.onload = () => console.log(`✅ Fixture module loaded: ${src}`);
  script.onerror = err => console.error(`❌ Fixture module failed to load: ${src}`, err);
  document.head.appendChild(script);
})();
