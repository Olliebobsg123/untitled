'use strict';

// The QLab bridge (main/qlab-bridge-core.js) is a Pro feature: it only runs while
// the licence is Pro. The core opens its ports when loaded, so starting again
// after a stop loads a fresh copy.

const CORE = require.resolve('./qlab-bridge-core.js');
let core = null;

function start() {
  if (core) return;
  try {
    core = require(CORE);
  } catch (err) {
    console.error('QLab bridge failed to start:', err);
    core = null;
  }
}

function stop() {
  if (!core) return;
  try { core.shutdown(); } catch (err) { console.error('QLab bridge shutdown failed:', err); }
  core = null;
  delete require.cache[CORE];
}

module.exports = { start, stop };
