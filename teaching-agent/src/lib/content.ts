import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import slidesJson from "@/content/slides.json";
import { questions, k12Questions } from "@/lib/questions";
export { questions, k12Questions };
export type { Question } from "@/lib/questions";
import type { Question } from "@/lib/questions";

export type Slide = {
  page: number;
  section: string;
  title: string;
  bullets: string[];
  image: string;
};

export const slides = slidesJson as Slide[];

/** key 为 ""（通用）或 K12 / K13 / K14 */
const knowledgeCache = new Map<string, string>();

/* ------------------------------------------------------------------
 * K12~K14（受扭 / 挠度 / 裂缝）没有 PPT 页，内容来自 k12-14.md。
 * 该文件有 2.8 万字，无条件整篇塞进系统提示词太重，所以按需拼装：
 *   - 当前上下文是 K12/K13/K14 → 拼该节全文（剥离自测题，避免模型照念答案）
 *   - 其他情况 → 只拼一份三节索引摘要
 * ------------------------------------------------------------------ */
type K12Cache = { sections: Map<string, string>; index: string };
let k12Cache: K12Cache | null = null;

async function loadK12(): Promise<K12Cache> {
  if (k12Cache) return k12Cache;
  const file = path.join(process.cwd(), "src", "content", "k12-14.md");
  let md = "";
  try {
    md = await fs.readFile(file, "utf8");
  } catch {
    // 资料缺失不影响其余章节
  }
  const sections = new Map<string, string>();
  if (md) {
    for (const part of md.split(/^## /m).slice(1)) {
      const title = part.split("\n")[0].trim();
      // 自测题与资料来源不进提示词
      const body = part
        .replace(/###\s*[\d.]*\s*自测题[\s\S]*?(?=\n## |\n### |$)/g, "")
        .replace(/##\s*附录[\s\S]*$/g, "")
        .replace(/##\s*资料来源[\s\S]*$/g, "")
        .trim();
      const m = title.match(/K(1[2-4])/);
      if (m && body) sections.set(`K${m[1]}`, `## ${body}`);
    }
    const lines = ["【K12~K14 补充内容索引（这三节没有 PPT 页，讲到这里时按索引展开）】"];
    for (const [key, body] of sections) {
      const core = body.match(/###\s*[\d.]+\s*核心概念([\s\S]*?)(?=\n### |\n## |$)/);
      const bullets = (core?.[1] ?? "")
        .split("\n")
        .filter((l) => /^\s*[-*]\s+\S/.test(l))
        .slice(0, 3)
        .map((l) => l.replace(/^\s*[-*]\s+/, "").trim());
      lines.push(`${key}：${bullets.join("；") || body.slice(0, 100)}`);
    }
    k12Cache = { sections, index: lines.join("\n") };
  } else {
    k12Cache = { sections, index: "" };
  }
  return k12Cache;
}

/** 读取第六章知识库（教学 Agent 系统提示词的内容源） */
export async function loadKnowledge(sectionHint?: string): Promise<string> {
  const hit = sectionHint?.match(/K(1[2-4])/);
  const key = hit ? `K${hit[1]}` : "";
  const cached = knowledgeCache.get(key);
  if (cached) return cached;

  const dir = path.join(process.cwd(), "src", "content");
  let main = "（知识库文件缺失：src/content/ch6-knowledge.md）";
  try {
    main = await fs.readFile(path.join(dir, "ch6-knowledge.md"), "utf8");
  } catch {
    // 忽略
  }

  const { sections, index } = await loadK12();
  let extra = "";
  if (key && sections.has(key)) {
    extra = sections.get(key)!;
  } else if (index) {
    extra = `${index}\n（学生问到受扭 / 挠度 / 裂缝时，据此展开；自测题只用于自学天地练习，不要直接告诉学生答案。）`;
  }

  const out = extra ? `${main}\n\n${extra}` : main;
  knowledgeCache.set(key, out);
  return out;
}

/** 按节分组的幻灯片目录，用于自学天地导航 */
export function slidesBySection(): { section: string; pages: Slide[] }[] {
  const map = new Map<string, Slide[]>();
  for (const s of slides) {
    const arr = map.get(s.section) ?? [];
    arr.push(s);
    map.set(s.section, arr);
  }
  return [...map.entries()]
    .map(([section, pages]) => ({ section, pages: pages.sort((a, b) => a.page - b.page) }))
    .sort((a, b) => a.pages[0].page - b.pages[0].page);
}

export function findSlide(page: number): Slide | undefined {
  return slides.find((s) => s.page === page);
}

/** 紧凑版答案表（给教学 Agent 判题用；未复核的加 * 提醒谨慎） */
export function answerIndex(): string {
  return questions
    .filter((q) => q.answer)
    .map((q) => `${q.id}=${q.answer}${q.verified === false ? "*" : ""}`)
    .join(" ");
}

/** 每节 PPT 的页码区间，供教学 Agent 引用页码发图（如"第 45~52 页"） */
export function pageIndex(): { section: string; from: number; to: number }[] {
  const map = new Map<string, number[]>();
  for (const s of slides) {
    if (!s.section) continue;
    const arr = map.get(s.section) ?? [];
    arr.push(s.page);
    map.set(s.section, arr);
  }
  return [...map.entries()]
    .map(([section, pages]) => ({
      section,
      from: Math.min(...pages),
      to: Math.max(...pages),
    }))
    .sort((a, b) => a.from - b.from);
}

/** 各节的检索关键词。K12~K14 的节名截断后会取不到题（"变形（挠" 这种），单独配词 */
const SECTION_KEYS: Record<string, string[]> = {
  K12: ["受扭", "扭", "扭矩", "弯剪扭"],
  K13: ["挠度", "刚度", "变形", "长期刚度"],
  K14: ["裂缝宽度", "裂缝", "不均匀系数", "保护层"],
  K11: ["斜截面受剪承载力", "斜截面"],
  K8: ["斜截面", "受剪"],
  K5: ["单筋", "矩形截面"],
};

/** 从题库里挑几道与某一节相关的题（按关键词匹配，无匹配则随机取） */
export function questionsForSection(section: string, limit = 3): Question[] {
  const id = section.match(/^K(\d+)/);
  const keys =
    (id && SECTION_KEYS[`K${id[1]}`]) || [section.replace(/^K\d+\s*/, "").slice(0, 4)];
  const hit = questions.filter((q) => keys.some((k) => q.prompt.includes(k)));
  const pool = hit.length >= limit ? hit : [...hit, ...questions.filter((q) => !hit.includes(q))];
  return pool.slice(0, limit);
}
