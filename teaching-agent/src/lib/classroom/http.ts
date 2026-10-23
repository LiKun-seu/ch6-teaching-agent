import "server-only";
import { z } from "zod";
import { appPath } from "../app-path";
import { readJson, RequestValidationError } from "../request-validation";
import { classroomCatalog, classroomQuestion } from "./catalog";
import { ClassroomError, classroomStore, digest, STUDENT_AGE, TEACHER_AGE } from "./store";
import { classroomEvents } from "./stream";

export const TEACHER_COOKIE = "ch6_classroom_teacher";
export const STUDENT_COOKIE = "ch6_classroom_student";
export function cookie(req: Request, name: string) {
  const value = req.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="))?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function setCookie(name: string, value: string, age: number) {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${appPath("/")}; Max-Age=${Math.floor(age / 1000)}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function publicOrigin() {
  const configured = process.env.CLASSROOM_PUBLIC_ORIGIN;
  if (!configured) throw new ClassroomError("请配置手机可访问的 CLASSROOM_PUBLIC_ORIGIN（仅 origin，不含子路径）", 503);
  let url: URL;
  try { url = new URL(configured); } catch { throw new ClassroomError("CLASSROOM_PUBLIC_ORIGIN 格式无效", 503); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new ClassroomError("CLASSROOM_PUBLIC_ORIGIN 必须是无子路径的 http(s) origin", 503);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new ClassroomError("入课地址不能使用 localhost，请配置手机可访问的域名或局域网 IP", 503);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new ClassroomError("生产课堂必须配置 HTTPS origin", 503);
  return url.origin;
}
export function joinUrl(code: string) { return publicOrigin() + appPath(`/join/${code}`); }
function originGuard(req: Request) {
  const origin = req.headers.get("origin");
  const expected = process.env.CLASSROOM_PUBLIC_ORIGIN ? new URL(process.env.CLASSROOM_PUBLIC_ORIGIN).origin : new URL(req.url).origin;
  if (req.headers.get("sec-fetch-site") === "cross-site" || origin !== expected) throw new ClassroomError("请求来源无效，请从本站重新进入课堂", 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new ClassroomError("请使用 JSON 提交", 415);
}
const requestId = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const authBody = z.object({ accessCode: text(256) }).strict();
const createBody = z.object({ title: text(100), requestId }).strict();
const publishBody = z.object({ questionId: text(120), requestId }).strict();
const answerBody = z.object({ answer: text(2000), requestId }).strict();
const joinBody = z.object({ code: z.string().regex(/^\d{6}$/), name: text(60), studentNo: z.string().trim().max(80).default("") }).strict();
const emptyBody = z.object({}).strict();
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
const body = <T extends z.ZodTypeAny>(req: Request, schema: T) => readJson(req, schema, 16_384);

export async function classroomHttp(req: Request, paths: string[], student: boolean) {
  try {
    const method = req.method;
    if (method !== "GET" && method !== "POST") throw new ClassroomError("不支持的请求方法", 405);
    if (method === "POST") originGuard(req);
    if (!student && paths.join("/") === "teacher-session" && method === "GET") {
      return json({ configured: Boolean(process.env.CLASSROOM_TEACHER_ACCESS_CODE) });
    }
    const store = classroomStore();
    const teacherToken = cookie(req, TEACHER_COOKIE), studentToken = cookie(req, STUDENT_COOKIE);
    // Only the trusted local Nginx may set X-Real-IP in production. Never reuse AI connection limits.
    const ip = digest(req.headers.get("x-real-ip") || "direct");
    if (student && paths.join("/") === "session" && method === "POST") {
      store.limit("device:" + ip, 600);
      await body(req, emptyBody);
      const raw = store.deviceSession(studentToken);
      return json({ ready: true }, 200, { "Set-Cookie": setCookie(STUDENT_COOKIE, raw, STUDENT_AGE) });
    }
    if (!student && paths.join("/") === "teacher-session" && method === "POST") {
      store.limit("login:" + ip, 20, 900_000);
      const { accessCode } = await body(req, authBody);
      const raw = store.login(accessCode, teacherToken);
      return json({ authenticated: true }, 200, { "Set-Cookie": setCookie(TEACHER_COOKIE, raw, TEACHER_AGE) });
    }
    if (student && paths.join("/") === "join" && method === "POST") {
      store.limit("join:" + ip, 600);
      const { code, name, studentNo } = await body(req, joinBody);
      const result = store.join(code, name, studentNo, studentToken);
      return json({ classroomId: result.classroomId }, 200, { "Set-Cookie": setCookie(STUDENT_COOKIE, result.token, STUDENT_AGE) });
    }
    const owner = student ? undefined : store.teacher(teacherToken);
    if (method === "POST") store.limit("command:" + digest((student ? studentToken : teacherToken) || "anonymous"), 120);
    if (!student && !paths.length) {
      if (method === "GET") return json({ classrooms: store.list(owner!) });
      const { title, requestId } = await body(req, createBody);
      publicOrigin(); // Refuse an unusable QR configuration before creating durable state.
      return json({ classroom: store.create(owner!, title, requestId) }, 201);
    }
    if (!student && paths.join("/") === "catalog" && method === "GET") return json({ questions: classroomCatalog() });
    const [id, action, roundId, roundAction] = paths;
    if (!z.string().uuid().safeParse(id).success) throw new ClassroomError("课堂不存在", 404);
    if (student) store.participant(studentToken, id); else store.owned(owner!, id);
    const snapshot = () => student ? store.studentSnapshot(studentToken, id) : store.teacherSnapshot(owner!, id);
    if (paths.length === 1 && method === "GET") return json(snapshot());
    if (paths.length === 2 && action === "events" && method === "GET") {
      return classroomEvents(req, store, id, (student ? "s:" : "t:") + digest((student ? studentToken : teacherToken)!), () => {
        if (!student) store.teacher(teacherToken);
        return snapshot();
      }, student ? 2 : 4);
    }
    if (!student && paths.length === 2 && action === "invite" && method === "GET") {
      const c = store.owned(owner!, id);
      const { qrSvg } = await import("./qr");
      return json({ url: joinUrl(String(c.code)), svg: qrSvg(joinUrl(String(c.code))) });
    }
    if (method !== "POST") throw new ClassroomError("接口不存在", 404);
    if (!student && paths.length === 2) {
      if (action === "rounds") {
        const data = await body(req, publishBody);
        store.publish(owner!, id, classroomQuestion(data.questionId), data.requestId);
      } else {
        await body(req, emptyBody);
        if (action === "start") store.start(owner!, id);
        else if (action === "end") store.end(owner!, id);
        else throw new ClassroomError("接口不存在", 404);
      }
    } else if (paths.length === 4 && action === "rounds" && z.string().uuid().safeParse(roundId).success) {
      if (student && roundAction === "answer") {
        const data = await body(req, answerBody);
        store.answer(studentToken, id, roundId, data.answer, data.requestId);
      } else if (!student && (roundAction === "close" || roundAction === "reveal")) {
        await body(req, emptyBody);
        store.changeRound(owner!, id, roundId, roundAction);
      } else throw new ClassroomError("接口不存在", 404);
    } else throw new ClassroomError("接口不存在", 404);
    return json(snapshot());
  } catch (error) {
    if (error instanceof ClassroomError || error instanceof RequestValidationError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
    console.error("Classroom request failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "课堂服务暂不可用，请稍后重试" }, 503);
  }
}
