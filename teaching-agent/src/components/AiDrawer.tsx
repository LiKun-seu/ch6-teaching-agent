"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatView } from "./ChatView";
import { useChat, type PageCtx } from "@/lib/useChat";

type AskPayload = { question?: string; context?: PageCtx | null };

type AttachPayload = { text?: string; image?: string };

type SlideShot = { page: number; src: string };

type DrawerApi = {
  ask: (p?: AskPayload) => void;
  /** 打开侧栏，把选中文字放进输入框引用、图片放进待发送，不自动发出 */
  attach: (p: AttachPayload) => void;
  close: () => void;
  open: boolean;
  bindSlide: (slide: SlideShot | null) => void;
};

type PanelState = {
  chat: ReturnType<typeof useChat>;
  ctx: PageCtx | null;
  close: () => void;
};

const AiDrawerCtx = createContext<DrawerApi>({
  ask: () => {},
  attach: () => {},
  close: () => {},
  open: false,
  bindSlide: () => {},
});
const PanelCtx = createContext<PanelState | null>(null);

export function useAiDrawer() {
  return useContext(AiDrawerCtx);
}

async function urlToDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * 自学天地右上角「问 AI」。
 * 面板由 AiSidePanel 排在课件右侧，把 PPT 挤到左边，不盖住页面。
 */
export function AiDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<PageCtx | null>(null);
  const slideRef = useRef<SlideShot | null>(null);

  const chat = useChat(ctx);

  const bindSlide = useCallback((slide: SlideShot | null) => {
    slideRef.current = slide;
  }, []);

  const queueRef = useRef(chat.queueImages);
  queueRef.current = chat.queueImages;
  const sendRef = useRef(chat.send);
  sendRef.current = chat.send;
  const quoteRef = useRef(chat.setQuote);
  quoteRef.current = chat.setQuote;
  const askSequence = useRef(0);

  const ask = useCallback((p: AskPayload = {}) => {
    const sequence = ++askSequence.current;
    setCtx(p.context ?? null);
    setOpen(true);
    const slide = slideRef.current;
    const question = p.question?.trim() || "";
    void (async () => {
      const image = slide ? await urlToDataUrl(slide.src) : null;
      if (sequence !== askSequence.current) return;
      if (question) {
        await sendRef.current(question, image ? [image] : undefined, p.context ?? null);
        return;
      }
      if (image) queueRef.current([image]);
    })();
  }, []);

  const attach = useCallback((p: AttachPayload) => {
    setOpen(true);
    const text = p.text?.trim();
    if (text) quoteRef.current(text);
    if (p.image) queueRef.current([p.image]);
  }, []);

  const close = useCallback(() => { askSequence.current++; setOpen(false); }, []);

  const value = useMemo(
    () => ({ ask, attach, close, open, bindSlide }),
    [ask, attach, close, open, bindSlide],
  );
  const panel = useMemo(() => ({ chat, ctx, close }), [chat, ctx, close]);

  return (
    <AiDrawerCtx.Provider value={value}>
      <PanelCtx.Provider value={panel}>
        {children}
      </PanelCtx.Provider>
    </AiDrawerCtx.Provider>
  );
}

/** 放进自学天地那一栏的右侧，和课件并排 */
export function AiSidePanel() {
  const { open, close } = useAiDrawer();
  const isMobile = useIsMobile();
  const panel = useContext(PanelCtx);
  if (!open || !panel) return null;
  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: isMobile ? "100%" : 400, opacity: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-l bg-background"
    >
      {/* 面板自己的收起入口：手机上面板占了大半屏，从里面也能退回去 */}
      <div className="flex w-full shrink-0 items-center border-b border-paper-line px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-[12px] font-normal text-ink-soft hover:bg-paper-soft hover:text-ink"
          onClick={close}
        >
          <PanelRightClose />
          收起
        </Button>
      </div>
      <div className="min-h-0 w-full flex-1">
        <ChatView chat={panel.chat} compact />
      </div>
    </motion.aside>
  );
}
