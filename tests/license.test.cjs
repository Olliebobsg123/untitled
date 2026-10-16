// main/license.js with a fake Electron app and a fake licence server: forged and
// copied tokens are refused, the offline grace period works, revocation works.
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const LICENSE = path.join(__dirname, "..", "main", "license.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lic-"));
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(path.join(dir, "pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
process.env.LIGHT_SPARK_LICENSE_PUBLIC_KEY_FILE = path.join(dir, "pub.pem");
const fakeApp = { isPackaged: false, getPath: () => dir };
const realLoad = Module._load;
Module._load = (request, ...rest) => (request === "electron" ? { app: fakeApp } : realLoad(request, ...rest));

const sha = v => crypto.createHash("sha256").update(String(v)).digest("hex");
const sign = (payload, key = privateKey) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = crypto.createSign("SHA256"); s.update(body); s.end();
  return `${body}.${s.sign(key).toString("base64url")}`;
};

let server = { activate: null, validate: null };
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  const handler = url.endsWith("/activate") ? server.activate : url.endsWith("/validate") ? server.validate : () => ({ status: 200, json: { ok: true } });
  if (handler === "offline") throw new Error("ENOTFOUND");
  const { status, json } = handler(body);
  return { ok: status < 300, status, json: async () => json };
};

(async () => {
  const license = require(LICENSE);
  license.start();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(license.tier(), "free", "starts free");
  const machineId = JSON.parse(fs.readFileSync(path.join(dir, "license.json"), "utf8")).machineId;

  // 1. Activation with a properly signed token for this machine → LIVE.
  server.activate = () => ({ status: 200, json: { token: sign({ v: 1, licenseId: "x", tier: "LIVE", machineHash: sha(machineId), exp: null }), tier: "LIVE" } });
  await license.activate("LC-TEST");
  assert.equal(license.tier(), "live");

  // 2. A forged token (signed with another key) is refused, even offline.
  const forgedKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "license.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ ...saved, tier: "pro", token: sign({ tier: "PRO", machineHash: sha(machineId) }, forgedKey) }));
  delete require.cache[require.resolve(LICENSE)];
  server.validate = "offline";
  const reloaded = require(LICENSE);
  reloaded.start();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(reloaded.tier(), "free", "forged token refused");

  // 3. A real token copied from another computer is refused.
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ ...saved, token: sign({ tier: "LIVE", machineHash: sha("someone-else") }) }));
  delete require.cache[require.resolve(LICENSE)];
  const copied = require(LICENSE);
  copied.start();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(copied.tier(), "free", "another machine's token refused");

  // 4. Offline: a licence validated 3 days ago keeps working; 20 days ago it doesn't.
  for (const [days, expected] of [[3, "live"], [20, "free"]]) {
    fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ ...saved, validatedAt: Date.now() - days * 86400000 }));
    delete require.cache[require.resolve(LICENSE)];
    const offline = require(LICENSE);
    offline.start();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(offline.tier(), expected, `offline for ${days} days`);
  }

  // 5. The server says the licence was revoked → free.
  server.validate = () => ({ status: 403, json: { valid: false, error: "License revoked" } });
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ ...saved, validatedAt: Date.now() }));
  delete require.cache[require.resolve(LICENSE)];
  const revoked = require(LICENSE);
  revoked.start();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(revoked.tier(), "free", "revoked");
  assert.match(revoked.publicState().message, /revoked/);
  console.log("licence tests passed");
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
