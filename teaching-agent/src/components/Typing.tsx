"use client";

/** 等待首个 token 时的思考动画 */
export function Thinking({ label = "老师在想…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-paper-line opacity-70" />
        <span className="relative flex h-4 w-4 items-center justify-center gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full bg-ink-faint"
              style={{ animation: "ch6-bounce 1.2s ease-in-out infinite", animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </span>
      </span>
      <span className="text-[13px] text-ink-faint">{label}</span>
      <span className="h-[3px] w-24 overflow-hidden rounded-full bg-paper-line">
        <span className="block h-full w-1/3 rounded-full bg-ink-faint/50 ch6-shimmer" />
      </span>
    </div>
  );
}

/** 流式输出时的打字光标 */
export function StreamingCaret() {
  return (
    <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-ink/70" />
  );
}
