import { z } from "zod";

import { MAX_IMAGE_URL_LENGTH, MAX_REQUEST_BYTES, MAX_MESSAGE_CHARS, MAX_HISTORY_CHARS } from "./request-limits";
export const PageContextSchema = z.object({
  page: z.number().int().min(0).max(148),
  section: z.string().max(100).optional(),
  title: z.string().max(1000).optional(),
  bullets: z.array(z.string().max(5000)).max(8).optional(),
  classmate: z.boolean().optional(),
});
const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(MAX_MESSAGE_CHARS) }),
  z.object({ type: z.literal("image_url"), image_url: z.object({
    url: z.string().max(MAX_IMAGE_URL_LENGTH).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/, "图片格式不支持或数据损坏"),
  }) }),
]);
export const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.union([z.string().max(MAX_MESSAGE_CHARS), z.array(ContentPartSchema).min(1).max(5)]),
  })).max(24).default([]),
  pageContext: PageContextSchema.nullish(),
  model: z.string().max(200).nullish(),
}).superRefine((body, ctx) => {
  let textLength = 0;
  for (const message of body.messages) {
    if (typeof message.content === "string") textLength += message.content.length;
    else for (const part of message.content) if (part.type === "text") textLength += part.text.length;
  }
  if (textLength > MAX_HISTORY_CHARS) ctx.addIssue({ code: "custom", message: "对话文字过长，请开始新的对话" });
});
export const DigestRequestSchema = z.object({
  notes: z.array(z.object({
    title: z.string().max(1000).default(""),
    kind: z.enum(["text", "page", "element", "question"]).default("text"),
    text: z.string().max(20_000).default(""),
    hasImage: z.boolean().optional(),
  })).min(1).max(80),
}).refine(body => body.notes.reduce((n, note) => n + note.text.length, 0) <= 100_000, "笔记文字过长，请分批导出");

export class RequestValidationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function readJson<T extends z.ZodTypeAny>(req: Request, schema: T, maxBytes = MAX_REQUEST_BYTES): Promise<z.infer<T>> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > maxBytes) throw new RequestValidationError("请求过大，请减少内容后重试", 413);
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) while (true) {
      req.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestValidationError("请求过大，请减少内容后重试", 413);
      chunks.push(value);
    }
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestValidationError("请求体不是合法 JSON"); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RequestValidationError(`请求参数无效：${parsed.error.issues[0].path.join(".") || "body"} ${parsed.error.issues[0].message}`);
  return parsed.data;
}
