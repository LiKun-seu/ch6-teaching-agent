import { buildQuestionsPreviewSvg } from "@/lib/material-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 资料下载页用：题目 PDF 第一页的缩略图 */
export async function GET() {
  try {
    const svg = await buildQuestionsPreviewSvg();
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成预览失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
