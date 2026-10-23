import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { findMaterialSection, materialSections } from "@/lib/material-catalog";
import { buildMaterialPdf } from "@/lib/material-pdf";
import { MATERIAL_PDF_VERSION } from "@/lib/material-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE = path.join(process.cwd(), ".cache", "materials", MATERIAL_PDF_VERSION);
const inflight = new Map<string, Promise<string>>();

type MaterialKind = "original" | "questions" | "explain";

function cacheFile(kind: MaterialKind, section?: string) {
  if (kind === "original") return path.join(CACHE, "original.pdf");
  if (kind === "questions") return path.join(CACHE, "questions.pdf");
  const safe = (section ?? "").replace(/[^\w\u4e00-\u9fff·.-]+/g, "_");
  return path.join(CACHE, `explain-${safe}.pdf`);
}

function downloadName(kind: MaterialKind, section?: string) {
  if (kind === "original") return "第六章-原版课件.pdf";
  if (kind === "questions") return "第六章-题目.pdf";
  return `第六章-讲解版-${section}.pdf`;
}

async function fileReady(file: string) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size < 15) return false;
    handle = await open(file, "r");
    const header = Buffer.alloc(5);
    const tail = Buffer.alloc(Math.min(1024, info.size));
    await handle.read(header, 0, header.length, 0);
    await handle.read(tail, 0, tail.length, info.size - tail.length);
    return header.toString("ascii") === "%PDF-" && tail.includes(Buffer.from("%%EOF", "ascii"));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensurePdf(kind: MaterialKind, section?: string) {
  const file = cacheFile(kind, section);
  if (await fileReady(file)) return file;

  const key = `${kind}:${section ?? ""}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    await mkdir(CACHE, { recursive: true });
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    try {
      const pdf = await buildMaterialPdf(kind, section);
      if (pdf.byteLength === 0) throw new Error("PDF 内容为空");
      await writeFile(temporaryFile, pdf, { flag: "wx" });
      await rename(temporaryFile, file);
      if (!(await fileReady(file))) throw new Error("PDF 没有生成出来");
      return file;
    } finally {
      await unlink(temporaryFile).catch(() => undefined);
    }
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawKind = url.searchParams.get("kind");
  if (!rawKind) {
    return Response.json({
      sections: materialSections.map((section) => ({
        id: section.id,
        label: section.label,
        pages: section.pages,
      })),
    });
  }
  if (rawKind !== "original" && rawKind !== "questions" && rawKind !== "explain") {
    return Response.json({ error: "不认识的下载类型" }, { status: 400 });
  }

  const kind: MaterialKind = rawKind;
  const section = url.searchParams.get("section")?.trim() ?? "";
  if (kind === "explain" && !findMaterialSection(section)) {
    return Response.json({ error: "没有这一节" }, { status: 400 });
  }

  try {
    const file = await ensurePdf(kind, kind === "explain" ? section : undefined);
    const bytes = await readFile(file);
    const filename = downloadName(kind, section);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        // 生成逻辑更新后文件名不变，让浏览器每次都取服务器上的新文件
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成 PDF 失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
