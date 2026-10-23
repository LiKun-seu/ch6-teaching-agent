import { BASE_PATH } from "@/lib/app-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", basePath: BASE_PATH }, { headers: { "Cache-Control": "no-store" } });
}
