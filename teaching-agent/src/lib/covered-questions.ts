/**
 * 课件随堂题：questions.json 没有 page / section 字段。
 * 用题干和解析里的说法，去对当前章节里「页码 ≤ 当前页」的标题、要点、笔记。
 * 对不上、或题干里还有后面页才出现的说法，就不出这道题。
 */

export type CoveredSlide = {
  page: number;
  section: string;
  title: string;
  bullets: string[];
  note?: { title?: string; points?: string[]; keys?: string[] };
};

export type CoveredQuestion = {
  id: string;
  type: "choice" | "fill" | "judge";
  prompt: string;
  options?: { id: string; text: string }[];
  answer?: string | null;
  analysis?: string | null;
  verified?: boolean;
};

/** 几乎每节都会出现、不能单独证明「这页讲过」的说法 */
const STOP_PHRASE =
  /^(钢筋混凝土(梁|构件|结构|设计规范)?|混凝土(构件|结构|设计规范)?|受弯构件|承载力计算|最有效的措施(是)?)$/;

type SlideRec = { page: number; section: string; blob: string; phrases: string[] };
type Placement<T> = { question: T; section: string; unlock: number };

function canon(raw: string): string {
  return String(raw ?? "")
    .replace(/\$\$?/g, " ")
    .replace(/\\geq/g, ">=")
    .replace(/\\leq/g, "<=")
    .replace(/\\gt/g, ">")
    .replace(/\\lt/g, "<")
    .replace(/\\prime/g, "'")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}_^]/g, " ")
    .replace(/砼/g, "混凝土")
    .replace(/[′’‘`＇]/g, "'")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .toLowerCase()
    .replace(/a_?s'+/g, "a'")
    .replace(/as'+/g, "a'")
    .replace(/a'{2,}/g, "a'");
}

function compact(raw: string): string {
  return canon(raw).replace(/\s+/g, "");
}

function cjkLen(s: string): number {
  return (s.match(/[\u4e00-\u9fff]/g) || []).length;
}

/** 一句里的短说法，以及带数字/不等号的式子。不在长句上滑动截取，避免把后文粘成「新知识点」。 */
function phrasesFrom(text: string): string[] {
  const set = new Set<string>();
  const c = canon(text);
  const packed = c.replace(/\s+/g, "");
  for (const f of packed.match(/[a-z][a-z0-9>=<'.]{3,16}/g) || []) {
    if (/[\d>=<']/.test(f)) set.add(`F:${f}`);
  }
  for (const run of c.split(/[^\u4e00-\u9fff]+/)) {
    if (run.length >= 4 && run.length <= 12) set.add(run);
  }
  return [...set];
}

function slideBits(sl: CoveredSlide): string[] {
  const note = sl.note;
  return [sl.title, note?.title, ...(note?.keys ?? []), ...(sl.bullets ?? []), ...(note?.points ?? [])].filter(
    (x): x is string => Boolean(x && x.trim()),
  );
}

function promptNeedles(prompt: string): string[] {
  const packed = compact(prompt);
  const runs = packed.split(/[^\u4e00-\u9fff]+/).filter((r) => r.length >= 4 && r.length <= 12);
  const extra: string[] = [];
  for (const run of packed.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length > 12) {
      for (let i = 0; i + 6 <= run.length; i += 2) extra.push(run.slice(i, i + 6));
    }
  }
  return [...new Set([...runs, ...extra])];
}

/** 题干点名了受扭 / 裂缝 / 挠度 / 耐久，已看课件里必须真的出现过这些字 */
function topicCovered(prompt: string, coveredBlob: string): boolean {
  const p = compact(prompt);
  const groups: string[][] = [];
  if (p.includes("扭")) groups.push(["扭"]);
  if (p.includes("裂缝宽度")) groups.push(["裂缝宽度"]);
  else if (p.includes("裂缝")) groups.push(["裂缝"]);
  if (p.includes("挠度") || p.includes("刚度")) groups.push(["挠度", "刚度"]);
  if (p.includes("耐久") || p.includes("环境类别")) groups.push(["耐久", "环境类别"]);
  if (p.includes("碳化")) groups.push(["碳化"]);
  if (p.includes("弯起")) groups.push(["弯起"]);
  if (p.includes("不均匀")) groups.push(["不均匀"]);
  if (p.includes("内边缘") || p.includes("外边缘")) groups.push(["内边缘", "外边缘"]);
  if (p.includes("高强度钢筋") || p.includes("高强钢筋")) groups.push(["高强钢筋", "高强度钢筋"]);
  return groups.every((g) => g.some((w) => coveredBlob.includes(w)));
}

function usable(q: CoveredQuestion): boolean {
  return Boolean(q.answer) && (q.type !== "choice" || (q.options?.length ?? 0) > 0);
}

function firstPageOf(recs: SlideRec[], needle: string): number | null {
  for (const s of recs) if (s.blob.includes(needle)) return s.page;
  return null;
}

function placeQuestion<T extends CoveredQuestion>(
  q: T,
  recs: SlideRec[],
  deck: SlideRec[],
  df: Map<string, number>,
): Placement<T> | null {
  const text = compact(`${q.prompt}\n${q.analysis ?? ""}`);
  const promptPacked = compact(q.prompt);
  const isGeneric = (p: string) => {
    const n = df.get(p) ?? 0;
    if (p.startsWith("F:")) return n >= 8 || p.length < 6;
    if (STOP_PHRASE.test(p)) return true;
    return n >= 5 || cjkLen(p) < 4;
  };

  const bySec = new Map<string, Map<string, number>>();
  for (const s of recs) {
    for (const p of s.phrases) {
      if (isGeneric(p)) continue;
      const needle = p.startsWith("F:") ? p.slice(2) : p;
      if (!text.includes(needle)) continue;
      let bag = bySec.get(s.section);
      if (!bag) bySec.set(s.section, (bag = new Map()));
      const prev = bag.get(p);
      if (prev == null || s.page < prev) bag.set(p, s.page);
    }
  }

  const scored: { section: string; score: number; unlock: number; phrases: { phrase: string; page: number }[] }[] = [];
  for (const [section, bag] of bySec) {
    const list = [...bag.entries()].map(([phrase, page]) => ({ phrase, page }));
    const kept = list.filter(
      (a) =>
        !list.some(
          (b) =>
            b.phrase !== a.phrase &&
            !a.phrase.startsWith("F:") &&
            !b.phrase.startsWith("F:") &&
            b.phrase.includes(a.phrase) &&
            b.phrase.length > a.phrase.length,
        ),
    );
    const inPrompt = kept.filter((ph) => promptPacked.includes(ph.phrase.startsWith("F:") ? ph.phrase.slice(2) : ph.phrase));
    if (!inPrompt.length) continue;
    const score = inPrompt.reduce((acc, x) => acc + (x.phrase.startsWith("F:") ? 3 : 1), 0);
    const unlock = Math.max(...inPrompt.map((x) => x.page));
    scored.push({ section, score, unlock, phrases: inPrompt });
  }
  scored.sort((a, b) => b.score - a.score || a.unlock - b.unlock);
  const best = scored[0];
  if (!best) return null;
  const second = scored[1];
  const rareFormula = best.phrases.some((p) => p.phrase.startsWith("F:") && (df.get(p.phrase) ?? 9) <= 4);
  const strong = best.phrases.some((p) => !p.phrase.startsWith("F:") && p.phrase.length >= 6 && (df.get(p.phrase) ?? 9) <= 2);
  if (best.phrases.length < 2 && !rareFormula && !strong) return null;
  if (second && second.score >= best.score) return null;
  if (second && best.score < 3 && second.score + 1 >= best.score && !rareFormula) return null;

  const coveredBlob = recs
    .filter((s) => s.section === best.section && s.page <= best.unlock)
    .map((s) => s.blob)
    .join("");
  if (!topicCovered(q.prompt, coveredBlob)) return null;

  for (const clause of promptNeedles(q.prompt)) {
    const fp = firstPageOf(deck, clause);
    if (fp != null && fp > best.unlock) return null;
  }
  return { question: q, section: best.section, unlock: best.unlock };
}

function placements<T extends CoveredQuestion>(questions: T[], slides: CoveredSlide[]): Placement<T>[] {
  const deck = [...slides]
    .sort((a, b) => a.page - b.page)
    .map((sl) => {
      const bits = slideBits(sl);
      const phrases = new Set<string>();
      for (const bit of bits) for (const p of phrasesFrom(bit)) phrases.add(p);
      return { page: sl.page, section: sl.section, blob: compact(bits.join("\n")), phrases: [...phrases] };
    });
  const teach = deck.filter((s) => !s.section.startsWith("封面"));

  const df = new Map<string, number>();
  for (const s of deck) for (const p of s.phrases) df.set(p, (df.get(p) ?? 0) + 1);

  return questions.filter(usable).flatMap((q) => {
    const hit = placeQuestion(q, teach, deck, df);
    return hit ? [hit] : [];
  });
}

/**
 * 讲到这一页为止、当前章节里已经能对上的题。越近讲完的越靠前。
 * 自学课件不再把这份名单贴在内容页下面；对得上的题由 questionsAfterSlide 各自占一页。
 */
export function questionsByPage<T extends CoveredQuestion>(
  questions: T[],
  slides: CoveredSlide[],
  n = 3,
): Map<number, T[]> {
  const placed = placements(questions, slides);
  const out = new Map<number, T[]>();
  const pages = [...slides].filter((s) => !s.section.startsWith("封面")).sort((a, b) => a.page - b.page);
  for (const s of pages) {
    const list = placed
      .filter((p) => p.section === s.section && p.unlock <= s.page)
      .sort(
        (a, b) =>
          b.unlock - a.unlock ||
          Number(b.question.verified === true) - Number(a.question.verified === true) ||
          a.question.id.localeCompare(b.question.id),
      )
      .slice(0, n)
      .map((p) => p.question);
    out.set(s.page, list);
  }
  return out;
}

/**
 * 刚好在这一页讲完的题。调用方应把它们放在该页的下一页，
 * 不要堆到章末，也不要放到更早的页后面。对不上的题不会出现在这里。
 */
export function questionsAfterSlide<T extends CoveredQuestion>(
  questions: T[],
  slides: CoveredSlide[],
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const hit of placements(questions, slides)) {
    const list = out.get(hit.unlock) ?? [];
    list.push(hit.question);
    out.set(hit.unlock, list);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) => Number(b.verified === true) - Number(a.verified === true) || a.id.localeCompare(b.id),
    );
  }
  return out;
}
