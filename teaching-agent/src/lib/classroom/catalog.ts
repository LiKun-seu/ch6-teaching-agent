import "server-only";
import { getQuestionCatalog, isUsableQuestion, type CatalogQuestion } from "../question-catalog";
import { ClassroomError, publicQuestion } from "./store";

export function classroomQuestion(id: string): CatalogQuestion {
  const q = getQuestionCatalog().find(q => q.id === id);
  if (!q || !isUsableQuestion(q)) throw new ClassroomError("该题尚未复核、缺少答案或结构无效，不能发布");
  return q;
}
export function classroomCatalog() { return getQuestionCatalog().filter(isUsableQuestion).map(publicQuestion); }
