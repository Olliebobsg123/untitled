// Syntax-checks every script in the app: npm run test:syntax
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = ["main.js", "preload.js"];
for (const dir of ["main", "js", "scripts"]) {
  for (const name of fs.readdirSync(path.join(root, dir))) if (name.endsWith(".js")) files.push(path.join(dir, name));
}
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  } catch (error) {
    failed += 1;
    console.error(`✕ ${file}\n${String(error.stderr || error.message)}`);
  }
}
console.log(failed ? `${failed} file(s) have errors.` : `All ${files.length} files OK.`);
process.exit(failed ? 1 : 0);
