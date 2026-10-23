"use client";

import { useId, useRef } from "react";
import { ArrowUp, ImagePlus, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChatModelOption } from "@/lib/models/options";
import { MAX_MESSAGE_CHARS } from "@/lib/request-limits";

type Brand = "stepfun" | "deepseek" | "qwen";

/** 按模型名识别厂牌。后面接 DeepSeek、千问时不用改选择器结构。 */
function brandOf(model?: Pick<ChatModelOption, "provider" | "model" | "label"> | null): Brand | null {
  const s = `${model?.provider ?? ""} ${model?.model ?? ""} ${model?.label ?? ""}`.toLowerCase();
  if (s.includes("qwen") || s.includes("千问") || s.includes("qwq")) return "qwen";
  if (s.includes("deepseek")) return "deepseek";
  if (s.includes("stepfun") || s.includes("step-") || s.includes("step_")) return "stepfun";
  return null;
}

function StepfunMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path
        d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zM8.762 19.614H4.376v-4.386h4.386v4.386zm5.423 0H9.798v-4.386h4.387v4.386zm0-5.42H9.798V9.81h4.387v4.386zm0-5.418H9.798V4.39h4.387v4.386zm5.422-.004h-4.386V4.386h4.386v4.386z"
        fill="#005AFF"
        fillRule="evenodd"
      />
    </svg>
  );
}

function DeepSeekMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path
        d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"
        fill="#4D6BFE"
      />
    </svg>
  );
}

function QwenMark() {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path
        d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z"
        fill={`url(#${id})`}
        fillRule="nonzero"
      />
      <defs>
        <linearGradient id={id} x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="#6336E7" stopOpacity="0.84" />
          <stop offset="100%" stopColor="#6F69F7" stopOpacity="0.84" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ModelIcon({ model }: { model?: ChatModelOption | null }) {
  const brand = brandOf(model);
  if (brand === "stepfun") return <StepfunMark />;
  if (brand === "deepseek") return <DeepSeekMark />;
  if (brand === "qwen") return <QwenMark />;
  return <Sparkles className="size-3.5 shrink-0 text-ink-soft" aria-hidden />;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onImage,
  blocked,
  busy,
  pendingImages = [],
  onRemoveImage,
  quote,
  onClearQuote,
  models = [],
  modelId = null,
  onModelChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onImage: (file: File) => void;
  blocked: boolean;
  busy: boolean;
  pendingImages?: string[];
  onRemoveImage?: (index: number) => void;
  quote?: string | null;
  onClearQuote?: () => void;
  models?: ChatModelOption[];
  modelId?: string | null;
  onModelChange?: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !blocked && !busy && (!!value.trim() || pendingImages.length > 0 || !!quote);
  const selected = models.find((m) => m.id === modelId) ?? null;

  const takeImages = (files: File[]) => {
    for (const f of files) {
      if (f.type.startsWith("image/")) onImage(f);
    }
  };

  return (
    <div className="bg-background px-4 pt-2 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] sm:px-8 sm:pb-8">
      <div className="mx-auto max-w-chat">
        {quote ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-paper-line bg-paper px-3 py-2">
            <span className="mt-0.5 shrink-0 rounded bg-ink px-1.5 py-0.5 text-[11px] text-paper">追问</span>
            <span className="line-clamp-2 flex-1 text-[12px] leading-5 text-ink-soft">{quote}</span>
            <button
              type="button"
              onClick={onClearQuote}
              className="-my-1 -mr-1 shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-faint hover:text-ink"
            >
              取消
            </button>
          </div>
        ) : null}

        {pendingImages.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {pendingImages.map((src, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-paper-line" />
                <button
                  type="button"
                  onClick={() => onRemoveImage?.(i)}
                  title="移除这张图片"
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-paper-line bg-paper text-[11px] leading-none text-ink-faint hover:text-ink"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-1 rounded-3xl border bg-card px-2 py-2 shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileRef.current?.click()}
            disabled={blocked || busy}
            title="上传或粘贴图片"
            className="shrink-0"
          >
            <ImagePlus />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              takeImages([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <textarea
            maxLength={MAX_MESSAGE_CHARS}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              takeImages(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            rows={1}
            disabled={blocked || busy}
            placeholder={blocked ? "先回答上面的卡片，才能继续" : ""}
            className="max-h-40 min-h-[36px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-7 outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
          />
          <Select
            value={selected ? selected.id : undefined}
            onValueChange={(id) => onModelChange?.(id)}
            disabled={models.length === 0}
          >
            <SelectTrigger
              aria-label="选择模型"
              title={selected?.label || "选择模型"}
              className="h-9 w-max min-w-0 max-w-[calc(100%-6.25rem)] shrink justify-start gap-1 overflow-hidden border-0 bg-transparent px-0 pl-1.5 pr-0 text-[12px] shadow-none focus:ring-0 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0"
            >
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent side="top" align="end" className="z-[60]">
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} textValue={m.label}>
                  <span className="flex items-center gap-1.5">
                    <ModelIcon model={m} />
                    {m.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {busy ? (
            <Button type="button" size="icon" className="shrink-0 rounded-full" onClick={onStop} aria-label="停止生成" title="停止生成">
              <Square />
            </Button>
          ) : (
            <Button type="button" size="icon" className="shrink-0 rounded-full" onClick={onSend} disabled={!canSend} aria-label="发送">
              <ArrowUp />
            </Button>
          )}
        </div>

        {blocked ? (
          <div className="mt-2 h-4 text-center text-[11px] text-ink-faint">先回答上面的卡片，才能继续</div>
        ) : null}
      </div>
    </div>
  );
}
