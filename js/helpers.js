"use strict";

const $ = id => document.getElementById(id);

function log(msg, type = 'info') {
  const t = $('termLog');
  if (!t) return;
  const el = document.createElement('div');
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.className = type;
  t.appendChild(el);
  t.scrollTop = t.scrollHeight;
  if (t.children.length > 40) t.removeChild(t.firstChild);
}