"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, MessageSquarePlus } from "lucide-react";
import { motion } from "motion/react";
import elementsJson from "@/content/slide-elements.json";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAiDrawer } from "./AiDrawer";
import { pageNoteTitle, useNotes } from "./notes";
import { appPath } from "@/lib/app-path";

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number; text: string };

const elements = elementsJson as Record<string, Box[]>;

const slideSrc = (page: number) => appPath(`/slides/slide-${String(page).padStart(3, "0")}.png`);

/** 整页导出的背景图会盖住所有内容，不能当作可选区域 */
function isWholePage(box: Box) {
  return box.w >= 0.92 && box.h >= 0.92;
}

function selectable(box: Box) {
  return (box.kind === "text" || box.kind === "image") && !isWholePage(box) && box.w > 0.01 && box.h > 0.01;
}

/** 按元素框从课件图上裁出这一块，失败时返回 null */
async function cropRegion(src: string, box: Box): Promise<string | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return null;
    const x = Math.max(0, Math.min(1, box.x));
    const y = Math.max(0, Math.min(1, box.y));
    const w = Math.max(0, Math.min(box.w, 1 - x));
    const h = Math.max(0, Math.min(box.h, 1 - y));
    if (w <= 0 || h <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * nw));
    canvas.height = Math.max(1, Math.round(h * nh));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, x * nw, y * nh, w * nw, h * nh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** 一页 PPT 上的文字框 / 图。点中后选择加入对话或收藏，不能选整页背景 */
export function SlideStage({ page, alt }: { page: number; alt: string }) {
  const boxes = (elements[String(page)] ?? [])
    .filter(selectable)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const { add } = useNotes();
  const { attach } = useAiDrawer();
  const src = slideSrc(page);
  const rootRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    setPicked(null);
  }, [page]);

  useEffect(() => {
    if (!picked) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPicked(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [picked]);

  const pickedBox = boxes.find((b) => b.id === picked) ?? null;

  const favorite = async (box: Box) => {
    setActing(true);
    try {
      const image = (await cropRegion(src, box)) ?? src;
      add({
        kind: "element",
        title: pageNoteTitle(page) ?? `第 ${page} 页`,
        text: "",
        image,
      });
      setPicked(null);
    } finally {
      setActing(false);
    }
  };

  const addToChat = async (box: Box) => {
    setActing(true);
    try {
      const text = box.text.trim();
      const image = box.kind === "image" || !text ? await cropRegion(src, box) : null;
      attach({
        text: text || undefined,
        image: image ?? undefined,
      });
      setPicked(null);
    } finally {
      setActing(false);
    }
  };

  const placeAbove = pickedBox ? pickedBox.y + pickedBox.h > 0.72 : false;
  const anchorX = pickedBox ? Math.min(82, Math.max(18, (pickedBox.x + pickedBox.w / 2) * 100)) : 50;
  const anchorY = pickedBox ? (placeAbove ? pickedBox.y : pickedBox.y + pickedBox.h) * 100 : 0;

  return (
      <div className="relative" ref={rootRef}>
        <div className="relative overflow-hidden rounded-2xl border border-paper-line bg-paper">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="block w-full" />
          {boxes.map((box) => {
            const on = box.id === picked;
            return (
              <button
                key={box.id}
                type="button"
                title={box.text || "图片"}
                aria-pressed={on}
                onClick={() => setPicked((id) => (id === box.id ? null : box.id))}
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
                className={`absolute rounded-sm border transition-shadow ${
                  on
                    ? "z-10 border-amber-400 bg-amber-100/30 shadow-[0_0_0_2px_rgba(251,191,36,0.95),0_0_16px_rgba(245,158,11,0.7)]"
                    : "border-transparent hover:border-amber-300 hover:bg-amber-100/25 hover:shadow-[0_0_0_1px_rgba(252,211,77,0.95),0_0_12px_rgba(251,191,36,0.5)]"
                }`}
              />
            );
          })}
        </div>
        {pickedBox ? (
          <motion.div
            key={pickedBox.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute z-20"
            style={{ left: `${anchorX}%`, top: `${anchorY}%` }}
          >
            <div
              className={placeAbove ? "-translate-x-1/2 -translate-y-[calc(100%+8px)]" : "-translate-x-1/2 translate-y-2"}
            >
            <Card className="flex gap-1 bg-card p-1.5 shadow-lg">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={acting}
                onClick={() => void addToChat(pickedBox)}
              >
                <MessageSquarePlus />
                加入对话
              </Button>
              <Button type="button" size="sm" disabled={acting} onClick={() => void favorite(pickedBox)}>
                <Bookmark />
                直接收藏
              </Button>
            </Card>
            </div>
          </motion.div>
        ) : null}
      </div>
  );
}
