import { getProvider, resolveChatModel } from "@/lib/models/provider";
import { buildSystemPrompt } from "@/lib/prompt";
import { createChatParser, type StreamEvent } from "@/lib/chat-protocol";
import { ChatRequestSchema, readJson, RequestValidationError } from "@/lib/request-validation";
import { requestScope, requestError } from "@/lib/request-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.signal.aborted) return Response.json({ error: "请求已停止" }, { status: 408 });
  let body;
  let system: string;
  try {
    body = await readJson(req, ChatRequestSchema);
    system = await buildSystemPrompt(body.pageContext ?? null);
  } catch (error) {
    return Response.json({ error: requestError(error, req.signal) }, {
      status: error instanceof RequestValidationError ? error.status : req.signal.aborted ? 408 : 500,
    });
  }
  const choice = resolveChatModel(body.model);
  const scope = requestScope(req.signal);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (closed || req.signal.aborted) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { closed = true; scope.abort(); }
      };
      void (async () => {
        try {
          scope.signal.throwIfAborted();
          if (!choice) send({ type: "error", message: "没有可用的对话模型。请先配好模型通道。" });
          else {
            const parser = createChatParser(send);
            const provider = getProvider(choice.provider);
            for await (const delta of provider.chat([{ role: "system", content: system }, ...body.messages], scope.signal, choice.model)) {
              scope.signal.throwIfAborted();
              parser.push(delta);
            }
            parser.end();
          }
        } catch (error) {
          if (!req.signal.aborted) send({ type: "error", message: requestError(error, scope.signal) });
        } finally {
          send({ type: "done" });
          if (!closed) { closed = true; controller.close(); }
          scope.dispose();
        }
      })();
    },
    cancel() { closed = true; scope.abort(); scope.dispose(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
