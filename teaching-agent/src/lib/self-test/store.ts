import type { CatalogQuestion } from "../question-catalog";
import type { TestSession } from "./model";
import { createPersistentStore, localStorageAdapter } from "./persistence";

export const SELF_TEST_STORAGE_KEY = "ch6-self-test-v1";
export function validQuestionSnapshot(raw: unknown): raw is CatalogQuestion {
  if (!raw || typeof raw !== "object") return false;
  const q = raw as CatalogQuestion;
  return typeof q.id === "string" && !!q.id && ["choice", "judge", "fill"].includes(q.type) && typeof q.prompt === "string"
    && Array.isArray(q.options) && q.options.every(o => !!o && typeof o.id === "string" && typeof o.text === "string")
    && (q.answer === null || typeof q.answer === "string") && (q.analysis === null || typeof q.analysis === "string")
    && ["easy", "medium", "hard"].includes(q.difficulty)
    && (q.acceptedAnswers === undefined || Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.every(group => Array.isArray(group) && group.every(answer => typeof answer === "string")))
    && (q.tolerance === undefined || typeof q.tolerance === "number" && Number.isFinite(q.tolerance) && q.tolerance >= 0)
    && (q.verified === undefined || typeof q.verified === "boolean");
}
export function decodeSession(raw: unknown): TestSession | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") throw new Error("自测存储格式无效");
  const s = raw as TestSession;
  if (s.version !== 1 || typeof s.id !== "string" || !s.id || !Number.isFinite(s.createdAt)
    || !["catalog", "wrongbook-snapshot"].includes(s.source) || !["answering", "submitted"].includes(s.status)
    || !Array.isArray(s.questions) || !s.questions.length || !s.questions.every(validQuestionSnapshot)
    || new Set(s.questions.map(q => q.id)).size !== s.questions.length || !s.answers || typeof s.answers !== "object" || Array.isArray(s.answers)
    || Object.values(s.answers).some(v => typeof v !== "string") || !Number.isInteger(s.cursor) || s.cursor < 0 || s.cursor >= s.questions.length
    || !Array.isArray(s.results) || (s.status === "answering" ? s.results.length !== 0 || s.submittedAt !== null : !Number.isFinite(s.submittedAt) || s.results.length !== s.questions.length)
    || s.results.some((r, index) => r.questionId !== s.questions[index].id || typeof r.answer !== "string" || !["correct", "wrong", "pending", "unanswered"].includes(r.status))) throw new Error("自测存储格式无效");
  return s;
}
export const sessionStore = createPersistentStore(localStorageAdapter(SELF_TEST_STORAGE_KEY, null as TestSession | null, decodeSession), null as TestSession | null, "自测");
