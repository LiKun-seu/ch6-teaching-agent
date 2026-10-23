import { classroomHttp } from "@/lib/classroom/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(req: Request, context: Context) { return classroomHttp(req, (await context.params).path ?? [], false); }
export async function POST(req: Request, context: Context) { return classroomHttp(req, (await context.params).path ?? [], false); }
