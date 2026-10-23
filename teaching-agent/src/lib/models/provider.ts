import "server-only";
import type { ChatModelOption } from "@/lib/models/options";
import { readSseData } from "@/lib/sse";
type ProviderId = ChatModelOption["provider"];

/** 多模态内容：文字，或学生直接上传的图片（data URL） */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export class ModelConfigError extends Error {}

export interface ProviderConfig {
  baseUrl: string;
  chatModel: string;
  chatApiKey: string;
  visionBaseUrl: string;
  visionModel: string;
  visionApiKey: string;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly chatModel: string;
  chat(messages: ChatMessage[], signal?: AbortSignal, model?: string): AsyncIterable<string>;
}

const trim = (u: string) => u.replace(/\/+$/, "");

const STEPFUN_MISSING =
  "未配置 STEPFUN_API_KEY。请复制 .env.example 为 .env.local 并填入你的 StepFun API Key。";
const SCHOOL_MISSING =
  "未配置 SCHOOL_CHAT_BASE_URL（学校内网模型接口地址）。" +
  "若仅做本地测试，可在 .env.local 中设置 MODEL_PROVIDER=stepfun 并填入 StepFun API Key。";

type ProviderBundle = { id: ProviderId; cfg: ProviderConfig };

function preferredProviderId(): ProviderId {
  const id = (process.env.MODEL_PROVIDER || "school").toLowerCase();
  return id === "agnes" ? "agnes" : id === "stepfun" ? "stepfun" : "school";
}

function readAgnes(): ProviderBundle | null {
  const key = process.env.AGNES_API_KEY;
  if (!key) return null;
  const base = trim(process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1");
  const model = process.env.AGNES_CHAT_MODEL || "agnes-3.0-flash";
  return { id: "agnes", cfg: {
    baseUrl: base, chatModel: model, chatApiKey: key,
    visionBaseUrl: base, visionModel: process.env.AGNES_VISION_MODEL || model, visionApiKey: key,
  } };
}

/** 凭证齐了才返回。缺配置时返回 null，不把没接上的模型放进可选列表。 */
function readStepfun(): ProviderBundle | null {
  const key = process.env.STEPFUN_API_KEY;
  if (!key) return null;
  const base = trim(process.env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1");
  return {
    id: "stepfun",
    cfg: {
      baseUrl: base,
      chatModel: process.env.STEPFUN_CHAT_MODEL || "step-3.5-flash",
      chatApiKey: key,
      visionBaseUrl: base,
      visionModel: process.env.STEPFUN_VISION_MODEL || "step-1o-turbo-vision",
      visionApiKey: key,
    },
  };
}

function readSchool(): ProviderBundle | null {
  const chatBase = process.env.SCHOOL_CHAT_BASE_URL;
  if (!chatBase) return null;
  const visionBase = process.env.SCHOOL_VISION_BASE_URL || chatBase;
  return {
    id: "school",
    cfg: {
      baseUrl: trim(chatBase),
      chatModel: process.env.SCHOOL_CHAT_MODEL || "deepseek-v4-flash",
      chatApiKey: process.env.SCHOOL_CHAT_API_KEY || "",
      visionBaseUrl: trim(visionBase),
      visionModel: process.env.SCHOOL_VISION_MODEL || "",
      visionApiKey: process.env.SCHOOL_VISION_API_KEY || process.env.SCHOOL_CHAT_API_KEY || "",
    },
  };
}

function readProvider(id: ProviderId): ProviderBundle | null {
  return id === "agnes" ? readAgnes() : id === "stepfun" ? readStepfun() : readSchool();
}

/** 按环境变量解析出当前使用的模型通道 */
export function resolveProviderConfig(): ProviderBundle {
  const id = preferredProviderId();
  const found = readProvider(id);
  if (!found) throw new ModelConfigError(id === "agnes" ? "未配置 AGNES_API_KEY。" : id === "stepfun" ? STEPFUN_MISSING : SCHOOL_MISSING);
  return found;
}

/**
 * 对话里可以切换的模型：只收「代码已接入、且当前环境凭证齐全」的通道的对话模型。
 * 视觉模型仍由带图消息自动选用，不单列成一个对话选项。
 */
export function listChatModels(): { models: ChatModelOption[]; defaultId: string } {
  const preferred = preferredProviderId();
  const order: ProviderId[] = [preferred, ...(["school", "stepfun", "agnes"] as const).filter(id => id !== preferred)];
  const models: ChatModelOption[] = [];
  for (const id of order) {
    const found = readProvider(id);
    const model = found?.cfg.chatModel.trim() ?? "";
    if (!found || !model) continue;
    models.push({ id: `${id}:${model}`, provider: id, model, label: model });
  }
  const defaultId = models.find((m) => m.provider === preferred)?.id ?? models[0]?.id ?? "";
  return { models, defaultId };
}

/** 只接受白名单 id。缺省或无法识别时用当前通道的默认对话模型。 */
export function resolveChatModel(requested?: string | null): ChatModelOption | null {
  const { models, defaultId } = listChatModels();
  if (!models.length) return null;
  if (requested) {
    const hit = models.find((m) => m.id === requested);
    if (hit) return hit;
  }
  return models.find((m) => m.id === defaultId) ?? models[0];
}

/** OpenAI 兼容接口的实现：school（学校内网）与 stepfun（测试）共用 */
class OpenAICompatProvider implements ModelProvider {
  constructor(
    readonly id: ProviderId,
    private cfg: ProviderConfig,
  ) {}

  get chatModel() {
    return this.cfg.chatModel;
  }

  async *chat(messages: ChatMessage[], signal?: AbortSignal, requestedModel?: string): AsyncIterable<string> {
    const withImage = messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
    );
    let model = requestedModel && requestedModel === this.cfg.chatModel ? requestedModel : this.cfg.chatModel;
    let base = this.cfg.baseUrl;
    let key = this.cfg.chatApiKey;
    if (withImage) {
      if (!this.cfg.visionModel) {
        throw new ModelConfigError(
          "这条消息带了图片，但没有配置视觉模型。请设置当前通道的 VISION_MODEL。文字模型不能看图。",
        );
      }
      model = this.cfg.visionModel;
      base = this.cfg.visionBaseUrl || this.cfg.baseUrl;
      key = this.cfg.visionApiKey || this.cfg.chatApiKey;
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.4,
        // 推理型模型会先用掉一部分输出额度，给足 token 避免卡片 JSON 被截断
        max_tokens: Number(process.env.MODEL_MAX_TOKENS || 4096),
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`对话模型调用失败（${res.status}）：${detail.slice(0, 300)}`);
    }

    for await (const data of readSseData(res.body, signal)) {
      if (data === "[DONE]") break;
      let json;
      try { json = JSON.parse(data); }
      catch { throw new Error("模型返回的流式数据格式错误，请重试"); }
      if (json?.error) throw new Error("模型服务返回错误，请稍后重试");
      const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? "";
      if (typeof delta === "string" && delta) yield delta;
    }
  }

}

export function getProvider(providerId?: ProviderId): ModelProvider {
  if (!providerId) {
    const { id, cfg } = resolveProviderConfig();
    return new OpenAICompatProvider(id, cfg);
  }
  const found = readProvider(providerId);
  if (!found) {
    throw new ModelConfigError(providerId === "agnes" ? "未配置 AGNES_API_KEY。" : providerId === "stepfun" ? STEPFUN_MISSING : SCHOOL_MISSING);
  }
  return new OpenAICompatProvider(found.id, found.cfg);
}
