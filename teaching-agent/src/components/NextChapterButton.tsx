"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useHydratedReducedMotion } from "@/hooks/use-hydrated-reduced-motion";
import { Button } from "@/components/ui/button";

const lift = {
  rest: {
    opacity: 1,
    y: 0,
    scale: 1,
    boxShadow: "0 8px 18px rgba(17, 17, 24, 0.16)",
  },
  hover: {
    opacity: 1,
    y: -4,
    scale: 1,
    boxShadow: "0 16px 32px rgba(17, 17, 24, 0.28)",
  },
  tap: {
    opacity: 1,
    y: -1,
    scale: 0.98,
    boxShadow: "0 6px 14px rgba(17, 17, 24, 0.18)",
  },
};

const sheen = {
  rest: { x: "-140%" },
  hover: { x: "240%", transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};

/** 章末占位区里的「进入下一章」入口。样式集中在这里，StudyView 只负责文案和跳转。 */
export function NextChapterButton({ label, onClick }: { label: string; onClick: () => void }) {
  const reduce = useHydratedReducedMotion();

  return (
    <motion.div
      className="inline-flex max-w-full rounded-full"
      // 不从全透明起步：截图或刚渲染的那一帧也要看得见按钮
      initial={reduce ? false : { opacity: 1, y: 10 }}
      animate={reduce ? undefined : "rest"}
      whileHover={reduce ? undefined : "hover"}
      whileTap={reduce ? undefined : "tap"}
      variants={reduce ? undefined : lift}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
    >
      <Button
        type="button"
        onClick={onClick}
        title={label ? `进入下一章：${label}` : undefined}
        className="group relative min-h-12 max-w-full overflow-hidden rounded-xl border border-white/15 bg-gradient-to-r from-ink via-ink to-slate-700 px-4 py-2.5 text-[13.5px] font-semibold leading-snug text-primary-foreground shadow-[0_8px_22px_rgba(17,17,24,0.22)] hover:bg-ink hover:shadow-[0_12px_28px_rgba(17,17,24,0.3)] sm:gap-3 sm:px-5"
      >
        {reduce ? null : (
          <motion.span
            aria-hidden
            initial={{ x: "-140%" }}
            variants={sheen}
            className="pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-white/40 to-transparent"
          />
        )}
        {/* 只写「进入下一章」，章节名放在悬停提示里 */}
        <span className="relative min-w-0 flex-1 text-center">进入下一章</span>
        <motion.span
          aria-hidden
          className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-sm"
          animate={reduce ? undefined : { x: [0, 3, 0] }}
          transition={reduce ? undefined : { duration: 1.7, repeat: Infinity, repeatDelay: 0.7, ease: "easeInOut" }}
        >
          <ArrowRight />
        </motion.span>
      </Button>
    </motion.div>
  );
}
