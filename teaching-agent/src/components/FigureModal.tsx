"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appPath } from "@/lib/app-path";

export type Figure =
  | { kind: "diagram"; html: string; caption?: string }
  | { kind: "slide"; page: number; caption?: string }
  | { kind: "slides"; pages: number[]; caption?: string }
  | { kind: "image"; src: string; caption?: string };

export const slidePath = (page: number) => appPath(`/slides/slide-${String(page).padStart(3, "0")}.png`);

export function slideFileName(page: number) {
  return `slide-${String(page).padStart(3, "0")}.png`;
}

/** 翻页按钮：自学天地和对话里的翻页弹窗共用同一套，样式别各写一份 */
export const slideArrow =
  "absolute top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full bg-black/30 text-white shadow-sm hover:bg-black/45 hover:text-white disabled:opacity-25";
export const slideArrowOutside =
  "h-9 w-9 shrink-0 rounded-full bg-black/30 text-white shadow-sm hover:bg-black/45 hover:text-white disabled:opacity-25";

/** 流程图 / PPT 页面图的大图查看弹窗 */
export function FigureModal({ figure, onClose }: { figure: Figure | null; onClose: () => void }) {
  useEffect(() => {
    if (!figure) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [figure, onClose]);

  if (!figure) return null;
  const title =
    figure.kind === "slide"
      ? `PPT 第 ${figure.page} 页`
      : figure.kind === "slides"
        ? `PPT ${figure.pages.length} 页`
        : figure.kind === "image"
          ? "上传的图片"
          : "示意图";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-2 backdrop-blur-[2px] sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-2.5">
          <span className="text-[13px] font-medium">{title}</span>
          {figure.caption ? (
            <span className="truncate text-[12px] text-ink-faint">{figure.caption}</span>
          ) : null}
          <button
            onClick={onClose}
            className="ml-auto shrink-0 rounded-md px-3 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:bg-paper-soft hover:text-ink"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-paper-soft p-2 sm:p-4">
          {figure.kind === "slides" ? (
            <div className="grid gap-3">
              {figure.pages.map((page) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={page}
                  src={slidePath(page)}
                  alt={`PPT 第 ${page} 页`}
                  className="mx-auto w-full rounded-lg bg-white shadow ring-1 ring-paper-line"
                />
              ))}
            </div>
          ) : figure.kind === "slide" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={slidePath(figure.page)}
              alt={`PPT 第 ${figure.page} 页`}
              className="mx-auto w-full rounded-lg bg-white shadow ring-1 ring-paper-line"
            />
          ) : figure.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={figure.src}
              alt={figure.caption || "上传的图片"}
              className="mx-auto max-h-[70dvh] w-auto rounded-lg bg-white shadow ring-1 ring-paper-line"
            />
          ) : (
            <iframe
              title="示意图"
              sandbox=""
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>
                body{margin:0;padding:16px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#faf9f6;color:#1a1a18}
                svg{max-width:100%;height:auto} table{border-collapse:collapse;margin:0 auto}
                td,th{border:1px solid #d6d6d0;padding:6px 10px;font-size:13px}
                .box,.node{border:1px solid #b9b9b2;border-radius:8px;padding:8px 12px;background:#fff}
              </style></head><body>${figure.html}</body></html>`}
              className="h-[65dvh] w-full rounded-lg bg-white sm:h-[70vh]"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 一套 PPT：对话框里的缩略图条，点开进翻页弹窗 */
export function SlideStrip({
  pages,
  onOpen,
}: {
  pages: number[];
  onOpen: (index: number) => void;
}) {
  if (!pages.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] text-ink-faint">
          {pages.length === 1 ? `PPT 第 ${pages[0]} 页` : `PPT ${pages.length} 页`}
        </span>
        <span className="text-[11px] text-ink-faint">点开可翻页、放大、下载</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((page, i) => (
          <button
            key={page}
            type="button"
            onClick={() => onOpen(i)}
            className="shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-paper-line transition-opacity hover:opacity-80"
            title={`第 ${page} 页`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slidePath(page)} alt={`第 ${page} 页`} className="h-28 w-auto" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** 在可用框里按原图宽高比 contain：取宽、高两个方向里更紧的那个比例 */
function containSlide(frame: { w: number; h: number }, natural: { w: number; h: number }) {
  if (frame.w <= 1 || frame.h <= 1 || natural.w <= 0 || natural.h <= 0) return null;
  const scale = Math.min(frame.w / natural.w, frame.h / natural.h);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    w: Math.min(frame.w, natural.w * scale),
    h: Math.min(frame.h, natural.h * scale),
  };
}

/** 放大查看一套 PPT，可前后翻页并下载当前页 */
export function SlideGallery({
  pages,
  index,
  onIndex,
  onClose,
}: {
  pages: number[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
      if (e.key === "ArrowRight") onIndex(Math.min(pages.length - 1, index + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onIndex, pages.length]);

  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setFrame((prev) =>
        Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5 ? prev : { w: width, h: height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const page = pages[index];
  if (!page) return null;

  const fitted = containSlide(frame, natural);

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div className="absolute inset-2 flex flex-col items-center sm:inset-4">
        <div
          className="flex h-full min-h-0 w-full min-w-0 max-w-4xl flex-1 flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-paper-line px-3 py-2.5 sm:px-4">
            <span className="min-w-0 truncate text-[13px] font-medium">
              第 {page} 页
              <span className="ml-2 text-[12px] font-normal text-ink-faint">
                {index + 1} / {pages.length}
              </span>
            </span>
            <a
              href={slidePath(page)}
              download={slideFileName(page)}
              className="ml-auto shrink-0 rounded-md px-2 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink sm:px-3"
            >
              下载这一页
            </a>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md px-2 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:bg-paper-soft hover:text-ink sm:px-3"
            >
              关闭
            </button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-1 bg-paper-soft p-2 sm:gap-2 sm:p-4">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="上一页"
              disabled={index <= 0}
              onClick={() => onIndex(index - 1)}
              className={`self-center ${slideArrowOutside}`}
            >
              <ChevronLeft />
            </Button>
            <div ref={frameRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={page}
                src={slidePath(page)}
                alt={`PPT 第 ${page} 页`}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
                style={
                  fitted
                    ? { width: fitted.w, height: fitted.h }
                    : { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }
                }
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white object-contain shadow ring-1 ring-paper-line"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="下一页"
              disabled={index >= pages.length - 1}
              onClick={() => onIndex(index + 1)}
              className={`self-center ${slideArrowOutside}`}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FigureChip({
  figure,
  onClick,
  label,
}: {
  figure: Figure;
  onClick: () => void;
  label?: string;
}) {
  const text =
    label ??
    (figure.kind === "slide"
      ? `查看 PPT 第 ${figure.page} 页`
      : figure.kind === "slides"
        ? `查看这 ${figure.pages.length} 页 PPT`
        : "查看示意图");
  return (
    <button
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
    >
      <span className="inline-block h-3 w-3 rounded-sm border border-ink-faint" />
      {text}
    </button>
  );
}
