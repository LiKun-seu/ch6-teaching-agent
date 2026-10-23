"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import elementsJson from "@/content/slide-elements.json";
import slidesJson from "@/content/slides.json";
import { Markdown } from "./Markdown";
import { noteImagesHtml, noteImageSource, rawNotesMarkdown } from "@/lib/note-export";
import { requestScope } from "@/lib/request-lifecycle";
import { appPath } from "@/lib/app-path";

import { browserNoteStorage, createNotesStore, type NoteDraft, type Note } from "@/lib/notes-store";
export type { Note, NoteKind } from "@/lib/notes-store";

type SlideMeta = { page: number; section?: string; title?: string };
type ElementMeta = { text?: string };

const slideMeta = slidesJson as SlideMeta[];
const elementMeta = elementsJson as Record<string, ElementMeta[]>;

/** 侧栏课程名。课件 section 为空时才用，不拿来代替每一页自己的章节。 */
const SIDEBAR_COURSE = "第六章";

const LEGACY_TITLE = /^第\s*(\d+)\s*页(?:图片)?$/;

function compact(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** 课件这一页所属章节 + 页码，例如「封面/导读 第 2 页」。对不上页就返回 null。 */
export function pageNoteTitle(page: number): string | null {
  const hit = slideMeta.find((s) => s.page === page);
  if (!hit) return null;
  const section = hit.section?.trim() || SIDEBAR_COURSE;
  return `${section} 第 ${page} 页`;
}

function pageFromNote(note: { title: string; text: string }): number | null {
  const fromTitle = note.title.trim().match(/第\s*(\d+)\s*页/);
  const fromBody = note.text.match(/第\s*(\d+)\s*页/);
  const raw = fromTitle?.[1] || fromBody?.[1];
  const page = raw ? Number(raw) : NaN;
  return Number.isFinite(page) && page > 0 ? page : null;
}

/** 旧标题「第 N 页」或「第 N 页图片」只在编辑器里显示成章节名 + 页码，不写回存储。 */
export function displayNoteTitle(note: { title: string; text: string }): string {
  if (!LEGACY_TITLE.test(note.title.trim())) return note.title;
  const page = pageFromNote(note);
  if (!page) return note.title;
  return pageNoteTitle(page) ?? note.title;
}

/** 收藏时自动写进正文的说明，不是用户笔记。 */
function isAutoNoteText(note: { kind?: string; title: string; text: string }): boolean {
  const text = compact(note.text);
  if (!text) return false;
  if (/^第\s*\d+\s*页\s*[·・]\s*第\s*\d+\s*页中的一张图$/.test(text)) return true;
  if (/^第\s*\d+\s*页课件$/.test(text)) return true;

  const prefixed = text.match(/^第\s*(\d+)\s*页\s*[·・]\s*(.+)$/);
  if (prefixed) {
    const rest = prefixed[2].trim();
    const boxes = elementMeta[prefixed[1]] ?? [];
    if (rest && boxes.some((b) => compact(b.text ?? "") === rest)) return true;
  }

  if ((note.kind === "page" || note.kind === "element") && LEGACY_TITLE.test(note.title.trim())) {
    const page = pageFromNote(note);
    const slide = page ? slideMeta.find((s) => s.page === page) : undefined;
    if (slide) {
      const candidates = [slide.title, slide.section, "本页要点"].map((s) => compact(s ?? "")).filter(Boolean);
      if (candidates.includes(text)) return true;
    }
  }
  return false;
}

/** 系统说明在编辑器里显示为空，用户改过的正文原样保留。 */
export function displayNoteText(note: { kind?: string; title: string; text: string }): string {
  return isAutoNoteText(note) ? "" : note.text;
}

const NotesCtx = createContext<{
  notes: Note[];
  storageError: string | null;
  retrySave: () => void;
  add: (input: string | NoteDraft) => void;
  update: (id: string, patch: Partial<Pick<Note, "title" | "text">>) => void;
  remove: (id: string) => void;
}>({ notes: [], storageError: null, retrySave: () => {}, add: () => {}, update: () => {}, remove: () => {} });

export function NotesProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<ReturnType<typeof createNotesStore> | null>(null);
  if (!storeRef.current) storeRef.current = createNotesStore(browserNoteStorage);
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  useEffect(() => {
    const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));
    void store.initialize();
    return unsubscribe;
  }, [store]);
  const add = useCallback((input: string | NoteDraft) => { void store.add(input); }, [store]);
  const update = useCallback((id: string, patch: Partial<Pick<Note, "title" | "text">>) => { void store.update(id, patch); }, [store]);
  const remove = useCallback((id: string) => { void store.remove(id); }, [store]);
  const retrySave = useCallback(() => { void store.retry(); }, [store]);
  const value = useMemo(() => ({ notes: snapshot.notes, storageError: snapshot.error, retrySave, add, update, remove }), [snapshot, retrySave, add, update, remove]);
  return <NotesCtx.Provider value={value}>{children}</NotesCtx.Provider>;
}

export function useNotes() {
  return useContext(NotesCtx);
}

/** 点开一条笔记：看全文、改文字 */
export function NoteEditor({
  note,
  onClose,
}: {
  note: Note | null;
  onClose: () => void;
}) {
  const { update } = useNotes();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    setTitle(note ? displayNoteTitle(note) : "");
    setText(note ? displayNoteText(note) : "");
  }, [note]);

  if (!note) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3">
          <span className="text-[13px] font-medium">笔记</span>
          <button type="button" onClick={onClose} className="ml-auto text-[12px] text-ink-faint hover:text-ink">
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {note.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={noteImageSource(note.image) ?? undefined} alt="" className="w-full rounded-lg ring-1 ring-paper-line" />
          ) : null}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-paper-line bg-paper-soft px-3 py-2 text-[14px] outline-none"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="写下笔记"
            className="w-full resize-none rounded-lg border border-paper-line bg-paper-soft px-3 py-2 text-[13px] leading-6 outline-none"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-paper-line px-4 py-3">
          <button
            type="button"
            onClick={() => {
              update(note.id, { title, text });
              onClose();
            }}
            className="rounded-lg bg-ink px-3 py-1.5 text-[13px] text-paper"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** 先在用户点击时打开窗口，图片笔记不依赖模型；文字保留公式渲染。 */
export async function exportNotePdf(notes: Note[]) {
  if (!notes.length) throw new Error("还没有可导出的笔记");
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("浏览器拦住了导出窗口，请允许弹出窗口后再试");
  printWindow.document.body.textContent = "正在整理笔记…";
  const scope = requestScope(undefined, 130_000);
  try {
    let markdown = rawNotesMarkdown(notes);
    let summarized = false;
    if (markdown) {
      const response = await fetch(appPath("/api/digest"), {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: scope.signal,
        body: JSON.stringify({ notes: notes.map(note => ({ title: note.title, kind: note.kind, text: note.text, hasImage: !!note.image })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "整理笔记失败");
      markdown = String(result.markdown ?? markdown);
      summarized = result.summarized === true;
    }
    if (printWindow.closed) return;
    const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map(element => {
      const clone = element.cloneNode(true) as HTMLElement;
      if (clone instanceof HTMLLinkElement) clone.href = (element as HTMLLinkElement).href;
      return clone.outerHTML;
    }).join("");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const body = renderToStaticMarkup(<Markdown text={markdown} />);
    printWindow.addEventListener("load", () => {
      void (async () => {
        await printWindow.document.fonts.ready;
        await Promise.allSettled([...printWindow.document.images].map(image => image.decode()));
        if (!printWindow.closed) printWindow.print();
      })();
    }, { once: true });
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>我的第六章笔记</title>' + styles +
      '<style>body{font-family:"Microsoft YaHei",sans-serif;max-width:720px;margin:32px auto;padding:16px;line-height:1.75;background:white;color:#1a1a18}img{max-width:100%}figure{break-inside:avoid}figcaption{font-size:12px;color:#666}h1{font-size:22px}h2{font-size:18px;margin-top:1.4em}.md-body{font-size:14px}.katex{color:inherit}</style></head><body><h1>我的第六章笔记</h1>' +
      (markdown ? '<p>' + (summarized ? '已根据收藏汇总。' : '以下按收藏原文整理。') + '</p>' : '') + body + noteImagesHtml(notes) + '</body></html>');
    printWindow.document.close();
  } catch (error) {
    if (!printWindow.closed) printWindow.close();
    throw error;
  } finally { scope.dispose(); }
}
