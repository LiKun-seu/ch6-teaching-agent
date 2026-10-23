import { getProvider, resolveChatModel } from "@/lib/models/provider";
import { DigestRequestSchema, readJson, RequestValidationError } from "@/lib/request-validation";
import { requestScope, requestError } from "@/lib/request-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `你是笔记整理员。学生在自学《钢筋混凝土梁承载力计算原理》时收藏了一些片段、课件页和做错的题。
把收藏整理成一份可以打印的学习笔记，用 Markdown 分 2~4 个小节。
保留原文公式（LaTeX）和关键句；错题单独成节，说明错在哪里，不直接给最终数值答案。
只根据给出的收藏写，没有的内容不要编。不要出卡片，不要问学生问题。`;

export async function POST(req: Request) {
  let body;
  try { body = await readJson(req, DigestRequestSchema); }
  catch (error) {
    return Response.json({ error: requestError(error, req.signal) }, { status: error instanceof RequestValidationError ? error.status : req.signal.aborted ? 408 : 500 });
  }
  const notes = body.notes.filter(note => note.text.trim() || note.hasImage);
  if (!notes.length) return Response.json({ error: "还没有可导出的笔记" }, { status: 400 });
  const textNotes = notes.filter(note => note.text.trim());
  if (!textNotes.length) return Response.json({ markdown: "", summarized: false });
  const choice = resolveChatModel();
  if (!choice) return Response.json({
    markdown: textNotes.map(note => `## ${note.title || "笔记"}\n\n${note.text}`).join("\n\n"), summarized: false,
  });
  const scope = requestScope(req.signal);
  try {
    const provider = getProvider(choice.provider);
    const packed = textNotes.map((note, index) => `${index + 1}. [${note.kind}] ${note.title}\n${note.text}`).join("\n\n");
    let markdown = "";
    for await (const delta of provider.chat([
      { role: "system", content: SYSTEM }, { role: "user", content: packed },
    ], scope.signal, choice.model)) markdown += delta;
    scope.signal.throwIfAborted();
    if (!markdown.trim()) throw new Error("模型没有返回笔记内容，请重试");
    return Response.json({ markdown: markdown.trim(), summarized: true });
  } catch (error) {
    return Response.json({ error: requestError(error, scope.signal) }, { status: req.signal.aborted ? 408 : scope.signal.aborted ? 504 : 502 });
  } finally { scope.dispose(); }
}
