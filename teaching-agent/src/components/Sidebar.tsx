"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookOpen, BookOpenCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Download, FlaskConical, Home, MessageSquare, MessageSquarePlus, Radio, StickyNote, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar as Side,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Card as AnswerCardData } from "@/lib/cards";
import { AnswerCard } from "./AnswerCard";
import { NoteEditor, exportNotePdf, useNotes, type Note } from "./notes";
import { appPath } from "@/lib/app-path";

/** 第 2 页课件上真实的文字框（slide-elements p2-2），用来示意点选后的亮框 */
const PICK_BOX = { x: 0.05, y: 0.1, w: 0.925, h: 0.6896 };

const DEMO_CARDS: AnswerCardData[] = [
  {
    kind: "choice",
    prompt: "适筋梁破坏时，先到达极限的是哪一个？",
    options: [
      { id: "A", text: "受拉钢筋" },
      { id: "B", text: "受压区混凝土" },
    ],
    hint: "先想谁先屈服。",
    topic: "示例",
  },
  {
    kind: "truefalse",
    prompt: "超筋梁破坏前有明显预兆。",
    topic: "示例",
  },
  {
    kind: "data",
    prompt: "算这根梁还缺这两个数。",
    fields: [
      { key: "b", label: "截面宽度", unit: "mm", placeholder: "例如 250" },
      { key: "h", label: "截面高度", unit: "mm", placeholder: "例如 500" },
    ],
    topic: "示例",
  },
  {
    kind: "calc",
    prompt: "这一步把相对受压区高度填上。",
    fields: [{ key: "xi", label: "ξ", placeholder: "填这一步的结果" }],
    topic: "示例",
  },
];

type HelpId = "slides" | "points" | "pick" | "save" | "ask" | "practice" | "model" | "notes";

const HELP: { id: HelpId; title: string }[] = [
  { id: "slides", title: "看课件" },
  { id: "points", title: "本页要点" },
  { id: "pick", title: "点选文字或图片" },
  { id: "save", title: "收藏这一页" },
  { id: "ask", title: "问 AI" },
  { id: "practice", title: "做练习" },
  { id: "model", title: "换模型" },
  { id: "notes", title: "笔记" },
];

function PickShot({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? "relative w-24 shrink-0 overflow-hidden rounded-md border border-paper-line" : "relative overflow-hidden rounded-xl border border-paper-line"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={appPath("/slides/slide-002.png")} alt="课件上亮着的选框" className="block w-full" />
      <div
        className="pointer-events-none absolute rounded-sm border border-amber-400 bg-amber-100/30 shadow-[0_0_0_2px_rgba(251,191,36,0.95),0_0_16px_rgba(245,158,11,0.7)]"
        style={{
          left: `${PICK_BOX.x * 100}%`,
          top: `${PICK_BOX.y * 100}%`,
          width: `${PICK_BOX.w * 100}%`,
          height: `${PICK_BOX.h * 100}%`,
        }}
      />
    </div>
  );
}

function HelpVisual({ id }: { id: HelpId }) {
  if (id === "slides") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/30">
          <ChevronLeft className="h-4 w-4" />
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/30">
          <ChevronRight className="h-4 w-4" />
        </span>
      </span>
    );
  }
  if (id === "points") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/85 text-ink-faint shadow-sm ring-1 ring-black/5">
        <StickyNote className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (id === "pick") return <PickShot compact />;
  if (id === "save") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-black/5 bg-white/85 text-ink-faint shadow-sm">
        <Bookmark className="size-4" />
      </span>
    );
  }
  if (id === "ask") {
    return (
      <span className="shrink-0 rounded-lg border border-paper-line px-2.5 py-1 text-[12.5px] text-ink-soft">问 AI</span>
    );
  }
  if (id === "practice") {
    return <span className="shrink-0 rounded-lg bg-ink px-3.5 py-1.5 text-[12px] text-paper">提交</span>;
  }
  if (id === "model") {
    return (
      <span className="inline-flex h-8 w-[6.75rem] shrink-0 items-center justify-between rounded-md border border-input bg-transparent px-2 text-[12px]">
        模型
        <ChevronDown className="h-4 w-4 opacity-50" />
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-lg border border-paper-line bg-paper text-[12px] text-ink-soft">
      <span className="px-2.5 py-1">追问</span>
      <span className="border-l border-paper-line px-2.5 py-1">收藏到笔记</span>
    </span>
  );
}

function HelpDetail({ id }: { id: HelpId }) {
  if (id === "slides") {
    return (
      <p>
        点侧栏「自学天地」。页眉是「1 / n · 第 x 页」。课件外侧左右各有一个半透明圆箭头，左边上一页，右边下一页。这一章最后一页再点右边，中间是「进入下一章」。
      </p>
    );
  }
  if (id === "points") {
    return (
      <p>
        点课件图右上角、书签右边这个便签，列出这一页的标题和要点。再点一次，或者点外面，就收起。换页也会收起。
      </p>
    );
  }
  if (id === "pick") {
    return (
      <div className="space-y-3">
        <PickShot />
        <p>在课件上点一段字或一张图，出现这样的亮框，以及这两个按钮。整页背景点不中。</p>
        <div className="flex flex-wrap gap-1">
          <span className="inline-flex h-8 items-center gap-2 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground shadow-sm">
            <MessageSquarePlus className="size-4" />
            加入对话
          </span>
          <span className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow">
            <Bookmark className="size-4" />
            直接收藏
          </span>
        </div>
        <p>「加入对话」打开右边的问 AI。文字挂在输入框上，标成「追问」；图片排在输入框上方。不会自动发出。</p>
        <p>「直接收藏」马上出现在侧栏笔记里。</p>
      </div>
    );
  }
  if (id === "save") {
    return <p>课件图右上角这个书签，在便签左边。笔记里多一条，标题是「章节名 第 x 页」，点开能看到这一整页。</p>;
  }
  if (id === "ask") {
    return (
      <div className="space-y-2">
        <p>
          自学天地顶栏右侧「问 AI」，右边滑出对话，和课件并排。当前这一页的图放进输入框，写完再发送。再点这个按钮会变成「收起」。
        </p>
        <p>页码右边的「这页没看懂」会直接请老师讲这一页。</p>
        <p>老师有时会甩出下面这几种必答卡。还有没答的卡时，输入框会锁住。</p>
        {DEMO_CARDS.map((card) => (
          <AnswerCard key={card.kind} card={card} onSubmit={() => {}} />
        ))}
      </div>
    );
  }
  if (id === "practice") {
    return (
      <p>
        这一页有题时，练习直接出现在课件下面。选择题点选项，判断和填空写上答案，再点「提交」，会显示「答对了」或「答错了」。也可以先点「不会做，直接看答案」。答错之后可以「查看答案」「再做一次」「收藏这道题」，答案下面有「还是不懂，问 AI」。没有标准答案时，按钮是「暂无标准答案，问 AI」。这一页没有题，下面就不出现练习。只有教材、没有课件的节，有题时同样出现在下面。
      </p>
    );
  }
  if (id === "model") {
    return <p>输入框里、发送按钮左边是当前模型。点开换成另一个，之后发出去的话就用新选的。</p>;
  }
  return (
    <p>
      在「引导对话」里选中老师的一句话，出现「追问」和「收藏到笔记」。到侧栏点开这条笔记，改完文字再点「保存」。有笔记时，点「笔记」右边的「汇总并导出 PDF」，会整理成一篇并打开打印窗口。
    </p>
  );
}

export type AppView = "home" | "chat" | "study" | "materials" | "self-test" | "classroom" | "beam-lab";

export function Sidebar({
  view,
  onView,
}: {
  view: AppView;
  onView: (v: AppView) => void;
}) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { notes, remove, storageError, retrySave } = useNotes();
  const [openNote, setOpenNote] = useState<Note | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpId, setHelpId] = useState<HelpId | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const nav: { id: Exclude<AppView, "home">; label: string; icon: typeof MessageSquare }[] = [
    { id: "chat", label: "引导对话", icon: MessageSquare },
    { id: "study", label: "自学天地", icon: BookOpen },
    { id: "beam-lab", label: "智能配筋实验", icon: FlaskConical },
    { id: "self-test", label: "题库自测", icon: BookOpenCheck },
    { id: "classroom", label: "实时课堂", icon: Radio },
    { id: "materials", label: "资料下载", icon: Download },
  ];
  const help = HELP.find((item) => item.id === helpId) ?? null;

  /** 手机上的侧栏是抽屉，切换视图后要收起来，不然一直盖着内容 */
  const goView = (next: AppView) => {
    onView(next);
    setOpenMobile(false);
  };

  /** 手机上从首页进来时，不要沿用上一次留下的抽屉状态 */
  useEffect(() => {
    setOpenMobile(false);
  }, [view, setOpenMobile]);

  const exportPdf = () => {
    setExporting(true);
    setExportError(null);
    void exportNotePdf(notes)
      .catch((e: Error) => setExportError(e.message))
      .finally(() => setExporting(false));
  };

  return (
    <>
      <Side collapsible="icon">
        <div className="flex min-h-0 w-full flex-1 flex-col pt-3.5">
        <SidebarHeader className="group-data-[collapsible=icon]:px-0">
          <div className="flex min-w-0 items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:px-0">
            <img
              src={appPath("/seu-logo.png")}
              alt="东南大学"
              width={32}
              height={32}
              style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, flexShrink: 0 }}
              className="size-8 max-h-8 min-h-8 max-w-8 min-w-8 shrink-0 grow-0 self-center aspect-square rounded-full object-contain"
            />
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-medium">第六章</div>
              <div className="truncate text-xs text-muted-foreground">东南大学</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-7 w-7 shrink-0 group-data-[collapsible=icon]:ml-0"
                  aria-label="返回首页"
                  onClick={() => goView("home")}
                >
                  <Home />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isMobile || state === "expanded" ? "bottom" : "right"}>返回首页</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-7 w-7 shrink-0 group-data-[collapsible=icon]:ml-0"
                  aria-label="用法说明"
                  onClick={() => setHelpOpen(true)}
                >
                  <CircleHelp />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isMobile || state === "expanded" ? "bottom" : "right"}>用法说明</TooltipContent>
            </Tooltip>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {nav.map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton isActive={view === n.id} tooltip={n.label} onClick={() => goView(n.id)}>
                    <n.icon />
                    <span>{n.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="min-h-0 flex-1">
            <div className="flex w-full min-w-0 items-center gap-1 group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel className="w-auto shrink-0">笔记</SidebarGroupLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto h-7 shrink-0 px-2 text-xs"
                disabled={!notes.length || exporting}
                onClick={exportPdf}
              >
                {exporting ? "正在汇总…" : "汇总并导出 PDF"}
              </Button>
            </div>
            {exportError ? (
              <p className="px-2 text-[11px] leading-4 text-muted-foreground group-data-[collapsible=icon]:hidden">{exportError}</p>
            ) : null}
            {storageError ? (
              <div role="alert" className="px-2 text-xs leading-5 text-destructive group-data-[collapsible=icon]:hidden">
                {storageError}
                <Button type="button" variant="ghost" size="sm" onClick={retrySave}>重试保存</Button>
              </div>
            ) : null}
            {notes.length === 0 ? (
              <p className="px-2 text-xs leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">
                选中老师的话即可收藏。
              </p>
            ) : (
              <ul className="space-y-1 overflow-y-auto px-1 group-data-[collapsible=icon]:hidden">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg px-2 py-1.5 hover:bg-sidebar-accent">
                    <button type="button" onClick={() => setOpenNote(n)} className="block w-full text-left">
                      <p className="truncate text-xs font-medium">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{n.text}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SidebarGroup>
        </SidebarContent>
        </div>
      </Side>
      <Sheet
        open={helpOpen}
        onOpenChange={(open) => {
          setHelpOpen(open);
          if (!open) setHelpId(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
          onPointerDownOutside={(event) => {
            if (helpId) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (helpId) event.preventDefault();
          }}
        >
          <SheetHeader className="shrink-0 space-y-1 px-5 pb-2 pr-12 pt-5 text-left">
            <SheetTitle>怎么用</SheetTitle>
            <SheetDescription>点一条看怎么做。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-6">
            {HELP.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
              >
                <button type="button" onClick={() => setHelpId(item.id)} className="block w-full text-left">
                  <Card className="shadow-sm transition-colors hover:bg-accent/40">
                    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3 p-3">
                      <div className="flex min-w-0 items-center justify-center">
                        <HelpVisual id={item.id} />
                      </div>
                      <span className="text-sm font-medium">{item.title}</span>
                    </div>
                  </Card>
                </button>
              </motion.div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={help !== null} onOpenChange={(open) => { if (!open) setHelpId(null); }}>
        <DialogContent className={`flex max-h-[85vh] flex-col overflow-hidden ${helpId === "ask" ? "sm:max-w-xl" : ""}`}>
          {help ? (
            <>
              <DialogHeader className="shrink-0 pr-6">
                <DialogTitle>{help.title}</DialogTitle>
                <DialogDescription className="sr-only">{help.title}</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto text-[13px] leading-6 text-foreground">
                <HelpDetail id={help.id} />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <NoteEditor note={openNote} onClose={() => setOpenNote(null)} />
    </>
  );
}
