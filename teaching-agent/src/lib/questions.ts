import main from "@/content/questions.json";
import extra from "@/content/k12-14-questions.json";

export type Question = {
  id: string;
  type: "choice" | "fill" | "judge";
  prompt: string;
  options: { id: string; text: string }[];
  answer: string | null;
  analysis: string | null;
  sectionId?: string;
  acceptedAnswers?: string[][];
  tolerance?: number;
  confidence?: string;
  verified?: boolean;
  source?: string;
};

export const k12Questions: Question[] = (extra as Question[]).map(question => ({
  ...question, sectionId: question.id.match(/^Q-(K1[2-4])-/)?.[1],
}));
export const questions: Question[] = [...main as Question[], ...k12Questions];

/** 有显式章节标注时只选本节；旧题库才走关键词兜底。 */
export function pickQuestions(pool: Question[], section: string, count = 3): Question[] {
  const id = section.match(/^K\d+/)?.[0];
  const usable = pool.filter(q => q.answer && (q.type !== "choice" || q.options?.length));
  const exact = usable.filter(q => q.sectionId === id && id);
  if (exact.length) return exact.sort((a, b) => Number(b.verified === true) - Number(a.verified === true)).slice(0, count);
  const tokens = section.replace(/^K\d+\s*/, "").match(/[\u4e00-\u9fff]{2,3}/g) ?? [];
  const score = (q: Question) => {
    const text = `${q.prompt} ${q.analysis ?? ""} ${(q.options ?? []).map(o => o.text).join(" ")}`;
    return tokens.reduce((n, token) => n + (text.includes(token) ? token.length : 0), 0);
  };
  return usable.filter(q => !q.sectionId || q.sectionId === id)
    .map(q => ({ q, score: score(q) }))
    .sort((a, b) => b.score - a.score || Number(b.q.verified === true) - Number(a.q.verified === true))
    .slice(0, count).map(item => item.q);
}
