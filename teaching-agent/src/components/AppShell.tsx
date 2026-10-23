"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { motion } from "motion/react";
import { useHydratedReducedMotion } from "@/hooks/use-hydrated-reduced-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { KNOWLEDGE_SECTIONS } from "@/lib/sections";
import { ChatView } from "./ChatView";
import { useChat } from "@/lib/useChat";
import { AiDrawerProvider, AiSidePanel, useAiDrawer } from "./AiDrawer";
import { NotesProvider } from "./notes";
import { MaterialsView } from "./MaterialsView";
import { Sidebar, type AppView } from "./Sidebar";
import { StudyView } from "./StudyView";
import { appPath } from "@/lib/app-path";
import { SelfTestView } from "./SelfTestView";
import { ClassroomView } from "./ClassroomView";
import { BeamLabView } from "./BeamLabView";

const SUGGESTIONS = [
  "帮我判断这个梁截面会不会超筋",
  "讲讲适筋梁受弯的三个受力阶段",
  "斜截面受剪有哪几种破坏形态",
];

/** 落地页「进入学习」的动效，和章末的「进入下一章」用同一套手感 */
const enterLift = {
  rest: { y: 0, scale: 1, boxShadow: "0 8px 20px rgba(17, 17, 24, 0.18)" },
  hover: { y: -3, scale: 1.02, boxShadow: "0 16px 32px rgba(17, 17, 24, 0.28)" },
  tap: { y: 0, scale: 0.97, boxShadow: "0 6px 14px rgba(17, 17, 24, 0.2)" },
};

const enterSheen = {
  rest: { x: "-140%" },
  hover: { x: "240%", transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};

function ChatPane() {
  const chat = useChat(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center px-3 pt-2">
        <SidebarTrigger />
      </div>
      <div className="min-h-0 flex-1">
        <ChatView
          chat={chat}
          welcome={
            <div className="py-16 text-center">
              <h1 className="text-[20px] font-medium leading-8">钢筋混凝土梁承载力计算原理</h1>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-muted-foreground">先看资料，再做题。</p>
              <div className="mt-7 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} type="button" variant="outline" size="sm" className="rounded-full" onClick={() => void chat.send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

const PREVIEW_SECTION_COUNT = 3;

/** 自学天地 + 右侧 AI 面板：手机上面板打开时课件先让位，免得两边都被挤扁 */
function StudyPane() {
  const { open } = useAiDrawer();
  return (
    <>
      <div className={`min-h-0 min-w-0 flex-1 ${open ? "hidden md:block" : ""}`}>
        <StudyView />
      </div>
      <AiSidePanel />
    </>
  );
}

function Landing({ onEnter }: { onEnter: () => void }) {
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const reduce = useHydratedReducedMotion();
  const visibleSections = sectionsOpen ? KNOWLEDGE_SECTIONS : KNOWLEDGE_SECTIONS.slice(0, PREVIEW_SECTION_COUNT);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 pb-16 pt-14">
        <motion.div
          className="flex flex-col items-center text-center"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
        >
          <img
            src={appPath("/seu-logo.png")}
            alt="东南大学"
            width={72}
            height={72}
            style={{ width: 72, height: 72, minWidth: 72, minHeight: 72, flexShrink: 0 }}
            className="size-[72px] shrink-0 rounded-full object-contain"
          />
          <p className="mt-5 text-sm tracking-wide text-muted-foreground">东南大学</p>
          <h1 className="mt-6 text-[22px] font-medium leading-8 tracking-tight">钢筋混凝土梁承载力计算原理</h1>
          <p className="mt-2 text-sm text-muted-foreground">第六章辅导</p>
        </motion.div>
        <motion.div
          className="mt-10 w-full space-y-3"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.06 }}
        >
          <Card className="shadow-none">
            <p className="px-5 py-4 text-sm leading-6 text-muted-foreground">
              讲梁的承载力怎么算，以及公式从哪来。正截面受弯从构造要求和破坏形态，到单筋、双筋矩形截面和 T 形截面；斜截面受剪讲到承载力计算。受扭、挠度和裂缝宽度来自教材。
            </p>
          </Card>
          <Card className="shadow-none">
            <ol className="px-5 py-2">
              {visibleSections.map((section) => (
                <li key={section.id} className="flex items-baseline gap-3 border-b border-border/70 py-2.5 text-sm last:border-0">
                  <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{section.id}</span>
                  <span>{section.name}</span>
                </li>
              ))}
            </ol>
            <div className="px-3 pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                aria-expanded={sectionsOpen}
                onClick={() => setSectionsOpen((open) => !open)}
              >
                {sectionsOpen ? "收起" : "展开全部"}
                {sectionsOpen ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
          </Card>
        </motion.div>
        <motion.div
          className="mt-10 inline-flex rounded-full"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
        >
          <motion.div
            className="inline-flex rounded-full"
            initial={reduce ? false : "rest"}
            whileHover={reduce ? undefined : "hover"}
            whileTap={reduce ? undefined : "tap"}
            variants={enterLift}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
          >
            <Button
              type="button"
              size="lg"
              onClick={onEnter}
              className="relative h-11 overflow-hidden rounded-full px-7 text-[15px] font-semibold shadow-none hover:bg-primary"
            >
              {reduce ? null : (
                <motion.span
                  aria-hidden
                  initial={{ x: "-140%" }}
                  variants={enterSheen}
                  className="pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                />
              )}
              <span className="relative">进入学习</span>
              <motion.span
                aria-hidden
                className="relative inline-flex"
                animate={reduce ? undefined : { x: [0, 3, 0] }}
                transition={reduce ? undefined : { duration: 1.7, repeat: Infinity, repeatDelay: 0.7, ease: "easeInOut" }}
              >
                <ArrowRight />
              </motion.span>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

/** 各业务视图保留挂载和本地状态；课堂订阅仅在激活时运行。 */
export function AppShell({ initialView = "home" }: { initialView?: AppView }) {
  const [view, setView] = useState<AppView>(initialView);

  return (
    <NotesProvider>
      <AiDrawerProvider>
        <SidebarProvider>
          {view === "home" ? null : <Sidebar view={view} onView={setView} />}
          <SidebarInset className="flex h-svh min-h-0 flex-col bg-background">
            <div className="relative min-h-0 flex-1">
              <motion.div
                className="absolute inset-0"
                animate={{ opacity: view === "home" ? 1 : 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  pointerEvents: view === "home" ? "auto" : "none",
                  visibility: view === "home" ? "visible" : "hidden",
                }}
              >
                <Landing onEnter={() => setView("chat")} />
              </motion.div>
              <motion.div
                className="absolute inset-0 flex flex-col"
                animate={{ opacity: view === "chat" ? 1 : 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  pointerEvents: view === "chat" ? "auto" : "none",
                  visibility: view === "chat" ? "visible" : "hidden",
                }}
              >
                <ChatPane />
              </motion.div>
              <motion.div
                className="absolute inset-0 flex min-h-0"
                animate={{ opacity: view === "study" ? 1 : 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  pointerEvents: view === "study" ? "auto" : "none",
                  visibility: view === "study" ? "visible" : "hidden",
                }}
              >
                <StudyPane />
              </motion.div>
              <motion.div
                className="absolute inset-0 flex min-h-0 flex-col"
                animate={{ opacity: view === "materials" ? 1 : 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  pointerEvents: view === "materials" ? "auto" : "none",
                  visibility: view === "materials" ? "visible" : "hidden",
                }}
              >
                <MaterialsView />
              </motion.div>
              {(["self-test", "classroom", "beam-lab"] as const).map(pane => (
                <motion.div
                  key={pane}
                  className="absolute inset-0 flex min-h-0 flex-col"
                  animate={{ opacity: view === pane ? 1 : 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ pointerEvents: view === pane ? "auto" : "none", visibility: view === pane ? "visible" : "hidden" }}
                >
                  <div className="shrink-0 px-3 pt-2"><SidebarTrigger /></div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {pane === "self-test" ? <SelfTestView /> : pane === "classroom" ? <ClassroomView active={view === "classroom"} /> : <BeamLabView active={view === "beam-lab"} />}
                  </div>
                </motion.div>
              ))}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </AiDrawerProvider>
    </NotesProvider>
  );
}
