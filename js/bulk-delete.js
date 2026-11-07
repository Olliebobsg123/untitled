"use strict";

/*
 * Delete lots at once from the command line:
 *   delete cue 1 thru 70        delete cues 1, 2, 5
 *   delete palette 1 thru 10    delete palettes all
 *   delete group 3, 4, 7        delete effects 2 thru 6
 *   delete chase 1 thru 3
 * Numbers are the places in each list (palette 3 = the third palette),
 * and cue numbers for cues. Ranges ("1 thru 5", "1-5") and lists ("1,2,3")
 * can be mixed: "1 thru 5, 8, 10". "all" deletes every one. More than one
 * asks first.
 */
(function () {
  if (window.__bulkDelete) return;
  window.__bulkDelete = true;
  const say = (m, t = "ok") => window.log?.(m, t);
  const S = () => window.State || {};

  // "1 thru 5, 8" → [1,2,3,4,5,8]. Cue numbers can have decimals in a list.
  function numbers(text) {
    const out = [];
    for (const part of String(text).split(",").map(s => s.trim()).filter(Boolean)) {
      const r = part.match(/^(\d+(?:\.\d+)?)\s*(?:thru|through|to|–|-)\s*(\d+(?:\.\d+)?)$/);
      if (r) {
        let a = Number(r[1]), b = Number(r[2]);
        if (a > b) [a, b] = [b, a];
        if (b - a > 5000) return null;
        for (let n = Math.ceil(a); n <= b; n++) out.push(n);
        if (!Number.isInteger(a)) out.push(a);
        continue;
      }
      if (/^\d+(?:\.\d+)?$/.test(part)) { out.push(Number(part)); continue; }
      return null;
    }
    return [...new Set(out)];
  }

  const KINDS = {
    cue: {
      label: "cue", count: () => (S().cues || []).filter(Boolean).length,
      all: () => (S().cues || []).map((_, i) => Number(window.cueLabel?.(i) ?? i + 1)),
      exists: n => (window.cueIndexOf?.(n) ?? -1) >= 0,
      remove: list => { for (const n of list) window.deleteCue?.(n); }
    },
    palette: {
      label: "palette", count: () => (S().palettes || []).length,
      exists: n => Boolean((S().palettes || [])[n - 1]),
      remove: list => { const gone = new Set(list.map(n => S().palettes[n - 1])); S().palettes = S().palettes.filter(p => !gone.has(p)); window.Palettes?.refresh?.(); }
    },
    group: {
      label: "group", count: () => (S().groups || []).length,
      exists: n => Boolean((S().groups || [])[n - 1]),
      remove: list => { const gone = new Set(list.map(n => S().groups[n - 1])); S().groups = S().groups.filter(g => !gone.has(g)); window.renderGroups?.(); }
    },
    effect: {
      label: "effect", count: () => Object.keys(S().savedEffects || {}).length,
      exists: n => Boolean(Object.keys(S().savedEffects || {})[n - 1]),
      remove: list => { const keys = Object.keys(S().savedEffects || {}); for (const n of list) delete S().savedEffects[keys[n - 1]]; window.renderEffectsList?.(); }
    },
    chase: {
      label: "chase", count: () => (S().chases || []).length,
      exists: n => Boolean((S().chases || [])[n - 1]),
      // One at a time, last first, so cues that start a chase stay linked to the right one.
      remove: list => {
        const s = S();
        for (const n of [...list].sort((a, b) => b - a)) {
          const i = n - 1;
          if (Number(s.currentChase) === i) window.stopChase?.(false);
          s.chases.splice(i, 1);
          if (Number.isInteger(s.currentChase) && s.currentChase > i) s.currentChase -= 1;
          // Cues point at chases by place: drop links to a deleted chase, shift the rest.
          for (const cue of s.cues || []) {
            const at = Number(cue?.chase?.index);
            if (!Number.isInteger(at)) continue;
            if (at === i) delete cue.chase; else if (at > i) cue.chase.index = at - 1;
          }
        }
        window.renderChases?.();
      }
    }
  };

  async function run(kindName, what) {
    const kind = KINDS[kindName];
    let list = /^(all|everything)$/.test(what) ? (kind.all ? kind.all() : Array.from({ length: kind.count() }, (_, i) => i + 1)) : numbers(what);
    if (!list) return false;
    if (kindName !== "cue") list = list.filter(Number.isInteger);
    const missing = list.filter(n => !kind.exists(n));
    list = list.filter(n => kind.exists(n));
    if (!list.length) { say(`No ${kind.label} ${what} to delete`, "warn"); return true; }
    const plural = list.length === 1 ? kind.label : `${kind.label}s`;
    if (list.length > 1 && window.LXAsk) {
      const ok = await window.LXAsk(`Delete ${list.length} ${plural}?`, [], { ok: "Delete", message: `${plural[0].toUpperCase() + plural.slice(1)} ${short(list)} will be deleted.` });
      if (!ok) { say("Nothing was deleted", "info"); return true; }
    }
    kind.remove(list);
    say(`Deleted ${list.length} ${plural}: ${short(list)}${missing.length ? ` (no ${kind.label} ${short(missing)})` : ""}`, "ok");
    return true;
  }

  function short(list) {
    const s = [...list].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < s.length; i++) {
      let j = i;
      while (j + 1 < s.length && Number.isInteger(s[j]) && s[j + 1] === s[j] + 1) j++;
      parts.push(j > i + 1 ? `${s[i]} thru ${s[j]}` : j === i + 1 ? `${s[i]}, ${s[j]}` : `${s[i]}`);
      i = j;
    }
    return parts.join(", ");
  }

  function install() {
    if (typeof window.parseCommand !== "function") return setTimeout(install, 50);
    const original = window.parseCommand;
    window.parseCommand = function bulkDeleteWrapper(raw) {
      const c = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
      const m = c.match(/^(?:delete|del|remove)\s+(cue|palette|group|effect|chase)s?\s+(.+)$/);
      if (m) {
        const what = m[2].trim();
        // A single number for anything but cues, or a name, stays with the
        // commands that were there before ("delete group Front wash").
        const many = /^(all|everything)$/.test(what) || /,|thru|through|\d\s*(-|–|to)\s*\d/.test(what);
        if (many && (/^(all|everything)$/.test(what) || numbers(what))) { run(m[1], what); return true; }
      }
      return original.apply(this, arguments);
    };
  }
  install();
})();
