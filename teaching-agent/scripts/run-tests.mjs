import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Pass explicit filenames so Windows and POSIX shells discover the same tests.
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter(name => name.endsWith(".test.mjs"))
  .sort()
  .map(name => `tests/${name}`);
if (!files.length) throw new Error("No regression test files found");
const result = spawnSync(process.execPath, ["--import", "./scripts/register-ts.mjs", "--test", ...files], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
