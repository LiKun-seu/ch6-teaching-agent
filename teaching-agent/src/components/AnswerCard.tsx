"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { Card, CardAnswer } from "@/lib/cards";
import { Button } from "@/components/ui/button";
import { Card as Surface, CardContent } from "@/components/ui/card";
import { Markdown } from "./Markdown";
import { FigureChip, FigureModal, type Figure } from "./FigureModal";

const KIND_LABEL: Record<Card["kind"], string> = {
  choice: "选择题",
  truefalse: "判断题",
  data: "补充数据",
  calc: "计算",
};

export function AnswerCard({
  card,
  onSubmit,
  disabled = false,
}: {
  card: Card;
  onSubmit: (a: CardAnswer) => void;
  disabled?: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [tf, setTf] = useState<boolean | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showHint, setShowHint] = useState(false);
  const [figure, setFigure] = useState<Figure | null>(null);

  const ready =
    card.kind === "choice"
      ? !!choice
      : card.kind === "truefalse"
        ? tf !== null
        : card.fields.every((f) => (values[f.key] ?? "").trim() !== "");

  const submit = () => {
    if (!ready || disabled) return;
    if (card.kind === "choice") onSubmit({ kind: "choice", choiceId: choice! });
    else if (card.kind === "truefalse") onSubmit({ kind: "truefalse", value: tf === true });
    else if (card.kind === "data") onSubmit({ kind: "data", values });
    else onSubmit({ kind: "calc", values });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="my-4"
    >
    <Surface className="shadow-none">
    <CardContent className="p-5">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] text-paper">
          必答 · {KIND_LABEL[card.kind]}
        </span>
        {card.topic ? <span className="text-[11px] text-ink-faint">{card.topic}</span> : null}
      </div>

      <div className="text-[14px] leading-7">
        <Markdown text={card.prompt} />
      </div>

      {card.kind === "choice" ? (
        <div className="mt-3 space-y-1.5">
          {card.options.map((o) => {
            const on = choice === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setChoice(o.id)}
                  disabled={disabled}
                className={`flex w-full gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-6 transition-colors ${
                  on
                    ? "border-ink bg-paper-soft"
                    : "border-paper-line hover:border-ink-faint hover:bg-paper-soft"
                }`}
              >
                <span className="shrink-0 font-medium">{o.id}</span>
                <span>
                  <Markdown text={o.text} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {card.kind === "truefalse" ? (
        <div className="mt-3 flex gap-2">
          {[
            { v: true, t: "正确" },
            { v: false, t: "错误" },
          ].map((o) => (
            <button
              key={o.t}
              onClick={() => setTf(o.v)}
              disabled={disabled}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-[13px] transition-colors ${
                tf === o.v ? "border-ink bg-paper-soft" : "border-paper-line hover:bg-paper-soft"
              }`}
            >
              {o.t}
            </button>
          ))}
        </div>
      ) : null}

      {card.kind === "data" || card.kind === "calc" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {card.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-[12px] text-ink-soft">
                {f.label}
                {f.unit ? <span className="text-ink-faint"> （{f.unit}）</span> : null}
              </span>
              <input
                value={values[f.key] ?? ""}
                disabled={disabled}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder || "请输入"}
                className="w-full rounded-xl border border-paper-line bg-paper px-3 py-2 text-[13px] outline-none focus:border-ink-soft"
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={submit} disabled={!ready || disabled} size="sm">
          提交作答
        </Button>
        {card.hint ? (
          <button
            onClick={() => setShowHint((v) => !v)}
            className="px-1 py-2 text-[12px] text-ink-faint underline-offset-2 hover:underline"
          >
            {showHint ? "收起提示" : "看个提示"}
          </button>
        ) : null}
      </div>

      {card.figure ? (
        <div className="mt-3">
          <FigureChip
            figure={card.figure}
            onClick={() => setFigure(card.figure!)}
            label={card.figure.kind === "slide" ? `查看 PPT 第 ${card.figure.page} 页` : "看这张示意图"}
          />
        </div>
      ) : null}

      {showHint && card.hint ? (
        <div className="mt-2.5 rounded-xl bg-paper-soft px-3 py-2 text-[13px] leading-6 text-ink-soft">
          <Markdown text={card.hint} />
        </div>
      ) : null}

      <FigureModal figure={figure} onClose={() => setFigure(null)} />
    </CardContent>
    </Surface>
    </motion.div>
  );
}
