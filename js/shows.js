/* Current show persistence.
 * This file is the show file. Show state is kept in memory and Electron
 * persists it here instead of browser localStorage.
 */
(function (global) {
  const SHOW_VERSION = 5;
  const initial = global.__SHOW_DATA__ && typeof global.__SHOW_DATA__ === 'object'
    ? global.__SHOW_DATA__
    : { version: SHOW_VERSION, fixtures: [], groups: [], cues: [], chases: [], fixtureStates: [], current: {}, selected: [], multiOutputs: [], outputSettings: { outputs: [], relay: null, legacy: null } };

  function clone(value) {
    try { return structuredClone(value); } catch (_) {}
    try { return JSON.parse(JSON.stringify(value)); } catch (_) {}
    return value;
  }

  function normalise(show) {
    const source = show && typeof show === 'object' ? show : {};
    return {
      version: SHOW_VERSION,
      ...clone(source),
      fixtures: Array.isArray(source.fixtures) ? clone(source.fixtures) : [],
      groups: Array.isArray(source.groups) ? clone(source.groups) : [],
      cues: Array.isArray(source.cues) ? clone(source.cues) : [],
      chases: Array.isArray(source.chases) ? clone(source.chases) : [],
      fixtureStates: Array.isArray(source.fixtureStates) ? clone(source.fixtureStates) : [],
      current: source.current && typeof source.current === 'object' ? clone(source.current) : {},
      selected: Array.isArray(source.selected) ? clone(source.selected) : [],
      multiOutputs: Array.isArray(source.multiOutputs) ? clone(source.multiOutputs) : [],
      outputSettings: source.outputSettings && typeof source.outputSettings === 'object'
        ? clone(source.outputSettings)
        : { outputs: [], relay: null, legacy: null }
    };
  }

  let currentShow = normalise(initial);

  function getShow() { return currentShow; }

  function setShow(show) {
    currentShow = normalise(show);
    global.__SHOW_DATA__ = clone(currentShow);
    return currentShow;
  }

  function addFixture(fixture) {
    if (!fixture) return currentShow;
    if (!Array.isArray(currentShow.fixtures)) currentShow.fixtures = [];
    currentShow.fixtures.push(clone(fixture));
    global.__SHOW_DATA__ = clone(currentShow);
    return currentShow;
  }

  function removeFixture(id) {
    currentShow.fixtures = currentShow.fixtures.filter(f => f && f.id !== id);
    currentShow.fixtureStates = currentShow.fixtureStates.filter(entry => !Array.isArray(entry) || entry[0] !== id);
    currentShow.selected = currentShow.selected.filter(value => String(value) !== String(id));
    global.__SHOW_DATA__ = clone(currentShow);
    return currentShow;
  }

  global.ShowStore = { SHOW_VERSION, getShow, setShow, addFixture, removeFixture };
  global.__SHOW_DATA__ = clone(currentShow);
})(window);
