import type { CatalogQuestion } from "../question-catalog";
import type { TestSession } from "../self-test/model";
import { validQuestionSnapshot } from "../self-test/store";

export type WrongRecord = { questionId: string; question: CatalogQuestion; lastWrongAnswer: string; standardAnswer: string; analysis: string | null; wrongCount: number; lastWrongAt: number; lastSessionId: string };
export type WrongbookState = { version: 1; records: WrongRecord[]; appliedSessionIds: string[] };
export const EMPTY_WRONGBOOK: WrongbookState = { version: 1, records: [], appliedSessionIds: [] };
export function sessionWrongRecords(session: TestSession | null): WrongRecord[] {
  if (!session || session.status !== "submitted") return [];
  return session.results.filter(r => r.status === "wrong").map(result => {
    const question = session.questions.find(q => q.id === result.questionId)!;
    return { questionId: question.id, question, lastWrongAnswer: result.answer, standardAnswer: question.answer ?? "", analysis: question.analysis,
      wrongCount: 1, lastWrongAt: session.submittedAt!, lastSessionId: session.id };
  });
}
export function applySessionErrors(state: WrongbookState, session: TestSession): WrongbookState {
  if (session.status !== "submitted" || state.appliedSessionIds.includes(session.id)) return state;
  const records = new Map(state.records.map(record => [record.questionId, record]));
  for (const result of session.results) {
    if (result.status !== "wrong") continue;
    const question = session.questions.find(q => q.id === result.questionId)!;
    const previous = records.get(question.id);
    records.set(question.id, { questionId: question.id, question: JSON.parse(JSON.stringify(question)), lastWrongAnswer: result.answer,
      standardAnswer: question.answer ?? "", analysis: question.analysis, wrongCount: (previous?.wrongCount ?? 0) + 1,
      lastWrongAt: session.submittedAt!, lastSessionId: session.id });
  }
  return { version: 1, records: [...records.values()].sort((a, b) => b.lastWrongAt - a.lastWrongAt || a.questionId.localeCompare(b.questionId)), appliedSessionIds: [...state.appliedSessionIds, session.id] };
}
export function decodeWrongbook(raw: unknown): WrongbookState {
  if (!raw || typeof raw !== "object") throw new Error("错题存储格式无效");
  const s = raw as WrongbookState;
  if (s.version !== 1 || !Array.isArray(s.records) || !Array.isArray(s.appliedSessionIds) || s.appliedSessionIds.some(id => typeof id !== "string")
    || s.records.some(r => !r || !validQuestionSnapshot(r.question) || r.questionId !== r.question.id || typeof r.lastWrongAnswer !== "string"
      || typeof r.standardAnswer !== "string" || (r.analysis !== null && typeof r.analysis !== "string") || !Number.isInteger(r.wrongCount) || r.wrongCount < 1
      || !Number.isFinite(r.lastWrongAt) || typeof r.lastSessionId !== "string") || new Set(s.records.map(r => r.questionId)).size !== s.records.length) throw new Error("错题存储格式无效");
  return s;
}
