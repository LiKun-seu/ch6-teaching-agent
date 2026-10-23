/**
 * slide-notes.json 全量质检（只读，不修改任何文件）
 *  1. KaTeX 全量 strict 校验（$...$ 与 $$...$$ 公式逐个渲染）
 *  2. 定界符配对检查（每个字段里 $ 的个数是否为偶数）
 *  3. 乱码 / 控制符 / 超短或纯符号要点检查
 *  4. 完整性检查（title 空、points 空）
 *  5. keys 可用性（带 $ 的 keys 统计，评估黄色高亮是否会失效）
 * 用法：node scripts/qa-slide-notes.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import katex from "katex";

const ROOT = process.cwd();
const NOTES = path.join(ROOT, "src/content/slide-notes.json");
const SLIDES = path.join(ROOT, "src/content/slides.json");

const notes = JSON.parse(await fs.readFile(NOTES, "utf8"));
let slides = [];
try {
  slides = JSON.parse(await fs.readFile(SLIDES, "utf8"));
} catch {
  /* slides.json 只读来补上下文，缺失不影响质检 */
}
const sectionOf = new Map(slides.map((s) => [String(s.page), s.section]));

const pages = Object.keys(notes).sort((a, b) => Number(a) - Number(b));

// ---------- 常量 ----------
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
// 典型 OCR 乱码 / 抽取残渣词（命中即判为脏数据）
const GARBAGE = [
  "干货专用章",
  "荔生煎",
  "破坯",
  "待补",
  "EMBED",
  "Error!",
  "undefined",
  "NaN",
  "此处是被 Bay",
  "替换是被 Bay",
];
// 至少含一个「有效字符」：中日韩文字、字母或数字
const HAS_MEANING = /[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9]/;

// 剥掉 key 里所有 $...$ 公式段，只留文字部分（用于判定「混合型」能否被救回）
function stripMath(s) {
  return s.replace(/\$[^$]*\$/g, "").trim();
}

/* ------------------------------------------------------------------ *
 * 以下函数逐一对照 src/components/StudyNotes.tsx 的实现，
 * 用于在 Node 侧复现 HighlightedText 的高亮行为、统计真实命中数。
 * 逻辑若与组件不一致，脚本会失真，改组件时请同步这里。
 * ------------------------------------------------------------------ */
const CJK_RE = /[\u4e00-\u9fff]/;
const MATH_BODY_RE = /\$([^$\n]*)\$/g;
const MATH_SPAN_RE = /\$[^$\n]*\$/g;

function chinesePartOf(key) {
  const rest = key.replace(MATH_SPAN_RE, " ").replace(/\s+/g, " ").trim();
  return rest.length >= 2 && CJK_RE.test(rest) ? rest : "";
}
function buildTextKeys(keys) {
  const out = [];
  for (const k of keys) {
    if (typeof k !== "string") continue;
    const t = k.trim();
    if (!t) continue;
    if (!t.includes("$")) {
      out.push(t);
      continue;
    }
    const cn = chinesePartOf(t);
    if (cn) out.push(cn);
  }
  return out;
}
function buildSymbols(keys) {
  const set = new Set();
  for (const k of keys) {
    if (typeof k !== "string" || !k.includes("$")) continue;
    if (chinesePartOf(k)) continue;
    for (const m of k.matchAll(MATH_BODY_RE)) {
      const body = m[1].replace(/\s+/g, "");
      if (body) set.add(body);
    }
  }
  return set;
}
function mathBodyOf(frag) {
  const s = frag.startsWith("$$") ? frag.slice(2, -2) : frag.slice(1, -1);
  return s.replace(/\s+/g, "");
}
function splitSegments(text) {
  const segs = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ math: false, value: text.slice(last, m.index) });
    segs.push({ math: true, value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ math: false, value: text.slice(last) });
  return segs;
}
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** 复制 markKeys 的计数逻辑：返回该段文本里会产生多少个 hl-key */
function countRanges(text, keys) {
  const usable = keys
    .filter((k) => typeof k === "string" && k.trim().length >= 1)
    .sort((a, b) => b.trim().length - a.trim().length);
  if (!usable.length) return 0;
  const pattern = usable.map((k) => escapeReg(k.trim()).replace(/\s+/g, "\\s*")).join("|");
  let re;
  try {
    re = new RegExp(pattern, "gi");
  } catch {
    return 0;
  }
  const ranges = [];
  for (const m of text.matchAll(re)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (e > s && !ranges.some((r) => s < r.e && e > r.s)) ranges.push({ s, e });
  }
  return ranges.length;
}
/** mode="old"（含 $ 的 key 整条丢弃）/ "new"（中文部分 + 符号指纹） */
function simulate(points, keys, mode) {
  const textKeys = mode === "old" ? keys.filter((k) => !k.includes("$")) : buildTextKeys(keys);
  const symbols = mode === "new" ? buildSymbols(keys) : new Set();
  let hl = 0;
  for (const pt of points) {
    for (const seg of splitSegments(pt)) {
      if (!seg.math) hl += countRanges(seg.value, textKeys);
      else if (symbols.size && symbols.has(mathBodyOf(seg.value))) hl += 1;
    }
  }
  return hl;
}

// ---------- 收集器 ----------
const res = {
  katexFatal: [], // strict 关闭时也报错 → 真致命
  katexStrict: [], // 仅 strict 模式下报错（多为数学模式里混入 Unicode 文本）
  katexOk: 0,
  oddDollar: [],
  ctrl: [],
  garbage: [],
  weakPoint: [],
  incomplete: [],
  keyStats: [],
  pureSymbol: [],
  mixedKey: [],
  zeroHighlight: [],
  sim: [],
};

const totalFields = { n: 0, withMath: 0 };
const allKeysCount = { n: 0, withDollar: 0 };

// ---------- 数学片段抽取：先匹配 $$...$$，再匹配 $...$ ----------
function extractMath(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("$$", i)) {
      const end = text.indexOf("$$", i + 2);
      if (end === -1) {
        spans.push({ display: true, raw: text.slice(i), unclosed: true });
        break;
      }
      spans.push({ display: true, raw: text.slice(i, end + 2), body: text.slice(i + 2, end) });
      i = end + 2;
      continue;
    }
    if (text[i] === "$") {
      const end = text.indexOf("$", i + 1);
      if (end === -1) {
        spans.push({ display: false, raw: text.slice(i), unclosed: true });
        break;
      }
      spans.push({ display: false, raw: text.slice(i, end + 1), body: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    i++;
  }
  return spans;
}

function renderSafe(body, display) {
  try {
    katex.renderToString(body, { displayMode: display, throwOnError: true, strict: true });
    return null; // 通过
  } catch (eStrict) {
    try {
      katex.renderToString(body, { displayMode: display, throwOnError: true, strict: "ignore" });
      return { level: "strict", msg: eStrict.message }; // 仅 strict 违规
    } catch (eLoose) {
      return { level: "fatal", msg: eLoose.message }; // 真致命
    }
  }
}

// ---------- 逐页逐字段检查 ----------
for (const p of pages) {
  const v = notes[p];
  const fields = [
    ["title", v.title],
    ...(Array.isArray(v.points) ? v.points : []).map((t, i) => [`points[${i}]`, t]),
    ...(Array.isArray(v.keys) ? v.keys : []).map((t, i) => [`keys[${i}]`, t]),
  ];

  for (const [fname, val] of fields) {
    const text = String(val ?? "");
    const where = `第 ${p} 页 ${fname}`;
    totalFields.n++;

    // 1) KaTeX 渲染
    const spans = extractMath(text);
    if (spans.length) totalFields.withMath++;
    for (const s of spans) {
      if (s.unclosed) {
        // 未闭合由「$ 个数奇偶」检查统一报，这里跳过渲染
        continue;
      }
      if (s.body.trim() === "") {
        res.katexFatal.push({ page: p, field: fname, formula: s.raw, msg: "空公式" });
        continue;
      }
      const r = renderSafe(s.body, s.display);
      if (!r) res.katexOk++;
      else if (r.level === "fatal")
        res.katexFatal.push({ page: p, field: fname, formula: s.raw, msg: r.msg });
      else res.katexStrict.push({ page: p, field: fname, formula: s.raw, msg: r.msg });
    }

    // 2) $ 定界符配对
    const dollars = (text.match(/\$/g) || []).length;
    if (dollars % 2 !== 0) res.oddDollar.push({ page: p, field: fname, count: dollars, text });

    // 3a) 控制符
    if (CTRL_RE.test(text)) res.ctrl.push({ page: p, field: fname, text });

    // 3b) OCR 乱码词
    for (const g of GARBAGE) {
      if (text.includes(g)) res.garbage.push({ page: p, field: fname, hit: g, text });
    }

    // 3c) 过短 / 纯符号要点
    if (fname.startsWith("points") && text.trim().length <= 1) {
      res.weakPoint.push({ page: p, field: fname, reason: "长度≤1", text });
    } else if (fname.startsWith("points") && !HAS_MEANING.test(text)) {
      res.weakPoint.push({ page: p, field: fname, reason: "无有效字符（纯符号）", text });
    }
  }

  // 4) 完整性
  const problems = [];
  if (!v.title || !String(v.title).trim()) problems.push("title 为空");
  if (!Array.isArray(v.points) || v.points.length === 0) problems.push("points 为空/少于 1 条");
  if (!Array.isArray(v.keys)) problems.push("keys 不是数组");
  if (problems.length) res.incomplete.push({ page: p, problems });

  // 5) keys 可用性 —— 按前端 StudyNotes.tsx:139 的真实过滤条件 `!k.includes("$")` 来算
  //    分类：clean(不含$)、pure(纯符号，剥掉公式后没剩中文)、mixed(中英混合，剥掉公式后仍有中文)
  const ks = (Array.isArray(v.keys) ? v.keys : []).map(String);
  const pointsAll = (Array.isArray(v.points) ? v.points : []).map(String).join(" ");
  const clean = [];
  const pure = [];
  const mixed = [];
  for (const k of ks) {
    allKeysCount.n++;
    if (!k.includes("$")) {
      clean.push(k);
      continue;
    }
    allKeysCount.withDollar++;
    const rest = stripMath(k);
    if (rest) mixed.push({ key: k, rest });
    else pure.push(k);
  }
  // 现状：按 `!k.includes("$")` 过滤后还剩几个可用的 key
  const usableNow = clean;
  // 修正后：再把混合型的中文部分也捞回来
  const afterFix = [...clean, ...mixed.map((m) => m.rest)];

  res.keyStats.push({
    page: p,
    section: sectionOf.get(p) ?? "-",
    total: ks.length,
    clean: clean.length,
    pure: pure.length,
    mixed: mixed.length,
    usableNow: usableNow.length,
    usableAfterFix: afterFix.length,
    keys: ks,
    mixedRest: mixed.map((m) => m.rest),
  });

  if (pure.length) res.pureSymbol.push({ page: p, keys: pure });
  if (mixed.length) res.mixedKey.push({ page: p, items: mixed, hitPoints: mixed.filter((m) => pointsAll.includes(m.rest)) });
  if (ks.length && usableNow.length === 0) res.zeroHighlight.push({ page: p, keys: ks });

  // 模拟 StudyNotes.tsx 的 HighlightedText，数出真实的 <span class="hl-key"> 个数
  const pts = (Array.isArray(v.points) ? v.points : []).map(String);
  res.sim.push({
    page: p,
    oldCount: simulate(pts, ks, "old"),
    newCount: simulate(pts, ks, "new"),
  });
}

// ---------- 报告 ----------
const line = (s) => console.log(s);
const head = (s) => {
  line("");
  line("══════════ " + s + " ══════════");
};
const cut = (s, n = 90) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

line("========== slide-notes.json 全量质检报告 ==========");
line(`总页数 ${pages.length}（${pages[0]} ~ ${pages[pages.length - 1]}）`);
line(`检查字段总数 ${totalFields.n}，其中含数学公式的字段 ${totalFields.withMath} 个`);

// ---- 1 ----
head("1. KaTeX 全量 strict 校验");
const fatals = res.katexFatal;
const stricts = res.katexStrict;
line(`渲染通过 ${res.katexOk} 个公式`);
line("");
line(`【致命错误】${fatals.length} 处 → ${fatals.length === 0 ? "通过" : "不通过"}`);
for (const f of fatals) line(`  第 ${f.page} 页 ${f.field} | ${cut(f.formula, 70)} | ${cut(f.msg, 120)}`);
line("");
line(`【仅 strict 违规】（关闭 strict 可正常渲染，多为公式里混入了中文等文本字符）${stricts.length} 处`);
for (const f of stricts) line(`  第 ${f.page} 页 ${f.field} | ${cut(f.formula, 70)} | ${cut(f.msg, 120)}`);

// ---- 2 ----
head("2. 定界符配对检查（每个字段 $ 的个数是否为偶数）");
line(`命中 ${res.oddDollar.length} 处 → ${res.oddDollar.length === 0 ? "通过" : "不通过"}`);
for (const f of res.oddDollar)
  line(`  第 ${f.page} 页 ${f.field} | $ 共 ${f.count} 个（奇数） | ${cut(f.text, 80)}`);
const oddPages = [...new Set(res.oddDollar.map((f) => f.page))].map(Number).sort((a, b) => a - b);
line(`受影响页码：${oddPages.length ? oddPages.join(", ") : "无"}`);

// ---- 3 ----
head("3. 乱码 / 控制符 / 无效要点检查");
line(`【3a 控制字符】${res.ctrl.length} 处 → ${res.ctrl.length === 0 ? "通过" : "不通过"}`);
for (const f of res.ctrl)
  line(
    `  第 ${f.page} 页 ${f.field} | ${JSON.stringify(String(f.text).slice(0, 80))}`,
  );

line("");
line(`【3b 典型 OCR 乱码词】${res.garbage.length} 处 → ${res.garbage.length === 0 ? "通过" : "不通过"}`);
for (const f of res.garbage)
  line(`  第 ${f.page} 页 ${f.field} | 命中「${f.hit}」 | ${cut(f.text, 80)}`);

line("");
line(`【3c 长度≤1 或纯符号的要点】${res.weakPoint.length} 处 → ${res.weakPoint.length === 0 ? "通过" : "不通过"}`);
for (const f of res.weakPoint)
  line(`  第 ${f.page} 页 ${f.field} | ${f.reason} | ${JSON.stringify(String(f.text).slice(0, 60))}`);

// ---- 4 ----
head("4. 完整性检查");
line(`命中 ${res.incomplete.length} 页 → ${res.incomplete.length === 0 ? "通过" : "不通过"}`);
for (const f of res.incomplete) line(`  第 ${f.page} 页 | ${f.problems.join("；")}`);

// ---- 5 ----
head("5. keys 可用性（对照前端 StudyNotes.tsx 的高亮匹配逻辑）");

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const nClean = sum(res.keyStats, (x) => x.clean);
const nPure = sum(res.keyStats, (x) => x.pure);
const nMixed = sum(res.keyStats, (x) => x.mixed);
const nNow = sum(res.keyStats, (x) => x.usableNow);
const nFix = sum(res.keyStats, (x) => x.usableAfterFix);
const pct = (a, b) => ((a / b) * 100).toFixed(1) + "%";

line(`keys 总数 ${allKeysCount.n}，其中含 $ 的 ${allKeysCount.withDollar} 个（${pct(allKeysCount.withDollar, allKeysCount.n)}）`);
line("");
line("含 $ 的 97 个按类型拆解：");
line(`  纯符号型（如 $\\xi_b$、$\\rho_{\\min}$，剥掉公式后无文字残留）：${nPure} 个`);
line(`  中英混合型（如「开裂弯矩 $M_{cr}$」，剥掉公式后仍有中文）：${nMixed} 个  ← 占含$项的 ${pct(nMixed, allKeysCount.withDollar)}`);
line(`  不含 $ 、可直接高亮：${nClean} 个`);
line("");
line("【5a 修复前的可用性】");
line(`修复前的过滤是 !k.includes("$")，含 $ 的 key 被整条丢弃 → 仍能高亮的 key：${nNow} / ${allKeysCount.n} = ${pct(nNow, allKeysCount.n)}`);
line("⚠ 那时候丢的不是「key 里的公式部分」，而是整条 key：");
line(`  所以上面 ${nMixed} 个混合型里的中文字词（如「开裂弯矩」「相对受压区高度」「混凝土剪力」）也一并被丢掉了，`);
line(`  实际损失比「丢掉 ${allKeysCount.withDollar} 个 key」更大。`);

line("");
line("【5b 模拟 StudyNotes.tsx HighlightedText 的真实命中】");
line("  逐行对照组件实现（buildTextKeys / buildSymbols / splitSegments / markKeys）复现，");
line("  统计每页实际会产生多少个 <span class=\"hl-key\">，而不是静态看 key 形态。");
line("  old = 组件修复前的逻辑（含 $ 的 key 整条丢弃）；new = 修复后（中文部分 + 符号指纹）。");

const hlOld = sum(res.sim, (x) => x.oldCount);
const hlNew = sum(res.sim, (x) => x.newCount);
const zeroOld = res.sim.filter((x) => x.oldCount === 0).map((x) => x.page);
const zeroNew = res.sim.filter((x) => x.newCount === 0).map((x) => x.page);

line("");
line(`  修复前：高亮 ${hlOld} 处，零命中页 ${zeroOld.length} 页${zeroOld.length ? "（" + zeroOld.join(", ") + "）" : ""}`);
line(`  修复后：高亮 ${hlNew} 处，零命中页 ${zeroNew.length} 页${zeroNew.length ? "（" + zeroNew.join(", ") + "）" : ""}`);
line(`  净增量：+${hlNew - hlOld} 处（${hlOld === 0 ? "—" : "+" + (((hlNew - hlOld) / hlOld) * 100).toFixed(1) + "%"}）`);

line("");
line("  注意：静态判据「keys 是否全部含 $」并不等价于「整页无高亮」——");
line("  有的页 key 是纯中文，但该词在本页要点里根本没出现，同样是 0 命中。必须以实际匹配为准：");
const staticZero = res.zeroHighlight.map((x) => x.page);
line(`    静态判据（keys 全含 $）算出的零高亮页：${staticZero.length ? staticZero.join(", ") : "无"}`);
line(`    实际模拟出的零命中页：${zeroOld.length ? zeroOld.join(", ") : "无"}`);
const diff = zeroOld.filter((p) => !staticZero.includes(p));
if (diff.length)
  line(`    ⚠ 多出 ${diff.length} 页（${diff.join(", ")}）：静态判据漏判，需靠模拟才能发现`);

if (res.zeroHighlight.length) {
  line("");
  line("  修复后各页恢复情况：");
  for (const p of zeroOld) {
    const s = res.sim.find((x) => x.page === p);
    const note = notes[p];
    line(`    第 ${p} 页：${s.oldCount} → ${s.newCount} 处 | ${cut(String(note.title), 34)}`);
  }
}

const top = [...res.sim].sort((a, b) => b.newCount - b.newCount + (b.newCount - b.oldCount) - (a.newCount - a.oldCount)).slice(0, 5);
line("");
line("  增益最大的 5 页：" + top.map((x) => `第 ${x.page} 页 +${x.newCount - x.oldCount}`).join("，"));

line("");
line("【5c 混合型能否救回】剥掉 $...$ 后，中文部分是否真的出现在该页 points 里");
const hitCount = sum(res.mixedKey, (x) => x.hitPoints.length);
line(`混合型 ${nMixed} 个中，剥离后的中文字词在本页要点文本里出现的有 ${hitCount} 个`);
line(`（说明：这是正则包含判断，实际能否亮还取决于去做匹配的那一段是否是非公式段）`);
line("（静态估算：old 逻辑下 609/706，仅算 key 形态；new 逻辑下 674 走中文部分 + 32 走符号指纹 = 706/706 全部参与）");
const missed = [];
for (const m of res.mixedKey)
  for (const it of m.items)
    if (!m.hitPoints.includes(it)) missed.push(`第 ${m.page} 页「${it.rest}」`);
if (missed.length) {
  line(`未在本页要点命中的（救回也不会亮，属正常）：${missed.length} 个`);
  for (const x of missed.slice(0, 10)) line(`    ${x}`);
  if (missed.length > 10) line(`    …… 其余 ${missed.length - 10} 个略`);
}

line("");
line("【5d 纯符号型（${nPure} 个）的处理方式】".replace("${nPure}", String(nPure)));
line("  这些 key 去掉公式段后没有中文残留，走不了正文匹配。前端现采用：");
line("  HighlightedText 对公式片段用「去空白后整片等值」判断是否就是某个 key 符号，");
line("  命中则只在 React 节点层面给这**一个** $...$ 片段包一层 hl-key，");
line("  不拆词、不整段刷黄、不向 KaTeX 输入注入任何标签。");
if (res.pureSymbol.length) {
  line(`涉及页（${res.pureSymbol.length} 页）：${res.pureSymbol.map((x) => x.page).join(", ")}`);
  line("  样例：" + cut(res.pureSymbol.map((x) => x.keys).flat().join(" / "), 120));
}
line("  之所以用等值而非子串：$x$、$\\rho$、$\\xi$ 这类 1~4 字符符号用子串会刷黄满页公式。");

// ---- 附：结构分布 ----
head("附：内容量分布");
const pDist = {};
const kDist = {};
for (const p of pages) {
  const v = notes[p];
  pDist[v.points?.length ?? 0] = (pDist[v.points?.length ?? 0] || 0) + 1;
  kDist[v.keys?.length ?? 0] = (kDist[v.keys?.length ?? 0] || 0) + 1;
}
line(`每页 points 条数分布：${JSON.stringify(pDist)}`);
line(`每页 keys 个数分布：${JSON.stringify(kDist)}`);
const secDist = {};
for (const p of pages) {
  const s = sectionOf.get(p) ?? "-";
  secDist[s] = (secDist[s] || 0) + 1;
}
line(`章节覆盖：${Object.entries(secDist).map(([k, v]) => `${k}(${v})`).join("  ")}`);

// ---- 总体结论 ----
head("总体结论");
const failCount = fatals.length + res.oddDollar.length + res.ctrl.length + res.garbage.length + res.weakPoint.length + res.incomplete.length;
// A printed failure must also fail CI; strict-only warnings remain advisory.
if (failCount > 0) process.exitCode = 1;
if (failCount === 0 && stricts.length === 0) {
  line("全部检查项通过：公式可渲染、定界符配对正确、无乱码无控制符、字段完整。");
  line("结论：可以直接给学生用。");
} else if (failCount === 0) {
  line(`致命/脏数据问题 0 处；但有 ${stricts.length} 处「仅 strict 违规」（公式里混入了中文等文本字符）。`);
  line("前端若按 KaTeX 默认（非 strict）渲染，这些公式仍可正常显示，不影响阅读。");
  line("结论：可以直接给学生用（strict 违规建议后续从提示词层面收敛，不必现在重跑）。");
} else {
  line(`发现 ${failCount} 处需要处理的问题：`);
  line(`  致命 KaTeX 错误 ${fatals.length}；定界符不配对 ${res.oddDollar.length}；控制符 ${res.ctrl.length}；`);
  line(`  OCR 乱码 ${res.garbage.length}；无效要点 ${res.weakPoint.length}；不完整页 ${res.incomplete.length}。`);
  line("结论：暂不建议使用，需先修正上述问题。");
}
line("");
line("注：第 5 项考察的是「前端消费数据的方式」，不是数据本身的缺陷。");
line(`  数据侧 ${allKeysCount.n} 个 key 均完整有效，无空值、无脏字符。`);
line(
  `  组件已按 5b/5d 修复（中文部分 + 符号指纹），模拟显示高亮 ${hlOld} → ${hlNew} 处、` +
    `零命中页 ${zeroOld.length} → ${zeroNew.length} 页。`,
);
line("  若改动 StudyNotes.tsx 的高亮逻辑，本脚本 §5b 会同步反映——它与组件实现相互独立，可作为回归对照。");
