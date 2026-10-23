import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
// 仅供 Node 测试脚本使用；应用构建仍由 Next.js 处理。
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only" || specifier.endsWith(".css")) return { url: "data:text/javascript,export default {}", shortCircuit: true };
  let candidate;
  if (specifier.startsWith("@/")) candidate = path.join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) candidate = fileURLToPath(new URL(specifier, context.parentURL));
  if (candidate) {
    const found = [candidate, candidate + ".ts", candidate + ".tsx"].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.(ts|tsx|json)$/.test(url)) {
    const source = fs.readFileSync(fileURLToPath(url), "utf8");
    if (url.endsWith(".json")) return { format: "module", source: `export default ${source};`, shortCircuit: true };
    return { format: "module", source: ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: fileURLToPath(url) }).outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
