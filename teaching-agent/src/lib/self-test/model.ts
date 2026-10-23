import { grade, normLetter } from "../grading";
import { isUsableQuestion, type CatalogQuestion, type QuestionDifficulty } from "../question-catalog";
import type { Question } from "../questions";

export type TestSettings = { count: number; types: Question["type"][]; difficulties: QuestionDifficulty[] };
export type AnswerStatus = "correct" | "wrong" | "pending" | "unanswered";
export type TestResult = { questionId: string; answer: string; status: AnswerStatus };
export type TestSession = {
  version: 1; id: string; createdAt: number; source: "catalog" | "wrongbook-snapshot";
  questions: CatalogQuestion[]; answers: Record<string, string>; cursor: number;
  status: "answering" | "submitted"; results: TestResult[]; submittedAt: number | null;
};
export const DEFAULT_SETTINGS: TestSettings = { count: 10, types: ["choice", "judge", "fill"], difficulties: ["easy", "medium", "hard"] };
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function parseQuestionCount(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
export function filterQuestions(pool: readonly CatalogQuestion[], settings: Pick<TestSettings, "types" | "difficulties">): CatalogQuestion[] {
  return pool.filter(q => isUsableQuestion(q) && settings.types.includes(q.type) && settings.difficulties.includes(q.difficulty));
}
export function sampleQuestions(pool: readonly CatalogQuestion[], count: number, rng = Math.random): CatalogQuestion[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("题量须为正整数");
  const unique = [...new Map(pool.map(q => [q.id, q])).values()];
  if (count > unique.length) throw new Error(`当前条件仅有 ${unique.length} 题`);
  for (let index = unique.length - 1; index > 0; index--) {
    const value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("随机源须返回 [0, 1) 范围的数值");
    const other = Math.floor(value * (index + 1));
    [unique[index], unique[other]] = [unique[other], unique[index]];
  }
  return unique.slice(0, count);
}
export function createSession(selected: readonly CatalogQuestion[], source: TestSession["source"] = "catalog", at = Date.now(), id = uid()): TestSession {
  if (!selected.length || new Set(selected.map(q => q.id)).size !== selected.length) throw new Error("试卷不能为空或包含重复题目");
  return { version: 1, id, createdAt: at, source, questions: JSON.parse(JSON.stringify(selected)), answers: {}, cursor: 0, status: "answering", results: [], submittedAt: null };
}
export function answerSession(session: TestSession, questionId: string, answer: string): TestSession {
  if (session.status !== "answering" || !session.questions.some(q => q.id === questionId)) return session;
  return { ...session, answers: { ...session.answers, [questionId]: answer } };
}
export function submitSession(session: TestSession, at = Date.now()): TestSession {
  if (session.status === "submitted") return session;
  const results = session.questions.map(q => {
    const answer = session.answers[q.id] ?? "";
    const verdict = answer.trim() ? grade(q, answer) : null;
    const status: AnswerStatus = !answer.trim() ? "unanswered" : verdict === true ? "correct" : verdict === false ? "wrong" : "pending";
    return { questionId: q.id, answer, status };
  });
  return { ...session, status: "submitted", results, submittedAt: at };
}
export function summarizeSession(session: TestSession) {
  const counts = { correct: 0, wrong: 0, pending: 0, unanswered: 0 };
  session.results.forEach(result => counts[result.status]++);
  const total = session.questions.length;
  const answered = session.questions.filter(q => (session.answers[q.id] ?? "").trim()).length;
  const determined = counts.correct + counts.wrong;
  return { ...counts, total, answered, completion: total ? answered / total : 0, accuracy: determined ? counts.correct / determined : null };
}
export function answerLabel(question: Question, raw = question.answer ?? ""): string {
  if (!raw.trim()) return "未作答";
  if (question.type === "judge") return normLetter(raw) === "T" ? "正确" : normLetter(raw) === "F" ? "错误" : raw;
  if (question.type === "choice") {
    const option = question.options.find(o => normLetter(o.id) === normLetter(raw));
    return option ? `${option.id}．${option.text}` : raw;
  }
  return raw;
}
/** 保留题干中的必要纠正与适用条件，只移除推断标记的排版噪声。 */
export function displayPrompt(question: Question): string {
  return question.prompt.replace(/\s*`\[推断\d*\]`/g, "").replace(/_{2,}/g, "＿＿＿＿").trim();
}
