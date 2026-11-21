// Windows: when the cwd has a lowercase drive letter (e.g. VS Code's "c:\..."), Vitest 5 loads its
// runner twice under different module URLs and every suite fails with
// "Cannot read properties of undefined (reading 'config')". Re-spawn with a normalized drive letter.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const vitestCli = join(cwd, "node_modules", "vitest", "vitest.mjs");
const res = spawnSync(process.execPath, [vitestCli, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(res.status ?? 1);
