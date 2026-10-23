import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("课件质检遇到损坏内容返回非零状态，不能只打印失败后放行 CI", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "teaching-content-qa-"));
  try {
    fs.mkdirSync(path.join(directory, "src", "content"), { recursive: true });
    const file = path.join(directory, "src", "content", "slide-notes.json");
    const script = fileURLToPath(new URL("../scripts/qa-slide-notes.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8", timeout: 15_000 });
    fs.writeFileSync(file, JSON.stringify({ "1": { title: "有效测试标题", points: ["这里是一条完整的课件测试要点"], keys: ["课件"] } }));
    const valid = run();
    assert.ifError(valid.error);
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    fs.writeFileSync(file, JSON.stringify({ "1": { title: "", points: [], keys: [] } }));
    const invalid = run();
    assert.ifError(invalid.error);
    assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
    assert.match(invalid.stdout, /需先修正上述问题/);
  } finally {
    // Only remove the exact temporary directory just created for this test.
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
