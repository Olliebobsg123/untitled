"use strict";

// ✅ GUARANTEE ALL DEPENDENCIES EXIST FIRST
if (!window.State) window.State = {};
if (!State.groups) State.groups = [];
if (!window.Groups) window.Groups = {};

// ... rest of your groups.js code ...



function renderGroups() {
  const list = $('groupList');
  if (!list) return;
  list.innerHTML = '';

  // ✅ Safe fallback if empty — never crashes
  (State.groups || []).forEach(g => {
    const el = document.createElement('div');
    el.className = 'group-item';
    el.textContent = g.name;

    el.onclick = () => {
      State.selected.clear();
      let found = 0;
      g.members.forEach(n => {
        const f = State.fixtures[n - 1];
        if (f) {
          State.selected.add(f.id);
          found++;
        }
      });

      const currInt = State.current.intensity ?? 100;
      if ($('intensity')) $('intensity').value = currInt;
      if ($('intVal')) $('intVal').textContent = currInt + '%';

      renderFixtures();
      if (typeof updateControlsForSelection === 'function') updateControlsForSelection();
      updateDMX();

      log(`✅ Selected ${g.name}: ${found}/${g.members.length} — DMX active`);
    };

    list.appendChild(el);
  });
}