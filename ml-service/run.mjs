// Cross-platform launcher so the Python service can be driven from npm scripts:
//   node ml-service/run.mjs setup              create .venv and install requirements
//   node ml-service/run.mjs pytest [...]       run the Python tests
//   node ml-service/run.mjs <cmd> [...]        python -m tusky_ml <cmd> [...]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";
const venvPython = join(root, ".venv", isWin ? "Scripts/python.exe" : "bin/python");
const [cmd = "--help", ...rest] = process.argv.slice(2);

function run(exe, args, cwd = root) {
  // Commands run from the caller's directory (so relative paths work); PYTHONPATH finds tusky_ml.
  const env = { ...process.env, PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(isWin ? ";" : ":") };
  const res = spawnSync(exe, args, { cwd, env, stdio: "inherit" });
  if (res.error) {
    console.error(`[ml] failed to start ${exe}: ${res.error.message}`);
    process.exit(1);
  }
  return res.status ?? 1;
}

if (cmd === "setup") {
  if (!existsSync(venvPython)) {
    const status = run(isWin ? "python" : "python3", ["-m", "venv", ".venv"]);
    if (status) process.exit(status);
  }
  process.exit(run(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"]));
}

if (!existsSync(venvPython)) {
  console.error("[ml] Python env missing. Run `npm run ml:setup` first (needs Python 3.11+).");
  process.exit(1);
}

if (cmd === "pytest") process.exit(run(venvPython, ["-m", "pytest", ...rest], root));
process.exit(run(venvPython, ["-m", "tusky_ml", cmd, ...rest], process.cwd()));
