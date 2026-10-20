// Launches the installed app and pings its main process every 100 ms,
// printing any gap over 400 ms next to what the app logged at that moment.
const { _electron: electron } = require("playwright-core");
const fs = require("fs"), path = require("path");
(async () => {
  const exe = process.argv[2]; const out = path.join(__dirname, "out"); fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1);
  const lines = [];
  const app = await electron.launch({ executablePath: exe, args: [], timeout: 120000 });
  console.log(`launched in ${T()}s`);
  const tag = s => d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => lines.push(`${T()}s ${s} ${l.slice(0, 200)}`));
  app.process().stdout.on("data", tag("out")); app.process().stderr.on("data", tag("err"));
  const win = await app.firstWindow({ timeout: 120000 }); console.log(`first window at ${T()}s`);
  win.on("console", m => lines.push(`${T()}s page ${m.type()} ${m.text().slice(0, 200)}`));
  let last = Date.now(), shot = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const a = Date.now();
    await app.evaluate(() => 1).catch(() => {});
    const b = Date.now();
    if (b - a > 400) console.log(`MAIN STALL ${b - a} ms ending at ${T()}s`);
    const c = Date.now();
    await win.evaluate(() => 1).catch(() => {});
    const d = Date.now();
    if (d - c > 1000) console.log(`page stall ${d - c} ms ending at ${T()}s`);
    if (Date.now() - last > 10000) { last = Date.now(); await win.screenshot({ path: path.join(out, `shot-${++shot}.png`) }).catch(() => {}); }
    await new Promise(r => setTimeout(r, 100));
  }
  // The visualiser: open it, then report its errors and what WebGL it got.
  console.log("GPU", JSON.stringify(await app.evaluate(({ app }) => app.getGPUFeatureStatus())));
  console.log("GPU info", JSON.stringify(await app.evaluate(async ({ app }) => { const i = await app.getGPUInfo("basic"); return (i.gpuDevice || []).map(d => [d.vendorId, d.deviceId, d.driverVersion]); })));
  const vizErrors = [];
  app.on("window", w => { w.on("console", m => { if (m.type() === "error" || m.type() === "warning") vizErrors.push(`${m.type()} ${m.text().slice(0, 300)}`); }); w.on("pageerror", e => vizErrors.push(`pageerror ${e.message.slice(0, 300)}`)); });
  await win.evaluate(() => { window.parseCommand?.("viz"); });
  await new Promise(r => setTimeout(r, 8000));
  const viz = app.windows().find(w => /visualizer/.test(w.url()));
  console.log("VIZ window", viz ? viz.url() : "NOT OPEN");
  if (viz) {
    console.log("VIZ state", JSON.stringify(await viz.evaluate(() => { const c = document.querySelector("canvas"); let gl = null; try { const g = c?.getContext("webgl2") || c?.getContext("webgl"); const ext = g?.getExtension("WEBGL_debug_renderer_info"); gl = g ? [g.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : g.RENDERER), g.getParameter(g.VERSION)] : "no context"; } catch (e) { gl = "err " + e.message; } return { canvas: c ? [c.width, c.height] : null, gl, hasOpener: !!window.opener, fixtures: window.opener?.State?.fixtures?.length ?? null, title: document.title }; }).catch(e => "eval failed " + e.message)));
    await viz.screenshot({ path: path.join(out, "viz.png") }).catch(e => console.log("viz shot failed", e.message));
  }
  console.log("VIZ errors\n" + vizErrors.slice(0, 40).join("\n"));
  console.log("VERSION", await app.evaluate(({ app }) => app.getVersion()));
  console.log("UPDATE", JSON.stringify(await win.evaluate(async () => { await window.LXUpdates?.check(true); await new Promise(r => setTimeout(r, 6000)); return window.LXUpdates?.state(); })));
  fs.writeFileSync(path.join(out, "stalls-log.txt"), lines.join("\n"));
  console.log("----- log -----\n" + lines.filter(l => !/FixtureLibrary/.test(l)).slice(0, 120).join("\n"));
  try { app.process().kill(); } catch (_) {}
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
