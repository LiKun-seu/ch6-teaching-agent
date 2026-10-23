"use client";

import { Fragment, type ReactNode } from "react";
import { Markdown } from "./Markdown";

/* ------------------------------------------------------------------ *
 * OCR 碎片清洗
 * slides.json 里的 title / bullets 是从 .doc 抽出来的，混着大量乱码
 * （"干货专用章"、"防止荔生煎压破坯"、"="、"εc"、"M/Mu"、"Ⅱ a"…）。
 * 任何要展示给学生的文本都先过一遍 cleanLine / cleanTitle。
 * ------------------------------------------------------------------ */

/** 一眼就能看出是乱码的词，命中就整条丢弃 */
const GARBAGE_WORDS = ["干货专用章", "专用章", "荔生煎", "生煎", "破坯", "dooooo", "cbcoctobbtc"];

/** 行首的项目符号：◆ • · ● ▪ 以及 Wingdings 私有区字符（   …） */
const LEAD_JUNK = /^[\s>*\-\u00B7\u2010-\u2015\u2018-\u201F\u2022\u2023\u25A0-\u25FF\u2B00-\u2BFF\uE000-\uF8FF\uFEFF]+/;
const TRAIL_JUNK = /[\s\uE000-\uF8FF]+$/;

const CJK = /[\u4e00-\u9fff]/g;

function cjkCount(s: string): number {
  return (s.match(CJK) || []).length;
}

/** 单行清洗：返回 "" 表示这条是噪音，不该展示 */
export function cleanLine(raw: string | null | undefined): string {
  if (!raw) return "";
  let t = String(raw)
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";

  t = t.replace(LEAD_JUNK, "").replace(TRAIL_JUNK, "").trim();
  t = t.replace(/\s*-{2,}\s*$/, "").trim(); // 尾部 "---"
  if (!t) return "";

  // 明显乱码词
  if (GARBAGE_WORDS.some((w) => t.includes(w))) return "";
  // 联系方式、纯英文题干等
  if (/(Tel|电话|邮箱|@|1[3-9]\d{9})/i.test(t)) return "";
  // 页码碎片
  if (/^第\s*\d+\s*页$/.test(t)) return "";
  // 长度 < 2 或中文不足 2 字 → 基本是符号/字母碎片
  if (t.length < 2 || cjkCount(t) < 2) return "";
  // 中文占比过低 → 公式、坐标轴、数字串之类的碎片
  const ratio = cjkCount(t) / t.replace(/\s/g, "").length;
  if (ratio < 0.25) return "";
  // 以句末标点收尾且很短 → 被 OCR 截断的半句话
  if (cjkCount(t) < 6 && /[。；，、？！：）]$/.test(t)) return "";

  return t;
}

/**
 * 轻清洗：给 AI 生成的要点用。
 * 那些句子里公式占比很高（"$\xi_b = \frac{x_b}{h_0}$…"），
 * 不能套用上面的中文占比/截断规则，只过滤硬噪音。
 */
export function cleanNoteLine(raw: string | null | undefined): string {
  if (!raw) return "";
  let t = String(raw)
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  t = t.replace(LEAD_JUNK, "").replace(TRAIL_JUNK, "").trim();
  if (t.length < 2) return "";
  if (GARBAGE_WORDS.some((w) => t.includes(w))) return "";
  if (/(Tel|电话|邮箱|@|1[3-9]\d{9})/i.test(t)) return "";
  return t;
}

/** 一组 bullets → 清洗 + 去重后的中文要点 */
export function cleanBullets(list: (string | null | undefined)[] | null | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = cleanLine(raw);
    if (!t) continue;
    const k = t.replace(/\s/g, "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** 标题清洗：砍掉尾部成段的英文（"（ Flexural Behavior of RC Beam）"），再按正文规则过滤 */
export function cleanTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  let t = String(raw)
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  // 从第一段「含至少两个字母的连续 ASCII」处截断（英文标题/译名），只留中文部分。
  // 只含数字的编号（"6.2.3 正截面受力分析的基本假定"）不算英文，保留。
  t = t.split(/[\x20-\x7E]*[A-Za-z][\x20-\x7E]*[A-Za-z][\x20-\x7E]*/)[0] ?? "";
  t = t.replace(LEAD_JUNK, "").replace(TRAIL_JUNK, "").trim();
  t = t.replace(/[\s，、：:（(（]+$/, "").replace(/[）)]$/, "").trim();
  if (!t) return "";
  if (GARBAGE_WORDS.some((w) => t.includes(w))) return "";
  if (t.length < 2 || cjkCount(t) < 2) return "";
  return t;
}

/* ------------------------------------------------------------------ *
 * 关键词高亮
 * 正文区间：把 key 包成 <span class="hl-key">（不动公式内部）。
 * 公式区间：只给"命中 key 符号的那一个 $...$ 片段"整片包一层高亮，
 *          不拆词、不向 KaTeX 输入注入任何标签，避免破坏公式渲染。
 * ------------------------------------------------------------------ */

const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
const MATH_BODY_RE = /\$([^$\n]*)\$/g;
const MATH_SPAN_RE = /\$[^$\n]*\$/g;
const CJK_RE = /[\u4e00-\u9fff]/;

type Seg = { math: boolean; value: string };

/* keys 里约 14% 带 LaTeX（"开裂弯矩 $M_{cr}$"、"$\xi_b$"），
 * 早期实现遇到含 "$" 的 key 就整条丢弃，导致：
 *   ① 混合型 key 的中文部分（"开裂弯矩"）本可匹配却被连带丢掉；
 *   ② keys 全是公式的页面（p.34、p.118…）整页零高亮。
 * 这里把 key 拆成「文本词」和「符号指纹」两类分别处理。 */

/** key 去掉 $...$ 公式段后剩下的中文部分；不满足条件（无中文 / 太短）返回 "" */
function chinesePartOf(key: string): string {
  const rest = key.replace(MATH_SPAN_RE, " ").replace(/\s+/g, " ").trim();
  return rest.length >= 2 && CJK_RE.test(rest) ? rest : "";
}

/** 参与正文匹配的全部文本词：原样保留不含 $ 的 key，并为混合型 key 补上中文部分 */
function buildTextKeys(keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string") continue;
    const t = k.trim();
    if (!t) continue;
    if (!t.includes("$")) {
      out.push(t); // 原有行为，一字不差保留
      continue;
    }
    const cn = chinesePartOf(t);
    if (cn) out.push(cn);
  }
  return out;
}

/**
 * 纯符号型 key（去掉公式段后没有可用中文）的符号指纹集合。
 * 指纹已去掉所有空白，故 "$ M_u $" 与 "$M_u$" 判为同一符号。
 */
function buildSymbols(keys: string[]): Set<string> {
  const set = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string" || !k.includes("$")) continue;
    if (chinesePartOf(k)) continue; // 混合型已由中文部分覆盖，不再单独刷公式
    for (const m of k.matchAll(MATH_BODY_RE)) {
      const body = m[1].replace(/\s+/g, "");
      if (body) set.add(body);
    }
  }
  return set;
}

/** 取公式片段的内容（去掉两侧定界符），并去空白便于比对 */
function mathBodyOf(frag: string): string {
  const s = frag.startsWith("$$") ? frag.slice(2, -2) : frag.slice(1, -1);
  return s.replace(/\s+/g, "");
}

/**
 * 该公式片段是否就是某个 key 符号本身。
 * 只在 React 节点层面整片包裹渲染结果，**绝不向 KaTeX 输入注入标签**。
 * 用整片等值而非子串包含，避免 "$x$""$\rho$" 这类短符号把满页公式刷黄。
 */
function isKeySymbol(frag: string, symbols: Set<string>): boolean {
  return symbols.size > 0 && symbols.has(mathBodyOf(frag));
}

function splitSegments(text: string): Seg[] {
  const segs: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(text)) !== null) {
    if (m.index > last) segs.push({ math: false, value: text.slice(last, m.index) });
    segs.push({ math: true, value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ math: false, value: text.slice(last) });
  return segs;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在一段纯文本里把 keys 包成 <span class="hl-key">，返回 React 节点（不用 innerHTML） */
function markKeys(text: string, keys: string[], seed: string): ReactNode[] {
  // keys 已由 buildTextKeys 归一化（含 $ 的 key 取其可匹配的中文部分），此处只做长度过滤
  const usable = keys
    .filter((k) => typeof k === "string" && k.trim().length >= 1)
    .sort((a, b) => b.trim().length - a.trim().length); // 长词优先，避免被短词截断
  if (!usable.length) return [text];

  const pattern = usable.map((k) => escapeReg(k.trim()).replace(/\s+/g, "\\s*")).join("|");
  let re: RegExp;
  try {
    re = new RegExp(pattern, "gi");
  } catch {
    return [text];
  }

  const ranges: { s: number; e: number }[] = [];
  for (const m of text.matchAll(re)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (e > s && !ranges.some((r) => s < r.e && e > r.s)) ranges.push({ s, e });
  }
  if (!ranges.length) return [text];

  const out: ReactNode[] = [];
  let cur = 0;
  ranges.forEach((r, i) => {
    if (r.s > cur) out.push(<Fragment key={`${seed}-t${i}`}>{text.slice(cur, r.s)}</Fragment>);
    out.push(
      <span key={`${seed}-h${i}`} className="hl-key">
        {text.slice(r.s, r.e)}
      </span>,
    );
    cur = r.e;
  });
  if (cur < text.length) out.push(<Fragment key={`${seed}-tail`}>{text.slice(cur)}</Fragment>);
  return out;
}

/** 一段要点文本：公式走 Markdown/KaTeX，正文里的关键词黄色高亮 */
export function HighlightedText({ text, keys = [] }: { text: string; keys?: string[] }) {
  const textKeys = buildTextKeys(keys);
  const symbols = buildSymbols(keys);
  const segs = splitSegments(text);
  return (
    <>
      {segs.map((seg, i) => {
        if (!seg.math) {
          return <Fragment key={`t${i}`}>{markKeys(seg.value, textKeys, `t${i}`)}</Fragment>;
        }
        // 公式片段：命中 key 符号时整片包一层高亮（只包这一个片段，不包整段正文）
        const math = <Markdown text={seg.value} className="inline [&>p]:m-0 [&>p]:inline" />;
        return isKeySymbol(seg.value, symbols) ? (
          <span key={`m${i}`} className="hl-key">
            {math}
          </span>
        ) : (
          <Fragment key={`m${i}`}>{math}</Fragment>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 本页要点
 * ------------------------------------------------------------------ */

export type SlideNote = { title?: string; points?: string[]; keys?: string[] };

export function StudyNotes({
  title,
  points,
  keys,
}: {
  title: string;
  points: string[];
  keys: string[];
}) {
  return (
    <div>
      <h3 className="text-[15px] font-medium leading-6">{title}</h3>

      {points.length ? (
        <ul className="mt-3 space-y-2">
          {points.map((p, i) => (
            <li key={i} className="flex gap-1.5 text-[13px] leading-6 text-ink-soft">
              <span className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span className="min-w-0 flex-1">
                <HighlightedText text={p} keys={keys} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12.5px] leading-6 text-ink-faint">本页要点整理中。</p>
      )}

    </div>
  );
}
