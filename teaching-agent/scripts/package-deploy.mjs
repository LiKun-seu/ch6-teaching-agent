import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const [buildArgument, outputArgument, fontArgument] = process.argv.slice(2);
if (!buildArgument || !outputArgument || !fontArgument) throw new Error("用法：node scripts/package-deploy.mjs <构建目录> <输出.tar.gz> <中文.ttf>");
const build = path.resolve(buildArgument);
const output = path.resolve(outputArgument);
const app = process.cwd();
const files = JSON.parse(fs.readFileSync(path.join(build, ".next", "required-server-files.json"), "utf8"));
if (files.config.basePath !== "/teachdemo") throw new Error("请先使用 NEXT_PUBLIC_BASE_PATH=/teachdemo 进行生产构建");
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "teachdemo-release-"));
fs.mkdirSync(path.dirname(output), { recursive: true });
for (const file of ["package.json", "package-lock.json", "next.config.mjs"]) fs.copyFileSync(path.join(build, file), path.join(staging, file));
for (const folder of ["public", "src/content", "deploy"]) fs.cpSync(path.join(build, folder), path.join(staging, folder), { recursive: true });
fs.cpSync(path.join(build, ".next"), path.join(staging, ".next"), {
  recursive: true,
  filter: source => !path.relative(path.join(build, ".next"), source).split(path.sep).includes("cache") && path.basename(source) !== "trace",
});
fs.mkdirSync(path.join(staging, "deploy-assets"));
fs.copyFileSync(path.resolve(fontArgument), path.join(staging, "deploy-assets", "NotoSansSC.ttf"));
fs.copyFileSync(path.join(path.dirname(path.resolve(fontArgument)), "OFL.txt"), path.join(staging, "deploy-assets", "OFL.txt"));
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: app, encoding: "utf8" }).trim();
fs.writeFileSync(path.join(staging, "DEPLOYMENT.json"), JSON.stringify({ revision, basePath: "/teachdemo", buildId: fs.readFileSync(path.join(build, ".next/BUILD_ID"), "utf8").trim(), createdAt: new Date().toISOString() }, null, 2));
execFileSync("tar", ["-czf", output, "-C", staging, "."], { stdio: "inherit" });
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
fs.writeFileSync(output + ".sha256", sha256 + "\n");
console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, sha256, revision }));
