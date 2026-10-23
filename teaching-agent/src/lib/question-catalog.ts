import meta from "@/content/question-meta.json";
import { questions, type Question } from "./questions";
import { normLetter } from "./grading";

export type QuestionDifficulty = "easy" | "medium" | "hard";
export type CatalogQuestion = Question & { difficulty: QuestionDifficulty };
export const DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = { easy: "简单", medium: "中等", hard: "困难" };
export const QUESTION_TYPE_LABELS: Record<Question["type"], string> = { choice: "选择题", judge: "判断题", fill: "填空题" };
const difficulties = new Set(["easy", "medium", "hard"]);

/** 只读取原题库；元数据缺漏、重复 ID 或悬空 ID 会显式失败，不能默认为简单。 */
const catalog: readonly CatalogQuestion[] = (() => {
  const metadata = meta as Record<string, { difficulty: QuestionDifficulty; rationale: string }>;
  const ids = new Set<string>();
  const result = questions.map(question => {
    if (ids.has(question.id)) throw new Error(`题库 ID 重复：${question.id}`);
    ids.add(question.id);
    if (!metadata[question.id] || !difficulties.has(metadata[question.id].difficulty)) throw new Error(`难度元数据缺失或无效：${question.id}`);
    return { ...question, difficulty: metadata[question.id].difficulty };
  });
  if (Object.keys(metadata).some(id => !ids.has(id))) throw new Error("难度元数据存在悬空 ID");
  return result;
})();

export function getQuestionCatalog(): readonly CatalogQuestion[] { return catalog; }

/** 难度不参与可用性判断；缺损题不靠标记已复核或猜测选项放行。 */
export function isUsableQuestion(question: Question): boolean {
  if (question.verified !== true || !question.id?.trim() || !question.prompt?.trim() || !question.answer?.trim()) return false;
  if (/待补|EMBED Equation/.test(question.prompt)) return false;
  if (question.type === "fill") return question.answer.split(/[;；]/).every(part => !!part.trim());
  if (question.type === "judge") return ["T", "F"].includes(normLetter(question.answer)) && !/[（(]\s*[×√✓✕TF]\s*[）)]/.test(question.prompt);
  if (question.type !== "choice" || !Array.isArray(question.options) || question.options.length < 2) return false;
  const ids = new Set<string>();
  for (const option of question.options) {
    const id = normLetter(option.id);
    if (!/^[A-Z]$/.test(id) || ids.has(id) || !option.text?.trim() || /待补|EMBED Equation|[；;]\s*[A-D][.．:：]/.test(option.text)) return false;
    ids.add(id);
  }
  return ids.has(normLetter(question.answer));
}
