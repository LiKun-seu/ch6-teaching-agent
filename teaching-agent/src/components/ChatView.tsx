"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Bookmark, BookmarkCheck, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnswerCard } from "./AnswerCard";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { FigureChip, FigureModal, SlideGallery, SlideStrip, type Figure } from "./FigureModal";
import { useNotes } from "./notes";
import { Thinking, StreamingCaret } from "./Typing";
import { tidySelection } from "@/lib/selection-text";
import type { useChat } from "@/lib/useChat";
import { MAX_MESSAGE_CHARS } from "@/lib/request-limits";

type Chat = ReturnType<typeof useChat>;

/** 复制到剪贴板。内网 http 下没有剪贴板权限，退回选中复制的老办法。 */
async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走下面的兜底 */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 收藏时用的标题：取第一行有效文字，去掉 Markdown 记号 */
function answerTitle(text: string) {
  const line = text.split("\n").map((s) => s.trim()).find((s) => s && !s.startsWith("```")) ?? "";
  return line.replace(/^[#>\-*\d.\s]+/, "").replace(/\*\*/g, "").slice(0, 28).trim();
}

/** 老师一条回答下面的动作：复制、收藏到笔记 */
function AnswerActions({ text }: { text: string }) {
  const { add } = useNotes();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const actionClass =
    "h-8 gap-1.5 px-2 text-[11.5px] font-normal text-ink-faint hover:bg-paper-soft hover:text-ink";

  return (
    <div className="mt-1 flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={actionClass}
        onClick={() => {
          void copyText(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "已复制" : "复制"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={actionClass}
        onClick={() => {
          add({ kind: "text", title: answerTitle(text), text });
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1600);
        }}
      >
        {saved ? <BookmarkCheck /> : <Bookmark />}
        {saved ? "已收藏" : "收藏到笔记"}
      </Button>
    </div>
  );
}

/** Beta 同学：把一轮回复拆成老师和同学。标记没写全时先只显示老师。 */
function splitTalk(raw: string): { teacher: string; classmate: string | null } {
  const markT = "<<<老师>>>";
  const markC = "<<<同学>>>";
  const at = raw.indexOf(markC);
  const teacher = (at < 0 ? raw : raw.slice(0, at)).replaceAll(markT, "").trim();
  if (at < 0) return { teacher, classmate: null };
  const classmate = raw.slice(at + markC.length).replaceAll(markT, "").trim();
  return { teacher, classmate: classmate || null };
}

function Talk({
  text,
  streaming,
  onQuote,
  onClear,
}: {
  text: string;
  streaming: boolean;
  onQuote: (text: string, x: number, y: number) => void;
  onClear: () => void;
}) {
  const { teacher, classmate } = splitTalk(text);
  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    const quote = tidySelection(sel?.toString() ?? "");
    if (!quote || !sel?.anchorNode || !e.currentTarget.contains(sel.anchorNode)) {
      onClear();
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    onQuote(quote, rect.left, rect.bottom + 6);
  };
  return (
    <div onMouseUp={pick}>
      {teacher ? (
        <div className="text-[14px] text-ink">
          <Markdown text={teacher} />
          {streaming && !classmate ? <StreamingCaret /> : null}
        </div>
      ) : null}
      {teacher && !streaming ? <AnswerActions text={teacher} /> : null}
      {classmate ? (
        <Card className="mt-3 shadow-none">
          <CardContent className="p-3 text-[13px] leading-6">
            <div className="mb-1 text-[11px] text-muted-foreground">同学</div>
            <Markdown text={classmate} />
            {streaming ? <StreamingCaret /> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** 引导对话的消息区 + 输入区，首页与 AI 侧边栏共用 */
export function ChatView({
  chat,
  compact = false,
  welcome,
}: {
  chat: Chat;
  compact?: boolean;
  welcome?: ReactNode;
}) {
  const {
    msgs,
    busy,
    error,
    pendingImages,
    removePendingImage,
    send,
    answerCard,
    onImage,
    quote,
    setQuote,
    models,
    modelId,
    setModel,
  } = chat;
  const { add: addNote } = useNotes();
  const [input, setInput] = useState("");
  const [figure, setFigure] = useState<Figure | null>(null);
  const [gallery, setGallery] = useState<{ pages: number[]; index: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  /**
   * 锁输入框：找「第一张未作答的卡片」。
   * 已作答的卡片 answered=true 会被跳过，所以答完一张又来一张时，
   * 锁的是新那张；全部答完（findIndex 返回 -1）才解锁。
   * busy 时不锁，避免流式输出期间误判。
   */
  const pendingIdx = msgs.findIndex((m) => m.card && !m.answered);
  const blocked = pendingIdx >= 0 && !busy;
  const last = msgs[msgs.length - 1];
  const waiting = busy && last?.role === "assistant" && !last?.content;
  const streaming = busy && !!last?.content;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto w-full px-4 ${
            msgs.length === 0 && welcome ? "flex min-h-full flex-col justify-center" : ""
          } ${compact ? "py-5" : "max-w-chat py-10"}`}
        >
          {msgs.length === 0 && welcome ? welcome : null}

          {msgs.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="mb-5 flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-paper px-4 py-2.5 text-[14px] ring-1 ring-paper-line">
                  <Markdown text={m.content} />
                  {m.images?.length ? (
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {m.images.map((src, i) => (
                        <button
                          key={i}
                          onClick={() => setFigure({ kind: "image", src })}
                          title="点击查看原图"
                          className="transition-opacity hover:opacity-80"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={`上传的图片 ${i + 1}`}
                            className="h-16 w-16 rounded-lg object-cover ring-1 ring-paper-line"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div key={m.id} className="mb-7">
                {m.verdict ? (
                  <div className="ch6-fade mb-2 inline-flex items-center gap-1.5 rounded-md bg-paper px-2 py-1 text-[12px] ring-1 ring-paper-line">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        m.verdict.correct ? "bg-ink" : "bg-ink-faint"
                      }`}
                    />
                    {m.verdict.correct ? "这一步走对了" : "再想想这一步"}
                    {m.verdict.reason ? (
                      <span className="text-ink-faint">· {m.verdict.reason}</span>
                    ) : null}
                  </div>
                ) : null}

                {m.content ? (
                  <Talk
                    text={m.content}
                    streaming={streaming && m.id === last?.id}
                    onQuote={(text, x, y) => setMenu({ x, y, text })}
                    onClear={() => setMenu(null)}
                  />
                ) : null}

                {m.figures?.map((f, i) =>
                  f.kind === "slide" || f.kind === "slides" ? (
                    <SlideStrip
                      key={i}
                      pages={f.kind === "slide" ? [f.page] : f.pages}
                      onOpen={(index) =>
                        setGallery({
                          pages: f.kind === "slide" ? [f.page] : f.pages,
                          index,
                        })
                      }
                    />
                  ) : (
                    <FigureChip key={i} figure={f} onClick={() => setFigure(f)} />
                  ),
                )}

                {m.card && !m.answered ? (
                  <AnswerCard card={m.card} disabled={busy} onSubmit={(a) => void answerCard(m.card!, a, m.id)} />
                ) : null}
                {m.card && m.answered ? (
                  <div className="my-3 rounded-2xl border border-dashed border-paper-line px-4 py-2.5 text-[13px] text-ink-faint">
                    已作答
                  </div>
                ) : null}
              </div>
            ),
          )}

          {waiting ? <Thinking /> : null}

          {error ? (
            <div className="mt-2 rounded-xl border border-paper-line bg-paper px-3 py-2 text-[13px] leading-6 text-ink-soft">
              {error}
              {!busy ? <Button type="button" variant="ghost" size="sm" className="ml-2" onClick={() => void chat.retry()}>重试这一轮</Button> : null}
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => {
          const text = quote ? `【针对这段追问】\n${quote}${input.trim() ? `\n\n${input.trim()}` : ""}` : input;
          if (text.trim().length > MAX_MESSAGE_CHARS) { chat.setError("引用和消息合计不能超过 20000 字，请缩短后发送"); return; }
          setInput("");
          setQuote(null);
          void send(text);
        }}
        onImage={(f) => void onImage(f)}
        blocked={blocked}
        busy={busy}
        onStop={chat.stop}
        pendingImages={pendingImages}
        onRemoveImage={removePendingImage}
        quote={quote}
        onClearQuote={() => setQuote(null)}
        models={models}
        modelId={modelId}
        onModelChange={setModel}
      />

      {menu ? (
        <div
          className="fixed z-40 flex overflow-hidden rounded-lg border border-paper-line bg-paper shadow-lg"
          style={{ left: Math.max(8, menu.x), top: menu.y }}
        >
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] text-ink-soft hover:bg-paper-soft hover:text-ink"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuote(menu.text);
              setMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            追问
          </button>
          <button
            type="button"
            className="border-l border-paper-line px-3 py-1.5 text-[12px] text-ink-soft hover:bg-paper-soft hover:text-ink"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              addNote(menu.text);
              setMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            收藏到笔记
          </button>
        </div>
      ) : null}

      <FigureModal figure={figure} onClose={() => setFigure(null)} />
      {gallery ? (
        <SlideGallery
          pages={gallery.pages}
          index={gallery.index}
          onIndex={(index) => setGallery({ ...gallery, index })}
          onClose={() => setGallery(null)}
        />
      ) : null}
    </div>
  );
}
