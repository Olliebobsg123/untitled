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
  const end = Date.now() + 60000;
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
  fs.writeFileSync(path.join(out, "stalls-log.txt"), lines.join("\n"));
  console.log("----- log -----\n" + lines.slice(0, 200).join("\n"));
  await app.close().catch(() => {});
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
