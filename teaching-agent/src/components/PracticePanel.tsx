"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Markdown } from "./Markdown";
import { useAiDrawer } from "./AiDrawer";
import { useNotes } from "./notes";
import type { PageCtx } from "@/lib/useChat";

export { grade } from "@/lib/grading";
export { pickQuestions } from "@/lib/questions";
export type { Question } from "@/lib/questions";
import { grade, normLetter } from "@/lib/grading";
import type { Question } from "@/lib/questions";

const TYPE_LABEL: Record<Question["type"], string> = { choice: "选择", judge: "判断", fill: "填空" };

/** 正确答案的可读形式 */
function answerLabel(q: Question): string {
  const a = (q.answer ?? "").trim();
  if (!a) return "暂无答案";
  if (q.type === "choice") {
    const opt = (q.options ?? []).find((o) => normLetter(o.id) === normLetter(a));
    return opt ? `${a}．${opt.text}` : a;
  }
  if (q.type === "judge") return normLetter(a) === "T" ? "正确" : normLetter(a) === "F" ? "错误" : a;
  return a;
}

/* --------------------------- 面板 --------------------------- */

type QState = { value: string; submitted: boolean; correct: boolean | null; showAnswer: boolean };

const EMPTY: QState = { value: "", submitted: false, correct: null, showAnswer: false };

export function PracticePanel({
  questions,
  context,
}: {
  questions: Question[];
  context: PageCtx;
}) {
  const { ask } = useAiDrawer();
  const { add } = useNotes();
  const [states, setStates] = useState<Record<string, QState>>({});

  const st = (id: string): QState => states[id] ?? EMPTY;
  const patch = (id: string, p: Partial<QState>) =>
    setStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...p } }));

  const list = useMemo(() => questions, [questions]);

  if (!list.length) return null;

  return (
    <div className="space-y-2.5">
      {list.map((q) => {
        const s = st(q.id);
        const hasAnswer = Boolean(q.answer);
        const opts = q.options ?? [];

        const submit = () => patch(q.id, { submitted: true, correct: grade(q, s.value) });
        const reset = () => patch(q.id, EMPTY);

        return (
          <Card key={q.id} className="rounded-xl border-paper-line bg-paper px-3 py-3 shadow-none">
            <div className="flex items-center gap-2">
              <span className="text-[11px] tabular-nums text-ink-faint">{q.id}</span>
              <span className="rounded-full border border-paper-line px-1.5 py-[1px] text-[10.5px] text-ink-faint">
                {TYPE_LABEL[q.type]}
              </span>
              {q.verified === false ? (
                <span className="text-[10.5px] text-ink-faint">未复核</span>
              ) : null}
            </div>

            <div className="mt-1.5 text-[13px] leading-6 text-ink-soft">
              <Markdown text={q.prompt.replace(/_{2,}/g, "＿＿＿＿")} />
            </div>

            {/* 作答区 */}
            {opts.length ? (
              <div className="mt-2 space-y-1">
                {opts.map((o) => {
                  const picked = s.value === o.id;
                  const right = s.submitted && normLetter(o.id) === normLetter(q.answer ?? "");
                  const wrong = s.submitted && picked && !right;
                  return (
                    <Button
                      key={o.id}
                      type="button"
                      variant="outline"
                      onClick={() => patch(q.id, { value: o.id, submitted: false, correct: null })}
                      className={`h-auto w-full items-start justify-start gap-2 whitespace-normal rounded-lg px-2.5 py-2 text-left text-[12.5px] font-normal leading-5 shadow-none ${
                        right
                          ? "border-ink bg-paper-soft text-ink hover:bg-paper-soft hover:text-ink"
                          : wrong
                            ? "border-ink-faint bg-paper-soft text-ink-faint line-through hover:bg-paper-soft hover:text-ink-faint"
                            : picked
                              ? "border-ink bg-paper-soft text-ink hover:bg-paper-soft hover:text-ink"
                              : "border-paper-line text-ink-soft hover:bg-paper-soft hover:text-ink-soft"
                      }`}
                    >
                      <span className="shrink-0 tabular-nums text-ink-faint">{o.id}</span>
                      <span className="min-w-0 flex-1">
                        <Markdown text={o.text} className="md-inline" />
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <Input
                value={s.value}
                onChange={(e) => patch(q.id, { value: e.target.value, submitted: false, correct: null })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder={q.type === "fill" ? "把答案填在这里" : "输入你的答案"}
                className="mt-2 h-auto border-paper-line bg-paper px-2.5 py-2 text-[12.5px] text-ink shadow-none placeholder:text-ink-faint focus-visible:ring-ink-faint"
              />
            )}

            {/* 操作区 */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {!hasAnswer ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    ask({
                      question: `这道题我没有标准答案，能不能一步步带我做：${q.prompt}`,
                      context,
                    })
                  }
                  className="border-paper-line text-ink-soft shadow-none hover:bg-paper-soft"
                >
                  暂无标准答案，问 AI
                </Button>
              ) : !s.submitted ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={submit}
                    disabled={!s.value.trim()}
                    className="bg-ink text-paper hover:bg-ink/90"
                  >
                    提交
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch(q.id, { showAnswer: true })}
                    className="text-ink-faint hover:bg-transparent hover:text-ink"
                  >
                    不会做，直接看答案
                  </Button>
                </>
              ) : (
                <>
                  <span className={`text-[11.5px] font-medium ${s.correct === null ? "text-ink-soft" : s.correct ? "text-emerald-600" : "text-red-600"}`}>
                    {s.correct === null ? "待核对，请对照答案与解析" : s.correct ? "答对了" : "答错了"}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => patch(q.id, { showAnswer: !s.showAnswer })}
                    className="border-paper-line text-ink-soft shadow-none hover:bg-paper-soft"
                  >
                    {s.showAnswer ? "收起答案" : "查看答案"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={reset}
                    className="text-ink-faint hover:bg-transparent hover:text-ink"
                  >
                    再做一次
                  </Button>
                  {s.correct === false ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        add({
                          kind: "question",
                          title: q.id,
                          text: `题目：${q.prompt}\n我的作答：${s.value}\n这道题我做错了。`,
                        })
                      }
                      className="text-ink-faint hover:bg-transparent hover:text-ink"
                    >
                      收藏这道题
                    </Button>
                  ) : null}
                </>
              )}
            </div>

            {/* 答案区：答错或主动点开才显示 */}
            {s.showAnswer && hasAnswer ? (
              <div className="mt-2 rounded-lg bg-paper-soft px-2.5 py-2">
                <Markdown text={`答案：${answerLabel(q)}`} className="md-inline text-[12px] leading-5 text-blue-900" />
                {q.analysis ? (
                  <Markdown text={q.analysis} className="md-inline mt-1 text-[12px] leading-5 text-ink-soft" />
                ) : null}
                {q.verified === false ? (
                  <div className="mt-1 text-[11px] text-ink-faint">该题答案未经复核，仅供参考。</div>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      ask({
                        question: `我不太懂这道题：${q.prompt}\n答案是 ${answerLabel(q)}，但我没看懂，能不能一步步讲？`,
                        context,
                      })
                    }
                    className="bg-ink text-paper shadow-none hover:bg-ink/90"
                  >
                    还是不懂，问 AI
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
