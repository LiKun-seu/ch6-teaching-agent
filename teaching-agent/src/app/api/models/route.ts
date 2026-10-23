import { listChatModels } from "@/lib/models/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 当前环境已经接好的对话模型。不返回地址或密钥。 */
export async function GET() {
  const { models, defaultId } = listChatModels();
  return Response.json({ models, defaultId });
}
