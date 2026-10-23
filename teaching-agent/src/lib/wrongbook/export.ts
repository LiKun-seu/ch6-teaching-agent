import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS } from "../question-catalog";
import { answerLabel, displayPrompt } from "../self-test/model";
import type { WrongRecord } from "./model";
export type ExportTemplate = "correction" | "blank" | "review";
export type ExportScope = "session" | "all" | "selected";
export const TEMPLATE_LABELS: Record<ExportTemplate, string> = { correction: "对照纠错", blank: "空白重练", review: "简洁复习" };
export const SCOPE_LABELS: Record<ExportScope, string> = { session: "本次自测错题", all: "全部错题", selected: "当前勾选" };
export function selectExportRecords(records: readonly WrongRecord[], scope: ExportScope, selectedIds: readonly string[], sessionWrongIds: readonly string[], limit: 10 | 20 | null): WrongRecord[] {
  const scoped = records.filter(r => scope === "all" || (scope === "selected" ? selectedIds : sessionWrongIds).includes(r.questionId));
  return [...scoped].sort((a, b) => b.lastWrongAt - a.lastWrongAt || a.questionId.localeCompare(b.questionId)).slice(0, limit ?? scoped.length);
}
export function exportMarkdown(records: readonly WrongRecord[], template: ExportTemplate, scope: ExportScope, at = new Date()): { markdown: string; filename: string } {
  if (!records.length) throw new Error("当前范围没有错题，请更换范围或勾选题目");
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const sections = records.map((r, i) => {
    const q = r.question;
    const body = [`## ${i + 1}. ${q.id} · ${QUESTION_TYPE_LABELS[q.type]} · ${DIFFICULTY_LABELS[q.difficulty]}`, displayPrompt(q),
      ...q.options.map(o => `- ${o.id}．${o.text}`)];
    if (template === "blank") body.push("作答：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", "\n\n");
    else {
      if (template === "correction") body.push(`**我的错误答案：** ${answerLabel(q, r.lastWrongAnswer)}`);
      body.push(`**标准答案：** ${answerLabel(q, r.standardAnswer)}`, `**解析：** ${r.analysis?.trim() || "原题暂无解析"}`);
    }
    return body.join("\n\n");
  });
  return { markdown: [`# 错题本 · ${TEMPLATE_LABELS[template]}`, `导出范围：${SCOPE_LABELS[scope]} · 导出日期：${date} · ${records.length} 题`, ...sections].join("\n\n"), filename: `${date}-${TEMPLATE_LABELS[template]}-${records.length}题.md` };
}
