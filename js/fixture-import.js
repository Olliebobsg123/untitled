"use strict";

/* Compatibility loader: fixture-import.js now lives under js/fixtures/.
 * This file is loaded dynamically by Electron, so use script elements instead
 * of document.write (which can replace the document after page load).
 */
(() => {
  const load = src => {
    if (document.querySelector(`script[data-fixture-loader="${src}"]`)) return;
    const script = document.createElement("script");
    script.src = src;
    script.dataset.fixtureLoader = src;
    script.onload = () => console.log(`✅ Fixture module loaded: ${src}`);
    script.onerror = err => console.error(`❌ Fixture module failed to load: ${src}`, err);
    document.head.appendChild(script);
  };

  load("js/fixtures/fixture-import.js");
  load("js/fixtures/ma2-import.js");
})();
