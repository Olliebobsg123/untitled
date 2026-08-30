/* Show data persistence.
 * Imported fixture definitions belong to the current show, not browser localStorage.
 * The renderer can keep the current show in memory; the Electron main process is
 * responsible for persisting it to a show file via IPC when the project wires saving in.
 */
(function (global) {
  const SHOW_VERSION = 1;
  let currentShow = { version: SHOW_VERSION, fixtures: [] };

  function getShow() {
    return currentShow;
  }

  function setShow(show) {
    currentShow = show && typeof show === 'object'
      ? { version: SHOW_VERSION, ...show, fixtures: Array.isArray(show.fixtures) ? show.fixtures : [] }
      : { version: SHOW_VERSION, fixtures: [] };
    return currentShow;
  }

  function addFixture(fixture) {
    if (!fixture) return currentShow;
    if (!Array.isArray(currentShow.fixtures)) currentShow.fixtures = [];
    currentShow.fixtures.push(fixture);
    return currentShow;
  }

  function removeFixture(id) {
    currentShow.fixtures = currentShow.fixtures.filter(f => f && f.id !== id);
    return currentShow;
  }

  global.ShowStore = { SHOW_VERSION, getShow, setShow, addFixture, removeFixture };
})(window);
